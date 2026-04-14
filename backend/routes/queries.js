const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Traliccio = require('../models/Traliccio');
const AggettIoTBox = require('../models/AggettIoTBox');
const DigiCBox = require('../models/DigiCBox');
const DigiLBox = require('../models/DigiLBox');

// ── MAP ──────────────────────────────────────────────────────────────────────

// 500 campione random per la mappa
router.get('/tralicci', async (req, res) => {
  try {
    const tralicci = await Traliccio.aggregate([{ $sample: { size: 500 } }]);
    res.json(tralicci);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── CRUD ─────────────────────────────────────────────────────────────────────

// IMPORTANTE: /tralicci/search prima di /tralicci/:id altrimenti Express
// interpreta "search" come un ID

router.get('/tralicci/search', async (req, res) => {
  try {
    const { q, page = 1, limit = 50 } = req.query;
    const pageNum  = Math.max(1, parseInt(page));
    const limitNum = Math.min(200, Math.max(1, parseInt(limit)));
    const skip     = (pageNum - 1) * limitNum;

    const filter = q
      ? { $or: [
          { codice:  { $regex: q, $options: 'i' } },
          { nome:    { $regex: q, $options: 'i' } },
          { regione: { $regex: q, $options: 'i' } }
        ]}
      : {};

    const [data, total] = await Promise.all([
      Traliccio.find(filter).select('-embedding').sort({ codice: 1 }).skip(skip).limit(limitNum),
      Traliccio.countDocuments(filter)
    ]);

    res.json({
      data,
      total,
      page:  pageNum,
      pages: Math.ceil(total / limitNum),
      limit: limitNum
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/tralicci/:id', async (req, res) => {
  try {
    const t = await Traliccio.findById(req.params.id).select('-embedding');
    if (!t) return res.status(404).json({ error: 'Non trovato' });
    res.json(t);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── DETTAGLI TRALICCIO (IoT Box + Tratte DigiC + Linea DigiL) ────────────────
router.get('/tralicci/:id/details', async (req, res) => {
  try {
    const id = new mongoose.Types.ObjectId(req.params.id);

    const traliccio = await Traliccio.findById(id).select('regione').lean();
    if (!traliccio) return res.status(404).json({ error: 'Non trovato' });

    const [iot, tratte, linea] = await Promise.all([
      AggettIoTBox.findOne({ traliccio_collegato_id: id }).lean(),
      DigiCBox.find({ $or: [{ traliccio_da_id: id }, { traliccio_a_id: id }] })
        .select('codice stato temperatura_cavo_celsius corrente_ampere lunghezza_km tensione_kv traliccio_da_id traliccio_a_id')
        .limit(5).lean(),
      DigiLBox.findOne({ regioni_attraversate: traliccio.regione })
        .select('codice nome_linea stato disponibilita_percentuale potenza_mw regioni_attraversate').lean()
    ]);

    res.json({ iot, tratte, linea });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/tralicci', async (req, res) => {
  try {
    const { codice, nome, tipologia, tensione_kv, regione,
            stato_operativo, anno_installazione, descrizione, lat, lng } = req.body;

    const t = await Traliccio.create({
      codice, nome, tipologia,
      tensione_kv: Number(tensione_kv),
      regione, stato_operativo,
      anno_installazione: Number(anno_installazione),
      descrizione,
      gis_location: { type: 'Point', coordinates: [parseFloat(lng), parseFloat(lat)] }
    });
    res.status(201).json(t);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.put('/tralicci/:id', async (req, res) => {
  try {
    const { codice, nome, tipologia, tensione_kv, regione,
            stato_operativo, anno_installazione, descrizione, lat, lng } = req.body;

    const update = {
      codice, nome, tipologia,
      tensione_kv: Number(tensione_kv),
      regione, stato_operativo,
      anno_installazione: Number(anno_installazione),
      descrizione,
      gis_location: { type: 'Point', coordinates: [parseFloat(lng), parseFloat(lat)] }
    };

    const t = await Traliccio.findByIdAndUpdate(req.params.id, update, { new: true }).select('-embedding');
    if (!t) return res.status(404).json({ error: 'Non trovato' });
    res.json(t);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete('/tralicci/:id', async (req, res) => {
  try {
    const t = await Traliccio.findByIdAndDelete(req.params.id);
    if (!t) return res.status(404).json({ error: 'Non trovato' });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── QUERY A–F ────────────────────────────────────────────────────────────────

router.get('/query/geo', async (req, res) => {
  try {
    const lat      = parseFloat(req.query.lat)      || 41.9028;
    const lng      = parseFloat(req.query.lng)      || 12.4964;
    const distance = parseInt(req.query.distance)   || 80000;   // metri

    const results = await Traliccio.find({
      stato_operativo: 'in_manutenzione',
      gis_location: {
        $near: {
          $geometry: { type: 'Point', coordinates: [lng, lat] },
          $maxDistance: distance
        }
      }
    })
    .select('codice nome regione stato_operativo tensione_kv gis_location anno_installazione')
    .limit(100);
    res.json({ results, meta: { lat, lng, distanceKm: Math.round(distance / 1000) } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/query/allarmi', async (req, res) => {
  try {
    const results = await AggettIoTBox.aggregate([
      {
        $match: {
          $or: [
            { livello_batteria: { $lt: 20 } },
            { $expr: { $gt: [{ $size: '$allarmi_attivi' }, 0] } }
          ]
        }
      },
      {
        $lookup: {
          from: 'tralicci',
          localField: 'traliccio_collegato_id',
          foreignField: '_id',
          as: 'traliccio'
        }
      },
      { $unwind: '$traliccio' },
      {
        $project: {
          codice: '$traliccio.codice',
          regione: '$traliccio.regione',
          stato_operativo: '$traliccio.stato_operativo',
          iot: {
            codice: '$codice',
            livello_batteria: '$livello_batteria',
            allarmi_attivi: '$allarmi_attivi'
          }
        }
      },
      { $sort: { 'iot.livello_batteria': 1 } },
      { $limit: 100 }
    ]);
    res.json(results);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/query/stats-cavi', async (req, res) => {
  try {
    const results = await DigiCBox.aggregate([
      {
        $group: {
          _id: '$regione',
          temp_media: { $avg: '$temperatura_cavo_celsius' },
          corrente_media: { $avg: '$corrente_ampere' },
          num_tratte: { $sum: 1 },
          tratte_in_sovraccarico: {
            $sum: { $cond: [{ $eq: ['$stato', 'sovraccarico'] }, 1, 0] }
          }
        }
      },
      { $sort: { temp_media: -1 } },
      {
        $project: {
          _id: 0,
          regione: '$_id',
          temp_media: { $round: ['$temp_media', 1] },
          corrente_media: { $round: ['$corrente_media', 0] },
          num_tratte: 1,
          tratte_in_sovraccarico: 1
        }
      }
    ]);
    res.json(results);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/query/kpi', async (req, res) => {
  try {
    const results = await Traliccio.aggregate([
      {
        $facet: {
          per_stato: [
            { $group: { _id: '$stato_operativo', count: { $sum: 1 } } },
            { $sort: { count: -1 } }
          ],
          per_regione: [
            { $group: { _id: '$regione', count: { $sum: 1 } } },
            { $sort: { count: -1 } }
          ],
          per_tipologia: [
            { $group: { _id: '$tipologia', count: { $sum: 1 } } },
            { $sort: { count: -1 } }
          ],
          totale: [{ $count: 'n' }]
        }
      }
    ]);
    res.json(results);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/query/search', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.status(400).json({ error: 'Parametro q mancante' });
    const results = await Traliccio.aggregate([
      {
        $search: {
          index: 'tralicci_search',
          text: {
            query: q,
            path: ['descrizione', 'nome', 'tipologia', 'regione'],
            fuzzy: { maxEdits: 1 }
          }
        }
      },
      { $limit: 15 },
      {
        $project: {
          codice: 1, nome: 1, tipologia: 1, regione: 1, stato_operativo: 1,
          anno_installazione: 1, tensione_kv: 1, descrizione: 1,
          gis_location: 1,
          score: { $meta: 'searchScore' }
        }
      }
    ]);
    res.json(results);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/query/semantic', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Campo text mancante' });

    // 1. Embedding della query
    const ollamaRes = await fetch(`${process.env.OLLAMA_URL}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'nomic-embed-text', prompt: text })
    });
    if (!ollamaRes.ok) throw new Error(`Ollama HTTP ${ollamaRes.status}`);
    const { embedding } = await ollamaRes.json();
    if (!embedding) throw new Error('Ollama: nessun embedding');

    // 2. Vector Search
    const results = await Traliccio.aggregate([
      {
        $vectorSearch: {
          index: 'tralicci_vector',
          path: 'embedding',
          queryVector: embedding,
          numCandidates: 50,
          limit: 8
        }
      },
      {
        $project: {
          codice: 1, nome: 1, tipologia: 1, regione: 1, stato_operativo: 1,
          anno_installazione: 1, tensione_kv: 1, descrizione: 1,
          gis_location: 1,
          score: { $meta: 'vectorSearchScore' }
        }
      }
    ]);

    // 3. Auto-rileva il modello chat disponibile (esclude embedding)
    let chatModel = process.env.OLLAMA_CHAT_MODEL || null;
    if (!chatModel) {
      try {
        const tagsRes = await fetch(`${process.env.OLLAMA_URL}/api/tags`);
        if (tagsRes.ok) {
          const { models = [] } = await tagsRes.json();
          const chat = models.find(m => !m.name.includes('embed') && !m.name.includes('nomic'));
          chatModel = chat?.name || null;
        }
      } catch (_) {}
    }
    console.log(`→ Semantic: modello chat = ${chatModel || 'nessuno'}`);

    // 4. Risposta LLM in linguaggio naturale
    let summary = null;
    let llmError = null;
    if (chatModel) {
      try {
        const riassunto = results.map(r =>
          `- ${r.codice}: ${r.tipologia} ${r.tensione_kv}kV in ${r.regione}, stato ${r.stato_operativo.replace(/_/g,' ')}, installato nel ${r.anno_installazione}`
        ).join('\n');

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 60000); // 60s timeout

        const llmRes = await fetch(`${process.env.OLLAMA_URL}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            model: chatModel,
            prompt: `Sei un assistente tecnico esperto nella gestione di reti di trasmissione elettrica ad alta tensione.\n\nL'operatore ha effettuato una ricerca semantica con questa descrizione: "${text}"\n\nIl sistema ha trovato questi asset nella banca dati:\n${riassunto}\n\nRispondi in italiano con un paragrafo fluido di 3-4 frasi. Spiega cosa è stato trovato e perché corrisponde alla ricerca, descrivi le caratteristiche tecniche comuni degli asset individuati, segnala eventuali criticità di stato operativo che richiedono attenzione. Usa un tono professionale e tecnico. Non elencare i codici dei singoli tralicci.`,
            stream: false,
            options: { temperature: 0.3 }
          })
        });
        clearTimeout(timeout);

        if (llmRes.ok) {
          const llmData = await llmRes.json();
          summary = llmData.response?.trim() || null;
        } else {
          llmError = `HTTP ${llmRes.status}`;
        }
      } catch (e) {
        llmError = e.name === 'AbortError' ? 'timeout 60s' : e.message;
        console.warn(`LLM error: ${llmError}`);
      }
    } else {
      llmError = 'Nessun modello chat trovato in Ollama. Installa un modello (es: ollama pull llama3)';
    }

    res.json({ results, summary, llmError });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── QUERY E — Tralicci a doppio rischio ($lookup con pipeline interna) ────────
// Tralicci in manutenzione/fuori servizio che hanno anche la tratta cavo critica
router.get('/query/doppio-rischio', async (req, res) => {
  try {
    const results = await Traliccio.aggregate([
      { $match: { stato_operativo: { $in: ['in_manutenzione', 'fuori_servizio'] } } },
      {
        $lookup: {
          from: 'digic_box',
          let: { tid: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $or: [{ $eq: ['$$tid', '$traliccio_da_id'] }, { $eq: ['$$tid', '$traliccio_a_id'] }] },
                    { $in: ['$stato', ['sovraccarico', 'guasto']] }
                  ]
                }
              }
            },
            { $project: { codice: 1, stato: 1, temperatura_cavo_celsius: 1, corrente_ampere: 1 } }
          ],
          as: 'tratte_critiche'
        }
      },
      { $match: { 'tratte_critiche.0': { $exists: true } } },
      {
        $project: {
          codice: 1, regione: 1, tipologia: 1, stato_operativo: 1, tensione_kv: 1,
          gis_location: 1,
          n_tratte_critiche: { $size: '$tratte_critiche' },
          tratte_critiche: 1
        }
      },
      { $sort: { n_tratte_critiche: -1 } },
      { $limit: 50 }
    ]);
    res.json(results);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── QUERY F — Salute linee complete (DigiL → DigiC + Tralicci) ───────────────
// Per ogni linea DigiL: statistiche aggregate su cavi e tralicci della stessa regione
router.get('/query/salute-linee', async (req, res) => {
  try {
    const results = await DigiLBox.aggregate([
      {
        $lookup: {
          from: 'digic_box',
          let: { regioni: '$regioni_attraversate' },
          pipeline: [
            { $match: { $expr: { $in: ['$regione', '$$regioni'] } } },
            {
              $group: {
                _id: null,
                tratte_totali:    { $sum: 1 },
                sovraccarico:     { $sum: { $cond: [{ $eq: ['$stato', 'sovraccarico'] }, 1, 0] } },
                guasto:           { $sum: { $cond: [{ $eq: ['$stato', 'guasto'] }, 1, 0] } },
                temp_media:       { $avg: '$temperatura_cavo_celsius' },
                corrente_media:   { $avg: '$corrente_ampere' }
              }
            }
          ],
          as: 'cavi'
        }
      },
      {
        $lookup: {
          from: 'tralicci',
          let: { regioni: '$regioni_attraversate' },
          pipeline: [
            { $match: { $expr: { $in: ['$regione', '$$regioni'] } } },
            {
              $group: {
                _id: null,
                totale:           { $sum: 1 },
                in_manutenzione:  { $sum: { $cond: [{ $eq: ['$stato_operativo', 'in_manutenzione'] }, 1, 0] } },
                fuori_servizio:   { $sum: { $cond: [{ $eq: ['$stato_operativo', 'fuori_servizio'] }, 1, 0] } }
              }
            }
          ],
          as: 'torri'
        }
      },
      {
        $project: {
          codice: 1, nome_linea: 1, stato: 1,
          disponibilita_percentuale: 1, potenza_mw: 1,
          regioni_attraversate: 1,
          cavi:  { $arrayElemAt: ['$cavi', 0] },
          torri: { $arrayElemAt: ['$torri', 0] }
        }
      },
      { $sort: { disponibilita_percentuale: 1 } }
    ]);
    res.json(results);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── QUERY G — Stress per regione ($group cross-collection) ───────────────────
// Per regione: temp media cavi + corrente + % tralicci non attivi
router.get('/query/stress-regione', async (req, res) => {
  try {
    const results = await DigiCBox.aggregate([
      {
        $group: {
          _id: '$regione',
          temp_media:      { $avg: '$temperatura_cavo_celsius' },
          corrente_media:  { $avg: '$corrente_ampere' },
          tratte_totali:   { $sum: 1 },
          tratte_critiche: { $sum: { $cond: [{ $in: ['$stato', ['sovraccarico', 'guasto']] }, 1, 0] } }
        }
      },
      {
        $lookup: {
          from: 'tralicci',
          let: { reg: '$_id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$regione', '$$reg'] } } },
            {
              $group: {
                _id: null,
                totale:      { $sum: 1 },
                non_attivi:  { $sum: { $cond: [{ $ne: ['$stato_operativo', 'attivo'] }, 1, 0] } }
              }
            }
          ],
          as: 'trl'
        }
      },
      {
        $project: {
          _id: 0,
          regione:          '$_id',
          temp_media:       { $round: ['$temp_media', 1] },
          corrente_media:   { $round: ['$corrente_media', 0] },
          tratte_totali:    1,
          tratte_critiche:  1,
          tralicci_totali:  { $arrayElemAt: ['$trl.totale', 0] },
          tralicci_non_attivi: { $arrayElemAt: ['$trl.non_attivi', 0] },
          pct_non_attivi: {
            $round: [{
              $multiply: [
                { $divide: [{ $arrayElemAt: ['$trl.non_attivi', 0] }, { $arrayElemAt: ['$trl.totale', 0] }] },
                100
              ]
            }, 1]
          }
        }
      },
      { $sort: { temp_media: -1 } }
    ]);
    res.json(results);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── QUERY H — IoT fuori soglia + cavo adiacente (telemetria correlata) ────────
// IoT con vibrazione >30Hz o temperatura >55°C → traliccio → tratta cavo vicina
router.get('/query/iot-estrema', async (req, res) => {
  try {
    const results = await AggettIoTBox.aggregate([
      {
        $match: {
          $or: [
            { 'telemetria.vibrazione_hz':    { $gt: 30 } },
            { 'telemetria.temperatura_celsius': { $gt: 55 } }
          ]
        }
      },
      {
        $lookup: {
          from: 'tralicci',
          localField: 'traliccio_collegato_id',
          foreignField: '_id',
          as: 'traliccio'
        }
      },
      { $unwind: '$traliccio' },
      {
        $lookup: {
          from: 'digic_box',
          let: { tid: '$traliccio_collegato_id' },
          pipeline: [
            {
              $match: {
                $expr: { $or: [{ $eq: ['$traliccio_da_id', '$$tid'] }, { $eq: ['$traliccio_a_id', '$$tid'] }] }
              }
            },
            { $sort: { temperatura_cavo_celsius: -1 } },
            { $limit: 1 },
            { $project: { codice: 1, stato: 1, temperatura_cavo_celsius: 1, corrente_ampere: 1 } }
          ],
          as: 'cavo'
        }
      },
      {
        $project: {
          iot_codice: '$codice',
          vibrazione_hz:    '$telemetria.vibrazione_hz',
          temp_iot:         '$telemetria.temperatura_celsius',
          allarmi_attivi:   1,
          trl_codice:       '$traliccio.codice',
          trl_regione:      '$traliccio.regione',
          trl_stato:        '$traliccio.stato_operativo',
          gis_location:     '$traliccio.gis_location',
          cavo:             { $arrayElemAt: ['$cavo', 0] }
        }
      },
      { $sort: { vibrazione_hz: -1 } },
      { $limit: 50 }
    ]);
    res.json(results);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── QUERY K — $graphLookup (catena elettrica) ─────────────────────────────────
// Partendo da un traliccio, traversa in avanti la rete di tratte DigiC
// mostrando la catena di segmenti cavo raggiungibili in N hop
router.get('/query/grafo', async (req, res) => {
  try {
    const { codice, id, hops = 5 } = req.query;
    if (!codice && !id) return res.status(400).json({ error: 'Parametro codice o id mancante' });

    // maxDepth in $graphLookup conta da 0: maxDepth=N → N+1 segmenti trovati.
    // Per avere esattamente "hops" segmenti passiamo hops-1.
    const maxDepth = Math.min(19, Math.max(0, parseInt(hops) - 1));
    const filter = id
      ? { _id: new mongoose.Types.ObjectId(id) }
      : { codice: codice.trim() };

    const results = await Traliccio.aggregate([
      { $match: filter },
      {
        $graphLookup: {
          from: 'digic_box',
          startWith: '$_id',
          connectFromField: 'traliccio_a_id',
          connectToField: 'traliccio_da_id',
          as: 'catena',
          maxDepth: maxDepth,
          depthField: 'hop'
        }
      },
      // Raccoglie tutti gli ID traliccio di destinazione nella catena
      {
        $lookup: {
          from: 'tralicci',
          let: { ids: { $map: { input: '$catena', as: 'c', in: '$$c.traliccio_a_id' } } },
          pipeline: [
            { $match: { $expr: { $in: ['$_id', '$$ids'] } } },
            { $project: { codice: 1, tipologia: 1, regione: 1, stato_operativo: 1, tensione_kv: 1, gis_location: 1 } }
          ],
          as: 'tralicci_catena'
        }
      },
      {
        $project: {
          codice: 1, nome: 1, tipologia: 1, regione: 1, stato_operativo: 1, tensione_kv: 1, gis_location: 1,
          n_segmenti: { $size: '$catena' },
          catena: {
            $map: {
              input: '$catena',
              as: 'c',
              in: {
                hop:             '$$c.hop',
                digic_codice:    '$$c.codice',
                stato_cavo:      '$$c.stato',
                temp_cavo:       '$$c.temperatura_cavo_celsius',
                lunghezza_km:    '$$c.lunghezza_km',
                traliccio_a_id:  '$$c.traliccio_a_id'
              }
            }
          },
          tralicci_catena: 1
        }
      }
    ]);

    if (!results.length) return res.status(404).json({ error: `Traliccio "${codice || id}" non trovato` });
    res.json(results[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
