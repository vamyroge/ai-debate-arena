require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const debateRoutes = require('./routes/debate');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../client')));

app.use('/api', debateRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`AI Debate Arena running on http://localhost:${PORT}`);
});

module.exports = app;
