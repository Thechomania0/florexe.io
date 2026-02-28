/**
 * Map layout: walls, rarity zones, and spawn area.
 * MAP_SIZE from config (16000); half = 8000. Coordinates: x/y from -8000 to 8000.
 *
 * MANUAL MAP EDITING:
 * - Open map-editor.html: draw walls on the 400×400 grid, then use "Save and confirm implementation".
 *   The game loads your map from localStorage when you reload. To keep the map across deploys and
 *   devices, use "Export for repo" in the map editor and add the file as data/custom-map.json; the
 *   game will load it when localStorage is empty.
 * - Or set CUSTOM_WALLS below to an array of { x1, y1, x2, y2 } to use custom walls in code.
 */

import { MAP_SIZE } from './config.js';

const HALF = MAP_SIZE / 2;

/** Set to an array of { x1, y1, x2, y2 } to use custom walls in code. Leave null; default map is Centralia Plains. */
export let CUSTOM_WALLS = null;

// ============== ZONES (rectangles: minX, maxX, minY, maxY) ==============
const NURSERY_MIN = -1200;
const NURSERY_MAX = 1200;

const ZONE_NURSERY = {
  id: 'nursery',
  minX: NURSERY_MIN,
  maxX: NURSERY_MAX,
  minY: NURSERY_MIN,
  maxY: NURSERY_MAX,
  rarityWeights: { common: 60, uncommon: 40 },
};

const ZONE_ULTRA_SUPER = {
  id: 'ultra_super',
  minX: -HALF,
  maxX: -3500,
  minY: 3500,
  maxY: HALF,
  rarityWeights: { ultra: 55, super: 45 },
};

const ZONE_MYTHIC_BL = {
  id: 'mythic_bl',
  minX: -HALF,
  maxX: -2500,
  minY: -HALF,
  maxY: -2500,
  rarityWeights: { mythic: 75, legendary: 25 },
};

const ZONE_MYTHIC_TR = {
  id: 'mythic_tr',
  minX: 2500,
  maxX: HALF,
  minY: 3500,
  maxY: HALF,
  rarityWeights: { mythic: 75, legendary: 25 },
};

const ZONE_RARE_EPIC_RECTS = [
  { minX: -3500, maxX: -2500, minY: -2500, maxY: HALF },
  { minX: -2500, maxX: 2500, minY: -HALF, maxY: -2500 },
  { minX: -2500, maxX: 2500, minY: 1200, maxY: 3500 },
  { minX: 2500, maxX: HALF, minY: -HALF, maxY: 3500 },
];

const RARE_EPIC_WEIGHTS = { rare: 50, epic: 50 };

// Custom map editor zone cell values (must match map-editor.html)
// 1:1 with game map: 400×400 cells, each cell = 40 world units (= 1 game grid square)
const CUSTOM_CELL = { EMPTY: 0, WALL: 1, COMMON_UNCOMMON: 2, RARE_EPIC: 3, LEGENDARY_MYTHIC: 4, ULTRA_SUPER: 5, SPAWN: 6 };
const CUSTOM_GRID_SIZE = 400;
const CUSTOM_CELL_WORLD = 40;
const CUSTOM_GRID_MIN = -(CUSTOM_GRID_SIZE * CUSTOM_CELL_WORLD) / 2; // -8000

const CUSTOM_RARITY_WEIGHTS = {
  [CUSTOM_CELL.COMMON_UNCOMMON]: { common: 60, uncommon: 40 },
  [CUSTOM_CELL.RARE_EPIC]: RARE_EPIC_WEIGHTS,
  [CUSTOM_CELL.LEGENDARY_MYTHIC]: { mythic: 75, legendary: 25 },
  [CUSTOM_CELL.ULTRA_SUPER]: { ultra: 55, super: 45 },
};

function getCustomZones() {
  try {
    const s = localStorage.getItem('florexe_custom_zones');
    if (s) {
      const parsed = JSON.parse(s);
      if (parsed && Array.isArray(parsed.grid) && parsed.grid.length === CUSTOM_GRID_SIZE) return parsed;
    }
  } catch (e) {}
  return null;
}

function inRect(x, y, r) {
  return x >= r.minX && x <= r.maxX && y >= r.minY && y <= r.maxY;
}

export function getZoneAt(x, y) {
  if (inRect(x, y, ZONE_NURSERY)) return { id: ZONE_NURSERY.id, rarityWeights: ZONE_NURSERY.rarityWeights };
  if (inRect(x, y, ZONE_ULTRA_SUPER)) return { id: ZONE_ULTRA_SUPER.id, rarityWeights: ZONE_ULTRA_SUPER.rarityWeights };
  if (inRect(x, y, ZONE_MYTHIC_BL)) return { id: ZONE_MYTHIC_BL.id, rarityWeights: ZONE_MYTHIC_BL.rarityWeights };
  if (inRect(x, y, ZONE_MYTHIC_TR)) return { id: ZONE_MYTHIC_TR.id, rarityWeights: ZONE_MYTHIC_TR.rarityWeights };
  for (const r of ZONE_RARE_EPIC_RECTS) {
    if (inRect(x, y, r)) return { id: 'rare_epic', rarityWeights: RARE_EPIC_WEIGHTS };
  }
  return { id: 'rare_epic', rarityWeights: RARE_EPIC_WEIGHTS };
}

// Spawn density: nursery and rare_epic reduced by 60% (weight × 0.4)
const ZONES_FOR_SPAWN = [
  { zone: ZONE_NURSERY, weight: 3 },
  { zone: ZONE_ULTRA_SUPER, weight: 2 },
  { zone: ZONE_MYTHIC_BL, weight: 3 },
  { zone: ZONE_MYTHIC_TR, weight: 3 },
  { zone: null, weight: 10 },
];

function getRandomPointInZone(zoneId) {
  if (zoneId === 'nursery') {
    return {
      x: NURSERY_MIN + Math.random() * (NURSERY_MAX - NURSERY_MIN),
      y: NURSERY_MIN + Math.random() * (NURSERY_MAX - NURSERY_MIN),
    };
  }
  if (zoneId === 'ultra_super') {
    return {
      x: ZONE_ULTRA_SUPER.minX + Math.random() * (ZONE_ULTRA_SUPER.maxX - ZONE_ULTRA_SUPER.minX),
      y: ZONE_ULTRA_SUPER.minY + Math.random() * (ZONE_ULTRA_SUPER.maxY - ZONE_ULTRA_SUPER.minY),
    };
  }
  if (zoneId === 'mythic_bl') {
    return {
      x: ZONE_MYTHIC_BL.minX + Math.random() * (ZONE_MYTHIC_BL.maxX - ZONE_MYTHIC_BL.minX),
      y: ZONE_MYTHIC_BL.minY + Math.random() * (ZONE_MYTHIC_BL.maxY - ZONE_MYTHIC_BL.minY),
    };
  }
  if (zoneId === 'mythic_tr') {
    return {
      x: ZONE_MYTHIC_TR.minX + Math.random() * (ZONE_MYTHIC_TR.maxX - ZONE_MYTHIC_TR.minX),
      y: ZONE_MYTHIC_TR.minY + Math.random() * (ZONE_MYTHIC_TR.maxY - ZONE_MYTHIC_TR.minY),
    };
  }
  const r = ZONE_RARE_EPIC_RECTS[Math.floor(Math.random() * ZONE_RARE_EPIC_RECTS.length)];
  return {
    x: r.minX + Math.random() * (r.maxX - r.minX),
    y: r.minY + Math.random() * (r.maxY - r.minY),
  };
}

export function getRandomPointAndWeights() {
  const zones = getCustomZones();
  if (zones && zones.grid) {
    const rarityCells = [];
    for (let i = 0; i < CUSTOM_GRID_SIZE; i++) {
      for (let j = 0; j < CUSTOM_GRID_SIZE; j++) {
        const v = zones.grid[i] && zones.grid[i][j];
        if (v >= CUSTOM_CELL.COMMON_UNCOMMON && v <= CUSTOM_CELL.ULTRA_SUPER) rarityCells.push([i, j, v]);
      }
    }
    if (rarityCells.length > 0) {
      const [i, j, zoneType] = rarityCells[Math.floor(Math.random() * rarityCells.length)];
      const weights = CUSTOM_RARITY_WEIGHTS[zoneType];
      if (weights) {
        return {
          x: CUSTOM_GRID_MIN + (i + Math.random()) * CUSTOM_CELL_WORLD,
          y: CUSTOM_GRID_MIN + (j + Math.random()) * CUSTOM_CELL_WORLD,
          rarityWeights: weights,
        };
      }
    }
  }

  const total = ZONES_FOR_SPAWN.reduce((s, z) => s + z.weight, 0);
  let r = Math.random() * total;
  for (const { zone, weight } of ZONES_FOR_SPAWN) {
    r -= weight;
    if (r <= 0) {
      if (zone === null) {
        const rect = ZONE_RARE_EPIC_RECTS[Math.floor(Math.random() * ZONE_RARE_EPIC_RECTS.length)];
        return {
          x: rect.minX + Math.random() * (rect.maxX - rect.minX),
          y: rect.minY + Math.random() * (rect.maxY - rect.minY),
          rarityWeights: RARE_EPIC_WEIGHTS,
        };
      }
      const pt = getRandomPointInZone(zone.id);
      pt.rarityWeights = zone.rarityWeights;
      return pt;
    }
  }
  const rect = ZONE_RARE_EPIC_RECTS[0];
  return {
    x: rect.minX + Math.random() * (rect.maxX - rect.minX),
    y: rect.minY + Math.random() * (rect.maxY - rect.minY),
    rarityWeights: RARE_EPIC_WEIGHTS,
  };
}

export function getRarityWeightsForZone(zoneId) {
  if (zoneId === 'nursery') return ZONE_NURSERY.rarityWeights;
  if (zoneId === 'ultra_super') return ZONE_ULTRA_SUPER.rarityWeights;
  if (zoneId === 'mythic_bl' || zoneId === 'mythic_tr') return ZONE_MYTHIC_BL.rarityWeights;
  return RARE_EPIC_WEIGHTS;
}

export function getSpawnPoint() {
  const zones = getCustomZones();
  const wallRects = getMergedWallFills();
  const useRects = zones && zones.grid && wallRects.length > 0;

  const inWall = (x, y) => useRects ? isPointInWallRects(x, y, wallRects) : isPointInWall(x, y, getWalls());

  if (zones && zones.grid) {
    const spawnCells = [];
    for (let i = 0; i < CUSTOM_GRID_SIZE; i++) {
      for (let j = 0; j < CUSTOM_GRID_SIZE; j++) {
        if (zones.grid[i] && zones.grid[i][j] === CUSTOM_CELL.SPAWN) spawnCells.push([i, j]);
      }
    }
    if (spawnCells.length > 0) {
      const margin = CUSTOM_CELL_WORLD * 0.2;
      for (let k = 0; k < 200; k++) {
        const [i, j] = spawnCells[Math.floor(Math.random() * spawnCells.length)];
        const x = CUSTOM_GRID_MIN + (i + 0.5) * CUSTOM_CELL_WORLD + (Math.random() - 0.5) * margin;
        const y = CUSTOM_GRID_MIN + (j + 0.5) * CUSTOM_CELL_WORLD + (Math.random() - 0.5) * margin;
        if (!inWall(x, y)) return { x, y };
      }
      for (const [i, j] of spawnCells) {
        const x = CUSTOM_GRID_MIN + (i + 0.5) * CUSTOM_CELL_WORLD;
        const y = CUSTOM_GRID_MIN + (j + 0.5) * CUSTOM_CELL_WORLD;
        if (!inWall(x, y)) return { x, y };
      }
    }
    const nonWallCells = [];
    for (let i = 0; i < CUSTOM_GRID_SIZE; i++) {
      for (let j = 0; j < CUSTOM_GRID_SIZE; j++) {
        if (zones.grid[i] && zones.grid[i][j] !== CUSTOM_CELL.WALL) nonWallCells.push([i, j]);
      }
    }
    if (nonWallCells.length > 0) {
      for (let k = 0; k < 100; k++) {
        const [i, j] = nonWallCells[Math.floor(Math.random() * nonWallCells.length)];
        const x = CUSTOM_GRID_MIN + (i + 0.5) * CUSTOM_CELL_WORLD;
        const y = CUSTOM_GRID_MIN + (j + 0.5) * CUSTOM_CELL_WORLD;
        if (!inWall(x, y)) return { x, y };
      }
    }
  }

  const walls = getWalls();
  const margin = 80;
  const maxRetries = 50;
  for (let k = 0; k < maxRetries; k++) {
    const x = NURSERY_MIN + margin + Math.random() * (NURSERY_MAX - NURSERY_MIN - 2 * margin);
    const y = NURSERY_MIN + margin + Math.random() * (NURSERY_MAX - NURSERY_MIN - 2 * margin);
    if (!isPointInWall(x, y, walls)) return { x, y };
  }
  return { x: 0, y: 0 };
}

/** Returns walls from localStorage or CUSTOM_WALLS. Centralia Plains is loaded via loadCustomMapFromRepo when localStorage is empty. */
export function getWalls() {
  if (CUSTOM_WALLS && Array.isArray(CUSTOM_WALLS) && CUSTOM_WALLS.length > 0) return CUSTOM_WALLS;
  try {
    const s = localStorage.getItem('florexe_custom_walls');
    if (s) {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (e) {}
  return [];
}

/** Returns filled rectangles for every wall cell from the custom map editor grid. 1:1 with editor (no flip). */
export function getWallFills() {
  const zones = getCustomZones();
  if (!zones || !zones.grid) return [];
  const fills = [];
  for (let i = 0; i < CUSTOM_GRID_SIZE; i++) {
    for (let j = 0; j < CUSTOM_GRID_SIZE; j++) {
      if (zones.grid[i] && zones.grid[i][j] === CUSTOM_CELL.WALL) {
        const x1 = CUSTOM_GRID_MIN + i * CUSTOM_CELL_WORLD;
        const y1 = CUSTOM_GRID_MIN + j * CUSTOM_CELL_WORLD;
        fills.push({
          x1,
          y1,
          x2: x1 + CUSTOM_CELL_WORLD,
          y2: y1 + CUSTOM_CELL_WORLD,
        });
      }
    }
  }
  return fills;
}

/** Build merged wall rects from any zones object (grid must exist). Used for both localStorage and server map. */
export function buildMergedWallFillsFromZones(zones) {
  if (!zones || !Array.isArray(zones.grid) || zones.grid.length !== CUSTOM_GRID_SIZE) return [];
  const merged = [];
  for (let j = 0; j < CUSTOM_GRID_SIZE; j++) {
    const y1 = CUSTOM_GRID_MIN + j * CUSTOM_CELL_WORLD;
    const y2 = y1 + CUSTOM_CELL_WORLD;
    for (let i = 0; i < CUSTOM_GRID_SIZE; ) {
      if (!zones.grid[i] || zones.grid[i][j] !== CUSTOM_CELL.WALL) { i++; continue; }
      let iEnd = i;
      while (iEnd + 1 < CUSTOM_GRID_SIZE && zones.grid[iEnd + 1] && zones.grid[iEnd + 1][j] === CUSTOM_CELL.WALL) iEnd++;
      merged.push({
        x1: CUSTOM_GRID_MIN + i * CUSTOM_CELL_WORLD,
        y1,
        x2: CUSTOM_GRID_MIN + (iEnd + 1) * CUSTOM_CELL_WORLD,
        y2,
      });
      i = iEnd + 1;
    }
  }
  return merged;
}

/** Merged wall rects for fast drawing: horizontally adjacent wall cells become one rect per row run. 1:1 with editor. */
export function getMergedWallFills() {
  const zones = getCustomZones();
  if (!zones || !zones.grid) return [];
  return buildMergedWallFillsFromZones(zones);
}

/** Axis-aligned bounds of playable area (non-wall cells). For custom map only; returns null for built-in. */
export function getPlayableBounds() {
  const zones = getCustomZones();
  if (!zones || !zones.grid) return null;
  let minI = CUSTOM_GRID_SIZE, maxI = -1, minJ = CUSTOM_GRID_SIZE, maxJ = -1;
  for (let i = 0; i < CUSTOM_GRID_SIZE; i++) {
    for (let j = 0; j < CUSTOM_GRID_SIZE; j++) {
      if (zones.grid[i] && zones.grid[i][j] !== CUSTOM_CELL.WALL) {
        if (i < minI) minI = i;
        if (i > maxI) maxI = i;
        if (j < minJ) minJ = j;
        if (j > maxJ) maxJ = j;
      }
    }
  }
  if (minI > maxI || minJ > maxJ) return null;
  return {
    minX: CUSTOM_GRID_MIN + minI * CUSTOM_CELL_WORLD,
    maxX: CUSTOM_GRID_MIN + (maxI + 1) * CUSTOM_CELL_WORLD,
    minY: CUSTOM_GRID_MIN + minJ * CUSTOM_CELL_WORLD,
    maxY: CUSTOM_GRID_MIN + (maxJ + 1) * CUSTOM_CELL_WORLD,
  };
}

/** Filter walls to those whose bbox intersects (cx-margin, cy-margin, cx+margin, cy+margin). */
export function wallsNear(walls, cx, cy, margin) {
  const minX = cx - margin;
  const maxX = cx + margin;
  const minY = cy - margin;
  const maxY = cy + margin;
  return walls.filter(w => {
    const wMinX = Math.min(w.x1, w.x2);
    const wMaxX = Math.max(w.x1, w.x2);
    const wMinY = Math.min(w.y1, w.y2);
    const wMaxY = Math.max(w.y1, w.y2);
    return wMaxX >= minX && wMinX <= maxX && wMaxY >= minY && wMinY <= maxY;
  });
}

/** Half-width of wall in world units for built-in maps. For custom (40-unit) maps we use half cell = 20 so collision matches the drawn walls. */
export const WALL_HALF_WIDTH = 120;

export function getWallHalfWidth() {
  return getCustomZones() ? 20 : WALL_HALF_WIDTH;
}

/** Returns true if point (x, y) is inside any wall rect (for custom map spawn validation). */
export function isPointInWallRects(x, y, rects) {
  for (const r of rects) {
    if (x >= r.x1 && x <= r.x2 && y >= r.y1 && y <= r.y2) return true;
  }
  return false;
}

/** Resolve circle (x, y, radius) against axis-aligned wall rects; push out of any overlap. Returns new { x, y } or null. */
export function resolveWallCollisionRects(x, y, radius, rects) {
  let outX = x;
  let outY = y;
  let any = false;
  for (const r of rects) {
    const px = Math.max(r.x1, Math.min(r.x2, outX));
    const py = Math.max(r.y1, Math.min(r.y2, outY));
    const dx = outX - px;
    const dy = outY - py;
    const distSq = dx * dx + dy * dy;
    if (distSq === 0) {
      const dLeft = outX - r.x1, dRight = r.x2 - outX, dTop = outY - r.y1, dBot = r.y2 - outY;
      const minD = Math.min(dLeft, dRight, dTop, dBot);
      if (minD < radius) {
        if (minD === dLeft) outX = r.x1 - radius;
        else if (minD === dRight) outX = r.x2 + radius;
        else if (minD === dTop) outY = r.y1 - radius;
        else outY = r.y2 + radius;
        any = true;
      }
      continue;
    }
    if (distSq >= radius * radius) continue;
    const dist = Math.sqrt(distSq);
    const overlap = radius - dist;
    const nx = dx / dist;
    const ny = dy / dist;
    outX += nx * overlap;
    outY += ny * overlap;
    any = true;
  }
  return any ? { x: outX, y: outY } : null;
}

/** Returns true if point (x, y) is inside any wall (for spawn validation). */
export function isPointInWall(x, y, walls) {
  const half = getWallHalfWidth();
  for (const w of walls) {
    const dx = w.x2 - w.x1;
    const dy = w.y2 - w.y1;
    const len = Math.hypot(dx, dy) || 1;
    const t = Math.max(0, Math.min(1, ((x - w.x1) * dx + (y - w.y1) * dy) / (len * len)));
    const px = w.x1 + t * dx;
    const py = w.y1 + t * dy;
    const dist = Math.hypot(x - px, y - py);
    if (dist < half) return true;
  }
  return false;
}

export function resolveWallCollision(x, y, radius, walls) {
  let outX = x;
  let outY = y;
  let any = false;
  const half = getWallHalfWidth();
  const totalRadius = radius + half;
  for (const w of walls) {
    const dx = w.x2 - w.x1;
    const dy = w.y2 - w.y1;
    const len = Math.hypot(dx, dy) || 1;
    const t = Math.max(0, Math.min(1, ((outX - w.x1) * dx + (outY - w.y1) * dy) / (len * len)));
    const px = w.x1 + t * dx;
    const py = w.y1 + t * dy;
    const dist = Math.hypot(outX - px, outY - py);
    if (dist < totalRadius) {
      const overlap = totalRadius - dist;
      const nx = (outX - px) / dist;
      const ny = (outY - py) / dist;
      outX += nx * overlap;
      outY += ny * overlap;
      any = true;
    }
  }
  return any ? { x: outX, y: outY } : null;
}
