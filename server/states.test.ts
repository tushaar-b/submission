import {describe,expect,it} from 'vitest';
import {parseStates,type StateNormalizationDiagnostics} from './states';

const row=(icao24:string,longitude:unknown,latitude:unknown)=>[icao24,'AIC2483','India',1_700_000_000,1_700_000_000,longitude,latitude,10_000,false,220,90,0,null,10_100,null,false,0,null];

describe('OpenSky state normalization',()=>{
  it('counts malformed, missing-position, invalid-range, and drawable states without discarding state metadata',()=>{
    let diagnostic:StateNormalizationDiagnostics|undefined;
    const result=parseStates({time:1_700_000_000,states:[row('abc123',77,28),row('abc124',null,null),row('abc125',77,95),null]},value=>{diagnostic=value;});
    expect(result.aircraft).toHaveLength(3);
    expect(result.aircraft[0]).toMatchObject({icao24:'abc123',callsign:'AIC2483',longitude:77,latitude:28});
    expect(result.aircraft[1]).toMatchObject({longitude:null,latitude:null});
    expect(result.aircraft[2]).toMatchObject({longitude:77,latitude:null});
    expect(diagnostic).toEqual({rawStates:4,normalizedStates:3,validCoordinates:1,missingCoordinates:1,invalidCoordinateRanges:1,droppedMalformedRows:1});
  });
});
