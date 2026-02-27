import { getRarityColor, darkenColor } from '../utils.js';
import { distance } from '../utils.js';

const BOUNCE_STRENGTH = 0.015;
const BOUNCE_CONTACT_WINDOW = 100;
const MAX_SEPARATION_PER_FRAME = 2.5;
const RIOT_NO_BOUNCE = true;
const TRAP_FOOD_PUSH_SCALE = 0.12;
const TRAP_NO_COLLISION_MS = 200; // Riot/Anchor: no collision for first 0.2s after spawn
/** Weight comparison: push factor = (higher/lower - 1) capped at 1 (100%). Heavier can push lighter by that %. */
const WEIGHT_MAX = 100;

function effectiveWeight(w) {
  const n = Math.max(0, Math.min(WEIGHT_MAX, typeof w === 'number' ? w : 1));
  return n === 0 ? 1 : n;
}
function displaceStrength(pusherWeight, pushedWeight) {
  const pw = effectiveWeight(pusherWeight);
  const pd = effectiveWeight(pushedWeight);
  if (pw <= pd) return 0;
  const higher = pw;
  const lower = pd;
  const decimal = higher / lower - 1;
  return Math.min(1, decimal);
}

export class Square {
  constructor(x, y, damage, hp, size, duration, ownerId, rarity, vx = 0, vy = 0, bodyColor = null, bounceOnContact = false, launchDuration = 0, isRiotTrap = false, weight = 1, trapPushScale = 1) {
    this.x = x;
    this.y = y;

    this.vx = vx;
    this.vy = vy;

    this.damage = damage;
    this.maxHp = hp;
    this.hp = hp;

    this.size = size;
    this.duration = duration;

    this.ownerId = ownerId;
    this.rarity = rarity;
    this.weight = weight;

    this.spawnedAt = Date.now();
    this.trapPushScale = trapPushScale;

    this.rotation = 0;
    this.angularVelocity = 0;
    this.canRotate = false;
    this.bodyColor = bodyColor;
    this.bounceOnContact = bounceOnContact;
    this.launchDuration = launchDuration;
    this.isRiotTrap = isRiotTrap;
    this.contactStart = new Map();
  }

  update(dt, game) {
    this.duration -= dt;

    if (this.launchDuration > 0) {
      this.launchDuration -= dt;
      if (this.launchDuration <= 0) {
        this.vx = 0;
        this.vy = 0;
      }
    }

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    this.rotation += this.angularVelocity * (dt / 1000);
    this.angularVelocity *= 0.98;

    if (this.canRotate) {
      this.rotation += 0.02 * dt;
    }

    const now = Date.now();
    const collisionEnabled = now - this.spawnedAt >= TRAP_NO_COLLISION_MS;

    if (collisionEnabled) {
      for (const other of game.squares) {
        if (other === this) continue;
        if (now - other.spawnedAt < TRAP_NO_COLLISION_MS) continue; // skip others in no-collision window
        const d = distance(this.x, this.y, other.x, other.y);
        const overlap = this.size + other.size - d;
        if (overlap > 0) {
          const nx = d > 0 ? (this.x - other.x) / d : 1;
          const ny = d > 0 ? (this.y - other.y) / d : 0;
          const bothRiot = RIOT_NO_BOUNCE && this.isRiotTrap && other.isRiotTrap;
          // Weight-based separation: heavier shape pushes lighter (riot weight 0 → effective 1 so it gets pushed, doesn't push)
          const pw = effectiveWeight(this.weight);
          const po = effectiveWeight(other.weight);
          const totalWeight = pw + po;
          const separation = Math.min(overlap / 2, MAX_SEPARATION_PER_FRAME);
          const moveThis = separation * (po / totalWeight);
          const moveOther = separation * (pw / totalWeight);
          this.x += nx * moveThis;
          this.y += ny * moveThis;
          other.x -= nx * moveOther;
          other.y -= ny * moveOther;

          const bounce = !bothRiot && (this.bounceOnContact || other.bounceOnContact);
          if (bounce) {
            let start = this.contactStart.get(other);
            if (start == null) {
              start = now;
              this.contactStart.set(other, start);
              if (other.contactStart) other.contactStart.set(this, start);
            }
            if (now - start < BOUNCE_CONTACT_WINDOW) {
              const strThis = displaceStrength(this.weight, other.weight);
              const strOther = displaceStrength(other.weight, this.weight);
              if (strThis > 0) {
                other.vx -= nx * BOUNCE_STRENGTH;
                other.vy -= ny * BOUNCE_STRENGTH;
              }
              if (strOther > 0) {
                this.vx += nx * BOUNCE_STRENGTH;
                this.vy += ny * BOUNCE_STRENGTH;
              }
            }
          }
          const relVx = this.vx - other.vx;
          const relVy = this.vy - other.vy;
          const tangent = -nx * relVy + ny * relVx;
          const spin = (RIOT_NO_BOUNCE && this.isRiotTrap && other.isRiotTrap) ? 0.0012 : 0.0008;
          this.angularVelocity += tangent * spin;
          other.angularVelocity -= tangent * spin;
        } else {
          this.contactStart.delete(other);
          if (other.contactStart) other.contactStart.delete(this);
        }
      }

      // Trap–food collision: separation and push by weight spectrum (1–100)
      for (const food of game.foods) {
        if (food.hp <= 0) continue;
        const d = distance(this.x, this.y, food.x, food.y);
        const overlap = this.size + food.size - d;
        if (overlap > 0) {
          const nx = d > 0 ? (this.x - food.x) / d : 1;
          const ny = d > 0 ? (this.y - food.y) / d : 0;
          const separation = Math.min(overlap / 2, MAX_SEPARATION_PER_FRAME);
          this.x += nx * separation;
          this.y += ny * separation;
          food.x -= nx * separation;
          food.y -= ny * separation;
          const trapPushes = displaceStrength(this.weight, food.weight);
          const foodPushes = displaceStrength(food.weight, this.weight);
          const scale = TRAP_FOOD_PUSH_SCALE * this.trapPushScale;
          if (trapPushes > 0 && !this.isRiotTrap) {
            food.vx += nx * this.vx * scale * trapPushes;
            food.vy += ny * this.vy * scale * trapPushes;
            this.vx -= nx * this.vx * scale * trapPushes * 0.5;
            this.vy -= ny * this.vy * scale * trapPushes * 0.5;
          }
          if (foodPushes > 0) {
            this.vx += nx * (food.vx || 0) * scale * foodPushes;
            this.vy += ny * (food.vy || 0) * scale * foodPushes;
          }
          const tangent = -nx * this.vy + ny * this.vx;
          this.angularVelocity += tangent * 0.0005;
        }
      }
      for (const beetle of game.beetles || []) {
        if (beetle.hp <= 0) continue;
        const overlap = beetle.getEllipseOverlap(this.x, this.y, this.size);
        if (overlap > 0) {
          const d = distance(this.x, this.y, beetle.x, beetle.y);
          const nx = d > 0 ? (this.x - beetle.x) / d : 1;
          const ny = d > 0 ? (this.y - beetle.y) / d : 0;
          const separation = Math.min(overlap / 2, MAX_SEPARATION_PER_FRAME);
          this.x += nx * separation;
          this.y += ny * separation;
          beetle.x -= nx * separation;
          beetle.y -= ny * separation;
          const trapPushes = displaceStrength(this.weight, beetle.weight);
          const beetlePushes = displaceStrength(beetle.weight, this.weight);
          const scale = TRAP_FOOD_PUSH_SCALE * this.trapPushScale;
          if (trapPushes > 0 && !this.isRiotTrap && this.trapPushScale > 0) {
            beetle.vx += nx * this.vx * scale * trapPushes;
            beetle.vy += ny * this.vy * scale * trapPushes;
            this.vx -= nx * this.vx * scale * trapPushes * 0.5;
            this.vy -= ny * this.vy * scale * trapPushes * 0.5;
          }
          if (beetlePushes > 0) {
            this.vx += nx * beetle.vx * scale * beetlePushes;
            this.vy += ny * beetle.vy * scale * beetlePushes;
            beetle.vx -= nx * beetle.vx * scale * beetlePushes * 0.5;
            beetle.vy -= ny * beetle.vy * scale * beetlePushes * 0.5;
          }
          const tangent = -nx * this.vy + ny * this.vx;
          this.angularVelocity += tangent * 0.0005;
        }
      }
    }
  }

  isExpired() {
    return this.duration <= 0 || this.hp <= 0;
  }

  draw(ctx, scale) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rotation);

    const fillColor = this.bodyColor || getRarityColor(this.rarity);
    ctx.fillStyle = fillColor;
    ctx.strokeStyle = darkenColor(fillColor, 60);
    ctx.lineWidth = 2 / scale;

    ctx.fillRect(-this.size, -this.size, this.size * 2, this.size * 2);
    ctx.strokeRect(-this.size, -this.size, this.size * 2, this.size * 2);

    ctx.restore();
  }
}