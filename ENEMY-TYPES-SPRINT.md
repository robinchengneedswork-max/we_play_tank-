# Sprint Plan — PvE Enemy Types

Goal: replace the single generic enemy with the *Tanks!* (Wii Play) roster — a set of typed
enemies that differ along **movement, bullet behaviour, fire cadence, aiming intelligence, and
area-denial (mines)** — and feed them into the wave system so difficulty comes from *mixing types*,
not buffing one. Source research: see chat / `CLAUDE.md` open question #3.

## Baseline (what exists today, in `lan/public/host.html`)

- Enemies are just tanks with `.enemy = true`, living in the same `tanks` Map.
- `spawnEnemy()` builds one hard-coded enemy. `driveEnemy(t,now)` is the only AI: seek nearest
  player, hold at range 220, fire on a wave-scaled timer.
- `fire(id,aim)` reads **global** `cfg.shell / cfg.bounce / cfg.cd / cfg.maxshell`. Shells are
  `{x,y,vx,vy,b,life,age,team}`.
- `nextWave()` spawns `min(2+ceil(wave*1.3),12)` identical enemies.
- Shell↔shell cancel and player friendly-fire already work. No mines, no invisibility, no dodging.

## Target roster (stats to encode)

| Type | Move | Shell | Max | Bounce | Mines | Aim |
|------|------|-------|-----|--------|-------|-----|
| Brown | 0 (stationary) | normal | 1 | 1 | 0 | none/random |
| Grey | slow | normal | 1 | 1 | 0 | track |
| Teal | slow | rocket (fast, no bounce) | 1 | 0 | 0 | track-direct |
| Yellow | med-fast | normal | 1 | 1 | 4 | rarely fires |
| Red | normal | normal rapid | 3 | 1 | 0 | track-strong (rusher) |
| Green | 0 (stationary) | rocket | 1 | 2 | 0 | **predictive** |
| Purple | fast | normal rapid | 5 | 1 | 2 | track + cut-off |
| White | normal | normal rapid | 5 | 1 | 2 | track, **invisible** |
| Black | very fast | rocket rapid | 2 | 0 | 2 | track-aggressive |

---

## Enabling refactor (do first — everything depends on it)

> **STATUS: T0 done in `web/` (2026-06-23).** Note this sprint was written against `lan/host.html`,
> but the roguelike now lives in the `web/` single-player build, which had *no* combat to start
> from. So T0 in `web/` also brought in the whole multi-tank combat base: `enemies[]`, team-tagged
> shells (`{team,owner}`), shell↔tank damage, enemy death, player HP. Files: `web/src/data/types.js`
> (full 9-type `TYPES` table), `spawnEnemy`/wave+sandbox spawners in `state.js`, generic
> `fire(t,aim)` + base `driveEnemy` (track/none) in `logic.js`, `drawTank` in `render.js`.
> Brown & Grey fully match their rows; the other types already move/fire via their stats through the
> generic AI. Still TODO: `predict` aim (M2), mines & true invisibility (M3) — data is in place.

**T0 — Per-tank stats + `TYPES` table** · 3 pts
- Add a `TYPES` object keyed by type name, each with: `color, speed, shellSpeed, bounce, cd,
  maxShells, rocket, aim ('none'|'track'|'predict'), engage (hold distance), mines, invisible,
  fireGap [min,max]`.
- `spawnEnemy(type)` copies the type's stats onto the tank instance (`t.cd`, `t.shellSpeed`, …).
- Change `fire()` to read `t.shellSpeed ?? cfg.shell`, `t.bounce ?? cfg.bounce`, `t.cd ?? cfg.cd`,
  `t.maxShells ?? cfg.maxshell`. Players have none of these props → keep `cfg` defaults. **No
  gameplay change for players.**
- Acceptance: spawning `'grey'` reproduces today's enemy exactly; tuning panel still drives players.

---

## Milestone 1 — Stat-only types (no new AI) · ~8 pts

These need only T0 + small `driveEnemy` reads. High value, low risk.

**T1 — Brown** · 2 pts — `speed:0`, fires rarely (`fireGap:[2500,4000]`), 1 shell, 1 bounce, no
tracking (aim at player ± large random, or random cardinal). Acceptance: never moves, occasional
lazy shots.

**T2 — Grey** · 1 pt — current behaviour, formalised as a type. Acceptance: identical to today.

**T3 — Teal** · 2 pts — rocket shells: `shellSpeed ≈ cfg.shell*1.6`, `bounce:0`, slow move,
aims directly. Needs `fire()` per-tank shell speed (T0). Acceptance: fast straight shots that die on
first wall.

**T4 — Red (rusher)** · 3 pts — `speed` high, `engage` ~60 (charges), `maxShells:3`, short
`cd`, `fireGap:[300,600]`. Acceptance: closes distance and rapid-fires; clearly the early "threat".

---

## Milestone 2 — Smart aiming + Green · ~8 pts

> **STATUS: M2 done in `web/` (2026-06-23).** T5 predict aim (iterative intercept from player
> velocity + shell speed), T6 Green (stationary predict sniper + approximate 1-bounce **bank shots**
> via wall-mirroring with LOS checks in `logic.js` `aimFor`/`bankAim`/`segBlocked`), and T7 wave
> composition (`WAVES` table in `state.js`, procedural at 8+). Also: **rocket shells render as
> elongated projectiles with an exhaust flame** (shell `rocket` flag → `render.js`). Yellow & White
> are intentionally held out of the wave table until M3 (mines/invisibility). Predictive accuracy is
> currently un-jittered — add per-type error in M3 polish if it feels unfair.

**T5 — Aim modes in `driveEnemy`** · 2 pts — branch on `t.aim`:
- `track`: current direct angle to player.
- `predict`: lead the target — estimate intercept from player velocity (`tgt.vx,tgt.vy`) and
  `t.shellSpeed` (iterate ~2x for a stable lead point), aim there.
Acceptance: predictive enemies hit a strafing player that `track` enemies miss.

**T6 — Green (sniper)** · 5 pts — stationary, `bounce:2`, rocket, `predict` aim, low fire rate but
high accuracy. Stretch within ticket: approximate **1-bounce bank shots** when no direct line (mirror
the target across the nearest wall and aim at the reflection). Acceptance: leads moving players;
banks at least off arena walls. *2-cushion solving is explicitly out of scope — approximate.*

**T7 — Wave composition table** · 1 pt — define which types appear per wave (below) and have
`nextWave()` pull from it instead of spawning N identical. Acceptance: early waves brown/grey, mid
waves introduce teal/red/green, counts ramp.

---

## Milestone 3 — Area denial & specials (biggest lift) · ~13 pts

> **STATUS: M3 done in `web/` (2026-06-23), except T11 (dodging) skipped.** T8 mines (`mines[]`,
> `layMine`, `updateMines`/`detonate` in logic.js — arm 1s, fuse 6s, proximity trigger by ANY tank,
> blast damages **everyone in radius regardless of team** (bait enemies in), chain detonation, and
> **shells detonate mines on contact**; mine-layers drop on a timer while moving, capped at `mines`). T9 Purple (`aim:'cutoff'` = half-lead), Yellow (mine-focused) & Black work. T10 White:
> spawns visible during the warp-in, then on round start plays `SFX.electric` and fades to ~0.06
> alpha; revealed by muzzle flash (150ms after firing) and by **tread marks**. New: `web/src/audio.js`
> (lazy Web Audio SFX: electric/mineLay/mineBoom; `cfg.sound` toggle). **Tread marks** for all tanks
> (`tracks[]`, fade ~5s, cleared between levels in `beginWave`). Roster complete; T11 enemy dodging
> left as the optional stretch.

**T8 — Mines** · 5 pts — new `mines[]` array + `layMine(t)`. Mine: position, owner team, `arm`
timer (~1s, harmless while arming), `fuse` (~5s) then explode; explodes early if any tank enters
blast radius. Explosion kills tanks in radius (respect team rules / friendly-fire as with shells) and
chain-detonates nearby mines. Render as a pulsing dot; arm→armed colour shift. New `SFX.mineLay` /
`SFX.mineBoom`. Enemies with `mines>0` drop them on a timer while moving. Acceptance: Yellow lays up
to 4, mines kill, players can bait/avoid them.

**T9 — Purple & Yellow & Black** · 3 pts — compose from existing stats once mines exist:
Yellow (mine-focused, `mines:4`, rarely fires), Purple (`speed` fast, `maxShells:5`, `mines:2`,
cut-off aim = aim slightly ahead of player's path), Black (`speed` very fast, rocket rapid,
`mines:2`, aggressive). Acceptance: each matches the roster row.

**T10 — White (invisible)** · 3 pts — `invisible:true`. In `drawTank`, render near-transparent;
briefly flash visible on fire (track `t.lastFire`) and optionally leave fading tread marks. Acceptance:
White is unseen at rest, betrayed by muzzle flash; still fully simulated.

**T11 — Enemy dodging (stretch)** · 5 pts — in `driveEnemy`, scan nearby shells (incl. own
ricochets and mines); if one is on an intercept course within ~250px, add a perpendicular avoidance
vector to movement. Acceptance: enemies sidestep shots fired straight at them. *Treat as optional —
the single biggest fidelity gap, but not required for a fun build.*

---

## Wave composition (T7 target)

| Wave | Mix |
|------|-----|
| 1 | Brown ×3 |
| 2 | Brown ×2, Grey ×2 |
| 3 | Grey ×3, Teal ×1 |
| 4 | Grey ×2, Red ×1, Teal ×1 |
| 5 | Red ×2, Green ×1, Teal ×2 |
| 6 | Yellow ×2, Red ×2, Green ×1 |
| 7 | Purple ×1, Red ×2, Green ×1, Teal ×2 |
| 8+ | escalate counts; introduce White, then Black; cap ~12 on screen |

## Sequencing & estimates

- **T0 → M1 → M2 → M3.** T0 blocks everything. M1 and M2 each ship a playable, more varied PvE.
- Rough totals: T0 **3**, M1 **8**, M2 **8**, M3 **13** ≈ **32 pts**.
- Suggested single sprint = **T0 + M1 + M2 (≈19 pts)** → a complete 6-type game with real aiming.
  M3 (mines/specials/dodging) is sprint 2.

## Verification (per `CLAUDE.md` Phase 4 — pure-logic where possible)

- Manual: launch host on keyboard, walk each type through its row in the table.
- Unit-testable in isolation: `TYPES` integrity, predictive-lead intercept math, wave-composition
  lookup, mine blast/team resolution. Keep AI steering as manual playtest (no UI tests).

## Risks / decisions to surface

- **Predictive & bank aim** can feel unfair if too accurate — add deliberate error per type; tune live.
- **Mines + friendly fire**: confirm intended — should player mines (if ever added) hurt teammates?
  Currently only enemies lay mines, so N/A for v1.
- **Readability**: 9 muted enemy colours must stay distinct from the 8 bright player colours on the
  shared board. May need outlines/icons rather than colour alone.
- **Perf**: mines + dodging add O(n·shells) scans; fine at party scale, watch if waves grow past 12.
