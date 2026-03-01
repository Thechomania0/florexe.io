import { MAP_SIZE, FOOD_SPAWN_HALF, INFERNO_BASE_RADIUS, BODY_UPGRADES } from './config.js';
import { getSpawnPoint, getSpawnPointFromZones, getRandomPointAndWeights, getWalls, getMergedWallFills, buildMergedWallFillsFromZones, getPlayableBounds, getPlayableBoundsFromZones, WALL_HALF_WIDTH, getWallHalfWidth, resolveWallCollision, resolveWallCollisionRects, isPointInWall, isPointInWallRects, wallsNear } from './mapData.js';

const FOOD_TARGET_COUNT = 800;    // 50% of previous 1600 (reduce spawn rate by 50%)
const FOOD_SPAWN_BATCH = 140;    // 50% of previous 280
const FOOD_SPAWN_INTERVAL_MS = 8666; // 2× previous 4333 (spawn half as often)
const BEETLE_TARGET_COUNT = 800;   // same as food
const BEETLE_SPAWN_BATCH = 140;    // same as food
import { Food } from './entities/Food.js';
import { Beetle } from './entities/Beetle.js';
import { Bullet } from './entities/Bullet.js';
import { distance, getRarityColor, darkenColor, drawRoundedHealthBar } from './utils.js';
import { Player } from './Player.js';
import { loadTankAssets, getLoadedTankAssets, getBodyIconUrlByRarity, getGunIconUrlByRarity, getPetalIconUrlByRarity } from './TankAssets.js';

// Weight comparison: push factor = (higher/lower - 1) capped at 1 (100%). Heavier can push lighter by that %.
function bulletDisplaceStrength(pusherWeight, pushedWeight) {
  const pw = Math.max(1, Math.min(100, pusherWeight || 0));
  const pd = Math.max(1, Math.min(100, pushedWeight || 0));
  if (pw <= pd) return 0;
  const decimal = pw / pd - 1;
  return Math.min(1, decimal) * 0.25;
}

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
    this.beetles = [];
    this.bullets = [];
    this.squares = [];
    this.drops = [];
    this.player = null;
    this.camera = { x: 0, y: 0 };
    this.scale = 1;
    this.spawnTimer = 0;
    this.running = true;
    this.beetleImage = null;
    this.beetleBodyImage = null;
    this.beetlePincerLeftImage = null;
    this.beetlePincerRightImage = null;
    /** Floating chat messages above the local player: { text, expiresAt }. Max 5; 2s each. */
    this.floatingMessages = [];
    /** Other players in the same room (multiplayer). Each: { id, x, y, angle, hp, maxHp, level, displayName, equippedTank, equippedBody, size }. */
    this.otherPlayers = [];
    /** When set, mobs are synced from server (join/hit/mobs). No local spawn. */
    this.multiplayerSocket = null;
    /** Server-authoritative bullets and squares (when multiplayer). Replaced from server each tick. */
    this.serverBullets = [];
    this.serverSquares = [];
    /** Optimistic squares (multiplayer): shown immediately when firing; expired when server snapshot arrives. */
    this.pendingSquares = [];
    /** Processed kill mobIds (multiplayer) to avoid applying the same kill reward twice (e.g. duplicate 'kill' events). */
    this.processedKillIds = null;
    /** Last mobs snapshot sequence (multiplayer); ignore older snapshots to prevent HP respawn glitch. */
    this.lastMobsSeq = null;
    /** Map data from server when multiplayer (walls, zones). Client uses this instead of mapData.js. */
    this.serverWalls = null;
    this.serverZones = null;
  }

  /** When multiplayer: emit to server. Otherwise add to game.bullets. */
  addBullet(bullet) {
    if (this.multiplayerSocket && bullet) {
      this.multiplayerSocket.emit('shoot', {
        x: bullet.x,
        y: bullet.y,
        angle: bullet.angle,
        damage: bullet.damage,
        size: bullet.size / 0.7,
        speed: bullet.speed / 0.7,
        lifetime: bullet.lifetime,
        penetrating: bullet.penetrating,
        weight: bullet.weight,
        maxRange: bullet.maxRange != null ? bullet.maxRange : undefined,
        hp: bullet.hp != null ? bullet.hp : undefined,
      });
      return;
    }
    if (bullet) this.bullets.push(bullet);
  }

  /** When multiplayer: emit to server and add to pendingSquares so trap shows immediately. Otherwise add to game.squares. */
  addSquare(sq) {
    if (this.multiplayerSocket && sq) {
      const p = this.player;
      const x = typeof sq.x === 'number' && !Number.isNaN(sq.x) ? sq.x : (p ? p.x : 0);
      const y = typeof sq.y === 'number' && !Number.isNaN(sq.y) ? sq.y : (p ? p.y : 0);
      this.multiplayerSocket.emit('square', {
        x,
        y,
        vx: sq.vx,
        vy: sq.vy,
        damage: sq.damage,
        hp: sq.hp,
        size: sq.size,
        duration: sq.duration,
        rarity: sq.rarity,
        weight: sq.weight,
        isRiotTrap: sq.isRiotTrap,
        bodyColor: sq.bodyColor,
        rotation: typeof sq.rotation === 'number' ? sq.rotation : 0,
        angularVelocity: typeof sq.angularVelocity === 'number' ? sq.angularVelocity : 0,
      });
      this.pendingSquares.push({ sq, addedAt: Date.now() });
      return;
    }
    if (sq) this.squares.push(sq);
  }

  setBulletsFromServer(list) {
    this.serverBullets = Array.isArray(list) ? list : [];
  }

  setSquaresFromServer(list) {
    this.serverSquares = Array.isArray(list) ? list : [];
    const now = Date.now();
    const PENDING_MAX_MS = 600;
    this.pendingSquares = this.pendingSquares.filter((e) => now - e.addedAt < PENDING_MAX_MS);
  }

  setMultiplayerSocket(socket) {
    this.multiplayerSocket = socket;
    if (!socket) { this.serverWalls = null; this.serverZones = null; }
  }

  /** Set map data from server (walls, zones) so client uses server map in multiplayer. Corrects player spawn if in wall. */
  setMapFromServer(data) {
    if (data && Array.isArray(data.walls)) this.serverWalls = data.walls;
    if (data && data.zones && Array.isArray(data.zones.grid)) {
      this.serverZones = data.zones;
      const wallRects = buildMergedWallFillsFromZones(this.serverZones);
      if (this.player && wallRects.length > 0 && isPointInWallRects(this.player.x, this.player.y, wallRects)) {
        const spawn = getSpawnPointFromZones(this.serverZones);
        if (spawn) {
          this.player.x = spawn.x;
          this.player.y = spawn.y;
          this.camera.x = spawn.x;
          this.camera.y = spawn.y;
        }
      }
    }
  }

  /** Walls for collision/spawn: server map when multiplayer, else client mapData. */
  getWallsForGame() {
    return (this.multiplayerSocket && this.serverWalls) ? this.serverWalls : getWalls();
  }

  /** Wall fills for rect-based collision. In multiplayer, use server zones grid when available so walls render solid. */
  getWallFillsForGame() {
    if (this.multiplayerSocket && this.serverZones && this.serverZones.grid)
      return buildMergedWallFillsFromZones(this.serverZones);
    return getMergedWallFills();
  }

  /** Playable bounds for minimap/clip. In multiplayer, use server zones so singleplayer layer is not mixed in. */
  getPlayableBoundsForGame() {
    if (this.multiplayerSocket && this.serverZones && this.serverZones.grid)
      return getPlayableBoundsFromZones(this.serverZones);
    return getPlayableBounds();
  }

  /** Replace foods and beetles from server snapshot. Each item: { id, x, y, rarity, hp, maxHp, size, weight, natural }. Merges by id (string) and stores server position for interpolation. Skips mobs we've already processed a kill for (so dead mobs never reappear). Ignores snapshot if seq <= lastMobsSeq (stale). */
  setMobsFromServer(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return;
    if (typeof snapshot.seq === 'number') {
      if (this.lastMobsSeq != null && snapshot.seq <= this.lastMobsSeq) return;
      this.lastMobsSeq = snapshot.seq;
    }
    let foods = Array.isArray(snapshot.foods) ? snapshot.foods : [];
    let beetles = Array.isArray(snapshot.beetles) ? snapshot.beetles : [];
    if (this.processedKillIds && this.processedKillIds.size > 0) {
      foods = foods.filter((f) => f.id == null || !this.processedKillIds.has(String(f.id)));
      beetles = beetles.filter((b) => b.id == null || !this.processedKillIds.has(String(b.id)));
    }

    const existingFoodById = new Map();
    for (const f of this.foods) if (f.id != null) existingFoodById.set(String(f.id), f);
    const nextFoods = [];
    for (const f of foods) {
      const fid = f.id != null ? String(f.id) : null;
      let food = fid != null ? existingFoodById.get(fid) : undefined;
      if (food) {
        food.serverX = f.x;
        food.serverY = f.y;
        food.vx = 0;
        food.vy = 0;
        if (typeof f.hp === 'number') food.hp = Math.min(f.hp, food.maxHp);
        if (typeof f.maxHp === 'number') food.maxHp = f.maxHp;
        if (typeof f.size === 'number') food.size = f.size;
        if (typeof f.weight === 'number') food.weight = f.weight;
        const dx = (typeof f.x === 'number' ? f.x : food.x) - food.x;
        const dy = (typeof f.y === 'number' ? f.y : food.y) - food.y;
        if (dx * dx + dy * dy > 80 * 80) {
          food.x = typeof f.x === 'number' ? f.x : food.x;
          food.y = typeof f.y === 'number' ? f.y : food.y;
        }
      } else {
        food = new Food(
          typeof f.x === 'number' ? f.x : 0,
          typeof f.y === 'number' ? f.y : 0,
          f.rarity,
          f.natural !== false,
          f.id
        );
        food.x = typeof f.x === 'number' ? f.x : 0;
        food.y = typeof f.y === 'number' ? f.y : 0;
        food.serverX = food.x;
        food.serverY = food.y;
        food.hp = typeof f.hp === 'number' ? f.hp : food.maxHp;
        food.maxHp = typeof f.maxHp === 'number' ? f.maxHp : food.maxHp;
        if (typeof f.size === 'number') food.size = f.size;
        if (typeof f.weight === 'number') food.weight = f.weight;
      }
      nextFoods.push(food);
    }
    this.foods = nextFoods;

    const existingBeetleById = new Map();
    for (const b of this.beetles) if (b.id != null) existingBeetleById.set(String(b.id), b);
    const nextBeetles = [];
    for (const b of beetles) {
      const bid = b.id != null ? String(b.id) : null;
      let beetle = bid != null ? existingBeetleById.get(bid) : undefined;
      if (beetle) {
        beetle.serverX = b.x;
        beetle.serverY = b.y;
        if (typeof b.hp === 'number') beetle.hp = Math.min(b.hp, beetle.maxHp);
        if (typeof b.maxHp === 'number') beetle.maxHp = b.maxHp;
        if (typeof b.size === 'number') beetle.size = b.size;
        const hitboxScale = (b.rarity === 'mythic' || b.rarity === 'legendary') ? 0.4 : 1;
        beetle.semiMajor = (beetle.size ?? 20) * (25.5 / 64) * hitboxScale;
        beetle.semiMinor = (beetle.size ?? 20) * (19.5 / 64) * hitboxScale;
        if (typeof b.weight === 'number') beetle.weight = b.weight;
        const dx = (typeof b.x === 'number' ? b.x : beetle.x) - beetle.x;
        const dy = (typeof b.y === 'number' ? b.y : beetle.y) - beetle.y;
        if (dx * dx + dy * dy > 80 * 80) {
          beetle.x = typeof b.x === 'number' ? b.x : beetle.x;
          beetle.y = typeof b.y === 'number' ? b.y : beetle.y;
        }
      } else {
        beetle = new Beetle(
          typeof b.x === 'number' ? b.x : 0,
          typeof b.y === 'number' ? b.y : 0,
          b.rarity,
          b.natural !== false,
          b.id
        );
        beetle.x = typeof b.x === 'number' ? b.x : 0;
        beetle.y = typeof b.y === 'number' ? b.y : 0;
        beetle.serverX = beetle.x;
        beetle.serverY = beetle.y;
        beetle.hp = typeof b.hp === 'number' ? b.hp : beetle.maxHp;
        beetle.maxHp = typeof b.maxHp === 'number' ? b.maxHp : beetle.maxHp;
        if (typeof b.size === 'number') beetle.size = b.size;
        if (typeof b.weight === 'number') beetle.weight = b.weight;
        const hitboxScale = (b.rarity === 'mythic' || b.rarity === 'legendary') ? 0.4 : 1;
        beetle.semiMajor = beetle.size * (25.5 / 64) * hitboxScale;
        beetle.semiMinor = beetle.size * (19.5 / 64) * hitboxScale;
      }
      nextBeetles.push(beetle);
    }
    this.beetles = nextBeetles;
  }

  /** Apply kill reward from server (stars, drop, xp, score) and remove mob by id. Deduplicates by mobId so one kill = one reward. */
  applyKillReward(payload) {
    if (!payload || !this.player) return;
    const { mobId, mobType, rarity, maxHp, stars, drop, x, y } = payload;
    if (this.multiplayerSocket && mobId != null) {
      if (!this.processedKillIds) this.processedKillIds = new Set();
      const sid = String(mobId);
      if (this.processedKillIds.has(sid)) return;
      this.processedKillIds.add(sid);
      if (this.processedKillIds.size > 500) {
        const arr = Array.from(this.processedKillIds);
        this.processedKillIds = new Set(arr.slice(-400));
      }
    }
    this.player.mobKills = this.player.mobKills || {};
    this.player.mobKills[rarity] = (this.player.mobKills[rarity] || 0) + 1;
    this.player.addXp((maxHp || 0) * 0.5);
    this.player.score += maxHp || 0;
    if (typeof stars === 'number' && stars > 0) this.player.stars += stars;
    if (drop && typeof drop === 'object' && drop.rarity) {
      if (typeof x === 'number' || typeof y === 'number') {
        const dropX = typeof x === 'number' ? x : 0;
        const dropY = typeof y === 'number' ? y : 0;
        if (drop.type === 'petal' && drop.subtype === 'egg') {
          this.addDrop(dropX, dropY, { type: 'petal', subtype: 'egg', rarity: drop.rarity }, this.player.id);
        } else if (drop.type === 'body' || drop.type === 'tank') {
          this.addDrop(dropX, dropY, { type: drop.type, subtype: drop.subtype || '', rarity: drop.rarity }, this.player.id);
        }
      }
    }
    const sid = mobId != null ? String(mobId) : null;
    if (mobType === 'beetle' && sid) {
      this.beetles = this.beetles.filter((b) => String(b.id) !== sid);
    } else if (sid) {
      this.foods = this.foods.filter((f) => String(f.id) !== sid);
    }
  }

  start(savedState = null) {
    this.bullets = [];
    this.squares = [];
    this.pendingSquares = [];
    this.processedKillIds = null;
    this.lastMobsSeq = null;
    this.drops = [];
    const { x: spawnX, y: spawnY } = getSpawnPoint();
    this.player = new Player('player1', spawnX, spawnY, this.gamemode);
    if (savedState && typeof savedState === 'object') {
      if (Array.isArray(savedState.inventory)) this.player.inventory = savedState.inventory.slice();
      if (Array.isArray(savedState.hand)) this.player.hand = savedState.hand.slice();
      if (savedState.equippedTank && typeof savedState.equippedTank === 'object') {
        this.player.equippedTank = { ...savedState.equippedTank };
      }
      if (savedState.equippedBody && typeof savedState.equippedBody === 'object') {
        this.player.equippedBody = { ...savedState.equippedBody };
      }
      if (typeof savedState.level === 'number' && savedState.level >= 1) {
        this.player.level = Math.min(100, savedState.level);
        this.player.xp = typeof savedState.xp === 'number' ? savedState.xp : 0;
      }
      if (typeof savedState.stars === 'number') this.player.stars = Math.max(0, savedState.stars);
      if (typeof savedState.score === 'number') this.player.score = Math.max(0, savedState.score);
    }
    this.player.applyStats();
    this.player.hp = this.player.maxHp;
    this.camera.x = this.player.x;
    this.camera.y = this.player.y;
    this.running = true;
    const loadPromise = loadTankAssets().then(() => {
      this.player.tankAssets = getLoadedTankAssets();
    });
    this.beetleImage = new Image();
    this.beetleImage.src = 'assets/icons/mobs/beetle/beetle.svg';
    this.beetleBodyImage = new Image();
    this.beetleBodyImage.src = 'assets/icons/mobs/beetle/body.svg';
    this.beetlePincerLeftImage = new Image();
    this.beetlePincerLeftImage.src = 'assets/icons/mobs/beetle/pincer_left.svg';
    this.beetlePincerRightImage = new Image();
    this.beetlePincerRightImage.src = 'assets/icons/mobs/beetle/pincer_right.svg';
    while (this.foods.length < FOOD_TARGET_COUNT) this.spawnFood();
    while (this.beetles.length < BEETLE_TARGET_COUNT) this.spawnBeetle();
    return loadPromise;
  }

  /** Start game for multiplayer only: player at spawnPoint, no local mob spawn (server sends mobs). */
  startMultiplayer(savedState, spawnPoint) {
    const { x: spawnX, y: spawnY } = spawnPoint || getSpawnPoint();
    this.bullets = [];
    this.squares = [];
    this.pendingSquares = [];
    this.processedKillIds = null;
    this.lastMobsSeq = null;
    this.drops = [];
    this.foods = [];
    this.beetles = [];
    this.player = new Player('player1', spawnX, spawnY, this.gamemode);
    if (savedState && typeof savedState === 'object') {
      if (Array.isArray(savedState.inventory)) this.player.inventory = savedState.inventory.slice();
      if (Array.isArray(savedState.hand)) this.player.hand = savedState.hand.slice();
      if (savedState.equippedTank && typeof savedState.equippedTank === 'object') {
        this.player.equippedTank = { ...savedState.equippedTank };
      }
      if (savedState.equippedBody && typeof savedState.equippedBody === 'object') {
        this.player.equippedBody = { ...savedState.equippedBody };
      }
      if (typeof savedState.displayName === 'string' && savedState.displayName) {
        this.player.displayName = savedState.displayName;
      }
      if (typeof savedState.level === 'number' && savedState.level >= 1) {
        this.player.level = Math.min(100, savedState.level);
        this.player.xp = typeof savedState.xp === 'number' ? savedState.xp : 0;
      }
      if (typeof savedState.stars === 'number') this.player.stars = Math.max(0, savedState.stars);
      if (typeof savedState.score === 'number') this.player.score = Math.max(0, savedState.score);
    }
    this.player.applyStats();
    this.player.hp = this.player.maxHp;
    this.camera.x = this.player.x;
    this.camera.y = this.player.y;
    this.running = true;
    const loadPromise = loadTankAssets().then(() => {
      this.player.tankAssets = getLoadedTankAssets();
    });
    this.beetleImage = new Image();
    this.beetleImage.src = 'assets/icons/mobs/beetle/beetle.svg';
    this.beetleBodyImage = new Image();
    this.beetleBodyImage.src = 'assets/icons/mobs/beetle/body.svg';
    this.beetlePincerLeftImage = new Image();
    this.beetlePincerLeftImage.src = 'assets/icons/mobs/beetle/pincer_left.svg';
    this.beetlePincerRightImage = new Image();
    this.beetlePincerRightImage.src = 'assets/icons/mobs/beetle/pincer_right.svg';
    return loadPromise;
  }

  /** Serializable state for multiplayer sync. */
  getPlayerState() {
    const p = this.player;
    if (!p) return null;
    return {
      x: p.x,
      y: p.y,
      angle: p.angle,
      hp: p.hp,
      maxHp: p.maxHp,
      level: p.level,
      displayName: p.displayName || 'Player',
      equippedTank: p.equippedTank && typeof p.equippedTank === 'object' ? p.equippedTank : null,
      equippedBody: p.equippedBody && typeof p.equippedBody === 'object' ? p.equippedBody : null,
      size: p.size,
    };
  }

  /** Update list of other players from server (each has id, x, y, angle, hp, maxHp, level, displayName, equippedTank, equippedBody, size). */
  setOtherPlayers(list) {
    if (!Array.isArray(list)) return;
    this.otherPlayers = list.filter((o) => o && typeof o.id !== 'undefined');
  }

  /** Remove a player from otherPlayers (e.g. when they disconnect). */
  removeOtherPlayer(id) {
    if (!id) return;
    this.otherPlayers = this.otherPlayers.filter((o) => o.id !== id);
  }

  /** Display size for other players: guest viewer sees +50%, main viewer sees -50%. */
  _getOtherPlayerDisplaySize(op) {
    const base = op.size ?? 24.5;
    const isGuestViewer = (this.player?.displayName || '').toString().startsWith('Guest');
    return base * (isGuestViewer ? 1.5 : 0.5);
  }

  /** Draw one other player's body and gun at current transform (0,0). Uses op.equippedTank, op.equippedBody, op.size. */
  _drawOtherPlayerBody(ctx, scale, op) {
    const size = this._getOtherPlayerDisplaySize(op);
    const tankType = op.equippedTank?.subtype;
    const bodySubtype = op.equippedBody?.subtype;
    const bodyColor = '#1ca8c9';
    const outlineColor = darkenColor(bodyColor, 60);
    const s = size * 2.4;
    const assets = getLoadedTankAssets();
    const gunImg = tankType && assets?.guns ? assets.guns[tankType] : null;

    // Inferno body: grey circles + red core
    if (bodySubtype === 'inferno') {
      ctx.fillStyle = '#6a6a6a';
      ctx.strokeStyle = '#4a4a4a';
      ctx.lineWidth = Math.max(1, 1 / scale);
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.65, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#b0b0b0';
      ctx.strokeStyle = '#6a6a6a';
      ctx.lineWidth = Math.max(1, 0.75 / scale);
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.52, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#c00';
      ctx.strokeStyle = '#800';
      ctx.lineWidth = Math.max(1, 0.5 / scale);
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.26, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.fillStyle = bodyColor;
      ctx.strokeStyle = outlineColor;
      ctx.lineWidth = Math.max(1, 3 / scale);
      ctx.beginPath();
      ctx.arc(0, 0, size, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    if (tankType === 'riot') {
      const forwardOffset = size * 0.28400625;
      const S = size * 0.96 * 0.792;
      const h = S * Math.sqrt(3) / 2;
      const overlap = S * 0.65;
      const startX = size - S * 0.5;
      ctx.save();
      ctx.translate(forwardOffset, 0);
      ctx.fillStyle = '#9e9e9e';
      ctx.strokeStyle = '#4a4a4a';
      ctx.lineWidth = Math.max(1, 2 / scale);
      for (let i = 2; i >= 0; i--) {
        const tipX = startX + i * overlap;
        const baseX = tipX + S;
        ctx.beginPath();
        ctx.moveTo(tipX, 0);
        ctx.lineTo(baseX, -h);
        ctx.lineTo(baseX, h);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    } else if (tankType === 'overlord') {
      const R = size * 1.3;
      const w = size;
      ctx.fillStyle = '#9e9e9e';
      ctx.strokeStyle = '#4a4a4a';
      ctx.lineWidth = Math.max(1, 2 / scale);
      for (let i = 0; i < 4; i++) {
        ctx.save();
        ctx.rotate(i * Math.PI / 2);
        ctx.translate(0, -R);
        ctx.fillRect(-w / 2, -w / 2, w, w);
        ctx.strokeRect(-w / 2, -w / 2, w, w);
        ctx.restore();
      }
    } else if (gunImg?.complete && gunImg.naturalWidth > 0) {
      if (tankType === 'base') {
        ctx.save();
        ctx.translate(size * 0.78125, 0);
        ctx.drawImage(gunImg, -s, -s, s * 2, s * 2);
        ctx.restore();
      } else {
        ctx.drawImage(gunImg, -s, -s, s * 2, s * 2);
      }
    } else {
      ctx.fillStyle = '#2a2a2a';
      ctx.fillRect(size, -s * 0.15, s * 0.6, s * 0.3);
    }

    // Inferno outer ring (damaging aura)
    if (bodySubtype === 'inferno') {
      const b = BODY_UPGRADES.inferno;
      const r = op.equippedBody?.rarity;
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

    // Blue circle above gun and body (except Inferno and Ziggurat)
    if (bodySubtype !== 'inferno' && bodySubtype !== 'ziggurat') {
      const overlayR = size * 1.6;
      ctx.fillStyle = bodyColor;
      ctx.strokeStyle = outlineColor;
      ctx.lineWidth = Math.max(1, 3 / scale);
      ctx.beginPath();
      ctx.arc(0, 0, overlayR, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  spawnFood() {
    const walls = this.getWallsForGame();
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

  spawnBeetle() {
    const walls = this.getWallsForGame();
    const maxRetries = 20;
    let x, y, rarityWeights;
    for (let k = 0; k < maxRetries; k++) {
      const pt = getRandomPointAndWeights();
      x = pt.x;
      y = pt.y;
      rarityWeights = pt.rarityWeights;
      if (!isPointInWall(x, y, walls)) break;
      if (k === maxRetries - 1) return;
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
    const hasNaturalSuper = this.beetles.some((b) => b.rarity === 'super' && b.natural);
    if (rarity === 'super' && hasNaturalSuper) rarity = 'ultra';
    const beetle = new Beetle(x, y, rarity, true);
    this.beetles.push(beetle);
    if (rarity === 'super' && this.onSuperSpawn) {
      this.onSuperSpawn('Beetle');
    }
  }

  spawnBeetleAt(x, y, rarity) {
    const beetle = new Beetle(x, y, rarity);
    this.beetles.push(beetle);
    if (rarity === 'super' && this.onSuperSpawn) {
      this.onSuperSpawn('Beetle');
    }
  }

  removeBeetle(beetle) {
    this.beetles = this.beetles.filter(b => b !== beetle);
  }

  removeFood(food) {
    this.foods = this.foods.filter(f => f !== food);
  }

  /** Add a loot drop at (x, y) visible and pickable only by ownerId. Uses bodies-rarity / guns-rarity / petal-rarity SVG icons. */
  addDrop(x, y, item, ownerId) {
    let url;
    if (item.type === 'petal') url = getPetalIconUrlByRarity(item.subtype, item.rarity);
    else if (item.type === 'body') url = getBodyIconUrlByRarity(item.subtype, item.rarity);
    else url = getGunIconUrlByRarity(item.subtype, item.rarity);
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

    // Multiplayer: emit state every frame for real-time movement (synced with game loop)
    if (this.multiplayerSocket?.connected && this.player) {
      const s = this.getPlayerState();
      if (s) this.multiplayerSocket.emit('state', s);
    }

    // Multiplayer: interpolate mob positions toward server to avoid teleporting every tick
    if (this.multiplayerSocket) {
      const LERP = 0.28;
      const SNAP_CLOSE = 0.8;
      const SNAP_FAR = 80;
      for (const food of this.foods) {
        if (food.serverX != null && food.serverY != null) {
          const dx = food.serverX - food.x;
          const dy = food.serverY - food.y;
          const distSq = dx * dx + dy * dy;
          if (distSq < SNAP_CLOSE * SNAP_CLOSE) {
            food.x = food.serverX;
            food.y = food.serverY;
          } else if (distSq > SNAP_FAR * SNAP_FAR) {
            food.x = food.serverX;
            food.y = food.serverY;
          } else {
            food.x += dx * LERP;
            food.y += dy * LERP;
          }
        }
      }
      for (const beetle of this.beetles) {
        if (beetle.serverX != null && beetle.serverY != null) {
          const dx = beetle.serverX - beetle.x;
          const dy = beetle.serverY - beetle.y;
          const distSq = dx * dx + dy * dy;
          if (distSq < SNAP_CLOSE * SNAP_CLOSE) {
            beetle.x = beetle.serverX;
            beetle.y = beetle.serverY;
          } else if (distSq > SNAP_FAR * SNAP_FAR) {
            beetle.x = beetle.serverX;
            beetle.y = beetle.serverY;
          } else {
            beetle.x += dx * LERP;
            beetle.y += dy * LERP;
          }
        }
      }
      const dtSec = dt / 1000;
      for (const { sq } of this.pendingSquares) {
        sq.x += (sq.vx || 0) * dtSec;
        sq.y += (sq.vy || 0) * dtSec;
        sq.rotation = (sq.rotation ?? 0) + (sq.angularVelocity ?? 0) * dtSec;
        sq.angularVelocity = (sq.angularVelocity ?? 0) * 0.98;
      }
    }

    // Wall collision: use rect-based when custom map (exact match to drawn walls), else segment-based
    const wallFills = this.getWallFillsForGame();
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
      const allWalls = this.getWallsForGame();
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

    // Update mobs: when multiplayer only update nearby (server drives position); otherwise update all
    const player = this.player;
    const updateMargin = 1400;
    if (this.multiplayerSocket && player) {
      for (const food of this.foods) {
        if (Math.abs(food.x - player.x) <= updateMargin && Math.abs(food.y - player.y) <= updateMargin) food.update(dt);
      }
      for (const beetle of this.beetles) {
        if (Math.abs(beetle.x - player.x) <= updateMargin && Math.abs(beetle.y - player.y) <= updateMargin) beetle.update(dt, this);
      }
    } else {
      for (const food of this.foods) food.update(dt);
      for (const beetle of this.beetles) beetle.update(dt, this);
    }

    // Wall collision for food/shapes: keep them inside playable area
    const wallFillsForFood = getMergedWallFills();
    let allWallsForFood, wallHalfFood;
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
      allWallsForFood = this.getWallsForGame();
      wallHalfFood = getWallHalfWidth();
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
    if (wallFillsForFood.length > 0) {
      for (const beetle of this.beetles) {
        const margin = (beetle.size ?? 20) + 50;
        const minX = beetle.x - margin, maxX = beetle.x + margin;
        const minY = beetle.y - margin, maxY = beetle.y + margin;
        const nearbyRects = wallFillsForFood.filter(r => r.x2 >= minX && r.x1 <= maxX && r.y2 >= minY && r.y1 <= maxY);
        for (let pass = 0; pass < 3; pass++) {
          const resolved = resolveWallCollisionRects(beetle.x, beetle.y, beetle.size ?? 20, nearbyRects);
          if (resolved) {
            beetle.x = resolved.x;
            beetle.y = resolved.y;
            beetle.vx *= 0.7;
            beetle.vy *= 0.7;
          } else break;
        }
      }
    } else {
      for (const beetle of this.beetles) {
        const radius = beetle.size ?? 20;
        const margin = radius + wallHalfFood + 100;
        const nearbyWalls = wallsNear(allWallsForFood, beetle.x, beetle.y, margin);
        for (let pass = 0; pass < 3; pass++) {
          const resolved = resolveWallCollision(beetle.x, beetle.y, radius, nearbyWalls);
          if (resolved) {
            beetle.x = resolved.x;
            beetle.y = resolved.y;
            beetle.vx *= 0.7;
            beetle.vy *= 0.7;
          } else break;
        }
      }
    }

    // Beetle–beetle collision: push overlapping beetles apart (ellipse approximated by semiMajor circle for pairwise distance)
    const BEETLE_SEPARATION_MAX = 2.5;
    for (let i = 0; i < this.beetles.length; i++) {
      const a = this.beetles[i];
      if (a.hp <= 0) continue;
      for (let j = i + 1; j < this.beetles.length; j++) {
        const b = this.beetles[j];
        if (b.hp <= 0) continue;
        const d = distance(a.x, a.y, b.x, b.y);
        const minDist = a.semiMajor + b.semiMajor;
        const overlap = minDist - d;
        if (overlap > 0) {
          const nx = d > 0 ? (a.x - b.x) / d : 1;
          const ny = d > 0 ? (a.y - b.y) / d : 0;
          const separation = Math.min(overlap / 2, BEETLE_SEPARATION_MAX);
          a.x += nx * separation;
          a.y += ny * separation;
          b.x -= nx * separation;
          b.y -= ny * separation;
        }
      }
    }

    // Beetle–shape (square) collision: push beetles out of overlapping squares
    const squaresForCollision = this.multiplayerSocket
      ? [...this.serverSquares, ...this.pendingSquares.map((p) => p.sq)]
      : this.squares;
    for (const beetle of this.beetles) {
      if (beetle.hp <= 0) continue;
      for (const sq of squaresForCollision) {
        if (!sq || typeof sq.x !== 'number' || typeof sq.y !== 'number') continue;
        const overlap = beetle.getEllipseOverlap(sq.x, sq.y, sq.size ?? 14);
        if (overlap > 0) {
          const d = distance(beetle.x, beetle.y, sq.x, sq.y);
          const nx = d > 0 ? (beetle.x - sq.x) / d : 1;
          const ny = d > 0 ? (beetle.y - sq.y) / d : 0;
          const separation = Math.min(overlap / 2, BEETLE_SEPARATION_MAX);
          beetle.x += nx * separation;
          beetle.y += ny * separation;
        }
      }
    }

    const bulletsToRemove = new Set();
    if (!this.multiplayerSocket) {
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
            if (this.multiplayerSocket && food.id != null) {
              this.multiplayerSocket.emit('hit', {
                mobId: food.id,
                mobType: 'food',
                damage: bullet.damage,
                x: this.player.x,
                y: this.player.y,
              });
            } else {
              food.hp -= bullet.damage;
              if (food.hp <= 0) this.player.onKill(food, this);
            }
            const pushFactor = bulletDisplaceStrength(bullet.weight, food.weight);
            food.vx += Math.cos(bullet.angle) * bullet.speed * pushFactor;
            food.vy += Math.sin(bullet.angle) * bullet.speed * pushFactor;
            if (bullet.hp != null) bullet.hp -= hpPerHit;
            if (bullet.hp != null && bullet.hp <= 0) bulletsToRemove.add(bullet);
          }
        }
        for (const beetle of this.beetles) {
          if (bullet.hp != null && bullet.hp <= 0) break;
          if (bullet.hitTargets.has(beetle)) continue;
          if (beetle.ellipseOverlapsCircle(bullet.x, bullet.y, bullet.size)) {
            bullet.hitTargets.add(beetle);
            if (this.multiplayerSocket && beetle.id != null) {
              this.multiplayerSocket.emit('hit', {
                mobId: beetle.id,
                mobType: 'beetle',
                damage: bullet.damage,
                x: this.player.x,
                y: this.player.y,
              });
            } else {
              beetle.hp -= bullet.damage;
              if (beetle.hp <= 0) this.player.onKill(beetle, this);
            }
            const pushFactor = bulletDisplaceStrength(bullet.weight, beetle.weight);
            beetle.vx += Math.cos(bullet.angle) * bullet.speed * pushFactor;
            beetle.vy += Math.sin(bullet.angle) * bullet.speed * pushFactor;
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
              if (this.multiplayerSocket && food.id != null) {
                this.multiplayerSocket.emit('hit', {
                  mobId: food.id,
                  mobType: 'food',
                  damage: bullet.damage,
                  x: this.player.x,
                  y: this.player.y,
                });
              } else {
                food.hp -= bullet.damage;
                if (food.hp <= 0) this.player.onKill(food, this);
              }
              const pushFactor = bulletDisplaceStrength(bullet.weight, food.weight);
              food.vx += Math.cos(bullet.angle) * bullet.speed * pushFactor;
              food.vy += Math.sin(bullet.angle) * bullet.speed * pushFactor;
              bulletsToRemove.add(bullet);
              break;
            }
          }
        }
        if (!bulletsToRemove.has(bullet)) {
          for (const beetle of this.beetles) {
            if (beetle.ellipseOverlapsCircle(bullet.x, bullet.y, bullet.size)) {
              if (this.multiplayerSocket && beetle.id != null) {
                this.multiplayerSocket.emit('hit', {
                  mobId: beetle.id,
                  mobType: 'beetle',
                  damage: bullet.damage,
                  x: this.player.x,
                  y: this.player.y,
                });
              } else {
                beetle.hp -= bullet.damage;
                if (beetle.hp <= 0) this.player.onKill(beetle, this);
              }
              const pushFactor = bulletDisplaceStrength(bullet.weight, beetle.weight);
              beetle.vx += Math.cos(bullet.angle) * bullet.speed * pushFactor;
              beetle.vy += Math.sin(bullet.angle) * bullet.speed * pushFactor;
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
      const sqDamage = sq.damage * dt / 1000;
      for (const food of this.foods) {
        const d = distance(sq.x, sq.y, food.x, food.y);
        if (d < sq.size + food.size) {
          if (this.multiplayerSocket && food.id != null) {
            this.multiplayerSocket.emit('hit', {
              mobId: food.id,
              mobType: 'food',
              damage: sqDamage,
              x: this.player.x,
              y: this.player.y,
            });
          } else {
            food.hp -= sqDamage;
            if (food.hp <= 0) this.player.onKill(food, this);
          }
        }
      }
      for (const beetle of this.beetles) {
        if (beetle.ellipseOverlapsCircle(sq.x, sq.y, sq.size)) {
          if (this.multiplayerSocket && beetle.id != null) {
            this.multiplayerSocket.emit('hit', {
              mobId: beetle.id,
              mobType: 'beetle',
              damage: sqDamage,
              x: this.player.x,
              y: this.player.y,
            });
          } else {
            beetle.hp -= sqDamage;
            if (beetle.hp <= 0) this.player.onKill(beetle, this);
          }
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
      const allWallsSq = this.getWallsForGame();
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
    }

    this.spawnTimer += dt;
    if (!this.multiplayerSocket && this.spawnTimer >= FOOD_SPAWN_INTERVAL_MS) {
      this.spawnTimer = 0;
      if (this.foods.length < FOOD_TARGET_COUNT) {
        for (let i = 0; i < FOOD_SPAWN_BATCH && this.foods.length < FOOD_TARGET_COUNT; i++) this.spawnFood();
      }
      if (this.beetles.length < BEETLE_TARGET_COUNT) {
        for (let i = 0; i < BEETLE_SPAWN_BATCH && this.beetles.length < BEETLE_TARGET_COUNT; i++) this.spawnBeetle();
      }
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

    const playableBounds = this.getPlayableBoundsForGame();

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

    const wallFills = this.getWallFillsForGame();
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
      for (const w of this.getWallsForGame()) {
        ctx.beginPath();
        ctx.moveTo(w.x1, w.y1);
        ctx.lineTo(w.x2, w.y2);
        ctx.stroke();
      }
      ctx.strokeStyle = '#0d0d0d';
      ctx.lineWidth = Math.max(2, 8 / scale);
      ctx.lineCap = 'butt';
      for (const w of this.getWallsForGame()) {
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
    for (const beetle of this.beetles) {
      beetle.draw(ctx, scale, this.camera, playerLevel, this.beetleImage, this.beetleBodyImage, this.beetlePincerLeftImage, this.beetlePincerRightImage);
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

    if (this.multiplayerSocket) {
      const cam = this.camera;
      const viewW = (ctx.canvas.width / scale) * 0.6;
      const viewH = (ctx.canvas.height / scale) * 0.6;
      const bulletList = this.serverBullets.filter((b) =>
        b.x >= cam.x - viewW && b.x <= cam.x + viewW && b.y >= cam.y - viewH && b.y <= cam.y + viewH
      ).slice(0, 300);
      for (const b of bulletList) {
        ctx.save();
        ctx.fillStyle = '#1ca8c9';
        ctx.strokeStyle = '#4a4a4a';
        ctx.lineWidth = Math.max(1, 3 / scale);
        ctx.beginPath();
        ctx.arc(b.x, b.y, (b.size || 6) * 0.7, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
      const squareList = this.serverSquares.filter((sq) => {
        if (sq.x >= cam.x - viewW && sq.x <= cam.x + viewW && sq.y >= cam.y - viewH && sq.y <= cam.y + viewH) {
          const isOurs = this.multiplayerSocket && sq.ownerId === this.multiplayerSocket.id;
          const recent = sq.spawnedAt != null && (Date.now() - sq.spawnedAt) < 600;
          if (isOurs && recent) return false;
          return true;
        }
        return false;
      }).slice(0, 200);
      for (const sq of squareList) {
        ctx.save();
        ctx.translate(sq.x, sq.y);
        ctx.rotate(sq.rotation ?? 0);
        const fillColor = (sq.bodyColor && typeof sq.bodyColor === 'string') ? sq.bodyColor : getRarityColor(sq.rarity || 'common');
        ctx.fillStyle = fillColor;
        ctx.strokeStyle = '#4a4a4a';
        ctx.lineWidth = 2 / scale;
        ctx.fillRect(-sq.size, -sq.size, sq.size * 2, sq.size * 2);
        ctx.strokeRect(-sq.size, -sq.size, sq.size * 2, sq.size * 2);
        ctx.restore();
      }
      for (const { sq } of this.pendingSquares) {
        if (sq.x < cam.x - viewW || sq.x > cam.x + viewW || sq.y < cam.y - viewH || sq.y > cam.y + viewH) continue;
        ctx.save();
        ctx.translate(sq.x, sq.y);
        ctx.rotate(sq.rotation ?? 0);
        const fillColor = (sq.bodyColor && typeof sq.bodyColor === 'string') ? sq.bodyColor : getRarityColor(sq.rarity || 'common');
        ctx.fillStyle = fillColor;
        ctx.strokeStyle = '#4a4a4a';
        ctx.lineWidth = 2 / scale;
        ctx.fillRect(-sq.size, -sq.size, sq.size * 2, sq.size * 2);
        ctx.strokeRect(-sq.size, -sq.size, sq.size * 2, sq.size * 2);
        ctx.restore();
      }
    } else {
    for (const sq of this.squares) {
      sq.draw(ctx, scale);
    }

    for (const bullet of this.bullets) {
      bullet.draw(ctx, scale);
    }
    }

    for (const op of this.otherPlayers) {
      if (op.dead) continue;
      ctx.save();
      ctx.translate(op.x, op.y);
      ctx.rotate(op.angle);
      this._drawOtherPlayerBody(ctx, scale, op);
      ctx.restore();
      const name = (op.displayName || 'Player').slice(0, 20);
      const opSize = this._getOtherPlayerDisplaySize(op);
      const fontSize = Math.max(10, 14 / scale);
      ctx.font = `bold ${fontSize}px Rajdhani, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2 / scale;
      const nameY = (op.y ?? 0) - opSize - 8;
      ctx.strokeText(name, op.x ?? 0, nameY);
      ctx.fillText(name, op.x ?? 0, nameY);
      const barW = opSize * 2.5;
      const barH = Math.max(5, 6 / scale);
      const barY = (op.y ?? 0) + opSize + 8;
      const barX = (op.x ?? 0) - barW / 2;
      const hpPct = typeof op.hp === 'number' && typeof op.maxHp === 'number' && op.maxHp > 0 ? op.hp / op.maxHp : 1;
      drawRoundedHealthBar(ctx, barX, barY, barW, barH, hpPct, { fillColor: '#81c784', outlineColor: 'rgba(0,0,0,0.8)', lineWidth: Math.max(1, 2 / scale) });
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

    // Admin only: arrows pointing to every super mob (food and beetle)
    if (this.player && this.player.isAdmin && !this.player.dead) {
      const halfW = cw / 2;
      const halfH = ch / 2;
      const margin = 40;
      const superMobs = [
        ...this.foods.filter((f) => f.rarity === 'super').map((f) => ({ x: f.x, y: f.y })),
        ...this.beetles.filter((b) => b.rarity === 'super').map((b) => ({ x: b.x, y: b.y })),
      ];
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      for (const mob of superMobs) {
        const sx = halfW + (mob.x - cam.x) * scale;
        const sy = halfH + (mob.y - cam.y) * scale;
        const dx = sx - halfW;
        const dy = sy - halfH;
        if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) continue;
        const inView = sx >= margin && sx <= cw - margin && sy >= margin && sy <= ch - margin;
        if (inView) continue;
        let t = Infinity;
        if (Math.abs(dx) > 1e-6) t = Math.min(t, (dx > 0 ? halfW - margin : -halfW + margin) / dx);
        if (Math.abs(dy) > 1e-6) t = Math.min(t, (dy > 0 ? halfH - margin : -halfH + margin) / dy);
        if (t === Infinity || t <= 0) continue;
        const ex = halfW + dx * t;
        const ey = halfH + dy * t;
        const angle = Math.atan2(dy, dx);
        const arrowLen = 24;
        const arrowW = 14;
        ctx.fillStyle = getRarityColor('super');
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(ex + Math.cos(angle) * arrowLen, ey + Math.sin(angle) * arrowLen);
        ctx.lineTo(ex - Math.cos(angle) * arrowLen + Math.sin(angle) * arrowW, ey - Math.sin(angle) * arrowLen - Math.cos(angle) * arrowW);
        ctx.lineTo(ex - Math.cos(angle) * arrowLen - Math.sin(angle) * arrowW, ey - Math.sin(angle) * arrowLen + Math.cos(angle) * arrowW);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }

    ctx.restore();
  }
}