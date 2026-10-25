# 🗺️ Google Maps Bootcamp API

> A practical Express.js backend for building location-aware experiences with **Google Maps Platform** and **Gemini**.

Search places, calculate traffic-aware routes, discover useful stops along a trip, find midpoint recommendations, and use Gemini to turn public place reviews into a concise “good place to work?” assessment.

## ✨ What it can do

- **Text search** — find places by a natural-language query.
- **Nearby search** — discover places of a chosen type around coordinates.
- **Place details** — retrieve address, rating, hours, phone number, and reviews.
- **AI review analysis** — ask Gemini for practical pros, cons, and a score for a workplace.
- **Routes** — generate a traffic-aware driving route and encoded polyline.
- **Along-route search** — find places on a planned journey.
- **Detour-aware discovery** — rank stops by their added journey time.
- **Midpoint search** — identify a geographical halfway point, including a distance-aware variant.
- **Road Trip Copilot** — a single endpoint that combines routing, midpoint discovery, stop search, detour calculation, and ranking.

## 🧰 Built with

| Tool | Purpose |
| --- | --- |
| [Express](https://expressjs.com/) | HTTP API server |
| [Google Places API (New)](https://developers.google.com/maps/documentation/places/web-service) | Place discovery and details |
| [Google Routes API](https://developers.google.com/maps/documentation/routes) | Traffic-aware routes and route polylines |
| [Gemini API](https://ai.google.dev/) | Place-review analysis |
| `@googlemaps/polyline-codec` | Route-polyline decoding and midpoint calculations |

## 🚀 Quick start

### 1. Prerequisites

- Node.js **18+** (the API uses Node’s built-in `fetch`)
- A Google Maps Platform API key with **Places API (New)** and **Routes API** enabled
- A Gemini API key

### 2. Install and configure

```bash
npm install
cp .env.example .env
```

Set the values in `.env`:

```env
GOOGLE_MAPS_API_KEY=your_google_maps_api_key
GEMINI_API_KEY=your_gemini_api_key
```

> Keep `.env` private. It is intentionally ignored by Git, so credentials are never pushed to GitHub.

### 3. Start the server

```bash
node server.js
```

The API starts at `http://localhost:3000`; all endpoints are prefixed with `/api`.

## 📍 API reference

All routes are mounted under `/api`. For example, the router path
`/places/search` is available at `http://localhost:3000/api/places/search`.

### Place search and details

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/places/search?query=coffee%20shops%20in%20Delhi` | Search by words or a natural-language phrase |
| `POST` | `/api/places/nearby` | Find places of a given type near a coordinate |
| `GET` | `/api/places/:placeId` | Get ratings, contact details, hours, and reviews |
| `GET` | `/api/places/:placeId/analyze` | Ask Gemini for a concise workplace review analysis |

The text-search endpoint requires a `query` query parameter. The nearby
endpoint accepts `latitude`, `longitude`, `radius` (meters), and `type` in its
JSON body, and returns up to ten results.

```bash
curl 'http://localhost:3000/api/places/search?query=coffee%20shops%20in%20Delhi'
```

Example nearby search:

```bash
curl -X POST http://localhost:3000/api/places/nearby \
  -H 'Content-Type: application/json' \
  -d '{
    "latitude": 28.6139,
    "longitude": 77.2090,
    "radius": 1500,
    "type": "restaurant"
  }'
```

Replace `:placeId` with the Google Place ID. The details endpoint returns
Google's requested place fields under `data`. The analysis endpoint uses the
place's available review text and returns `place` and `analysis`; it is an
AI-generated summary, not a guarantee about an employer.

### Routes and trip planning

| Method | Endpoint | Description |
| --- | --- | --- |
| `POST` | `/api/routes` | Calculate a traffic-aware driving route |
| `POST` | `/api/places/search-along-route` | Search for matching places along a route |
| `POST` | `/api/places/search-along-route-detour` | Filter route stops by estimated extra travel time |
| `POST` | `/api/places/halfway-search` | Search along the route, using its middle vertex as routing origin |
| `POST` | `/api/places/halfway-nearby` | Search in a rectangular area around the middle route vertex |
| `POST` | `/api/places/halfway-by-distance` | Locate a midpoint using the route's distance |
| `POST` | `/api/road-trip/search` | Calculate a route and return ranked stop recommendations |

Start by calling `/api/routes` with `originLat`, `originLng`,
`destinationLat`, and `destinationLng`. Its response contains the encoded
route polyline (`route.polyline.encodedPolyline`), which can be passed to the
route-search endpoints.

| Endpoint | JSON request body |
| --- | --- |
| `/api/routes` | `originLat`, `originLng`, `destinationLat`, `destinationLng` |
| `/api/places/search-along-route` | `query`, `encodedPolyline` |
| `/api/places/search-along-route-detour` | `query`, `encodedPolyline`, `maxDetourMinutes` |
| `/api/places/halfway-search` | `query`, `encodedPolyline` |
| `/api/places/halfway-nearby` | `query`, `encodedPolyline` |
| `/api/places/halfway-by-distance` | `query`, `encodedPolyline`, `distanceMeters` |
| `/api/road-trip/search` | `originLat`, `originLng`, `destinationLat`, `destinationLng`, `query`, `maxDetourMinutes` |

The main response fields are:

| Endpoint | Response data |
| --- | --- |
| `/api/routes` | `route` with distance, duration, and encoded polyline |
| `/api/places/search-along-route` | `places` and `routingSummaries` |
| `/api/places/search-along-route-detour` | `places` with estimated detour minutes and journey percentage |
| `/api/places/halfway-search` | `halfwayPoint`, `places`, and `routingSummaries` |
| `/api/places/halfway-nearby` | `halfwayPoint` and `places` |
| `/api/places/halfway-by-distance` | `halfwayPoint` and `places` |
| `/api/road-trip/search` | `halfwayPoint`, route distance/duration, and scored `places` |

`/api/places/search-along-route` returns matching places and Google's routing
summaries. The halfway endpoints also return the calculated `halfwayPoint`.
The regular halfway search changes the routing origin to that point; the
nearby and distance-based versions restrict the search to a rectangle around
their midpoint.

The detour-search endpoint compares candidate travel times against fixed
sample-route distance and duration values in the implementation. Its detour
estimates therefore should not be treated as route-specific for arbitrary
polylines.

The Road Trip endpoint combines the route, midpoint, and place search in one
request. It returns route distance and duration, the midpoint, and places
filtered by `maxDetourMinutes`. Its ranking score combines Google ratings,
review count, and detour time; places with the highest score appear first.
The score is a simple application heuristic, not a Google rating.

Example Road Trip request:

```bash
curl -X POST http://localhost:3000/api/road-trip/search \
  -H 'Content-Type: application/json' \
  -d '{
    "originLat": 28.6139,
    "originLng": 77.2090,
    "destinationLat": 28.4595,
    "destinationLng": 77.0266,
    "query": "restaurants",
    "maxDetourMinutes": 15
  }'
```

Successful responses generally include `"success": true`. Missing required
fields on the text-search and nearby-search endpoints produce HTTP 400;
Google API errors are returned with the upstream status, and unexpected
server errors produce HTTP 500 with a `message`.

## 🗂️ Project structure

```text
.
├── server.js        # Server entry point (port 3000)
├── src/
│   ├── app.js       # Express configuration and /api route mounting
│   └── route.js     # Maps, Places, Gemini, and trip-planning endpoints
├── .env.example     # Required environment variable names
└── package.json
```

## 🔐 API and billing notes

Google Maps Platform services can incur charges. Restrict your Maps API key by API and application, set budget alerts, and never expose either key in client-side code or commits. See Google’s [API security best practices](https://developers.google.com/maps/api-security-best-practices).

## 📄 License

This project currently uses the [ISC License](https://opensource.org/licenses/ISC).
