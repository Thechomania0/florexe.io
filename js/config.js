// Rarity colors and order
export const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'ultra', 'super'];
export const RARITY_COLORS = {
  common: '#bcec8bff',
  uncommon: '#fff176',
  rare: '#3c78d8',
  epic: '#9900ff',
  legendary: '#de1f1f',
  mythic: '#1fdbde',
  ultra: '#ff2b75',
  super: '#2bffa3',
};

/** Shop: price in stars per item. Key = "legendary_destroyer" | "mythic_inferno" etc. (rarity_subtype). Edit to set shop prices. */
export const SHOP_ITEM_PRICES = {
  // Guns: Destroyer
  legendary_destroyer: 50,
  mythic_destroyer: 1000,
  ultra_destroyer: 25000,
  super_destroyer: 500000,
  // Guns: Anchor
  legendary_anchor: 75,
  mythic_anchor: 1500,
  ultra_anchor: 50000,
  super_anchor: 750000,
  // Guns: Riot
  legendary_riot: 150,
  mythic_riot: 3000,
  ultra_riot: 100000,
  super_riot: 1500000,
  // Guns: Overlord
  legendary_overlord: 75,
  mythic_overlord: 1500,
  ultra_overlord: 75000,
  super_overlord: 1500000,
  // Guns: Streamliner
  legendary_streamliner: 50,
  mythic_streamliner: 1000,
  ultra_streamliner: 50000,
  super_streamliner: 500000,
  // Bodies: Inferno
  legendary_inferno: 150,
  mythic_inferno: 3000,
  ultra_inferno: 75000,
  super_inferno: 1000000,
  // Bodies: Ziggurat
  legendary_ziggurat: 50,
  mythic_ziggurat: 1000,
  ultra_ziggurat: 25000,
  super_ziggurat: 500000,
  // Bodies: Cutter
  legendary_cutter: 50,
  mythic_cutter: 1000,
  ultra_cutter: 25000,
  super_cutter: 500000,
  // Bodies: Hive
  legendary_hive: 25,
  mythic_hive: 1000,
  ultra_hive: 25000,
  super_hive: 100000,
};

// Craft success rates (current -> next)
export const CRAFT_CHANCES = {
  common: 0.6,
  uncommon: 0.4,
  rare: 0.28,
  epic: 0.12,
  legendary: 0.05,
  mythic: 0.03,
  ultra: 0.01,
};

// Food/Shape definitions: shape name, sides, damage, HP, drop table. Weight increases exponentially with rarity (harder to push).
export const FOOD_CONFIG = {
  common: { shape: 'triangle', sides: 3, damage: 10, hp: 10, size: 12, weight: 1, drops: { common: 0.8, uncommon: 0.2 } },
  uncommon: { shape: 'square', sides: 4, damage: 100, hp: 40, size: 18, weight: 10, drops: { common: 0.5, uncommon: 0.5 } },
  rare: { shape: 'pentagon', sides: 5, damage: 500, hp: 150, size: 24, weight: 50, drops: { uncommon: 0.8, rare: 0.2 } },
  epic: { shape: 'hexagon', sides: 6, damage: 700, hp: 1000, size: 30, weight: 100, drops: { uncommon: 0.06, rare: 0.8, epic: 0.14 } },
  legendary: { shape: 'septagon', sides: 7, damage: 1000, hp: 8000, size: 42, weight: 200, drops: { rare: 0.1, epic: 0.8, legendary: 0.1 } },
  mythic: { shape: 'octagon', sides: 8, damage: 2000, hp: 25000, size: 54, weight: 1000, drops: { epic: 0.07, legendary: 0.9, mythic: 0.03 } },
  ultra: { shape: 'nonagon', sides: 9, damage: 3000, hp: 300000, size: 68, weight: 50000, drops: { legendary: 0.845, mythic: 0.15, ultra: 0.005 } },
  super: { shape: 'decagon', sides: 10, damage: 7000, hp: 20000000, size: 90, weight: 100000, drops: { mythic: 0.77, ultra: 0.23 }, stars: 5000 },
};

/** Beetle mob: same rarities and stats as food (copy). Edit later for different stats. */
export const BEETLE_CONFIG = {
  common: { shape: 'triangle', sides: 3, damage: 10, hp: 10, size: 12, weight: 1, drops: { common: 0.8, uncommon: 0.2 } },
  uncommon: { shape: 'square', sides: 4, damage: 100, hp: 40, size: 18, weight: 10, drops: { common: 0.5, uncommon: 0.5 } },
  rare: { shape: 'pentagon', sides: 5, damage: 500, hp: 150, size: 24, weight: 50, drops: { uncommon: 0.8, rare: 0.2 } },
  epic: { shape: 'hexagon', sides: 6, damage: 700, hp: 1000, size: 30, weight: 100, drops: { uncommon: 0.06, rare: 0.8, epic: 0.14 } },
  legendary: { shape: 'septagon', sides: 7, damage: 1000, hp: 8000, size: 42, weight: 200, drops: { rare: 0.1, epic: 0.8, legendary: 0.1 } },
  mythic: { shape: 'octagon', sides: 8, damage: 2000, hp: 25000, size: 54, weight: 1000, drops: { epic: 0.07, legendary: 0.9, mythic: 0.03 } },
  ultra: { shape: 'nonagon', sides: 9, damage: 3000, hp: 300000, size: 68, weight: 50000, drops: { legendary: 0.845, mythic: 0.15, ultra: 0.005 } },
  super: { shape: 'decagon', sides: 10, damage: 7000, hp: 20000000, size: 90, weight: 100000, drops: { mythic: 0.77, ultra: 0.23 }, stars: 5000 },
};

// Body upgrades
export const BODY_UPGRADES = {
  inferno: {
    name: 'Inferno',
    damageByRarity: { common: 50, uncommon: 75, rare: 100, epic: 125, legendary: 200, mythic: 250, ultra: 500, super: 2000 },
    sizeMult: 1.05,
    sizeMultUltra: 1.07,
    sizeMultSuper: 1.10,
  },
  ziggurat: {
    name: 'Ziggurat',
    hpByRarity: { common: 200, uncommon: 300, rare: 400, epic: 500, legendary: 600, mythic: 1000, ultra: 2000, super: 10000 },
    speedPenalty: 0.9,
  },
  cutter: {
    name: 'Cutter',
    speedByRarity: { common: 0.05, uncommon: 0.075, rare: 0.1, epic: 0.125, legendary: 0.15, mythic: 0.2, ultra: 0.3, super: 0.5 },
    attackByRarity: { common: 0.02, uncommon: 0.04, rare: 0.08, epic: 0.16, legendary: 0.32, mythic: 0.64, ultra: 1.28, super: 2.56 },
  },
  hive: {
    name: 'Hive',
    description: 'Auto-aiming drones that take the shape of your equipped egg.',
    spawnersByRarity: { common: 4, uncommon: 8, rare: 16, epic: 16, legendary: 16, mythic: 16, ultra: 16, super: 16 },
    damageByRarity: { common: 10, uncommon: 25, rare: 40, epic: 80, legendary: 125, mythic: 200, ultra: 1000, super: 5000 },
    spawnInterval: 0.05,
    rangeMult: 2,
  },
};

// Tank upgrades
export const TANK_UPGRADES = {
  base: {
    name: 'Base',
    damageByRarity: { common: 10 },
    bulletSize: 15,
    bulletSpeed: 1,
    reload: 1000,
    bulletMaxRangeBase: 600,
    recoilMovePercent: 0.10,
    weightByRarity: { common: 0 },
  },
  destroyer: {
    name: 'Destroyer',
    damageByRarity: { common: 30, uncommon: 50, rare: 70, epic: 90, legendary: 125, mythic: 500, ultra: 1000, super: 5000 },
    bulletSize: 45,
    bulletSizeByRarity: { common: 35, uncommon: 40, rare: 45, epic: 55, legendary: 65, mythic: 80, ultra: 105, super: 135 },
    weightByRarity: { common: 1, uncommon: 2, rare: 3, epic: 4, legendary: 5, mythic: 6, ultra: 7, super: 8 },
    bulletSpeed: 1,
    reload: 1800,
    bulletMaxRangeBase: 1800,
    bulletHp: 50,
    recoilMovePercent: 0.24,
    recoilMovePercentByRarity: { common: 0.24, uncommon: 0.276, rare: 0.3174, epic: 0.365, legendary: 0.42, mythic: 0.483, ultra: 0.555, super: 0.639 },
  },
  anchor: {
    name: 'Anchor',
    damageByRarity: { common: 50, uncommon: 75, rare: 100, epic: 125, legendary: 250, mythic: 500, ultra: 1500, super: 5000},
    weightByRarity: { common: 1, uncommon: 2, rare: 3, epic: 4, legendary: 5, mythic: 6, ultra: 7, super: 8 },
    squareHp: 5000,
    squareDuration: 6000,
    squareDurationSuper: 12000,
    reload: 3000,
    maxSquares: 2,
    squareSize: 25,
    recoilMovePercent: 0.20,
    trapLaunchSpeed: 0.2,
  },
  riot: {
    name: 'Riot',
    damageByRarity: { common: 10, uncommon: 20, rare: 30, epic: 50, legendary: 75, mythic: 100, ultra: 200, super: 1000 },
    weightByRarity: { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 0, mythic: 0, ultra: 0, super: 0 },
    squareHp: 800,
    squareDuration: 10000,
    squareDurationSuper: 14000,
    reload: 500,
    reloadByRarity: { common: 500, uncommon: 450, rare: 405, epic: 364, legendary: 328, mythic: 295, ultra: 266, super: 239 },
    maxSquares: 9,
    squareSize: 14,
    recoilMovePercent: 0.08,
    trapLaunchSpeed: 0.22,
  },
  overlord: {
    name: 'Overlord',
    description: 'Controllable drones (follow mouse) that take the shape of your equipped egg.',
    damageByRarity: { common: 40, uncommon: 50, rare: 80, epic: 120, legendary: 250, mythic: 500, ultra: 1000, super: 5000 },
    droneCount: 8,
    droneCountUltra: 12,
    droneCountSuper: 12,
    reload: 25,
    // Drone size: +10% per rarity up to mythic; mythic→ultra +30%; ultra→super +50%
    droneSizeBase: 10,
    droneSizeByRarity: { common: 1, uncommon: 1.1, rare: 1.21, epic: 1.331, legendary: 1.4641, mythic: 1.61051, ultra: 2.093663, super: 3.1404945 },
  },
  streamliner: {
    name: 'Streamliner',
    description: 'Machine gun with no control',
    damageByRarity: { common: 5, uncommon: 10, rare: 15, epic: 20, legendary: 50, mythic: 100, ultra: 250, super: 1000 },
    bulletSize: 12,
    bulletSpeed: 0.5,
    reload: 50,
    bulletMaxRangeBase: 500,
    recoilMovePercent: 0.25,
    recoilMovePercentByRarity: { common: 0.1, uncommon: 0.15, rare: 0.2, epic: 0.25, legendary: 0.3, mythic: 0.35, ultra: 0.4, super: 0.5 },
  },
};

// Inferno base radius (20% bigger than original 60, then 2x)
export const INFERNO_BASE_RADIUS = 144;

// XP required per level (exponential, first 50 easy)
export function getXpForLevel(level) {
  if (level <= 1) return 0;
  const base = 50;
  return Math.floor(base * Math.pow(1.15, level - 1));
}

export const MAP_SIZE = 16000; // 60% smaller than 40000 (40% of original)
// Recoil: player moves backwards (opposite to shot direction). recoilMovePercent per tank defaults to 0.10 (10%).
export const RECOIL_MOVE_PERCENT = 0.10;
export const RECOIL_SPEED_SCALE = 100; // backward distance = projectileSpeed * RECOIL_SPEED_SCALE * recoilMovePercent

// Ice-slide movement: velocity-based with friction (all movement slides). Lower = more slide.
export const ICE_FRICTION_PER_SECOND = 0.09; // velocity multiplier per second (0.09 = lose 91% per sec, reduced slide)
export const MOVEMENT_ACCELERATION = 3;       // how fast we reach max speed (per second)
export const RECOIL_IMPULSE_MS = 180;         // recoil converts to velocity over this many ms (slide back)
export const BOUNCE_IMPULSE_FACTOR = 0.015;   // food collision adds this * (overlap * bounce) to velocity

export const SPAWN_ZONE = 3000;
// Food spawns in original map area only (unchanged density)
export const FOOD_SPAWN_HALF = 800; // half extent for food spawn (60% smaller, was 2000)
