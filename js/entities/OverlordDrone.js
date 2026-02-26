import { distance, angleBetween } from '../utils.js';
import { TANK_UPGRADES } from '../config.js';

const OVERLORD_MAX_RANGE = 1800;   // 10x original 180
const OVERLORD_RETURN_RANGE = 500; // 10x original 50
const OVERLORD_RECHARGE_TIME = 800;

export class OverlordDrone {
  constructor(owner, index, total, damage) {
    this.owner = owner;
    this.index = index;
    this.total = total;
    this.damage = damage;
    const t = TANK_UPGRADES.overlord;
    const r = owner.equippedTank?.subtype === 'overlord' ? (owner.equippedTank.rarity || 'common') : 'common';
    const mult = (t.droneSizeByRarity && t.droneSizeByRarity[r]) ?? 1;
    this.size = (t.droneSizeBase ?? 10) * mult;
    this.speed = 104 * 1.4 * 1.4; // +40% twice (~96% total)
    this.maxHp = damage;
    this.hp = damage;
    const angle = (index / total) * Math.PI * 2;
    this.x = owner.x + Math.cos(angle) * 40;
    this.y = owner.y + Math.sin(angle) * 40;
    this.targetX = owner.x;
    this.targetY = owner.y;
    this.target = null; // locked target when in auto-attack mode (food/mob)
    this.rechargeUntil = 0;
  }

  update(dt, targetX, targetY, foods, game, otherDrones = []) {
    const now = Date.now();
    const distToOwner = distance(this.x, this.y, this.owner.x, this.owner.y);

    if (this.rechargeUntil > 0) {
      this.target = null; // clear lock when returning to recharge
      const backAngle = angleBetween(this.x, this.y, this.owner.x, this.owner.y);
      this.x += Math.cos(backAngle) * this.speed * 1.5 * (dt / 1000);
      this.y += Math.sin(backAngle) * this.speed * 1.5 * (dt / 1000);
      if (distToOwner < OVERLORD_RETURN_RANGE) {
        if (now >= this.rechargeUntil) this.rechargeUntil = 0;
        else {
          const orbitAngle = (this.index / this.total) * Math.PI * 2 + now * 0.002;
          this.x = this.owner.x + Math.cos(orbitAngle) * 35;
          this.y = this.owner.y + Math.sin(orbitAngle) * 35;
        }
      }
      this._resolveOverlapWithOtherOverlordDrones(otherDrones);
      this._resolveOverlapWithHiveDrones(game.player?.drones ?? []);
      return;
    }

    if (distToOwner > OVERLORD_MAX_RANGE) {
      this.target = null;
      const backAngle = angleBetween(this.x, this.y, this.owner.x, this.owner.y);
      this.x += Math.cos(backAngle) * this.speed * (dt / 1000);
      this.y += Math.sin(backAngle) * this.speed * (dt / 1000);
      this._resolveOverlapWithOtherOverlordDrones(otherDrones);
      this._resolveOverlapWithHiveDrones(game.player?.drones ?? []);
      return;
    }

    let moveX = targetX;
    let moveY = targetY;
    if (moveX == null || moveY == null) {
      // Auto-attack: lock onto nearest target until it or this drone dies
      if (!this.target || !foods.includes(this.target) || this.target.hp <= 0) {
        let closest = null;
        let minDist = Infinity;
        for (const f of foods) {
          if (f.hp <= 0) continue;
          const d = distance(this.x, this.y, f.x, f.y);
          if (d < minDist) {
            minDist = d;
            closest = f;
          }
        }
        this.target = closest;
      }
      if (this.target) {
        moveX = this.target.x;
        moveY = this.target.y;
      } else {
        moveX = this.owner.x;
        moveY = this.owner.y;
      }
    } else {
      this.target = null; // player control clears lock
    }

    this.targetX = moveX;
    this.targetY = moveY;
    const moveAngle = angleBetween(this.x, this.y, moveX, moveY);
    this.x += Math.cos(moveAngle) * this.speed * (dt / 1000);
    this.y += Math.sin(moveAngle) * this.speed * (dt / 1000);

    this._resolveOverlapWithOtherOverlordDrones(otherDrones);
    this._resolveOverlapWithHiveDrones(game.player?.drones ?? []);

    for (const food of foods) {
      if (food.hp <= 0) continue;
      const foodSize = food.size ?? 20;
      const d = distance(this.x, this.y, food.x, food.y);
      const minDist = this.size * 1.5 + foodSize;
      if (d < minDist) {
        this.hp -= (food.damage ?? 10) * (dt / 1000);
        food.hp -= this.damage * (dt / 1000);
        if (food.hp <= 0 && this.owner.onKill) this.owner.onKill(food, game);
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

  _resolveOverlapWithHiveDrones(hiveDrones) {
    for (const other of hiveDrones) {
      if (!other || other.hp <= 0) continue;
      const d = distance(this.x, this.y, other.x, other.y);
      const minDist = this.size + other.size;
      if (d > 0 && d < minDist) {
        const overlap = minDist - d;
        const nx = (this.x - other.x) / d;
        const ny = (this.y - other.y) / d;
        this.x += nx * overlap;
        this.y += ny * overlap;
      }
    }
  }

  _resolveOverlapWithOtherOverlordDrones(otherDrones) {
    for (const other of otherDrones) {
      if (other === this) continue;
      const d = distance(this.x, this.y, other.x, other.y);
      const minDist = this.size + other.size;
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
    const distToOwner = distance(this.x, this.y, this.owner.x, this.owner.y);
    const recharging = distToOwner < OVERLORD_RETURN_RANGE && Date.now() < this.rechargeUntil;
    ctx.fillStyle = recharging ? '#0066aa' : '#00aacc';
    ctx.strokeStyle = recharging ? '#004466' : '#0088aa';
    ctx.lineWidth = 2 / scale;
    ctx.beginPath();
    const toward = angleBetween(this.x, this.y, this.targetX, this.targetY);
    // Equilateral triangle: all vertices on circle of radius this.size, 120° apart
    const TWO_THIRDS_PI = (2 * Math.PI) / 3;
    ctx.moveTo(this.x + Math.cos(toward) * this.size, this.y + Math.sin(toward) * this.size);
    ctx.lineTo(this.x + Math.cos(toward + TWO_THIRDS_PI) * this.size, this.y + Math.sin(toward + TWO_THIRDS_PI) * this.size);
    ctx.lineTo(this.x + Math.cos(toward + 2 * TWO_THIRDS_PI) * this.size, this.y + Math.sin(toward + 2 * TWO_THIRDS_PI) * this.size);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}
