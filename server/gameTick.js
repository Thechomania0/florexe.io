/**
 * Server-side bullets and squares (traps). Updated in game tick; collisions with mobs call mobs.hitMob.
 */
const { getRoomMobs, hitMob, getMobsSnapshot, updateBeetles, purgeDeadMobs, removeMobsFullyInWall, FOOD_CONFIG, BEETLE_CONFIG } = require('./mobs.js');
const MAP_HALF = 8000;

function distance(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

function ellipseOverlapsCircle(beetle, cx, cy, r) {
  const dx = cx - beetle.x;
  const dy = cy - beetle.y;
  const hitboxScale = (beetle.rarity === 'mythic' || beetle.rarity === 'legendary') ? 0.4 : 1;
  const semiMajor = beetle.size * (25.5 / 64) * hitboxScale;
  const semiMinor = beetle.size * (19.5 / 64) * hitboxScale;
  const a = semiMajor + r;
  const b = semiMinor + r;
  return (dx / a) * (dx / a) + (dy / b) * (dy / b) <= 1;
}

const TRAP_NO_COLLISION_MS = 200;
const MAX_SEPARATION_PER_FRAME = 5;
const BEETLE_SQUARE_SEPARATION_MAX = 4;

// Server-authoritative body contact and inferno AOE (mirrors client config)
const BASE_BODY_DAMAGE = 50;
const LEVEL_SCALE_PER = 0.10;
const INFERNO_BASE_RADIUS = 144;
const INFERNO_DAMAGE_BY_RARITY = { common: 50, uncommon: 75, rare: 100, epic: 125, legendary: 200, mythic: 250, ultra: 500, super: 2000 };
const INFERNO_SIZE_MULT = 1.05;
const INFERNO_SIZE_MULT_ULTRA = 1.07;
const INFERNO_SIZE_MULT_SUPER = 1.10;

function effectiveWeight(w) {
  const n = Math.max(0, Math.min(100, typeof w === 'number' ? w : 1));
  return n === 0 ? 1 : n;
}

function runSquareSquareCollision(squares, dtMs) {
  const now = Date.now();
  for (let i = 0; i < squares.length; i++) {
    const sq = squares[i];
    if (now - sq.spawnedAt < TRAP_NO_COLLISION_MS) continue;
    for (let j = i + 1; j < squares.length; j++) {
      const other = squares[j];
      if (now - other.spawnedAt < TRAP_NO_COLLISION_MS) continue;
      const d = distance(sq.x, sq.y, other.x, other.y);
      const overlap = sq.size + other.size - d;
      if (overlap > 0 && d >= 1e-9) {
        const nx = (sq.x - other.x) / d;
        const ny = (sq.y - other.y) / d;
        const pw = effectiveWeight(sq.weight);
        const po = effectiveWeight(other.weight);
        const totalWeight = pw + po;
        const sep = Math.min(overlap / 2, MAX_SEPARATION_PER_FRAME * (dtMs / 50));
        const moveThis = sep * (po / totalWeight);
        const moveOther = sep * (pw / totalWeight);
        sq.x += nx * moveThis;
        sq.y += ny * moveThis;
        other.x -= nx * moveOther;
        other.y -= ny * moveOther;
      }
    }
  }
}

/** Push beetles out of overlapping squares so they can escape trap clusters. */
function runBeetleSquareRepulsion(beetles, squares, dtMs) {
  const scale = Math.min(1, dtMs / 50);
  for (const beetle of beetles) {
    const hitboxScale = (beetle.rarity === 'mythic' || beetle.rarity === 'legendary') ? 0.4 : 1;
    const semiMajor = (beetle.size != null ? beetle.size * (25.5 / 64) : 20) * hitboxScale;
    for (const sq of squares) {
      const d = distance(beetle.x, beetle.y, sq.x, sq.y);
      const minDist = semiMajor + (sq.size ?? 14);
      const overlap = minDist - d;
      if (overlap > 0 && d >= 1e-9) {
        const nx = (beetle.x - sq.x) / d;
        const ny = (beetle.y - sq.y) / d;
        const separation = Math.min(overlap / 2, BEETLE_SQUARE_SEPARATION_MAX * scale);
        beetle.x += nx * separation;
        beetle.y += ny * separation;
      }
    }
  }
}

const roomBullets = new Map();
const roomSquares = new Map();
let nextBulletId = 1;
let nextSquareId = 1;

function getRoomBullets(room) {
  if (!roomBullets.has(room)) roomBullets.set(room, []);
  return roomBullets.get(room);
}

const MAX_SQUARES_PER_PLAYER = 25;

function getRoomSquares(room) {
  if (!roomSquares.has(room)) roomSquares.set(room, []);
  return roomSquares.get(room);
}

function addBullet(room, data) {
  const damage = Math.max(1, Number(data.damage) || 20);
  const b = {
    id: 'bullet_' + (nextBulletId++),
    ownerId: data.ownerId,
    x: data.x,
    y: data.y,
    angle: data.angle,
    speed: (data.speed || 0.4) * 0.7,
    damage,
    size: (data.size || 6) * 0.7,
    lifetime: data.lifetime != null ? data.lifetime : 3000,
    penetrating: !!data.penetrating,
    weight: data.weight != null ? data.weight : 1,
    maxRange: data.maxRange != null ? data.maxRange : null,
    originX: data.originX != null ? data.originX : data.x,
    originY: data.originY != null ? data.originY : data.y,
    hp: data.hp != null ? data.hp : null,
    hitTargets: [],
  };
  getRoomBullets(room).push(b);
  return b;
}

function addSquare(room, data, roomPlayers) {
  const squares = getRoomSquares(room);
  const ownerId = data.ownerId;
  const maxForOwner = typeof data.maxSquares === 'number' && data.maxSquares > 0 ? data.maxSquares : MAX_SQUARES_PER_PLAYER;
  const ownerSquares = squares.filter((s) => s.ownerId === ownerId).sort((a, b) => (a.spawnedAt || 0) - (b.spawnedAt || 0));
  while (ownerSquares.length >= maxForOwner) {
    const oldest = ownerSquares.shift();
    const idx = squares.indexOf(oldest);
    if (idx >= 0) squares.splice(idx, 1);
  }
  const now = Date.now();
  const rawDuration = data.duration != null ? data.duration : 6000;
  const duration = Math.max(100, Math.min(30000, Number(rawDuration) || 6000));
  let x = typeof data.x === 'number' ? data.x : null;
  let y = typeof data.y === 'number' ? data.y : null;
  if (x == null || y == null || (x === 0 && y === 0)) {
    const ownerPos = getOwnerPosition(room, data.ownerId, roomPlayers || new Map());
    x = typeof x === 'number' ? x : (ownerPos.x ?? 0);
    y = typeof y === 'number' ? y : (ownerPos.y ?? 0);
  }
  const sq = {
    id: 'sq_' + (nextSquareId++),
    ownerId: data.ownerId,
    x,
    y,
    vx: data.vx != null ? data.vx : 0,
    vy: data.vy != null ? data.vy : 0,
    damage: Math.max(1, Number(data.damage) || 50),
    hp: data.hp != null ? data.hp : 800,
    size: data.size != null ? data.size : 25,
    duration,
    rarity: data.rarity || 'common',
    weight: data.weight != null ? data.weight : 1,
    spawnedAt: now,
    isRiotTrap: !!data.isRiotTrap,
    bodyColor: (data.bodyColor && typeof data.bodyColor === 'string') ? data.bodyColor : null,
    rotation: typeof data.rotation === 'number' ? data.rotation : 0,
    angularVelocity: typeof data.angularVelocity === 'number' ? data.angularVelocity : 0,
    maxSquares: typeof data.maxSquares === 'number' && data.maxSquares > 0 ? data.maxSquares : MAX_SQUARES_PER_PLAYER,
  };
  getRoomSquares(room).push(sq);
  return sq;
}

function getOwnerPosition(room, ownerId, roomPlayers) {
  const players = roomPlayers.get(room);
  if (!players) return { x: 0, y: 0 };
  const state = players.get(ownerId);
  if (!state) return { x: 0, y: 0 };
  return { x: state.x || 0, y: state.y || 0 };
}

/** Server-authoritative body contact and inferno AOE damage. */
function applyPlayerBodyAndInfernoDamage(room, roomPlayers, roomPlayerBodies, foodsSnapshot, beetlesSnapshot, dtMs, killPayloads) {
  const players = roomPlayers.get(room);
  const bodies = roomPlayerBodies.get(room);
  if (!players || !bodies) return;
  const dtSec = dtMs / 1000;
  for (const [ownerId, state] of players.entries()) {
    const body = bodies.get(ownerId);
    if (!body || typeof body.x !== 'number' || typeof body.y !== 'number') continue;
    const px = body.x;
    const py = body.y;
    const psize = typeof body.size === 'number' ? body.size : 24.5;
    const level = Math.max(1, typeof state.level === 'number' ? state.level : 1);
    const levelScale = 1 + LEVEL_SCALE_PER * Math.floor((level - 1) / 10);
    const bodyDamagePerSec = BASE_BODY_DAMAGE * levelScale;
    const bodyDmg = bodyDamagePerSec * dtSec;

    for (const food of foodsSnapshot) {
      if (distance(px, py, food.x, food.y) < psize + food.size) {
        const result = hitMob(room, food.id, 'food', bodyDmg, px, py);
        if (result.killed && result.killPayload) killPayloads.push({ socketId: ownerId, payload: result.killPayload });
        const foodDmg = (FOOD_CONFIG[food.rarity] && FOOD_CONFIG[food.rarity].damage) ? FOOD_CONFIG[food.rarity].damage * dtSec : 10 * dtSec;
        state.hp = Math.max(0, (state.hp ?? state.maxHp ?? 500) - foodDmg);
      }
    }
    for (const beetle of beetlesSnapshot) {
      if (ellipseOverlapsCircle(beetle, px, py, psize)) {
        const result = hitMob(room, beetle.id, 'beetle', bodyDmg, px, py);
        if (result.killed && result.killPayload) killPayloads.push({ socketId: ownerId, payload: result.killPayload });
        const beetleDmg = (BEETLE_CONFIG[beetle.rarity] && BEETLE_CONFIG[beetle.rarity].damage) ? BEETLE_CONFIG[beetle.rarity].damage * dtSec : 10 * dtSec;
        state.hp = Math.max(0, (state.hp ?? state.maxHp ?? 500) - beetleDmg);
      }
    }

    const equippedBody = state.equippedBody && typeof state.equippedBody === 'object' ? state.equippedBody : null;
    if (equippedBody && equippedBody.subtype === 'inferno') {
      const r = equippedBody.rarity || 'common';
      const radiusMult = r === 'super' ? INFERNO_SIZE_MULT_SUPER : r === 'ultra' ? INFERNO_SIZE_MULT_ULTRA : INFERNO_SIZE_MULT;
      const radius = INFERNO_BASE_RADIUS * radiusMult;
      const infernoDmgPerSec = INFERNO_DAMAGE_BY_RARITY[r] || 50;
      const infernoDmg = infernoDmgPerSec * dtSec;
      for (const food of foodsSnapshot) {
        if (distance(px, py, food.x, food.y) < radius) {
          const result = hitMob(room, food.id, 'food', infernoDmg, px, py);
          if (result.killed && result.killPayload) killPayloads.push({ socketId: ownerId, payload: result.killPayload });
        }
      }
      for (const beetle of beetlesSnapshot) {
        if (ellipseOverlapsCircle(beetle, px, py, radius)) {
          const result = hitMob(room, beetle.id, 'beetle', infernoDmg, px, py);
          if (result.killed && result.killPayload) killPayloads.push({ socketId: ownerId, payload: result.killPayload });
        }
      }
    }
  }
}

/**
 * Run one game tick for the room (bullets and squares update, collision with mobs). Returns { mobsChanged, killPayloads }.
 */
function tick(room, dtMs, roomPlayers, roomPlayerBodies) {
  const bullets = getRoomBullets(room);
  const squares = getRoomSquares(room);
  const m = getRoomMobs(room);
  const killPayloads = [];
  updateBeetles(room, roomPlayerBodies, dtMs);
  runBeetleSquareRepulsion(m.beetles, squares, dtMs);
  removeMobsFullyInWall(room);

  const foodsSnapshot = [...m.foods];
  const beetlesSnapshot = [...m.beetles];

  for (const bullet of bullets) {
    bullet.x += Math.cos(bullet.angle) * bullet.speed * dtMs;
    bullet.y += Math.sin(bullet.angle) * bullet.speed * dtMs;
    bullet.lifetime -= dtMs;
    if (bullet.maxRange != null && distance(bullet.x, bullet.y, bullet.originX, bullet.originY) > bullet.maxRange)
      bullet.lifetime = 0;
  }
  const bulletsToRemove = new Set();
  for (const bullet of bullets) {
    if (bullet.lifetime <= 0) {
      bulletsToRemove.add(bullet);
      continue;
    }
    const ownerPos = getOwnerPosition(room, bullet.ownerId, roomPlayers);
    const ownerX = ownerPos.x;
    const ownerY = ownerPos.y;
    if (bullet.penetrating) {
      for (const food of foodsSnapshot) {
        if (bullet.hp != null && bullet.hp <= 0) break;
        if (bullet.hitTargets.includes(food.id)) continue;
        if (distance(bullet.x, bullet.y, food.x, food.y) < bullet.size + food.size) {
          bullet.hitTargets.push(food.id);
          const result = hitMob(room, food.id, 'food', bullet.damage, bullet.x, bullet.y);
          if (result.killed && result.killPayload) killPayloads.push({ socketId: bullet.ownerId, payload: result.killPayload });
          if (bullet.hp != null) bullet.hp -= 1;
          if (bullet.hp != null && bullet.hp <= 0) bulletsToRemove.add(bullet);
        }
      }
      for (const beetle of beetlesSnapshot) {
        if (bullet.hp != null && bullet.hp <= 0) break;
        if (bullet.hitTargets.includes(beetle.id)) continue;
        if (ellipseOverlapsCircle(beetle, bullet.x, bullet.y, bullet.size)) {
          bullet.hitTargets.push(beetle.id);
          const result = hitMob(room, beetle.id, 'beetle', bullet.damage, bullet.x, bullet.y);
          if (result.killed && result.killPayload) killPayloads.push({ socketId: bullet.ownerId, payload: result.killPayload });
          if (bullet.hp != null) bullet.hp -= 1;
          if (bullet.hp != null && bullet.hp <= 0) bulletsToRemove.add(bullet);
        }
      }
    } else {
      let hit = false;
      for (const food of foodsSnapshot) {
        if (distance(bullet.x, bullet.y, food.x, food.y) < bullet.size + food.size) {
          const result = hitMob(room, food.id, 'food', bullet.damage, bullet.x, bullet.y);
          if (result.killed && result.killPayload) killPayloads.push({ socketId: bullet.ownerId, payload: result.killPayload });
          hit = true;
          break;
        }
      }
      if (!hit) {
        for (const beetle of beetlesSnapshot) {
          if (ellipseOverlapsCircle(beetle, bullet.x, bullet.y, bullet.size)) {
            const result = hitMob(room, beetle.id, 'beetle', bullet.damage, bullet.x, bullet.y);
            if (result.killed && result.killPayload) killPayloads.push({ socketId: bullet.ownerId, payload: result.killPayload });
            hit = true;
            break;
          }
        }
      }
      if (hit) bulletsToRemove.add(bullet);
    }
  }
  const newBullets = bullets.filter((b) => !bulletsToRemove.has(b));
  roomBullets.set(room, newBullets);

  for (const sq of squares) {
    sq.duration = Math.max(0, sq.duration - dtMs);
    sq.x += sq.vx * (dtMs / 1000);
    sq.y += sq.vy * (dtMs / 1000);
    sq.rotation = (sq.rotation ?? 0) + (sq.angularVelocity ?? 0) * (dtMs / 1000);
    sq.angularVelocity = (sq.angularVelocity ?? 0) * 0.98;
  }
  runSquareSquareCollision(squares, dtMs);
  const maxSquareAgeMs = 30000;
  const now = Date.now();
  for (const sq of squares) {
    if (sq.duration <= 0) continue;
    if (now - sq.spawnedAt > maxSquareAgeMs) continue;
    const dmg = (sq.damage || 50) * (dtMs / 1000);
    for (const food of foodsSnapshot) {
      if (distance(sq.x, sq.y, food.x, food.y) < sq.size + food.size) {
        const result = hitMob(room, food.id, 'food', dmg, sq.x, sq.y);
        if (result.killed && result.killPayload) killPayloads.push({ socketId: sq.ownerId, payload: result.killPayload });
      }
    }
    for (const beetle of beetlesSnapshot) {
      if (ellipseOverlapsCircle(beetle, sq.x, sq.y, sq.size)) {
        const result = hitMob(room, beetle.id, 'beetle', dmg, sq.x, sq.y);
        if (result.killed && result.killPayload) killPayloads.push({ socketId: sq.ownerId, payload: result.killPayload });
      }
    }
  }
  const newSquares = squares.filter((s) => s.duration > 0 && (now - s.spawnedAt) <= maxSquareAgeMs);
  // Cull traps over per-owner limit: remove oldest first until at or below limit
  const byOwner = new Map();
  for (const s of newSquares) {
    if (!byOwner.has(s.ownerId)) byOwner.set(s.ownerId, []);
    byOwner.get(s.ownerId).push(s);
  }
  for (const [, list] of byOwner) {
    list.sort((a, b) => (a.spawnedAt || 0) - (b.spawnedAt || 0));
    const limit = list[0]?.maxSquares ?? MAX_SQUARES_PER_PLAYER;
    const toRemove = list.length - limit;
    if (toRemove <= 0) continue;
    for (let i = 0; i < toRemove; i++) {
      const idx = newSquares.indexOf(list[i]);
      if (idx >= 0) newSquares.splice(idx, 1);
    }
  }
  roomSquares.set(room, newSquares);

  applyPlayerBodyAndInfernoDamage(room, roomPlayers, roomPlayerBodies, foodsSnapshot, beetlesSnapshot, dtMs, killPayloads);

  purgeDeadMobs(room);

  return { killPayloads };
}

function getBulletsSnapshot(room) {
  return getRoomBullets(room).map((b) => ({
    id: b.id,
    ownerId: b.ownerId,
    x: b.x,
    y: b.y,
    angle: b.angle,
    size: b.size,
    lifetime: b.lifetime,
  }));
}

function getSquaresSnapshot(room) {
  return getRoomSquares(room).map((s) => ({
    id: s.id,
    ownerId: s.ownerId,
    x: s.x,
    y: s.y,
    vx: s.vx,
    vy: s.vy,
    damage: s.damage,
    hp: s.hp,
    size: s.size,
    duration: s.duration,
    rarity: s.rarity,
    spawnedAt: s.spawnedAt,
    bodyColor: s.bodyColor || null,
    rotation: s.rotation ?? 0,
    angularVelocity: s.angularVelocity ?? 0,
  }));
}

function clearRoom(room) {
  roomBullets.set(room, []);
  roomSquares.set(room, []);
}

function removePlayerEntities(room, ownerId) {
  const bullets = getRoomBullets(room);
  const squares = getRoomSquares(room);
  const newBullets = bullets.filter((b) => b.ownerId !== ownerId);
  const newSquares = squares.filter((s) => s.ownerId !== ownerId);
  roomBullets.set(room, newBullets);
  roomSquares.set(room, newSquares);
}

/** Remove only squares (traps) owned by ownerId. Used when player unequips Riot/Anchor. */
function removePlayerSquares(room, ownerId) {
  const squares = getRoomSquares(room);
  const newSquares = squares.filter((s) => s.ownerId !== ownerId);
  roomSquares.set(room, newSquares);
}

module.exports = {
  getRoomBullets,
  getRoomSquares,
  addBullet,
  addSquare,
  tick,
  getBulletsSnapshot,
  getSquaresSnapshot,
  clearRoom,
  removePlayerEntities,
  removePlayerSquares,
};
