# Terna Asset Management — Digital Twin Demo
## Istruzioni per Claude Code

---

## Obiettivo del Progetto
Demo SPA per mostrare le capacità di MongoDB nella gestione di infrastrutture elettriche (Smart Grid). L'app simula un "Digital Twin" di tralicci ad alta tensione con IoT Box per la telemetria, lungo una tratta reale dell'appennino italiano.

**Scopo principale:** far vedere MongoDB in azione (geospaziale, aggregation pipeline, lookup), non costruire un prodotto. Tieni tutto semplice.

---

## Stack Tecnologico
| Layer | Tecnologia | Note |
|---|---|---|
| Database | MongoDB Atlas (o locale) | Stringa di connessione via `.env` |
| Backend | Node.js + Express.js | Mongoose per i modelli |
| Frontend | **Vanilla JS + HTML + CSS** | No React, no build step. SPA con fetch() |
| Mappe | Leaflet.js (CDN) | |
| Stile | Tailwind CSS (CDN) | |

> **Perché Vanilla JS:** È una demo, non un prodotto. Nessun `npm run build`, nessuna configurazione webpack. Il browser carica direttamente `index.html` puntando al backend Express.

---

## Struttura Cartelle

```
/
├── backend/
│   ├── server.js            # Entry point Express
│   ├── .env                 # MONGODB_URI, PORT
│   ├── models/
│   │   ├── Traliccio.js
│   │   ├── AggettIoTBox.js
│   │   ├── DigiCBox.js
│   │   └── DigiLBox.js
│   └── routes/
│       ├── seed.js          # POST /api/seed
│       └── queries.js       # GET /api/query/*
├── frontend/
│   ├── index.html           # Tutto il markup SPA
│   ├── app.js               # Logica JS (fetch, Leaflet, tab switching)
│   └── style.css            # Override minimi su Tailwind
└── package.json             # Solo dipendenze backend
```

---

## Struttura del Database (4 Collections)

### 1. `tralicci`
Sostegni fisici della linea elettrica.
```js
{
  codice: String,           // es. "TRL-042"
  nome: String,             // es. "Traliccio Appennino Nord 42"
  tipologia: String,        // "Monostelo" | "Traliccio a portale" | "Traliccio a Y"
  tensione_kv: Number,      // 132 | 220 | 380
  regione: String,          // "Lazio" | "Campania" | "Toscana" ecc.
  stato_operativo: String,  // "attivo" | "in_manutenzione" | "fuori_servizio"
  anno_installazione: Number,
  gis_location: {           // GeoJSON — OBBLIGATORIO per indice 2dsphere
    type: "Point",
    coordinates: [lng, lat] // Attenzione: longitude PRIMA di latitude (standard GeoJSON)
  }
}
// Indice: { gis_location: "2dsphere" }
```

### 2. `aggetto_iot_box`
Sensori montati su ogni traliccio.
```js
{
  codice: String,                    // es. "IOT-042"
  traliccio_collegato_id: ObjectId,  // ref -> tralicci
  firmware_version: String,
  livello_batteria: Number,          // 0-100 (%)
  ultimo_segnale: Date,
  allarmi_attivi: [String],          // es. ["VIBRAZIONE", "TEMP_ALTA"]
  telemetria: {
    temperatura_celsius: Number,
    umidita_percentuale: Number,
    vibrazione_hz: Number
  }
}
```

### 3. `digic_box`
Box di controllo per una tratta di cavo (segmento tra due tralicci consecutivi).
```js
{
  codice: String,                 // es. "DIGIC-009"
  traliccio_da_id: ObjectId,      // ref -> tralicci
  traliccio_a_id: ObjectId,       // ref -> tralicci
  regione: String,
  lunghezza_km: Number,
  tensione_kv: Number,
  temperatura_cavo_celsius: Number,
  corrente_ampere: Number,
  stato: String                   // "normale" | "sovraccarico" | "guasto"
}
```

### 4. `digil_box`
Box di controllo per una linea intera (aggregazione di più tratte).
```js
{
  codice: String,               // es. "DIGIL-001"
  nome_linea: String,           // es. "Linea 380kV Roma-Napoli"
  regioni_attraversate: [String],
  numero_tralicci: Number,
  numero_tratte: Number,
  potenza_mw: Number,
  disponibilita_percentuale: Number, // uptime
  stato: String                 // "operativa" | "limitata" | "fuori_servizio"
}
```

---

## Dati di Seed

### Rotta Simulata
Genera **30 tralicci** lungo la tratta appenninica **Firenze → Roma → Napoli** (autostrada A1, dorsale elettrica reale).

Coordinate di riferimento per la rotta (interpola linearmente tra questi punti):
- Firenze: `[11.2558, 43.7696]`
- Arezzo: `[11.8817, 43.4636]`
- Orvieto: `[12.1097, 42.7189]`
- Roma Nord: `[12.4964, 41.9028]`
- Frosinone: `[13.3535, 41.6401]`
- Caserta: `[14.3328, 41.0736]`
- Napoli: `[14.2681, 40.8518]`

Aggiungi offset random `±0.05°` a ogni traliccio per realismo.

### Distribuzione stati operativi (random pesato):
- 70% `attivo`
- 20% `in_manutenzione`
- 10% `fuori_servizio`

### DigiC Box: crea una tratta ogni 2 tralicci consecutivi (29 tratte totali).

### DigiL Box: crea 2 linee (una per il tratto nord, una per il sud).

---

## API Backend

### Seed
```
POST /api/seed
```
Svuota le 4 collection con `deleteMany({})` e ri-popola. Risponde con:
```json
{
  "success": true,
  "counts": {
    "tralicci": 30,
    "iot_boxes": 30,
    "digic_boxes": 29,
    "digil_boxes": 2
  }
}
```

### Query MongoDB (showcase)
```
GET /api/query/geo          → Query A: Geospaziale ($near)
GET /api/query/allarmi      → Query B: Aggregation + $lookup
GET /api/query/stats-cavi   → Query C: $group + $avg per regione
GET /api/query/kpi-linea    → Query D: $facet (multi-dimensionale)
GET /api/query/search       → Query E: Full-Text Search (Atlas Search on-prem)
GET /api/query/semantic     → Query F: Vector Search (Atlas Vector Search on-prem)
```

---

## Le 6 Query MongoDB (core della demo)

### Query A — Geospaziale `$near`
**"Tralicci in manutenzione entro 80km da Roma"**
```js
db.tralicci.find({
  stato_operativo: "in_manutenzione",
  gis_location: {
    $near: {
      $geometry: { type: "Point", coordinates: [12.4964, 41.9028] },
      $maxDistance: 80000  // metri
    }
  }
})
```
*Mostra: query geospaziale nativa, indice 2dsphere, filtro combinato*

### Query B — `$lookup` (join tra collection)
**"IoT Box con allarmi attivi o batteria sotto il 20%"**
```js
db.tralicci.aggregate([
  {
    $lookup: {
      from: "aggetto_iot_boxes",
      localField: "_id",
      foreignField: "traliccio_collegato_id",
      as: "iot"
    }
  },
  { $unwind: "$iot" },
  {
    $match: {
      $or: [
        { "iot.livello_batteria": { $lt: 20 } },
        { "iot.allarmi_attivi": { $not: { $size: 0 } } }
      ]
    }
  },
  {
    $project: {
      codice: 1,
      stato_operativo: 1,
      regione: 1,
      "iot.codice": 1,
      "iot.livello_batteria": 1,
      "iot.allarmi_attivi": 1
    }
  }
])
```
*Mostra: aggregation pipeline, $lookup cross-collection, $unwind, $match, $project*

### Query C — `$group` + `$avg`
**"Temperatura media cavi per regione"**
```js
db.digic_boxes.aggregate([
  {
    $group: {
      _id: "$regione",
      temp_media: { $avg: "$temperatura_cavo_celsius" },
      corrente_media: { $avg: "$corrente_ampere" },
      num_tratte: { $sum: 1 },
      tratte_in_sovraccarico: {
        $sum: { $cond: [{ $eq: ["$stato", "sovraccarico"] }, 1, 0] }
      }
    }
  },
  { $sort: { temp_media: -1 } }
])
```
*Mostra: $group, $avg, $sum con $cond, sorting*

### Query D — `$facet` (multi-dimensionale)
**"KPI Dashboard: statistiche globali in una singola query"**
```js
db.tralicci.aggregate([
  {
    $facet: {
      "per_stato": [
        { $group: { _id: "$stato_operativo", count: { $sum: 1 } } }
      ],
      "per_regione": [
        { $group: { _id: "$regione", count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ],
      "per_tipologia": [
        { $group: { _id: "$tipologia", count: { $sum: 1 } } }
      ],
      "totale": [
        { $count: "n" }
      ]
    }
  }
])
```
*Mostra: $facet per ottenere 4 aggregazioni diverse con una sola chiamata al DB*

### Query E — Atlas Search on-prem (full-text Lucene)
**"Cerca tralicci per testo libero"** — es. input utente: `"monostelo campania"`
```js
db.tralicci.aggregate([
  {
    $search: {
      index: "tralicci_search",   // indice Atlas Search da creare
      text: {
        query: "<input utente>",
        path: ["nome", "tipologia", "regione"],
        fuzzy: { maxEdits: 1 }    // tolleranza typo
      }
    }
  },
  { $limit: 10 },
  {
    $project: {
      codice: 1, nome: 1, tipologia: 1, regione: 1,
      stato_operativo: 1,
      score: { $meta: "searchScore" }   // rilevanza Lucene
    }
  }
])
```
*Mostra: full-text search nativo in MongoDB (no Elasticsearch esterno), fuzzy matching, relevance score — disponibile on-prem con MongoDB Enterprise*

**Indice da creare** (una tantum, dopo il seed):
```json
{
  "name": "tralicci_search",
  "definition": {
    "mappings": {
      "dynamic": false,
      "fields": {
        "nome":       { "type": "string", "analyzer": "lucene.italian" },
        "tipologia":  { "type": "string", "analyzer": "lucene.italian" },
        "regione":    { "type": "string", "analyzer": "lucene.italian" }
      }
    }
  }
}
```
Creare via `mongosh` con `db.tralicci.createSearchIndex(...)` oppure via endpoint dedicato `POST /api/admin/create-indexes`.

### Query F — Atlas Vector Search on-prem (semantic search)
**"Trova asset simili per descrizione semantica"**

Ogni traliccio nel seed deve avere un campo `embedding` — vettore float32 di dimensione 384 generato da un modello leggero (es. `all-MiniLM-L6-v2` via `@xenova/transformers` o chiamata a un endpoint locale Ollama).

Il testo da embeddare: `"{tipologia} {regione} tensione {tensione_kv}kV stato {stato_operativo}"`.

```js
db.tralicci.aggregate([
  {
    $vectorSearch: {
      index: "tralicci_vector",       // indice Vector Search
      path: "embedding",
      queryVector: <vettore query>,   // embedding della stringa cercata dall'utente
      numCandidates: 50,
      limit: 5
    }
  },
  {
    $project: {
      codice: 1, nome: 1, tipologia: 1, regione: 1,
      score: { $meta: "vectorSearchScore" }
    }
  }
])
```
*Mostra: ricerca semantica senza sistema esterno — l'utente scrive in linguaggio naturale e trova asset simili per significato, non solo per parole chiave*

**Indice da creare:**
```json
{
  "name": "tralicci_vector",
  "type": "vectorSearch",
  "definition": {
    "fields": [{
      "type": "vector",
      "path": "embedding",
      "numDimensions": 384,
      "similarity": "cosine"
    }]
  }
}
```

**Generazione embedding nel seed:** usa `@xenova/transformers` (gira in Node.js, nessun server Python necessario):
```js
import { pipeline } from '@xenova/transformers';
const embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
const output = await embedder(testo, { pooling: 'mean', normalize: true });
const embedding = Array.from(output.data); // float32[]
```

---

## Interfaccia Utente

### Layout
```
┌─────────────────────────────────────────┐
│  TERNA Digital Twin  │ [Admin] [Monitor] │  ← Navbar top
├─────────────────────────────────────────┤
│                                         │
│           Contenuto Tab attivo          │
│                                         │
└─────────────────────────────────────────┘
```

### TAB 1: Admin
- Bottone **"Inizializza Database"** → chiama `POST /api/seed`
- Spinner durante il caricamento
- Riquadro di feedback con i conteggi dopo il seed

### TAB 2: Monitor
Layout a due colonne:

```
┌──────────────────────┬──────────────────────┐
│                      │  Query Panel         │
│   Mappa Leaflet      │  [A] Geo $near       │
│   (tralicci come     │  [B] Allarmi IoT     │
│    pin colorati)     │  [C] Stats Cavi      │
│                      │  [D] KPI $facet      │
│                      │  [E] Full-Text Search│
│                      │  [F] Vector Search   │
│                      ├──────────────────────┤
│                      │  Risultati query     │
│                      │  (tabella o JSON)    │
└──────────────────────┴──────────────────────┘
```

**Query E (Full-Text):** mostra una input box di testo libero sopra il bottone.
**Query F (Vector):** mostra una input box con placeholder "descrivi l'asset che cerchi..." — l'utente scrive in linguaggio naturale, il backend genera l'embedding e lancia `$vectorSearch`.

**Colori pin mappa:**
- Verde `#22c55e` → `attivo`
- Arancione `#f97316` → `in_manutenzione`
- Rosso `#ef4444` → `fuori_servizio`

**Click su pin:** mostra un popup Leaflet con codice, tipologia, stato, regione.

---

## Setup e Avvio

### Prerequisiti
- Node.js >= 18
- MongoDB Atlas (free tier M0) oppure MongoDB locale sulla porta 27017

### Installazione
```bash
cd backend
npm install express mongoose dotenv cors
```

### `.env`
```
MONGODB_URI=mongodb://mdb-admin:michele@work0.mongodb.local:30017,work1.mongodb.local:30018,work2.mongodb.local:30019/asset_management_terna?replicaSet=my-replica-set&tls=true&tlsAllowInvalidCertificates=true&authSource=admin
PORT=3001
OLLAMA_URL=http://localhost:11434
```

### Prerequisito Ollama
```bash
ollama pull nomic-embed-text   # embedding 768-dim, ~274MB
```

### Avvio
```bash
node server.js
# Apri http://localhost:3001 nel browser
```

> Express serve anche il frontend come static files — nessun server separato necessario.

---

## Note Implementative

1. **Ordine coordinate GeoJSON:** sempre `[longitude, latitude]`, non `[lat, lng]`. Leaflet usa `[lat, lng]` — converti quando passi dati alla mappa.
2. **Indice 2dsphere:** va creato dopo `mongoose.connect()` o direttamente nello schema Mongoose con `index: '2dsphere'`.
3. **Seed idempotente:** usa `deleteMany({})` prima di inserire, così il bottone Admin funziona più volte senza duplicati.
4. **CORS:** `app.use(cors())` nel backend, prima delle route.
5. **Risultati query nel frontend:** mostra una tabella HTML generata dinamicamente con `innerHTML` — più veloce che usare una libreria.
