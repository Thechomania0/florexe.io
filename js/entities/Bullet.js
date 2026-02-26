import { getRarityColor } from '../utils.js';
import { distance } from '../utils.js';

export class Bullet {
  constructor(x, y, angle, damage, size, speed, ownerId, isBig = false, weight = 1, options = {}) {
    this.x = x;
    this.y = y;
    this.angle = angle;
    this.damage = damage;
    this.size = size * 0.7;
    this.speed = speed * 0.7; // slightly slower bullets
    this.ownerId = ownerId;
    this.isBig = isBig;
    this.weight = weight;
    this.lifetime = 3000;

    this.penetrating = options.penetrating ?? false;
    this.originX = options.originX ?? x;
    this.originY = options.originY ?? y;
    this.maxRange = options.maxRange ?? null;
    this.hp = options.hp ?? null;
    this.maxHp = options.maxHp ?? options.hp ?? null;
    this.hitTargets = new Set(); // for penetrating: each entity hit only once

    this.trail = [];
    this.maxTrail = 8;
  }

  update(dt) {
    this.trail.unshift({ x: this.x, y: this.y });
    if (this.trail.length > this.maxTrail) this.trail.pop();

    this.x += Math.cos(this.angle) * this.speed * dt;
    this.y += Math.sin(this.angle) * this.speed * dt;
    this.lifetime -= dt;

    if (this.maxRange != null && distance(this.x, this.y, this.originX, this.originY) > this.maxRange)
      this.lifetime = 0;
    if (this.hp != null && this.hp <= 0)
      this.lifetime = 0;
  }

  draw(ctx, scale) {
    const bodyColor = '#1ca8c9';
    const outlineColor = '#4a4a4a';

    // ===== Trail =====
    for (let i = 0; i < this.trail.length; i++) {
      const t = this.trail[i];
      const alpha = 1 - i / this.trail.length;

      ctx.globalAlpha = alpha * 0.4;
      ctx.fillStyle = bodyColor;
      ctx.beginPath();
      ctx.arc(t.x, t.y, this.size * (1 - i / this.trail.length), 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1;

    // ===== Glow =====
    ctx.shadowColor = bodyColor;
    ctx.shadowBlur = 15;

    // ===== Main Bullet =====
    ctx.fillStyle = bodyColor;
    ctx.strokeStyle = outlineColor;
    ctx.lineWidth = 3 / scale;

    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.shadowBlur = 0;
  }
}