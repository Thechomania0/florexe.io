# Multiplayer (Phase 1)

Multiplayer is implemented so you can **see other players** in the same arena when playing on a server (e.g. florexe.io with the Railway backend).

## How it works

- **Server**: Socket.io is attached to the same HTTP server as the Express API. When you join, you are added to a room by gamemode (`ffa`, etc.). The server stores each client’s last state and broadcasts the full list of players in the room to everyone (including the sender).
- **Client**: When the game starts and `FLOREXE_API_URL` is set, the client loads the Socket.io ESM client from CDN, connects to the server, and:
  - Emits `join` with gamemode and initial state (position, angle, hp, level, displayName, equippedTank, equippedBody, size).
  - Listens for `players`: replaces `game.otherPlayers` with the list (excluding our own socket id).
  - Every 100ms emits `state` with the current player state.
- **Rendering**: Other players are drawn in `Game.draw()` as a circle, barrel, and name label. Food, beetles, and bullets remain client-side (each client has its own PvE world).

## What is synced

- Position (`x`, `y`), `angle`, `hp`, `maxHp`, `level`, `displayName`, `equippedTank`, `equippedBody`, `size`.

## What is not synced (Phase 1)

- Food, beetles, drops (each client has its own instances).
- Bullets from other players (no PvP yet).
- Combat between players.

## Possible next steps (Phase 2+)

- Server-authoritative world: server runs or owns food/beetle spawns and removal so everyone sees the same world.
- PvP: sync bullets and damage between players.
- Interpolation: smooth other players’ movement between state updates.

## Running locally

1. Start the server: `npm start` (runs Express + Socket.io on the same port).
2. Open the game with the API URL set (e.g. `?api=http://localhost:53134` or run the app from the server origin).
3. Open a second tab/window and join the same gamemode; you should see the other client as a tank with a name.
