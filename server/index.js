const path = require('path');
const fs = require('fs');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 53134;
const USERS_FILE = path.join(__dirname, 'data', 'users.json');
const MAPS_FILE = path.join(__dirname, 'data', 'maps.json');

function loadUsers() {
  try {
    const s = fs.readFileSync(USERS_FILE, 'utf8');
    const data = JSON.parse(s);
    return typeof data === 'object' && data !== null ? data : {};
  } catch (e) {
    return {};
  }
}

function saveUsers(users) {
  fs.mkdirSync(path.dirname(USERS_FILE), { recursive: true });
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
}

app.use(express.json());
app.use(express.static(path.join(__dirname, '..')));

app.get('/api/username/check', (req, res) => {
  const username = (req.query.username || '').trim().toLowerCase();
  if (!username) return res.json({ taken: false });
  const users = loadUsers();
  res.json({ taken: username in users });
});

app.post('/api/username/register', (req, res) => {
  const { username, discordId } = req.body || {};
  const u = (String(username || '')).trim();
  const d = String(discordId || '');
  if (!u || !d) return res.status(400).json({ ok: false, error: 'username and discordId required' });
  if (u.length > 50) return res.status(400).json({ ok: false, error: 'username too long' });
  const key = u.toLowerCase();
  const users = loadUsers();
  if (key in users && users[key] !== d) return res.status(409).json({ ok: false, error: 'username already taken' });
  users[key] = d;
  saveUsers(users);
  res.json({ ok: true });
});

function loadMaps() {
  try {
    const s = fs.readFileSync(MAPS_FILE, 'utf8');
    const data = JSON.parse(s);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    return [];
  }
}

function saveMaps(maps) {
  fs.mkdirSync(path.dirname(MAPS_FILE), { recursive: true });
  fs.writeFileSync(MAPS_FILE, JSON.stringify(maps, null, 2), 'utf8');
}

app.get('/api/maps', (req, res) => {
  const maps = loadMaps();
  res.json(maps.map(m => ({ id: m.id, name: m.name, createdAt: m.createdAt })));
});

app.get('/api/maps/:id', (req, res) => {
  const maps = loadMaps();
  const m = maps.find(x => x.id === req.params.id);
  if (!m) return res.status(404).json({ error: 'Map not found' });
  res.json(m);
});

app.post('/api/maps', (req, res) => {
  const { id: existingId, name, grid } = req.body || {};
  const n = (String(name || '')).trim() || 'Unnamed';
  if (!grid || !Array.isArray(grid) || grid.length !== 400) {
    return res.status(400).json({ ok: false, error: 'Invalid grid' });
  }
  const maps = loadMaps();
  const id = existingId || 'map_' + Date.now();
  const createdAt = maps.find(m => m.id === id)?.createdAt || Date.now();
  const idx = maps.findIndex(m => m.id === id);
  const entry = { id, name: n, grid, createdAt };
  if (idx >= 0) maps[idx] = entry;
  else maps.push(entry);
  saveMaps(maps);
  res.json({ ok: true, id });
});

app.delete('/api/maps/:id', (req, res) => {
  const maps = loadMaps().filter(m => m.id !== req.params.id);
  saveMaps(maps);
  res.json({ ok: true });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});

app.get('/auth/discord', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'auth', 'discord', 'index.html'));
});

app.get('/map-editor.html', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'map-editor.html'));
});

app.listen(PORT, () => {
  console.log(`App listening at http://localhost:${PORT}`);
});
