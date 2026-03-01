const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { getProgress, saveProgress } = require('./store.js');

process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err && err.message ? err.message : err);
  if (err && err.stack) console.error(err.stack);
  process.exit(1);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('[unhandledRejection]', reason);
  process.exit(1);
});

const app = express();
const PORT = process.env.PORT || 53134;
const USERS_FILE = path.join(__dirname, 'data', 'users.json');
const MAPS_FILE = path.join(__dirname, 'data', 'maps.json');

// Allow requests from GitHub Pages (florexe.io), Railway, and localhost for progress/auth API
const CORS_ORIGINS = [
  'https://florexe.io',
  'https://www.florexe.io',
  'http://localhost:53134',
  'http://127.0.0.1:53134',
];
function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (CORS_ORIGINS.includes(origin)) return true;
  // Any Railway deployment (production or preview)
  if (/\.railway\.app$/.test(new URL(origin).hostname)) return true;
  return false;
}
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(origin)) {
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

app.get('/health', (req, res) => res.status(200).send('ok'));

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

const {
  getRoomMobs,
  runSpawn,
  hitMob,
  getMobsSnapshot,
  SPAWN_INTERVAL_MS,
  FOOD_TARGET,
  BEETLE_TARGET,
} = require('./mobs.js');
const {
  addBullet,
  addSquare,
  tick,
  getBulletsSnapshot,
  getSquaresSnapshot,
  removePlayerEntities,
  removePlayerSquares,
} = require('./gameTick.js');
const { ensureOverlordDrones, ensureHiveDrones, getDronesSnapshot, removePlayerDrones } = require('./drones.js');
const { getDefaultMap } = require('./map.js');

/** Room name from gamemode. state = { x, y, angle, hp, maxHp, level, displayName, equippedTank, equippedBody, size }. */
const roomPlayers = new Map();
/** Server-side player bodies: room -> Map(socketId -> { x, y, size }). Updated on join/state so beetles chase exact positions. */
const roomPlayerBodies = new Map();
const roomMobsSeq = new Map();
const roomSpawnIntervals = new Map();
const TICK_MS = 5;
const roomTickIntervals = new Map();

function getRoomPlayers(room) {
  if (!roomPlayers.has(room)) roomPlayers.set(room, new Map());
  return roomPlayers.get(room);
}

/** Get server-side player bodies (circle position + size) for beetle targeting. Synced from state on join/state. */
function getRoomPlayerBodies(room) {
  if (!roomPlayerBodies.has(room)) roomPlayerBodies.set(room, new Map());
  return roomPlayerBodies.get(room);
}

/** Update one player's body from state. Call after setting state so beetles use same position. */
function setPlayerBody(room, socketId, state) {
  const bodies = getRoomPlayerBodies(room);
  const x = typeof state.x === 'number' ? state.x : 0;
  const y = typeof state.y === 'number' ? state.y : 0;
  const size = typeof state.size === 'number' ? state.size : 24.5;
  bodies.set(socketId, { x, y, size });
}

function broadcastPlayers(room) {
  const players = getRoomPlayers(room);
  const list = Array.from(players.entries()).map(([id, state]) => ({ id, ...state }));
  io.to(room).emit('players', list);
}

function getMobsPayload(room) {
  const snapshot = getMobsSnapshot(room);
  const seq = (roomMobsSeq.get(room) || 0) + 1;
  roomMobsSeq.set(room, seq);
  return { ...snapshot, seq };
}

function startSpawnInterval(room) {
  if (roomSpawnIntervals.has(room)) return;
  const m = getRoomMobs(room);
  while (m.foods.length < Math.min(FOOD_TARGET, 200)) runSpawn(room);
  while (m.beetles.length < Math.min(BEETLE_TARGET, 200)) runSpawn(room);
  const interval = setInterval(() => {
    runSpawn(room);
    io.to(room).emit('mobs', getMobsPayload(room));
  }, SPAWN_INTERVAL_MS);
  roomSpawnIntervals.set(room, interval);
}

function startGameTick(room) {
  if (roomTickIntervals.has(room)) return;
  const interval = setInterval(() => {
    const players = getRoomPlayers(room);
    if (players.size === 0) return;
    const result = tick(room, TICK_MS, roomPlayers, roomPlayerBodies);
    // Snapshot must be after tick so dead mobs are removed and replacements included (#5 respawn doc).
    io.to(room).emit('mobs', getMobsPayload(room));
    io.to(room).emit('bullets', getBulletsSnapshot(room));
    io.to(room).emit('squares', getSquaresSnapshot(room));
    io.to(room).emit('drones', getDronesSnapshot(room, roomPlayers, roomPlayerBodies));
    for (const { socketId, payload } of result.killPayloads) {
      io.to(socketId).emit('kill', payload);
    }
  }, TICK_MS);
  roomTickIntervals.set(room, interval);
}

io.on('connection', (socket) => {
  socket.on('join', (data) => {
    try {
      const room = ((data && data.gamemode) ? String(data.gamemode) : 'ffa').toLowerCase();
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
      setPlayerBody(room, socket.id, state);
      broadcastPlayers(room);
      startSpawnInterval(room);
      startGameTick(room);
      socket.emit('map', getDefaultMap());
      socket.emit('mobs', getMobsPayload(room));
      socket.emit('bullets', getBulletsSnapshot(room));
      socket.emit('squares', getSquaresSnapshot(room));
      socket.emit('drones', getDronesSnapshot(room, roomPlayers, roomPlayerBodies));
    } catch (err) {
      console.error('[join]', err && err.message ? err.message : err);
      if (err && err.stack) console.error(err.stack);
    }
  });

  socket.on('state', (data) => {
    const room = Array.from(socket.rooms).find(r => r !== socket.id && r.length > 0);
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
      targetX: typeof data.targetX === 'number' ? data.targetX : null,
      targetY: typeof data.targetY === 'number' ? data.targetY : null,
    } : {};
    getRoomPlayers(room).set(socket.id, state);
    setPlayerBody(room, socket.id, state);
    broadcastPlayers(room);
  });

  socket.on('hit', (data) => {
    const room = Array.from(socket.rooms).find(r => r !== socket.id && r.length > 0);
    if (!room || !data || typeof data !== 'object') return;
    const mobId = data.mobId;
    const mobType = data.mobType === 'beetle' ? 'beetle' : 'food';
    const damage = Math.max(0, Number(data.damage) || 0);
    const sourceX = typeof data.impactX === 'number' ? data.impactX : (typeof data.x === 'number' ? data.x : 0);
    const sourceY = typeof data.impactY === 'number' ? data.impactY : (typeof data.y === 'number' ? data.y : 0);
    const result = hitMob(room, mobId, mobType, damage, sourceX, sourceY);
    if (result.killed && result.killPayload) {
      socket.emit('kill', result.killPayload);
    }
    io.to(room).emit('mobs', getMobsPayload(room));
  });

  socket.on('shoot', (data) => {
    const room = Array.from(socket.rooms).find(r => r !== socket.id && r.length > 0);
    if (!room || !data) return;
    const list = Array.isArray(data) ? data : (data.bullets ? data.bullets : [data]);
    for (const b of list) {
      if (b && typeof b === 'object') {
        addBullet(room, {
          ownerId: socket.id,
          x: typeof b.x === 'number' ? b.x : 0,
          y: typeof b.y === 'number' ? b.y : 0,
          angle: typeof b.angle === 'number' ? b.angle : 0,
          speed: b.speed,
          damage: b.damage,
          size: b.size,
          lifetime: b.lifetime,
          penetrating: b.penetrating,
          weight: b.weight,
          maxRange: b.maxRange,
          hp: b.hp,
          originX: b.originX,
          originY: b.originY,
        });
      }
    }
    io.to(room).emit('bullets', getBulletsSnapshot(room));
  });

  socket.on('square', (data) => {
    const room = Array.from(socket.rooms).find(r => r !== socket.id && r.length > 0);
    if (!room || !data || typeof data !== 'object') return;
    addSquare(room, {
      ownerId: socket.id,
      x: data.x,
      y: data.y,
      vx: data.vx,
      vy: data.vy,
      damage: data.damage,
      hp: data.hp,
      size: data.size,
      duration: data.duration,
      rarity: data.rarity,
      weight: data.weight,
      isRiotTrap: data.isRiotTrap,
      maxSquares: data.maxSquares,
      bodyColor: data.bodyColor,
      rotation: typeof data.rotation === 'number' ? data.rotation : 0,
      angularVelocity: typeof data.angularVelocity === 'number' ? data.angularVelocity : 0,
    }, roomPlayers);
    io.to(room).emit('squares', getSquaresSnapshot(room));
  });

  socket.on('clearSquares', () => {
    const room = Array.from(socket.rooms).find(r => r !== socket.id && r.length > 0);
    if (!room) return;
    removePlayerSquares(room, socket.id);
    io.to(room).emit('squares', getSquaresSnapshot(room));
  });

  socket.on('disconnecting', () => {
    const leftId = socket.id;
    const rooms = Array.from(socket.rooms).filter((r) => r !== leftId);
    for (const room of rooms) {
      getRoomPlayers(room).delete(leftId);
      getRoomPlayerBodies(room).delete(leftId);
      removePlayerEntities(room, leftId);
      removePlayerDrones(room, leftId);
      io.to(room).emit('playerLeft', { id: leftId });
      broadcastPlayers(room);
      io.to(room).emit('bullets', getBulletsSnapshot(room));
      io.to(room).emit('squares', getSquaresSnapshot(room));
      if (getRoomPlayers(room).size === 0) {
        if (roomSpawnIntervals.has(room)) {
          clearInterval(roomSpawnIntervals.get(room));
          roomSpawnIntervals.delete(room);
        }
        if (roomTickIntervals.has(room)) {
          clearInterval(roomTickIntervals.get(room));
          roomTickIntervals.delete(room);
        }
      }
    }
  });

  socket.on('disconnect', () => {});
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`App listening on port ${PORT} (PORT env: ${process.env.PORT || 'not set'})`);
  setImmediate(() => {
    try {
      require('./map.js').getDefaultMap();
    } catch (e) {
      console.warn('[startup] Map preload:', e && e.message ? e.message : e);
    }
  });
});

function shutdown(signal) {
  console.log(`[${signal}] Shutting down...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
