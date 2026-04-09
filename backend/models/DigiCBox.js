const mongoose = require('mongoose');

const DigiCBoxSchema = new mongoose.Schema({
  codice: String,
  traliccio_da_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Traliccio' },
  traliccio_a_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Traliccio' },
  regione: String,
  lunghezza_km: Number,
  tensione_kv: Number,
  temperatura_cavo_celsius: Number,
  corrente_ampere: Number,
  stato: String
}, { collection: 'digic_box' });

// Indice per Query C ($group per regione + filtro stato)
DigiCBoxSchema.index({ regione: 1, stato: 1 });
// Indici per Query E (doppio rischio: lookup per traliccio_da_id / traliccio_a_id + filtro stato)
DigiCBoxSchema.index({ traliccio_da_id: 1, stato: 1 });
DigiCBoxSchema.index({ traliccio_a_id: 1, stato: 1 });

module.exports = mongoose.model('DigiCBox', DigiCBoxSchema, 'digic_box');
