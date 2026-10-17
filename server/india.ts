export const INDIA_API_BOUNDS={south:6.4,west:68.1,north:35.7,east:97.5};
export type IndiaBbox=[number,number,number,number];

export function indiaSearchPartitions():IndiaBbox[]{const boxes:IndiaBbox[]=[];for(let south=INDIA_API_BOUNDS.south;south<INDIA_API_BOUNDS.north;south+=5)for(let west=INDIA_API_BOUNDS.west;west<INDIA_API_BOUNDS.east;west+=5)boxes.push([south,west,Math.min(south+5,INDIA_API_BOUNDS.north),Math.min(west+5,INDIA_API_BOUNDS.east)]);return boxes;}

export function validSearchQuery(value:unknown):{query:string;kind:'icao24'|'callsign'}|null{if(typeof value!=='string')return null;const query=value.trim().toUpperCase().replace(/\s+/g,'');if(/^[0-9A-F]{6}$/.test(query))return{query,kind:'icao24'};if(query.length>=3&&query.length<=8&&/^[A-Z0-9-]+$/.test(query))return{query,kind:'callsign'};return null;}
export function callsignSearchVariants(query:string){const q=query.trim().toUpperCase().replace(/\s+/g,'');if(/^AI\d/.test(q))return[q,`AIC${q.slice(2)}`];if(/^AIC\d/.test(q))return[q,`AI${q.slice(3)}`];return[q];}

export function parseIndiaBbox(value:unknown):IndiaBbox|null{
  if(typeof value!=='string')return null;
  const values=value.split(',').map(Number);
  if(values.length!==4||values.some(v=>!Number.isFinite(v)))return null;
  const[south,west,north,east]=values;
  if(south<INDIA_API_BOUNDS.south||west<INDIA_API_BOUNDS.west||north>INDIA_API_BOUNDS.north||east>INDIA_API_BOUNDS.east||south>=north||west>=east||north-south>10||east-west>10)return null;
  return[south,west,north,east];
}
export function parseIndiaBboxQuery(query:{bbox?:unknown;lamin?:unknown;lomin?:unknown;lamax?:unknown;lomax?:unknown}):IndiaBbox|null{
  if(typeof query.bbox==='string')return parseIndiaBbox(query.bbox);
  const bounds=[query.lamin,query.lomin,query.lamax,query.lomax];
  if(bounds.some(value=>typeof value!=='string'||value.trim()===''))return null;
  return parseIndiaBbox(bounds.join(','));
}
