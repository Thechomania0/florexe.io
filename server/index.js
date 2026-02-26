const path = require('path');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 53134;

app.use(express.static(path.join(__dirname, '..')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});

app.get('/auth/discord', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'dashboard.html'));
});

app.get('/map-editor.html', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'map-editor.html'));
});

app.listen(PORT, () => {
  console.log(`App listening at http://localhost:${PORT}`);
});
