const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { getProgress, saveProgress } = require('./store.js');

const app = express();
const PORT = process.env.PORT || 53134;
const USERS_FILE = path.join(__dirname, 'data', 'users.json');
const MAPS_FILE = path.join(__dirname, 'data', 'maps.json');

// Allow requests from GitHub Pages (florexe.io) and localhost for progress/auth API
const CORS_ORIGINS = [
  'https://florexe.io',
  'https://www.florexe.io',
  'http://localhost:53134',
  'http://127.0.0.1:53134',
];
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && CORS_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json());
app.use(express.static(path.join(__dirname, '..')));

/** Validate Discord OAuth token and return Discord user id or null. Uses Discord API. */
async function getDiscordIdFromToken(bearerToken) {
  const token = (bearerToken || '').trim();
  if (!token) return null;
  try {
    const res = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: 'Bearer ' + token },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.id ? String(data.id) : null;
  } catch (e) {
    return null;
  }
}

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
  const discordId = (req.query.discordId || '').toString();
  const users = loadUsers();
  if (!(username in users)) return res.json({ taken: false });
  // Same user already has this username (e.g. re-setting after clearing localStorage) → not taken for them
  if (discordId && users[username] === discordId) return res.json({ taken: false });
  res.json({ taken: true });
});

app.get('/api/username/me', async (req, res) => {
  const auth = req.headers.authorization;
  const token = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const discordId = await getDiscordIdFromToken(token);
  if (!discordId) return res.status(401).json({ error: 'Invalid or missing Discord token' });
  const users = loadUsers();
  const d = String(discordId);
  for (const [key, val] of Object.entries(users)) {
    if (val === d) return res.json({ username: key });
  }
  res.json({ username: null });
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

// ---------- Game progress (server-side save, keyed by Discord id) ----------
app.get('/api/progress', async (req, res) => {
  const auth = req.headers.authorization;
  const token = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const discordId = await getDiscordIdFromToken(token);
  if (!discordId) return res.status(401).json({ error: 'Invalid or missing Discord token' });
  const key = String(discordId);
  const raw = getProgress(key);
  const progress = raw && typeof raw === 'object' ? raw : null;
  if (progress) {
    console.log('[progress] GET', key, 'level', progress.level, 'inventory', (progress.inventory || []).length);
  }
  res.json(progress || {});
});

app.post('/api/progress', express.json(), async (req, res) => {
  const auth = req.headers.authorization;
  const token = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const discordId = await getDiscordIdFromToken(token);
  if (!discordId) return res.status(401).json({ error: 'Invalid or missing Discord token' });
  const key = String(discordId);
  const p = req.body && typeof req.body === 'object' ? req.body : {};
  const progress = {
    inventory: Array.isArray(p.inventory) ? p.inventory : [],
    hand: Array.isArray(p.hand) ? p.hand : [],
    equippedTank: p.equippedTank && typeof p.equippedTank === 'object' ? p.equippedTank : null,
    equippedBody: p.equippedBody && typeof p.equippedBody === 'object' ? p.equippedBody : null,
    level: typeof p.level === 'number' && p.level >= 1 ? Math.min(100, p.level) : 1,
    xp: typeof p.xp === 'number' ? Math.max(0, p.xp) : 0,
    stars: typeof p.stars === 'number' ? Math.max(0, p.stars) : 0,
    score: typeof p.score === 'number' ? Math.max(0, p.score) : 0,
  };
  saveProgress(key, progress);
  console.log('[progress] POST', key, 'level', progress.level, 'inventory', progress.inventory.length);
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

// ---------- Multiplayer: WebSocket (Socket.io) ----------
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CORS_ORIGINS, methods: ['GET', 'POST'] },
});

/** Room name from gamemode. state = { x, y, angle, hp, maxHp, level, displayName, equippedTank, equippedBody, size }. */
const roomPlayers = new Map();

function getRoomPlayers(room) {
  if (!roomPlayers.has(room)) roomPlayers.set(room, new Map());
  return roomPlayers.get(room);
}

function broadcastPlayers(room) {
  const players = getRoomPlayers(room);
  const list = Array.from(players.entries()).map(([id, state]) => ({ id, ...state }));
  io.to(room).emit('players', list);
}

io.on('connection', (socket) => {
  socket.on('join', (data) => {
    const room = (data && data.gamemode) ? String(data.gamemode) : 'ffa';
    const state = data && typeof data === 'object' ? {
      x: typeof data.x === 'number' ? data.x : 0,
      y: typeof data.y === 'number' ? data.y : 0,
      angle: typeof data.angle === 'number' ? data.angle : 0,
      hp: typeof data.hp === 'number' ? data.hp : 500,
      maxHp: typeof data.maxHp === 'number' ? data.maxHp : 500,
      level: typeof data.level === 'number' ? data.level : 1,
      displayName: typeof data.displayName === 'string' ? data.displayName.slice(0, 50) : 'Player',
      equippedTank: data.equippedTank && typeof data.equippedTank === 'object' ? data.equippedTank : null,
      equippedBody: data.equippedBody && typeof data.equippedBody === 'object' ? data.equippedBody : null,
      size: typeof data.size === 'number' ? data.size : 24.5,
    } : {};
    socket.join(room);
    getRoomPlayers(room).set(socket.id, state);
    broadcastPlayers(room);
  });

  socket.on('state', (data) => {
    const room = Array.from(socket.rooms).find(r => r !== socket.id);
    if (!room) return;
    const state = data && typeof data === 'object' ? {
      x: typeof data.x === 'number' ? data.x : 0,
      y: typeof data.y === 'number' ? data.y : 0,
      angle: typeof data.angle === 'number' ? data.angle : 0,
      hp: typeof data.hp === 'number' ? data.hp : 500,
      maxHp: typeof data.maxHp === 'number' ? data.maxHp : 500,
      level: typeof data.level === 'number' ? data.level : 1,
      displayName: typeof data.displayName === 'string' ? data.displayName.slice(0, 50) : 'Player',
      equippedTank: data.equippedTank && typeof data.equippedTank === 'object' ? data.equippedTank : null,
      equippedBody: data.equippedBody && typeof data.equippedBody === 'object' ? data.equippedBody : null,
      size: typeof data.size === 'number' ? data.size : 24.5,
    } : {};
    getRoomPlayers(room).set(socket.id, state);
    broadcastPlayers(room);
  });

  socket.on('disconnect', () => {
    for (const room of socket.rooms) {
      if (room === socket.id) continue;
      getRoomPlayers(room).delete(socket.id);
      broadcastPlayers(room);
    }
  });
});

server.listen(PORT, () => {
  console.log(`App listening at http://localhost:${PORT}`);
});
