/**
 * Server-side map: Centralia Plains (server/Centralia_plains.json) is the default.
 * Mobs must spawn in playable areas, not inside walls.
 */
const fs = require('fs');
const path = require('path');

const CENTRALIA_PATH = path.join(__dirname, 'Centralia_plains.json');

// Wall half-width for custom map (40-unit grid) - matches client mapData
const CUSTOM_WALL_HALF_WIDTH = 20;
const BUILT_IN_WALL_HALF_WIDTH = 120;

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

function getDefaultMap() {
  return loadDefaultMap();
}

/** @deprecated Use getDefaultMap() */
function getBuiltInWalls() {
  return loadDefaultMap().walls;
}

module.exports = {
  isPointInWall,
  getDefaultMap,
  getBuiltInWalls,
};
