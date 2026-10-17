export type Aircraft={icao24:string;callsign:string|null;originCountry:string|null;timePosition:number|null;lastContact:number|null;longitude:number|null;latitude:number|null;altitudeMeters:number|null;onGround:boolean|null;velocityMetersPerSecond:number|null;headingDegrees:number|null;verticalRateMetersPerSecond:number|null;geoAltitudeMeters:number|null;category:number|null};
export type StateNormalizationDiagnostics={rawStates:number;normalizedStates:number;validCoordinates:number;missingCoordinates:number;invalidCoordinateRanges:number;droppedMalformedRows:number};
const num=(value:unknown):number|null=>typeof value==='number'&&Number.isFinite(value)?value:null;
export function parseStates(body:unknown,onDiagnostics?:(details:StateNormalizationDiagnostics)=>void):{time:number|null;aircraft:Aircraft[]}{
  const response=body as {time?:unknown;states?:unknown},states=Array.isArray(response?.states)?response.states:[];
  const diagnostics:StateNormalizationDiagnostics={rawStates:states.length,normalizedStates:0,validCoordinates:0,missingCoordinates:0,invalidCoordinateRanges:0,droppedMalformedRows:0};
  const aircraft=states.flatMap((row):Aircraft[]=>{
    if(!Array.isArray(row)||typeof row[0]!=='string'||!row[0].trim()){diagnostics.droppedMalformedRows++;return[];}
    const latitude=num(row[6]),longitude=num(row[5]);
    const validLatitude=latitude!==null&&latitude>=-90&&latitude<=90,validLongitude=longitude!==null&&longitude>=-180&&longitude<=180;
    if(validLatitude&&validLongitude)diagnostics.validCoordinates++;else if(latitude===null||longitude===null)diagnostics.missingCoordinates++;else diagnostics.invalidCoordinateRanges++;
    diagnostics.normalizedStates++;
    return[{icao24:row[0].toLowerCase(),callsign:typeof row[1]==='string'?row[1].trim()||null:null,originCountry:typeof row[2]==='string'?row[2]:null,timePosition:num(row[3]),lastContact:num(row[4]),longitude:validLongitude?longitude:null,latitude:validLatitude?latitude:null,altitudeMeters:num(row[7]),onGround:typeof row[8]==='boolean'?row[8]:null,velocityMetersPerSecond:num(row[9]),headingDegrees:num(row[10]),verticalRateMetersPerSecond:num(row[11]),geoAltitudeMeters:num(row[13]),category:num(row[17])}];
  });
  onDiagnostics?.(diagnostics);
  return{time:num(response?.time),aircraft};
}
