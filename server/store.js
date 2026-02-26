const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const PROGRESS_FILE = path.join(DATA_DIR, 'progress.json');

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readUsers() {
  ensureDir();
  try {
    const data = fs.readFileSync(USERS_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

function writeUsers(users) {
  ensureDir();
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
}

/** Get or create user by Discord id. Returns { user, created } (created = true if new). */
function findOrCreateUser(discordId, discordUsername, discordAvatar) {
  const users = readUsers();
  let user = users.find((u) => u.discordId === discordId);
  let created = false;
  if (!user) {
    user = {
      discordId,
      discordUsername: discordUsername || '',
      discordAvatar: discordAvatar || '',
      username: null,
      createdAt: new Date().toISOString(),
    };
    users.push(user);
    writeUsers(users);
    created = true;
  } else {
    if (discordUsername != null) user.discordUsername = discordUsername;
    if (discordAvatar != null) user.discordAvatar = discordAvatar;
    writeUsers(users);
  }
  return { user, created };
}

function setUsername(discordId, username) {
  const users = readUsers();
  const user = users.find((u) => u.discordId === discordId);
  if (!user) return false;
  const trimmed = String(username).trim().slice(0, 50);
  if (!trimmed) return false;
  user.username = trimmed;
  writeUsers(users);
  return true;
}

function getUserByDiscordId(discordId) {
  return readUsers().find((u) => u.discordId === discordId);
}

/** List all users by creation order (oldest first). For admin spreadsheet. */
function listUsersByCreation() {
  return readUsers().slice().sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

function readProgress() {
  ensureDir();
  try {
    const data = fs.readFileSync(PROGRESS_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

function writeProgress(progressMap) {
  ensureDir();
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progressMap, null, 2), 'utf8');
}

function getProgress(discordId) {
  const map = readProgress();
  return map[discordId] || null;
}

function saveProgress(discordId, progress) {
  const map = readProgress();
  map[discordId] = {
    ...progress,
    savedAt: new Date().toISOString(),
  };
  writeProgress(map);
}

module.exports = {
  findOrCreateUser,
  setUsername,
  getUserByDiscordId,
  listUsersByCreation,
  getProgress,
  saveProgress,
};
