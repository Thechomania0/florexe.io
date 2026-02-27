# Custom map storage

**Default map** = what new users see when cache is cleared / new device enters the game.

## Set your map as the default

1. Open **Map editor** (admin only).
2. Draw or import your map.
3. Select the gamemode (FFA, 2TDM, etc.).
4. Add your GitHub token in "Store maps on GitHub".
5. Click **Save as default** – this updates `data/custom-map.json` in your repo via the GitHub API.

Your map then becomes the default for new users.

## Manual method (without GitHub token)

1. Draw your map in the map editor.
2. Click **Export for repo** to download `custom-map.json`.
3. Replace `data/custom-map.json` (this folder) with the downloaded file.
4. Commit and push to GitHub.

The game loads `data/custom-map.json` when localStorage has no map.
