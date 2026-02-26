# Tank & body icons (single source of truth)

All in-game tank visuals and UI item icons use these image files. Edit the SVGs here to change how guns and bodies look everywhere.

## Layout

- **`guns/`** – Tank weapons only (no body). Used for the gun layer in-game and for tank slots in the UI.
  - `destroyer.svg`, `anchor.svg`, `riot.svg`, `overlord.svg`
  - Draw with the barrel pointing **right** (positive x). ViewBox is `0 0 48 48`; center is (24, 24).

- **`bodies/`** – Body only (no gun). Used for the body layer in-game and for body slots in the UI.
  - `default.svg` – Plain circle when no body is equipped.
  - `inferno.svg`, `ziggurat.svg`, `cutter.svg`, `hive.svg`
  - Center the body at (24, 24) in a 48×48 viewBox.

## In-game drawing

The player tank is drawn by layering:

1. **Body image** (from `bodies/` by equipped body, or `default.svg`)
2. **Gun image** (from `guns/` by equipped tank)

Both use the same scale and rotation, so the gun appears on top of the body.

## Why UI icons can look different from in-game

- **Same assets, different use:** The UI shows one icon per slot (gun or body). In-game the tank is the **body layer + gun layer** drawn on top of each other, so the combined look can differ from a single slot icon.
- **Base + Node:** The default tank (base gun + node body) is always drawn with **canvas fallback** (not these SVGs) so the gun barrel protrudes correctly and stays visible; the UI still uses `guns/base.svg` and `bodies/node.svg` for the slots.
- **Riot:** The gun icon is the Riot weapon only (blue circle + three trapezoids). In-game it’s drawn with the same design in the fallback; the slot may look different due to size or layering in the UI.
- **No background:** All SVGs here are transparent (no white or solid background).

## Body icons by rarity (Cutter & Hive)

- **`rarities/bodies-rarity/cutter-rarity/`** – Cutter body icons. The game always uses these 8 files for Cutter (inventory, crafting, equipping, shop, item drops): `common_cutter.svg`, `uncommon_cutter.svg`, `rare_cutter.svg`, `epic_cutter.svg`, `legendary_cutter.svg`, `mythic_cutter.svg`, `ultra_cutter.svg`, `super_cutter.svg`. Do not use `bodies/cutter.svg` for Cutter in the UI; use only these files.
- **`rarities/bodies-rarity/hive-rarity/`** – Hive body icons. The game always uses these 8 files for Hive (inventory, crafting, equipping, shop, item drops): `common_hive.svg`, `uncommon_hive.svg`, `rare_hive.svg`, `epic_hive.svg`, `legendary_hive.svg`, `mythic_hive.svg`, `ultra_hive.svg`, `super_hive.svg`. Do not use `bodies/hive.svg` for Hive in the UI; use only these files.
