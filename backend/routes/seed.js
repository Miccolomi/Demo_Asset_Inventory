const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Traliccio = require('../models/Traliccio');
const AggettIoTBox = require('../models/AggettIoTBox');
const DigiCBox = require('../models/DigiCBox');
const DigiLBox = require('../models/DigiLBox');

// Rete elettrica: Bologna → Reggio Calabria (dorsale tirrenica + adriatica)
const WAYPOINTS = [
  { coords: [11.3426, 44.4949], regione: 'Emilia-Romagna' },
  { coords: [11.2558, 43.7696], regione: 'Toscana' },
  { coords: [11.8817, 43.4636], regione: 'Toscana' },
  { coords: [12.1097, 42.7189], regione: 'Umbria' },
  { coords: [12.4964, 41.9028], regione: 'Lazio' },
  { coords: [13.3535, 41.6401], regione: 'Lazio' },
  { coords: [14.3328, 41.0736], regione: 'Campania' },
  { coords: [14.2681, 40.8518], regione: 'Campania' },
  { coords: [15.8000, 40.6400], regione: 'Basilicata' },
  { coords: [16.0600, 38.9100], regione: 'Calabria' },
  { coords: [15.6500, 38.1100], regione: 'Calabria' }
];

const REGIONI = [...new Set(WAYPOINTS.map(w => w.regione))];
const TIPOLOGIE = ['Monostelo', 'Traliccio a portale', 'Traliccio a Y', 'Traliccio Donau'];
const TENSIONI = [132, 220, 380];
const STATI = ['attivo', 'in_manutenzione', 'fuori_servizio'];
const STATI_W = [...Array(7).fill('attivo'), ...Array(2).fill('in_manutenzione'), 'fuori_servizio'];
const ALLARMI_POOL = ['VIBRAZIONE', 'TEMP_ALTA', 'UMIDITA_ALTA', 'BATTERIA_SCARICA', 'PERDITA_SEGNALE'];

const NUM_TRALICCI = 10000;
const INSERT_BATCH = 1000;  // insertMany chunk size
const EMBED_BATCH = 15;     // Ollama parallel calls per round

// ── Pool di frasi per descrizioni ricche e variegate ─────────────────────────
const p = arr => arr[Math.floor(Math.random() * arr.length)]; // pick random

const TERRAIN = {
  'Emilia-Romagna': 'pianura padana a ridosso degli Appennini emiliani',
  'Toscana':        'colline toscane del Chianti e della Valdichiana',
  'Umbria':         'dorsale appenninica umbra tra Perugia e Terni',
  'Lazio':          'campagna laziale della Valle del Tevere',
  'Campania':       'territorio campano tra Caserta e il Matese',
  'Basilicata':     'altopiano lucano della Val d\'Agri',
  'Calabria':       'Aspromonte calabrese e fascia tirrenica'
};

const TIPO_VARIANTS = {
  'Monostelo': [
    'Sostegno monostelo in acciaio S355 ad anima piena rastremata',
    'Palo monostelo tubolare in acciaio galvanizzato a caldo (≥86μm)',
    'Sostegno monostelo in acciaio HY-130 ad alta resistenza, profilo ottagonale',
    'Monostelo in acciaio zincato a sezione circolare costante, altezza 28m'
  ],
  'Traliccio a portale': [
    'Traliccio a portale con traversa a geometria variabile in profilati angolari zincati',
    'Sostegno a portale in acciaio reticolare con testa a semicorona per doppia terna',
    'Traliccio a portale modello standard Company, traversa rettilinea in acciaio S275',
    'Portale in acciaio zincato con mensole asimmetriche per linea in derivazione'
  ],
  'Traliccio a Y': [
    'Traliccio a Y con bracci asimmetrici per riduzione dell\'impatto visivo in area vincolata',
    'Sostegno a Y con testa a candelabro, geometria Danube modificata per terreni in pendenza',
    'Traliccio a Y in acciaio reticolare S355, soluzione adottata in corridoi elettrici stretti',
    'Struttura a Y con braccio superiore rinforzato per carico da neve elevato (qsk>2 kN/m²)'
  ],
  'Traliccio Donau': [
    'Traliccio Donau a doppia terna in acciaio S275, struttura compatta per corridoi urbani',
    'Sostegno Donau con mensole asimmetriche, impiegato in aree periurbane con vincoli paesaggistici',
    'Traliccio Donau compatto derivazione tedesca, riduce l\'ingombro del corridoio del 30%',
    'Donau modificato con sbracci di altezza variabile per attraversamento ferrovia ad alta velocità'
  ]
};

const ISOLATORI_POOL = [
  'catene di isolatori in vetro temperato Sediver tipo U70B',
  'isolatori compositi in silicone HTV (PolyLine 120kN) ad alte prestazioni',
  'isolatori in porcellana glazed tipo long-rod anti-nebbia per zone costiere',
  'catene di isolatori in vetro con guarnizioni idrofobiche per zone umide e nebbiose',
  'isolatori compositi con nuclei in fibra di vetro FRP, resistenza a trazione 120kN',
  'isolatori in vetro trattato di tipo cap-and-pin con testa calotta antirotazione'
];

const CONDUTTORI_POOL = [
  'conduttori ACSR 585/34 Bluejay (54+7 fili Al-acciaio)',
  'conduttori AAAC 537mm² in lega di alluminio 6201-T81',
  'conduttori HTLS (alta temperatura bassa freccia) Cardinal 954MCM in lega Al-Zr',
  'conduttori alluminio-acciaio 435/55mm² tipo Pheasant per linee di grande portata',
  'conduttori compatti in lega Al-Zr per bassa freccia dinamica a caldo',
  'conduttori ACCC (alma in fibra di carbonio) per upgrade di capacità senza nuovi sostegni'
];

const FONDAZIONE_POOL = [
  'fondazione a plinto in calcestruzzo armato C25/30, platea 3.5×3.5m',
  'pali trivellati φ800mm su substrato argilloso consolidato, profondità 12m',
  'fondazione su micropali in zona a rischio frana stabilizzata con iniezioni cementizie',
  'zattera di fondazione su terreno a bassa portanza (σamm<100 kPa)',
  'plinti prefabbricati ancorati su substrato roccioso (φ≥0.5 MPa), bullonatura M36',
  'pali battuti in acciaio su terreno alluvionale, verifica geotecnica Eurocodice 7'
];

const RISCHIO_POOL = [
  'zona sismica di 2ª categoria (ag=0.15g) con dettagli costruttivi antisismici NTC2018',
  'area soggetta a carichi da neve al suolo qsk>1.5 kN/m² (zona di progetto III)',
  'zona ad alta densità di fulminazione (Ng=4.2 fulm/km²/anno), schermatura CEI 81-10',
  'area a rischio idrogeologico R2 (PGRA), fondazioni protette da erosione laterale',
  'zona a forte intensità di vento (vref=28 m/s), verifica a fatica CEI EN 50341 eseguita',
  'area periurbana con vincoli paesaggistici (D.Lgs 42/2004), profilo cromatico adattato RAL7030',
  'zona di rispetto fluviale (fascia B PAI), adeguamento idraulico realizzato nel 2019',
  'area montana con rischio valanghe moderato, struttura progettata con carico eccezionale QE'
];

const MANUTENZIONE_POOL = [
  'sostituzione delle catene di isolatori deteriorati per inquinamento da particolato industriale (SPS>0.1 mg/cm²)',
  'riverniciatura anticorrosione e verifica dello spessore del rivestimento zinco (trovato <60μm)',
  'ispezione strutturale con rilievo termografico aereo e verifica bulloneria classe 8.8',
  'rifacimento parziale delle fondazioni per cedimento differenziale del suolo (>15mm misurato)',
  'adeguamento delle distanze di sicurezza ai sensi della norma CEI EN 50341-2-17 aggiornamento 2023',
  'sostituzione dei segnalatori di ostacolo al volo (ENAC circolare APT-01B rev.4)',
  'ripristino del sistema di messa a terra dopo evento di fulminazione diretta (Rmes>20Ω)',
  'intervento su mensole e armature danneggiate da vento estremo (raffica registrata 118 km/h)',
  'pulizia e ripristino isolatori contaminati da sale marino (zona costiera, CEI 305)',
  'sostituzione dei conduttori nella campata critica per danneggiamento da corto circuito'
];

const FUORI_SERVIZIO_POOL = [
  'fuori servizio per adeguamento normativo CEI EN 50341: incremento distanze minime di sicurezza',
  'disattivato a seguito di ispezione elicotteristica che ha rilevato corrosione critica al giunto di base',
  'in attesa di ripristino post-evento atmosferico eccezionale (accumulo ghiaccio >25mm sui conduttori)',
  'scollegato per upgrading tensione da 132kV a 220kV, lavori in esecuzione fino a fine anno',
  'fuori servizio temporaneo per rifacimento integrale fondazioni (cedimento differenziale 52mm)',
  'disattivato nell\'ambito del piano di dismissione parziale della linea per rerouting lungo l\'A1'
];

const ATTIVO_POOL = [
  'in piena operatività; ultima ispezione quinquennale con esito conforme (rapporto ISP-2023)',
  'monitoraggio continuo IoT: vibrazioni, temperatura e umidità nei range di progetto',
  'sistema di protezione catodica attivo, potenziale di protezione -850mV vs Cu/CuSO₄',
  'certificazione CE rinnovata; verifica distanze CEI e DPI aggiornata al 2024',
  'in esercizio regolare; test tenuta dielettrica isolatori (2.5×Un per 1 min) superato',
  'operativo con supervisione SCADA Company; nessun allarme attivo nelle ultime 168 ore'
];

const ETA_CATS = ['recente', 'maturo', 'storico'];

function etaCategory(anno) {
  const eta = new Date().getFullYear() - anno;
  return eta < 10 ? 'recente' : eta < 28 ? 'maturo' : 'storico';
}

function generaDescrizione(tipologia, regione, stato, tensione, anno) {
  const eta = new Date().getFullYear() - anno;
  const etaDesc = eta < 10 ? `installazione recente (${anno}), in periodo di garanzia costruttiva`
                : eta < 28 ? `${eta} anni di servizio, maturità operativa raggiunta`
                : eta < 40 ? `${eta} anni di esercizio, inserito nel piano di ispezioni straordinarie`
                           : `${eta} anni di servizio, candidato al programma di revamping Company 2030+`;

  const tensDesc = {
    132: `sub-trasmissione 132kV tra stazioni primarie di trasformazione`,
    220: `trasmissione 220kV della rete regionale ad alta tensione`,
    380: `dorsale 380kV della Rete di Trasmissione Nazionale, asset critico gestito da Company`
  }[tensione];

  const statoDetail = stato === 'attivo'          ? p(ATTIVO_POOL)
                    : stato === 'in_manutenzione'  ? p(MANUTENZIONE_POOL)
                    : /* fuori_servizio */            p(FUORI_SERVIZIO_POOL);

  return `${p(TIPO_VARIANTS[tipologia])}, equipaggiato con ${p(ISOLATORI_POOL)} e ${p(CONDUTTORI_POOL)}. ` +
         `Fondazione: ${p(FONDAZIONE_POOL)}. ` +
         `Fa parte della rete di ${tensDesc} in ${regione} (${TERRAIN[regione] || 'territorio appenninico'}). ` +
         `${etaDesc}. Condizioni di sito: ${p(RISCHIO_POOL)}. ` +
         `Stato operativo: ${statoDetail}.`;
}

// Testo per embedding: include categoria età per differenziare semanticamente asset vecchi/nuovi
const TIPO_EMBED = {
  'Monostelo':          'palo monostelo acciaio snello distribuzione',
  'Traliccio a portale':'traliccio portale reticolare altissima tensione',
  'Traliccio a Y':      'traliccio Y candelabro impatto visivo ridotto',
  'Traliccio Donau':    'traliccio Donau doppia terna compatto urbano'
};
const STATO_EMBED = {
  'attivo':          'pienamente operativo nessuna anomalia supervisione SCADA',
  'in_manutenzione': 'manutenzione isolatori fondazioni bulloneria anticorrosione intervento',
  'fuori_servizio':  'fuori servizio guasto normativa dismissione attesa ricollegamento'
};
const ETA_EMBED = {
  'recente':  'installazione recente garanzia costruttiva tecnologia moderna',
  'maturo':   'maturità operativa ispezioni periodiche esercizio consolidato',
  'storico':  'infrastruttura storica revamping ammodernamento vita residua limitata'
};

function embedText(tipologia, regione, stato, tensione, etaCat) {
  return `${TIPO_EMBED[tipologia]} ${tensione}kV ${regione} ${TERRAIN[regione] || 'appennino'}. ` +
         `${STATO_EMBED[stato]}. ${ETA_EMBED[etaCat]}.`;
}

const rand = arr => arr[Math.floor(Math.random() * arr.length)];
const randInt = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const randFloat = (a, b) => Math.random() * (b - a) + a;
const lerp = (a, b, t) => a + (b - a) * t;

function posAlongRoute(idx, total) {
  const t = idx / (total - 1);
  const numSeg = WAYPOINTS.length - 1;
  const scaled = t * numSeg;
  const seg = Math.min(Math.floor(scaled), numSeg - 1);
  const lt = scaled - seg;
  const p1 = WAYPOINTS[seg], p2 = WAYPOINTS[seg + 1];
  return {
    coords: [
      lerp(p1.coords[0], p2.coords[0], lt) + (Math.random() - 0.5) * 0.25,
      lerp(p1.coords[1], p2.coords[1], lt) + (Math.random() - 0.5) * 0.25
    ],
    regione: lt < 0.5 ? p1.regione : p2.regione
  };
}

async function getEmbedding(text) {
  const res = await fetch(`${process.env.OLLAMA_URL}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'nomic-embed-text', prompt: text })
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
  const data = await res.json();
  if (!data.embedding) throw new Error('Ollama: nessun embedding nella risposta');
  return data.embedding;
}

// Genera embedding in batch per non sovraccaricare Ollama
async function batchEmbeddings(texts) {
  const results = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const chunk = texts.slice(i, i + EMBED_BATCH);
    const res = await Promise.all(chunk.map(getEmbedding));
    results.push(...res);
    process.stdout.write(`\r  embedding ${Math.min(i + EMBED_BATCH, texts.length)}/${texts.length}`);
  }
  console.log('');
  return results;
}

// insertMany in chunk da INSERT_BATCH per evitare documenti troppo grandi in memoria
async function batchInsert(Model, docs) {
  let inserted = 0;
  for (let i = 0; i < docs.length; i += INSERT_BATCH) {
    await Model.insertMany(docs.slice(i, i + INSERT_BATCH), { ordered: false });
    inserted += Math.min(INSERT_BATCH, docs.length - i);
    process.stdout.write(`\r  inseriti ${inserted}/${docs.length}`);
  }
  console.log('');
  return inserted;
}

async function createSearchIndexes() {
  const db = mongoose.connection.db;
  const col = db.collection('tralicci');

  // Drop + ricrea sempre — garantisce che la definizione sia aggiornata ad ogni seed
  for (const name of ['tralicci_search', 'tralicci_vector']) {
    try {
      await col.dropSearchIndex(name);
      console.log(`→ Search index "${name}" droppato`);
      // Aspetta che il drop sia completato (richiede qualche secondo sul server)
      await new Promise(r => setTimeout(r, 2000));
    } catch (e) {
      if (!e.message?.includes('not found') && !e.message?.includes('IndexNotFound')) {
        console.log(`→ Drop "${name}" skippato: ${e.message}`);
      }
    }
  }

  try {
    await db.command({
      createSearchIndexes: 'tralicci',
      indexes: [{
        name: 'tralicci_search',
        definition: {
          mappings: {
            dynamic: false,
            fields: {
              descrizione: { type: 'string', analyzer: 'lucene.italian' },
              nome:        { type: 'string', analyzer: 'lucene.italian' },
              tipologia:   { type: 'string', analyzer: 'lucene.italian' },
              regione:     { type: 'string', analyzer: 'lucene.italian' }
            }
          }
        }
      }]
    });
    console.log('✓ Atlas Search index ricreato');
  } catch (e) {
    console.log(`✗ Search index: ${e.message}`);
  }

  try {
    await db.command({
      createSearchIndexes: 'tralicci',
      indexes: [{
        type: 'vectorSearch',
        name: 'tralicci_vector',
        definition: {
          fields: [{
            type: 'vector',
            path: 'embedding',
            numDimensions: 768,
            similarity: 'cosine'
          }]
        }
      }]
    });
    console.log('✓ Vector Search index ricreato');
  } catch (e) {
    console.log(`✗ Vector index: ${e.message}`);
  }
}

router.post('/seed', async (req, res) => {
  const t0 = Date.now();
  console.log(`\n→ Avvio seed (${NUM_TRALICCI.toLocaleString()} tralicci)...`);

  try {
    // 1. Pulizia
    await Promise.all([
      Traliccio.deleteMany({}),
      AggettIoTBox.deleteMany({}),
      DigiCBox.deleteMany({}),
      DigiLBox.deleteMany({})
    ]);
    console.log('✓ Collections svuotate');

    // 2. Genera embedding template per ogni combo unica
    //    tipologie(4) × regioni(7) × stati(3) × tensioni(3) × etaCat(3) = 756 combo
    console.log('→ Generazione embedding template via Ollama (756 combo con categoria età)...');
    const templateKey = (tip, reg, stato, ten, eta) => `${tip}|${reg}|${stato}|${ten}|${eta}`;
    const templateMap = new Map();
    const comboTexts = [];
    const comboKeys = [];

    for (const tip of TIPOLOGIE) {
      for (const reg of REGIONI) {
        for (const stato of STATI) {
          for (const ten of TENSIONI) {
            for (const eta of ETA_CATS) {
              const key = templateKey(tip, reg, stato, ten, eta);
              comboTexts.push(embedText(tip, reg, stato, ten, eta));
              comboKeys.push(key);
            }
          }
        }
      }
    }

    const templateVecs = await batchEmbeddings(comboTexts);
    comboKeys.forEach((k, i) => templateMap.set(k, templateVecs[i]));
    console.log(`✓ ${templateMap.size} embedding template generati`);

    // 3. Genera dati tralicci con _id pre-assegnati
    console.log('→ Generazione dati tralicci...');
    const tralicciIds = Array.from({ length: NUM_TRALICCI }, () => new mongoose.Types.ObjectId());

    const tralicciData = tralicciIds.map((id, i) => {
      const { coords, regione } = posAlongRoute(i, NUM_TRALICCI);
      const stato = rand(STATI_W);
      const tipologia = rand(TIPOLOGIE);
      const tensione_kv = rand(TENSIONI);

      const anno = randInt(1975, 2022);
      const etaCat = etaCategory(anno);

      // Embedding = template (tipologia+regione+stato+tensione+età) + piccolo rumore
      const baseVec = templateMap.get(templateKey(tipologia, regione, stato, tensione_kv, etaCat))
        || templateVecs[0];
      const embedding = baseVec.map(v => v + (Math.random() - 0.5) * 0.02);
      return {
        _id: id,
        codice: `TRL-${String(i + 1).padStart(5, '0')}`,
        nome: `Traliccio ${regione} ${String(i + 1).padStart(5, '0')}`,
        tipologia,
        tensione_kv,
        regione,
        stato_operativo: stato,
        anno_installazione: anno,
        descrizione: generaDescrizione(tipologia, regione, stato, tensione_kv, anno),
        gis_location: { type: 'Point', coordinates: coords },
        embedding
      };
    });
    console.log(`✓ ${NUM_TRALICCI.toLocaleString()} tralicci generati (descrizioni uniche per documento)`);

    // 4. Insert tralicci a batch
    console.log('→ Insert tralicci...');
    await batchInsert(Traliccio, tralicciData);
    console.log(`✓ Tralicci inseriti`);

    // 5. IoT Boxes
    console.log('→ Generazione e insert IoT Box...');
    const iotData = tralicciIds.map((id, i) => {
      const stato = tralicciData[i].stato_operativo;
      const bad = stato !== 'attivo';
      const batteria = bad ? randInt(5, 30) : randInt(40, 100);
      const numAllarmi = bad ? randInt(1, 3) : (Math.random() < 0.12 ? 1 : 0);
      const pool = [...ALLARMI_POOL];
      const allarmi = [];
      for (let j = 0; j < numAllarmi; j++) {
        allarmi.push(pool.splice(randInt(0, pool.length - 1), 1)[0]);
      }
      if (batteria < 20 && !allarmi.includes('BATTERIA_SCARICA')) allarmi.push('BATTERIA_SCARICA');
      return {
        codice: `IOT-${String(i + 1).padStart(5, '0')}`,
        traliccio_collegato_id: id,
        firmware_version: `v${randInt(2, 4)}.${randInt(0, 9)}.${randInt(0, 9)}`,
        livello_batteria: batteria,
        ultimo_segnale: new Date(Date.now() - randInt(0, 259200000)),
        allarmi_attivi: allarmi,
        telemetria: {
          temperatura_celsius: Math.round(randFloat(15, 65) * 10) / 10,
          umidita_percentuale: Math.round(randFloat(30, 95) * 10) / 10,
          vibrazione_hz: Math.round(randFloat(0, 50) * 10) / 10
        }
      };
    });
    await batchInsert(AggettIoTBox, iotData);
    console.log('✓ IoT Box inserite');

    // 6. DigiC Boxes (coppie consecutive)
    console.log('→ Generazione e insert DigiC Box...');
    const digicData = [];
    for (let i = 0; i < tralicciIds.length - 1; i++) {
      const t1 = tralicciData[i], t2 = tralicciData[i + 1];
      const dx = (t2.gis_location.coordinates[0] - t1.gis_location.coordinates[0]) * 111 *
        Math.cos(t1.gis_location.coordinates[1] * Math.PI / 180);
      const dy = (t2.gis_location.coordinates[1] - t1.gis_location.coordinates[1]) * 111;
      const stato = Math.random() < 0.85 ? 'normale' : (Math.random() < 0.6 ? 'sovraccarico' : 'guasto');
      digicData.push({
        codice: `DIGIC-${String(i + 1).padStart(5, '0')}`,
        traliccio_da_id: tralicciIds[i],
        traliccio_a_id: tralicciIds[i + 1],
        regione: t1.regione,
        lunghezza_km: Math.round(Math.sqrt(dx * dx + dy * dy) * 10) / 10,
        tensione_kv: t1.tensione_kv,
        temperatura_cavo_celsius: Math.round(randFloat(stato === 'sovraccarico' ? 75 : 35, stato === 'sovraccarico' ? 95 : 75) * 10) / 10,
        corrente_ampere: Math.round(randFloat(200, 1000)),
        stato
      });
    }
    await batchInsert(DigiCBox, digicData);
    console.log('✓ DigiC Box inserite');

    // 7. DigiL Boxes (una per regione)
    const digilData = REGIONI.map((reg, i) => ({
      codice: `DIGIL-${String(i + 1).padStart(3, '0')}`,
      nome_linea: `Linea 380kV ${reg}`,
      regioni_attraversate: [reg],
      numero_tralicci: Math.round(NUM_TRALICCI / REGIONI.length),
      numero_tratte: Math.round(NUM_TRALICCI / REGIONI.length) - 1,
      potenza_mw: Math.round(randFloat(600, 1400)),
      disponibilita_percentuale: Math.round(randFloat(92, 99.9) * 10) / 10,
      stato: Math.random() < 0.85 ? 'operativa' : 'limitata'
    }));
    await DigiLBox.insertMany(digilData);
    console.log(`✓ ${digilData.length} DigiL Box inserite`);

    await createSearchIndexes();

    // Indici Mongoose su collezioni operative (crea se non esistono)
    console.log('→ Sincronizzazione indici Mongoose...');
    await Promise.all([
      Traliccio.syncIndexes(),
      AggettIoTBox.syncIndexes(),
      DigiCBox.syncIndexes()
    ]);
    console.log('✓ Indici Mongoose sincronizzati');

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`\n✓ Seed completato in ${elapsed}s`);

    res.json({
      success: true,
      elapsed_sec: parseFloat(elapsed),
      counts: {
        tralicci: NUM_TRALICCI,
        iot_boxes: NUM_TRALICCI,
        digic_boxes: digicData.length,
        digil_boxes: digilData.length
      }
    });

  } catch (e) {
    console.error('✗ Errore seed:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
