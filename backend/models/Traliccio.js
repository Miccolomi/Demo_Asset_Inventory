const mongoose = require('mongoose');

const TraliccioSchema = new mongoose.Schema({
  codice: String,
  nome: String,
  tipologia: String,
  tensione_kv: Number,
  regione: String,
  stato_operativo: String,
  anno_installazione: Number,
  descrizione: String,
  gis_location: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], required: true }
  },
  embedding: { type: [Number], select: false }
}, { collection: 'tralicci' });

TraliccioSchema.index({ gis_location: '2dsphere' });
TraliccioSchema.index({ stato_operativo: 1 });          // Query B ($near filter) + E (doppio rischio $match)
TraliccioSchema.index({ regione: 1, stato_operativo: 1 }); // Query G (stress-regione $lookup)

module.exports = mongoose.model('Traliccio', TraliccioSchema, 'tralicci');
