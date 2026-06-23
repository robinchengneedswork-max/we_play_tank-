# Sprint Plan — Maps & Terrain

Goal: replace the single hard-coded arena with a **tile-based map system** and a **library of varied
maps**, and add terrain types beyond the solid block — starting with **holes** (block movement, shoot
*over*). Maps should rotate so each wave/session feels different, on phone and laptop alike.

## Baseline (what exists today, in `web/`)

- `layoutObstacles()` (`state.js`) hard-codes **3 proportional rectangles** into `obstacles`
  (`{x,y,w,h}`), rebuilt on every `resize()`. Same layout for every wave, both modes.
- Obstacles are **solid blocks**, used in four places:
  - `reflectStep()` (`logic.js`) — shells **bounce** off them.
  - player movement + `moveEnemy()` — tanks **push out** of them (circle-vs-AABB).
  - `randSpawnPos()` — spawns avoid them.
  - `segBlocked()` / `bankAim()` — they block **line of sight** (predict aim + bank shots).
- The **grid is purely cosmetic** — `render()` draws lines every 34px, independent of obstacles.
- `FRAME` (18px) is the wall inset; the playfield is `FRAME … W-FRAME` × `FRAME … H-FRAME`.

## Terrain types

| Type | Drive over | Shoot over | Shell bounces | Blocks line-of-sight | Notes |
|------|-----------|-----------|---------------|----------------------|-------|
| **floor** | ✅ | ✅ | — | ❌ | default empty cell |
| **block** | ❌ | ❌ | ✅ | ✅ | today's solid obstacle |
| **hole** | ❌ | ✅ (over) | ❌ | ❌ | new — drive-block, shoot-through; LOS is clear |
| *crate* (M3) | ❌ | ❌ (until broken) | ✅ → gone | ✅ → clear | destructible; breaks after N hits |
| *water* (M3) | ❌ | ✅ | ❌ | ❌ | cosmetic hole variant |

The **hole** is the crux: it must be **excluded** from `reflectStep` (shells pass), from
`segBlocked`/`bankAim` (AI can see + shoot across it), but **included** in movement push-out
(tanks can't cross). Getting this split right is most of M1.

## Map representation

Author maps as **ASCII tilemaps** — arrays of equal-length strings, one char per cell:

```
'.' floor   '#' block   'O' hole   'S' player spawn   'e' enemy spawn zone
```

```js
// example 16×9 map
[ "################",
  "#..............#",
  "#..##....OO....#",
  "#..##....OO..e.#",
  "#.....S........#",
  "#..e....OO..##.#",
  "#........OO.##.#",
  "#..............#",
  "################" ]
```

**Decision (recommend): fixed grid `COLS×ROWS` (~16×9) stretched to the playfield.** Authored layouts
stay consistent across screens; cells are slightly non-square on odd aspect ratios — acceptable.
Cell size = `(W-2·FRAME)/COLS` × `(H-2·FRAME)/ROWS`. (Alternative: square cells with
arena-derived COLS/ROWS — keeps cells square but makes authored maps reflow; rejected for v1.)

**Collision from tiles:** don't collide against individual cells (seams cause snagging). Instead,
**merge adjacent same-type cells into rectangles** (greedy) at load time → reuse the existing
rect-based `reflectStep` / push-out / `segBlocked` against those merged rects. Keep the grid only for
authoring + rendering. This makes M0 a near drop-in for today's rect code.

---

## Tickets

### M0 — Tilemap foundation (enabling refactor) · 5 pts
- Define terrain constants + the tilemap legend; a `MAPS` array (start with one entry).
- `buildMap(def)`: parse a tilemap → a grid + **merged collision rects per terrain**
  (`blockRects`, later `holeRects`) + cell size + spawn points.
- Replace `layoutObstacles()` with `loadMap(def)`; **convert today's 3-block layout into a tilemap**
  so nothing changes.
- Point `reflectStep`, movement push-out, `randSpawnPos`, `segBlocked` at `blockRects` (rename
  `obstacles` → `blockRects` or keep alias).
- Align the **cosmetic grid to the tile grid** in `render`.
- Acceptance: the current arena is reproduced from a tilemap; **zero gameplay change**.

### M1 — Holes · 3 pts
- Add the `hole` type → `holeRects`. Movement push-out includes `holeRects`; `reflectStep`,
  `segBlocked`/`bankAim` **ignore** them.
- Render holes as sunken/dark cells (distinct from raised blocks).
- Acceptance: tanks can't cross holes; shells fly over and hit tanks beyond; predict/bank AI shoots
  **across** holes (doesn't treat them as cover); bank shots never bank off a hole edge.

### M2 — Map library + selection · 5 pts
- Author **6–10 varied maps**: open field, central cross, four quadrants, corridor/maze-lite,
  hole gauntlet, bank-shot gallery, perimeter cover, diagonal lanes.
- **Roguelike**: load a fresh map each wave from a shuffled pool (no immediate repeat); spawn the
  warp-in enemies + player on valid `floor` cells (respect `S`/`e` hints; never spawn trapped).
- **Sandbox**: a "next map" control (HUD button or in the ⚙ panel) to cycle maps for testing.
- Acceptance: maps visibly vary wave-to-wave; no soft-locks (player reachable, enemies reachable),
  verified across a phone-landscape and a laptop aspect ratio.

### M3 — More terrain & nav polish (stretch) · 8 pts
- **Destructible crates** (break after N hits; later: drop pickups/upgrades — ties into the
  roguelike loop). **Water** (cosmetic hole). Optional one-way cover.
- **Enemy nav**: simple steering so enemies don't wedge behind blocks (they have *no* pathfinding
  today — they push out and can get stuck). Even a "slide along the wall toward target" nudge helps.
- Map-aware spawn weighting / per-biome map sets.

---

## Sequencing & estimates
- **M0 → M1 → M2**, M3 optional. Rough totals: M0 **5**, M1 **3**, M2 **5**, M3 **8** ≈ **21 pts**.
- Suggested first sprint = **M0 + M1 + M2 (~13 pts)** → varied maps with holes, end to end.

## Verification (per `CLAUDE.md` Phase 4 — pure logic where possible)
- Unit-testable: `buildMap` (tilemap → correct merged rects + spawns), terrain queries
  (`isDriveBlocked`/`isShotBlocked` per type), spawn-validity (no spawn inside block/hole),
  map-rotation (no immediate repeat).
- Manual playtest: drive into a hole (blocked), shoot a tank across a hole (hits), watch a Green
  snipe across a hole (should), confirm no enemies spawn trapped on each library map.

## Risks / decisions to surface
- **Hole vs LOS/bounce split** — the one thing most likely to be wrong; covered by M1 acceptance.
- **No enemy pathfinding** — dense/maze maps will trap enemies. Keep early library maps **open**;
  defer real nav to M3. Flag any map that wedges enemies in playtest.
- **Collision seams** — collide against *merged* rects, not per-cell, or tanks snag on tile borders.
- **Spawn safety** — denser maps shrink valid spawn area; `randSpawnPos` must reject block/hole cells
  and keep distance from the player; fall back gracefully.
- **Aspect ratio** — fixed COLS×ROWS stretches cells; confirm readability/feel on Pixel-landscape
  vs laptop. Revisit square-cell option only if it feels bad.
- **Readability** — floor/block/hole (and later crate/water) must stay distinct on the warm board;
  may need outline/shadow cues, not just fill colour.
- **Grid unification** — once tiles drive layout, the cosmetic 34px grid should become the tile grid
  (one source of truth) rather than two overlapping grids.
