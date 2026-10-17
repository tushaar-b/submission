import { exponentialBackoffMs, retryAfterSeconds } from './resilience.js';
import express from 'express';
import { INDIA_API_BOUNDS, callsignSearchVariants, indiaSearchPartitions, parseIndiaBboxQuery, validSearchQuery } from './india.js';
import { createOpenSkyAuthenticator, OpenSkyAuthError } from './opensky-auth.js';
import { parseStates, type Aircraft } from './states.js';

export const app = express();
const port = Number(process.env.PORT || 3001);
const cache = new Map<string, Snapshot>();
const inflight = new Map<string, Promise<Snapshot>>();
const retryState = new Map<string, { count: number; until: number }>();
const TTL = 60_000;
let nextGlobalRequestAt = 0;
function diagnosticLog(stage:string,details:Record<string,unknown>){
  const alwaysSafe=['token_transport_failure','token_http_failure','token_acquired','states_transport_failure'].includes(stage)||
    (stage==='upstream_response'&&details.status!==200);
  if(alwaysSafe||process.env.AEROTRACE_DIAGNOSTICS==='1')console.info(`[AEROTRACE diagnostics] ${stage} ${JSON.stringify(details)}`);
}
const openskyAuth=createOpenSkyAuthenticator({onDiagnostic:(stage,details)=>diagnosticLog(stage,details)});
function errorType(error:unknown):string{
  if(error instanceof OpenSkyAuthError)return error.kind.startsWith('token_')||error.kind==='credentials'?'authentication_error':'transport_error';
  return 'upstream_error';
}

type Snapshot = { source:'live'|'cache'; status:string; fetchedAt:string; upstreamTime:number|null; stale:boolean; nextRefreshAllowedAt:string|null; region:{id:string;label:string;bbox:number[];center:number[];zoom:number}; aircraft:Aircraft[]; error?:string };

async function request(bbox:[number,number,number,number]|null, key:string, icao24?:string):Promise<Snapshot>{
  const previous=cache.get(key),now=Date.now(),retry=retryState.get(key),wait=Math.max(retry?.until||0,nextGlobalRequestAt);
  if(previous&&now-Date.parse(previous.fetchedAt)<TTL){diagnosticLog('cache_hit',{key,ageMs:now-Date.parse(previous.fetchedAt),states:previous.aircraft.length});return{...previous,source:'cache',status:'ok',stale:false};}
  if(wait>now){if(previous)return{...previous,source:'cache',status:'rate_limited',stale:true,nextRefreshAllowedAt:new Date(wait).toISOString()};throw Object.assign(new Error('OpenSky request cooldown'),{status:429,retryAfterSeconds:Math.ceil((wait-now)/1000)});}
  nextGlobalRequestAt=now+10_000;
  const [south,west,north,east]=bbox||[0,0,0,0];
  const promise=(async()=>{
    diagnosticLog('authentication_mode',{mode:openskyAuth.mode()});
    const params=new URLSearchParams();if(bbox){params.set('lamin',String(south));params.set('lomin',String(west));params.set('lamax',String(north));params.set('lomax',String(east));}if(icao24)params.set('icao24',icao24);
    const url=`https://opensky-network.org/api/states/all?${params.toString()}`;
    let response=await openskyAuth.fetchWithAuth(url,{signal:AbortSignal.timeout(15_000)});
    const responseCategory=response.status===429?'http_429':response.status===401?'http_401':response.status===403?'http_403':response.ok?'success':'http_error';
    diagnosticLog('upstream_response',{key,status:response.status,category:responseCategory,httpDate:response.headers.get('date'),retryAfter:response.headers.get('retry-after'),rateLimitRemaining:response.headers.get('x-rate-limit-remaining')});
    if(!response.ok){
      const delay=retryAfterSeconds(response.headers.get('x-rate-limit-retry-after-seconds'),response.headers.get('retry-after'));
      const count=(retryState.get(key)?.count||0)+1,backoff=response.status===429?delay:exponentialBackoffMs(count);
      retryState.set(key,{count,until:Date.now()+backoff*1000});nextGlobalRequestAt=Math.max(nextGlobalRequestAt,Date.now()+backoff*1000);
      if(previous)return{...previous,source:'cache' as const,status:response.status===429?'rate_limited':'stale',stale:true,nextRefreshAllowedAt:new Date(nextGlobalRequestAt).toISOString(),error:`OpenSky returned HTTP ${response.status}`};
      throw Object.assign(new Error(`OpenSky returned HTTP ${response.status}`),{status:response.status===429?429:502,retryAfterSeconds:backoff});
    }
    retryState.delete(key);
    const raw=await response.json();
    const parsed=parseStates(raw,counts=>diagnosticLog('normalization',{key,...counts}));
    const snap:Snapshot={source:'live',status:'ok',fetchedAt:new Date().toISOString(),upstreamTime:parsed.time,stale:false,nextRefreshAllowedAt:null,region:{id:key,label:icao24?'ICAO24 lookup':'India viewport',bbox:bbox||[],center:bbox?[(south+north)/2,(west+east)/2]:[],zoom:8},aircraft:parsed.aircraft};
    cache.set(key,snap);return snap;
  })();
  inflight.set(key,promise);
  try{return await promise;}catch(error){
    const failure=error as Error&{status?:number;retryAfterSeconds?:number};
    if(failure.status===429&&failure.retryAfterSeconds){const until=Date.now()+failure.retryAfterSeconds*1000;retryState.set(key,{count:(retryState.get(key)?.count||0)+1,until});nextGlobalRequestAt=Math.max(nextGlobalRequestAt,until);}
    else if(!failure.status){const count=(retryState.get(key)?.count||0)+1,delay=exponentialBackoffMs(count);retryState.set(key,{count,until:Date.now()+delay});nextGlobalRequestAt=Math.max(nextGlobalRequestAt,Date.now()+delay);}
    if(previous)return{...previous,source:'cache',status:'stale',stale:true,nextRefreshAllowedAt:new Date(Math.max(retryState.get(key)?.until||0,nextGlobalRequestAt)).toISOString(),error:error instanceof Error?error.message:'Network error'};
    throw error;
  }finally{inflight.delete(key);}
}

app.get('/api/aircraft',async(req,res)=>{
  const bbox=parseIndiaBboxQuery(req.query);
  if(!bbox)return res.status(400).json({source:'offline',status:'invalid_request',error:'Provide a valid, sufficiently zoomed India viewport bbox=south,west,north,east',retryAfterSeconds:null,region:null,aircraft:[]});
  const key=`india:${bbox.join(',')}`;
  try{const pending=inflight.get(key);if(pending)diagnosticLog('request_deduplicated',{key});const snapshot=await(pending||request(bbox,key));diagnosticLog('snapshot_returned',{key,source:snapshot.source,status:snapshot.status,stale:snapshot.stale,returned:snapshot.aircraft.length});res.json(snapshot);}
  catch(error){const err=error as Error&{status?:number;retryAfterSeconds?:number};if(err.retryAfterSeconds)res.setHeader('Retry-After',String(err.retryAfterSeconds));res.status(err.status||502).json({source:'offline',status:err.status===429?'rate_limited':'upstream_error',errorType:errorType(error),error:err.message,retryAfterSeconds:err.retryAfterSeconds||null,region:{id:key,bbox},aircraft:[]});}
});
app.get('/api/aircraft/search',async(req,res)=>{
  const valid=validSearchQuery(req.query.q);if(!valid)return res.status(400).json({error:'Enter a 6-character ICAO24 or a callsign with at least 3 characters.',results:[],exhaustive:false});
  const partitions=indiaSearchPartitions();let cursor=Number(req.query.cursor??0);if(!Number.isInteger(cursor)||cursor<0||cursor>=partitions.length)cursor=0;
  const callsignTerms=valid.kind==='callsign'?callsignSearchVariants(valid.query):[];
  const matches=(rows:Aircraft[])=>rows.filter(a=>{const normalizedCallsign=(a.callsign||'').toUpperCase().replace(/\s+/g,'');const match=valid.kind==='icao24'?a.icao24.toUpperCase()===valid.query:callsignTerms.some(term=>normalizedCallsign.includes(term));if(!match)return false;if(valid.kind==='icao24'&&a.latitude!==null&&a.longitude!==null&&(a.latitude<INDIA_API_BOUNDS.south||a.latitude>INDIA_API_BOUNDS.north||a.longitude<INDIA_API_BOUNDS.west||a.longitude>INDIA_API_BOUNDS.east))return false;return true;});
  const freshness=(a:Aircraft,at:string):'live'|'cached'|'stale'=>{const age=Date.now()-Date.parse(at);return age>TTL?'stale':'cached'};
  const cachedRows=[...cache.values()].flatMap(s=>matches(s.aircraft).map(a=>({...a,freshness:freshness(a,s.fetchedAt)})));
  const unique=(rows:typeof cachedRows)=>[...new Map(rows.sort((a,b)=>(b.timePosition??b.lastContact??0)-(a.timePosition??a.lastContact??0)).map(a=>[a.icao24,a])).values()];
  if(valid.kind==='callsign'&&cachedRows.length&&req.query.next!=='1')return res.json({results:unique(cachedRows),query:valid.query,kind:valid.kind,source:'cache',scanned:0,totalPartitions:partitions.length,nextCursor:cursor,exhaustive:false,message:'Cached observations first. Expand one India sector at a time; results are not exhaustive.'});
  const bbox=valid.kind==='callsign'?partitions[cursor]:null,key=valid.kind==='callsign'?`india:${partitions[cursor].join(',')}`:`icao24:${valid.query.toLowerCase()}`;
  try{const snap=await(inflight.get(key)||request(bbox,key,valid.kind==='icao24'?valid.query.toLowerCase():undefined));const results=unique(matches(snap.aircraft).map(a=>({...a,freshness:(snap.stale?'stale':snap.source==='cache'?'cached':'live') as 'live'|'cached'|'stale'})));const next=valid.kind==='callsign'?(cursor+1<partitions.length?cursor+1:null):null;res.json({results,query:valid.query,kind:valid.kind,source:snap.source,scanned:valid.kind==='callsign'?cursor+1:1,totalPartitions:partitions.length,nextCursor:next,exhaustive:false,message:valid.kind==='callsign'?'One geographic sector checked. Expand another sector to continue; OpenSky coverage is not exhaustive.':'Current OpenSky ICAO24 observation, if available.'});}
  catch(error){const err=error as Error&{status?:number;retryAfterSeconds?:number};if(err.retryAfterSeconds)res.setHeader('Retry-After',String(err.retryAfterSeconds));res.status(err.status||502).json({errorType:errorType(error),error:err.message,results:[],exhaustive:false,retryAfterSeconds:err.retryAfterSeconds||null});}
});
app.get('/api/health',(_req,res)=>res.json({ok:true,service:'AEROTRACE API'}));
export default app;
if(process.env.VERCEL!=='1')app.listen(port,'0.0.0.0',()=>console.log(`AEROTRACE API listening on 0.0.0.0:${port}`));
