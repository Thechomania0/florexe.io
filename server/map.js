/**
 * Server-side map: Centralia Plains (server/Centralia_plains.json) is the default.
 * Mobs must spawn in playable areas, not inside walls.
 * Grid: zones.grid[i][j], i=column(x), j=row(y). World: x=-8000+i*40, y=-8000+j*40.
 */
const fs = require('fs');
const path = require('path');

const CENTRALIA_PATH = path.join(__dirname, 'Centralia_plains.json');

// Must match client mapData.js
const CUSTOM_CELL = { EMPTY: 0, WALL: 1, COMMON_UNCOMMON: 2, RARE_EPIC: 3, LEGENDARY_MYTHIC: 4, ULTRA_SUPER: 5, SPAWN: 6 };
const CUSTOM_GRID_SIZE = 400;
const CUSTOM_CELL_WORLD = 40;
const CUSTOM_GRID_MIN = -(CUSTOM_GRID_SIZE * CUSTOM_CELL_WORLD) / 2; // -8000

// Wall half-width for custom map (40-unit grid) - matches client mapData
const CUSTOM_WALL_HALF_WIDTH = 20;
const BUILT_IN_WALL_HALF_WIDTH = 120;

const CUSTOM_RARITY_WEIGHTS = {
  [CUSTOM_CELL.COMMON_UNCOMMON]: { common: 60, uncommon: 40 },
  [CUSTOM_CELL.RARE_EPIC]: { rare: 50, epic: 50 },
  [CUSTOM_CELL.LEGENDARY_MYTHIC]: { mythic: 75, legendary: 25 },
  [CUSTOM_CELL.ULTRA_SUPER]: { ultra: 55, super: 45 },
};

let defaultMap = null;

function loadDefaultMap() {
  if (defaultMap) return defaultMap;
  try {
    const data = JSON.parse(fs.readFileSync(CENTRALIA_PATH, 'utf8'));
    if (data && Array.isArray(data.walls) && data.walls.length > 0) {
      defaultMap = { walls: data.walls, zones: data.zones || null };
      return defaultMap;
    }
  } catch (e) {
    console.warn('[map] Could not load Centralia_plains.json:', e.message);
  }
  defaultMap = { walls: [], zones: null };
  return defaultMap;
}

/** Pick random point in playable zone from Centralia zones.grid. Returns { x, y, rarityWeights } or null. */
function getRandomPointInPlayableZoneFromZones(zones, walls) {
  if (!zones || !Array.isArray(zones.grid) || zones.grid.length !== CUSTOM_GRID_SIZE || !walls) return null;
  const playable = [];
  for (let i = 0; i < CUSTOM_GRID_SIZE; i++) {
    for (let j = 0; j < CUSTOM_GRID_SIZE; j++) {
      const v = zones.grid[i]?.[j];
      if (v !== undefined && v !== CUSTOM_CELL.WALL) playable.push({ i, j, v });
    }
  }
  if (playable.length === 0) return null;
  const margin = CUSTOM_CELL_WORLD * 0.4;
  for (let k = 0; k < 100; k++) {
    const { i, j, v } = playable[Math.floor(Math.random() * playable.length)];
    const x = CUSTOM_GRID_MIN + (i + 0.5) * CUSTOM_CELL_WORLD + (Math.random() - 0.5) * margin;
    const y = CUSTOM_GRID_MIN + (j + 0.5) * CUSTOM_CELL_WORLD + (Math.random() - 0.5) * margin;
    if (!isPointInWall(x, y, walls)) {
      const rarityWeights = CUSTOM_RARITY_WEIGHTS[v] || { common: 60, uncommon: 40 };
      return { x, y, rarityWeights };
    }
  }
  const { i, j, v } = playable[0];
  return {
    x: CUSTOM_GRID_MIN + (i + 0.5) * CUSTOM_CELL_WORLD,
    y: CUSTOM_GRID_MIN + (j + 0.5) * CUSTOM_CELL_WORLD,
    rarityWeights: CUSTOM_RARITY_WEIGHTS[v] || { common: 60, uncommon: 40 },
  };
}

/** Rarity string -> zone cell type for respawn-in-zone. */
const RARITY_TO_ZONE = {
  common: CUSTOM_CELL.COMMON_UNCOMMON,
  uncommon: CUSTOM_CELL.COMMON_UNCOMMON,
  rare: CUSTOM_CELL.RARE_EPIC,
  epic: CUSTOM_CELL.RARE_EPIC,
  legendary: CUSTOM_CELL.LEGENDARY_MYTHIC,
  mythic: CUSTOM_CELL.LEGENDARY_MYTHIC,
  ultra: CUSTOM_CELL.ULTRA_SUPER,
  super: CUSTOM_CELL.ULTRA_SUPER,
};

/** Pick a random point in the zone that matches the given rarity (e.g. rare -> RARE_EPIC zone). Returns { x, y, rarityWeights } or null. Used for respawn so killed mobs respawn in their rarity area.
 * options: { excludeX, excludeY, minDistFromExclude } — when set, only return a point at least minDistFromExclude away from (excludeX, excludeY) to avoid spawning on death spot. */
function getRandomPointInZoneForRarity(rarity, walls, options) {
  const map = loadDefaultMap();
  const zones = map.zones;
  if (!zones || !Array.isArray(zones.grid) || zones.grid.length !== CUSTOM_GRID_SIZE || !walls) return null;
  const zoneCell = RARITY_TO_ZONE[rarity] ?? CUSTOM_CELL.COMMON_UNCOMMON;
  const cells = [];
  for (let i = 0; i < CUSTOM_GRID_SIZE; i++) {
    for (let j = 0; j < CUSTOM_GRID_SIZE; j++) {
      if (zones.grid[i]?.[j] === zoneCell) cells.push({ i, j });
    }
  }
  if (cells.length === 0) return null;
  const margin = CUSTOM_CELL_WORLD * 0.4;
  const excludeX = options && typeof options.excludeX === 'number' ? options.excludeX : null;
  const excludeY = options && typeof options.excludeY === 'number' ? options.excludeY : null;
  const minDist = (options && typeof options.minDistFromExclude === 'number' && options.minDistFromExclude > 0) ? options.minDistFromExclude : 0;
  const hasExclude = excludeX != null && excludeY != null && minDist > 0;
  const maxTries = hasExclude ? 200 : 100;
  for (let k = 0; k < maxTries; k++) {
    const { i, j } = cells[Math.floor(Math.random() * cells.length)];
    const x = CUSTOM_GRID_MIN + (i + 0.5) * CUSTOM_CELL_WORLD + (Math.random() - 0.5) * margin;
    const y = CUSTOM_GRID_MIN + (j + 0.5) * CUSTOM_CELL_WORLD + (Math.random() - 0.5) * margin;
    if (!isPointInWall(x, y, walls)) {
      if (hasExclude && Math.hypot(x - excludeX, y - excludeY) < minDist) continue;
      const rarityWeights = CUSTOM_RARITY_WEIGHTS[zoneCell] || { common: 60, uncommon: 40 };
      return { x, y, rarityWeights };
    }
  }
  if (hasExclude) return null;
  const { i, j } = cells[0];
  return {
    x: CUSTOM_GRID_MIN + (i + 0.5) * CUSTOM_CELL_WORLD,
    y: CUSTOM_GRID_MIN + (j + 0.5) * CUSTOM_CELL_WORLD,
    rarityWeights: CUSTOM_RARITY_WEIGHTS[zoneCell] || { common: 60, uncommon: 40 },
  };
}

/** Pick spawn point in COMMON_UNCOMMON (common-uncommon) zone so player spawns there each time. Falls back to SPAWN cells then any non-wall. Returns { x, y } or null. */
function getSpawnPointFromZones(zones, walls) {
  if (!zones || !Array.isArray(zones.grid) || zones.grid.length !== CUSTOM_GRID_SIZE || !walls) return null;

  const tryCells = (cells) => {
    if (cells.length === 0) return null;
    const margin = CUSTOM_CELL_WORLD * 0.2;
    for (let k = 0; k < 100; k++) {
      const [i, j] = cells[Math.floor(Math.random() * cells.length)];
      const x = CUSTOM_GRID_MIN + (i + 0.5) * CUSTOM_CELL_WORLD + (Math.random() - 0.5) * margin;
      const y = CUSTOM_GRID_MIN + (j + 0.5) * CUSTOM_CELL_WORLD + (Math.random() - 0.5) * margin;
      if (!isPointInWall(x, y, walls)) return { x, y };
    }
    const [i, j] = cells[0];
    return { x: CUSTOM_GRID_MIN + (i + 0.5) * CUSTOM_CELL_WORLD, y: CUSTOM_GRID_MIN + (j + 0.5) * CUSTOM_CELL_WORLD };
  };

  const commonUncommon = [];
  const spawnCells = [];
  for (let i = 0; i < CUSTOM_GRID_SIZE; i++) {
    for (let j = 0; j < CUSTOM_GRID_SIZE; j++) {
      const v = zones.grid[i]?.[j];
      if (v === CUSTOM_CELL.COMMON_UNCOMMON) commonUncommon.push([i, j]);
      if (v === CUSTOM_CELL.SPAWN) spawnCells.push([i, j]);
    }
  }
  let pt = tryCells(commonUncommon);
  if (pt) return pt;
  pt = tryCells(spawnCells);
  if (pt) return pt;
  const nonWall = [];
  for (let i = 0; i < CUSTOM_GRID_SIZE; i++) {
    for (let j = 0; j < CUSTOM_GRID_SIZE; j++) {
      const v = zones.grid[i]?.[j];
      if (v !== undefined && v !== CUSTOM_CELL.WALL) nonWall.push([i, j]);
    }
  }
  return tryCells(nonWall);
}

function isPointInWall(x, y, walls) {
  const map = loadDefaultMap();
  const w = walls || map.walls;
  const half = map.zones && map.zones.grid ? CUSTOM_WALL_HALF_WIDTH : BUILT_IN_WALL_HALF_WIDTH;
  for (const seg of w) {
    const dx = seg.x2 - seg.x1;
    const dy = seg.y2 - seg.y1;
    const len = Math.hypot(dx, dy) || 1;
    const t = Math.max(0, Math.min(1, ((x - seg.x1) * dx + (y - seg.y1) * dy) / (len * len)));
    const px = seg.x1 + t * dx;
    const py = seg.y1 + t * dy;
    const dist = Math.hypot(x - px, y - py);
    if (dist < half) return true;
  }
  return false;
}

/** True if (x, y) lies inside a wall cell in the zones grid (matches client drawn walls). Use to keep beetles out of walls. */
function isPointInWallCell(x, y) {
  const map = loadDefaultMap();
  if (!map.zones || !Array.isArray(map.zones.grid)) return false;
  const g = map.zones.grid;
  const i = Math.floor((x - CUSTOM_GRID_MIN) / CUSTOM_CELL_WORLD);
  const j = Math.floor((y - CUSTOM_GRID_MIN) / CUSTOM_CELL_WORLD);
  if (i < 0 || i >= CUSTOM_GRID_SIZE || j < 0 || j >= CUSTOM_GRID_SIZE) return true;
  return g[i] && g[i][j] === CUSTOM_CELL.WALL;
}

/** True if the circle (x, y, radius) is entirely inside wall cells. Used as last resort to kill stuck mobs. */
function isCircleFullyInWall(x, y, radius) {
  const map = loadDefaultMap();
  if (!map.zones || !Array.isArray(map.zones.grid)) return false;
  const g = map.zones.grid;
  const i0 = Math.floor((x - radius - CUSTOM_GRID_MIN) / CUSTOM_CELL_WORLD);
  const i1 = Math.floor((x + radius - CUSTOM_GRID_MIN) / CUSTOM_CELL_WORLD);
  const j0 = Math.floor((y - radius - CUSTOM_GRID_MIN) / CUSTOM_CELL_WORLD);
  const j1 = Math.floor((y + radius - CUSTOM_GRID_MIN) / CUSTOM_CELL_WORLD);
  let anyOverlap = false;
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      if (i < 0 || i >= CUSTOM_GRID_SIZE || j < 0 || j >= CUSTOM_GRID_SIZE) return false;
      const cellMinX = CUSTOM_GRID_MIN + i * CUSTOM_CELL_WORLD;
      const cellMaxX = CUSTOM_GRID_MIN + (i + 1) * CUSTOM_CELL_WORLD;
      const cellMinY = CUSTOM_GRID_MIN + j * CUSTOM_CELL_WORLD;
      const cellMaxY = CUSTOM_GRID_MIN + (j + 1) * CUSTOM_CELL_WORLD;
      const closestX = Math.max(cellMinX, Math.min(cellMaxX, x));
      const closestY = Math.max(cellMinY, Math.min(cellMaxY, y));
      if (Math.hypot(x - closestX, y - closestY) <= radius + 1e-6) {
        anyOverlap = true;
        if (!g[i] || g[i][j] !== CUSTOM_CELL.WALL) return false;
      }
    }
  }
  return anyOverlap;
}

function getDefaultMap() {
  return loadDefaultMap();
}

/** @deprecated Use getDefaultMap() */
function getBuiltInWalls() {
  return loadDefaultMap().walls;
}

module.exports = {
  isPointInWall,
  isPointInWallCell,
  isCircleFullyInWall,
  getDefaultMap,
  getBuiltInWalls,
  getRandomPointInPlayableZoneFromZones,
  getRandomPointInZoneForRarity,
  getSpawnPointFromZones,
};
