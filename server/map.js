/**
 * Server-side map: built-in walls (Centralia Plains) for spawn validation.
 * Mobs must spawn in playable areas, not inside walls.
 */
const WALL_HALF_WIDTH = 120;

const CORRIDOR_HALF = 280;
const WINDING_WAYPOINTS = [
  [900, 900],
  [900, 2200],
  [-400, 2200],
  [-400, 3800],
  [-1800, 3800],
  [-1800, 5200],
  [-3200, 5200],
  [-3200, 6600],
  [-4600, 6600],
  [-4600, 7600],
  [-5800, 7600],
  [-6800, 7600],
  [-7200, 7200],
];

function buildWallsFromWaypoints(waypoints, halfWidth) {
  const walls = [];
  for (let i = 0; i < waypoints.length - 1; i++) {
    const [ax, ay] = waypoints[i];
    const [bx, by] = waypoints[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    walls.push({ x1: ax + nx * halfWidth, y1: ay + ny * halfWidth, x2: bx + nx * halfWidth, y2: by + ny * halfWidth });
    walls.push({ x1: ax - nx * halfWidth, y1: ay - ny * halfWidth, x2: bx - nx * halfWidth, y2: by - ny * halfWidth });
  }
  return walls;
}

function buildSectionWalls() {
  const n = 1200;
  const g = 200;
  const topY = n + g;
  const gapMin = 600;
  const gapMax = 1200;
  return [
    { x1: -n - g, y1: topY, x2: -n - g, y2: -n - g },
    { x1: -n - g, y1: -n - g, x2: n + g, y2: -n - g },
    { x1: n + g, y1: -n - g, x2: n + g, y2: topY },
    { x1: n + g, y1: topY, x2: gapMax, y2: topY },
    { x1: gapMin, y1: topY, x2: -n - g, y2: topY },
  ];
}

const BUILT_IN_WALLS = [...buildSectionWalls(), ...buildWallsFromWaypoints(WINDING_WAYPOINTS, CORRIDOR_HALF)];

function isPointInWall(x, y, walls = BUILT_IN_WALLS) {
  for (const w of walls) {
    const dx = w.x2 - w.x1;
    const dy = w.y2 - w.y1;
    const len = Math.hypot(dx, dy) || 1;
    const t = Math.max(0, Math.min(1, ((x - w.x1) * dx + (y - w.y1) * dy) / (len * len)));
    const px = w.x1 + t * dx;
    const py = w.y1 + t * dy;
    const dist = Math.hypot(x - px, y - py);
    if (dist < WALL_HALF_WIDTH) return true;
  }
  return false;
}

function getBuiltInWalls() {
  return BUILT_IN_WALLS;
}

module.exports = {
  isPointInWall,
  getBuiltInWalls,
};
