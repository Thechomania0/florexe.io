import { distance, angleBetween, darkenColor } from '../utils.js';

const HIVE_DRONE_HP = 60;

export class Drone {
  constructor(owner, x, y, damage, range, bodyColor = '#1ca8c9') {
    this.owner = owner;
    this.bodyColor = bodyColor;
    this.x = x;
    this.y = y;
    this.damage = damage;
    this.range = range;
    this.size = 6;
    /** Hitbox radius to match square outline: inradius = half-diagonal / sqrt(2) = size / sqrt(2). */
    this.collisionRadius = this.size / Math.SQRT2;
    this.speed = 104 * 1.4 * 1.4; // +40% twice (~96% total)
    this.target = null;
    this.maxHp = HIVE_DRONE_HP;
    this.hp = HIVE_DRONE_HP;
  }

  update(dt, game, targetX, targetY, visionRadius) {
    const entities = [...(game.foods || []), ...(game.beetles || [])];
    const ownerDist = distance(this.x, this.y, this.owner.x, this.owner.y);
    const maxRange = typeof visionRadius === 'number' ? visionRadius : this.range;
    if (ownerDist > maxRange) {
      if (this.owner.removeDrone) this.owner.removeDrone(this);
      return;
    }

    let moveTargetX, moveTargetY;
    if (targetX != null && targetY != null) {
      moveTargetX = targetX;
      moveTargetY = targetY;
    } else {
      if (!this.target || !entities.includes(this.target) || this.target.hp <= 0) {
        let closest = null;
        let minDist = Infinity;
        for (const e of entities) {
          if (e.hp <= 0) continue;
          const d = distance(this.x, this.y, e.x, e.y);
          if (d < minDist && d < this.range) {
            minDist = d;
            closest = e;
          }
        }
        this.target = closest;
      }
      if (this.target) {
        moveTargetX = this.target.x;
        moveTargetY = this.target.y;
      }
    }

    if (moveTargetX != null && moveTargetY != null) {
      const angle = angleBetween(this.x, this.y, moveTargetX, moveTargetY);
      this.x += Math.cos(angle) * this.speed * (dt / 1000);
      this.y += Math.sin(angle) * this.speed * (dt / 1000);
    }

    this._resolveOverlapWithOtherHiveDrones();
    this._resolveOverlapWithOverlordDrones(this.owner?.overlordDrones ?? []);

    for (const food of entities) {
      if (food.hp <= 0) continue;
      const d = distance(this.x, this.y, food.x, food.y);
      const minDist = this.collisionRadius + (food.size || 20);
      if (d < minDist) {
        this.hp -= (food.damage ?? 10) * (dt / 1000);
        const dmg = this.damage * (dt / 1000);
        food.hp -= dmg;
        if (food.hp <= 0) {
          food.hp = 0;
          if (this.owner.onKill) this.owner.onKill(food, game);
        }
        if (d > 0) {
          const overlap = minDist - d;
          const nx = (this.x - food.x) / d;
          const ny = (this.y - food.y) / d;
          this.x += nx * overlap;
          this.y += ny * overlap;
        }
        break;
      }
    }
  }

  _resolveOverlapWithOverlordDrones(overlordDrones) {
    for (const other of overlordDrones) {
      if (!other || other.hp <= 0) continue;
      const d = distance(this.x, this.y, other.x, other.y);
      const otherR = other.collisionRadius ?? other.size;
      const minDist = this.collisionRadius + otherR;
      if (d > 0 && d < minDist) {
        const overlap = minDist - d;
        const nx = (this.x - other.x) / d;
        const ny = (this.y - other.y) / d;
        this.x += nx * overlap;
        this.y += ny * overlap;
      }
    }
  }

  _resolveOverlapWithOtherHiveDrones() {
    const others = this.owner?.drones ?? [];
    for (const other of others) {
      if (other === this) continue;
      const d = distance(this.x, this.y, other.x, other.y);
      const minDist = this.collisionRadius + (other.collisionRadius ?? other.size);
      if (d > 0 && d < minDist) {
        const overlap = minDist - d;
        const nx = (this.x - other.x) / d;
        const ny = (this.y - other.y) / d;
        this.x += nx * overlap;
        this.y += ny * overlap;
      }
    }
  }

  draw(ctx, scale) {
    const fill = this.bodyColor || '#1ca8c9';
    ctx.fillStyle = fill;
    ctx.strokeStyle = darkenColor(fill, 50);
    ctx.lineWidth = 1.5 / scale;
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const px = this.x + Math.cos(a) * this.size;
      const py = this.y + Math.sin(a) * this.size;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}
