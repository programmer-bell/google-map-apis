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

### Places

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/places/search?query=coffee%20shops%20in%20Delhi` | Search for places by text |
| `POST` | `/api/places/nearby` | Find places near coordinates |
| `GET` | `/api/places/:placeId` | Retrieve detailed place information |
| `GET` | `/api/places/:placeId/analyze` | Analyze reviews with Gemini |

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

### Routes and trip planning

| Method | Endpoint | Description |
| --- | --- | --- |
| `POST` | `/api/routes` | Get a traffic-aware driving route |
| `POST` | `/api/places/search-along-route` | Search for places along an encoded route polyline |
| `POST` | `/api/places/search-along-route-detour` | Return stops filtered and sorted by detour time |
| `POST` | `/api/places/halfway-search` | Search along a route around its midpoint |
| `POST` | `/api/places/halfway-nearby` | Search within a bounding area around the midpoint |
| `POST` | `/api/places/halfway-by-distance` | Find a midpoint using total route distance |
| `POST` | `/api/road-trip/search` | Full road-trip recommendation workflow |

Example Road Trip Copilot request:

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

The response includes the route’s halfway point, distance and duration, plus recommendations ranked by a blend of rating, review count, and detour time.

## 🗂️ Project structure

```text
.
├── server.js        # Server entry point (port 3000)
├── src/
│   ├── app.js       # Express configuration
│   └── routes.js    # Maps, Places, Gemini, and trip-planning endpoints
├── .env.example     # Required environment variable names
└── package.json
```

## 🔐 API and billing notes

Google Maps Platform services can incur charges. Restrict your Maps API key by API and application, set budget alerts, and never expose either key in client-side code or commits. See Google’s [API security best practices](https://developers.google.com/maps/api-security-best-practices).

## 📄 License

This project currently uses the [ISC License](https://opensource.org/licenses/ISC).
