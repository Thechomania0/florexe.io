# Custom map storage

To make your drawn map **permanent** across link changes, deploys, and devices:

1. Open **Map editor** (link from the game menu).
2. Draw your map and click **Save and confirm implementation** (saves to this browser only).
3. Click **Export for repo** to download `custom-map.json`.
4. Put the downloaded file here as `data/custom-map.json` (this folder).
5. Commit and push to GitHub.

The game will load this map whenever the browser has no saved map (e.g. first visit, new device, or after clearing site data). To change the map later, edit in the map editor, export again, replace this file, and push.

Do not add `custom-map.json` to the repo if you want to use the default built-in map.
