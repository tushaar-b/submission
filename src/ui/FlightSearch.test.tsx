// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FlightSearch, { FlightSearchErrorBoundary, type FlightSearchProps } from './FlightSearch';
import { searchResponseMatchesQuery, searchThresholdActivated } from '../lib';
import type { FlightSearchResult } from '../lib';

const result: FlightSearchResult = { icao24:'abc123',callsign:'IGO123',originCountry:'India',timePosition:100,lastContact:100,longitude:77,latitude:28,altitudeMeters:9000,onGround:false,velocityMetersPerSecond:200,headingDegrees:90,verticalRateMetersPerSecond:0,geoAltitudeMeters:9000,category:null,freshness:'cached' };
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT=true;
let host: HTMLDivElement;
let root: Root;
beforeEach(()=>{host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();});

function Harness({onSearch=vi.fn(),results=[result],error=null,initialValue=''}:{onSearch?:FlightSearchProps['onSearch'];results?:FlightSearchResult[];error?:string|null;initialValue?:string}) {
  const [value,setValue]=useState(initialValue);
  return <FlightSearch value={value} results={results} open fetching={false} error={error} message="Partial coverage" nextCursor={null} scanned={0} totalPartitions={36} onChange={setValue} onOpen={()=>{}} onClose={()=>{}} onSearch={onSearch} onNext={()=>{}} onSelect={()=>{}}/>;
}
function setInputValue(input:HTMLInputElement,value:string){const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;setter.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));}

describe('FlightSearch input regression',()=>{
  it('keeps the same focused input while typing one through six characters',()=>{
    act(()=>root.render(<Harness/>));const input=host.querySelector('input')!;input.focus();
    for(const value of ['I','IG','IGO','IGOA','IGOAI','IGOAI1'])act(()=>setInputValue(input,value));
    expect(host.querySelector('input')).toBe(input);expect(document.activeElement).toBe(input);expect(input.value).toBe('IGOAI1');expect(host.querySelector('[role="option"]')).not.toBeNull();expect(host.querySelector('form')).toBeNull();
  });
  it('handles pasted text, backspacing, and clearing without losing focus',()=>{
    act(()=>root.render(<Harness/>));const input=host.querySelector('input')!;input.focus();
    act(()=>setInputValue(input,'AIC882'));expect(input.value).toBe('AIC882');
    act(()=>setInputValue(input,'AIC'));expect(input.value).toBe('AIC');expect(document.activeElement).toBe(input);
    act(()=>setInputValue(input,''));expect(input.value).toBe('');expect(document.activeElement).toBe(input);expect(host.querySelector('#flight-search-results')).toBeNull();
  });
  it('activates the explicit search threshold at three characters without searching on keystrokes',()=>{
    expect(['','I','IG','IGO','IGO1','IGO12','IGO123'].map(searchThresholdActivated)).toEqual([false,false,false,true,true,true,true]);
    const onSearch=vi.fn();act(()=>root.render(<Harness onSearch={onSearch}/>));const input=host.querySelector('input')!;input.focus();
    for(const value of ['I','IG','IGO'])act(()=>setInputValue(input,value));expect(onSearch).not.toHaveBeenCalled();
    const enter=new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true});act(()=>input.dispatchEvent(enter));expect(enter.defaultPrevented).toBe(true);expect(onSearch).toHaveBeenCalledWith('IGO');expect(document.activeElement).toBe(input);
  });
  it('shows empty and API failure states without throwing',()=>{
    act(()=>root.render(<Harness results={[]} initialValue="IGO"/>));expect(host.textContent).toContain('No matching cached observation');
    act(()=>root.render(<Harness results={[]} error="OpenSky rate limited this search" initialValue="IGO"/>));expect(host.textContent).toContain('OpenSky rate limited this search');expect(host.querySelector('[role="alert"]')).not.toBeNull();
  });
  it('ignores a late response for a previous query',()=>{
    expect(searchResponseMatchesQuery('AIC','IGO')).toBe(false);expect(searchResponseMatchesQuery('igo',' IGO ')).toBe(true);
  });
  it('reproduces the third-character malformed-row case and safely drops the candidate',()=>{
    const malformed={...result,icao24:undefined as unknown as string};
    act(()=>root.render(<><main>Dashboard remains mounted</main><Harness results={[malformed]} initialValue="IGO"/></>));
    expect(host.textContent).toContain('Dashboard remains mounted');expect(host.textContent).toContain('No matching cached observation');expect(host.textContent).not.toContain('undefined');
  });
  it('contains an unexpected search render error inside the search panel',()=>{
    const Broken=()=>{throw new Error('synthetic search render failure')};const spy=vi.spyOn(console,'error').mockImplementation(()=>{});
    act(()=>root.render(<><main>Dashboard remains mounted</main><FlightSearchErrorBoundary><Broken/></FlightSearchErrorBoundary></>));
    expect(host.textContent).toContain('Dashboard remains mounted');expect(host.textContent).toContain('Flight search is temporarily unavailable');spy.mockRestore();
  });
});
