# Why mobs can respawn in the same place (instant / 0 seconds after death)

Below are **all plausible reasons** the game can show a mob dying and another appearing at the same spot almost immediately. The most likely cause is **#1**; the rest are secondary or edge cases.

---

## 1. **Same-tick re-hit (server): bullet loop uses live arrays** — **MOST LIKELY**

**What happens:** In `server/gameTick.js`, bullet–mob collision was using a snapshot of `m.foods` and `m.beetles`, but the snapshot was taken **inside** the `for (const bullet of bullets)` loop. So for each bullet we got a fresh copy that included any mob just spawned by a previous bullet in the same tick. With many projectiles (e.g. a dense barrage), bullet 1 kills the mob and spawns a replacement; bullets 2, 3, … then hit that replacement, it dies and spawns again, and so on in one tick → "instant respawn in the same place" at machine-gun rate.

**Fix (implemented):** Take the mob snapshot **once** before the bullet loop (`const foodsSnapshot = [...m.foods]; const beetlesSnapshot = [...m.beetles];`), not inside it. Then all bullets in that tick only see mobs that existed at the start of the tick; replacements cannot be hit until the next tick.

---

## 2. **Rarity zone is one or very few cells**

**What happens:** `getRandomPointInZoneForRarity(rarity, walls)` in `server/map.js` picks a **random cell** in the zone for that rarity, then a random point in that cell. If the zone has only **one cell** (or very few), almost every replacement spawn lands in that same cell → same (or nearly same) place.

**Worse:** The fallback after 100 failed wall checks is the **center of `cells[0]`**. So if the zone is a single valid cell, every replacement can get that exact point.

**Mitigation (implemented):** Replacement spawn now passes the death position as an exclude point with `minDistFromExclude: MIN_DEATH_DISTANCE`. `getRandomPointInZoneForRarity` accepts optional `options: { excludeX, excludeY, minDistFromExclude }` and only returns a point at least that far from the death spot. When exclude is set, the fallback to `cells[0]` is disabled (returns null) so we never spawn on the death spot. Retries increased to 200 when exclude is used.

---

## 3. **Death position not excluded for the replacement spawn**

**What happens:** `spawnOneInRarityZone` uses `getRandomPointInZoneForRarity` (random point in zone) and `isNearRecentDeath(room, x, y)` to avoid **other** recent deaths. It does **not** explicitly force the new spawn to be "far from **this** death." So the random point in the zone can still be the same cell (or very close) to where the mob just died.

**Mitigation (implemented):** `spawnOneInRarityZone(room, deadRarity, spawnType, deathX, deathY)` now takes the death position. It passes `{ excludeX: deathX, excludeY: deathY, minDistFromExclude: MIN_DEATH_DISTANCE }` to `getRandomPointInZoneForRarity`, so the replacement is always at least 800 units from the death. `hitMob` captures `food.x`/`food.y` (and beetle) before splicing and passes them in.

---

## 4. **Trap (square) damages every tick**

**What happens:** A trap damages mobs every tick. The **square** loop already uses snapshots (`foodsSnapshot`, `beetlesSnapshot`), so the same-tick re-hit issue does **not** apply there. But if the **bullet** loop (see #1) spawns a replacement in the same spot, the **trap** can hit that new mob on the **next** tick. So you get: kill → replace in same cell → next tick trap kills again → replace again in same cell. That still looks like "respawn in same place" until the replacement is pushed out or the trap ends.

**Mitigation:** Fix #1 (snapshot in bullet loop) plus #2/#3 (spawn farther from death / larger zones) reduces how often the replacement lands under the same trap.

---

## 5. **Client applies an old snapshot after the kill**

**What happens:** Client receives `kill` (remove mob A) and later receives a **stale** `mobs` snapshot that still contains mob A (from before the kill). If the client applied the snapshot **after** the kill and didn't filter correctly, it could re-add A at the same position → looks like respawn.

**Current mitigation (implemented):** Server takes mobs snapshot **after** `tick()` (comment in `startGameTick`). Client uses `lastMobsSeq` to ignore older snapshots and `processedKillIds` to filter out killed mobs from snapshot. `applyKillReward` removes the mob by id immediately. Emit order: mobs → bullets → squares → kill, so snapshot always reflects post-tick state.

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
| 1 | Same-tick re-hit: snapshot was **per bullet** so replacement could be hit by next bullets in same tick | **Yes** | **Done:** Take snapshot once before bullet loop, not inside it |
| 2 | Zone has one or few cells → same cell every time | Possible | **Done:** exclude death point + minDist in getRandomPointInZoneForRarity; no fallback when exclude set |
| 3 | Replacement spawn doesn't exclude death position | Possible | **Done:** spawnOneInRarityZone(deathX, deathY), map rejects points &lt; MIN_DEATH_DISTANCE |
| 4 | Trap kills replacement next tick (replacement in same cell) | Follow-up of 1–3 | Addressed by #2–3 (replacement spawns away from death) |
| 5 | Client applies old snapshot after kill | Unlikely | **Done:** snapshot after tick (comment); emit order mobs then kill; client seq + processedKillIds |
| 6 | Duplicate hit same mob | No | Already handled (one kill per id) |
| 7 | getRandomPointInZoneForRarity null → no spawn | No (would be no respawn) | Fix map/zones if needed |
| 8 | Client merge by index | No | Client uses id |
| 9 | Snapshot includes dead mob | No | Snapshot after tick, filtered by hp |
| 10 | Deterministic RNG | Rare | N/A in normal setup |

**Recommended first step:** Fix **#1** by making bullet–mob collision use snapshot copies of `m.foods` and `m.beetles` so the replacement cannot be hit in the same tick. Then, if "same place" still happens, improve spawn placement (#2–3).
