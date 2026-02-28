/**
 * Server-authoritative mob state per room. Syncs food and beetle spawn/death across all clients.
 * Mirrors client config (hp, drops) for loot calculation.
 */
const MAP_HALF = 8000;
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
  common: { hp: 10, size: 24, weight: 1, drops: { common: 0.8, uncommon: 0.2 }, stars: 0 },
  uncommon: { hp: 40, size: 36, weight: 10, drops: { common: 0.5, uncommon: 0.5 }, stars: 0 },
  rare: { hp: 150, size: 48, weight: 20, drops: { uncommon: 0.8, rare: 0.2 }, stars: 0 },
  epic: { hp: 1000, size: 60, weight: 30, drops: { uncommon: 0.06, rare: 0.8, epic: 0.14 }, stars: 0 },
  legendary: { hp: 8000, size: 84, weight: 40, drops: { rare: 0.1, epic: 0.8, legendary: 0.1 }, stars: 0 },
  mythic: { hp: 25000, size: 108, weight: 60, drops: { epic: 0.07, legendary: 0.9, mythic: 0.03 }, stars: 0 },
  ultra: { hp: 300000, size: 170, weight: 80, drops: { legendary: 0.845, mythic: 0.15, ultra: 0.005 }, stars: 0 },
  super: { hp: 20000000, size: 405, weight: 99, drops: { mythic: 0.77, ultra: 0.23 }, stars: 5000 },
};

const SPAWN_WEIGHTS = { common: 100, uncommon: 50, rare: 25, epic: 12, legendary: 6, mythic: 3, ultra: 1, super: 0.1 };
const FOOD_TARGET = 800;
const BEETLE_TARGET = 800;
const SPAWN_BATCH_FOOD = 140;
const SPAWN_BATCH_BEETLE = 140;
const SPAWN_INTERVAL_MS = 8666;

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

function randomRarity(spawnType, m) {
  let rarity = pickRandomWeighted(SPAWN_WEIGHTS);
  if (rarity === 'super') {
    if (spawnType === 'food' && m.hasNaturalSuperFood) rarity = 'ultra';
    else if (spawnType === 'beetle' && m.hasNaturalSuperBeetle) rarity = 'ultra';
  }
  return rarity;
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
    });
  }
  return roomMobs.get(room);
}

function spawnFood(room) {
  const m = getRoomMobs(room);
  if (m.foods.length >= FOOD_TARGET) return;
  const rarity = randomRarity('food', m);
  if (rarity === 'super') m.hasNaturalSuperFood = true;
  const cfg = FOOD_CONFIG[rarity];
  const id = 'f_' + (m.nextId++);
  const food = {
    id,
    x: (Math.random() * 2 - 1) * MAP_HALF,
    y: (Math.random() * 2 - 1) * MAP_HALF,
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
  const rarity = randomRarity('beetle', m);
  if (rarity === 'super') m.hasNaturalSuperBeetle = true;
  const cfg = BEETLE_CONFIG[rarity];
  const id = 'b_' + (m.nextId++);
  const beetle = {
    id,
    x: (Math.random() * 2 - 1) * MAP_HALF,
    y: (Math.random() * 2 - 1) * MAP_HALF,
    rarity,
    hp: cfg.hp,
    maxHp: cfg.hp,
    size: cfg.size,
    weight: cfg.weight,
    natural: true,
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
  if (mobType === 'food') {
    const idx = m.foods.findIndex((f) => f.id === mobId);
    if (idx < 0) return { killed: false };
    const food = m.foods[idx];
    const d = Math.hypot(food.x - playerX, food.y - playerY);
    if (d > maxRange) return { killed: false };
    food.hp -= damage;
    if (food.hp <= 0) {
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
    const idx = m.beetles.findIndex((b) => b.id === mobId);
    if (idx < 0) return { killed: false };
    const beetle = m.beetles[idx];
    const d = Math.hypot(beetle.x - playerX, beetle.y - playerY);
    if (d > maxRange) return { killed: false };
    beetle.hp -= damage;
    if (beetle.hp <= 0) {
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

function getMobsSnapshot(room) {
  const m = getRoomMobs(room);
  return {
    foods: m.foods.map((f) => ({ ...f })),
    beetles: m.beetles.map((b) => ({ ...b })),
  };
}

module.exports = {
  getRoomMobs,
  spawnFood,
  spawnBeetle,
  runSpawn,
  hitMob,
  getMobsSnapshot,
  SPAWN_INTERVAL_MS,
  FOOD_TARGET,
  BEETLE_TARGET,
};
