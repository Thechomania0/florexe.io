# Florexe.io

A tank-based .io game combining elements of **Diep.io**, **Scenexe.io**, and **Florr.io**. https://thechomania0.github.io/florexe.io/

## How to Play

1. Choose a gamemode: -> only have 1 for now, will add more later on.
3. **WASD** to move, **mouse** to aim.
4. Destroy shapes (food) to gain XP, level up, and collect upgrade drops.
5. Click inventory items to equip Body and Tank upgrades.
6. Collect 5 of the same upgrade, then **Craft** to attempt upgrading rarity.

## Rarities (Common → Super)

- Common (green) → Uncommon (yellow) → Rare (blue) → Epic (purple) → Legendary (red) → Mythic (blue cyan) → Ultra (fuchsia) → Super (green cyan)

## Body Upgrades

| Upgrade | Effect |
|---------|--------|
| **Inferno** | Damaging ring around you, heals teammates |
| **Ziggurat** | +HP, damage reduction, -10% speed |
| **Cutter** | +Speed, +Attack, -20% HP |
| **Hive** | Auto-aiming drones that take the shape of your equipped egg |

## Tank Upgrades

| Upgrade | Effect |
|---------|--------|
| **Destroyer** | Big slow bullet |
| **Anchor** | Throws square turrets |
| **Riot** | 3 stacked square turrets |
| **Overlord** | Controllable drones (follow mouse) that take the shape of your equipped egg |

## Food Shapes

Triangles (common) → Squares → Pentagons → Hexagons → Septagons → Octagons → Nonagons → Decagons (super). Bigger shapes = more HP, more damage on collision, better drops.

## Crafting

Combine 5 of the same upgrade (e.g. 5 Common Destroyers). Success rates: Common→Uncommon 60%, then decreasing. On failure, lose 1–4 of the 5 items. Hold **Shift+Click** for mass-craft (future).

## Deploy to Railway (frontend + backend)

One Railway service serves both the static frontend and the Node backend (Express + Socket.io).

1. **Create a project** at [railway.app](https://railway.app) and connect this repo.
2. **New service** → Deploy from GitHub repo → select this repository. Railway will use the root as the service root and run `npm start` (see `railway.toml`).
3. **Variables** (optional): set `PORT` if needed; Railway sets it automatically.
4. **Generate domain**: in the service → Settings → Networking → Generate Domain. You get a URL like `https://florexeio-production.up.railway.app`. Opening that URL serves the game; API and Socket.io use the same origin.
5. **Custom domain** (optional): add your own domain in Networking and point DNS to Railway. Then update `index.html` or CORS if you use a different front domain.

No separate frontend deploy: the same Node app serves `index.html`, `js/`, `css/`, etc., and the `/api/*` and Socket.io endpoints.
