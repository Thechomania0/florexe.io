const path = require('path');
const express = require('express');
const session = require('express-session');
const { findOrCreateUser, setUsername, getUserByDiscordId, listUsersByCreation, getProgress, saveProgress } = require('./store.js');

const app = express();
const PORT = process.env.PORT || 53134;

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || '';
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || '';
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const SESSION_SECRET = process.env.SESSION_SECRET || 'florexe-session-secret-change-in-production';
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'florexe-admin-secret-change-me';

app.use(express.json());
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: process.env.NODE_ENV === 'production', httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 },
  })
);

app.use(express.static(path.join(__dirname, '..')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});

app.get('/map-editor.html', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'map-editor.html'));
});

app.get('/auth/discord', (req, res) => {
  if (!DISCORD_CLIENT_ID) {
    return res.status(500).send('Discord OAuth not configured. Set DISCORD_CLIENT_ID.');
  }
  const redirectUri = `${BASE_URL}/auth/discord/callback`;
  const scope = 'identify';
  const url = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scope)}`;
  res.redirect(url);
});

app.get('/auth/discord/callback', async (req, res) => {
  const { code } = req.query;
  if (!code || !DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET) {
    return res.redirect('/?auth=error');
  }
  const redirectUri = `${BASE_URL}/auth/discord/callback`;
  try {
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    });
    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      console.error('Discord token error', tokenRes.status, err);
      return res.redirect('/?auth=error');
    }
    const tokenData = await tokenRes.json();
    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { authorization: `${tokenData.token_type} ${tokenData.access_token}` },
    });
    if (!userRes.ok) return res.redirect('/?auth=error');
    const discordUser = await userRes.json();
    const { user, created } = findOrCreateUser(
      discordUser.id,
      discordUser.username,
      discordUser.avatar
    );
    req.session.discordId = user.discordId;
    req.session.needsUsername = !user.username;
    if (created) req.session.justSignedUp = true;
    res.redirect('/');
  } catch (e) {
    console.error('Discord callback error', e);
    res.redirect('/?auth=error');
  }
});

app.get('/auth/logout', (req, res) => {
  req.session.destroy(() => {});
  res.redirect('/');
});

app.get('/api/me', (req, res) => {
  if (!req.session.discordId) {
    return res.json({ loggedIn: false });
  }
  const user = getUserByDiscordId(req.session.discordId);
  if (!user) {
    req.session.destroy(() => {});
    return res.json({ loggedIn: false });
  }
  res.json({
    loggedIn: true,
    discordId: user.discordId,
    username: user.username,
    needsUsername: !user.username,
    discordUsername: user.discordUsername,
  });
});

app.post('/api/username', (req, res) => {
  if (!req.session.discordId) return res.status(401).json({ ok: false, error: 'Not logged in' });
  const { username } = req.body;
  if (username == null || typeof username !== 'string') {
    return res.status(400).json({ ok: false, error: 'Username required' });
  }
  const ok = setUsername(req.session.discordId, username);
  if (ok) req.session.needsUsername = false;
  res.json({ ok, error: ok ? null : 'Invalid or empty username' });
});

app.get('/api/progress', (req, res) => {
  if (!req.session.discordId) return res.status(401).json({ error: 'Not logged in' });
  const progress = getProgress(req.session.discordId);
  res.json(progress || {});
});

app.post('/api/progress', (req, res) => {
  if (!req.session.discordId) return res.status(401).json({ error: 'Not logged in' });
  const body = req.body || {};
  saveProgress(req.session.discordId, {
    inventory: Array.isArray(body.inventory) ? body.inventory : [],
    hand: Array.isArray(body.hand) ? body.hand : [],
    equippedTank: body.equippedTank || null,
    equippedBody: body.equippedBody || null,
    level: typeof body.level === 'number' ? body.level : 1,
    xp: typeof body.xp === 'number' ? body.xp : 0,
    stars: typeof body.stars === 'number' ? body.stars : 0,
    score: typeof body.score === 'number' ? body.score : 0,
  });
  res.json({ ok: true });
});

app.get('/admin/users', (req, res) => {
  const key = req.query.key || req.headers['x-admin-key'];
  if (key !== ADMIN_SECRET) {
    return res.status(403).send('Forbidden');
  }
  const users = listUsersByCreation();
  const format = req.query.format || 'html';
  if (format === 'json') {
    return res.json(users);
  }
  if (format === 'csv') {
    const header = 'Created,Discord ID,Username,Discord Username\n';
    const rows = users.map(
      (u) =>
        `${u.createdAt},${u.discordId},${(u.username || '').replace(/,/g, ' ')},${(u.discordUsername || '').replace(/,/g, ' ')}`
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="florexe-users.csv"');
    return res.send(header + rows.join('\n'));
  }
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Florexe users</title><style>
    body{font-family:sans-serif;margin:1rem;} table{border-collapse:collapse;} th,td{border:1px solid #ccc;padding:6px 10px;text-align:left;}
    th{background:#eee;}
  </style></head><body>
  <h1>Users (by account creation)</h1>
  <p><a href="?key=${encodeURIComponent(key)}&format=csv">Download CSV</a></p>
  <table>
  <tr><th>#</th><th>Created</th><th>Discord ID</th><th>Username</th><th>Discord Username</th></tr>
  ${users
    .map(
      (u, i) =>
        `<tr><td>${i + 1}</td><td>${u.createdAt}</td><td>${u.discordId}</td><td>${escapeHtml(u.username || '')}</td><td>${escapeHtml(u.discordUsername || '')}</td></tr>`
    )
    .join('')}
  </table></body></html>`;
  res.send(html);
});

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

app.listen(PORT, () => {
  console.log(`Florexe server at http://localhost:${PORT}`);
  if (!DISCORD_CLIENT_ID) console.warn('Set DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET for Discord login.');
});
