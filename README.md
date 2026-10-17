# AEROTRACE — Airspace Intelligence

A dark, responsive aircraft monitoring dashboard powered by the OpenSky Network state vector API. The client talks only to the local Express proxy; optional OpenSky OAuth credentials stay on the server. Anonymous access works without credentials, subject to OpenSky availability and quotas.

## Run locally

Requirements: Node.js 20 or newer and npm.

```sh
npm install
cp .env.example .env
npm run dev
```

Vite serves the dashboard at `http://localhost:5173`; the API proxy runs on port 3001. `.env` is optional. Set `OPENSKY_CLIENT_ID` and `OPENSKY_CLIENT_SECRET` there only if you have an OpenSky OAuth2 client. Never prefix server secrets with `VITE_`.

## Features

- Live OpenSky `/api/states/all` data via a server controlled proxy, with Delhi NCR, London, New York, Singapore and Dubai regions.
- Interactive Leaflet map, heading rotated aircraft markers, aircraft selection and a live profile with altitude, speed, heading, vertical rate, country and reported position.
- Callsign/ICAO24 search, airborne/ground filters, minimum altitude filter, 60 second polling, pause and refresh controls.
- Explicit demo mode with clearly marked simulated sample positions; demo records are never reported as live.
- Server TTL caching and in-flight request sharing per region. A 429 cooldown honors upstream retry headers. When an upstream call fails after a successful call, the last good snapshot is returned as stale/cached.
- The client retains up to 40 locally observed position samples per aircraft in localStorage and draws the selected aircraft's trail. History starts when this dashboard is opened and is not OpenSky historical track data.
- OpenStreetMap/CARTO dark tiles with attribution.

## Commands

```sh
npm run dev       # Vite + Express
npm run build     # TypeScript and production Vite build
npm test          # Vitest utility tests
npm run lint      # TypeScript check
```

## API

`GET /api/aircraft?region=delhi` (also `london`, `newyork`, `singapore`, `dubai`) returns a normalized envelope with source, status, timestamp, region and aircraft array. Invalid region IDs receive HTTP 400. Upstream errors return a typed error response; a previous successful region snapshot is retained and served with a degraded status whenever available. `GET /api/health` reports proxy health.

OpenSky nullable fields remain null. Coordinates are validated and unit conversion happens in the display layer (metres to feet, metres/second to knots). ICAO24 identifies an aircraft; callsign is not treated as a stable ID.

## Operational limitations

- OpenSky anonymous quotas, rate limits, connectivity and coverage are controlled upstream. The in-process cache/cooldown is shared by clients using one server process, not across horizontally scaled instances.
- Client refresh runs every 60 seconds and can be paused. Server cache TTL is 60 seconds. Bounding boxes are intentionally regional; map panning does not trigger API requests.
- Aircraft are reconciled by ICAO24. When an aircraft is absent from a successful upstream snapshot, the last position remains in the list as LAST SEEN for two successful polling cycles, then is removed from active tracking. This is not evidence of landing or confirmed departure. Trails are recorded in the browser only when distinct upstream positions arrive.
- Demo mode uses recorded sample-like data with simulated movement and must not be used as live airspace information.
- Production deployment needs a Node host for `server/index.ts` and a static host or reverse proxy for the Vite build, with `/api` routed to the Node service. The included dev proxy is not a production hosting configuration.
- External map tiles require internet access; OpenSky and map tile availability are independent.
