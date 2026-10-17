import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Search } from 'lucide-react';
import { isAircraftSearchResult, searchThresholdActivated } from '../lib';
import type { FlightSearchResult } from '../lib';

export type FlightSearchProps = {
  value: string;
  results: FlightSearchResult[];
  open: boolean;
  fetching: boolean;
  error: string | null;
  message: string;
  nextCursor: number | null;
  scanned: number;
  totalPartitions: number;
  onChange: (value: string) => void;
  onOpen: () => void;
  onClose: () => void;
  onSearch: (value: string) => void;
  onNext: () => void;
  onSelect: (result: FlightSearchResult) => void;
};

export class FlightSearchErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, _info: ErrorInfo) { console.error('Flight search UI failed safely:', error); }
  render() {
    if (this.state.failed) return <div className="search-message error" role="alert">Flight search is temporarily unavailable. <button type="button" onClick={() => this.setState({ failed: false })}>Retry</button></div>;
    return this.props.children;
  }
}

function FlightSearchContent(props: FlightSearchProps) {
  const submit = () => { if (searchThresholdActivated(props.value)) props.onSearch(props.value); };
  const safeResults = Array.isArray(props.results) ? props.results.filter(isAircraftSearchResult) : [];
  const hasQuery = props.value.trim().length > 0;
  const canExpand = searchThresholdActivated(props.value) && props.nextCursor !== null;
  return <>
    <label className="field-label search-label" htmlFor="search">Search Flights Across India</label>
    <div className="search-wrap">
      <Search size={15}/>
      <input id="search" value={props.value} onFocus={props.onOpen} onChange={event => props.onChange(event.currentTarget.value)} onKeyDown={event => {
        if (event.key === 'Enter') { event.preventDefault(); submit(); }
        if (event.key === 'Escape') props.onClose();
      }} placeholder="Callsign or ICAO24" aria-label="Search flights across India" aria-controls="flight-search-results" aria-expanded={props.open&&hasQuery}/>
      <span className="search-scope">INDIA-WIDE</span>
      <button type="button" className="search-submit" onClick={submit} aria-label="Search India" disabled={!searchThresholdActivated(props.value)}><Search size={14}/></button>
    </div>
    {props.open&&hasQuery&&<div className="search-results" id="flight-search-results" role="listbox" aria-label="India-wide flight search results">
      {props.fetching&&<div className="search-message" role="status">Checking cached observations and one India sector…</div>}
      {props.error&&<div className="search-message error" role="alert">{props.error}</div>}
      {safeResults.map(result=><button type="button" role="option" aria-selected="false" key={result.icao24} className="search-result" onClick={()=>props.onSelect(result)}>
        <span><b>{result.callsign||'Unknown callsign'}</b><small>{result.icao24.toUpperCase()} · {result.altitudeMeters===null?'Altitude —':`${Math.round(result.altitudeMeters*3.28084).toLocaleString()} ft`}</small></span>
        <span><em className={`freshness ${result.freshness}`}>{result.freshness}</em><small>{(result.timePosition??result.lastContact)!==null?new Date((result.timePosition??result.lastContact)!*1000).toLocaleTimeString('en-GB',{timeZone:'UTC'})+'Z':'Time —'}</small></span>
      </button>)}
      {!safeResults.length&&!props.fetching&&!props.error&&<div className="search-message">No matching cached observation yet. Search an India sector.</div>}
      {canExpand&&<button type="button" className="search-more" onClick={props.onNext}>Search next India sector · {props.scanned}/{props.totalPartitions}</button>}
      <small className="search-limit">{props.message||'India-wide discovery is partial and depends on OpenSky coverage.'}</small>
    </div>}
  </>;
}

export default function FlightSearch(props: FlightSearchProps) {
  return <FlightSearchErrorBoundary><FlightSearchContent {...props}/></FlightSearchErrorBoundary>;
}
