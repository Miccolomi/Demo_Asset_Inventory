const mongoose = require('mongoose');

const DigiLBoxSchema = new mongoose.Schema({
  codice: String,
  nome_linea: String,
  regioni_attraversate: [String],
  numero_tralicci: Number,
  numero_tratte: Number,
  potenza_mw: Number,
  disponibilita_percentuale: Number,
  stato: String
}, { collection: 'digil_box' });

module.exports = mongoose.model('DigiLBox', DigiLBoxSchema, 'digil_box');
