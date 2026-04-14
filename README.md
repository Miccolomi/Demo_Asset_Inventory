# Company Digital Twin — MongoDB Asset Management Demo

A single-page application showcasing MongoDB capabilities for managing high-voltage power grid infrastructure. The app simulates a **Digital Twin** of the Italian National Transmission Grid (RTN), modelling 10,000 transmission towers along the real Bologna–Reggio Calabria backbone route.

Built as a Proof of Value to demonstrate MongoDB in action: geospatial queries, aggregation pipelines, Atlas Search (full-text), and Vector Search — all on-premises, no external cloud services required.

---

## What it does

The application loads a dataset of 10,000 transmission towers distributed across 7 Italian regions (Emilia-Romagna, Tuscany, Umbria, Lazio, Campania, Basilicata, Calabria), each linked to an IoT sensor box, a cable segment control unit, and a line-level control unit.

A **Monitor** tab exposes 11 live MongoDB queries, each showcasing a different feature:

| Query | Description | MongoDB Feature |
|---|---|---|
| A | Global KPI dashboard | `$facet` (4 aggregations in one round-trip) |
| B | Towers under maintenance near a city | `$near` + `2dsphere` index |
| C | IoT alerts and low battery sensors | `$lookup` cross-collection join |
| D | Average cable temperature by region | `$group` + `$avg` + `$cond` |
| E | Double-risk towers (tower + adjacent cable both critical) | `$lookup` with embedded pipeline |
| F | End-to-end line health | 3-collection join (DigiL → DigiC → towers) |
| G | Regional stress index | Cross-collection `$group` + `$lookup` |
| H | IoT out-of-threshold + hottest adjacent cable | Dual `$lookup` pipeline, multi-sensor correlation |
| I | Full-text fuzzy search | Atlas Search, `lucene.italian` analyzer, fuzzy matching |
| J | Semantic / natural language search | Vector Search (`$vectorSearch`, cosine similarity) + LLM response via Ollama |
| K | Electrical chain traversal from a tower | `$graphLookup` — native graph traversal, no dedicated graph DB needed |

Query K lets you click any tower on the map (or type a tower code), set a hop count, and MongoDB traverses the cable network forward through `digic_box` segments using `$graphLookup`. Results render as a hop-by-hop table and a **polyline drawn on the map** connecting the chain of towers.

All query results are rendered both in a table and on an interactive **Leaflet map**, with automatic `fitBounds` on the result set.

An **Anagrafica** tab provides full CRUD on the tower registry with pagination and live text search. Selecting a tower also shows a **connected assets panel**: the mounted IoT Box (battery, telemetry, alarms), adjacent cable segments (DigiC), and the regional power line (DigiL) — fetched in a single backend call.

---

## Stack

| Layer | Technology |
|---|---|
| Database | MongoDB (replica set, Atlas Search, Vector Search) |
| Backend | Node.js + Express.js + Mongoose |
| Frontend | Vanilla JS + HTML + CSS (no build step) |
| Maps | Leaflet.js |
| Embeddings | Ollama — `nomic-embed-text` (768-dim) |
| LLM | Ollama — `llama3.2` |

---

## Data model (4 collections)

- **`tralicci`** — physical towers: GeoJSON location, type, voltage, region, operational status, installation year, text description, 768-dim embedding
- **`aggetto_iot_box`** — one IoT sensor per tower: battery level, active alarms, telemetry (temperature, humidity, vibration Hz)
- **`digic_box`** — one cable segment per consecutive tower pair: cable temperature, current, status
- **`digil_box`** — one line controller per region: power MW, availability %, status

---

## Setup

### Prerequisites
- Node.js ≥ 18
- MongoDB with a replica set (Atlas free tier M0 or local)
- Ollama running locally with two models pulled:
  ```bash
  ollama pull nomic-embed-text
  ollama pull llama3.2
  ```

### Install
```bash
cd backend
npm install
```

### Configure
Create `backend/.env`:
```
MONGODB_URI=<your_connection_string>
PORT=3001
OLLAMA_URL=http://localhost:11434
OLLAMA_CHAT_MODEL=llama3.2
```

### Run
```bash
node server.js
```
Open [http://localhost:3001](http://localhost:3001) in your browser.

On first launch, go to the **Admin** tab and click **"Inizializza Database"** to seed the dataset. The seed process generates 10,000 towers with unique descriptions and vector embeddings (takes a few minutes due to Ollama embedding generation).
