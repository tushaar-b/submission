import { exponentialBackoffMs, retryAfterSeconds } from './resilience';
import express from 'express';

export const app = express();
const port = Number(process.env.PORT || 3001);
const INDIA = { south: 6.4, west: 68.1, north: 35.7, east: 97.5 };
const cache = new Map<string, Snapshot>();
const inflight = new Map<string, Promise<Snapshot>>();
const retryState = new Map<string, { count: number; until: number }>();
const TTL = 60_000;
let nextGlobalRequestAt = 0;

type Aircraft = { icao24:string; callsign:string|null; originCountry:string|null; timePosition:number|null; lastContact:number|null; longitude:number|null; latitude:number|null; altitudeMeters:number|null; onGround:boolean|null; velocityMetersPerSecond:number|null; headingDegrees:number|null; verticalRateMetersPerSecond:number|null; geoAltitudeMeters:number|null; category:number|null };
type Snapshot = { source:'live'|'cache'; status:string; fetchedAt:string; upstreamTime:number|null; stale:boolean; nextRefreshAllowedAt:string|null; region:{id:string;label:string;bbox:number[];center:number[];zoom:number}; aircraft:Aircraft[]; error?:string };
const num=(v:unknown):number|null=>typeof v==='number'&&Number.isFinite(v)?v:null;

export function parseStates(body:unknown):{time:number|null;aircraft:Aircraft[]}{
  const b=body as {time?:unknown;states?:unknown};
  const states=Array.isArray(b?.states)?b.states:[];
  const aircraft=states.flatMap((row):Aircraft[]=>{
    if(!Array.isArray(row)||typeof row[0]!=='string')return[];
    const lat=num(row[6]),lon=num(row[5]);
    return[{icao24:row[0].toLowerCase(),callsign:typeof row[1]==='string'?row[1].trim()||null:null,originCountry:typeof row[2]==='string'?row[2]:null,timePosition:num(row[3]),lastContact:num(row[4]),longitude:lon!==null&&lon>=-180&&lon<=180?lon:null,latitude:lat!==null&&lat>=-90&&lat<=90?lat:null,altitudeMeters:num(row[7]),onGround:typeof row[8]==='boolean'?row[8]:null,velocityMetersPerSecond:num(row[9]),headingDegrees:num(row[10]),verticalRateMetersPerSecond:num(row[11]),geoAltitudeMeters:num(row[13]),category:num(row[17])}];
  });
  return{time:num(b?.time),aircraft};
}

function parseBbox(value:unknown):[number,number,number,number]|null{
  if(typeof value!=='string')return null;
  const values=value.split(',').map(Number);
  if(values.length!==4||values.some(v=>!Number.isFinite(v)))return null;
  const [south,west,north,east]=values;
  if(south<INDIA.south||west<INDIA.west||north>INDIA.north||east>INDIA.east||south>=north||west>=east||north-south>10||east-west>10)return null;
  return[ south,west,north,east ];
}

let token:{value:string;expires:number}|null=null;
async function accessToken(){
  if(!process.env.OPENSKY_CLIENT_ID||!process.env.OPENSKY_CLIENT_SECRET)return null;
  if(token&&token.expires>Date.now()+30_000)return token.value;
  const form=new URLSearchParams({grant_type:'client_credentials',client_id:process.env.OPENSKY_CLIENT_ID,client_secret:process.env.OPENSKY_CLIENT_SECRET});
  const response=await fetch('https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:form,signal:AbortSignal.timeout(8_000)});
  if(!response.ok)throw new Error(`OpenSky token error ${response.status}`);
  const body=await response.json() as {access_token:string;expires_in:number};token={value:body.access_token,expires:Date.now()+body.expires_in*1000};return token.value;
}

async function request(bbox:[number,number,number,number], key:string):Promise<Snapshot>{
  const previous=cache.get(key),now=Date.now(),retry=retryState.get(key),wait=Math.max(retry?.until||0,nextGlobalRequestAt);
  if(previous&&now-Date.parse(previous.fetchedAt)<TTL)return{...previous,source:'cache',status:'ok',stale:false};
  if(wait>now){if(previous)return{...previous,source:'cache',status:'rate_limited',stale:true,nextRefreshAllowedAt:new Date(wait).toISOString()};throw Object.assign(new Error('OpenSky request cooldown'),{status:429,retryAfterSeconds:Math.ceil((wait-now)/1000)});}
  nextGlobalRequestAt=now+10_000;
  const [south,west,north,east]=bbox;
  const promise=(async()=>{
    let auth=await accessToken();
    const url=`https://opensky-network.org/api/states/all?lamin=${south}&lomin=${west}&lamax=${north}&lomax=${east}`;
    let response=await fetch(url,{headers:auth?{Authorization:`Bearer ${auth}`}: {},signal:AbortSignal.timeout(15_000)});
    if(response.status===401&&auth){token=null;auth=await accessToken();response=await fetch(url,{headers:{Authorization:`Bearer ${auth}`},signal:AbortSignal.timeout(15_000)});}
    if(!response.ok){
      const delay=retryAfterSeconds(response.headers.get('x-rate-limit-retry-after-seconds'),response.headers.get('retry-after'));
      const count=(retryState.get(key)?.count||0)+1,backoff=response.status===429?delay:exponentialBackoffMs(count);
      retryState.set(key,{count,until:Date.now()+backoff*1000});nextGlobalRequestAt=Math.max(nextGlobalRequestAt,Date.now()+backoff*1000);
      if(previous)return{...previous,source:'cache' as const,status:response.status===429?'rate_limited':'stale',stale:true,nextRefreshAllowedAt:new Date(nextGlobalRequestAt).toISOString(),error:`OpenSky returned HTTP ${response.status}`};
      throw Object.assign(new Error(`OpenSky returned HTTP ${response.status}`),{status:response.status===429?429:502,retryAfterSeconds:backoff});
    }
    retryState.delete(key);
    const parsed=parseStates(await response.json());
    const snap:Snapshot={source:'live',status:'ok',fetchedAt:new Date().toISOString(),upstreamTime:parsed.time,stale:false,nextRefreshAllowedAt:null,region:{id:key,label:'India viewport',bbox,center:[(south+north)/2,(west+east)/2],zoom:8},aircraft:parsed.aircraft};
    cache.set(key,snap);return snap;
  })();
  inflight.set(key,promise);
  try{return await promise;}catch(error){
    if(!(error as Error&{status?:number}).status){const count=(retryState.get(key)?.count||0)+1,delay=exponentialBackoffMs(count);retryState.set(key,{count,until:Date.now()+delay});nextGlobalRequestAt=Math.max(nextGlobalRequestAt,Date.now()+delay);}
    if(previous)return{...previous,source:'cache',status:'stale',stale:true,nextRefreshAllowedAt:new Date(Math.max(retryState.get(key)?.until||0,nextGlobalRequestAt)).toISOString(),error:error instanceof Error?error.message:'Network error'};
    throw error;
  }finally{inflight.delete(key);}
}

app.get('/api/aircraft',async(req,res)=>{
  const bbox=parseBbox(req.query.bbox);
  if(!bbox)return res.status(400).json({error:'Provide a valid, sufficiently zoomed India viewport bbox=south,west,north,east'});
  const key=`india:${bbox.join(',')}`;
  try{res.json(await(inflight.get(key)||request(bbox,key)));}
  catch(error){const err=error as Error&{status?:number;retryAfterSeconds?:number};if(err.retryAfterSeconds)res.setHeader('Retry-After',String(err.retryAfterSeconds));res.status(err.status||502).json({source:'offline',status:err.status===429?'rate_limited':'upstream_error',error:err.message,retryAfterSeconds:err.retryAfterSeconds||null,region:{id:key,bbox},aircraft:[]});}
});
app.get('/api/health',(_req,res)=>res.json({ok:true,service:'AEROTRACE API'}));
export default app;
if(process.env.VERCEL!=='1')app.listen(port,()=>console.log(`AEROTRACE API listening on ${port}`));
