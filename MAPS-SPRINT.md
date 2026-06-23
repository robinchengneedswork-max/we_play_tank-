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

A map is an **object** — the tile grid plus metadata (name, spawn style):

```js
{ name:'Crossfire', spawn:'warp', grid:[
  "................",
  "...##....OO.....",
  "...##....OO..e..",
  ".....S..........",
  "..e.....OO..##..",
  ".........OO.##..",
  "................" ] }
```

(The outer wall is the `FRAME`, drawn by the engine — maps don't need a border row.)

**Decisions baked in:**
- **Fixed grid `COLS×ROWS` (~16×9) stretched to the playfield.** Authored layouts stay consistent
  across screens; cells slightly non-square on odd aspect ratios — acceptable. Cell size =
  `(W-2·FRAME)/COLS` × `(H-2·FRAME)/ROWS`.
- **No drawn grid.** Cells exist only to author + collide; the player never sees a grid.

### Spawn style (per map)
- **`'warp'` (default):** the standard flow — clear wave → upgrade pick → **in-between screen**
  (countdown) → enemies **clean-spawn in place** (warp-in, today's behaviour). Use for most maps.
- **`'siege'` (defend-the-Alamo):** waves **spawn off-screen and drive in** from the edges instead of
  warping in place. The map should keep its **edges open** so they can enter. The between-wave
  upgrade pick still happens (preserve roguelike progression), but there's no in-place warp-in — the
  pressure comes from tanks pouring in. Optional later: stream them in continuously for true siege
  feel (open question — see below).

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
- **Remove the cosmetic grid lines** from `render`. The tile grid is an **internal authoring aid
  only** (for building maps) — never drawn. The board reads as a clean surface with terrain on it.
- Acceptance: the current arena is reproduced from a tilemap; **zero gameplay change** (minus the
  now-removed grid lines).

### M1 — Holes · 3 pts
- Add the `hole` type → `holeRects`. Movement push-out includes `holeRects`; `reflectStep`,
  `segBlocked`/`bankAim` **ignore** them.
- Render holes as sunken/dark cells (distinct from raised blocks).
- Acceptance: tanks can't cross holes; shells fly over and hit tanks beyond; predict/bank AI shoots
  **across** holes (doesn't treat them as cover); bank shots never bank off a hole edge.

### M2 — Map library + selection + spawn styles · 6 pts
- Author **6–10 varied maps**, a mix of `warp` and a few `siege`: open field, central cross, four
  quadrants, corridor/maze-lite, hole gauntlet, bank-shot gallery, perimeter cover, diagonal lanes,
  plus 1–2 open-edged **siege** arenas.
- **Roguelike**: load a fresh map each wave from a shuffled pool (no immediate repeat).
  - `warp` maps: spawn enemies + player on valid `floor` cells (respect `S`/`e` hints; never trapped).
  - `siege` maps: enter enemies from **off-screen edges** (start just outside `FRAME`, drive inward;
    skip the frame-clamp until they're inside). Player on its `floor` spawn.
- **Sandbox**: a "next map" control (HUD button or ⚙ panel) to cycle maps for testing.
- Acceptance: maps visibly vary wave-to-wave; siege maps stream tanks in from off-screen; no
  soft-locks (player reachable, enemies reach the player), checked on phone-landscape + laptop.

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
  may need outline/shadow cues, not just fill colour. (No grid lines to lean on — terrain must read
  on its own.)
- **Siege entry vs no-pathfinding** — tanks driving in from off-screen must reach the player past
  edge terrain; keep siege-map edges open and lanes clear, or they pile up at the border.
- **Open question — siege cadence:** do siege waves still use the between-wave upgrade screen (clean
  break, then they pour in), or stream continuously for relentless pressure? Recommend the former for
  v1 (keeps the roguelike upgrade rhythm); revisit if siege should feel distinctly frantic.
