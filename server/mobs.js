/**
 * Server-authoritative mob state per room. Syncs food and beetle spawn/death across all clients.
 * Mirrors client config (hp, drops) for loot calculation.
 * Uses Centralia zones.grid for spawn so mobs align with map pixels/units.
 */
const { isPointInWall, getDefaultMap, getRandomPointInPlayableZoneFromZones, isPointInWallCell, isCircleFullyInWall } = require('./map.js');

// Fallback zones only when Centralia has no zones (should not happen)
const MAP_HALF = 8000;
const ZONE_NURSERY = { minX: -1200, maxX: 1200, minY: -1200, maxY: 1200, rarityWeights: { common: 60, uncommon: 40 } };

/** Returns { x, y, rarityWeights } so spawns use zone-based rarity. Uses Centralia zones.grid when available. */
function getRandomPointAndRarityInPlayableZone() {
  const map = getDefaultMap();
  if (map.zones && map.walls && map.walls.length > 0) {
    const pt = getRandomPointInPlayableZoneFromZones(map.zones, map.walls);
    if (pt) return pt;
  }
  for (let k = 0; k < 50; k++) {
    const x = ZONE_NURSERY.minX + Math.random() * (ZONE_NURSERY.maxX - ZONE_NURSERY.minX);
    const y = ZONE_NURSERY.minY + Math.random() * (ZONE_NURSERY.maxY - ZONE_NURSERY.minY);
    if (!isPointInWall(x, y)) return { x, y, rarityWeights: ZONE_NURSERY.rarityWeights };
  }
  return { x: 0, y: 0, rarityWeights: { common: 60, uncommon: 40 } };
}

const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'ultra', 'super'];

const FOOD_CONFIG = {
  common: { hp: 10, size: 12, weight: 1, drops: { common: 0.8, uncommon: 0.2 }, stars: 0 },
  uncommon: { hp: 40, size: 18, weight: 9, drops: { common: 0.5, uncommon: 0.5 }, stars: 0 },
  rare: { hp: 150, size: 24, weight: 19, drops: { uncommon: 0.8, rare: 0.2 }, stars: 0 },
  epic: { hp: 1000, size: 30, weight: 29, drops: { uncommon: 0.06, rare: 0.8, epic: 0.14 }, stars: 0 },
  legendary: { hp: 8000, size: 42, weight: 39, drops: { rare: 0.1, epic: 0.8, legendary: 0.1 }, stars: 0 },
  mythic: { hp: 25000, size: 54, weight: 59, drops: { epic: 0.07, legendary: 0.9, mythic: 0.03 }, stars: 0 },
  ultra: { hp: 300000, size: 68, weight: 79, drops: { legendary: 0.845, mythic: 0.15, ultra: 0.005 }, stars: 0 },
  super: { hp: 20000000, size: 90, weight: 90, drops: { mythic: 0.77, ultra: 0.23 }, stars: 5000 },
};

const BEETLE_CONFIG = {
  common: { hp: 10, size: 24, weight: 1, vision: 200, drops: { common: 0.8, uncommon: 0.2 }, stars: 0 },
  uncommon: { hp: 40, size: 36, weight: 10, vision: 250, drops: { common: 0.5, uncommon: 0.5 }, stars: 0 },
  rare: { hp: 150, size: 48, weight: 20, vision: 300, drops: { uncommon: 0.8, rare: 0.2 }, stars: 0 },
  epic: { hp: 1000, size: 60, weight: 30, vision: 400, drops: { uncommon: 0.06, rare: 0.8, epic: 0.14 }, stars: 0 },
  legendary: { hp: 8000, size: 84, weight: 40, vision: 600, drops: { rare: 0.1, epic: 0.8, legendary: 0.1 }, stars: 0 },
  mythic: { hp: 25000, size: 108, weight: 60, vision: 800, drops: { epic: 0.07, legendary: 0.9, mythic: 0.03 }, stars: 0 },
  ultra: { hp: 300000, size: 170, weight: 80, vision: 1000, drops: { legendary: 0.845, mythic: 0.15, ultra: 0.005 }, stars: 0 },
  super: { hp: 20000000, size: 405, weight: 99, vision: 1200, drops: { mythic: 0.77, ultra: 0.23 }, stars: 5000 },
};

const SPAWN_WEIGHTS = { common: 100, uncommon: 50, rare: 25, epic: 12, legendary: 6, mythic: 3, ultra: 1, super: 0.1 };
const FOOD_TARGET = 800;
const BEETLE_TARGET = 800;
const SPAWN_BATCH_FOOD = 140;
const SPAWN_BATCH_BEETLE = 140;
const SPAWN_INTERVAL_MS = 8666;
const RESPAWN_DELAY_MS = 8000;
const DEATH_EXCLUSION_MS = 20000;
const MIN_DEATH_DISTANCE = 800;
/** Treat HP at or below this as dead (avoids floating-point edge cases where common/uncommon mobs survive with ~1e-15 hp under high DPS). */
const HP_DEAD_EPSILON = 1e-6;

const roomRecentDeaths = new Map();

function pickRandomWeighted(weights) {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  let total = 0;
  for (const [, w] of entries) total += w;
  let r = Math.random() * total;
  for (const [rarity, w] of entries) {
    r -= w;
    if (r <= 0) return rarity;
  }
  return entries[entries.length - 1][0];
}

const roomMobs = new Map();

function getRoomMobs(room) {
  if (!roomMobs.has(room)) {
    roomMobs.set(room, {
      foods: [],
      beetles: [],
      nextId: 1,
      spawnTimer: 0,
      hasNaturalSuperFood: false,
      hasNaturalSuperBeetle: false,
      lastKillTime: 0,
    });
  }
  return roomMobs.get(room);
}

function recordDeath(room, x, y) {
  if (!roomRecentDeaths.has(room)) roomRecentDeaths.set(room, []);
  const list = roomRecentDeaths.get(room);
  list.push({ x, y, at: Date.now() });
  const cutoff = Date.now() - DEATH_EXCLUSION_MS;
  while (list.length > 0 && list[0].at < cutoff) list.shift();
  if (list.length > 80) list.splice(0, list.length - 50);
}

function isNearRecentDeath(room, x, y) {
  const list = roomRecentDeaths.get(room);
  if (!list || list.length === 0) return false;
  const now = Date.now();
  for (const d of list) {
    if (now - d.at > DEATH_EXCLUSION_MS) continue;
    if (Math.hypot(x - d.x, y - d.y) < MIN_DEATH_DISTANCE) return true;
  }
  return false;
}

function randomRarityFromZone(rarityWeights, spawnType, m) {
  let rarity = pickRandomWeighted(rarityWeights);
  if (rarity === 'super') {
    if (spawnType === 'food' && m.hasNaturalSuperFood) rarity = 'ultra';
    else if (spawnType === 'beetle' && m.hasNaturalSuperBeetle) rarity = 'ultra';
  }
  return rarity;
}

function spawnFood(room) {
  const m = getRoomMobs(room);
  if (m.foods.length >= FOOD_TARGET) return;
  const now = Date.now();
  if (now - (m.lastKillTime || 0) < RESPAWN_DELAY_MS) return;
  let pt;
  for (let retry = 0; retry < 50; retry++) {
    pt = getRandomPointAndRarityInPlayableZone();
    if (!pt) break;
    if (!isNearRecentDeath(room, pt.x, pt.y)) break;
  }
  if (!pt || isNearRecentDeath(room, pt.x, pt.y)) return;
  const rarity = randomRarityFromZone(pt.rarityWeights, 'food', m);
  if (rarity === 'super') m.hasNaturalSuperFood = true;
  const cfg = FOOD_CONFIG[rarity];
  const id = 'f_' + (m.nextId++);
  const food = {
    id,
    x: pt.x,
    y: pt.y,
    rarity,
    hp: cfg.hp,
    maxHp: cfg.hp,
    size: cfg.size,
    weight: cfg.weight,
    natural: true,
  };
  m.foods.push(food);
  return food;
}
function spawnBeetle(room) {
  const m = getRoomMobs(room);
  if (m.beetles.length >= BEETLE_TARGET) return;
  const now = Date.now();
  if (now - (m.lastKillTime || 0) < RESPAWN_DELAY_MS) return;
  let pt;
  for (let retry = 0; retry < 50; retry++) {
    pt = getRandomPointAndRarityInPlayableZone();
    if (!pt) break;
    if (!isNearRecentDeath(room, pt.x, pt.y)) break;
  }
  if (!pt || isNearRecentDeath(room, pt.x, pt.y)) return;
  const rarity = randomRarityFromZone(pt.rarityWeights, 'beetle', m);
  if (rarity === 'super') m.hasNaturalSuperBeetle = true;
  const cfg = BEETLE_CONFIG[rarity];
  const id = 'b_' + (m.nextId++);
  const beetle = {
    id,
    x: pt.x,
    y: pt.y,
    rarity,
    hp: cfg.hp,
    maxHp: cfg.hp,
    size: cfg.size,
    weight: cfg.weight,
    natural: true,
    vx: 0,
    vy: 0,
    vision: cfg.vision ?? 1000,
  };
  m.beetles.push(beetle);
  return beetle;
}

function runSpawn(room) {
  const m = getRoomMobs(room);
  for (let i = 0; i < SPAWN_BATCH_FOOD && m.foods.length < FOOD_TARGET; i++) spawnFood(room);
  for (let i = 0; i < SPAWN_BATCH_BEETLE && m.beetles.length < BEETLE_TARGET; i++) spawnBeetle(room);
}

function rollDrop(drops) {
  if (!drops || Object.keys(drops).length === 0) return null;
  const r = pickRandomWeighted(drops);
  if (!r) return null;
  const bodySubtypes = ['inferno', 'ziggurat', 'cutter', 'hive'];
  const tankSubtypes = ['destroyer', 'anchor', 'riot', 'overlord', 'streamliner'];
  const allSubtypes = [...bodySubtypes, ...tankSubtypes];
  const subtype = allSubtypes[Math.floor(Math.random() * allSubtypes.length)];
  const type = bodySubtypes.includes(subtype) ? 'body' : 'tank';
  return { type, subtype, rarity: r };
}

function rollBeetleDrop(drops) {
  if (!drops || Object.keys(drops).length === 0) return null;
  const r = pickRandomWeighted(drops);
  return r ? { type: 'petal', subtype: 'egg', rarity: r } : null;
}

/**
 * Apply damage to a mob. Returns { killed: true, killPayload } for the hitter if mob died, else { killed: false }.
 */
function hitMob(room, mobId, mobType, damage, playerX, playerY) {
  const m = getRoomMobs(room);
  const maxRange = 2500;
  const sid = mobId != null ? String(mobId) : null;
  const dmg = Math.max(0, Number(damage)) || 0;
  if (mobType === 'food') {
    const idx = sid != null ? m.foods.findIndex((f) => String(f.id) === sid) : -1;
    if (idx < 0) return { killed: false };
    const food = m.foods[idx];
    const d = Math.hypot(food.x - playerX, food.y - playerY);
    if (d > maxRange) return { killed: false };
    food.hp -= dmg;
    if (food.hp <= HP_DEAD_EPSILON) {
      recordDeath(room, food.x, food.y);
      m.lastKillTime = Date.now();
      m.foods.splice(idx, 1);
      const cfg = FOOD_CONFIG[food.rarity] || {};
      const drop = rollDrop(cfg.drops);
      return {
        killed: true,
        killPayload: {
          mobId,
          mobType: 'food',
          rarity: food.rarity,
          maxHp: food.maxHp,
          x: food.x,
          y: food.y,
          stars: cfg.stars || 0,
          drop,
        },
      };
    }
    return { killed: false };
  }
  if (mobType === 'beetle') {
    const idx = sid != null ? m.beetles.findIndex((b) => String(b.id) === sid) : -1;
    if (idx < 0) return { killed: false };
    const beetle = m.beetles[idx];
    const d = Math.hypot(beetle.x - playerX, beetle.y - playerY);
    if (d > maxRange) return { killed: false };
    beetle.hp -= dmg;
    if (beetle.hp <= HP_DEAD_EPSILON) {
      recordDeath(room, beetle.x, beetle.y);
      m.lastKillTime = Date.now();
      m.beetles.splice(idx, 1);
      const cfg = BEETLE_CONFIG[beetle.rarity] || {};
      const drop = rollBeetleDrop(cfg.drops);
      return {
        killed: true,
        killPayload: {
          mobId,
          mobType: 'beetle',
          rarity: beetle.rarity,
          maxHp: beetle.maxHp,
          x: beetle.x,
          y: beetle.y,
          stars: cfg.stars || 0,
          drop,
        },
      };
    }
    return { killed: false };
  }
  return { killed: false };
}

/** Update beetle positions: chase nearest player body (server-side circle) in vision. Never move into wall cells. Use substeps so beetles can creep toward player when path is partially blocked. */
function updateBeetles(room, roomPlayerBodies, dtMs) {
  const m = getRoomMobs(room);
  const bodies = roomPlayerBodies && roomPlayerBodies.get(room);
  if (!bodies || bodies.size === 0) return;
  const dtSec = dtMs / 1000;
  const CHASE_SPEED = 120;
  const SUBSTEPS = 4;
  for (const beetle of m.beetles) {
    const vision = Number(beetle.vision) || 1000;
    let nearestDist = vision + 1;
    let tx = null;
    let ty = null;
    for (const [, body] of bodies) {
      const px = Number(body.x) || 0;
      const py = Number(body.y) || 0;
      const d = Math.hypot(beetle.x - px, beetle.y - py);
      if (d <= vision && d >= 1e-6 && d < nearestDist) {
        nearestDist = d;
        tx = px;
        ty = py;
      }
    }
    if (tx != null && ty != null) {
      const dx = tx - beetle.x;
      const dy = ty - beetle.y;
      const dist = Math.hypot(dx, dy);
      if (dist >= 1e-9) {
        const totalMove = CHASE_SPEED * dtSec;
        const step = totalMove / SUBSTEPS;
        const ux = dx / dist;
        const uy = dy / dist;
        for (let s = 0; s < SUBSTEPS; s++) {
          const newX = beetle.x + ux * step;
          const newY = beetle.y + uy * step;
          if (!isPointInWallCell(newX, newY)) {
            beetle.x = newX;
            beetle.y = newY;
          } else {
            if (!isPointInWallCell(newX, beetle.y)) beetle.x = newX;
            if (!isPointInWallCell(beetle.x, newY)) beetle.y = newY;
          }
        }
      }
    }
  }
}

function getMobsSnapshot(room) {
  const m = getRoomMobs(room);
  return {
    foods: m.foods.filter((f) => f.hp > HP_DEAD_EPSILON).map((f) => ({
      ...f,
      x: Number(f.x),
      y: Number(f.y),
      hp: f.hp,
      maxHp: f.maxHp,
    })),
    beetles: m.beetles.filter((b) => b.hp > HP_DEAD_EPSILON).map((b) => ({
      ...b,
      x: Number(b.x),
      y: Number(b.y),
      hp: b.hp,
      maxHp: b.maxHp,
    })),
  };
}

/** Remove any food or beetle with hp <= HP_DEAD_EPSILON. Safety net to ensure dead mobs never remain in the server state. */
function purgeDeadMobs(room) {
  const m = getRoomMobs(room);
  for (let i = m.foods.length - 1; i >= 0; i--) {
    if (m.foods[i].hp <= HP_DEAD_EPSILON) m.foods.splice(i, 1);
  }
  for (let i = m.beetles.length - 1; i >= 0; i--) {
    if (m.beetles[i].hp <= HP_DEAD_EPSILON) m.beetles.splice(i, 1);
  }
}

/** Last resort: remove any food or beetle whose hitbox is fully inside a wall cell (instant kill, no reward). */
function removeMobsFullyInWall(room) {
  const m = getRoomMobs(room);
  for (let i = m.foods.length - 1; i >= 0; i--) {
    const f = m.foods[i];
    const r = (f.size != null && typeof f.size === 'number') ? f.size : 12;
    if (isCircleFullyInWall(f.x, f.y, r)) m.foods.splice(i, 1);
  }
  for (let i = m.beetles.length - 1; i >= 0; i--) {
    const b = m.beetles[i];
    const hitboxScale = (b.rarity === 'mythic' || b.rarity === 'legendary') ? 0.4 : 1;
    const semiMajor = (b.size != null ? b.size * (25.5 / 64) : 20) * hitboxScale;
    if (isCircleFullyInWall(b.x, b.y, semiMajor)) m.beetles.splice(i, 1);
  }
}

module.exports = {
  getRoomMobs,
  spawnFood,
  spawnBeetle,
  runSpawn,
  hitMob,
  updateBeetles,
  purgeDeadMobs,
  removeMobsFullyInWall,
  getMobsSnapshot,
  SPAWN_INTERVAL_MS,
  FOOD_TARGET,
  BEETLE_TARGET,
};
