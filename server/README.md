# Florexe.io server

Optional Node server for **Discord login**, **saved usernames**, and **permanent progress** (inventory, level, stars, etc.).

## Run

```bash
npm install
npm start
```

Default port: **3000**. Open http://localhost:3000

If you serve the game from another port (e.g. Live Server on 5500), either run the server on that port (`PORT=5500 npm start`) or open the game with `?api=http://localhost:3000` so login and progress use the API on 3000.

## Environment variables

| Variable | Description |
|----------|-------------|
| `PORT` | Server port (default 3000) |
| `BASE_URL` | Full base URL for OAuth redirects (e.g. `http://localhost:3000` or `https://yoursite.com`) |
| `DISCORD_CLIENT_ID` | Discord Application Client ID |
| `DISCORD_CLIENT_SECRET` | Discord Application Client Secret |
| `SESSION_SECRET` | Secret for session cookies (change in production) |
| `ADMIN_SECRET` | Secret to view the user list (see below) |

## Discord OAuth setup

1. Go to [Discord Developer Portal](https://discord.com/developers/applications) → create an application.
2. **OAuth2** → Redirects: add `http://localhost:3000/auth/discord/callback` (and your production URL when you deploy).
3. Copy **Client ID** and **Client Secret** into `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET`.

## Admin user list (“spreadsheet”)

Only you can see the list. Open:

- **HTML table:** `https://yoursite.com/admin/users?key=YOUR_ADMIN_SECRET`
- **CSV download:** `https://yoursite.com/admin/users?key=YOUR_ADMIN_SECRET&format=csv`
- **JSON:** `https://yoursite.com/admin/users?key=YOUR_ADMIN_SECRET&format=json`

Users are ordered by **account creation** (oldest first). Columns: Created, Discord ID, Username, Discord Username.

Set `ADMIN_SECRET` to a long random string and keep it private.

## Data

- **server/data/users.json** – Discord id, chosen username, created date.
- **server/data/progress.json** – Per-user progress (inventory, level, stars, etc.).

These files are created automatically. Add `server/data/*.json` to `.gitignore` so they are not committed.
