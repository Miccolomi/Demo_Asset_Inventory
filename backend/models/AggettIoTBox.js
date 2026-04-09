const mongoose = require('mongoose');

const AggettIoTBoxSchema = new mongoose.Schema({
  codice: String,
  traliccio_collegato_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Traliccio' },
  firmware_version: String,
  livello_batteria: Number,
  ultimo_segnale: Date,
  allarmi_attivi: [String],
  telemetria: {
    temperatura_celsius: Number,
    umidita_percentuale: Number,
    vibrazione_hz: Number
  }
}, { collection: 'aggetto_iot_box' });

// Indici per Query C ($lookup sul foreignField + filtri batteria/allarmi)
AggettIoTBoxSchema.index({ traliccio_collegato_id: 1 });
AggettIoTBoxSchema.index({ livello_batteria: 1 });
AggettIoTBoxSchema.index({ allarmi_attivi: 1 });
// Indici per Query H (IoT fuori soglia: $match su campi telemetria)
AggettIoTBoxSchema.index({ 'telemetria.vibrazione_hz': 1 });
AggettIoTBoxSchema.index({ 'telemetria.temperatura_celsius': 1 });

module.exports = mongoose.model('AggettIoTBox', AggettIoTBoxSchema, 'aggetto_iot_box');
