# AEROTRACE — Airspace Intelligence

A responsive aircraft monitoring dashboard using OpenSky Network state vectors and CARTO Dark Matter raster tiles. The browser calls the same-origin `/api` proxy; optional OpenSky OAuth credentials stay on the server.

## Run locally

Requirements: Node.js 20+ and npm.

```sh
npm install
cp .env.example .env
# Add your CARTO key to VITE_CARTO_API_KEY in .env
npm run dev
```

The UI runs at `http://localhost:5173`; Express runs on `http://localhost:3001`. Anonymous OpenSky requests need no credentials. Optional server credentials are `OPENSKY_CLIENT_ID` and `OPENSKY_CLIENT_SECRET`.

## Environment variables

| Variable | Used by | Purpose |
| --- | --- | --- |
| `VITE_CARTO_API_KEY` | Vite build and browser | Public CARTO raster tile key. It is embedded in the browser bundle and appears in tile request URLs. Configure it in Vercel for Production and Preview, then redeploy. |
| `OPENSKY_CLIENT_ID` | Express / Vercel function | Optional OpenSky OAuth2 client ID. Server only. |
| `OPENSKY_CLIENT_SECRET` | Express / Vercel function | Optional OpenSky OAuth2 client secret. Server only; never use a `VITE_` prefix. |
| `PORT` | Local Express server | Local API port; defaults to `3001`. Vercel assigns its own port. |

`.env` is ignored by Git. Keep OAuth credentials out of browser variables. The CARTO key is a publishable tile key, not a secret.

## Features

- Live OpenSky `/api/states/all` via the server proxy, using bounded presets for Delhi NCR, London, New York, Singapore, and Dubai.
- Interactive CARTO Dark Matter map with CARTO and OpenStreetMap attribution, heading rotated aircraft markers, selection, region recentering, zoom and pan.
- Aircraft profile with ICAO24, callsign, country, barometric/geometric altitude, groundspeed, heading, vertical rate, ground state, position time, and quality.
- Callsign/ICAO search, airborne/ground filter, minimum altitude filter, 60-second polling, refresh and pause controls.
- Position estimates use a great-circle destination calculation from groundspeed, true track and `time_position`. Estimates are capped at 30 seconds, visually labeled ESTIMATED, and never replace observed coordinates or trail points. Older samples are labeled STALE.
- Local movement trails keep up to 40 observations per aircraft, at most 100 aircraft IDs, and a 2-hour age window. Replay has a timestamped slider, play/pause, and 0.5×, 1×, 2× and 4× step speeds. Replay is labeled as local history; it is not historical OpenSky data.
- Configurable altitude and groundspeed above/below alerts, plus enter/leave alerts for a user-defined circular boundary. Settings and up to 100 alert events are stored locally. A transition fires once per state change, not on every polling cycle.
- Aircraft are keyed by ICAO24. New identities and “no longer reported” changes are recorded after successful live snapshots. Missing aircraft remain marked LAST SEEN for two polling cycles; disappearance does not mean confirmed departure or landing.
- Last successful region snapshots are saved locally for offline browsing. Live, cached, offline, demo and replay states are distinct; demo records are labeled simulated.
- Markers are memoized, filtered to the current map viewport, and clustered into clickable groups below zoom 10. Panning does not issue new API requests; prediction refreshes every five seconds without recreating the Leaflet map.

## API and recovery behavior

`GET /api/aircraft?region=delhi` accepts `delhi`, `london`, `newyork`, `singapore`, or `dubai`. It returns normalized state vectors, provenance and timestamps. Invalid regions return HTTP 400. `GET /api/health` reports proxy health.

The Express process shares successful snapshots and in-flight requests by region. It uses a 60-second cache, at least 10 seconds between uncached upstream calls, honors OpenSky rate-limit/`Retry-After` responses, and applies exponential backoff from 15 seconds to five minutes after transient failures. A prior successful snapshot is served with a degraded status when possible. Serverless instances may not share memory; this cache and cooldown are best effort rather than a global quota guarantee.

## Tests and checks

```sh
npm run build
npm test
npm run lint
```

The test suite covers parsing/filters/trails, geodesic prediction and its cap, replay stepping, alert transition deduplication, source labeling, local-history pruning, HTTP-date rate-limit headers, and exponential retry timing.

## Vercel deployment

This project is prepared for Vercel, but it has not been deployed and has no public production URL.

1. Import the `submission` GitHub repository into Vercel.
2. Set `VITE_CARTO_API_KEY` in the project’s Production and Preview environment variables. Set optional `OPENSKY_CLIENT_ID` and `OPENSKY_CLIENT_SECRET` as server environment variables only.
3. Deploy with the included `vercel.json`. Vite outputs the static UI to `dist`; `api/aircraft.ts` and `api/health.ts` export the Express app as Vercel Node functions. The app skips `listen()` when `VERCEL=1`.
4. Verify the deployed UI and `/api/aircraft?region=delhi`. Confirm CARTO tiles load and the source badge reflects the returned data state.

Frontend API calls use relative `/api` URLs. The `localhost:3001` proxy exists only in Vite’s development server configuration, so production browser requests do not target localhost. The CARTO key is build-time and public; configure it before each Vercel build. OpenSky cache, retry state and OAuth token cache are in process and can reset on cold starts or differ between function instances.

## Known limits

- OpenSky anonymous quotas, coverage and availability are upstream controlled. Broad global scans are intentionally not supported.
- Movement history starts when this dashboard observes a position. Local storage may be cleared by the user or browser.
- Replay advances recorded observations by selected step speed; it does not reconstruct continuous historical motion.
- Clusters use a local screen-space grid below zoom 10; individual aircraft markers appear as users zoom in. Dense views at high zoom can still overlap.
- Boundary alerts are circles specified by center latitude/longitude and radius in nautical miles.
- External OpenStreetMap/CARTO tile access requires network connectivity.
