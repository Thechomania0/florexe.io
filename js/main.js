import { Game } from './Game.js';
import { RARITY_COLORS, CRAFT_CHANCES, RARITIES, TANK_UPGRADES, BODY_UPGRADES, MAP_SIZE, FOOD_CONFIG, INFERNO_BASE_RADIUS, SHOP_ITEM_PRICES } from './config.js';
import { WALL_HALF_WIDTH, getWalls, getMergedWallFills, getPlayableBounds } from './mapData.js';
import { getRarityColor, darkenColor } from './utils.js';
import { getIconUrl as getTankAssetIconUrl, getGunIconUrl, getBodyIconUrl, getBodyIconUrlByRarity, getGunIconUrlByRarity, loadTankAssets, GUN_SUBTYPES, BODY_SUBTYPES } from './TankAssets.js';

function getEquippedTankName(player) {
  const tankName = player?.equippedTank && TANK_UPGRADES[player.equippedTank.subtype]?.name;
  const bodyName = player?.equippedBody && BODY_UPGRADES[player.equippedBody.subtype]?.name;
  const parts = [tankName, bodyName].filter(Boolean);
  return parts.length ? parts.join(' ') : 'Destroyer';
}

let game = null;
let lastTime = 0;
let animationId = null;

let canvas, ctx, mainMenu, gameContainer, minimapCanvas, minimapCtx;

const MINIMAP_SIZE = 220; // fixed full-map view; entire map fits, does not pan

/** Generate an SVG data URL for a regular polygon (mob/food shape) for use in the gallery. */
function getMobShapeSvgDataUrl(sides, fillColor, strokeColor) {
  if (sides < 3) sides = 3;
  const cx = 24;
  const cy = 24;
  const r = 20;
  const points = [];
  for (let i = 0; i < sides; i++) {
    const angle = (i / sides) * Math.PI * 2;
    const px = cx + Math.cos(angle) * r;
    const py = cy + Math.sin(angle) * r;
    points.push(`${px.toFixed(2)},${py.toFixed(2)}`);
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48"><polygon points="${points.join(' ')}" fill="${fillColor}" stroke="${strokeColor}" stroke-width="2"/></svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

function formatScore(n) {
  const s = Math.round(n);
  if (s <= 999) return String(s);
  if (s >= 1e15) return (s / 1e15).toFixed(1) + 'q';
  if (s >= 1e12) return (s / 1e12).toFixed(1) + 't';
  if (s >= 1e9) return (s / 1e9).toFixed(1) + 'b';
  if (s >= 1e6) return (s / 1e6).toFixed(1) + 'm';
  return (s / 1e3).toFixed(1) + 'k';
}

function resize() {
  if (!canvas) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = w;
  canvas.height = h;
  if (game?.player) {
    game.scale = Math.max(0.8, Math.min(w, h) / 720);
  }
}
window.addEventListener('resize', resize);

/** Load custom map from data/custom-map*.json when localStorage has no map. Default map = what new users see when cache is cleared. */
async function loadCustomMapFromRepo(gamemode) {
  try {
    if (localStorage.getItem('florexe_custom_zones')) return;
    const base = document.querySelector('base')?.getAttribute('href') || './';
    const paths = gamemode && gamemode !== 'ffa' ? [base + 'data/custom-map-' + gamemode + '.json', base + 'data/custom-map.json'] : [base + 'data/custom-map.json'];
    let data = null;
    for (const url of paths) {
      const r = await fetch(url);
      if (r.ok) {
        data = await r.json();
        if (data && Array.isArray(data.walls) && data.zones && Array.isArray(data.zones.grid) && data.zones.grid.length === 400) break;
        data = null;
      }
    }
    if (!data) return;
    localStorage.setItem('florexe_custom_walls', JSON.stringify(data.walls));
    localStorage.setItem('florexe_custom_zones', JSON.stringify(data.zones));
  } catch (e) {}
}

function startGame(gamemode) {
  const loadingScreenEl = document.getElementById('loading-screen');
  if (loadingScreenEl) loadingScreenEl.classList.remove('hidden');

  mainMenu.classList.add('hidden');
  gameContainer.classList.remove('hidden');
  const loadingShownAt = Date.now();
  resize();

  // Yield so the browser paints the loading screen before we create the game
  requestAnimationFrame(() => {
    requestAnimationFrame(async () => {
      await loadCustomMapFromRepo(gamemode);
      game = new Game(gamemode);
      const chatEl = document.getElementById('chatMessages');
      game.onSuperSpawn = (mobType) => {
        const label = mobType === 'Food' ? 'Decagon' : mobType;
        if (!chatEl) return;
        const line = document.createElement('div');
        line.className = 'chat-msg chat-msg-system';
        line.innerHTML = `<span style="color:${escapeHtml(RARITY_COLORS.super)}">${escapeHtml(`A Super ${label} Has Spawned!`)}</span>`;
        chatEl.appendChild(line);
        chatEl.scrollTop = chatEl.scrollHeight;
      };
      const savedState = (() => {
        try {
          const key = 'florexe_saved_progress_' + gamemode;
          const s = localStorage.getItem(key);
          if (s) {
            const o = JSON.parse(s);
            if (o && typeof o === 'object') return o;
          }
        } catch (e) {}
        return null;
      })();
      game.start(savedState).then(() => {
        requestAnimationFrame(() => {
          const elapsed = Date.now() - loadingShownAt;
          const minDisplay = 1200;
          const delay = Math.max(0, minDisplay - elapsed);
          setTimeout(() => {
            const el = document.getElementById('loading-screen');
            if (el) el.classList.add('hidden');
          }, delay);
        });
      });
      game.scale = Math.max(0.8, Math.min(canvas.width, canvas.height) / 720);

      const player = game.player;
      document.getElementById('hpBar').style.width = '100%';
      document.getElementById('hpText').textContent = `HP ${formatScore(player.hp)}/${formatScore(player.maxHp)}`;
      document.getElementById('level').textContent = `LV ${Math.round(player.level)}`;
      document.getElementById('xpBar').style.width = '0%';
      document.getElementById('xpText').textContent = `EXP ${formatScore(0)} / ${formatScore(100)}`;
      document.getElementById('stars').textContent = `★ ${Math.round(player.stars)}`;
      document.getElementById('score').textContent = `Score: ${formatScore(player.score)}`;

      const fireHint = document.getElementById('fireHint');
      if (fireHint) {
        fireHint.classList.remove('hidden');
        setTimeout(() => fireHint.classList.add('hidden'), 5000);
      }

      setupPlayerInput(player);
      setupHUD(player);
      setupCrafting(player);
      setupGallery(player);
      setupChat();

      lastTime = performance.now();
      if (animationId) cancelAnimationFrame(animationId);
      loop(performance.now());
    });
  });
}

let _keyDown, _keyUp, _wheelZoom, _keydownToggle, _onDragstartClearKeys;
let _autoAttackToastHideTimeout = null;

function showAutoAttackToast(isOn) {
  const el = document.getElementById('autoAttackToast');
  if (!el) return;
  el.textContent = `Auto-Attack (E): ${isOn ? 'On' : 'Off'}`;
  el.classList.remove('hidden');
  if (_autoAttackToastHideTimeout) clearTimeout(_autoAttackToastHideTimeout);
  _autoAttackToastHideTimeout = setTimeout(() => {
    el.classList.add('hidden');
    _autoAttackToastHideTimeout = null;
  }, 2500);
}

function setupPlayerInput(player) {
  if (_keyDown) document.removeEventListener('keydown', _keyDown);
  if (_keyUp) document.removeEventListener('keyup', _keyUp);
  if (_keydownToggle) document.removeEventListener('keydown', _keydownToggle);
  if (_onDragstartClearKeys) document.removeEventListener('dragstart', _onDragstartClearKeys);

  const keyHandler = (e, down) => {
    if (document.activeElement?.id === 'chatInput') return;
    const p = game?.player;
    if (!p) return;
    const k = e.key.toLowerCase();
    if (['w', 'a', 's', 'd'].includes(k)) {
      e.preventDefault();
      p.keys[k] = down;
    }
  };

  _keyDown = (e) => keyHandler(e, true);
  _keyUp = (e) => keyHandler(e, false);

  document.addEventListener('keydown', _keyDown);
  document.addEventListener('keyup', _keyUp);

  _keydownToggle = (e) => {
    if (document.activeElement?.id === 'chatInput') return;
    const k = e.key.toLowerCase();
    const inventoryContent = document.getElementById('inventoryBox')?.querySelector('.toggle-box-content');
    const craftingModal = document.getElementById('crafting-modal');
    const galleryModal = document.getElementById('mob-gallery-modal');
    const invOpen = inventoryContent && !inventoryContent.classList.contains('hidden');
    const craftOpen = craftingModal && !craftingModal.classList.contains('hidden');
    const galleryOpen = galleryModal && !galleryModal.classList.contains('hidden');

    if (k === 'g') {
      if (craftOpen) craftingModal.classList.add('hidden');
      if (invOpen && inventoryContent) inventoryContent.classList.add('hidden');
      if (galleryOpen) {
        galleryModal.classList.add('hidden');
      } else {
        renderMobGallery();
        galleryModal.classList.remove('hidden');
      }
      document.getElementById('chatInput')?.blur();
    } else if (k === 'z') {
      if (galleryOpen && galleryModal) galleryModal.classList.add('hidden');
      if (craftOpen) {
        craftingModal.classList.add('hidden');
      }
      if (inventoryContent) inventoryContent.classList.toggle('hidden');
      document.getElementById('chatInput')?.blur();
    } else if (k === 'c') {
      if (galleryOpen && galleryModal) galleryModal.classList.add('hidden');
      if (invOpen && inventoryContent) {
        inventoryContent.classList.add('hidden');
      }
      if (craftOpen) {
        craftingModal.classList.add('hidden');
      } else {
        document.getElementById('craftBoxTab')?.click();
      }
      document.getElementById('chatInput')?.blur();
    } else if (e.key === 'Escape') {
      if (craftOpen) {
        document.getElementById('craftClose')?.click();
      } else if (invOpen && inventoryContent) {
        inventoryContent.classList.add('hidden');
      } else if (galleryOpen && galleryModal) {
        galleryModal.classList.add('hidden');
      }
      document.getElementById('chatInput')?.blur();
    } else if (k === 'e') {
      const p = game?.player;
      if (p && !e.repeat) {
        p.autoAttack = !p.autoAttack;
        showAutoAttackToast(p.autoAttack);
      }
    }
  };
  document.addEventListener('keydown', _keydownToggle);

  _onDragstartClearKeys = () => {
    const p = game?.player;
    if (p && p.keys) {
      p.keys.w = false;
      p.keys.a = false;
      p.keys.s = false;
      p.keys.d = false;
    }
  };
  document.addEventListener('dragstart', _onDragstartClearKeys);

  const inventoryBoxTab = document.getElementById('inventoryBoxTab');
  if (inventoryBoxTab) {
    inventoryBoxTab.onclick = () => {
    const craftingModal = document.getElementById('crafting-modal');
    const galleryModal = document.getElementById('mob-gallery-modal');
    if (craftingModal && !craftingModal.classList.contains('hidden')) {
      craftingModal.classList.add('hidden');
    }
    if (galleryModal && !galleryModal.classList.contains('hidden')) {
      galleryModal.classList.add('hidden');
    }
    document.getElementById('inventoryBox')?.querySelector('.toggle-box-content').classList.toggle('hidden');
    document.getElementById('chatInput')?.blur();
    };
  }

  canvas.onmousemove = (e) => {
    const rect = canvas.getBoundingClientRect();
    const p = game?.player;
    if (p) {
      p.mouseX = e.clientX - rect.left - canvas.width / 2;
      p.mouseY = e.clientY - rect.top - canvas.height / 2;
    }
  };

  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0 && game?.player) game.player.mouseRightDown = true;
  });
  canvas.addEventListener('mouseup', (e) => {
    if (e.button === 0 && game?.player) game.player.mouseRightDown = false;
  });
  canvas.addEventListener('mouseleave', () => {
    if (game?.player) game.player.mouseRightDown = false;
  });

  if (typeof _wheelZoom === 'function') canvas.removeEventListener('wheel', _wheelZoom);
  _wheelZoom = (e) => {
    if (!game?.player) return;
    if (!isAdmin()) return; // Only admins can change view range by scrolling
    e.preventDefault();
    const factor = 1 - e.deltaY * 0.002;
    game.scale *= factor;
    if (game.scale < 0.01) game.scale = 0.01;
  };
  canvas.addEventListener('wheel', _wheelZoom, { passive: false });
}

const names = { base: 'Base', destroyer: 'Des', anchor: 'Anc', riot: 'Riot', overlord: 'Ovr', streamliner: 'Str', inferno: 'Inf', ziggurat: 'Zig', cutter: 'Cut', hive: 'Hive' };
const rShort = { common: 'C', uncommon: 'U', rare: 'R', epic: 'E', legendary: 'L', mythic: 'M', ultra: 'Ul', super: 'S' };

/** Data URI placeholder when rarity + fallback icon both fail to load (e.g. connection refused). Ensures Hive/Cutter/Anchor always show in inventory. */
function getPlaceholderIconDataUri(subtype) {
  const letter = (names[subtype] || subtype || '?').charAt(0);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="#444"/><text x="12" y="17" text-anchor="middle" fill="#aaa" font-size="14" font-family="sans-serif">${letter}</text></svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

/** Format item count: >999 shows as X.Xk (rounded to 1 decimal). */
function formatCount(n) {
  if (n > 999) return (Math.round(n / 100) / 10) + 'k';
  return String(n);
}

const SHOP_DAY_MS = 24 * 60 * 60 * 1000;
const SHOP_RARITIES = ['legendary', 'legendary', 'mythic', 'mythic', 'mythic', 'ultra', 'ultra', 'ultra', 'super', 'super'];

function seededRandom(seed) {
  return function () {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

function getShopOffers() {
  const day = Math.floor(Date.now() / SHOP_DAY_MS);
  const rng = seededRandom(day);
  // Pool: 10 unique (type, subtype) so no duplicate item (same subtype) in shop
  const pool = [
    ...GUN_SUBTYPES.map((subtype) => ({ type: 'tank', subtype })),
    ...BODY_SUBTYPES.map((subtype) => ({ type: 'body', subtype }))
  ];
  // Shuffle pool (Fisher–Yates)
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return SHOP_RARITIES.map((rarity, i) => ({ ...pool[i], rarity }));
}

function formatStars(n) {
  const s = Math.round(n);
  if (s >= 1e6) return (s / 1e6).toFixed(1) + 'm';
  if (s >= 1e3) return (s / 1e3).toFixed(1) + 'k';
  return String(s);
}

function openShop() {
  const modal = document.getElementById('shop-modal');
  const grid = document.getElementById('shopGrid');
  const timerEl = document.getElementById('shopTimer');
  const starsEl = document.getElementById('shopStarsCount');
  if (!modal || !grid) return;
  const p = game?.player;
  const offers = getShopOffers();
  const nextChange = (Math.floor(Date.now() / SHOP_DAY_MS) + 1) * SHOP_DAY_MS;
  const hoursLeft = Math.max(0, (nextChange - Date.now()) / 3600000);
  if (timerEl) timerEl.textContent = `Store will change in ${Math.round(hoursLeft)} hours`;
  if (starsEl) starsEl.textContent = formatStars(p?.stars ?? 0);
  grid.innerHTML = '';
  offers.forEach((item) => {
    const price = Number(SHOP_ITEM_PRICES[`${item.type}_${item.subtype}`]) || 0;
    const iconUrl = item.type === 'tank' ? getGunIconUrlByRarity(item.subtype, item.rarity) : getBodyIconUrlByRarity(item.subtype, item.rarity);
    const slot = document.createElement('div');
    slot.className = 'shop-slot';
    slot.innerHTML = `
      <div class="shop-slot-icon-wrap"><img src="${iconUrl || ''}" alt="" onerror="this.style.display='none'"></div>
      <button type="button" class="shop-slot-price-btn" data-price="${price}" data-type="${item.type}" data-subtype="${item.subtype}" data-rarity="${item.rarity}">★ ${formatStars(price)}</button>
    `;
    const btn = slot.querySelector('.shop-slot-price-btn');
    const canAfford = p && typeof p.stars === 'number' && p.stars >= price;
    btn.disabled = !canAfford;
    btn.onclick = () => {
      const pl = game?.player;
      if (!pl || pl.stars < price) return;
      pl.stars -= price;
      pl.inventory.push({ type: item.type, subtype: item.subtype, rarity: item.rarity });
      const starsDisplay = document.getElementById('stars');
      if (starsDisplay) starsDisplay.textContent = `★ ${formatStars(pl.stars)}`;
      if (document.getElementById('shopStarsCount')) document.getElementById('shopStarsCount').textContent = formatStars(pl.stars);
      btn.disabled = pl.stars < price;
      document.querySelectorAll('.shop-slot-price-btn').forEach(b => {
        const pr = Number(b.dataset.price);
        b.disabled = !Number.isFinite(pr) || pl.stars < pr;
      });
    };
    grid.appendChild(slot);
  });
  modal.classList.remove('hidden');
}

function closeShop() {
  document.getElementById('shop-modal')?.classList.add('hidden');
}

/** Effective count for display/craft: adminMode gives 99999 of each gun and each body. */
function getEffectiveInventoryCount(p, type, subtype, rarity) {
  if (!p) return 0;
  if (p.adminMode && type === 'tank') return 99999;
  if (p.adminMode && type === 'body') return 99999;
  return p.inventory.filter(i => i.type === type && i.subtype === subtype && i.rarity === rarity).length;
}

function slotLabel(item) {
  if (item && isRarityGunTank(item)) return '';
  if (item && item.type === 'body' && isCutterBody(item)) return '';
  return names[item?.subtype] || '?';
}

const ICON_SUBTYPES = { tank: GUN_SUBTYPES, body: BODY_SUBTYPES };

/** Body subtypes that use full-bleed rarity icon in slots (cutter, hive, inferno, ziggurat). */
function isCutterBody(item) {
  return item && item.type === 'body' && (item.subtype === 'cutter' || item.subtype === 'hive' || item.subtype === 'inferno' || item.subtype === 'ziggurat');
}

/** Tank subtypes that use full-bleed rarity icon in slots (anchor, destroyer, overlord). */
function isRarityGunTank(item) {
  return item && item.type === 'tank' && (item.subtype === 'anchor' || item.subtype === 'destroyer' || item.subtype === 'overlord' || item.subtype === 'riot' || item.subtype === 'streamliner' || item.subtype === 'base');
}

function getIconUrl(subtype, type, rarity = null) {
  if (!subtype) return null;
  const valid = ICON_SUBTYPES[type === 'tank' ? 'tank' : 'body'] || [];
  if (!valid.includes(subtype)) return null;
  return getTankAssetIconUrl(subtype, type, rarity);
}

let iconPreloaded = false;
function preloadIcons() {
  if (iconPreloaded) return;
  iconPreloaded = true;
  loadTankAssets();
}

const ICON_SIZE_HAND = 29;
const ICON_SIZE_INV = 24;

function slotInnerHTML(item, showLabel = true, size = ICON_SIZE_INV) {
  const label = showLabel && item ? slotLabel(item) : '';
  if (!item) return `<span class="slot-label">${label || '–'}</span>`;
  if (item.type === 'tank') {
    if (isRarityGunTank(item)) {
      const rarityUrl = getIconUrl(item.subtype, 'tank', item.rarity);
      const fallbackUrl = getGunIconUrl(item.subtype);
      const placeholder = getPlaceholderIconDataUri(item.subtype);
      if (!rarityUrl) return `<span class="slot-label">${label || '–'}</span>`;
      return `<div class="slot-cutter-fill"><img class="slot-icon-img slot-cutter-full" src="${rarityUrl}" onerror="if(this.dataset.fb!='1'){this.dataset.fb='1';this.src='${fallbackUrl}'}else{this.src='${placeholder}';this.onerror=null}" alt=""></div><span class="slot-label">${label}</span>`;
    }
    const bodyUrl = getBodyIconUrl('default');
    const gunUrl = getGunIconUrl(item.subtype);
    if (!gunUrl) return `<span class="slot-label">${label || '–'}</span>`;
    const wrap = (url, z) => `<div class="slot-icon-bg" style="position:absolute;top:0;left:0;width:100%;height:100%;background-image:url('${url}');background-size:contain;background-repeat:no-repeat;background-position:center;z-index:${z}"></div>`;
    const destroyerOrder = item.subtype === 'destroyer';
    const inner = destroyerOrder ? wrap(gunUrl, 1) + wrap(bodyUrl, 2) : wrap(bodyUrl, 1) + wrap(gunUrl, 2);
    return `<div class="slot-icon-wrap" style="position:relative;width:${size}px;height:${size}px">${inner}</div><span class="slot-label">${label}</span>`;
  }
  const rarityUrl = getBodyIconUrlByRarity(item.subtype, item.rarity);
  const fallbackUrl = getBodyIconUrl(item.subtype);
  const placeholder = getPlaceholderIconDataUri(item.subtype);
  if (!fallbackUrl) return `<span class="slot-label">${label || '–'}</span>`;
  const bodyLabel = isCutterBody(item) ? '' : label;
  if (isCutterBody(item)) {
    return `<div class="slot-cutter-fill"><img class="slot-icon-img slot-cutter-full" src="${rarityUrl}" onerror="if(this.dataset.fb!='1'){this.dataset.fb='1';this.src='${fallbackUrl}'}else{this.src='${placeholder}';this.onerror=null}" alt=""></div>${bodyLabel ? `<span class="slot-label">${bodyLabel}</span>` : ''}`;
  }
  return `<img class="slot-icon-img" src="${rarityUrl}" onerror="if(this.dataset.fb!='1'){this.dataset.fb='1';this.src='${fallbackUrl}'}else{this.src='${placeholder}';this.onerror=null}" width="${size}" height="${size}" alt=""><span class="slot-label">${label}</span>`;
}

/** Build tooltip HTML for a gun/body item. Item = { type: 'tank'|'body', subtype, rarity }. */
function getItemTooltipContent(item) {
  const r = item.rarity || 'common';
  const rarityLabel = r.charAt(0).toUpperCase() + r.slice(1);
  const rarityColor = getRarityColor(r);

  if (item.type === 'tank') {
    const t = TANK_UPGRADES[item.subtype];
    if (!t) return '';
    const name = (t.name || item.subtype);
    const damage = (t.damageByRarity && t.damageByRarity[r]) ?? 0;
    const stats = [];
    stats.push({ label: 'Damage', value: String(damage), cls: 'stat-damage' });
    if (t.reload != null) {
      const reloadSec = (t.reloadByRarity && t.reloadByRarity[r] != null) ? t.reloadByRarity[r] : t.reload;
      stats.push({ label: 'Reload', value: (reloadSec / 1000).toFixed(2) + 's', cls: 'stat-positive' });
    }
    if (item.subtype === 'destroyer' || item.subtype === 'streamliner') {
      const bulletSize = (t.bulletSizeByRarity && t.bulletSizeByRarity[r] != null) ? t.bulletSizeByRarity[r] : t.bulletSize;
      stats.push({ label: 'Bullet size', value: String(bulletSize), cls: 'stat-positive' });
      stats.push({ label: 'Bullet HP', value: String(t.bulletHp ?? 0), cls: 'stat-positive' });
    }
    if (item.subtype === 'anchor' || item.subtype === 'riot') {
      stats.push({ label: 'Trap HP', value: String(t.squareHp ?? 0), cls: 'stat-positive' });
      const dur = (item.subtype === 'anchor' && r === 'super' && t.squareDurationSuper) ? t.squareDurationSuper : (t.squareDurationSuper && r === 'super' ? t.squareDurationSuper : t.squareDuration);
      stats.push({ label: 'Trap duration', value: (dur / 1000).toFixed(1) + 's', cls: 'stat-positive' });
      stats.push({ label: 'Max traps', value: String(t.maxSquares ?? 0), cls: 'stat-positive' });
    }
    if (item.subtype === 'overlord') {
      const count = r === 'super' ? (t.droneCountSuper ?? t.droneCount) : r === 'ultra' ? (t.droneCountUltra ?? t.droneCount) : t.droneCount;
      stats.push({ label: 'Drone count', value: String(count), cls: 'stat-positive' });
      stats.push({ label: 'Drone HP', value: String(damage), cls: 'stat-positive' });
    }
    const statsHtml = stats.map(s => `<div class="item-tooltip-stat ${s.cls}">${escapeHtml(s.label)}: ${escapeHtml(s.value)}</div>`).join('');
    const descHtml = t.description ? `<div class="item-tooltip-desc">${escapeHtml(t.description)}</div>` : '';
    return `<div class="item-tooltip-name">${escapeHtml(name)}</div><div class="item-tooltip-rarity" style="color:${rarityColor}">${escapeHtml(rarityLabel)}</div>${descHtml}<div class="item-tooltip-stats">${statsHtml}</div>`;
  }

  if (item.type === 'body') {
    const b = BODY_UPGRADES[item.subtype];
    if (!b) return '';
    const name = (b.name || item.subtype);
    const stats = [];
    if (item.subtype === 'inferno') {
      const dmg = (b.damageByRarity && b.damageByRarity[r]) ?? 0;
      stats.push({ label: 'Damage/s', value: String(dmg), cls: 'stat-damage' });
      const mult = r === 'ultra' ? b.sizeMultUltra : r === 'super' ? b.sizeMultSuper : b.sizeMult;
      const radius = Math.round(INFERNO_BASE_RADIUS * (mult ?? 1));
      stats.push({ label: 'Fire radius', value: String(radius), cls: 'stat-positive' });
    }
    if (item.subtype === 'ziggurat') {
      const hp = (b.hpByRarity && b.hpByRarity[r]) ?? 0;
      stats.push({ label: 'Health', value: String(hp), cls: 'stat-positive' });
      stats.push({ label: 'Speed', value: Math.round((b.speedPenalty ?? 1) * 100) + '%', cls: 'stat-positive' });
    }
    if (item.subtype === 'cutter') {
      const speed = (b.speedByRarity && b.speedByRarity[r]) ?? 0;
      const attack = (b.attackByRarity && b.attackByRarity[r]) ?? 0;
      stats.push({ label: 'Speed', value: String(speed), cls: 'stat-positive' });
      stats.push({ label: 'Attack', value: String(attack), cls: 'stat-positive' });
    }
    if (item.subtype === 'hive') {
      const dmg = (b.damageByRarity && b.damageByRarity[r]) ?? 0;
      stats.push({ label: 'Damage', value: String(dmg), cls: 'stat-damage' });
      const spawners = (b.spawnersByRarity && b.spawnersByRarity[r]) ?? 0;
      stats.push({ label: 'Spawners', value: String(spawners), cls: 'stat-positive' });
      stats.push({ label: 'Spawn interval', value: (b.spawnInterval ?? 0) + 'ms', cls: 'stat-positive' });
    }
    const statsHtml = stats.map(s => `<div class="item-tooltip-stat ${s.cls}">${escapeHtml(s.label)}: ${escapeHtml(s.value)}</div>`).join('');
    const descHtml = b.description ? `<div class="item-tooltip-desc">${escapeHtml(b.description)}</div>` : '';
    return `<div class="item-tooltip-name">${escapeHtml(name)}</div><div class="item-tooltip-rarity" style="color:${rarityColor}">${escapeHtml(rarityLabel)}</div>${descHtml}<div class="item-tooltip-stats">${statsHtml}</div>`;
  }
  return '';
}

function setupHUD(player) {
  const handTank = document.getElementById('handTank');
  const handBody = document.getElementById('handBody');
  const gunSlots = document.getElementById('gunSlots');
  const bodySlots = document.getElementById('bodySlots');
  const itemTooltip = document.getElementById('itemDetailTooltip');
  const TOOLTIP_OFFSET = 14;

  const saveExitBtn = document.getElementById('saveExitBtn');
  if (saveExitBtn) {
    saveExitBtn.onclick = () => {
      if (!game?.player) return;
      const p = game.player;
      const savedState = {
        inventory: Array.isArray(p.inventory) ? p.inventory.slice() : [],
        hand: Array.isArray(p.hand) ? p.hand.slice() : [],
        equippedTank: p.equippedTank && typeof p.equippedTank === 'object' ? { ...p.equippedTank } : null,
        equippedBody: p.equippedBody && typeof p.equippedBody === 'object' ? { ...p.equippedBody } : null,
        level: typeof p.level === 'number' ? p.level : 1,
        xp: typeof p.xp === 'number' ? p.xp : 0,
        stars: typeof p.stars === 'number' ? p.stars : 0
      };
      try {
        localStorage.setItem('florexe_saved_progress_' + game.gamemode, JSON.stringify(savedState));
      } catch (e) {}
      game.running = false;
      mainMenu.classList.remove('hidden');
      gameContainer.classList.add('hidden');
    };
  }

  function showItemTooltip(item, e) {
    if (!itemTooltip || !item || !item.subtype) return;
    const html = getItemTooltipContent(item);
    if (!html) return;
    itemTooltip.innerHTML = html;
    itemTooltip.classList.remove('hidden');
    const x = e.clientX ?? 0;
    const y = e.clientY ?? 0;
    const rect = itemTooltip.getBoundingClientRect();
    let left = x + TOOLTIP_OFFSET;
    let top = y + TOOLTIP_OFFSET;
    if (left + rect.width > window.innerWidth) left = x - rect.width - TOOLTIP_OFFSET;
    if (top + rect.height > window.innerHeight) top = window.innerHeight - rect.height - 8;
    if (left < 8) left = 8;
    if (top < 8) top = 8;
    itemTooltip.style.left = left + 'px';
    itemTooltip.style.top = top + 'px';
  }

  function hideItemTooltip() {
    if (itemTooltip) itemTooltip.classList.add('hidden');
  }

  function equipItem(p, slotType, itemOrKey) {
    if (slotType === 'tank' && p.adminMode && itemOrKey?.subtype && itemOrKey?.rarity) {
      const old = p.equippedTank;
      if (old && (old.subtype === 'riot' || old.subtype === 'anchor')) {
        for (const sq of p.squares) sq.duration = 0;
      }
      p.equippedTank = { type: 'tank', subtype: itemOrKey.subtype, rarity: itemOrKey.rarity };
      p.applyStats();
      return;
    }
    if (slotType === 'body' && p.adminMode && itemOrKey?.subtype && itemOrKey?.rarity) {
      p.equippedBody = { type: 'body', subtype: itemOrKey.subtype, rarity: itemOrKey.rarity };
      p.applyStats();
      return;
    }
    const item = p.inventory.find(i => i.type === slotType && i.subtype === itemOrKey?.subtype && i.rarity === itemOrKey?.rarity);
    if (!item || item.type !== slotType) return;
    if (slotType === 'tank') {
      const old = p.equippedTank;
      if (old && (old.subtype === 'riot' || old.subtype === 'anchor')) {
        for (const sq of p.squares) sq.duration = 0;
      }
      p.equippedTank = item;
      const idx = p.inventory.indexOf(item);
      if (idx >= 0 && !p.adminMode) p.inventory.splice(idx, 1);
      if (old) p.inventory.push(old);
    } else {
      const old = p.equippedBody;
      p.equippedBody = item;
      const idx = p.inventory.indexOf(item);
      if (idx >= 0 && !p.adminMode) p.inventory.splice(idx, 1);
      if (old) p.inventory.push(old);
    }
    p.applyStats();
  }

  handTank.onclick = () => {
    const p = game?.player;
    if (p?.equippedTank) unequip(p, 'tank');
  };
  handTank.ondragenter = (e) => { e.preventDefault(); handTank.classList.add('drag-over'); };
  handTank.ondragover = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; handTank.classList.add('drag-over'); };
  handTank.ondragleave = (e) => { if (handTank.contains(e.relatedTarget)) return; handTank.classList.remove('drag-over'); };
  handTank.ondrop = (e) => {
    e.preventDefault();
    handTank.classList.remove('drag-over');
    const data = e.dataTransfer.getData('application/json') || e.dataTransfer.getData('text/plain');
    if (data && game?.player) {
      try {
        const parsed = JSON.parse(data);
        if (parsed.type === 'tank') equipItem(game.player, 'tank', parsed);
      } catch (_) {}
    }
  };

  handBody.onclick = () => {
    const p = game?.player;
    if (p?.equippedBody) unequip(p, 'body');
  };
  handBody.ondragenter = (e) => { e.preventDefault(); handBody.classList.add('drag-over'); };
  handBody.ondragover = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; handBody.classList.add('drag-over'); };
  handBody.ondragleave = (e) => { if (handBody.contains(e.relatedTarget)) return; handBody.classList.remove('drag-over'); };
  handBody.ondrop = (e) => {
    e.preventDefault();
    handBody.classList.remove('drag-over');
    const data = e.dataTransfer.getData('application/json') || e.dataTransfer.getData('text/plain');
    if (data && game?.player) {
      try {
        const parsed = JSON.parse(data);
        if (parsed.type === 'body') equipItem(game.player, 'body', parsed);
      } catch (_) {}
    }
  };

  function unequip(p, slotType) {
    const defaultTank = { type: 'tank', subtype: 'base', rarity: 'common' };
    if (slotType === 'tank' && p.equippedTank) {
      if (p.equippedTank.subtype === 'riot' || p.equippedTank.subtype === 'anchor') {
        for (const sq of p.squares) sq.duration = 0;
      }
      if (p.equippedTank.subtype !== 'base' && !p.adminMode) p.inventory.push(p.equippedTank);
      p.equippedTank = defaultTank;
    } else if (slotType === 'body' && p.equippedBody) {
      if (!p.adminMode) p.inventory.push(p.equippedBody);
      p.equippedBody = null;
    }
    p.applyStats();
  }

  const gunColumn = gunSlots.closest('.inventory-column');
  const bodyColumn = bodySlots.closest('.inventory-column');
  gunSlots.ondragenter = (e) => { e.preventDefault(); gunColumn?.classList.add('drag-over'); };
  gunSlots.ondragover = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; gunColumn?.classList.add('drag-over'); };
  gunSlots.ondragleave = (e) => { if (gunColumn?.contains(e.relatedTarget)) return; gunColumn?.classList.remove('drag-over'); };
  gunSlots.ondrop = (e) => {
    e.preventDefault();
    gunColumn?.classList.remove('drag-over');
    const data = e.dataTransfer.getData('application/json') || e.dataTransfer.getData('text/plain');
    if (data && game?.player) {
      try {
        const item = JSON.parse(data);
        if (item.type === 'tank') unequip(game.player, 'tank');
      } catch (_) {}
    }
  };

  bodySlots.ondragenter = (e) => { e.preventDefault(); bodyColumn?.classList.add('drag-over'); };
  bodySlots.ondragover = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; bodyColumn?.classList.add('drag-over'); };
  bodySlots.ondragleave = (e) => { if (bodyColumn?.contains(e.relatedTarget)) return; bodyColumn?.classList.remove('drag-over'); };
  bodySlots.ondrop = (e) => {
    e.preventDefault();
    bodyColumn?.classList.remove('drag-over');
    const data = e.dataTransfer.getData('application/json') || e.dataTransfer.getData('text/plain');
    if (data && game?.player) {
      try {
        const item = JSON.parse(data);
        if (item.type === 'body') unequip(game.player, 'body');
      } catch (_) {}
    }
  };

  const updateHUD = () => {
    if (!game?.player || game.player.dead) return;
    const p = game.player;

    const hpPct = (p.hp / p.maxHp) * 100;
    document.getElementById('hpBar').style.width = `${hpPct}%`;
    document.getElementById('hpText').textContent = `HP ${formatScore(p.hp)}/${formatScore(p.maxHp)}`;
    document.getElementById('level').textContent = `Level ${Math.round(p.level)} ${getEquippedTankName(p)}`;
    const xpForNext = p.level < 100 ? (50 * Math.pow(1.15, p.level)) : 0;
    const xpPct = xpForNext > 0 ? (p.xp / xpForNext) * 100 : 100;
    document.getElementById('xpBar').style.width = `${xpPct}%`;
    document.getElementById('xpText').textContent = `EXP ${formatScore(p.xp)} / ${formatScore(xpForNext)}`;
    document.getElementById('stars').textContent = `★ ${Math.round(p.stars)}`;
    document.getElementById('score').textContent = `Score: ${formatScore(p.score)}`;

  handTank.innerHTML = p.equippedTank ? slotInnerHTML(p.equippedTank, true, ICON_SIZE_HAND) : '–';
  const tankRarityGun = p.equippedTank && isRarityGunTank(p.equippedTank);
  handTank.style.backgroundColor = tankRarityGun ? 'transparent' : (p.equippedTank ? getRarityColor(p.equippedTank.rarity) : 'rgba(0,0,0,0.4)');
  handTank.style.borderColor = tankRarityGun ? 'transparent' : (p.equippedTank ? darkenColor(getRarityColor(p.equippedTank.rarity), 60) : '#444');
    handTank.classList.toggle('equipped', !!p.equippedTank);
    handTank.draggable = !!p.equippedTank;
    handTank.title = p.equippedTank ? `Tank: ${p.equippedTank.subtype} (${p.equippedTank.rarity})` : 'Drop gun here';
    handTank.onmouseleave = hideItemTooltip;
    if (p.equippedTank) {
      handTank.onmouseenter = (e) => showItemTooltip({ ...p.equippedTank, type: 'tank' }, e);
      handTank.ondragstart = (e) => {
        const json = JSON.stringify({ ...p.equippedTank, type: 'tank' });
        e.dataTransfer.setData('application/json', json);
        e.dataTransfer.setData('text/plain', json);
        e.dataTransfer.effectAllowed = 'move';
      };
    } else {
      handTank.onmouseenter = null;
    }

    handBody.innerHTML = p.equippedBody ? slotInnerHTML(p.equippedBody, true, ICON_SIZE_HAND) : '–';
    handBody.style.backgroundColor = p.equippedBody && !isCutterBody(p.equippedBody) ? getRarityColor(p.equippedBody.rarity) : 'transparent';
    handBody.style.borderColor = p.equippedBody && !isCutterBody(p.equippedBody) ? darkenColor(getRarityColor(p.equippedBody.rarity), 60) : 'transparent';
    handBody.classList.toggle('equipped', !!p.equippedBody);
    handBody.draggable = !!p.equippedBody;
    handBody.title = p.equippedBody ? `Body: ${p.equippedBody.subtype} (${p.equippedBody.rarity})` : 'Drop body here';
    handBody.onmouseleave = hideItemTooltip;
    if (p.equippedBody) {
      handBody.onmouseenter = (e) => showItemTooltip({ ...p.equippedBody, type: 'body' }, e);
      handBody.ondragstart = (e) => {
        const json = JSON.stringify({ ...p.equippedBody, type: 'body' });
        e.dataTransfer.setData('application/json', json);
        e.dataTransfer.setData('text/plain', json);
        e.dataTransfer.effectAllowed = 'move';
      };
    } else {
      handBody.onmouseenter = null;
    }

    function groupByTypeSubtypeRarity(items, type) {
      const filtered = items.filter(i => i.type === type);
      const groups = new Map();
      for (const item of filtered) {
        const key = `${item.subtype}|${item.rarity}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(item);
      }
      return groups;
    }

    let gunGroups = groupByTypeSubtypeRarity(p.inventory, 'tank');
    if (p.adminMode) {
      for (const subtype of GUN_SUBTYPES) {
        for (const rarity of RARITIES) {
          const key = `${subtype}|${rarity}`;
          if (!gunGroups.has(key)) gunGroups.set(key, [{ type: 'tank', subtype, rarity }]);
        }
      }
    }

    function sortInventoryEntries(entries) {
      return entries.sort((a, b) => {
        const [subA, rarA] = a[0].split('|');
        const [subB, rarB] = b[0].split('|');
        const rarIdxA = RARITIES.indexOf(rarA);
        const rarIdxB = RARITIES.indexOf(rarB);
        if (rarIdxA !== rarIdxB) return rarIdxB - rarIdxA;
        return (subA || '').localeCompare(subB || '');
      });
    }

    const bodyGroups = groupByTypeSubtypeRarity(p.inventory, 'body');
    let bodyGroupsExpanded = bodyGroups;
    if (p.adminMode) {
      bodyGroupsExpanded = new Map(bodyGroups);
      for (const subtype of BODY_SUBTYPES) {
        for (const rarity of RARITIES) {
          const key = `${subtype}|${rarity}`;
          if (!bodyGroupsExpanded.has(key)) bodyGroupsExpanded.set(key, [{ type: 'body', subtype, rarity }]);
        }
      }
    }
    const sortedGunEntries = sortInventoryEntries([...gunGroups.entries()]);
    const sortedBodyEntries = sortInventoryEntries([...bodyGroupsExpanded.entries()]);

    gunSlots.innerHTML = '';
    sortedGunEntries.forEach(([key, items]) => {
      const item = items[0];
      const count = getEffectiveInventoryCount(p, 'tank', item.subtype, item.rarity);
      const countStr = formatCount(count);
      const slot = document.createElement('div');
      const isRarityGun = isRarityGunTank({ ...item, type: 'tank' });
      slot.className = 'inventory-slot' + (isRarityGun ? ' slot-cutter-as-box' : '');
      slot.style.backgroundColor = isRarityGun ? 'transparent' : getRarityColor(item.rarity);
      slot.style.borderColor = isRarityGun ? 'transparent' : getRarityColor(item.rarity);
      slot.innerHTML = slotInnerHTML({ ...item, type: 'tank' }, true, ICON_SIZE_INV) + (count > 1 ? `<span class="stack-count">×${countStr}</span>` : '');
      slot.title = `${item.subtype} (${item.rarity})${count > 1 ? ` ×${countStr}` : ''} - Click to equip`;
      slot.draggable = true;
      slot.onmouseenter = (e) => showItemTooltip({ type: 'tank', subtype: item.subtype, rarity: item.rarity }, e);
      slot.onmouseleave = hideItemTooltip;
      slot.onclick = () => equipItem(p, 'tank', item);
      slot.ondragstart = (e) => {
        const json = JSON.stringify({ type: 'tank', subtype: item.subtype, rarity: item.rarity });
        e.dataTransfer.setData('application/json', json);
        e.dataTransfer.setData('text/plain', json);
        e.dataTransfer.effectAllowed = 'move';
        slot.classList.add('dragging');
      };
      slot.ondragend = () => slot.classList.remove('dragging');
      gunSlots.appendChild(slot);
    });

    bodySlots.innerHTML = '';
    sortedBodyEntries.forEach(([key, items]) => {
      const item = items[0];
      const count = getEffectiveInventoryCount(p, 'body', item.subtype, item.rarity);
      const countStr = formatCount(count);
      const slot = document.createElement('div');
      slot.className = 'inventory-slot' + (isCutterBody({ ...item, type: 'body' }) ? ' slot-cutter-as-box' : '');
      slot.style.backgroundColor = isCutterBody({ ...item, type: 'body' }) ? 'transparent' : getRarityColor(item.rarity);
      slot.style.borderColor = isCutterBody({ ...item, type: 'body' }) ? 'transparent' : getRarityColor(item.rarity);
      slot.innerHTML = slotInnerHTML({ ...item, type: 'body' }, true, ICON_SIZE_INV) + (count > 1 ? `<span class="stack-count">×${countStr}</span>` : '');
      slot.title = `${item.subtype} (${item.rarity})${count > 1 ? ` ×${countStr}` : ''} - Click to equip`;
      slot.draggable = true;
      slot.onmouseenter = (e) => showItemTooltip({ type: 'body', subtype: item.subtype, rarity: item.rarity }, e);
      slot.onmouseleave = hideItemTooltip;
      slot.onclick = () => equipItem(p, 'body', item);
      slot.ondragstart = (e) => {
        const json = JSON.stringify({ type: 'body', subtype: item.subtype, rarity: item.rarity });
        e.dataTransfer.setData('application/json', json);
        e.dataTransfer.setData('text/plain', json);
        e.dataTransfer.effectAllowed = 'move';
        slot.classList.add('dragging');
      };
      slot.ondragend = () => slot.classList.remove('dragging');
      bodySlots.appendChild(slot);
    });
  };

  setInterval(updateHUD, 100);
}

/** Mob categories: "food" always first row, rest alphabetized. Add more later for other mob types. */
const MOB_CATEGORIES = [
  { id: 'food', label: 'Food' },
  // Add more categories here later; they will appear alphabetically after Food.
];

function renderMobGallery() {
  const grid = document.getElementById('mobGalleryGrid');
  const p = game?.player;
  if (!grid || !p) return;
  // Food first, then rest alphabetically by label
  const categories = [...MOB_CATEGORIES].sort((a, b) => {
    if (a.id === 'food') return -1;
    if (b.id === 'food') return 1;
    return (a.label || a.id).localeCompare(b.label || b.id);
  });
  grid.innerHTML = '';
  grid.style.gridTemplateColumns = `repeat(${RARITIES.length}, 1fr)`;
  grid.style.gridTemplateRows = `repeat(${categories.length}, 1fr)`;
  for (let row = 0; row < categories.length; row++) {
    const category = categories[row];
    for (let col = 0; col < RARITIES.length; col++) {
      const rarity = RARITIES[col];
      const slot = document.createElement('div');
      slot.className = 'mob-gallery-slot';
      if (category.id === 'food') {
        const count = (p.mobKills && p.mobKills[rarity]) ?? 0;
        if (count > 0) {
          slot.classList.add('filled');
          slot.dataset.rarity = rarity;
          slot.dataset.category = 'food';
          slot.style.background = getRarityColor(rarity);
          slot.style.borderColor = darkenColor(getRarityColor(rarity), 40);
          const cfg = FOOD_CONFIG[rarity];
          const sides = cfg.sides || 3;
          const fillColor = getRarityColor(rarity);
          const strokeColor = darkenColor(fillColor, 50);
          const shapeSrc = getMobShapeSvgDataUrl(sides, fillColor, strokeColor);
          slot.innerHTML = `<span class="mob-gallery-xcount">x${formatCount(count)}</span><img class="mob-gallery-shape-img" src="${shapeSrc}" alt="" />`;
        }
      }
      grid.appendChild(slot);
    }
  }
  bindMobGalleryTooltip();
}

const MOB_DESCRIPTIONS = {
  triangle: 'A basic shape. Low threat.',
  square: 'Four sides. Moderate threat.',
  pentagon: 'Five sides. Watch out.',
  hexagon: 'Six sides. Strong.',
  septagon: 'Seven sides. Very dangerous.',
  octagon: 'Eight sides. Elite tier.',
  nonagon: 'Nine sides. Extreme threat.',
  decagon: 'Ten sides. Boss-level.',
};

function bindMobGalleryTooltip() {
  const grid = document.getElementById('mobGalleryGrid');
  const tooltip = document.getElementById('mobGalleryTooltip');
  const p = game?.player;
  if (!grid || !tooltip || !p) return;
  grid.removeEventListener('mouseenter', _mobGalleryTooltipEnter, true);
  grid.removeEventListener('mouseleave', _mobGalleryTooltipLeave, true);
  function showTooltip(slot) {
    const rarity = slot.dataset.rarity;
    if (!rarity || !FOOD_CONFIG[rarity]) return;
    const cfg = FOOD_CONFIG[rarity];
    const shapeName = cfg.shape;
    const name = shapeName.charAt(0).toUpperCase() + shapeName.slice(1);
    const count = (p.mobKills && p.mobKills[rarity]) ?? 0;
    const rarityLabel = rarity.charAt(0).toUpperCase() + rarity.slice(1);
    const desc = MOB_DESCRIPTIONS[shapeName] || 'A shape from the arena.';
    const drops = cfg.drops || {};
    const dropRows = Object.entries(drops)
      .filter(([, pct]) => pct > 0)
      .map(([r, pct]) => ({ rarity: r, pct: (pct * 100).toFixed(1) }))
      .sort((a, b) => parseFloat(b.pct) - parseFloat(a.pct));
    const dropHtml = dropRows.length
      ? `<div class="mob-tooltip-drops-title">Item droprates</div>${dropRows.map((d) => `<div class="mob-tooltip-drop-row"><span style="color:${getRarityColor(d.rarity)}">${d.rarity.charAt(0).toUpperCase() + d.rarity.slice(1)}</span><span>${d.pct}%</span></div>`).join('')}`
      : '';
    tooltip.innerHTML = `
      <div class="mob-tooltip-name">${name} x${formatCount(count)}</div>
      <div class="mob-tooltip-rarity" style="color:${getRarityColor(rarity)}">${rarityLabel}</div>
      <div class="mob-tooltip-desc">${desc}</div>
      <div class="mob-tooltip-stats">
        <div style="color:#81c784">Health: ${cfg.hp}</div>
        <div style="color:#e57373">Damage: ${cfg.damage}</div>
        <div>Armor: 0</div>
      </div>
      <div class="mob-tooltip-drops">${dropHtml}</div>
    `;
    tooltip.classList.remove('hidden');
    const rect = slot.getBoundingClientRect();
    const panelRect = slot.closest('.mob-gallery-panel')?.getBoundingClientRect();
    if (!panelRect) return;
    const ttRect = tooltip.getBoundingClientRect();
    let left = rect.right - panelRect.left + 8;
    let top = rect.top - panelRect.top;
    if (left + ttRect.width > panelRect.width - 16) left = rect.left - panelRect.left - ttRect.width - 8;
    if (top + ttRect.height > panelRect.height - 16) top = panelRect.height - ttRect.height - 16;
    if (top < 8) top = 8;
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }
  function _mobGalleryTooltipEnter(e) {
    const slot = e.target.closest('.mob-gallery-slot.filled');
    if (slot) showTooltip(slot);
  }
  function _mobGalleryTooltipLeave(e) {
    const slot = e.target.closest('.mob-gallery-slot.filled');
    const related = e.relatedTarget;
    if (!slot || (related && !related.closest('.mob-gallery-tooltip') && !related.closest('.mob-gallery-slot.filled'))) {
      tooltip.classList.add('hidden');
    }
  }
  grid.addEventListener('mouseenter', _mobGalleryTooltipEnter, true);
  grid.addEventListener('mouseleave', _mobGalleryTooltipLeave, true);
}

function setupGallery(player) {
  const galleryModal = document.getElementById('mob-gallery-modal');
  const galleryClose = document.getElementById('mobGalleryClose');
  const tooltip = document.getElementById('mobGalleryTooltip');
  const galleryBoxTab = document.getElementById('galleryBoxTab');
  if (!galleryModal || !galleryClose) return;
  galleryClose.onclick = () => galleryModal.classList.add('hidden');
  galleryModal.onclick = (e) => {
    if (e.target === galleryModal) galleryModal.classList.add('hidden');
  };
  if (tooltip) tooltip.addEventListener('mouseleave', () => tooltip.classList.add('hidden'));
  if (galleryBoxTab) {
    galleryBoxTab.onclick = () => {
      const craftingModal = document.getElementById('crafting-modal');
      const inventoryContent = document.getElementById('inventoryBox')?.querySelector('.toggle-box-content');
      if (craftingModal && !craftingModal.classList.contains('hidden')) craftingModal.classList.add('hidden');
      if (inventoryContent && !inventoryContent.classList.contains('hidden')) inventoryContent.classList.add('hidden');
      if (galleryModal.classList.contains('hidden')) {
        renderMobGallery();
        galleryModal.classList.remove('hidden');
      } else {
        galleryModal.classList.add('hidden');
      }
      document.getElementById('chatInput')?.blur();
    };
  }
}

function setupCrafting(player) {
  const modal = document.getElementById('crafting-modal');
  const slotsContainer = document.getElementById('craftSlots');
  const pentagonWrap = slotsContainer.parentElement;
  const chanceEl = document.getElementById('craftChance');
  const craftConfirm = document.getElementById('craftConfirm');
  const craftClose = document.getElementById('craftClose');
  const craftBoxTab = document.getElementById('craftBoxTab');
  const craftResultSlot = document.getElementById('craftResultSlot');
  const craftResultIcon = document.getElementById('craftResultIcon');
  const craftResultName = document.getElementById('craftResultName');
  const craftInventoryGrid = document.getElementById('craftInventoryGrid');
  let craftSelection = Array(5).fill(null).map(() => ({ type: null, subtype: null, rarity: null, count: 0 }));
  let craftState = 'idle'; // 'idle' | 'animating' | 'success' | 'failed'
  let craftResultItem = null;
  let craftResultCount = 1;

  function totalInSelection(type, subtype, rarity) {
    return craftSelection.reduce((sum, s) => (s.type === type && s.subtype === subtype && s.rarity === rarity ? s.count : 0) + sum, 0);
  }

  function clearSlots() {
    craftSelection = Array(5).fill(null).map(() => ({ type: null, subtype: null, rarity: null, count: 0 }));
  }

  function closeModal() {
    if (craftState === 'success' && craftResultItem) {
      const p = game?.player;
      if (p) {
        const count = typeof craftResultCount === 'number' ? craftResultCount : 1;
        for (let i = 0; i < count; i++) {
          p.inventory.push({ ...craftResultItem });
        }
        craftResultItem = null;
        craftResultCount = 1;
        craftState = 'idle';
      }
    }
    modal.classList.add('hidden');
  }

  const openCraftModal = () => {
    const inventoryContent = document.getElementById('inventoryBox')?.querySelector('.toggle-box-content');
    const galleryModal = document.getElementById('mob-gallery-modal');
    if (inventoryContent) inventoryContent.classList.add('hidden');
    if (galleryModal && !galleryModal.classList.contains('hidden')) galleryModal.classList.add('hidden');
    document.getElementById('chatInput')?.blur();
    craftState = 'idle';
    craftResultItem = null;
    craftResultCount = 1;
    clearSlots();
    renderCraftModal();
    modal.classList.remove('hidden');
  };
  if (craftBoxTab) craftBoxTab.onclick = openCraftModal;
  craftClose.onclick = closeModal;
  modal.onclick = (e) => { if (e.target === modal) closeModal(); };

  function addToCraft(item) {
    if (craftState !== 'idle') return;
    const p = game?.player;
    if (!p) return;
    const inInv = getEffectiveInventoryCount(p, item.type, item.subtype, item.rarity);
    const inSelection = totalInSelection(item.type, item.subtype, item.rarity);
    if (inInv <= inSelection) return;
    // Clockwise order: top (0), right-top (1), right-bottom (2), left-bottom (3), left-top (4)
    const clockwiseOrder = [0, 1, 2, 3, 4];
    const emptySlot = clockwiseOrder.find(i => craftSelection[i].count === 0);
    if (emptySlot !== undefined) {
      const slot = craftSelection[emptySlot];
      slot.type = item.type;
      slot.subtype = item.subtype;
      slot.rarity = item.rarity;
      slot.count = 1;
    } else {
      // All slots filled — add to slot with same type and smallest count to keep even
      let minIdx = -1;
      let minCount = Infinity;
      for (let i = 0; i < 5; i++) {
        const s = craftSelection[i];
        if (s.type === item.type && s.subtype === item.subtype && s.rarity === item.rarity && s.count < minCount) {
          minCount = s.count;
          minIdx = i;
        }
      }
      if (minIdx < 0) return; // all slots have different type, can't add
      craftSelection[minIdx].count++;
    }
    renderCraftModal();
  }

  function addToCraftMax(item) {
    if (craftState !== 'idle') return;
    const p = game?.player;
    if (!p) return;
    const inInv = getEffectiveInventoryCount(p, item.type, item.subtype, item.rarity);
    const inSelection = totalInSelection(item.type, item.subtype, item.rarity);
    const available = inInv - inSelection;
    const perSlot = Math.floor(available / 5);
    if (perSlot < 1) return;
    // Fill in clockwise order: top (0), right-top (1), right-bottom (2), left-bottom (3), left-top (4)
    for (let i = 0; i < 5; i++) {
      craftSelection[i].type = item.type;
      craftSelection[i].subtype = item.subtype;
      craftSelection[i].rarity = item.rarity;
      craftSelection[i].count = perSlot;
    }
    renderCraftModal();
  }

  function getRecipe() {
    const first = craftSelection[0];
    if (!first || first.count < 1) return null;
    const same = craftSelection.every(s => s.count >= 1 && s.type === first.type && s.subtype === first.subtype && s.rarity === first.rarity);
    if (!same) return null;
    const p = game?.player;
    if (!p) return null;
    const invCount = getEffectiveInventoryCount(p, first.type, first.subtype, first.rarity);
    if (invCount < 5) return null;
    const nextIdx = RARITIES.indexOf(first.rarity) + 1;
    if (nextIdx >= RARITIES.length) return null;
    const nextRarity = RARITIES[nextIdx];
    const chance = CRAFT_CHANCES[first.rarity] ?? 0;
    return { item: { type: first.type, subtype: first.subtype, rarity: first.rarity }, nextRarity, chance };
  }

  const CRAFT_SPIRAL_MS = 520;

  function playCraftSuccessParticles(rarityColor) {
    if (!pentagonWrap || !rarityColor) return;
    const wrap = document.createElement('div');
    wrap.className = 'craft-particles-wrap';
    const count = 18;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * 2 * Math.PI + Math.random() * 0.4;
      const dist = 55 + Math.random() * 45;
      const x = Math.cos(angle) * dist;
      const y = Math.sin(angle) * dist;
      const p = document.createElement('div');
      p.className = 'craft-particle';
      p.style.background = rarityColor;
      p.style.setProperty('--particle-x', x + 'px');
      p.style.setProperty('--particle-y', y + 'px');
      p.style.animationDelay = (Math.random() * 0.08) + 's';
      wrap.appendChild(p);
    }
    pentagonWrap.appendChild(wrap);
    setTimeout(() => { wrap.remove(); }, 700);
  }

  function runSpinThenSpiralThenResolve(recipe, success, giveBack, totalCount, batchSize, bulkSuccessCount, bulkLeftover) {
    const p = game?.player;
    if (!p) return;
    const loopMs = (totalCount != null && totalCount >= 500) ? 3000 : (2000 + Math.random() * 1000);
    slotsContainer.classList.add('craft-spiral-loop');
    craftConfirm.disabled = true;
    setTimeout(() => {
      slotsContainer.classList.remove('craft-spiral-loop');
      slotsContainer.classList.add('craft-spiral');
      setTimeout(() => {
        slotsContainer.classList.remove('craft-spiral');
        if (bulkSuccessCount != null && bulkSuccessCount > 0) {
          craftResultItem = { type: recipe.item.type, subtype: recipe.item.subtype, rarity: recipe.nextRarity };
          craftResultCount = bulkSuccessCount;
          clearSlots();
          craftState = 'success';
          renderCraftModal();
          playCraftSuccessParticles(getRarityColor(recipe.nextRarity));
        } else if (bulkLeftover != null && bulkLeftover > 0) {
          clearSlots();
          for (let i = 0; i < bulkLeftover; i++) {
            craftSelection[i].type = recipe.item.type;
            craftSelection[i].subtype = recipe.item.subtype;
            craftSelection[i].rarity = recipe.item.rarity;
            craftSelection[i].count = 1;
          }
          craftState = 'failed';
        } else if (batchSize != null && batchSize > 1) {
          let successCount = 0;
          for (let i = 0; i < batchSize; i++) {
            if (Math.random() < recipe.chance) successCount++;
          }
          if (successCount > 0) {
            craftResultItem = { type: recipe.item.type, subtype: recipe.item.subtype, rarity: recipe.nextRarity };
            craftResultCount = successCount;
            clearSlots();
            craftState = 'success';
            renderCraftModal();
            playCraftSuccessParticles(getRarityColor(recipe.nextRarity));
          } else {
            clearSlots();
            craftState = 'failed';
          }
        } else if (success) {
          craftResultItem = { type: recipe.item.type, subtype: recipe.item.subtype, rarity: recipe.nextRarity };
          craftResultCount = 1;
          clearSlots();
          craftState = 'success';
          renderCraftModal();
          playCraftSuccessParticles(getRarityColor(recipe.nextRarity));
        } else {
          clearSlots();
          for (let i = 0; i < giveBack; i++) {
            craftSelection[i].type = recipe.item.type;
            craftSelection[i].subtype = recipe.item.subtype;
            craftSelection[i].rarity = recipe.item.rarity;
            craftSelection[i].count = 1;
          }
          craftState = 'failed';
        }
        renderCraftModal();
      }, CRAFT_SPIRAL_MS);
    }, loopMs);
  }

  function performCraft() {
    const recipe = getRecipe();
    if (!recipe) return;
    const p = game?.player;
    if (!p) return;
    const totalCount = craftSelection.reduce((sum, s) => sum + (s.count || 0), 0);
    const batchSize = craftSelection[0]?.count || 0;

    if (batchSize > 1) {
      const { type, subtype, rarity } = recipe.item;
      const initialInvCount = p.inventory.filter(it => it.type === type && it.subtype === subtype && it.rarity === rarity).length;
      let onTable = 5 * batchSize;
      let invCount = initialInvCount;
      let successCount = 0;

      while (onTable >= 5) {
        onTable -= 5;
        const success = Math.random() < recipe.chance;
        if (success) {
          successCount++;
        } else {
          const giveBack = 1 + Math.floor(Math.random() * 4);
          onTable += giveBack;
        }
        while (onTable < 5 && invCount > 0) {
          const need = 5 - onTable;
          const take = Math.min(need, invCount);
          invCount -= take;
          onTable += take;
        }
      }

      const toRemoveFromInv = initialInvCount - invCount;
      for (let i = 0; i < toRemoveFromInv; i++) {
        const idx = p.inventory.findIndex(it => it.type === type && it.subtype === subtype && it.rarity === rarity);
        if (idx >= 0) p.inventory.splice(idx, 1);
      }

      clearSlots();
      craftState = 'animating';
      if (successCount > 0) {
        runSpinThenSpiralThenResolve(recipe, true, 0, totalCount, null, successCount, 0);
      } else if (onTable > 0) {
        runSpinThenSpiralThenResolve(recipe, false, onTable, totalCount, null, 0, onTable);
      } else {
        craftState = 'idle';
        renderCraftModal();
      }
      return;
    }

    for (let i = 0; i < 5; i++) {
      const idx = p.inventory.findIndex(it => it.type === recipe.item.type && it.subtype === recipe.item.subtype && it.rarity === recipe.item.rarity);
      if (idx >= 0 && !(p.adminMode && (recipe.item.type === 'tank' || recipe.item.type === 'body'))) p.inventory.splice(idx, 1);
    }
    for (let i = 0; i < 5; i++) {
      craftSelection[i].count--;
      if (craftSelection[i].count <= 0) {
        craftSelection[i].type = null;
        craftSelection[i].subtype = null;
        craftSelection[i].rarity = null;
        craftSelection[i].count = 0;
      }
    }
    const success = Math.random() < recipe.chance;
    const lose = success ? 5 : (1 + Math.floor(Math.random() * 4));
    const giveBack = 5 - lose;
    craftState = 'animating';
    runSpinThenSpiralThenResolve(recipe, success, giveBack, totalCount);
  }

  function returnLeftoversToInventory(skipRender) {
    const p = game?.player;
    if (!p) return;
    for (const s of craftSelection) {
      for (let i = 0; i < (s.count || 0); i++) {
        p.inventory.push({ type: s.type, subtype: s.subtype, rarity: s.rarity });
      }
    }
    clearSlots();
    craftState = 'idle';
    if (!skipRender) renderCraftModal();
  }

  function takeResultToInventory() {
    const p = game?.player;
    if (!p || !craftResultItem) return;
    const count = typeof craftResultCount === 'number' ? craftResultCount : 1;
    for (let i = 0; i < count; i++) {
      p.inventory.push({ ...craftResultItem });
    }
    craftResultItem = null;
    craftResultCount = 1;
    craftState = 'idle';
    renderCraftModal();
  }

  function fillCraftInventoryGrid(p, allowAdd) {
    if (!p) return;
    const countByKey = new Map();
    for (const it of p.inventory) {
      const key = `${it.type}|${it.subtype}|${it.rarity}`;
      countByKey.set(key, (countByKey.get(key) || 0) + 1);
    }
    if (p.adminMode) {
      for (const subtype of GUN_SUBTYPES) {
        for (const rarity of RARITIES) {
          countByKey.set(`tank|${subtype}|${rarity}`, 99999);
        }
      }
      for (const subtype of BODY_SUBTYPES) {
        for (const rarity of RARITIES) {
          countByKey.set(`body|${subtype}|${rarity}`, 99999);
        }
      }
    }
    const inSelection = (type, subtype, rarity) => totalInSelection(type, subtype, rarity);
    const rowKeys = [];
    const seen = new Set();
    for (const it of p.inventory) {
      const key = `${it.type}|${it.subtype}`;
      if (!seen.has(key)) { seen.add(key); rowKeys.push({ type: it.type, subtype: it.subtype }); }
    }
    if (p.adminMode) {
      for (const subtype of GUN_SUBTYPES) {
        const key = `tank|${subtype}`;
        if (!seen.has(key)) { seen.add(key); rowKeys.push({ type: 'tank', subtype }); }
      }
      for (const subtype of BODY_SUBTYPES) {
        const key = `body|${subtype}`;
        if (!seen.has(key)) { seen.add(key); rowKeys.push({ type: 'body', subtype }); }
      }
    }
    rowKeys.sort((a, b) => (a.subtype || '').localeCompare(b.subtype || ''));
    craftInventoryGrid.innerHTML = '';
    for (const { type, subtype } of rowKeys) {
      for (const rarity of RARITIES) {
        const count = countByKey.get(`${type}|${subtype}|${rarity}`) || 0;
        const reserved = allowAdd ? inSelection(type, subtype, rarity) : 0;
        const available = count - reserved;
        const item = { type, subtype, rarity };
        const el = document.createElement('div');
        const itemWithType = { type, subtype, rarity };
        const invCutter = isCutterBody(itemWithType);
        const invAnchor = isRarityGunTank(itemWithType);
        const invFullBleed = invCutter || invAnchor;
        el.className = 'craft-inv-slot' + (count <= 0 ? ' disabled' : (available <= 0 ? ' disabled' : '')) + (invFullBleed ? ' craft-inv-slot-cutter-as-box' : '');
        el.style.borderColor = invFullBleed ? 'transparent' : (count > 0 ? getRarityColor(rarity) : '#6E4F33');
        el.style.backgroundColor = count > 0 ? getRarityColor(rarity) : '#A0744B';
        el.style.color = count > 0 ? (invFullBleed ? getRarityColor(rarity) : '#000') : '#000';
        const invIconUrl = getIconUrl(subtype, type, rarity);
        const invFallback = type === 'body' ? getBodyIconUrl(subtype) : getGunIconUrl(subtype);
        const invPlaceholder = getPlaceholderIconDataUri(subtype);
        const invIconHtml = count > 0 && invIconUrl ? (invFullBleed ? `<div class="slot-cutter-fill"><img class="slot-icon-img slot-cutter-full craft-inv-icon" src="${invIconUrl}" onerror="if(this.dataset.fb!='1'){this.dataset.fb='1';this.src='${invFallback}'}else{this.src='${invPlaceholder}';this.onerror=null}" alt=""></div>` : (type === 'body' ? `<img class="slot-icon-img craft-inv-icon" src="${invIconUrl}" onerror="if(this.dataset.fb!='1'){this.dataset.fb='1';this.src='${invFallback}'}else{this.src='${invPlaceholder}';this.onerror=null}" width="24" height="24" alt="" style="object-fit:contain">` : `<div class="slot-icon-bg craft-inv-icon" style="width:24px;height:24px;background-image:url('${invIconUrl}')"></div>`)) : '';
        el.innerHTML = invIconHtml + (count > 0 ? (`<span class="craft-inv-count">×${formatCount(available)}</span><span class="craft-inv-name">${invFullBleed ? '' : (names[subtype] || subtype)}</span>`) : '');
        if (allowAdd && available > 0) {
          el.onclick = (e) => {
            if (craftState === 'success' && craftResultItem) {
              takeResultToInventory();
            }
            if (craftState === 'failed') returnLeftoversToInventory(true);
            if (e.shiftKey) addToCraftMax(item); else addToCraft(item);
          };
        }
        craftInventoryGrid.appendChild(el);
      }
    }
  }

  function renderCraftModal() {
    const p = game?.player;
    const recipe = craftState === 'idle' ? getRecipe() : null;

    if (craftState === 'success') {
      slotsContainer.classList.remove('craft-spiral-loop', 'craft-spiral');
      slotsContainer.classList.add('craft-slots-hidden');
      const item = craftResultItem;
      const n = craftResultCount ?? 1;
      if (!item || n === 0) {
        craftState = 'failed';
        craftResultItem = null;
        craftResultCount = 1;
        renderCraftModal();
        return;
      }
      slotsContainer.innerHTML = '';
      craftResultSlot.classList.add('has-result');
      craftResultSlot.classList.add('craft-result-clickable');
      const recipeCutter = isCutterBody({ ...item, type: item.type });
      const recipeAnchor = isRarityGunTank({ ...item, type: item.type });
      const recipeFullBleed = recipeCutter || recipeAnchor;
      craftResultSlot.classList.toggle('craft-result-slot-cutter-as-box', recipeFullBleed);
      craftResultSlot.style.borderColor = recipeFullBleed ? 'transparent' : getRarityColor(item.rarity);
      craftResultSlot.style.backgroundColor = recipeFullBleed ? 'transparent' : '';
      const resIconUrl = getIconUrl(item.subtype, item.type, item.rarity);
      const resFallback = item.type === 'body' ? getBodyIconUrl(item.subtype) : (item.type === 'tank' ? getGunIconUrl(item.subtype) : resIconUrl);
      const resPlaceholder = getPlaceholderIconDataUri(item.subtype);
      const resIconHtml = resIconUrl ? (item.type === 'body' && recipeCutter ? `<div class="slot-cutter-fill"><img class="slot-icon-img slot-cutter-full" src="${resIconUrl}" onerror="if(this.dataset.fb!='1'){this.dataset.fb='1';this.src='${resFallback}'}else{this.src='${resPlaceholder}';this.onerror=null}" alt=""></div>` : (item.type === 'tank' && recipeAnchor ? `<div class="slot-cutter-fill"><img class="slot-icon-img slot-cutter-full" src="${resIconUrl}" onerror="if(this.dataset.fb!='1'){this.dataset.fb='1';this.src='${resFallback}'}else{this.src='${resPlaceholder}';this.onerror=null}" alt=""></div>` : (item.type === 'body' ? `<img class="slot-icon-img craft-result-icon-bg" src="${resIconUrl}" onerror="if(this.dataset.fb!='1'){this.dataset.fb='1';this.src='${resFallback}'}else{this.src='${resPlaceholder}';this.onerror=null}" width="46" height="46" alt="" style="object-fit:contain">` : `<div class="slot-icon-bg craft-result-icon-bg" style="width:46px;height:46px;background-image:url('${resIconUrl}')"></div>`))) : '?';
      craftResultIcon.innerHTML = resIconHtml;
      craftResultName.textContent = (n > 1) ? `×${formatCount(n)}` : '';
      craftResultSlot.classList.add('craft-result-visible');
      craftResultSlot.classList.add('craft-result-clickable');
      craftConfirm.disabled = true;
      craftConfirm.onclick = null;
      chanceEl.textContent = `Success: ×${formatCount(n)} — Click result to add to inventory`;
      craftResultSlot.onclick = () => takeResultToInventory();
      craftInventoryGrid.innerHTML = '';
      fillCraftInventoryGrid(p, true);
      return;
    }

    if (craftState === 'failed') {
      slotsContainer.classList.remove('craft-spiral-loop', 'craft-spiral', 'craft-slots-hidden');
      const totalRemaining = craftSelection.reduce((sum, s) => sum + (s.count || 0), 0);
      if (totalRemaining === 0) {
        clearSlots();
        craftState = 'idle';
        renderCraftModal();
        return;
      }
      slotsContainer.innerHTML = '';
      for (let i = 0; i < 5; i++) {
        const sel = craftSelection[i];
        const filled = sel && sel.count > 0;
        const slot = document.createElement('div');
        const selAsItem = filled ? { ...sel, type: sel.type } : null;
        const isCutter = selAsItem && isCutterBody(selAsItem);
        const isAnchor = selAsItem && isRarityGunTank(selAsItem);
        const fullBleed = isCutter || isAnchor;
        slot.className = 'craft-slot craft-slot-leftover' + (filled ? ' filled' : '') + (fullBleed ? ' craft-slot-cutter-as-box' : '');
        slot.style.borderColor = filled && !fullBleed ? getRarityColor(sel.rarity) : (filled && fullBleed ? 'transparent' : '#444');
        slot.style.backgroundColor = fullBleed ? 'transparent' : '';
        slot.style.color = filled ? getRarityColor(sel.rarity) : '#666';
        const iconUrl = filled ? getIconUrl(sel.subtype, sel.type, sel.rarity) : null;
        const slotFallback = filled && sel.type === 'body' ? getBodyIconUrl(sel.subtype) : (filled && sel.type === 'tank' ? getGunIconUrl(sel.subtype) : iconUrl);
        const slotPlaceholder = filled ? getPlaceholderIconDataUri(sel.subtype) : '';
        const slotIconHtml = filled && iconUrl ? (fullBleed ? `<div class="slot-cutter-fill"><img class="slot-icon-img slot-cutter-full" src="${iconUrl}" onerror="if(this.dataset.fb!='1'){this.dataset.fb='1';this.src='${slotFallback}'}else{this.src='${slotPlaceholder}';this.onerror=null}" alt=""></div>` : (sel.type === 'body' ? `<img class="slot-icon-img" src="${iconUrl}" onerror="if(this.dataset.fb!='1'){this.dataset.fb='1';this.src='${slotFallback}'}else{this.src='${slotPlaceholder}';this.onerror=null}" width="24" height="24" alt="" style="object-fit:contain">` : `<div class="slot-icon-bg" style="width:24px;height:24px;background-image:url('${iconUrl}')"></div>`)) : '';
        const slotName = filled && !fullBleed ? (names[sel.subtype] || sel.subtype?.slice(0,3)) : (filled && fullBleed ? '' : '');
        slot.innerHTML = filled ? slotIconHtml + (slotName ? `<span>${slotName}</span>` : '') + (sel.count > 1 ? `<span class="craft-slot-count">×${formatCount(sel.count)}</span>` : '') : '+';
        slot.onclick = () => returnLeftoversToInventory();
        slotsContainer.appendChild(slot);
      }
      craftResultSlot.classList.remove('has-result');
      craftResultSlot.classList.remove('craft-result-clickable');
      craftResultSlot.classList.remove('craft-result-visible');
      craftResultSlot.onclick = null;
      craftResultIcon.innerHTML = '?';
      craftResultName.textContent = '—';
      chanceEl.textContent = totalRemaining === 0 ? 'Craft failed. No upgrades obtained.' : '';
      craftConfirm.disabled = true;
      craftConfirm.onclick = null;
      craftInventoryGrid.innerHTML = '';
      fillCraftInventoryGrid(p, true);
      return;
    }

    slotsContainer.classList.remove('craft-spiral-loop', 'craft-spiral', 'craft-slots-hidden');
    slotsContainer.innerHTML = '';
    for (let i = 0; i < 5; i++) {
      const sel = craftSelection[i];
      const filled = sel && sel.count > 0;
      const slot = document.createElement('div');
      const selAsItem = filled ? { ...sel, type: sel.type } : null;
      const isCutter = selAsItem && isCutterBody(selAsItem);
      const isAnchor = selAsItem && isRarityGunTank(selAsItem);
      const fullBleed = isCutter || isAnchor;
      slot.className = 'craft-slot' + (filled ? ' filled' : '') + (fullBleed ? ' craft-slot-cutter-as-box' : '');
      slot.style.borderColor = filled && !fullBleed ? getRarityColor(sel.rarity) : (filled && fullBleed ? 'transparent' : '#444');
      slot.style.backgroundColor = fullBleed ? 'transparent' : '';
      slot.style.color = filled ? getRarityColor(sel.rarity) : '#666';
      const iconUrl = filled ? getIconUrl(sel.subtype, sel.type, sel.rarity) : null;
      const slotFallback = filled && sel.type === 'body' ? getBodyIconUrl(sel.subtype) : (filled && sel.type === 'tank' ? getGunIconUrl(sel.subtype) : iconUrl);
      const slotPlaceholder = filled ? getPlaceholderIconDataUri(sel.subtype) : '';
      const slotIconHtml = filled && iconUrl ? (fullBleed ? `<div class="slot-cutter-fill"><img class="slot-icon-img slot-cutter-full" src="${iconUrl}" onerror="if(this.dataset.fb!='1'){this.dataset.fb='1';this.src='${slotFallback}'}else{this.src='${slotPlaceholder}';this.onerror=null}" alt=""></div>` : (sel.type === 'body' ? `<img class="slot-icon-img" src="${iconUrl}" onerror="if(this.dataset.fb!='1'){this.dataset.fb='1';this.src='${slotFallback}'}else{this.src='${slotPlaceholder}';this.onerror=null}" width="24" height="24" alt="" style="object-fit:contain">` : `<div class="slot-icon-bg" style="width:24px;height:24px;background-image:url('${iconUrl}')"></div>`)) : '';
      const slotName = filled && !fullBleed ? (names[sel.subtype] || sel.subtype?.slice(0,3)) : (filled && fullBleed ? '' : '');
      slot.innerHTML = filled ? slotIconHtml + (slotName ? `<span>${slotName}</span>` : '') + (sel.count > 1 ? `<span class="craft-slot-count">×${formatCount(sel.count)}</span>` : '') : '+';
      const slotIndex = i;
      slot.onclick = () => {
        if (filled) {
          craftSelection[slotIndex].count = 0;
          craftSelection[slotIndex].type = null;
          craftSelection[slotIndex].subtype = null;
          craftSelection[slotIndex].rarity = null;
          renderCraftModal();
        }
      };
      slotsContainer.appendChild(slot);
    }

    craftResultSlot.classList.remove('craft-result-clickable');
    craftResultSlot.classList.remove('craft-result-visible');
    craftResultSlot.onclick = null;

    if (recipe) {
      craftResultSlot.classList.remove('has-result');
      craftResultSlot.classList.remove('craft-result-slot-cutter-as-box');
      craftResultSlot.style.borderColor = '';
      craftResultSlot.style.backgroundColor = '';
      craftResultIcon.innerHTML = '?';
      craftResultName.textContent = '—';
      chanceEl.textContent = `${Math.round(recipe.chance * 100)}% success chance.`;
      craftConfirm.disabled = craftState === 'animating';
      craftConfirm.onclick = craftState === 'animating' ? null : () => { performCraft(); };
    } else {
      craftResultSlot.classList.remove('has-result');
      craftResultSlot.classList.remove('craft-result-slot-cutter-as-box');
      craftResultSlot.style.borderColor = '';
      craftResultIcon.innerHTML = '?';
      craftResultName.textContent = '—';
      const totalFilled = craftSelection.reduce((sum, s) => sum + (s.count > 0 ? 1 : 0), 0);
      const same = totalFilled === 5 && craftSelection.every(s => s.count >= 1 && s.type === craftSelection[0].type && s.subtype === craftSelection[0].subtype && s.rarity === craftSelection[0].rarity);
      const recipeCheck = getRecipe();
      chanceEl.textContent = same ? (recipeCheck ? `${Math.round(recipeCheck.chance * 100)}% success chance` : 'Need 5 in inventory') : totalFilled ? 'Need 5 same type' : '?% success chance';
      craftConfirm.disabled = true;
      craftConfirm.onclick = null;
    }

    craftInventoryGrid.innerHTML = '';
    if (!p) return;
    fillCraftInventoryGrid(p, true);
  }
}

let chatGuestName = null;
const CHAT_MAX_MESSAGES = 50;
const chatMessagesList = [];

function setupChat() {
  if (chatGuestName == null) {
    chatGuestName = localStorage.getItem('florexe_username') || 'Guest #' + String(1000 + Math.floor(Math.random() * 9000));
  }
  const chatInput = document.getElementById('chatInput');
  const chatMessages = document.getElementById('chatMessages');
  if (!chatInput || !chatMessages) return;

  const chatCommandList = document.getElementById('chatCommandList');
  const CHAT_COMMANDS = [
    { cmd: '/kill all', desc: 'Kill all food and claim all dropped loot' },
    { cmd: '/adminmode on | off', desc: 'Toggle admin mode (ghost, 0 damage, 99999 of each gun and body)' },
    { cmd: '/spawn [rarity] [mob]', desc: 'Spawn mob at your location (e.g. /spawn super food)' },
    { cmd: '/give [user] [rarity] [item]', desc: 'Add item to user inventory (e.g. /give me super overlord)' },
  ];

  const VALID_RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'ultra', 'super'];
  const TANK_SUBTYPES = ['base', 'destroyer', 'anchor', 'riot', 'overlord', 'streamliner'];
  const BODY_SUBTYPES = ['inferno', 'ziggurat', 'cutter', 'hive'];
  const GIVE_ITEM_SUBTYPES = [...TANK_SUBTYPES, ...BODY_SUBTYPES];

  function updateCommandListVisibility() {
    const v = chatInput.value;
    if (!chatCommandList) return;
    if (v === '/' || v.startsWith('/')) {
      chatCommandList.classList.remove('hidden');
      chatCommandList.innerHTML = CHAT_COMMANDS.map(({ cmd, desc }) =>
        `<div class="cmd-item">${escapeHtml(cmd)} — ${escapeHtml(desc)}</div>`
      ).join('');
    } else {
      chatCommandList.classList.add('hidden');
      chatCommandList.innerHTML = '';
    }
  }

  chatInput.addEventListener('input', updateCommandListVisibility);
  chatInput.addEventListener('focus', updateCommandListVisibility);
  chatInput.addEventListener('blur', () => {
    if (chatCommandList) {
      chatCommandList.classList.add('hidden');
      chatCommandList.innerHTML = '';
    }
  });

  function appendMessage(text, opts) {
    const msg = { username: opts?.system ? '[System]' : chatGuestName, text: text.trim() };
    chatMessagesList.push(msg);
    if (chatMessagesList.length > CHAT_MAX_MESSAGES) chatMessagesList.shift();
    const line = document.createElement('div');
    line.className = 'chat-msg' + (opts?.system ? ' chat-msg-system' : '');
    if (opts?.color) {
      line.innerHTML = `<span style="color:${escapeHtml(opts.color)}">${escapeHtml(msg.text)}</span>`;
    } else {
      const nameColor = isAdmin() ? getAdminColor() : '';
      const nameStyle = nameColor ? ` style="color:${escapeHtml(nameColor)}"` : '';
      line.innerHTML = `[Local] <span class="username"${nameStyle}>${escapeHtml(msg.username)}</span>: ${escapeHtml(msg.text)}`;
    }
    chatMessages.appendChild(line);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  if (game) {
    game.onSuperSpawn = (mobType) => {
      const label = mobType === 'Food' ? 'Decagon' : mobType;
      appendMessage(`A Super ${label} Has Spawned!`, { system: true, color: RARITY_COLORS.super });
    };
    if (game.player) game.player.displayName = chatGuestName;
  }

  function isChatBlocked() {
    const craftingModal = document.getElementById('crafting-modal');
    const inventoryContent = document.getElementById('inventoryBox')?.querySelector('.toggle-box-content');
    return (craftingModal && !craftingModal.classList.contains('hidden')) ||
      (inventoryContent && !inventoryContent.classList.contains('hidden'));
  }

  chatInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    if (isChatBlocked()) {
      e.preventDefault();
      return;
    }
    e.preventDefault();
    const raw = chatInput.value.trim();
    if (!raw) return;
    chatInput.value = '';
    chatInput.blur();
    if (raw.toLowerCase() === '/kill all') {
        if (!isAdmin()) return;
        const p = game?.player;
        if (!p) {
          appendMessage('[System] No player.');
        } else {
          let foodCount = 0;
          if (game.foods?.length) {
            const foods = [...game.foods];
            for (const food of foods) {
              p.onKill(food, game);
              foodCount++;
            }
          }
          const claimCount = game.claimAllDrops(p.id);
          if (foodCount > 0 || claimCount > 0) {
            const parts = [];
            if (foodCount > 0) parts.push(`Killed ${foodCount} food`);
            if (claimCount > 0) parts.push(`claimed ${claimCount} drops`);
            appendMessage('[System] ' + parts.join('; ') + '.');
          } else {
            appendMessage('[System] No food on the map and no dropped loot to claim.');
          }
        }
      } else if (raw.toLowerCase().startsWith('/adminmode ')) {
        if (!isAdmin()) return;
        const arg = raw.slice(10).trim().toLowerCase();
        const p = game?.player;
        if (!p) {
          appendMessage('[System] No player.');
        } else if (arg === 'on') {
          p.adminMode = true;
          p.ghost = true;
          p.hp = p.maxHp;
          appendMessage('[System] Admin mode ON: ghost, 0 damage, 99999 of each gun and each body.');
        } else if (arg === 'off') {
          p.adminMode = false;
          p.ghost = false;
          appendMessage('[System] Admin mode OFF.');
        } else {
          appendMessage('[System] Use: /adminmode on or /adminmode off');
        }
      } else if (raw.toLowerCase().startsWith('/spawn ')) {
        if (!isAdmin()) return;
        const parts = raw.slice(7).trim().toLowerCase().split(/\s+/);
        const p = game?.player;
        if (!p) {
          appendMessage('[System] No player.');
        } else if (parts.length < 2) {
          appendMessage('[System] Use: /spawn [rarity] [mob] — e.g. /spawn super food');
        } else {
          const [rarity, mob] = parts;
          if (!VALID_RARITIES.includes(rarity)) {
            appendMessage(`[System] Invalid rarity. Use one of: ${VALID_RARITIES.join(', ')}`);
          } else if (mob !== 'food') {
            appendMessage('[System] Unknown mob type. Use "food" for now.');
          } else {
            game.spawnFoodAt(p.x, p.y, rarity);
            appendMessage(`[System] Spawned ${rarity} ${mob} at your location.`);
          }
        }
      } else if (raw.toLowerCase().startsWith('/give ')) {
        const parts = raw.slice(6).trim().split(/\s+/).map(s => s.toLowerCase());
        if (parts.length < 3) {
          appendMessage('[System] Use: /give [user] [rarity] [item] — e.g. /give me super overlord');
        } else {
          const [userArg, rarity, itemSubtype] = parts;
          const target = (userArg === 'me' || (game?.player?.displayName && game.player.displayName.toLowerCase() === userArg))
            ? game?.player
            : null;
          if (!target) {
            appendMessage('[System] Unknown user. Use "me" to add to your own inventory.');
          } else if (!VALID_RARITIES.includes(rarity)) {
            appendMessage(`[System] Invalid rarity. Use one of: ${VALID_RARITIES.join(', ')}`);
          } else if (!GIVE_ITEM_SUBTYPES.includes(itemSubtype)) {
            appendMessage(`[System] Invalid item. Use one of: ${GIVE_ITEM_SUBTYPES.join(', ')}`);
          } else {
            const type = BODY_SUBTYPES.includes(itemSubtype) ? 'body' : 'tank';
            target.addLoot(type, itemSubtype, rarity);
            appendMessage(`[System] Added ${rarity} ${itemSubtype} to ${userArg === 'me' ? 'your' : 'their'} inventory.`);
          }
        }
      } else {
        appendMessage(raw);
        if (game?.player) {
          if (game.floatingMessages.length >= 5) game.floatingMessages.shift();
          game.floatingMessages.push({ text: raw, expiresAt: Date.now() + 2000 });
        }
      }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    if (e.target === chatInput) return;
    if (document.activeElement === chatInput) return;
    if (isChatBlocked()) return;
    e.preventDefault();
    chatInput.focus();
  });
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

/** Admins: usernames (case-insensitive). Admins can use map editor and set name color. */
const ADMIN_USERNAMES = ['thechomania'];

function isAdmin() {
  const u = localStorage.getItem('florexe_username') || '';
  return ADMIN_USERNAMES.includes(u.trim().toLowerCase());
}

function getAdminColor() {
  return localStorage.getItem('florexe_admin_color') || '#45f9ba';
}

/** Bad-word filter for username: common profanity and slurs (subset; add more as needed). */
const BAD_WORDS = ['ass', 'asshole', 'bastard', 'bitch', 'bullshit', 'crap', 'damn', 'dick', 'dumbass', 'fag', 'faggot', 'fuck', 'fucker', 'fucking', 'hell', 'nigga', 'nigger', 'retard', 'retarded', 'shit', 'slut', 'whore', 'wtf'];

function containsBadWord(s) {
  const lower = s.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const w of BAD_WORDS) {
    if (lower.includes(w)) return true;
  }
  return false;
}

function updateAuthDisplay() {
  const wrap = document.getElementById('menuAuthWrap');
  if (!wrap) return;
  let auth = null;
  try {
    const s = localStorage.getItem('florexe_auth');
    if (s) auth = JSON.parse(s);
  } catch (e) {}
  if (auth && auth.expiresAt && auth.expiresAt > Date.now()) {
    const displayName = localStorage.getItem('florexe_username') || auth.user?.displayName || auth.user?.username || 'User';
    const adminBadge = isAdmin() ? ' <span class="admin-badge">Admin</span><a href="#" id="adminColorBtn" class="admin-color-link" title="Change name color">Color</a>' : '';
    const nameStyle = isAdmin() ? ' style="color:' + escapeHtml(getAdminColor()) + '"' : '';
    wrap.innerHTML = '<div class="menu-user-wrap"><span class="menu-username">Logged in as <span' + nameStyle + '>' + escapeHtml(displayName) + '</span>' + adminBadge + '</span><a href="#" id="menuLogoutBtn" class="menu-logout-btn">Logout</a></div>';
    const logout = document.getElementById('menuLogoutBtn');
    if (logout) logout.onclick = (e) => { e.preventDefault(); localStorage.removeItem('florexe_auth'); localStorage.removeItem('florexe_username'); localStorage.removeItem('florexe_admin_color'); updateAuthDisplay(); tryShowUsernameModal(); };
    const adminColorBtn = document.getElementById('adminColorBtn');
    if (adminColorBtn && isAdmin()) {
      let colorInput = document.getElementById('florexeAdminColorInput');
      if (!colorInput) {
        colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.id = 'florexeAdminColorInput';
        colorInput.style.cssText = 'position:absolute;opacity:0;pointer-events:none;';
        document.body.appendChild(colorInput);
        colorInput.onchange = () => { localStorage.setItem('florexe_admin_color', colorInput.value); updateAuthDisplay(); };
      }
      colorInput.value = getAdminColor();
      adminColorBtn.onclick = (e) => { e.preventDefault(); colorInput.click(); };
    }
    const mapWrap = document.getElementById('menuMapEditorWrap');
    if (mapWrap) mapWrap.style.display = isAdmin() ? '' : 'none';
    tryShowUsernameModal();
  } else {
    if (auth) { try { localStorage.removeItem('florexe_auth'); } catch (e) {} }
    const path = window.location.pathname;
    const base = path.endsWith('/') ? path : path.replace(/\/[^/]*$/, '') + '/';
    const origin = (window.location.origin.startsWith('http://') && !/^(localhost|127\.0\.0\.1)$/.test(window.location.hostname))
      ? 'https://' + window.location.host : window.location.origin;
    const redirectUri = origin + (base || '/') + 'auth/discord';
    wrap.innerHTML = '<a href="https://discord.com/oauth2/authorize?client_id=1476693949090500708&response_type=token&redirect_uri=' + encodeURIComponent(redirectUri) + '&scope=identify" id="menuLoginBtn" class="menu-login-btn">Login with Discord</a>';
    const mapWrap = document.getElementById('menuMapEditorWrap');
    if (mapWrap) mapWrap.style.display = 'none';
  }
}

function tryShowUsernameModal() {
  const hasUsername = localStorage.getItem('florexe_username');
  let auth = null;
  try {
    const s = localStorage.getItem('florexe_auth');
    if (s) auth = JSON.parse(s);
  } catch (e) {}
  if (!auth || hasUsername) return;
  const modal = document.getElementById('username-modal');
  const input = document.getElementById('usernameInput');
  const errEl = document.getElementById('usernameError');
  const submit = document.getElementById('usernameSubmit');
  const adminColorRow = document.getElementById('adminColorRow');
  const adminColorInput = document.getElementById('adminColorInput');
  if (!modal || !input || !errEl || !submit) return;
  modal.classList.remove('hidden');
  input.value = '';
  errEl.classList.add('hidden');
  if (adminColorRow) adminColorRow.classList.add('hidden');
  if (adminColorInput) adminColorInput.value = getAdminColor();
  input.focus();

  const updateAdminColorVisibility = () => {
    const name = (input.value || '').trim().toLowerCase();
    if (adminColorRow) adminColorRow.classList.toggle('hidden', !ADMIN_USERNAMES.includes(name));
  };
  input.addEventListener('input', updateAdminColorVisibility);

  const done = () => {
    input.removeEventListener('input', updateAdminColorVisibility);
    modal.classList.add('hidden');
    updateAuthDisplay();
  };

  const doSubmit = async () => {
    let name = (input.value || '').trim();
    errEl.classList.add('hidden');
    if (!name) { errEl.textContent = 'Please enter a username.'; errEl.classList.remove('hidden'); return; }
    if (name.length > 50) { errEl.textContent = 'Username must be 50 characters or less.'; errEl.classList.remove('hidden'); return; }
    if (containsBadWord(name)) { errEl.textContent = 'That username contains inappropriate language. Please choose something else.'; errEl.classList.remove('hidden'); return; }

    const apiBase = window.FLOREXE_API_URL || '';
    try {
      const checkRes = await fetch(apiBase + '/api/username/check?username=' + encodeURIComponent(name));
      if (checkRes.ok) {
        const { taken } = await checkRes.json();
        if (taken) { errEl.textContent = 'That username is already taken.'; errEl.classList.remove('hidden'); return; }
      }
    } catch (e) {
      errEl.textContent = 'Could not check username. Run the server for unique usernames.';
      errEl.classList.remove('hidden');
      return;
    }

    const discordId = auth.user?.id || '';
    try {
      const regRes = await fetch(apiBase + '/api/username/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: name, discordId })
      });
      const regData = await regRes.json().catch(() => ({}));
      if (!regRes.ok && regRes.status !== 200) {
        errEl.textContent = regData.error || 'Username already taken.';
        errEl.classList.remove('hidden');
        return;
      }
    } catch (e) {
      errEl.textContent = 'Could not register. Run the server for unique usernames.';
      errEl.classList.remove('hidden');
      return;
    }

    localStorage.setItem('florexe_username', name);
    if (ADMIN_USERNAMES.includes(name.toLowerCase()) && adminColorInput) {
      localStorage.setItem('florexe_admin_color', adminColorInput.value);
    }
    done();
  };
  submit.onclick = () => doSubmit();
  input.onkeydown = (e) => { if (e.key === 'Enter') doSubmit(); };
}

function init() {
  canvas = document.getElementById('gameCanvas');
  ctx = canvas?.getContext('2d');
  mainMenu = document.getElementById('main-menu');
  gameContainer = document.getElementById('game-container');
  minimapCanvas = document.getElementById('minimapCanvas');
  if (minimapCanvas) {
    minimapCanvas.width = MINIMAP_SIZE;
    minimapCanvas.height = MINIMAP_SIZE;
    minimapCtx = minimapCanvas.getContext('2d');
  }
  if (!canvas || !ctx || !mainMenu || !gameContainer) return;
  updateAuthDisplay();
  preloadIcons();
  resize();

  document.querySelectorAll('.gamemode-btn').forEach(btn => {
    btn.onclick = () => {
      if (btn.disabled) return;
      const mode = btn.dataset.mode;
      if (mode === 'heaven') startGame('heaven');
      else startGame(mode);
    };
  });

  const respawnBtn = document.getElementById('respawnBtn');
  if (respawnBtn) {
    respawnBtn.onclick = () => {
      document.getElementById('death-screen').classList.add('hidden');
      if (game) {
        const p = game.player;
        const savedState = p ? {
          inventory: Array.isArray(p.inventory) ? p.inventory.slice() : [],
          hand: Array.isArray(p.hand) ? p.hand.slice() : [],
          equippedTank: p.equippedTank && typeof p.equippedTank === 'object' ? { ...p.equippedTank } : null,
          equippedBody: p.equippedBody && typeof p.equippedBody === 'object' ? { ...p.equippedBody } : null,
          level: typeof p.level === 'number' ? p.level : 1,
          xp: typeof p.xp === 'number' ? p.xp : 0,
          stars: typeof p.stars === 'number' ? p.stars : 0
        } : null;
        game.start(savedState);
      }
      lastTime = performance.now();
      if (!animationId) loop(performance.now());
    };
  }

  const shopBtn = document.getElementById('shopBtn');
  if (shopBtn) shopBtn.onclick = () => openShop();
  const shopClose = document.getElementById('shopClose');
  if (shopClose) shopClose.onclick = () => closeShop();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

function loop(now) {
  const dt = Math.min(now - lastTime, 50);
  lastTime = now;

  if (gameContainer?.classList?.contains('hidden')) {
    animationId = requestAnimationFrame(loop);
    return;
  }

  if (game?.player?.dead) {
    document.getElementById('death-screen').classList.remove('hidden');
    game.running = false;
    animationId = requestAnimationFrame(loop);
    return;
  }

  game?.update(dt);
  game?.draw(ctx);

  updateVisionZoomLabel();
  drawMinimap();

  animationId = requestAnimationFrame(loop);
}

function updateVisionZoomLabel() {
  const el = document.getElementById('visionZoomLabel');
  if (!el || !game?.player) return;
  const baseScale = Math.max(0.8, Math.min(canvas.width, canvas.height) / 720);
  const percentIncrease = Math.round((game.scale / baseScale - 1) * 100);
  const sign = percentIncrease >= 0 ? '+' : '';
  el.textContent = `${sign}${percentIncrease}%`;
}

function drawMinimap() {
  if (!minimapCanvas || !minimapCtx || !game?.player) return;
  const p = game.player;
  const w = minimapCanvas.width;
  const h = minimapCanvas.height;
  const half = MAP_SIZE / 2;
  // Fixed view: entire map (MAP_SIZE x MAP_SIZE). Match game orientation: world +x = right, world +y = down
  const scale = w / MAP_SIZE;
  function toMinimap(wx, wy) {
    return {
      x: (wx + half) * scale,
      y: (wy + half) * scale
    };
  }

  minimapCtx.fillStyle = 'rgba(230, 230, 230, 0.95)';
  minimapCtx.fillRect(0, 0, w, h);

  const playableBounds = getPlayableBounds();
  if (playableBounds) {
    const { minX, maxX, minY, maxY } = playableBounds;
    minimapCtx.fillStyle = 'rgba(30, 30, 30, 0.95)';
    const top = -half;
    const bottom = half;
    const left = -half;
    const right = half;
    if (top < minY) {
      const a = toMinimap(Math.max(left, minX), top);
      const b = toMinimap(Math.min(right, maxX), Math.min(bottom, minY));
      minimapCtx.fillRect(a.x, a.y, Math.max(1, b.x - a.x), Math.max(1, b.y - a.y));
    }
    if (bottom > maxY) {
      const a = toMinimap(Math.max(left, minX), Math.max(top, maxY));
      const b = toMinimap(Math.min(right, maxX), bottom);
      minimapCtx.fillRect(a.x, a.y, Math.max(1, b.x - a.x), Math.max(1, b.y - a.y));
    }
    if (left < minX) {
      const a = toMinimap(left, Math.max(top, minY));
      const b = toMinimap(Math.min(right, minX), Math.min(bottom, maxY));
      minimapCtx.fillRect(a.x, a.y, Math.max(1, b.x - a.x), Math.max(1, b.y - a.y));
    }
    if (right > maxX) {
      const a = toMinimap(Math.max(left, maxX), Math.max(top, minY));
      const b = toMinimap(right, Math.min(bottom, maxY));
      minimapCtx.fillRect(a.x, a.y, Math.max(1, b.x - a.x), Math.max(1, b.y - a.y));
    }
  }

  const wallFills = getMergedWallFills();
  if (wallFills.length > 0) {
    minimapCtx.fillStyle = 'rgba(30, 30, 30, 0.95)';
    for (const r of wallFills) {
      const a = toMinimap(r.x1, r.y1);
      const b = toMinimap(r.x2, r.y2);
      const x = Math.min(a.x, b.x);
      const y = Math.min(a.y, b.y);
      const rw = Math.max(1, Math.abs(b.x - a.x));
      const rh = Math.max(1, Math.abs(b.y - a.y));
      minimapCtx.fillRect(x, y, rw, rh);
    }
  } else {
    minimapCtx.strokeStyle = 'rgba(30, 30, 30, 0.9)';
    minimapCtx.lineCap = 'butt';
    minimapCtx.lineJoin = 'round';
    const wallW = Math.max(2, (2 * WALL_HALF_WIDTH) * scale);
    minimapCtx.lineWidth = wallW;
    for (const wall of getWalls()) {
      const a = toMinimap(wall.x1, wall.y1);
      const b = toMinimap(wall.x2, wall.y2);
      minimapCtx.beginPath();
      minimapCtx.moveTo(a.x, a.y);
      minimapCtx.lineTo(b.x, b.y);
      minimapCtx.stroke();
    }
  }

  const px = toMinimap(p.x, p.y).x;
  const py = toMinimap(p.x, p.y).y;

  minimapCtx.save();
  minimapCtx.translate(px, py);
  minimapCtx.rotate(p.angle);
  minimapCtx.fillStyle = '#1ca8c9';
  minimapCtx.strokeStyle = '#0d6a8a';
  minimapCtx.lineWidth = 1;
  const arrowLen = 6;
  const arrowW = 4;
  minimapCtx.beginPath();
  minimapCtx.moveTo(arrowLen, 0);
  minimapCtx.lineTo(-arrowLen, arrowW);
  minimapCtx.lineTo(-arrowLen * 0.4, 0);
  minimapCtx.lineTo(-arrowLen, -arrowW);
  minimapCtx.closePath();
  minimapCtx.fill();
  minimapCtx.stroke();
  minimapCtx.restore();
}