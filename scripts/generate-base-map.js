/**
 * Generates data/custom-map.json from the built-in map structure
 * so it becomes the permanent base map when localStorage is empty.
 */
const fs = require('fs');
const path = require('path');

const GRID_SIZE = 400;
const CELL_WORLD = 40;
const GRID_WORLD_MIN = -(GRID_SIZE * CELL_WORLD) / 2; // -8000

function worldToCell(x, y) {
  const i = Math.floor((x - GRID_WORLD_MIN) / CELL_WORLD);
  const j = Math.floor((y - GRID_WORLD_MIN) / CELL_WORLD);
  return [i, j];
}

function markLine(grid, x1, y1, x2, y2, thickness = 7) {
  const [i1, j1] = worldToCell(x1, y1);
  const [i2, j2] = worldToCell(x2, y2);
  const dx = i2 - i1;
  const dy = j2 - j1;
  const len = Math.hypot(dx, dy) || 1;
  const steps = Math.ceil(len * 1.5);
  const half = Math.ceil(thickness / 2);
  for (let t = 0; t <= steps; t++) {
    const ti = t / steps;
    const i = Math.round(i1 + dx * ti);
    const j = Math.round(j1 + dy * ti);
    for (let di = -half; di <= half; di++) {
      for (let dj = -half; dj <= half; dj++) {
        const ni = i + di;
        const nj = j + dj;
        if (ni >= 0 && ni < GRID_SIZE && nj >= 0 && nj < GRID_SIZE) {
          grid[ni][nj] = 1;
        }
      }
    }
  }
}

// Initialize grid: 0=empty, 1=wall, 2=common/uncommon, etc.
const grid = Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(2)); // default common/uncommon

// Section walls (nursery boundary)
const n = 1200, g = 200, topY = n + g;
markLine(grid, -n - g, topY, -n - g, -n - g);      // left
markLine(grid, -n - g, -n - g, n + g, -n - g);     // bottom
markLine(grid, n + g, -n - g, n + g, topY);        // right
markLine(grid, n + g, topY, 1200, topY);           // top right
markLine(grid, 600, topY, -n - g, topY);           // top left

// Winding path
const WINDING_WAYPOINTS = [
  [900, 900], [900, 2200], [-400, 2200], [-400, 3800], [-1800, 3800],
  [-1800, 5200], [-3200, 5200], [-3200, 6600], [-4600, 6600], [-4600, 7600],
  [-5800, 7600], [-6800, 7600], [-7200, 7200]
];
for (let k = 0; k < WINDING_WAYPOINTS.length - 1; k++) {
  const [ax, ay] = WINDING_WAYPOINTS[k];
  const [bx, by] = WINDING_WAYPOINTS[k + 1];
  markLine(grid, ax, ay, bx, by, 14); // ~280 half-width in cells
}

// Build wall segments from grid (same logic as map-editor buildSegmentsFromGrid)
const yAt = (j) => GRID_WORLD_MIN + j * CELL_WORLD;
const x = (i) => GRID_WORLD_MIN + i * CELL_WORLD;
const segments = [];

for (let j = 0; j < GRID_SIZE; j++) {
  const y1 = yAt(j);
  const y2 = y1 + CELL_WORLD;
  for (let i = 0; i < GRID_SIZE; ) {
    if (grid[i][j] !== 1) { i++; continue; }
    if (j > 0 && grid[i][j - 1] === 1) { i++; continue; }
    let iEnd = i;
    while (iEnd + 1 < GRID_SIZE && grid[iEnd + 1][j] === 1 && (j === 0 || grid[iEnd + 1][j - 1] !== 1)) iEnd++;
    segments.push({ x1: x(i), y1, x2: x(iEnd + 1), y2: y1 });
    i = iEnd + 1;
  }
  for (let i = 0; i < GRID_SIZE; ) {
    if (grid[i][j] !== 1) { i++; continue; }
    if (j < GRID_SIZE - 1 && grid[i][j + 1] === 1) { i++; continue; }
    let iEnd = i;
    while (iEnd + 1 < GRID_SIZE && grid[iEnd + 1][j] === 1 && (j === GRID_SIZE - 1 || grid[iEnd + 1][j + 1] !== 1)) iEnd++;
    segments.push({ x1: x(iEnd + 1), y1: y2, x2: x(i), y2: y2 });
    i = iEnd + 1;
  }
}
for (let i = 0; i < GRID_SIZE; i++) {
  const x1 = x(i);
  const x2 = x(i + 1);
  for (let j = 0; j < GRID_SIZE; ) {
    if (grid[i][j] !== 1) { j++; continue; }
    if (i > 0 && grid[i - 1][j] === 1) { j++; continue; }
    let jEnd = j;
    while (jEnd + 1 < GRID_SIZE && grid[i][jEnd + 1] === 1 && (i === 0 || grid[i - 1][jEnd + 1] !== 1)) jEnd++;
    segments.push({ x1: x2, y1: yAt(jEnd) + CELL_WORLD, x2: x2, y2: yAt(j) });
    j = jEnd + 1;
  }
  for (let j = 0; j < GRID_SIZE; ) {
    if (grid[i][j] !== 1) { j++; continue; }
    if (i < GRID_SIZE - 1 && grid[i + 1][j] === 1) { j++; continue; }
    let jEnd = j;
    while (jEnd + 1 < GRID_SIZE && grid[i][jEnd + 1] === 1 && (i === GRID_SIZE - 1 || grid[i + 1][jEnd + 1] !== 1)) jEnd++;
    segments.push({ x1: x1, y1: yAt(jEnd) + CELL_WORLD, x2: x1, y2: yAt(j) });
    j = jEnd + 1;
  }
}

const data = { walls: segments, zones: { grid } };
const outPath = path.join(__dirname, '..', 'data', 'custom-map.json');
fs.writeFileSync(outPath, JSON.stringify(data), 'utf8');
console.log('Wrote', outPath);
