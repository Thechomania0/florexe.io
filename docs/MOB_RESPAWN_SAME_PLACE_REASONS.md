# Why mobs can respawn in the same place (instant / 0 seconds after death)

Below are **all plausible reasons** the game can show a mob dying and another appearing at the same spot almost immediately. The most likely cause is **#1**; the rest are secondary or edge cases.

---

## 1. **Same-tick re-hit (server): bullet loop uses live arrays** — **MOST LIKELY**

**What happens:** In `server/gameTick.js`, bullet–mob collision loops over **the live** `m.foods` and `m.beetles`. When a mob is killed, `hitMob`:

- Removes it from the array (`splice`)
- Calls `spawnOneInRarityZone`, which **pushes a new mob** into the same array

So within the **same** `for (const food of m.foods)` (or beetles) loop, the iterator can later see that **newly spawned** mob. If the bullet is penetrating and still overlapping that position (or the replacement spawns in the same zone cell and is still inside the bullet), the bullet hits the replacement in the **same tick**, kills it, and spawns another. That can repeat in one tick → looks like "instant respawn in the same place."

**Why it looks like "same place":** The replacement is chosen by `getRandomPointInZoneForRarity(deadRarity)`. For a given rarity the zone can be small or a single cell, so the new position is often the same or very close to the death position. So the "respawn" is both instant (same tick) and in the same place (same zone cell).

**Fix:** Run bullet–mob collision against **snapshots** of the mob lists (e.g. `const foodsSnapshot = [...m.foods]`), like the square–mob code already does. Then newly spawned mobs are not considered in the same tick and cannot be re-hit immediately.

---

## 2. **Rarity zone is one or very few cells**

**What happens:** `getRandomPointInZoneForRarity(rarity, walls)` in `server/map.js` picks a **random cell** in the zone for that rarity, then a random point in that cell. If the zone has only **one cell** (or very few), almost every replacement spawn lands in that same cell → same (or nearly same) place.

**Worse:** The fallback after 100 failed wall checks is the **center of `cells[0]`**. So if the zone is a single valid cell, every replacement can get that exact point.

**Mitigation:** Enlarge rarity zones in the map data so each rarity has many cells, and/or add a minimum distance from the death position when choosing the respawn point (e.g. pass death coords and reject points too close).

---

## 3. **Death position not excluded for the replacement spawn**

**What happens:** `spawnOneInRarityZone` uses `getRandomPointInZoneForRarity` (random point in zone) and `isNearRecentDeath(room, x, y)` to avoid **other** recent deaths. It does **not** explicitly force the new spawn to be "far from **this** death." So the random point in the zone can still be the same cell (or very close) to where the mob just died.

**Mitigation:** When spawning the replacement, pass the death position and require a minimum distance (e.g. `MIN_DEATH_DISTANCE`) from it, or exclude that cell from the random choice.

---

## 4. **Trap (square) damages every tick**

**What happens:** A trap damages mobs every tick. The **square** loop already uses snapshots (`foodsSnapshot`, `beetlesSnapshot`), so the same-tick re-hit issue does **not** apply there. But if the **bullet** loop (see #1) spawns a replacement in the same spot, the **trap** can hit that new mob on the **next** tick. So you get: kill → replace in same cell → next tick trap kills again → replace again in same cell. That still looks like "respawn in same place" until the replacement is pushed out or the trap ends.

**Mitigation:** Fix #1 (snapshot in bullet loop) plus #2/#3 (spawn farther from death / larger zones) reduces how often the replacement lands under the same trap.

---

## 5. **Client applies an old snapshot after the kill**

**What happens:** Client receives `kill` (remove mob A) and later receives a **stale** `mobs` snapshot that still contains mob A (from before the kill). If the client applied the snapshot **after** the kill and didn't filter correctly, it could re-add A at the same position → looks like respawn.

**Current mitigation:** `lastMobsSeq` ignores older snapshots; `processedKillIds` filters out killed mobs from snapshot. So this is only plausible if there's a bug in ordering (e.g. snapshot emitted before kill but delivered after) or in the filter logic.

**Check:** Ensure `mobs` is emitted **after** `tick()` (so snapshot reflects post-kill state) and that client always applies `mobs` with `seq` and `processedKillIds` before applying `kill` when ordering is ambiguous.

---

## 6. **Duplicate hit from multiple bullets / same bullet multiple times**

**What happens:** Two bullets hit the same mob in one tick, or one bullet is counted twice. Then you could imagine double kill / double spawn.

**Current behavior:** `hitMob` removes the mob on first kill; a second call with the same `mobId` does `findIndex` and gets -1, so returns `{ killed: false }`. So only one kill and one replacement per mob. No double spawn from this.

**Exception:** If the **new** mob (new id) is hit in the same tick (see #1), that's not "duplicate hit" but "re-hit of the replacement."

---

## 7. **`getRandomPointInZoneForRarity` returns null and no replacement spawns**

**What happens:** If zones aren't loaded or the zone for that rarity is empty, `getRandomPointInZoneForRarity` returns `null`. Then `spawnOneInRarityZone` exits without adding a mob. So you get **no** replacement, not "respawn in same place."

**Conclusion:** This doesn't explain "instant respawn in same place"; it would explain a missing respawn. If the map/zones are broken, fix map loading and zone data.

---

## 8. **ID reuse or client merge by index**

**What happens:** If the client matched mobs by **index** instead of **id**, then after "remove mob at index 2" and "add new mob," the new mob could be drawn at the old slot's position.

**Current behavior:** Client uses **id** in `setMobsFromServer` (e.g. `existingFoodById.get(fid)`). New mob has a new id (`m.nextId++`). So position comes from server snapshot for that id. No index-based mix-up.

---

## 9. **Server snapshot includes dead mob**

**What happens:** `getMobsSnapshot` is called **after** `tick()`, and it filters with `f.hp > HP_DEAD_EPSILON`. So dead mobs are already removed before the snapshot. So the snapshot should never contain the dead mob.

**Conclusion:** Only a bug (e.g. snapshot taken before tick, or wrong filter) would cause this. Current flow (tick then getMobsPayload) is correct.

---

## 10. **RNG / "random" point is deterministic**

**What happens:** If `Math.random()` were deterministic (e.g. same seed), the "random" point in the zone could be the same every time.

**Reality:** In Node/browsers, `Math.random()` is not seeded by the game. So this is only plausible in tests or with a custom RNG. Not a typical cause.

---

## Summary

| # | Cause | Likely? | Fix / mitigation |
|---|--------|--------|-------------------|
| 1 | Same-tick re-hit: bullet loop uses live `m.foods`/`m.beetles`, replacement can be hit in same tick | **Yes** | Use snapshot arrays for bullet–mob collision (like square–mob) |
| 2 | Zone has one or few cells → same cell every time | Possible | Bigger zones; avoid single-cell zones for a rarity |
| 3 | Replacement spawn doesn't exclude death position | Possible | Require min distance from death or exclude death cell |
| 4 | Trap kills replacement next tick (replacement in same cell) | Follow-up of 1–3 | Same as 1–3 |
| 5 | Client applies old snapshot after kill | Unlikely | Ensure snapshot after tick; client seq/kill filter |
| 6 | Duplicate hit same mob | No | Already handled (one kill per id) |
| 7 | getRandomPointInZoneForRarity null → no spawn | No (would be no respawn) | Fix map/zones if needed |
| 8 | Client merge by index | No | Client uses id |
| 9 | Snapshot includes dead mob | No | Snapshot after tick, filtered by hp |
| 10 | Deterministic RNG | Rare | N/A in normal setup |

**Recommended first step:** Fix **#1** by making bullet–mob collision use snapshot copies of `m.foods` and `m.beetles` so the replacement cannot be hit in the same tick. Then, if "same place" still happens, improve spawn placement (#2–3).
