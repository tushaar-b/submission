export const INDIA_API_BOUNDS={south:6.4,west:68.1,north:35.7,east:97.5};
export type IndiaBbox=[number,number,number,number];

export function parseIndiaBbox(value:unknown):IndiaBbox|null{
  if(typeof value!=='string')return null;
  const values=value.split(',').map(Number);
  if(values.length!==4||values.some(v=>!Number.isFinite(v)))return null;
  const[south,west,north,east]=values;
  if(south<INDIA_API_BOUNDS.south||west<INDIA_API_BOUNDS.west||north>INDIA_API_BOUNDS.north||east>INDIA_API_BOUNDS.east||south>=north||west>=east||north-south>10||east-west>10)return null;
  return[south,west,north,east];
}
