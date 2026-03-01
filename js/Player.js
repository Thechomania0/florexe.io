import { distance, angleBetween, drawPolygon, getRarityColor, pickRandomWeighted, drawRoundedHealthBar } from './utils.js';
import { INFERNO_BASE_RADIUS, BODY_UPGRADES, TANK_UPGRADES, FOOD_CONFIG, BEETLE_CONFIG, getXpForLevel, MAP_SIZE, RARITIES, RECOIL_MOVE_PERCENT, RECOIL_SPEED_SCALE, ICE_FRICTION_PER_SECOND, MOVEMENT_ACCELERATION, RECOIL_IMPULSE_MS, BOUNCE_IMPULSE_FACTOR } from './config.js';
import { Bullet } from './entities/Bullet.js';
import { Square } from './entities/Square.js';
import { Drone } from './entities/Drone.js';
import { darkenColor } from './utils.js';

/** Lazy-load OverlordDrone so main menu works even if this file fails (e.g. 503). */
let _OverlordDroneModule = null;
async function getOverlordDrone() {
  if (_OverlordDroneModule) return _OverlordDroneModule.OverlordDrone;
  try {
    _OverlordDroneModule = await import('./entities/OverlordDrone.js');
    return _OverlordDroneModule.OverlordDrone;
  } catch (e) {
    console.warn('[OverlordDrone] Failed to load:', e);
    return null;
  }
}  

const BASE_HP = 500;
const BASE_BODY_DAMAGE = 50;
const LEVEL_SCALE_PER = 0.10; // +10% per 10 levels for body damage
const HP_SCALE_PER = 0.30;    // +30% per 2 levels for HP
const BASE_SPEED = 0.35;
const HIVE_RANGE = INFERNO_BASE_RADIUS * 2 * 10; // 10x extended range

export class Player {
  constructor(id, x, y, gamemode = 'ffa') {
    this.id = id;
    this.x = x;
    this.y = y;
    this.angle = 0;
    this.gamemode = gamemode;
    this.maxHp = BASE_HP;
    this.hp = BASE_HP;
    this.level = 1;
    this.xp = 0;
    this.score = 0;
    this.stars = 0;
    this.speed = BASE_SPEED;
    this.attackMult = 1;
    this.size = 35 * 0.7;
    this.hand = [];        // Max 5 visible equipped slots
    this.inventory = [];   // Overflow storage
    this.equippedBody = null;
    this.equippedTank = null;
    this.lastShot = 0;
    this.riotBurstIndex = 0;
    this.lastRiotShot = 0;
    this.riotRecoil = [0, 0, 0]; // per-barrel piston recoil
    this.overlordRecoil = [0, 0, 0, 0]; // per-square recoil when drone exits
    this.streamlinerRecoil = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; // per-segment barrel recoil (left to right)
    this.streamlinerSegmentIndex = 0;
    this.hiveRecoil = [0, 0, 0, 0, 0, 0]; // per-side recoil when hive drone exits
    this.squares = [];
    this.drones = [];
    this.overlordDrones = [];
    this.lastHiveSpawn = 0;
    this.lastHiveDroneDeathTime = 0;
    this.overlordDroneRespawnUntil = 0;
    this.dead = false;
    this.ghost = false;
    this.adminMode = false;
    this.displayName = null;

    this.mobKills = Object.fromEntries(RARITIES.map((r) => [r, 0]));

    this.vx = 0;
    this.vy = 0;

    this.keys = { w: false, a: false, s: false, d: false };
    this.mouseX = 0;
    this.mouseY = 0;
    this.mouseRightDown = false;
    this.autoAttack = false;

    this.equippedTank = { type: 'tank', subtype: 'base', rarity: 'common' };
    this.equippedBody = null;
    this.hand = [];
    this.bodyColor = '#1ca8c9';
    this.applyStats();
  }

  applyStats() {
    // Body damage: +10% per 10 levels (levels 1–10 = 1x, 11–20 = 1.1x, etc.)
    const levelScale = 1 + LEVEL_SCALE_PER * Math.floor((this.level - 1) / 10);
    // HP: +30% per 2 levels (levels 1–2 = 1x, 3–4 = 1.3x, 5–6 = 1.6x, etc.)
    const hpLevelScale = 1 + HP_SCALE_PER * Math.floor((this.level - 1) / 2);

    // ===== RESET BASE STATS =====
    this.reload = 600;
    this.bulletDamage = 20;
    this.bulletSpeed = 0.4;
    this.bulletSize = 6;

    this.bodyDamage = Math.round(BASE_BODY_DAMAGE * levelScale);
    this.maxHp = Math.round(BASE_HP * hpLevelScale);
    this.speed = 0.175;

    // ===== FIX MISPLACED ITEMS (Riot/Destroyer etc are tank, not body) =====
    const tankSubtypes = ['base', 'destroyer', 'anchor', 'riot', 'overlord', 'streamliner'];
    const bodySubtypes = ['inferno', 'ziggurat', 'cutter', 'hive'];
    if (this.equippedBody && tankSubtypes.includes(this.equippedBody.subtype)) {
      const wasTank = this.equippedTank;
      this.equippedTank = this.equippedBody;
      this.equippedBody = wasTank && bodySubtypes.includes(wasTank.subtype) ? wasTank : null;
      if (wasTank && !bodySubtypes.includes(wasTank.subtype)) this.inventory.push(wasTank);
    }
    if (this.equippedTank && bodySubtypes.includes(this.equippedTank.subtype)) {
      const wasBody = this.equippedBody;
      this.equippedBody = this.equippedTank;
      this.equippedTank = wasBody && tankSubtypes.includes(wasBody.subtype) ? wasBody : null;
      if (wasBody && !tankSubtypes.includes(wasBody.subtype)) this.inventory.push(wasBody);
    }

    // ===== APPLY TANK STATS =====
    if (this.equippedTank) {
      const t = TANK_UPGRADES[this.equippedTank.subtype];
      if (t) {
        this.reload = t.reload ?? this.reload;
        this.bulletDamage = t.damageByRarity?.[this.equippedTank.rarity] ?? t.damage ?? this.bulletDamage;
        this.bulletSpeed = t.bulletSpeed ?? this.bulletSpeed;
        this.bulletSize = t.bulletSize ?? this.bulletSize;
        this.barrelLength = t.barrelLength;
      }
    }
  
    // ===== APPLY BODY STATS =====
    const oldMaxHp = this.maxHp;
    if (this.equippedBody) {
      const b = BODY_UPGRADES[this.equippedBody.subtype];
      const r = this.equippedBody.rarity;
      if (b) {
        if (b.hpByRarity && r) {
          if (this.equippedBody.subtype === 'ziggurat') {
            this.maxHp = (BASE_HP + (b.hpByRarity[r] || 0)) * hpLevelScale;
          } else {
            this.maxHp = (b.hpByRarity[r] ?? this.maxHp) * hpLevelScale;
          }
        }
        if (b.hpPenalty) this.maxHp *= b.hpPenalty;
        this.speed = b.speed ?? this.speed;
        if (b.speedByRarity && r) this.speed += (b.speedByRarity[r] ?? 0);
      }
    }

    this.maxHp = Math.round(this.maxHp);

    // When Ziggurat (or other body) extends max HP, fill the extra so the bar isn't empty; when removed, cap hp to new max
    if (this.maxHp > oldMaxHp) {
      this.hp = Math.min(this.maxHp, this.hp + (this.maxHp - oldMaxHp));
    } else if (this.maxHp < oldMaxHp) {
      this.hp = Math.min(this.hp, this.maxHp);
    }
  
    // clamp hp
    if (this.hp > this.maxHp) {
      this.hp = this.maxHp;
    }
  }

  takeDamage(amount) {
    if (this.adminMode) return;
    if (this.ghost) {
      this.hp = Math.max(1, this.hp - amount);
      return;
    }
    this.hp = Math.max(0, this.hp - amount);
    if (this.hp <= 0) this.dead = true;
  }

  heal(amount) {
    this.hp = Math.min(this.maxHp, this.hp + amount);
  }

  addXp(amount) {
    this.xp += amount;
    while (this.level < 100 && this.xp >= getXpForLevel(this.level + 1)) {
      this.xp -= getXpForLevel(this.level + 1);
      this.level++;
      this.applyStats();
      this.hp = Math.round(this.maxHp);
    }
  }

  addLoot(type, subtype, rarity) {
    const item = { type, subtype, rarity };
    this.inventory.push(item);
    this.applyStats();
  }

  removeDrone(drone) {
    this.drones = this.drones.filter(d => d !== drone);
    if (this.equippedBody?.subtype === 'hive') this.lastHiveDroneDeathTime = Date.now();
  }

  autoEquipFromHand() {
    if (this.hand.length === 0) return;
  
    const rarityOrder = ['common','uncommon','rare','epic','legendary','mythic','ultra','super'];
  
    const getBest = (type) => {
      const items = this.hand.filter(i => i.type === type);
      if (items.length === 0) return null;
  
      return items.reduce((best, item) => {
        if (!best) return item;
        return rarityOrder.indexOf(item.rarity) >
               rarityOrder.indexOf(best.rarity)
          ? item
          : best;
      }, null);
    };
  
    const bestBody = getBest('body');
    const bestTank = getBest('tank');

    if (bestBody) this.equippedBody = bestBody;
    if (bestTank) {
      const old = this.equippedTank;
      if (old && (old.subtype === 'riot' || old.subtype === 'anchor')) {
        for (const sq of this.squares) sq.duration = 0;
      }
      this.equippedTank = bestTank;
    }

    this.applyStats();
  }

  update(dt, game) {
    if (this.dead) return;

    
    const mx = this.mouseX;
    const my = this.mouseY;
    const cam = game.camera;
    const scale = game.scale;
    const cw = game.canvasWidth ?? 720;
    const ch = game.canvasHeight ?? 720;
    const visionRadius = Math.min(cw, ch) / (2 * scale);
    const worldMouseX = cam.x + mx / scale;
    const worldMouseY = cam.y + my / scale;
    this.angle = angleBetween(this.x, this.y, worldMouseX, worldMouseY);

    // Recoil of Destroyer Gun
    if (this.recoil > 0 && this.reload > 0) {
      const recoilMax = 10;
      this.recoil -= dt * (recoilMax / (this.reload));
      if (this.recoil < 0) this.recoil = 0;
    }
    // Riot piston recoil (per barrel)
    for (let i = 0; i < 3; i++) {
      if (this.riotRecoil[i] > 0) {
        this.riotRecoil[i] -= dt * 0.04;
        if (this.riotRecoil[i] < 0) this.riotRecoil[i] = 0;
      }
    }
    // Overlord per-square recoil
    if (this.equippedTank?.subtype === 'overlord') {
      for (let i = 0; i < 4; i++) {
        if (this.overlordRecoil[i] > 0) {
          this.overlordRecoil[i] -= dt * 0.04;
          if (this.overlordRecoil[i] < 0) this.overlordRecoil[i] = 0;
        }
      }
    }
    // Streamliner per-segment recoil
    if (this.equippedTank?.subtype === 'streamliner') {
      for (let i = 0; i < 10; i++) {
        if (this.streamlinerRecoil[i] > 0) {
          this.streamlinerRecoil[i] -= dt * 0.04;
          if (this.streamlinerRecoil[i] < 0) this.streamlinerRecoil[i] = 0;
        }
      }
    }
    // Hive per-side recoil
    if (this.equippedBody?.subtype === 'hive') {
      for (let i = 0; i < 6; i++) {
        if (this.hiveRecoil[i] > 0) {
          this.hiveRecoil[i] -= dt * 0.04;
          if (this.hiveRecoil[i] < 0) this.hiveRecoil[i] = 0;
        }
      }
    }
    // Movement (ice-slide: velocity-based with friction)
    const friction = Math.pow(ICE_FRICTION_PER_SECOND, dt / 1000);
    this.vx *= friction;
    this.vy *= friction;

    let vx = 0, vy = 0;
    if (this.keys.w) vy -= 1;
    if (this.keys.s) vy += 1;
    if (this.keys.a) vx -= 1;
    if (this.keys.d) vx += 1;
    if (vx !== 0 || vy !== 0) {
      const len = Math.hypot(vx, vy);
      vx /= len;
      vy /= len;
      const accel = this.speed * MOVEMENT_ACCELERATION * (dt / 1000);
      this.vx += vx * accel;
      this.vy += vy * accel;
    }
    const speedMag = Math.hypot(this.vx, this.vy);
    if (speedMag > this.speed) {
      const scale = this.speed / speedMag;
      this.vx *= scale;
      this.vy *= scale;
    }

    // Food collision: take damage from food + deal body damage to food + bounceback (as velocity impulse + separation)
    // Ghost: no collision, pass through food
    if (!this.ghost) {
      for (const food of game.foods) {
        const d = distance(this.x, this.y, food.x, food.y);
        const overlap = this.size + food.size - d;
        if (overlap > 0) {
          this.takeDamage(food.damage * dt / 1000);
          const bodyDmg = (this.bodyDamage ?? BASE_BODY_DAMAGE) * dt / 1000;
          food.hp -= bodyDmg;
          if (food.hp <= 0) this.onKill(food, game);
          const bounce = 0.3;
          const nx = d > 0 ? (this.x - food.x) / d : 1;
          const ny = d > 0 ? (this.y - food.y) / d : 0;
          this.vx += nx * overlap * bounce * BOUNCE_IMPULSE_FACTOR;
          this.vy += ny * overlap * bounce * BOUNCE_IMPULSE_FACTOR;
          this.x += nx * overlap * bounce;
          this.y += ny * overlap * bounce;
        }
      }
      for (const beetle of game.beetles || []) {
        const overlap = beetle.getEllipseOverlap(this.x, this.y, this.size);
        if (overlap > 0) {
          this.takeDamage(beetle.damage * dt / 1000);
          const bodyDmg = (this.bodyDamage ?? BASE_BODY_DAMAGE) * dt / 1000;
          beetle.hp -= bodyDmg;
          if (beetle.hp <= 0) this.onKill(beetle, game);
          const bounce = 0.3;
          const d = distance(this.x, this.y, beetle.x, beetle.y);
          const nx = d > 0 ? (this.x - beetle.x) / d : 1;
          const ny = d > 0 ? (this.y - beetle.y) / d : 0;
          this.vx += nx * overlap * bounce * BOUNCE_IMPULSE_FACTOR;
          this.vy += ny * overlap * bounce * BOUNCE_IMPULSE_FACTOR;
          this.x += nx * overlap * bounce;
          this.y += ny * overlap * bounce;
        }
      }
    }

    // Inferno damage
    if (this.equippedBody?.subtype === 'inferno') {
      const b = BODY_UPGRADES.inferno;
    
      const r = this.equippedBody.rarity;
      const mult =
        r === 'ultra'
          ? b.sizeMultUltra
          : r === 'super'
          ? b.sizeMultSuper
          : b.sizeMult;
    
      // ✅ FIXED — single multiplication only
      const radius = INFERNO_BASE_RADIUS * mult;
    
      const dmg = (b.damageByRarity[r] || 20) * dt / 1000;
    
      for (const food of game.foods) {
        if (distance(this.x, this.y, food.x, food.y) < radius) {
          food.hp -= dmg;
          if (food.hp <= 0) this.onKill(food, game);
        }
      }
      for (const beetle of game.beetles || []) {
        if (beetle.ellipseOverlapsCircle(this.x, this.y, radius)) {
          beetle.hp -= dmg;
          if (beetle.hp <= 0) this.onKill(beetle, game);
        }
      }
    }

    // Hive drones
    const DRONE_RESPAWN_DELAY_MS = 2000;

    if (this.equippedBody?.subtype === 'hive') {
      const b = BODY_UPGRADES.hive;
      const spawners = b.spawnersByRarity[this.equippedBody.rarity] || 1;
      const maxDrones = spawners * 3;
      const now = Date.now();
      const canRespawnHive = now - (this.lastHiveDroneDeathTime || 0) >= DRONE_RESPAWN_DELAY_MS;
      if (this.drones.length < maxDrones && now - this.lastHiveSpawn > b.spawnInterval && canRespawnHive) {
        this.lastHiveSpawn = now;
        const dmg = b.damageByRarity[this.equippedBody.rarity] || 10;
        const hexMidDist = this.size * 1.21;
        for (let i = 0; i < spawners && this.drones.length < maxDrones; i++) {
          const slot = i % 6;
          this.hiveRecoil[slot] = 10;
          const angle = this.angle + (-60 + slot * 60) * (Math.PI / 180);
          const gx = this.x + Math.cos(angle) * hexMidDist;
          const gy = this.y + Math.sin(angle) * hexMidDist;
          this.drones.push(new Drone(this, gx, gy, dmg, visionRadius, this.bodyColor));
        }
      }
    } else {
      this.drones = [];
    }

    for (const drone of [...this.drones]) {
      const tx = this.autoAttack ? null : worldMouseX;
      const ty = this.autoAttack ? null : worldMouseY;
      drone.update(dt, game, tx, ty, visionRadius);
    }
    const hiveCountBefore = this.drones.length;
    this.drones = this.drones.filter(d => d.hp > 0);
    if (this.drones.length < hiveCountBefore) this.lastHiveDroneDeathTime = Date.now();

    // Tank shooting
    if (this.equippedTank) {
      const t = TANK_UPGRADES[this.equippedTank.subtype];
      if (!t) return;

      const r = this.equippedTank.rarity;
      const now = Date.now();
      const reload = t.reload ?? 800;

      if (this.equippedTank.subtype === 'riot') {
        const burstDelay = 50;
        const pauseAfterBurstMs = t.reloadByRarity?.[r] ?? t.reload ?? 500; // 0.5s base, -10% per rarity
        const elapsed = now - this.lastRiotShot;
        let canFire = false;
        if (this.riotBurstIndex >= 3) {
          if (elapsed >= pauseAfterBurstMs) {
            this.riotBurstIndex = 0;
            canFire = true;
          }
        } else {
          canFire = this.riotBurstIndex === 0 ? elapsed >= pauseAfterBurstMs : elapsed >= burstDelay;
        }
        if (canFire && (this.mouseRightDown || this.autoAttack)) {
          const dmg = (t.damageByRarity?.[r] || 50) * this.attackMult;
          const dur = r === 'super' ? t.squareDurationSuper : t.squareDuration;
          const barrelTip = 55;
          const stackSpacing = 12;
          const offY = (this.riotBurstIndex - 1) * stackSpacing;
          const perpX = -Math.sin(this.angle);
          const perpY = Math.cos(this.angle);
          const worldMouseX = cam.x + mx / scale;
          const worldMouseY = cam.y + my / scale;
          const distToMouse = Math.hypot(worldMouseX - this.x, worldMouseY - this.y);
          const spawnDist = Math.min(barrelTip, Math.max(0, distToMouse - 5));
          const px = this.x + Math.cos(this.angle) * spawnDist + perpX * offY;
          const py = this.y + Math.sin(this.angle) * spawnDist + perpY * offY;
          const vx = Math.cos(this.angle) * 0.22;
          const vy = Math.sin(this.angle) * 0.22;
          const trapWeight = t.weightByRarity?.[r] ?? 1;
          const sq = new Square(px, py, dmg, t.squareHp, t.squareSize, dur, this.id, r, vx, vy, '#1ca8c9', false, 180, true, trapWeight);
          sq.rotation = Math.random() * Math.PI * 2;
          sq.angularVelocity = (Math.random() - 0.5) * 0.1;
          this.squares.push(sq);
          game.addSquare(sq);
          this.riotRecoil[this.riotBurstIndex] = 10;
          this.riotBurstIndex++;
          this.lastRiotShot = now;
          this.lastShot = now;
          const recoilPct = t.recoilMovePercent ?? RECOIL_MOVE_PERCENT;
          const trapSpeed = t.trapLaunchSpeed ?? 0.22;
          const back = trapSpeed * RECOIL_SPEED_SCALE * recoilPct;
          const impulse = back / RECOIL_IMPULSE_MS;
          this.vx -= Math.cos(this.angle) * impulse;
          this.vy -= Math.sin(this.angle) * impulse;
        }
      }
      else if (this.equippedTank.subtype !== 'overlord' && (this.mouseRightDown || this.autoAttack) && now - this.lastShot > reload) {
        this.lastShot = now;

        if (this.equippedTank.subtype === 'destroyer') {
          const dmg = (t.damageByRarity?.[r] || 100) * this.attackMult;
          const bulletSpeed = t.bulletSpeed ?? 2;
          const bulletSize = t.bulletSizeByRarity?.[r] ?? t.bulletSize ?? 12;
          const bulletWeight = t.weightByRarity?.[r] ?? 1;
          const rarityIndex = Math.max(0, RARITIES.indexOf(r));
          let maxRange = (t.bulletMaxRangeBase ?? 1800) * Math.pow(1.1, rarityIndex);
          if (r !== 'super') maxRange *= 0.4; // 60% range reduction; super keeps full range
          const bulletHp = t.bulletHp ?? 50;

          game.addBullet(
            new Bullet(
              this.x,
              this.y,
              this.angle,
              dmg,
              bulletSize,
              bulletSpeed,
              this.id,
              true,
              bulletWeight,
              {
                penetrating: true,
                originX: this.x,
                originY: this.y,
                maxRange,
                hp: bulletHp,
                maxHp: bulletHp,
              }
            )
          );

          this.recoil = 8;
          const recoilPct = t.recoilMovePercentByRarity?.[r] ?? t.recoilMovePercent ?? RECOIL_MOVE_PERCENT;
          const back = bulletSpeed * RECOIL_SPEED_SCALE * recoilPct;
          const impulse = back / RECOIL_IMPULSE_MS;
          this.vx -= Math.cos(this.angle) * impulse;
          this.vy -= Math.sin(this.angle) * impulse;
        }

        else if (this.equippedTank.subtype === 'streamliner') {
          const dmg = (t.damageByRarity?.[r] || 100) * this.attackMult;
          const bulletSpeed = t.bulletSpeed ?? 2;
          const bulletSize = t.bulletSizeByRarity?.[r] ?? t.bulletSize ?? 12;
          const bulletWeight = t.weightByRarity?.[r] ?? 1;
          const rarityIndex = Math.max(0, RARITIES.indexOf(r));
          let maxRange = (t.bulletMaxRangeBase ?? 1800) * Math.pow(1.1, rarityIndex);
          if (r !== 'super') maxRange *= 0.4;

          game.addBullet(
            new Bullet(
              this.x,
              this.y,
              this.angle,
              dmg,
              bulletSize,
              bulletSpeed,
              this.id,
              true,
              bulletWeight,
              { originX: this.x, originY: this.y, maxRange }
            )
          );

          this.recoil = 8;
          this.streamlinerRecoil[this.streamlinerSegmentIndex] = 10;
          this.streamlinerSegmentIndex = (this.streamlinerSegmentIndex + 1) % 10;
          const recoilPct = t.recoilMovePercentByRarity?.[r] ?? t.recoilMovePercent ?? RECOIL_MOVE_PERCENT;
          const back = bulletSpeed * RECOIL_SPEED_SCALE * recoilPct;
          const impulse = back / RECOIL_IMPULSE_MS;
          const moveX = (this.keys.d ? 1 : 0) - (this.keys.a ? 1 : 0);
          const moveY = (this.keys.s ? 1 : 0) - (this.keys.w ? 1 : 0);
          const dot = moveX * Math.cos(this.angle) + moveY * Math.sin(this.angle);
          const impulseMult = dot > 0 ? 0.1 : 1;
          this.vx -= Math.cos(this.angle) * impulse * impulseMult;
          this.vy -= Math.sin(this.angle) * impulse * impulseMult;
        }

        else if (this.equippedTank.subtype === 'base') {
          const dmg = (t.damageByRarity?.[r] ?? t.damage ?? 10) * this.attackMult;
          const bulletSpeed = t.bulletSpeed ?? 1;
          const bulletSize = t.bulletSize ?? 12;
          const bulletWeight = t.weightByRarity?.[r] ?? 0;
          const maxRange = t.bulletMaxRangeBase ?? 600;

          game.addBullet(
            new Bullet(
              this.x,
              this.y,
              this.angle,
              dmg,
              bulletSize,
              bulletSpeed,
              this.id,
              false,
              bulletWeight,
              { originX: this.x, originY: this.y, maxRange }
            )
          );

          this.recoil = 8;
          const recoilPct = t.recoilMovePercent ?? RECOIL_MOVE_PERCENT;
          const back = bulletSpeed * RECOIL_SPEED_SCALE * recoilPct;
          const impulse = back / RECOIL_IMPULSE_MS;
          this.vx -= Math.cos(this.angle) * impulse;
          this.vy -= Math.sin(this.angle) * impulse;
        }

        else if (this.equippedTank.subtype === 'anchor') {
          const alive = game.multiplayerSocket
            ? game.serverSquares.filter(s => s.ownerId === game.multiplayerSocket.id && (s.duration || 0) > 0).length
            : this.squares.filter(s => !s.isExpired()).length;

          if (alive < t.maxSquares) {
            const dmg = (t.damageByRarity?.[r] || 300) * this.attackMult;
            const dur = r === 'super' ? t.squareDurationSuper : t.squareDuration;
            const barrelTip = 55;
            const launchSpeed = 0.2;
            const px = this.x + Math.cos(this.angle) * barrelTip;
            const py = this.y + Math.sin(this.angle) * barrelTip;
            const vx = Math.cos(this.angle) * launchSpeed;
            const vy = Math.sin(this.angle) * launchSpeed;

            const trapWeight = t.weightByRarity?.[r] ?? 1;
            const sq = new Square(
              px,
              py,
              dmg,
              t.squareHp,
              t.squareSize,
              dur,
              this.id,
              r,
              vx,
              vy,
              '#1ca8c9',
              false,
              220,
              false,
              trapWeight,
              0
            );

            this.squares.push(sq);
            game.addSquare(sq);
            this.recoil = 8;
            const recoilPct = t.recoilMovePercent ?? RECOIL_MOVE_PERCENT;
            const trapSpeed = t.trapLaunchSpeed ?? 0.2;
            const back = trapSpeed * RECOIL_SPEED_SCALE * recoilPct;
            const impulse = back / RECOIL_IMPULSE_MS;
            this.vx -= Math.cos(this.angle) * impulse;
            this.vy -= Math.sin(this.angle) * impulse;
          }
        }
      }
    }



    if (this.equippedTank?.subtype === 'overlord') {
      const OverlordDroneClass = _OverlordDroneModule?.OverlordDrone;
      if (!OverlordDroneClass) {
        getOverlordDrone(); // lazy load (will be ready next frame if successful)
      } else {
      const t = TANK_UPGRADES.overlord;
      const r = this.equippedTank.rarity;
      const count = r === 'super' ? (t.droneCountSuper ?? t.droneCount)
        : r === 'ultra' ? (t.droneCountUltra ?? t.droneCount)
        : t.droneCount;
      const dmg = (t.damageByRarity[this.equippedTank.rarity] || 20) * this.attackMult;
      const now = Date.now();
      if (this.overlordDrones.length < count) {
        if (this.overlordDroneRespawnUntil === 0) {
          while (this.overlordDrones.length < count) {
            const slot = this.overlordDrones.length % 4;
            this.overlordRecoil[slot] = 10;
            this.overlordDrones.push(new OverlordDroneClass(this, this.overlordDrones.length, count, dmg));
          }
        } else if (now >= this.overlordDroneRespawnUntil) {
          const slot = this.overlordDrones.length % 4;
          this.overlordRecoil[slot] = 10;
          this.overlordDrones.push(new OverlordDroneClass(this, this.overlordDrones.length, count, dmg));
          this.overlordDroneRespawnUntil = now + 2000;
        }
      }
      this.overlordDrones = this.overlordDrones.slice(0, count);
      const worldMouseX = cam.x + mx / scale;
      const worldMouseY = cam.y + my / scale;
      const odTargetX = this.autoAttack ? null : worldMouseX;
      const odTargetY = this.autoAttack ? null : worldMouseY;
      for (const od of this.overlordDrones) {
        od.update(dt, odTargetX, odTargetY, [...(game.foods || []), ...(game.beetles || [])], game, this.overlordDrones, visionRadius);
      }
      const overlordCountBefore = this.overlordDrones.length;
      this.overlordDrones = this.overlordDrones.filter(od => od.hp > 0);
      if (this.overlordDrones.length < overlordCountBefore) this.overlordDroneRespawnUntil = now + 2000;
      }
    } else {
      this.overlordDrones = [];
      this.overlordDroneRespawnUntil = 0;
    }

    // Update squares
    for (const sq of this.squares) {
      sq.update(dt, game);
    }
    this.squares = this.squares.filter(s => !s.isExpired());

    // Integrate velocity into position (ice-slide: all movement uses velocity)
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    const half = MAP_SIZE / 2;
    this.x = Math.max(-half, Math.min(half, this.x));
    this.y = Math.max(-half, Math.min(half, this.y));
  }

  onKill(mob, game) {
    if (!this.mobKills) this.mobKills = Object.fromEntries(RARITIES.map((r) => [r, 0]));
    this.mobKills[mob.rarity] = (this.mobKills[mob.rarity] || 0) + 1;
    this.addXp(mob.maxHp * 0.5);
    this.score += mob.maxHp;

    const isBeetle = game.beetles && game.beetles.includes(mob);
    const cfg = isBeetle ? BEETLE_CONFIG[mob.rarity] : FOOD_CONFIG[mob.rarity];
    if (cfg.stars) {
      this.stars += cfg.stars;
    }
    if (cfg.drops && Object.keys(cfg.drops).length > 0) {
      const dropRarity = pickRandomWeighted(cfg.drops);
      if (isBeetle) {
        game.addDrop(mob.x, mob.y, { type: 'petal', subtype: 'egg', rarity: dropRarity }, this.id);
      } else {
        const bodySubtypes = ['inferno', 'ziggurat', 'cutter', 'hive'];
        const tankSubtypes = ['destroyer', 'anchor', 'riot', 'overlord', 'streamliner'];
        const allSubtypes = [...bodySubtypes, ...tankSubtypes];
        const subtype = allSubtypes[Math.floor(Math.random() * allSubtypes.length)];
        const type = bodySubtypes.includes(subtype) ? 'body' : 'tank';
        game.addDrop(mob.x, mob.y, { type, subtype, rarity: dropRarity }, this.id);
      }
    }

    if (isBeetle) game.removeBeetle(mob);
    else game.removeFood(mob);
  }



  draw(ctx, scale) {
    const bodyColor = '#1ca8c9';
    const outlineColor = '#4a4a4a';
    const tankType = this.equippedTank?.subtype;
    const bodyType = this.equippedBody?.subtype;

    ctx.save();
    if (this.ghost) ctx.globalAlpha = 0.5;
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);

    const s = this.size * 2.4;
    const assets = this.tankAssets;
    const useImages = assets?.guns && assets?.bodies;

    if (useImages) {
      const gunImg = tankType && assets.guns[tankType];
      const bodyImg = assets.bodies[bodyType] || assets.bodies.default;
      const recoil = this.recoil || 0;
      const gunBaseOutline = darkenColor(bodyColor, 60);
      // Hive and Cutter bodies draw underneath the gun only when gun is NOT Riot/Anchor (Riot+Cutter, Riot+Hive, Anchor+Cutter, Anchor+Hive draw body on top later)
      const bodyUnderGun = (bodyType === 'hive' || bodyType === 'cutter') && (tankType !== 'riot' && tankType !== 'anchor');
      if (bodyType && bodyUnderGun && bodyImg?.complete && bodyImg.naturalWidth > 0) {
        ctx.drawImage(bodyImg, -s, -s, s * 2, s * 2);
      }
      // Hive: 6 light grey squares on hexagon sides (draw under gun when body is under, or on top when body is on top)
      if (bodyType === 'hive') {
        const hexMidDist = this.size * 1.21;
        const hiveSqSize = this.size * 0.385;
        ctx.fillStyle = '#9e9e9e';
        ctx.strokeStyle = '#4a4a4a';
        ctx.lineWidth = Math.max(1, 2 / scale);
        const drawHiveSquares = () => {
          for (let i = 0; i < 6; i++) {
            const angle = (-60 + i * 60) * (Math.PI / 180);
            const recoil = this.hiveRecoil[i] || 0;
            ctx.save();
            ctx.rotate(angle);
            ctx.translate(0, -hexMidDist + recoil);
            ctx.fillRect(-hiveSqSize / 2, -hiveSqSize / 2, hiveSqSize, hiveSqSize);
            ctx.strokeRect(-hiveSqSize / 2, -hiveSqSize / 2, hiveSqSize, hiveSqSize);
            ctx.restore();
          }
        };
        if (bodyUnderGun) drawHiveSquares();
      }
      const drawBaseCircle = () => {
        ctx.fillStyle = bodyColor;
        ctx.strokeStyle = gunBaseOutline;
        ctx.lineWidth = 3 / scale;
        ctx.beginPath();
        ctx.arc(0, 0, this.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      };
      const drawGunImage = () => {
        if (!gunImg?.complete || gunImg.naturalWidth <= 0) return;
        if (tankType === 'riot') {
          const forwardOffset = this.size * 0.28400625;
          const S = this.size * 0.96 * 0.792;
          const h = S * Math.sqrt(3) / 2;
          const overlap = S * 0.65;
          const startX = this.size - S * 0.5;
          ctx.save();
          ctx.translate(forwardOffset, 0);
          ctx.fillStyle = '#9e9e9e';
          ctx.strokeStyle = '#4a4a4a';
          ctx.lineWidth = Math.max(1, 2 / scale);
          for (let i = 2; i >= 0; i--) {
            const recoil = this.riotRecoil[i] || 0;
            ctx.save();
            ctx.translate(-recoil, 0);
            const tipX = startX + i * overlap;
            const baseX = tipX + S;
            ctx.beginPath();
            ctx.moveTo(tipX, 0);
            ctx.lineTo(baseX, -h);
            ctx.lineTo(baseX, h);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.restore();
          }
          ctx.restore();
        } else if ((tankType === 'destroyer' || tankType === 'anchor') && recoil > 0) {
          ctx.save();
          ctx.translate(-recoil, 0);
          ctx.drawImage(gunImg, -s, -s, s * 2, s * 2);
          ctx.restore();
        } else if (tankType === 'base') {
          ctx.save();
          const baseForward = this.size * 0.78125;
          ctx.translate(baseForward - (recoil || 0), 0);
          ctx.drawImage(gunImg, -s, -s, s * 2, s * 2);
          ctx.restore();
        } else if (tankType === 'overlord') {
          const R = this.size * 1.3;
          const w = this.size;
          ctx.fillStyle = '#9e9e9e';
          ctx.strokeStyle = '#4a4a4a';
          ctx.lineWidth = Math.max(1, 2 / scale);
          for (let i = 0; i < 4; i++) {
            ctx.save();
            ctx.rotate(i * Math.PI / 2);
            ctx.translate(0, -R + (this.overlordRecoil[i] || 0));
            ctx.fillRect(-w / 2, -w / 2, w, w);
            ctx.strokeRect(-w / 2, -w / 2, w, w);
            ctx.restore();
          }
        } else {
          ctx.drawImage(gunImg, -s, -s, s * 2, s * 2);
        }
      };
      const drawDestroyerGun = () => {
        const height = this.size * 2;
        const len = height * 0.9;
        const recoil = this.recoil || 0;
        ctx.save();
        ctx.translate(this.size * 0.10 - recoil, 0);
        ctx.fillStyle = '#9e9e9e';
        ctx.strokeStyle = '#4a4a4a';
        ctx.lineWidth = Math.max(1, 2 / scale);
        ctx.fillRect(0, -height / 2, len, height);
        ctx.strokeRect(0, -height / 2, len, height);
        ctx.restore();
      };
      const drawStreamlinerGun = () => {
        const barrelLength = (this.size * 2) * 0.9;
        const height = (this.size * 2) / 2.5;
        const segCount = 10;
        const segWidth = barrelLength / segCount;
        const forwardOffset = this.size * 0.625;
        const tallHeight = height * 1.1;
        ctx.save();
        ctx.translate(forwardOffset, 0);
        ctx.fillStyle = '#9e9e9e';
        ctx.strokeStyle = '#4a4a4a';
        ctx.lineWidth = Math.max(1, 2 / scale);
        for (let i = 0; i < segCount; i++) {
          const recoil = this.streamlinerRecoil[i] || 0;
          ctx.save();
          ctx.translate(-recoil, 0);
          const x = i * segWidth;
          if (i === 0) {
            const w = segWidth * 1.1;
            const h = height * 1.1;
            ctx.fillRect(x, -h / 2, w, h);
            ctx.strokeRect(x, -h / 2, w, h);
          } else if (i >= 2) {
            ctx.fillRect(x, -tallHeight / 2, segWidth, tallHeight);
            ctx.strokeRect(x, -tallHeight / 2, segWidth, tallHeight);
          } else {
            ctx.fillRect(x, -height / 2, segWidth, height);
            ctx.strokeRect(x, -height / 2, segWidth, height);
          }
          ctx.restore();
        }
        ctx.restore();
      };
      if (tankType === 'destroyer') {
        drawDestroyerGun();
        drawBaseCircle();
      } else if (tankType === 'streamliner') {
        drawStreamlinerGun();
        drawBaseCircle();
      } else if (bodyType) {
        if ((bodyType === 'hive' || bodyType === 'cutter') && tankType === 'base') {
          drawGunImage();
          drawBaseCircle();
        } else {
          drawBaseCircle();
          if (tankType === 'anchor') {
            ctx.save();
            ctx.translate(this.size * 0.30, 0);
            drawGunImage();
            ctx.restore();
          } else {
            drawGunImage();
          }
        }
      } else {
        if (tankType === 'anchor') {
          ctx.save();
          ctx.translate(this.size * 0.30, 0);
          drawGunImage();
          ctx.restore();
        } else {
          drawGunImage();
        }
        drawBaseCircle();
      }
      if (bodyType && (bodyType !== 'hive' && bodyType !== 'cutter' || tankType === 'riot' || tankType === 'anchor') && bodyImg?.complete && bodyImg.naturalWidth > 0) ctx.drawImage(bodyImg, -s, -s, s * 2, s * 2);
      // Hive + Riot/Anchor: draw the 6 squares on top of the body (body is already drawn above gun)
      if (bodyType === 'hive' && (tankType === 'riot' || tankType === 'anchor')) {
        const hexMidDist = this.size * 1.21;
        const hiveSqSize = this.size * 0.385;
        ctx.fillStyle = '#9e9e9e';
        ctx.strokeStyle = '#4a4a4a';
        ctx.lineWidth = Math.max(1, 2 / scale);
        for (let i = 0; i < 6; i++) {
          const angle = (-60 + i * 60) * (Math.PI / 180);
          const recoil = this.hiveRecoil[i] || 0;
          ctx.save();
          ctx.rotate(angle);
          ctx.translate(0, -hexMidDist + recoil);
          ctx.fillRect(-hiveSqSize / 2, -hiveSqSize / 2, hiveSqSize, hiveSqSize);
          ctx.strokeRect(-hiveSqSize / 2, -hiveSqSize / 2, hiveSqSize, hiveSqSize);
          ctx.restore();
        }
      }
    } else {
      this._drawTankFallback(ctx, scale, bodyColor, outlineColor, tankType, bodyType);
    }

    // Inferno: single outer ring at full damage range; red aura opacity reduced 50%
    if (bodyType === 'inferno') {
      const b = BODY_UPGRADES.inferno;
      const r = this.equippedBody?.rarity;
      const mult = r === 'ultra' ? b.sizeMultUltra : r === 'super' ? b.sizeMultSuper : b.sizeMult;
      const radius = INFERNO_BASE_RADIUS * mult;
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(200,0,0,0.14)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(170,0,0,0.175)';
      ctx.lineWidth = Math.max(1, 3 / scale);
      ctx.stroke();
    }

    ctx.restore();

    // ==========================
    // ===== DRONES ============
    // ==========================
    for (const d of this.drones) d.draw(ctx, scale);
    for (const od of this.overlordDrones) od.draw(ctx, scale);

    // ==========================
    // ===== PLAYER HEALTH BAR (below tank)
    // ==========================
    const barW = this.size * 2.5;
    const barH = Math.max(5, 6 / scale);
    const barY = this.y + this.size + 8 + this.size * 0.05;
    const barX = this.x - barW / 2;
    drawRoundedHealthBar(ctx, barX, barY, barW, barH, this.hp / this.maxHp, {
      fillColor: '#81c784',
      outlineColor: 'rgba(0,0,0,0.8)',
      lineWidth: Math.max(1, 2 / scale),
    });
  }

  _drawTankFallback(ctx, scale, bodyColor, outlineColor, tankType, bodyType) {
    const barrelLength = 50;
    const barrelWidth = 20;
    const recoilOffset = this.recoil || 0;
    const bodyOutlineColor = tankType === 'riot' ? darkenColor(bodyColor, 60) : outlineColor;
    const gunBaseOutline = darkenColor(bodyColor, 60);

    const drawBody = () => {
    if (bodyType === 'cutter') {
      ctx.fillStyle = '#313131';
      ctx.strokeStyle = '#313131';
      ctx.lineWidth = 2 / scale;
      ctx.beginPath();
      ctx.rect(-this.size * 1.1, -this.size * 1.1, this.size * 2.2, this.size * 2.2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = bodyColor;
      ctx.strokeStyle = gunBaseOutline;
      ctx.lineWidth = 1 / scale;
      ctx.beginPath();
      ctx.arc(0, 0, this.size * 0.85, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (bodyType === 'ziggurat') {
      const mainOutline = '#0a6b85';
      const innerOutline = '#0e7a9e';
      const outerRadius = this.size * 1.1 * 0.48;
      for (let L = 0; L < 3; L++) {
        const r = outerRadius * (1 - L * 0.25);
        if (r < this.size * 0.2) break;
        ctx.fillStyle = bodyColor;
        ctx.strokeStyle = L === 0 ? mainOutline : innerOutline;
        ctx.lineWidth = (L === 0 ? 2 : 1) / scale;
        drawPolygon(ctx, 0, 0, 6, r, L * 0.1);
        ctx.fill();
        ctx.stroke();
      }
    } else if (bodyType === 'inferno') {
      ctx.fillStyle = '#6a6a6a';
      ctx.strokeStyle = '#4a4a4a';
      ctx.lineWidth = Math.max(1, 1 / scale);
      ctx.beginPath();
      ctx.arc(0, 0, this.size * 0.65, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#b0b0b0';
      ctx.strokeStyle = '#6a6a6a';
      ctx.lineWidth = Math.max(1, 0.75 / scale);
      ctx.beginPath();
      ctx.arc(0, 0, this.size * 0.52, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#c00';
      ctx.strokeStyle = '#800';
      ctx.lineWidth = Math.max(1, 0.5 / scale);
      ctx.beginPath();
      ctx.arc(0, 0, this.size * 0.26, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (bodyType === 'hive') {
      ctx.fillStyle = bodyColor;
      ctx.strokeStyle = gunBaseOutline;
      ctx.lineWidth = 1 / scale;
      ctx.beginPath();
      ctx.arc(0, 0, this.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      const hexMidDist = this.size * 1.21;
      const sqSize = this.size * 0.385;
      ctx.fillStyle = '#9e9e9e';
      ctx.strokeStyle = '#4a4a4a';
      ctx.lineWidth = Math.max(1, 2 / scale);
      for (let i = 0; i < 6; i++) {
        const angle = (-60 + i * 60) * (Math.PI / 180);
        const recoil = this.hiveRecoil[i] || 0;
        ctx.save();
        ctx.rotate(angle);
        ctx.translate(0, -hexMidDist + recoil);
        ctx.fillRect(-sqSize / 2, -sqSize / 2, sqSize, sqSize);
        ctx.strokeRect(-sqSize / 2, -sqSize / 2, sqSize, sqSize);
        ctx.restore();
      }
    }
    };

    const drawGun = () => {
    if (tankType !== 'destroyer' && tankType !== 'riot' && tankType !== 'anchor' && tankType !== 'streamliner') {
      ctx.fillStyle = bodyColor;
      ctx.strokeStyle = gunBaseOutline;
      ctx.lineWidth = 3 / scale;
      ctx.beginPath();
      ctx.arc(0, 0, this.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.fillStyle = '#9e9e9e';
    ctx.strokeStyle = outlineColor;
    ctx.lineWidth = 4 / scale;
    if (tankType === 'riot') {
      ctx.fillStyle = '#9e9e9e';
      ctx.strokeStyle = '#4a4a4a';
      ctx.lineWidth = Math.max(1, 2 / scale);
      const S = this.size * 0.96 * 0.792;
      const h = S * Math.sqrt(3) / 2;
      const overlap = S * 0.65;
      const forwardOffset = this.size * 0.28400625;
      ctx.save();
      ctx.translate(forwardOffset, 0);
      const startX = this.size - S * 0.5;
      for (let i = 2; i >= 0; i--) {
        const recoil = this.riotRecoil[i] || 0;
        ctx.save();
        ctx.translate(-recoil, 0);
        const tipX = startX + i * overlap;
        const baseX = tipX + S;
        ctx.beginPath();
        ctx.moveTo(tipX, 0);
        ctx.lineTo(baseX, -h);
        ctx.lineTo(baseX, h);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
      ctx.restore();
      if (bodyType !== 'inferno') {
        ctx.fillStyle = bodyColor;
        ctx.strokeStyle = gunBaseOutline;
        ctx.lineWidth = 3 / scale;
        ctx.beginPath();
        ctx.arc(0, 0, this.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    } else if (tankType === 'destroyer') {
      const height = this.size * 2;
      const len = height * 0.9;
      ctx.save();
      ctx.translate(this.size * 0.10 - recoilOffset, 0);
      ctx.fillStyle = '#9e9e9e';
      ctx.strokeStyle = outlineColor;
      ctx.lineWidth = 2 / scale;
      ctx.fillRect(0, -height / 2, len, height);
      ctx.strokeRect(0, -height / 2, len, height);
      ctx.restore();
      ctx.fillStyle = bodyColor;
      ctx.strokeStyle = gunBaseOutline;
      ctx.lineWidth = 3 / scale;
      ctx.beginPath();
      ctx.arc(0, 0, this.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (tankType === 'streamliner') {
      const barrelLength = (this.size * 2) * 0.9;
      const height = (this.size * 2) / 2.5;
      const segCount = 10;
      const segWidth = barrelLength / segCount;
      const tallHeight = height * 1.1;
      ctx.save();
      ctx.translate(this.size * 0.125, 0);
      ctx.fillStyle = '#9e9e9e';
      ctx.strokeStyle = outlineColor;
      ctx.lineWidth = 2 / scale;
      for (let i = 0; i < segCount; i++) {
        const ro = this.streamlinerRecoil[i] || 0;
        ctx.save();
        ctx.translate(-ro, 0);
        const x = i * segWidth;
        if (i === 0) {
          const w = segWidth * 1.1;
          const h = height * 1.1;
          ctx.fillRect(x, -h / 2, w, h);
          ctx.strokeRect(x, -h / 2, w, h);
        } else if (i >= 2) {
          ctx.fillRect(x, -tallHeight / 2, segWidth, tallHeight);
          ctx.strokeRect(x, -tallHeight / 2, segWidth, tallHeight);
        } else {
          ctx.fillRect(x, -height / 2, segWidth, height);
          ctx.strokeRect(x, -height / 2, segWidth, height);
        }
        ctx.restore();
      }
      ctx.restore();
      ctx.fillStyle = bodyColor;
      ctx.strokeStyle = gunBaseOutline;
      ctx.lineWidth = 3 / scale;
      ctx.beginPath();
      ctx.arc(0, 0, this.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (tankType === 'anchor') {
      ctx.save();
      ctx.translate(this.size * 0.30, 0);
      const ro = recoilOffset;
      const R = this.size;
      const protrude = R * 0.25;
      const side = 2 * R;
      const trapLen = R * 1.8 * 0.4;
      const longHalfW = R * 1.4 * 1.6;
      const squareLeft = R - ro + protrude;
      const squareTop = -R;
      const shortX = 3 * R - ro + protrude;
      const longX = 3 * R + trapLen - ro + protrude;
      ctx.fillStyle = '#9e9e9e';
      ctx.strokeStyle = outlineColor;
      ctx.lineWidth = 4 / scale;
      ctx.fillRect(squareLeft, squareTop, side, side);
      ctx.strokeRect(squareLeft, squareTop, side, side);
      ctx.beginPath();
      ctx.moveTo(shortX, R);
      ctx.lineTo(shortX, -R);
      ctx.lineTo(longX, -longHalfW);
      ctx.lineTo(longX, longHalfW);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = bodyColor;
      ctx.strokeStyle = gunBaseOutline;
      ctx.lineWidth = 3 / scale;
      ctx.beginPath();
      ctx.arc(0, 0, this.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (tankType === 'overlord') {
      const R = this.size * 1.3;
      const w = this.size;
      ctx.fillStyle = '#9e9e9e';
      ctx.strokeStyle = outlineColor;
      ctx.lineWidth = Math.max(1, 2 / scale);
      for (let i = 0; i < 4; i++) {
        ctx.save();
        ctx.rotate(i * Math.PI / 2);
        ctx.translate(0, -R + (this.overlordRecoil[i] || 0));
        ctx.fillRect(-w / 2, -w / 2, w, w);
        ctx.strokeRect(-w / 2, -w / 2, w, w);
        ctx.restore();
      }
    } else {
      ctx.beginPath();
      ctx.rect(-recoilOffset, -barrelWidth / 3, barrelLength * 0.8, barrelWidth * 0.6);
      ctx.fill();
      ctx.stroke();
    }
    };

    if ((bodyType === 'hive' || bodyType === 'cutter') && (tankType === 'riot' || tankType === 'anchor')) {
      drawGun();
      drawBody();
    } else if (bodyType === 'hive' || bodyType === 'cutter') {
      drawBody();
      drawGun();
    } else {
      drawGun();
      if (tankType !== 'riot' || bodyType !== 'inferno') {
        drawBody();
      }
    }
    if (bodyType === 'inferno' && tankType === 'riot') {
      ctx.fillStyle = '#6a6a6a';
      ctx.strokeStyle = '#4a4a4a';
      ctx.lineWidth = Math.max(1, 1 / scale);
      ctx.beginPath();
      ctx.arc(0, 0, this.size * 0.65, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#b0b0b0';
      ctx.strokeStyle = '#6a6a6a';
      ctx.lineWidth = Math.max(1, 0.75 / scale);
      ctx.beginPath();
      ctx.arc(0, 0, this.size * 0.52, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#c00';
      ctx.strokeStyle = '#800';
      ctx.lineWidth = Math.max(1, 0.5 / scale);
      ctx.beginPath();
      ctx.arc(0, 0, this.size * 0.26, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

}
