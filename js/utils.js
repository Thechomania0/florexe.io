import { RARITIES, RARITY_COLORS } from './config.js';

export function randomInRange(min, max) {
  return min + Math.random() * (max - min);
}

export function randomInt(min, max) {
  return Math.floor(randomInRange(min, max + 1));
}

export function distance(x1, y1, x2, y2) {
  return Math.hypot(x2 - x1, y2 - y1);
}

export function angleBetween(x1, y1, x2, y2) {
  return Math.atan2(y2 - y1, x2 - x1);
}

export function pickRandomWeighted(weights) {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (const [key, w] of Object.entries(weights)) {
    r -= w;
    if (r <= 0) return key;
  }
  return Object.keys(weights)[0];
}

export function drawPolygon(ctx, x, y, sides, radius, rotation = 0) {
  if (sides < 3) return;
  ctx.beginPath();
  for (let i = 0; i <= sides; i++) {
    const angle = (i / sides) * Math.PI * 2 + rotation;
    const px = x + Math.cos(angle) * radius;
    const py = y + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

export function getRarityColor(rarity) {
  return RARITY_COLORS[rarity] || '#888';
}

export function getRarityIndex(rarity) {
  return RARITIES.indexOf(rarity);
}

export function darkenColor(hex, amount = 40) {
  hex = hex.replace('#', '');
  if (hex.length === 8) hex = hex.slice(0, 6);
  const num = parseInt(hex, 16);

  let r = (num >> 16) - amount;
  let g = ((num >> 8) & 0xff) - amount;
  let b = (num & 0xff) - amount;

  r = Math.max(0, r);
  g = Math.max(0, g);
  b = Math.max(0, b);

  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Draw a smooth health bar with rounded corners and outline.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x - left of bar
 * @param {number} y - top of bar
 * @param {number} w - width
 * @param {number} h - height
 * @param {number} fillPct - 0..1
 * @param {object} opts - optional: trackColor, fillColor, outlineColor, radius
 */
export function drawRoundedHealthBar(ctx, x, y, w, h, fillPct, opts = {}) {
  const trackColor = opts.trackColor ?? 'rgba(0,0,0,0.4)';
  const fillColor = opts.fillColor ?? '#81c784';
  const outlineColor = opts.outlineColor ?? 'rgba(0,0,0,0.7)';
  const radius = opts.radius ?? Math.min(h / 2, w / 8, 4);

  ctx.save();

  // Rounded rect path
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.arcTo(x + w, y, x + w, y + radius, radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
  ctx.lineTo(x + radius, y + h);
  ctx.arcTo(x, y + h, x, y + h - radius, radius);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();

  // Track (background)
  ctx.fillStyle = trackColor;
  ctx.fill();
  ctx.strokeStyle = outlineColor;
  ctx.lineWidth = opts.lineWidth ?? 1.5;
  ctx.stroke();

  // Fill (current HP) clipped to rounded rect
  const pct = Math.max(0, Math.min(1, fillPct));
  if (pct > 0.001) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.arcTo(x + w, y, x + w, y + radius, radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
    ctx.lineTo(x + radius, y + h);
    ctx.arcTo(x, y + h, x, y + h - radius, radius);
    ctx.lineTo(x, y + radius);
    ctx.arcTo(x, y, x + radius, y, radius);
    ctx.closePath();
    ctx.clip();
    ctx.fillStyle = fillColor;
    ctx.fillRect(x, y, w * pct, h);
  }

  ctx.restore();
}