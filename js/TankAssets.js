/**
 * Single source of truth for tank/gun and body images.
 * All images live in assets/icons/guns/ and assets/icons/bodies/.
 * Load once, use for both in-game tank and UI items.
 */

const GUN_SUBTYPES = ['base', 'destroyer', 'anchor', 'riot', 'overlord', 'streamliner'];
const BODY_SUBTYPES = ['inferno', 'ziggurat', 'cutter', 'hive'];

/**
 * Base URL for icon assets. Use relative path so assets load from the same origin
 * as the page (file://, localhost:5500, etc.) and never force localhost:3000.
 */
function getBaseUrl() {
  return 'assets/icons/';
}

export function getGunIconUrl(subtype) {
  if (!subtype || !GUN_SUBTYPES.includes(subtype)) return null;
  return `${getBaseUrl()}guns/${subtype}.svg`;
}

export function getBodyIconUrl(subtype) {
  if (!subtype) return `${getBaseUrl()}bodies/default.svg`;
  if (!BODY_SUBTYPES.includes(subtype)) return `${getBaseUrl()}bodies/default.svg`;
  return `${getBaseUrl()}bodies/${subtype}.svg`;
}

/** Only these body subtypes have rarity-specific icon files (no 404s for others). */
const BODY_SUBTYPES_WITH_RARITY_ICONS = ['cutter', 'hive', 'inferno', 'ziggurat'];

/**
 * Body icon by rarity. Use for inventory, craft, equip, shop, drops.
 * Cutter, Hive, Inferno, and Ziggurat use the 8 rarity files from bodies-rarity.
 */
export function getBodyIconUrlByRarity(subtype, rarity) {
  if (!subtype || !BODY_SUBTYPES.includes(subtype)) return getBodyIconUrl(subtype);
  if (!BODY_SUBTYPES_WITH_RARITY_ICONS.includes(subtype)) return getBodyIconUrl(subtype);
  const r = rarity || 'common';
  const base = getBaseUrl();
  return `${base}rarities/bodies-rarity/${subtype}-rarity/${r}_${subtype}.svg`;
}

/** Gun/tank subtypes that have rarity-specific icon files (anchor, destroyer, overlord, base uses common only). */
const GUN_SUBTYPES_WITH_RARITY_ICONS = ['anchor', 'base', 'destroyer', 'overlord', 'riot', 'streamliner'];

/**
 * Gun icon by rarity. Use for inventory, craft, hand, etc.
 * Anchor uses guns-rarity/anchor-rarity; destroyer uses guns-rarity/destroyer-rarity; overlord uses guns-rarity/overlord-rarity.
 */
export function getGunIconUrlByRarity(subtype, rarity) {
  if (!subtype || !rarity || !GUN_SUBTYPES.includes(subtype)) return getGunIconUrl(subtype);
  if (!GUN_SUBTYPES_WITH_RARITY_ICONS.includes(subtype)) return getGunIconUrl(subtype);
  const base = getBaseUrl();
  if (subtype === 'base') return `${base}rarities/guns-rarity/base-rarity/${rarity}_base.svg`;
  if (subtype === 'anchor') return `${base}rarities/guns-rarity/anchor-rarity/${rarity}_anchor.svg`;
  if (subtype === 'destroyer') return `${base}rarities/guns-rarity/destroyer-rarity/${rarity}_destroyer.svg`;
  if (subtype === 'overlord') return `${base}rarities/guns-rarity/overlord-rarity/${rarity}_overlord.svg`;
  if (subtype === 'riot') return `${base}rarities/guns-rarity/riot-rarity/${rarity}_riot.svg`;
  if (subtype === 'streamliner') return `${base}rarities/guns-rarity/streamliner-rarity/${rarity}_streamliner.svg`;
  return getGunIconUrl(subtype);
}

/** For UI: get icon URL by type and subtype; pass rarity for body (Cutter/Hive) or tank (Anchor, Destroyer). */
export function getIconUrl(subtype, type, rarity = null) {
  if (type === 'body') {
    if (subtype === 'hive' || subtype === 'cutter' || subtype === 'inferno' || subtype === 'ziggurat') return getBodyIconUrlByRarity(subtype, rarity || 'common');
    if (rarity) return getBodyIconUrlByRarity(subtype, rarity);
    return getBodyIconUrl(subtype);
  }
  if (type === 'tank' && (subtype === 'anchor' || subtype === 'base' || subtype === 'destroyer' || subtype === 'overlord' || subtype === 'riot' || subtype === 'streamliner'))
    return getGunIconUrlByRarity(subtype, rarity || 'common');
  if (type === 'tank') return getGunIconUrl(subtype);
  return getBodyIconUrl(subtype);
}

export { GUN_SUBTYPES, BODY_SUBTYPES };

const loaded = { guns: {}, bodies: {} };
let loadPromise = null;

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/**
 * Load all gun and body images once. Resolves with { guns, bodies }.
 * In-game tanks use base body images (e.g. bodies/inferno.svg). Craft/inventory use rarity URLs from getBodyIconUrlByRarity.
 */
export function loadTankAssets() {
  if (loadPromise) return loadPromise;
  const base = getBaseUrl();
  loadPromise = (async () => {
    const guns = {};
    const bodies = { default: null };
    await Promise.all([
      ...GUN_SUBTYPES.map(async (s) => {
        guns[s] = await loadImage(`${base}guns/${s}.svg`);
      }),
      loadImage(`${base}bodies/default.svg`).then((img) => { bodies.default = img; }),
      ...BODY_SUBTYPES.map(async (s) => {
        bodies[s] = await loadImage(`${base}bodies/${s}.svg`);
      }),
    ]);
    loaded.guns = guns;
    loaded.bodies = bodies;
    return loaded;
  })();
  return loadPromise;
}

/** Get currently loaded assets (after loadTankAssets() has resolved) */
export function getLoadedTankAssets() {
  return loaded;
}
