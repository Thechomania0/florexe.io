# Florexe.io server

Simple Express server for the game and Discord login (implicit OAuth flow per cindr.org tutorial).

## Run

```bash
npm install
npm start
```

Default port: **53134**. Open http://localhost:53134

## Discord OAuth setup

1. Go to [Discord Developer Portal](https://discord.com/developers/applications) → create an application.
2. **OAuth2** → Redirects: add `http://localhost:53134/auth/discord`
3. **OAuth2** → Redirects: generate the authorization URL and copy it.
4. In your `index.html` Login link `href`, use that URL but **change `response_type=code` to `response_type=token`** (implicit flow).

Flow: index (Login) → Discord → `/auth/discord` (dashboard.html) with token in URL hash. Dashboard reads the hash, fetches user from Discord API, displays username and avatar.
