import { MAP_SIZE, FOOD_SPAWN_HALF, INFERNO_BASE_RADIUS, BODY_UPGRADES } from './config.js';
import { getSpawnPoint, getRandomPointAndWeights, getWalls, getMergedWallFills, getPlayableBounds, WALL_HALF_WIDTH, getWallHalfWidth, resolveWallCollision, resolveWallCollisionRects, isPointInWall, wallsNear } from './mapData.js';

const FOOD_TARGET_COUNT = 1600;   // 60% lower than previous 4000 (reduce spawn density by 60%)
const FOOD_SPAWN_BATCH = 280;    // 60% lower than previous 700
const FOOD_SPAWN_INTERVAL_MS = 4333; // 60% slower spawn rate (was 1733)
import { Food } from './entities/Food.js';
import { Bullet } from './entities/Bullet.js';
import { distance, getRarityColor } from './utils.js';
import { Player } from './Player.js';
import { loadTankAssets, getLoadedTankAssets, getBodyIconUrlByRarity, getGunIconUrlByRarity } from './TankAssets.js';

// Despawn time (ms) for uncollected drops by rarity tier
const DROP_DESPAWN_MS = {
  common: 30 * 1000,
  uncommon: 30 * 1000,
  rare: 60 * 1000,
  epic: 60 * 1000,
  legendary: 60 * 1000,
  mythic: 5 * 60 * 1000,
  ultra: 5 * 60 * 1000,
  super: 5 * 60 * 1000,
};
const INFERNO_PICKUP_DELAY_MS = 200;

export class Game {
  constructor(gamemode = 'ffa') {
    this.gamemode = gamemode;
    this.foods = [];
    this.bullets = [];
    this.squares = [];
    this.drops = [];
    this.player = null;
    this.camera = { x: 0, y: 0 };
    this.scale = 1;
    this.spawnTimer = 0;
    this.running = true;
    /** Floating chat messages above the local player: { text, expiresAt }. Max 5; 2s each. */
    this.floatingMessages = [];
  }

  start() {
    this.bullets = [];
    this.squares = [];
    this.drops = [];
    const { x: spawnX, y: spawnY } = getSpawnPoint();
    this.player = new Player('player1', spawnX, spawnY, this.gamemode);
    this.player.applyStats();
    this.camera.x = this.player.x;
    this.camera.y = this.player.y;
    this.running = true;
    const loadPromise = loadTankAssets().then(() => {
      this.player.tankAssets = getLoadedTankAssets();
    });
    while (this.foods.length < FOOD_TARGET_COUNT) this.spawnFood();
    return loadPromise;
  }

  spawnFood() {
    const walls = getWalls();
    const maxRetries = 20;
    let x, y, rarityWeights;
    for (let k = 0; k < maxRetries; k++) {
      const pt = getRandomPointAndWeights();
      x = pt.x;
      y = pt.y;
      rarityWeights = pt.rarityWeights;
      if (!isPointInWall(x, y, walls)) break;
      if (k === maxRetries - 1) return; // skip this spawn to avoid wall
    }
    const total = Object.values(rarityWeights).reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    let rarity = 'common';
    for (const [rq, w] of Object.entries(rarityWeights)) {
      r -= w;
      if (r <= 0) {
        rarity = rq;
        break;
      }
    }

    // Only 1 natural super per mob type on the map; /spawn is unaffected
    const hasNaturalSuper = this.foods.some((f) => f.rarity === 'super' && f.natural);
    if (rarity === 'super' && hasNaturalSuper) rarity = 'ultra';

    const food = new Food(x, y, rarity, true);
    this.foods.push(food);
    if (rarity === 'super' && this.onSuperSpawn) {
      this.onSuperSpawn('Food');
    }
  }

  /** Spawn a single food at (x, y) with given rarity. Used by /spawn admin command. */
  spawnFoodAt(x, y, rarity) {
    const food = new Food(x, y, rarity); // artificial: natural stays false
    this.foods.push(food);
    if (rarity === 'super' && this.onSuperSpawn) {
      this.onSuperSpawn('Food');
    }
  }

  removeFood(food) {
    this.foods = this.foods.filter(f => f !== food);
  }

  /** Add a loot drop at (x, y) visible and pickable only by ownerId. Uses bodies-rarity / guns-rarity SVG icons. */
  addDrop(x, y, item, ownerId) {
    const url = item.type === 'body'
      ? getBodyIconUrlByRarity(item.subtype, item.rarity)
      : getGunIconUrlByRarity(item.subtype, item.rarity);
    if (!url) return;
    const img = new Image();
    img.src = url;
    const size = 24 * 0.7; // 30% smaller (world units for draw and pickup radius)
    const angleDeg = Math.random() * 360; // random rotation like riot traps
    this.drops.push({ x, y, item, ownerId, img, size, angleDeg, spawnedAt: Date.now() });
  }

  /** Collect all drops owned by playerId into that player's inventory. Returns count claimed. */
  claimAllDrops(playerId) {
    if (!this.player || this.player.id !== playerId) return 0;
    const p = this.player;
    const toClaim = this.drops.filter((d) => d.ownerId === playerId);
    for (const drop of toClaim) {
      p.addLoot(drop.item.type, drop.item.subtype, drop.item.rarity);
    }
    this.drops = this.drops.filter((d) => d.ownerId !== playerId);
    return toClaim.length;
  }

  update(dt) {
    if (!this.running || !this.player) return;

    this.player.update(dt, this);

    // Wall collision: use rect-based when custom map (exact match to drawn walls), else segment-based
    const wallFills = getMergedWallFills();
    if (wallFills.length > 0) {
      const margin = this.player.size + 100;
      const minX = this.player.x - margin, maxX = this.player.x + margin;
      const minY = this.player.y - margin, maxY = this.player.y + margin;
      const nearbyRects = wallFills.filter(r => r.x2 >= minX && r.x1 <= maxX && r.y2 >= minY && r.y1 <= maxY);
      for (let pass = 0; pass < 3; pass++) {
        const resolved = resolveWallCollisionRects(this.player.x, this.player.y, this.player.size, nearbyRects);
        if (resolved) {
          this.player.x = resolved.x;
          this.player.y = resolved.y;
        } else break;
      }
      // Overlord drones: same rect-based wall collision
      for (const od of this.player.overlordDrones || []) {
        const dm = od.size + 100;
        const drMinX = od.x - dm, drMaxX = od.x + dm, drMinY = od.y - dm, drMaxY = od.y + dm;
        const droneRects = wallFills.filter(r => r.x2 >= drMinX && r.x1 <= drMaxX && r.y2 >= drMinY && r.y1 <= drMaxY);
        for (let pass = 0; pass < 3; pass++) {
          const resolved = resolveWallCollisionRects(od.x, od.y, od.size, droneRects);
          if (resolved) {
            od.x = resolved.x;
            od.y = resolved.y;
          } else break;
        }
      }
    } else {
      const allWalls = getWalls();
      const wallHalf = getWallHalfWidth();
      const margin = this.player.size + wallHalf + 200;
      const nearbyWalls = wallsNear(allWalls, this.player.x, this.player.y, margin);
      for (let pass = 0; pass < 3; pass++) {
        const resolved = resolveWallCollision(this.player.x, this.player.y, this.player.size, nearbyWalls);
        if (resolved) {
          this.player.x = resolved.x;
          this.player.y = resolved.y;
        } else break;
      }
      // Overlord drones: same segment-based wall collision
      for (const od of this.player.overlordDrones || []) {
        const droneMargin = od.size + wallHalf + 200;
        const droneNearby = wallsNear(allWalls, od.x, od.y, droneMargin);
        for (let pass = 0; pass < 3; pass++) {
          const resolved = resolveWallCollision(od.x, od.y, od.size, droneNearby);
          if (resolved) {
            od.x = resolved.x;
            od.y = resolved.y;
          } else break;
        }
      }
    }

    for (const food of this.foods) {
      food.update(dt);
    }

    // Wall collision for food/shapes: keep them inside playable area
    const wallFillsForFood = getMergedWallFills();
    if (wallFillsForFood.length > 0) {
      for (const food of this.foods) {
        const margin = (food.size ?? 20) + 50;
        const minX = food.x - margin, maxX = food.x + margin;
        const minY = food.y - margin, maxY = food.y + margin;
        const nearbyRects = wallFillsForFood.filter(r => r.x2 >= minX && r.x1 <= maxX && r.y2 >= minY && r.y1 <= maxY);
        for (let pass = 0; pass < 3; pass++) {
          const resolved = resolveWallCollisionRects(food.x, food.y, food.size ?? 20, nearbyRects);
          if (resolved) {
            food.x = resolved.x;
            food.y = resolved.y;
            food.vx *= 0.7;
            food.vy *= 0.7;
          } else break;
        }
      }
    } else {
      const allWallsForFood = getWalls();
      const wallHalfFood = getWallHalfWidth();
      for (const food of this.foods) {
        const radius = food.size ?? 20;
        const margin = radius + wallHalfFood + 100;
        const nearbyWalls = wallsNear(allWallsForFood, food.x, food.y, margin);
        for (let pass = 0; pass < 3; pass++) {
          const resolved = resolveWallCollision(food.x, food.y, radius, nearbyWalls);
          if (resolved) {
            food.x = resolved.x;
            food.y = resolved.y;
            food.vx *= 0.7;
            food.vy *= 0.7;
          } else break;
        }
      }
    }

    const bulletsToRemove = new Set();
    for (const bullet of this.bullets) {
      bullet.update(dt);
      if (bullet.lifetime <= 0) {
        bulletsToRemove.add(bullet);
        continue;
      }
      if (bullet.penetrating) {
        const hpPerHit = 1;
        for (const sq of this.squares) {
          if (bullet.hp != null && bullet.hp <= 0) break;
          if (bullet.hitTargets.has(sq)) continue;
          if (distance(bullet.x, bullet.y, sq.x, sq.y) < bullet.size + sq.size) {
            bullet.hitTargets.add(sq);
            sq.hp -= bullet.damage;
            const rx = bullet.x - sq.x;
            const ry = bullet.y - sq.y;
            const vx = Math.cos(bullet.angle) * bullet.speed;
            const vy = Math.sin(bullet.angle) * bullet.speed;
            sq.angularVelocity += (rx * vy - ry * vx) * 0.002;
            if (bullet.hp != null) bullet.hp -= hpPerHit;
            if (bullet.hp != null && bullet.hp <= 0) bulletsToRemove.add(bullet);
          }
        }
        for (const food of this.foods) {
          if (bullet.hp != null && bullet.hp <= 0) break;
          if (bullet.hitTargets.has(food)) continue;
          if (distance(bullet.x, bullet.y, food.x, food.y) < bullet.size + food.size) {
            bullet.hitTargets.add(food);
            food.hp -= bullet.damage;
            if (food.hp <= 0) this.player.onKill(food, this);
            const totalWeight = bullet.weight + food.weight;
            const pushFactor = (bullet.weight / totalWeight) * 0.25;
            food.vx += Math.cos(bullet.angle) * bullet.speed * pushFactor;
            food.vy += Math.sin(bullet.angle) * bullet.speed * pushFactor;
            if (bullet.hp != null) bullet.hp -= hpPerHit;
            if (bullet.hp != null && bullet.hp <= 0) bulletsToRemove.add(bullet);
          }
        }
      } else {
        for (const sq of this.squares) {
          if (distance(bullet.x, bullet.y, sq.x, sq.y) < bullet.size + sq.size) {
            sq.hp -= bullet.damage;
            const rx = bullet.x - sq.x;
            const ry = bullet.y - sq.y;
            const vx = Math.cos(bullet.angle) * bullet.speed;
            const vy = Math.sin(bullet.angle) * bullet.speed;
            sq.angularVelocity += (rx * vy - ry * vx) * 0.002;
            bulletsToRemove.add(bullet);
            break;
          }
        }
        if (!bulletsToRemove.has(bullet)) {
          for (const food of this.foods) {
            if (distance(bullet.x, bullet.y, food.x, food.y) < bullet.size + food.size) {
              food.hp -= bullet.damage;
              if (food.hp <= 0) this.player.onKill(food, this);
              const totalWeight = bullet.weight + food.weight;
              const pushFactor = (bullet.weight / totalWeight) * 0.25;
              food.vx += Math.cos(bullet.angle) * bullet.speed * pushFactor;
              food.vy += Math.sin(bullet.angle) * bullet.speed * pushFactor;
              bulletsToRemove.add(bullet);
              break;
            }
          }
        }
      }
    }
    this.bullets = this.bullets.filter(b => !bulletsToRemove.has(b));

    for (const sq of this.squares) {
      sq.update(dt, this);
      for (const food of this.foods) {
        const d = distance(sq.x, sq.y, food.x, food.y);
        if (d < sq.size + food.size) {
          food.hp -= sq.damage * dt / 1000;
          if (food.hp <= 0) this.player.onKill(food, this);
        }
      }
    }
    // Wall collision for shapes (squares/traps)
    const wallFillsSq = getMergedWallFills();
    if (wallFillsSq.length > 0) {
      for (const sq of this.squares) {
        const margin = sq.size + 50;
        const minX = sq.x - margin, maxX = sq.x + margin;
        const minY = sq.y - margin, maxY = sq.y + margin;
        const nearbyRects = wallFillsSq.filter(r => r.x2 >= minX && r.x1 <= maxX && r.y2 >= minY && r.y1 <= maxY);
        for (let pass = 0; pass < 3; pass++) {
          const resolved = resolveWallCollisionRects(sq.x, sq.y, sq.size, nearbyRects);
          if (resolved) {
            sq.x = resolved.x;
            sq.y = resolved.y;
            sq.vx *= 0.7;
            sq.vy *= 0.7;
          } else break;
        }
      }
    } else {
      const allWallsSq = getWalls();
      const wallHalfSq = getWallHalfWidth();
      for (const sq of this.squares) {
        const margin = sq.size + wallHalfSq + 100;
        const nearbyWalls = wallsNear(allWallsSq, sq.x, sq.y, margin);
        for (let pass = 0; pass < 3; pass++) {
          const resolved = resolveWallCollision(sq.x, sq.y, sq.size, nearbyWalls);
          if (resolved) {
            sq.x = resolved.x;
            sq.y = resolved.y;
            sq.vx *= 0.7;
            sq.vy *= 0.7;
          } else break;
        }
      }
    }
    this.squares = this.squares.filter(s => !s.isExpired());

    this.spawnTimer += dt;
    if (this.spawnTimer >= FOOD_SPAWN_INTERVAL_MS && this.foods.length < FOOD_TARGET_COUNT) {
      this.spawnTimer = 0;
      for (let i = 0; i < FOOD_SPAWN_BATCH && this.foods.length < FOOD_TARGET_COUNT; i++) this.spawnFood();
    }

    // Pickup drops: only owner can see/pick up; body contact by default; Inferno body uses inferno fire radius as pickup range
    const p = this.player;
    if (p && !p.dead) {
      const infernoBody = p.equippedBody?.subtype === 'inferno';
      const infernoRadius = infernoBody && BODY_UPGRADES.inferno
        ? (() => {
            const b = BODY_UPGRADES.inferno;
            const r = p.equippedBody.rarity;
            const mult = r === 'ultra' ? b.sizeMultUltra : r === 'super' ? b.sizeMultSuper : b.sizeMult;
            return INFERNO_BASE_RADIUS * mult;
          })()
        : 0;
      const now = Date.now();
      this.drops = this.drops.filter((drop) => {
        if (drop.ownerId !== p.id) return true;
        const d = distance(p.x, p.y, drop.x, drop.y);
        const pickupRange = infernoRadius > 0 ? infernoRadius : p.size + drop.size;
        if (d > pickupRange) {
          if (infernoRadius > 0) drop.infernoPickupAt = undefined;
          return true;
        }
        if (infernoRadius > 0) {
          drop.infernoPickupAt = drop.infernoPickupAt ?? now;
          if (now - drop.infernoPickupAt >= INFERNO_PICKUP_DELAY_MS) {
            p.addLoot(drop.item.type, drop.item.subtype, drop.item.rarity);
            return false;
          }
          return true;
        }
        p.addLoot(drop.item.type, drop.item.subtype, drop.item.rarity);
        return false;
      });
    }

    // Despawn old uncollected drops by rarity tier
    const now = Date.now();
    this.drops = this.drops.filter((drop) => {
      const maxAge = DROP_DESPAWN_MS[drop.item.rarity] ?? 60 * 1000;
      return now - (drop.spawnedAt ?? now) <= maxAge;
    });

    this.camera.x = this.player.x;
    this.camera.y = this.player.y;
  }

  draw(ctx) {
    const cam = this.camera;
    const scale = this.scale;
    const cw = ctx.canvas.width;
    const ch = ctx.canvas.height;

    /* ===========================
      LIGHT GREY GRID BACKGROUND
    =========================== */

    // Base background
    ctx.fillStyle = '#e6e6e6';
    ctx.fillRect(0, 0, cw, ch);

    ctx.save();
    ctx.translate(cw / 2, ch / 2);
    ctx.scale(scale, scale);
    ctx.translate(-cam.x, -cam.y);

    const gridSize = 40;
    ctx.strokeStyle = '#d0d0d0';
    ctx.lineWidth = 1 / scale;

    // Compute visible world bounds correctly
    const halfWidth = cw / (2 * scale);
    const halfHeight = ch / (2 * scale);

    const left = cam.x - halfWidth;
    const right = cam.x + halfWidth;
    const top = cam.y - halfHeight;
    const bottom = cam.y + halfHeight;

    const playableBounds = getPlayableBounds();

    /* ===========================
       GRID: draw first so walls can be drawn on top (no grid lines on black walls).
    =========================== */
    if (playableBounds) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(playableBounds.minX, playableBounds.minY, playableBounds.maxX - playableBounds.minX, playableBounds.maxY - playableBounds.minY);
      ctx.clip();
    }
    const startX = Math.floor(left / gridSize) * gridSize;
    const startY = Math.floor(top / gridSize) * gridSize;
    for (let x = startX; x <= right; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.stroke();
    }
    for (let y = startY; y <= bottom; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
    }
    if (playableBounds) ctx.restore();

    /* ===========================
       OUT-OF-BOUNDS + WALLS: draw on top of grid so they are fully black (no grid lines visible).
    ============================ */
    if (playableBounds) {
      const { minX, maxX, minY, maxY } = playableBounds;
      ctx.fillStyle = '#1a1a1a';
      if (top < minY) {
        const x = Math.max(left, minX);
        const w = Math.min(right, maxX) - x;
        const h = Math.min(bottom, minY) - top;
        if (w > 0 && h > 0) ctx.fillRect(x, top, w, h);
      }
      if (bottom > maxY) {
        const x = Math.max(left, minX);
        const w = Math.min(right, maxX) - x;
        const y = Math.max(top, maxY);
        const h = bottom - y;
        if (w > 0 && h > 0) ctx.fillRect(x, y, w, h);
      }
      if (left < minX) {
        const x = left;
        const w = Math.min(right, minX) - x;
        const y = Math.max(top, minY);
        const h = Math.min(bottom, maxY) - y;
        if (w > 0 && h > 0) ctx.fillRect(x, y, w, h);
      }
      if (right > maxX) {
        const x = Math.max(left, maxX);
        const w = right - x;
        const y = Math.max(top, minY);
        const h = Math.min(bottom, maxY) - y;
        if (w > 0 && h > 0) ctx.fillRect(x, y, w, h);
      }
    }

    const wallFills = getMergedWallFills();
    if (wallFills.length > 0) {
      ctx.fillStyle = '#1a1a1a';
      const overlap = 0.5; // overlap rows so no horizontal grid line shows between them
      for (const r of wallFills) {
        const y = r.y1 - overlap;
        const h = (r.y2 - r.y1) + 2 * overlap;
        ctx.fillRect(r.x1, y, r.x2 - r.x1, h);
      }
    } else {
      const wallWidth = 2 * WALL_HALF_WIDTH;
      ctx.lineCap = 'butt';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#1a1a1a';
      ctx.fillStyle = '#1a1a1a';
      ctx.lineWidth = wallWidth;
      for (const w of getWalls()) {
        ctx.beginPath();
        ctx.moveTo(w.x1, w.y1);
        ctx.lineTo(w.x2, w.y2);
        ctx.stroke();
      }
      ctx.strokeStyle = '#0d0d0d';
      ctx.lineWidth = Math.max(2, 8 / scale);
      ctx.lineCap = 'butt';
      for (const w of getWalls()) {
        ctx.beginPath();
        ctx.moveTo(w.x1, w.y1);
        ctx.lineTo(w.x2, w.y2);
        ctx.stroke();
      }
    }

    /* ===========================
       DRAW GAME OBJECTS
    ============================ */

    const playerLevel = this.player ? this.player.level : 1;

    for (const food of this.foods) {
      food.draw(ctx, scale, this.camera, playerLevel);
    }

    // Draw drops (only visible to owner; use bodies-rarity / guns-rarity SVG icons)
    for (const drop of this.drops) {
      if (drop.ownerId !== this.player?.id) continue;
      if (!drop.img?.complete || !drop.img.naturalWidth) continue;
      const w = drop.size * 2;
      const h = drop.size * 2;
      ctx.save();
      ctx.translate(drop.x, drop.y);
      ctx.rotate((drop.angleDeg ?? 0) * (Math.PI / 180));
      ctx.drawImage(drop.img, -w / 2, -h / 2, w, h);
      ctx.restore();
    }

    for (const sq of this.squares) {
      sq.draw(ctx, scale);
    }

    for (const bullet of this.bullets) {
      bullet.draw(ctx, scale);
    }

    if (this.player && !this.player.dead) {
      this.player.draw(ctx, scale);
    }

    // Floating chat messages above the player (newest just above, oldest higher; max 5, 2s each)
    const now = Date.now();
    this.floatingMessages = this.floatingMessages.filter((m) => m.expiresAt > now);
    if (this.player && !this.player.dead && this.floatingMessages.length > 0) {
      const p = this.player;
      const fontSize = Math.max(10, 20 / scale);
      const lineHeight = fontSize * 1.25;
      const baseY = p.y - p.size - 12;
      ctx.font = `bold ${fontSize}px Rajdhani, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const textHeight = fontSize;
      const cornerR = Math.max(3, 8 / scale);
      const bgColor = '#2a2a2a';
      for (let i = 0; i < this.floatingMessages.length; i++) {
        const y = baseY - (this.floatingMessages.length - 1 - i) * lineHeight;
        const text = this.floatingMessages[i].text;
        const textW = ctx.measureText(text).width;
        const boxW = textW * 1.10;
        const boxH = textHeight * 1.10;
        const boxX = p.x - boxW / 2;
        const boxY = y - boxH / 2;
        ctx.fillStyle = bgColor;
        ctx.beginPath();
        ctx.moveTo(boxX + cornerR, boxY);
        ctx.lineTo(boxX + boxW - cornerR, boxY);
        ctx.arcTo(boxX + boxW, boxY, boxX + boxW, boxY + cornerR, cornerR);
        ctx.lineTo(boxX + boxW, boxY + boxH - cornerR);
        ctx.arcTo(boxX + boxW, boxY + boxH, boxX + boxW - cornerR, boxY + boxH, cornerR);
        ctx.lineTo(boxX + cornerR, boxY + boxH);
        ctx.arcTo(boxX, boxY + boxH, boxX, boxY + boxH - cornerR, cornerR);
        ctx.lineTo(boxX, boxY + cornerR);
        ctx.arcTo(boxX, boxY, boxX + cornerR, boxY, cornerR);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.fillText(text, p.x, y);
      }
    }

    ctx.restore();
  }
}