# Terna Asset Management — Digital Twin Demo
## Istruzioni per Claude Code

---

## Obiettivo del Progetto
Demo SPA per mostrare le capacità di MongoDB nella gestione di infrastrutture elettriche (Smart Grid). L'app simula un "Digital Twin" di tralicci ad alta tensione con IoT Box per la telemetria, lungo la dorsale elettrica appenninica italiana.

**Scopo principale:** far vedere MongoDB in azione (geospaziale, aggregation pipeline, $lookup, $facet, Atlas Search, Vector Search + LLM) in un contesto realistico. Non costruire un prodotto — tieni tutto semplice.

---

## Stack Tecnologico
| Layer | Tecnologia | Note |
|---|---|---|
| Database | MongoDB (replica set locale) | Stringa di connessione via `.env` |
| Backend | Node.js + Express.js | Mongoose per i modelli |
| Frontend | **Vanilla JS + HTML + CSS** | No React, no build step. SPA con fetch() |
| Mappe | Leaflet.js (CDN) | |
| Stile | CSS inline in index.html | Niente Tailwind CDN attualmente |
| Embeddings | Ollama (`nomic-embed-text`, 768-dim) | Gira in locale su http://localhost:11434 |
| LLM | Ollama (`llama3.2:latest`) | Usato per sintesi risposta nella Query J |

> **Perché Vanilla JS:** È una demo, non un prodotto. Nessun `npm run build`. Express serve il frontend come static files.

---

## Struttura Cartelle

```
/
├── backend/
│   ├── server.js            # Entry point Express
│   ├── .env                 # MONGODB_URI, PORT, OLLAMA_URL, OLLAMA_CHAT_MODEL
│   ├── package.json         # Dipendenze: express, mongoose, dotenv, cors
│   ├── models/
│   │   ├── Traliccio.js     # Schema + indici 2dsphere, stato_operativo, regione
│   │   ├── AggettIoTBox.js  # Schema + indici su traliccio_collegato_id, batteria, allarmi, telemetria
│   │   ├── DigiCBox.js      # Schema + indici su regione+stato, traliccio_da/a_id+stato
│   │   └── DigiLBox.js      # Schema semplice, no indici extra
│   └── routes/
│       ├── seed.js          # POST /api/seed — genera 10.000 tralicci con embedding Ollama
│       └── queries.js       # GET /api/query/* — 10 query showcase (A→J) + CRUD tralicci
├── frontend/
│   ├── index.html           # SPA completa (522 righe), CSS inline, 3 tab
│   └── app.js               # Logica JS (867 righe): fetch, Leaflet, tab, CRUD, query rendering
└── CLAUDE.md
```

> **Nota:** non esiste `style.css` separato — gli stili sono inline in `index.html`.

---

## Struttura del Database (4 Collections)

### 1. `tralicci`
```js
{
  codice: String,           // es. "TRL-00042"
  nome: String,             // es. "Traliccio Appennino Nord 42"
  tipologia: String,        // "Monostelo" | "Traliccio a portale" | "Traliccio a Y" | ...
  tensione_kv: Number,      // 132 | 220 | 380
  regione: String,          // "Lazio" | "Campania" | "Toscana" | "Calabria" ecc.
  stato_operativo: String,  // "attivo" | "in_manutenzione" | "fuori_servizio"
  anno_installazione: Number,
  descrizione: String,      // testo libero per full-text search e embedding
  gis_location: {           // GeoJSON — OBBLIGATORIO per indice 2dsphere
    type: "Point",
    coordinates: [lng, lat] // ATTENZIONE: longitude PRIMA di latitude (standard GeoJSON)
  },
  embedding: [Number]       // vettore 768-dim (nomic-embed-text via Ollama), select:false
}
// Indici:
//   { gis_location: '2dsphere' }
//   { stato_operativo: 1 }
//   { regione: 1, stato_operativo: 1 }
```

### 2. `aggetto_iot_box`
```js
{
  codice: String,                    // es. "IOT-00042"
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
// Indici:
//   { traliccio_collegato_id: 1 }
//   { livello_batteria: 1 }
//   { allarmi_attivi: 1 }
//   { 'telemetria.vibrazione_hz': 1 }
//   { 'telemetria.temperatura_celsius': 1 }
```

### 3. `digic_box`
```js
{
  codice: String,                 // es. "DIGIC-00009"
  traliccio_da_id: ObjectId,      // ref -> tralicci
  traliccio_a_id: ObjectId,       // ref -> tralicci
  regione: String,
  lunghezza_km: Number,
  tensione_kv: Number,
  temperatura_cavo_celsius: Number,
  corrente_ampere: Number,
  stato: String                   // "normale" | "sovraccarico" | "guasto"
}
// Indici:
//   { regione: 1, stato: 1 }
//   { traliccio_da_id: 1, stato: 1 }
//   { traliccio_a_id: 1, stato: 1 }
```

### 4. `digil_box`
```js
{
  codice: String,               // es. "DIGIL-001"
  nome_linea: String,           // es. "Linea 380kV Bologna-Firenze"
  regioni_attraversate: [String],
  numero_tralicci: Number,
  numero_tratte: Number,
  potenza_mw: Number,
  disponibilita_percentuale: Number, // uptime
  stato: String                 // "operativa" | "limitata" | "fuori_servizio"
}
```

---

## Dati di Seed (`POST /api/seed`)

### Volumi
- **10.000 tralicci** georeferenziati
- **10.000 IoT Box** (1 per traliccio)
- **9.999 DigiC Box** (1 per ogni coppia di tralicci consecutivi)
- **7 DigiL Box** (linee aggregazione)

### Rotta Simulata
Dorsale elettrica appenninica italiana **Bologna → Reggio Calabria** con waypoint intermedi. Ogni traliccio ha offset random ±0.05° per realismo.

### Distribuzione stati operativi (random pesato):
- 70% `attivo`
- 20% `in_manutenzione`
- 10% `fuori_servizio`

### Embedding
Ogni traliccio riceve un embedding 768-dim generato da Ollama (`nomic-embed-text`) sul testo:
`"{tipologia} {regione} tensione {tensione_kv}kV stato {stato_operativo} {descrizione}"`

Il seed usa batching per evitare di sovraccaricare Ollama. Usa **756 template pre-calcolati** (combinazioni tipologia × regione × stato × tensione × categoria età) per minimizzare le chiamate Ollama e velocizzare il seed.

Il seed crea anche gli indici Atlas Search (full-text e vector) tramite `createSearchIndex` / `createIndex`.

### Idempotenza
`deleteMany({})` su tutte le collection prima di inserire — il bottone Admin funziona più volte.

---

## API Backend

### Seed
```
POST /api/seed
```
Risponde con conteggi dopo il completamento.

### CRUD Tralicci (Tab Anagrafica)
```
GET    /api/tralicci                   → 500 campione random per la mappa
GET    /api/tralicci/search?q=&page=1&limit=50  → ricerca + paginazione lista CRUD
GET    /api/tralicci/:id               → dettaglio singolo
GET    /api/tralicci/:id/details       → IoT Box + tratte DigiC adiacenti + linea DigiL
POST   /api/tralicci                   → crea nuovo
PUT    /api/tralicci/:id               → aggiorna
DELETE /api/tralicci/:id               → elimina
```

### Query MongoDB (showcase — Tab Monitor)
```
GET  /api/query/kpi              → Query A: $facet (KPI Dashboard multidimensionale)
GET  /api/query/geo              → Query B: $near geospaziale (parametri: city, km)
GET  /api/query/allarmi          → Query C: $lookup + $unwind (IoT allarmi/batteria bassa)
GET  /api/query/stats-cavi       → Query D: $group + $avg (temperatura cavi per regione)
GET  /api/query/doppio-rischio   → Query E: $lookup pipeline (tralicci critici + tratte guaste)
GET  /api/query/salute-linee     → Query F: aggregazione su 3 collection (DigiL + DigiC + Tralicci)
GET  /api/query/stress-regione   → Query G: $group cross-collection (stress termico + % non attivi)
GET  /api/query/iot-estrema      → Query H: IoT fuori soglia (vibrazione >30Hz o temp >55°C)
GET  /api/query/search?q=        → Query I: Atlas Search full-text (lucene.italian, fuzzy maxEdits:1)
POST /api/query/semantic         → Query J: Vector Search ($vectorSearch) + sintesi LLM (llama3.2)
GET  /api/query/grafo?codice=&hops=5 → Query K: $graphLookup traversal catena elettrica
```

---

## Le 10 Query MongoDB (core della demo)

### Query A — `$facet` (KPI Dashboard)
**"Statistiche globali in una singola query"**
4 aggregazioni in parallelo: per stato, per regione, per tipologia, totale.
*Mostra: $facet — risultati multipli con una sola chiamata al DB*

### Query B — `$near` Geospaziale
**"Tralicci in manutenzione entro X km da una città"**
Input: città (coordinate predefinite) + raggio km.
*Mostra: query geospaziale nativa, indice 2dsphere, filtro combinato*

### Query C — `$lookup` + `$unwind`
**"IoT Box con allarmi attivi o batteria < 20%"**
Join tra `tralicci` e `aggetto_iot_box`.
*Mostra: aggregation pipeline, $lookup cross-collection, $unwind, $match, $project*

### Query D — `$group` + `$avg`
**"Temperatura media cavi per regione"**
Su `digic_box`, raggruppa per regione con avg temperatura/corrente e count sovraccarichi.
*Mostra: $group, $avg, $sum con $cond*

### Query E — Doppio Rischio (`$lookup` pipeline)
**"Tralicci non attivi che hanno anche tratte cavo in stato critico"**
$lookup con pipeline su `digic_box` filtrando per stato guasto/sovraccarico.
*Mostra: $lookup con sub-pipeline, filtri incrociati multi-collection*

### Query F — Salute Linee Complete
**"Stato di salute di ogni linea intera"**
Per ogni DigiL aggrega DigiC e Tralicci collegati (3 collection).
*Mostra: aggregazioni a cascata su 3 collection*

### Query G — Stress per Regione
**"Regioni con stress termico e alta % tralicci non attivi"**
$group cross-collection: temperatura media cavi + percentuale tralicci non operativi.
*Mostra: correlazione dati da collection diverse*

### Query K — `$graphLookup` (catena elettrica)
**"Percorri la rete elettrica partendo da un traliccio"**
```js
db.tralicci.aggregate([
  { $match: { codice: "TRL-00042" } },
  {
    $graphLookup: {
      from: 'digic_box',
      startWith: '$_id',
      connectFromField: 'traliccio_a_id',
      connectToField: 'traliccio_da_id',
      as: 'catena',
      maxDepth: 5,          // N hop in avanti
      depthField: 'hop'     // profondità di ogni nodo trovato
    }
  },
  // $lookup per risolvere i tralicci di destinazione
  { $lookup: { from: 'tralicci', let: { ids: { $map: ... } }, pipeline: [...], as: 'tralicci_catena' } },
  { $project: { ... } }
])
```
*Mostra: $graphLookup per graph traversal nativo MongoDB — traversa digic_box in avanti (traliccio_da_id → traliccio_a_id) fino a N hop. Risultato visualizzato come tabella + polyline sulla mappa.*

**UI:** input codice traliccio (auto-popolato cliccando un pin sulla mappa Monitor) + numero hop (default 5). Polyline blu disegnata sulla mappa con i tralicci nella catena.

### Query H — IoT Fuori Soglia
**"IoT con vibrazione >30Hz o temperatura >55°C"**
Filtra `aggetto_iot_box` su telemetria estrema, correla con tratta cavo adiacente.
*Mostra: $match su subdocumento, $lookup con filtro critico*

### Query I — Atlas Search Full-Text
**"Cerca tralicci per testo libero"** — es. "monostelo campania"
```js
db.tralicci.aggregate([
  { $search: {
      index: "tralicci_search",
      text: { query: "<input>", path: ["nome","tipologia","regione","descrizione"], fuzzy: { maxEdits: 1 } }
  }},
  { $limit: 10 },
  { $project: { codice:1, nome:1, tipologia:1, regione:1, stato_operativo:1, score:{$meta:"searchScore"} } }
])
```
*Mostra: full-text search nativo MongoDB, analyzer lucene.italian, fuzzy matching, relevance score*

**Indice Atlas Search:**
```json
{
  "name": "tralicci_search",
  "definition": {
    "mappings": { "dynamic": false, "fields": {
      "nome":        { "type": "string", "analyzer": "lucene.italian" },
      "tipologia":   { "type": "string", "analyzer": "lucene.italian" },
      "regione":     { "type": "string", "analyzer": "lucene.italian" },
      "descrizione": { "type": "string", "analyzer": "lucene.italian" }
    }}
  }
}
```

### Query J — Vector Search + LLM (Semantic)
**"Trova asset simili per descrizione semantica"**
```js
// 1. Genera embedding della query utente via Ollama (nomic-embed-text, 768-dim)
// 2. $vectorSearch su indice 'tralicci_vector'
// 3. Sintesi risultati con llama3.2 via Ollama
db.tralicci.aggregate([
  { $vectorSearch: {
      index: "tralicci_vector",
      path: "embedding",
      queryVector: <vettore 768-dim>,
      numCandidates: 50,
      limit: 5
  }},
  { $project: { codice:1, nome:1, tipologia:1, regione:1, score:{$meta:"vectorSearchScore"} } }
])
```
*Mostra: ricerca semantica nativa MongoDB, nessun sistema esterno, sintesi LLM in linguaggio naturale*

**Indice Vector Search:**
```json
{
  "name": "tralicci_vector",
  "type": "vectorSearch",
  "definition": {
    "fields": [{ "type": "vector", "path": "embedding", "numDimensions": 768, "similarity": "cosine" }]
  }
}
```

---

## Interfaccia Utente (3 Tab)

### Navbar
Navbar fissa blu scuro (`#1e3a5f`) con logo Terna e 3 tab: **Admin | Anagrafica | Monitor**

### TAB 1: Admin
- Bottone "Inizializza Database" → `POST /api/seed`
- Spinner durante il caricamento (può durare minuti per 10.000 tralicci + embedding Ollama)
- Riquadro feedback con conteggi dopo il seed

### TAB 2: Anagrafica
Layout a due colonne: mappa Leaflet (sinistra) + pannello CRUD (destra, 440px).

- Mappa mostra campione di 500 tralicci con pin colorati
- Click su mappa → imposta coordinate nel form
- Click su pin → seleziona traliccio per modifica
- Lista paginata con ricerca testuale (50 per pagina)
- CRUD completo: create, read, update, delete
- **Panel "Apparati collegati"** (sotto il form, solo in modalità edit):
  - IoT Box: batteria, telemetria (temp/umidità/vibrazione), allarmi attivi
  - Tratte cavo DigiC adiacenti: codice, stato, temperatura, km
  - Linea DigiL di appartenenza: nome linea, potenza, disponibilità

### TAB 3: Monitor
Layout a tre zone: bottoni query (sinistra) + mappa risultati (centro, 42%) + tabella risultati (destra/sotto).

- 10 query button (A→J) con label descrittiva
- Query B: input città + raggio km
- Query I: input testo libero
- Query J: input linguaggio naturale, risposta include sintesi LLM
- Risultati mostrano tabella HTML dinamica + marker sulla mappa per query geospaziali

**Colori pin mappa:**
- Verde `#22c55e` → `attivo`
- Arancione `#f97316` → `in_manutenzione`
- Rosso `#ef4444` → `fuori_servizio`

---

## Setup e Avvio

### Prerequisiti
- Node.js >= 18
- MongoDB replica set locale (o Atlas)
- Ollama in esecuzione con i modelli `nomic-embed-text` e `llama3.2:latest`

### `.env` (in `backend/`)
```
MONGODB_URI=mongodb://mdb-admin:michele@work0.mongodb.local:30017,work1.mongodb.local:30018,work2.mongodb.local:30019/asset_management_terna?replicaSet=my-replica-set&tls=true&tlsAllowInvalidCertificates=true&authSource=admin
PORT=3001
OLLAMA_URL=http://localhost:11434
OLLAMA_CHAT_MODEL=llama3.2:latest
```

### Installazione e Avvio
```bash
cd backend
npm install
node server.js
# Apri http://localhost:3001
```

### Pull modelli Ollama
```bash
ollama pull nomic-embed-text   # 768-dim, ~274MB
ollama pull llama3.2           # per sintesi Query J
```

---

## Note Implementative

1. **Ordine coordinate GeoJSON:** sempre `[longitude, latitude]` — Leaflet usa `[lat, lng]`, converti sempre.
2. **Seed lento:** con 10.000 tralicci e embedding Ollama il seed può durare diversi minuti. Il batching è già implementato in `seed.js`.
3. **Indici Atlas Search:** creati via `createSearchIndex` nel seed. Se la collection è vuota o l'indice esiste già, la creazione viene gestita senza crash.
4. **`embedding: { select: false }`**: il campo embedding è escluso di default dalle query per non appesantire i risultati. Viene selezionato esplicitamente solo dove necessario.
5. **CRUD Anagrafica:** le coordinate vengono inserite cliccando sulla mappa — il click setta i campi lat/lng nascosti nel form.
6. **Campione mappa:** la mappa del tab Anagrafica e Monitor carica un campione di 500 tralicci random (`GET /api/tralicci`) per non appesantire il browser con 10.000 marker.
7. **CORS:** `app.use(cors())` è attivo prima delle route in `server.js`.
