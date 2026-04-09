require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

app.use('/api', require('./routes/seed'));
app.use('/api', require('./routes/queries'));

mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('✓ Connesso a MongoDB:', mongoose.connection.host);
    app.listen(process.env.PORT || 3001, () => {
      console.log(`✓ Server su http://localhost:${process.env.PORT || 3001}`);
    });
  })
  .catch(err => {
    console.error('✗ Errore connessione MongoDB:', err.message);
    process.exit(1);
  });
