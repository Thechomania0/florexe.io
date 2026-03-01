/**
 * Server-authoritative drones (Overlord and Hive). Follow player target (mouse) from state; collision with mobs calls mobs.hitMob.
 */
const { hitMob } = require('./mobs.js');
const { isPointInWallCell } = require('./map.js');

function distance(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

function angleBetween(ax, ay, bx, by) {
  return Math.atan2(by - ay, bx - ax);
}

const OVERLORD_MAX_RANGE = 1800;
const OVERLORD_RETURN_RANGE = 500;
const OVERLORD_RECHARGE_TIME = 800;
const OVERLORD_SPEED = 104 * 1.4 * 1.4;
const OVERLORD_DAMAGE_BY_RARITY = { common: 40, uncommon: 50, rare: 80, epic: 120, legendary: 250, mythic: 500, ultra: 1000, super: 5000 };
const OVERLORD_COUNT = { common: 8, uncommon: 8, rare: 8, epic: 8, legendary: 8, mythic: 8, ultra: 12, super: 12 };
const OVERLORD_SIZE_BY_RARITY = { common: 1, uncommon: 1.1, rare: 1.21, epic: 1.331, legendary: 1.4641, mythic: 1.61051, ultra: 2.093663, super: 3.1404945 };
const OVERLORD_SIZE_BASE = 10;

const HIVE_DRONE_HP = 60;
const HIVE_SPEED = 104 * 1.4 * 1.4;
const HIVE_DAMAGE_BY_RARITY = { common: 20, uncommon: 30, rare: 50, epic: 80, legendary: 150, mythic: 300, ultra: 600, super: 2000 };
const HIVE_RANGE_BY_RARITY = { common: 200, uncommon: 250, rare: 300, epic: 400, legendary: 600, mythic: 800, ultra: 1000, super: 1200 };
const HIVE_SIZE = 6;
const HIVE_COLLISION_RADIUS = HIVE_SIZE / Math.SQRT2;
const BODY_SPAWNERS = { common: 4, uncommon: 8, rare: 16, epic: 16, legendary: 16, mythic: 16, ultra: 16, super: 16 };

const roomDrones = new Map();

function getRoomDrones(room) {
  if (!roomDrones.has(room)) {
    roomDrones.set(room, { overlord: new Map(), hive: new Map() });
  }
  return roomDrones.get(room);
}

function getOverlordRarity(equippedTank) {
  if (!equippedTank || equippedTank.subtype !== 'overlord') return null;
  const r = (equippedTank.rarity || 'common');
  return OVERLORD_DAMAGE_BY_RARITY[r] != null ? r : 'common';
}

function getHiveRarity(equippedBody) {
  if (!equippedBody || equippedBody.subtype !== 'hive') return null;
  const r = (equippedBody.rarity || 'common');
  return HIVE_DAMAGE_BY_RARITY[r] != null ? r : 'common';
}

function ensureOverlordDrones(room, ownerId, playerState, bodies) {
  const rd = getRoomDrones(room);
  let list = rd.overlord.get(ownerId) || [];
  const rarity = getOverlordRarity(playerState?.equippedTank);
  if (!rarity) {
    rd.overlord.delete(ownerId);
    return;
  }
  const count = OVERLORD_COUNT[rarity] || 8;
  const damage = OVERLORD_DAMAGE_BY_RARITY[rarity] || 40;
  const sizeMult = OVERLORD_SIZE_BY_RARITY[rarity] || 1;
  const size = OVERLORD_SIZE_BASE * sizeMult;
  const collisionRadius = size / 2;
  const body = bodies?.get(ownerId);
  const ownerX = body?.x ?? playerState?.x ?? 0;
  const ownerY = body?.y ?? playerState?.y ?? 0;
  while (list.length < count) {
    const index = list.length;
    const angle = (index / count) * Math.PI * 2;
    list.push({
      type: 'overlord',
      index,
      total: count,
      x: ownerX + Math.cos(angle) * 40,
      y: ownerY + Math.sin(angle) * 40,
      hp: damage,
      maxHp: damage,
      damage,
      size,
      collisionRadius,
      speed: OVERLORD_SPEED,
      rechargeUntil: 0,
      targetX: ownerX,
      targetY: ownerY,
    });
  }
  if (list.length > count) list = list.slice(0, count);
  rd.overlord.set(ownerId, list);
}

function ensureHiveDrones(room, ownerId, playerState, bodies) {
  const rd = getRoomDrones(room);
  let list = rd.hive.get(ownerId) || [];
  const rarity = getHiveRarity(playerState?.equippedBody);
  if (!rarity) {
    rd.hive.delete(ownerId);
    return;
  }
  const spawners = BODY_SPAWNERS[rarity] || 4;
  const maxDrones = Math.min(spawners * 3, 48);
  const damage = HIVE_DAMAGE_BY_RARITY[rarity] || 20;
  const range = HIVE_RANGE_BY_RARITY[rarity] || 200;
  const body = bodies?.get(ownerId);
  const ownerX = body?.x ?? playerState?.x ?? 0;
  const ownerY = body?.y ?? playerState?.y ?? 0;
  while (list.length < maxDrones) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 30 + Math.random() * 20;
    list.push({
      type: 'hive',
      x: ownerX + Math.cos(angle) * dist,
      y: ownerY + Math.sin(angle) * dist,
      hp: HIVE_DRONE_HP,
      maxHp: HIVE_DRONE_HP,
      damage,
      range,
      size: HIVE_SIZE,
      collisionRadius: HIVE_COLLISION_RADIUS,
      speed: HIVE_SPEED,
    });
  }
  if (list.length > maxDrones) list = list.slice(0, maxDrones);
  rd.hive.set(ownerId, list);
}

function ellipseOverlapsCircle(beetle, cx, cy, r) {
  const dx = cx - beetle.x;
  const dy = cy - beetle.y;
  const hitboxScale = (beetle.rarity === 'mythic' || beetle.rarity === 'legendary') ? 0.4 : 1;
  const semiMajor = beetle.size * (25.5 / 64) * hitboxScale;
  const semiMinor = beetle.size * (19.5 / 64) * hitboxScale;
  const a = semiMajor + r;
  const b = semiMinor + r;
  return (dx / a) * (dx / a) + (dy / b) * (dy / b) <= 1;
}

function updateOverlordDrones(room, roomPlayers, roomPlayerBodies, foodsSnapshot, beetlesSnapshot, dtMs, killPayloads) {
  const rd = getRoomDrones(room);
  const players = roomPlayers?.get(room);
  const bodies = roomPlayerBodies?.get(room);
  if (!players || !bodies) return;
  const dtSec = dtMs / 1000;
  const now = Date.now();
  for (const [ownerId, list] of rd.overlord.entries()) {
    const state = players.get(ownerId);
    const body = bodies.get(ownerId);
    const ownerX = body?.x ?? state?.x ?? 0;
    const ownerY = body?.y ?? state?.y ?? 0;
    const targetX = typeof state?.targetX === 'number' ? state.targetX : null;
    const targetY = typeof state?.targetY === 'number' ? state.targetY : null;
    for (const d of list) {
      const distToOwner = distance(d.x, d.y, ownerX, ownerY);
      if (distToOwner > OVERLORD_MAX_RANGE) {
        d.hp = 0;
        continue;
      }
      if (d.rechargeUntil > 0) {
        const backAngle = angleBetween(d.x, d.y, ownerX, ownerY);
        d.x += Math.cos(backAngle) * d.speed * 1.5 * dtSec;
        d.y += Math.sin(backAngle) * d.speed * 1.5 * dtSec;
        if (distToOwner < OVERLORD_RETURN_RANGE && now >= d.rechargeUntil) d.rechargeUntil = 0;
        continue;
      }
      let moveX = targetX;
      let moveY = targetY;
      if (moveX == null || moveY == null) {
        let closest = null;
        let minDist = Infinity;
        for (const f of foodsSnapshot) {
          if (f.hp <= 0) continue;
          const dist = distance(d.x, d.y, f.x, f.y);
          if (dist < minDist) { minDist = dist; closest = { x: f.x, y: f.y }; }
        }
        for (const b of beetlesSnapshot) {
          if (b.hp <= 0) continue;
          const dist = distance(d.x, d.y, b.x, b.y);
          if (dist < minDist) { minDist = dist; closest = { x: b.x, y: b.y }; }
        }
        if (closest) { moveX = closest.x; moveY = closest.y; } else { moveX = ownerX; moveY = ownerY; }
      }
      const moveAngle = angleBetween(d.x, d.y, moveX, moveY);
      d.x += Math.cos(moveAngle) * d.speed * dtSec;
      d.y += Math.sin(moveAngle) * d.speed * dtSec;
      d.targetX = moveX;
      d.targetY = moveY;
      if (isPointInWallCell(d.x, d.y)) {
        d.x -= Math.cos(moveAngle) * d.speed * dtSec;
        d.y -= Math.sin(moveAngle) * d.speed * dtSec;
      }
      const dmg = d.damage * dtSec;
      for (const food of foodsSnapshot) {
        if (food.hp <= 0) continue;
        const foodSize = food.size ?? 20;
        const dist = distance(d.x, d.y, food.x, food.y);
        if (dist < d.collisionRadius + foodSize) {
          const result = hitMob(room, food.id, 'food', dmg, d.x, d.y);
          if (result.killed && result.killPayload) killPayloads.push({ socketId: ownerId, payload: result.killPayload });
          d.hp -= (food.damage ?? 10) * dtSec;
          if (d.hp <= 0) d.rechargeUntil = now + OVERLORD_RECHARGE_TIME;
          break;
        }
      }
      if (d.hp > 0) {
        for (const beetle of beetlesSnapshot) {
          if (beetle.hp <= 0) continue;
          if (ellipseOverlapsCircle(beetle, d.x, d.y, d.collisionRadius)) {
            const result = hitMob(room, beetle.id, 'beetle', dmg, d.x, d.y);
            if (result.killed && result.killPayload) killPayloads.push({ socketId: ownerId, payload: result.killPayload });
            d.hp -= (beetle.damage ?? 10) * dtSec;
            if (d.hp <= 0) d.rechargeUntil = now + OVERLORD_RECHARGE_TIME;
            break;
          }
        }
      }
    }
    rd.overlord.set(ownerId, list.filter((d) => d.hp > 0));
  }
}

function updateHiveDrones(room, roomPlayers, roomPlayerBodies, foodsSnapshot, beetlesSnapshot, dtMs, killPayloads) {
  const rd = getRoomDrones(room);
  const players = roomPlayers?.get(room);
  const bodies = roomPlayerBodies?.get(room);
  if (!players || !bodies) return;
  const dtSec = dtMs / 1000;
  for (const [ownerId, list] of rd.hive.entries()) {
    const body = bodies.get(ownerId);
    const ownerX = body?.x ?? 0;
    const ownerY = body?.y ?? 0;
    for (const d of list) {
      const ownerDist = distance(d.x, d.y, ownerX, ownerY);
      if (ownerDist > d.range) {
        d.hp = 0;
        continue;
      }
      let moveX = null, moveY = null;
      let minDist = d.range + 1;
      for (const f of foodsSnapshot) {
        if (f.hp <= 0) continue;
        const dist = distance(d.x, d.y, f.x, f.y);
        if (dist < minDist) { minDist = dist; moveX = f.x; moveY = f.y; }
      }
      for (const b of beetlesSnapshot) {
        if (b.hp <= 0) continue;
        const dist = distance(d.x, d.y, b.x, b.y);
        if (dist < minDist) { minDist = dist; moveX = b.x; moveY = b.y; }
      }
      if (moveX != null && moveY != null) {
        const angle = angleBetween(d.x, d.y, moveX, moveY);
        d.x += Math.cos(angle) * d.speed * dtSec;
        d.y += Math.sin(angle) * d.speed * dtSec;
      }
      const dmg = d.damage * dtSec;
      for (const food of foodsSnapshot) {
        if (food.hp <= 0) continue;
        const dist = distance(d.x, d.y, food.x, food.y);
        if (dist < d.collisionRadius + (food.size ?? 20)) {
          const result = hitMob(room, food.id, 'food', dmg, d.x, d.y);
          if (result.killed && result.killPayload) killPayloads.push({ socketId: ownerId, payload: result.killPayload });
          d.hp -= (food.damage ?? 10) * dtSec;
          break;
        }
      }
      if (d.hp > 0) {
        for (const beetle of beetlesSnapshot) {
          if (beetle.hp <= 0) continue;
          if (ellipseOverlapsCircle(beetle, d.x, d.y, d.collisionRadius)) {
            const result = hitMob(room, beetle.id, 'beetle', dmg, d.x, d.y);
            if (result.killed && result.killPayload) killPayloads.push({ socketId: ownerId, payload: result.killPayload });
            d.hp -= (beetle.damage ?? 10) * dtSec;
            break;
          }
        }
      }
    }
    rd.hive.set(ownerId, list.filter((d) => d.hp > 0));
  }
}

function getDronesSnapshot(room, roomPlayers, roomPlayerBodies) {
  const rd = getRoomDrones(room);
  const players = roomPlayers?.get(room);
  const list = [];
  if (players) {
    for (const [ownerId, drones] of rd.overlord.entries()) {
      if (!players.has(ownerId)) continue;
      for (const d of drones) {
        if (d.hp <= 0) continue;
        list.push({ ownerId, type: 'overlord', x: d.x, y: d.y, size: d.size, targetX: d.targetX, targetY: d.targetY, rechargeUntil: d.rechargeUntil });
      }
    }
    for (const [ownerId, drones] of rd.hive.entries()) {
      if (!players.has(ownerId)) continue;
      for (const d of drones) {
        if (d.hp <= 0) continue;
        list.push({ ownerId, type: 'hive', x: d.x, y: d.y, size: d.size });
      }
    }
  }
  return list;
}

function removePlayerDrones(room, ownerId) {
  const rd = getRoomDrones(room);
  rd.overlord.delete(ownerId);
  rd.hive.delete(ownerId);
}

module.exports = {
  getRoomDrones,
  ensureOverlordDrones,
  ensureHiveDrones,
  updateOverlordDrones,
  updateHiveDrones,
  getDronesSnapshot,
  removePlayerDrones,
};
