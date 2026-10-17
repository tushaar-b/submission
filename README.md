# AEROTRACE — Airspace Intelligence

A responsive India-wide aircraft monitoring dashboard using OpenSky Network state vectors and CARTO Dark Matter raster tiles. The browser calls a same-origin API proxy; optional OpenSky OAuth credentials stay on the server.

## Run locally

Requirements: Node.js 20+ and npm.

```sh
npm install
cp .env.example .env
# Set VITE_CARTO_API_KEY in .env to your CARTO raster basemap key
npm run dev
```

The dashboard is at `http://localhost:5173`; the Express proxy listens on `http://localhost:3001`. Use `npm run dev` to start both services together. Running Vite alone does not start the API and returns a descriptive JSON 502 from the local proxy. Anonymous OpenSky requests need no credentials. Optional credentials are `OPENSKY_CLIENT_ID` and `OPENSKY_CLIENT_SECRET`.

## Environment variables

| Variable | Used by | Purpose |
| --- | --- | --- |
| `VITE_CARTO_API_KEY` | Vite build and browser | Publishable CARTO raster tile key, embedded into tile URLs. Configure it in Vercel before building. |
| `OPENSKY_CLIENT_ID` | Express / Vercel function | Optional OpenSky OAuth2 client ID; server only. |
| `OPENSKY_CLIENT_SECRET` | Express / Vercel function | Optional OpenSky OAuth2 client secret; server only and never use a `VITE_` prefix. |
| `PORT` | Local Express server | Local API port; defaults to `3001`. Vercel assigns its own port. |

`.env` is ignored by Git. The CARTO key is a browser-visible tile key; protect OpenSky credentials as server secrets.

## Features

- India-wide exploration bounded approximately by 6.4–35.7° N and 68.1–97.5° E. Choose Delhi, Mumbai, Bengaluru, Chennai, Hyderabad, Kolkata, Ahmedabad, Pune, Kochi, or Guwahati to recenter the map.
- Once zoomed in (level 6 minimum, with a viewport no wider than 10 degrees), the dashboard requests live aircraft for the visible map viewport. Panning and zooming debounce requests by 900 ms; the viewport is clipped to India's approximate bounds and rounded to quarter-degree cache cells. Views outside India, too broad, or zoomed out return no live query.
- The endpoint accepts `GET /api/aircraft?bbox=south,west,north,east`. Bounds must be valid, within India, and no wider than 10° in either dimension. Invalid or overly broad queries return HTTP 400. `GET /api/health` reports proxy health.
- Interactive CARTO Dark Matter map with CARTO and OpenStreetMap attribution, heading-rotated aircraft markers, selection, city recentering, zoom, and pan.
- Aircraft profiles include ICAO24, callsign, country, barometric/geometric altitude, groundspeed, heading, vertical rate, ground state, position time, and data quality.
- Pan-India flight discovery is independent of regional monitoring. Callsign typing checks local observations only; an explicit search checks cached server observations first and then one bounded India sector at a time. ICAO24 searches use OpenSky identifier filtering. Results show live, cached, or stale freshness and selecting a located result flies to it without changing the selected monitoring region. OpenSky coverage is partial and search results are not exhaustive. Regional filters remain scoped to the loaded monitoring viewport.
- Airborne/ground and minimum-altitude filters, 60-second regional polling, manual refresh, and pause controls.
- Position estimates use a great-circle destination calculation from groundspeed, track, and `time_position`. Estimates are capped at 30 seconds, visually labeled ESTIMATED, and never replace observed coordinates or trail points. Older samples are labeled STALE.
- Local movement trails retain up to 40 observations per aircraft, at most 100 aircraft IDs, and a two-hour age window. Replay has a timestamped slider, play/pause, and 0.5×, 1×, 2× and 4× speeds. Replay is local history, not historical OpenSky data.
- Configurable altitude and groundspeed above/below alerts, plus enter/leave alerts for a user-defined circular boundary. Settings and up to 100 alert events are stored locally; a transition fires once per state change.
- Aircraft visibility changes are tracked within a stable viewport query only. When a new viewport query is used, the disappearance baseline resets, so panning does not incorrectly report aircraft as having left. “No longer reported” does not mean confirmed departure or landing.
- Last successful viewport snapshots are saved locally for offline browsing. Live, cached, offline, rate-limited, demo and replay states are distinct; demo records are labeled simulated.
- Every valid aircraft is rendered as its own memoized, heading-rotated airplane marker at its true coordinates. Markers are filtered to the visible viewport; overlapping icons rise on hover and selected markers rise above nearby markers. No marker clustering or coordinate offsets are used. Prediction refreshes every five seconds without recreating the Leaflet map.

## API and recovery behavior

The Express proxy and Vercel Node function share the same implementation. Regional snapshots and in-flight requests are cached/deduplicated by the normalized viewport bbox for 60 seconds. Nationwide callsign search checks those cached observations first, then allows one explicitly requested geographic partition per search action (36 bounded partitions cover approximate India); results state how many sectors were checked and never claim exhaustive coverage. ICAO24 lookup asks OpenSky for the identifier directly. Uncached upstream calls have a global minimum 10-second gap per process; OpenSky `Retry-After` / rate-limit headers are honored and transient failures use exponential backoff up to five minutes. A prior successful snapshot for that viewport is returned with a degraded status when possible. Serverless instances can have separate memory and cold starts, so process-local caching is best effort, not a global quota guarantee.

## Checks

```sh
npm run build
npm test
npm run lint
```

Tests cover filters, trails, India viewport clipping/zoom eligibility, search normalization, freshness/error parsing, bounded search partitions, individual overlapping markers at actual coordinates, geodesic prediction and its cap, replay stepping, alerts, status labeling, history pruning, retry headers, and exponential backoff.

## Deploy to Vercel

The project includes `vercel.json` and serverless Express handlers at `api/aircraft.ts` and `api/health.ts`. It is deployment-ready, but deployment is not complete until a public URL is deployed and verified.

1. Push this repository's `main` branch to GitHub.
2. In Vercel, choose **Add New → Project**, import the `submission` repository, and select the `main` production branch.
3. Keep the project root directory at the repository root. Use the detected Vite settings or confirm Build Command `npm run build`, Output Directory `dist`, and Install Command `npm install`.
4. In **Project Settings → Environment Variables**, add `VITE_CARTO_API_KEY` with the CARTO key for **Production** and **Preview** (and Development if using Vercel's local environment pull). This `VITE_` value is public and is embedded during the build.
5. Optionally add `OPENSKY_CLIENT_ID` and `OPENSKY_CLIENT_SECRET` for **Production** and **Preview**. These values are read only by the server-side proxy; never prefix them with `VITE_`.
6. Save the variables, then deploy `main` from the Vercel Deployments page. Environment variable changes require a new deployment.
7. Open the resulting `https://…vercel.app` URL. Confirm the CARTO Dark Matter tiles load with attribution and no key-required watermark. Select a city, wait for its viewport request, and verify aircraft counts/markers update. Pan to another compact Indian viewport and verify the aircraft list/map changes after the debounce.
8. Verify `https://…vercel.app/api/health` returns `{ "ok": true, "service": "AEROTRACE API" }` and `https://…vercel.app/api/aircraft?bbox=27,76,29,79` returns a JSON snapshot with `source: "live"` (or a clearly labeled cached/degraded status when OpenSky is temporarily unavailable). Confirm an outside-India or invalid bbox returns HTTP 400.
9. In browser developer tools, check that API requests use the deployed host and that CARTO raster requests include the configured `key` query parameter. The frontend uses relative `/api` paths; it does not target localhost in production.

## Known limits

- OpenSky coverage, anonymous quota, availability, and refresh rate are controlled upstream. Callsign discovery checks one partition per explicit action and can miss aircraft until more sectors are searched; OpenSky does not provide an exhaustive India-wide callsign index. Exact ICAO24 searches are also limited to OpenSky current-state availability.
- Position history starts when this dashboard observes an aircraft. Browser storage can be cleared, and no server-side historical archive is provided.
- Replay advances recorded observations by selected step speed; it does not reconstruct continuous historical motion.
- Boundary alerts are circles specified by center latitude/longitude and radius in nautical miles.
- Vercel serverless instances may not share cache, retry, or OAuth token memory. If consistent quota enforcement across instances is needed, add shared storage or a centralized rate limiter.
- External CARTO / OpenStreetMap tile access requires network connectivity.
