# Where User Data Is Stored

## Usernames and Discord Login Info

### 1. Server-side (for unique usernames)

**File: `server/data/users.json`**

- Stores all registered usernames for uniqueness.
- Format: `{ "username_lowercase": "discordId" }`
- Example: `{ "thechomania": "123456789012345678" }`
- Only you (the server operator) can see this file on your machine.
- This is the **document that keeps usernames** (for global uniqueness).

### 2. Browser localStorage (per-user, on their device)

**Keys:**
- `florexe_auth` — Discord OAuth token and user info (username, id, avatar, etc.)
- `florexe_username` — Display name chosen by the user
- `florexe_admin_color` — Admin name color (admins only)

**Discord login info** (access token, user id, avatar, etc.) lives in `florexe_auth` inside the user's browser. It is **never stored on the server** for security.

---

## Summary

| Data               | Location                    | Who can see it              |
|--------------------|-----------------------------|-----------------------------|
| Username registry  | `server/data/users.json`    | You (server operator)       |
| Discord login info | Browser `localStorage`      | Only the logged-in user     |
| Display name       | Browser `localStorage`      | Only the logged-in user     |
