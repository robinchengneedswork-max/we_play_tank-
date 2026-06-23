# Tank Arena — CLAUDE.md

LAN-party multiplayer, *Wii Play Tanks*-style. One **host screen** (a TV/laptop) runs the
game; **phones are twin-stick controllers** over the local network. Designed for friends in
one room: phones on the same Wi-Fi, browser only, nothing to install on the phones.

This file is the source of truth for architecture and decisions. Read it before changing structure.

---

## Repo layout (two builds)

The repo holds **two separate builds** of the game, plus the feel baseline:

- **`web/`** — the **single-player** build, deployed to **Vercel** (static, no server). Phones (or
  anyone) load it from the Vercel URL. Module pattern:
  `web/src/{config,state,input,logic,render,ui,menu,main}.js` + `index.html` + `style.css`. No
  `audio.js` yet — the reference has haptics only, no synthesized sound (known gap vs the LAN host).
  Has a **menu/screen system** (`menu.js`, `.screen`/`.active` + `showScreen`) with two modes
  (`gameMode` in config): **Sandbox** (respawning test range of enemy types) and **Roguelike**
  (`run` state in `state.js` — escalating waves, 3 HP, death→menu; level/kills/hp HUD).
  Settings = the same tuning panel, opened from the menu and the in-game gear.
  **T0 enemy roster is in** (`data/types.js` `TYPES` + multi-tank combat base): `enemies[]`,
  team-tagged shells, `spawnEnemy`, generic `fire(t,aim)` (player feel unchanged via `?? cfg`
  fallback), and a base `driveEnemy` (track/none aim). `predict` aim, mines, and true invisibility
  are data-ready but TODO (M2/M3). See `ENEMY-TYPES-SPRINT.md`.
  **Input/feel options** (in the ⚙ panel): floating vs **fixed stick** (centers are player-defined
  via a 2-tap calibration overlay, stored as W/H fractions), **auto-fire** (push the aim stick past
  the ring to fire on cooldown), **fire-slow** (firing brakes movement by `fireSlow` px/s for
  `fireSlowMs`), and shell **smoke trails** (separate `smoke[]`, drawn behind shells). Input prefs
  (`PREF_KEYS` in config.js: fixedStick/autofire/fireSlow/fireSlowMs/centers) persist to
  `localStorage` as `tankPrefs`.
- **`lan/`** — the **LAN multiplayer** build (`lan/server/` + `lan/public/`). Needs Node; Vercel
  can't host the persistent `ws` server, so this runs locally only.
- **`reference/`** — the feel baseline. Untouched.

### Deploy
`vercel.json` sets `outputDirectory: "web"` (no build step) so Vercel publishes only `web/`.
`.vercelignore` keeps `lan/`, `reference/`, `node_modules`, docs out of the upload. Vercel is wired
to the GitHub repo `robinchengneedswork-max/we_play_tank-` (branch `main`) → push = deploy.

### Direction (roguelike pivot)
The target is shifting toward a **roguelike** (*Nuclear Throne* / *Into the Breach* inspiration):
short runs, escalating waves, upgrade picks between fights, permadeath. The `web/` single-player is
the **testbed** for tightening combat/feel; the long-term goal is to bring it **back to couch co-op**.
Current engine is **realtime twin-stick**, so the scaffolded roguelike leans *Nuclear Throne*
(realtime) — *Into the Breach* (turn-based grid) would be a different engine; revisit before building
deep run mechanics. The run/upgrade meta-structure is engine-agnostic and lives ahead of that choice.

## Current state of the repo

- `reference/tank-controller-test.html` — the **proven single-file feel-test**. It already nails
  the input feel (twin sticks, two fire models, bouncing shells, juice). It is the canonical
  reference for *how the controls should feel*. Do not "improve" feel by guessing — match this.
  `web/` is the modularized port of this file.
- `lan/public/controller.html` — the feel-test's input layer, **ported to send intent over WebSocket**
  instead of driving a local tank. Both fire models intact, plus a **Floating/Fixed stick toggle**
  (Fixed anchors each stick to its half-screen center; choice persisted in `localStorage`).
- `lan/public/host.html` — **simulation authority**. Multi-tank port of the reference physics, driven
  by network input. Renders the board, shows the join URL + **QR code** + roster, sends haptics on
  hits. Now also has: **PvP deathmatch** and **PvE wave-defense** modes (top-center toggle), a local
  **keyboard player** (WASD move · ←/→ rotate turret · space fire), **synthesized sound** (fire /
  ricochet / death), **shell-vs-shell cancellation**, and player **friendly fire**. Playable PoC.
- `lan/public/shared/qrcode.js` — vendored offline QR generator (MIT, Kazuhiko Arase). No CDN at runtime.
- `ENEMY-TYPES-SPRINT.md` — the plan for turning the single generic enemy into the *Tanks!* roster.
- `lan/server/server.js` — dumb WebSocket relay + static file server + LAN-IP discovery. Stable.
- `lan/public/shared/protocol.js` — the wire protocol, documented in one place.

---

## Architecture

```
   Phone (controller.html)                 TV (host.html)
   ┌──────────────────────┐                ┌────────────────────────┐
   │ twin sticks, fire UI  │   ws  ┌─────┐ │ SIMULATES everything    │
   │ sends INTENT only ────┼──────▶│server│▶┼─ tanks, shells, bounce  │
   │ vibrates on haptic ◀──┼───────│relay │◀┼─ haptic on hit          │
   └──────────────────────┘        └─────┘ │ renders the board       │
                                           └────────────────────────┘
```

**The host is the only simulator.** Controllers never run physics — they send a normalized move
vector, an aim angle, an `aiming` flag, and discrete `fire` events. The host owns all tank/shell
state, so there is no divergence to reconcile and no client-side prediction to debug. This mirrors
the host-screen pattern from prior projects (Captain Sonar crew sheets, Midnight Run display).

**The server simulates nothing.** It assigns each phone a player id + color, tags controller
messages with that id, and relays. It also serves the static pages and reports the LAN IP so the
host can print a join URL.

---

## Wire protocol

Full shapes live in `lan/public/shared/protocol.js`. Summary:

- Handshake: each socket sends `{type:"hello", role:"host"|"controller"}`. Server replies to a
  controller with `{type:"assigned", id, color}` and tells the host `{type:"join", id, color, name}`.
- Controller → host (relayed, id-tagged): `{type:"input", mx, my, aim, aiming}` streamed ~30Hz on
  change, and `{type:"fire", aim}` discrete.
- Host → controller (relayed): `{type:"haptic", to:id, pattern:[ms,...]}` — server delivers it to
  that phone, which calls `navigator.vibrate`.

Both fire models emit the **same** `fire` message, so the host is agnostic to which one wins.

---

## Decisions already made (do not relitigate without reason)

- **Twin-stick, not tilt.** Tilt drifts, fatigues, and has no clean neutral — wrong for precise
  dodging. Right stick *is* the fire control.
- **No DeviceOrientation anywhere ⇒ no secure context needed.** Because we dropped tilt, the
  controller needs no motion sensors, so plain `http://` + `ws://` over the LAN works. The old
  HTTPS/self-signed-cert headache is **gone**. Do not reintroduce a sensor that would bring it back
  without flagging the cost.
- **Two right-stick fire models ship together** so the hardware A/B happens inside the real
  architecture. Both are in `controller.html` behind the Mode toggle:
  - **Brawl**: drag aim stick → release to fire along aim; release inside the cancel deadzone aborts.
  - **PUBG**: aim stick is aim-only; a top-right FIRE button (index finger) shoots along current aim.
  Once a winner is chosen on hardware, **delete the loser** from `controller.html` and simplify.
- **Host-authoritative tuning.** Gameplay params (move/shell speed, bounce count, cooldown) live on
  the host so every client agrees. Input-feel params (stick radius, cancel deadzone) stay on the
  controller. Keep the live tuning panels — externalizing tunables before committing values is the
  standard here.
- **No build step for the client.** Plain HTML/JS pages. Server is Node + `ws` only, no framework.

---

## Run it

```bash
npm install
npm start
```

The server prints a Host URL and a Phone URL. Open the **Host URL** on the TV/laptop, then open the
**Phone URL** on each phone (same Wi-Fi). Target phone: Pixel 6a / Chrome, landscape. The host card
shows the join address; phones tap "Tap to join" (requests fullscreen + landscape lock).

---

## Game-feel non-negotiables (carry from the feel-test)

Haptics, screen shake, sound design, and animation polish are core, not optional. The reference file
has screen shake + muzzle/hit particles + haptics; the split moved haptics to host-authoritative
(`haptic` message) so the buzz aligns with the *authoritative* hit. The host now has particles +
**synthesized sound** (fire/ricochet/death), but still **no screen shake** — that should come back.

---

## Open questions / next decisions

1. **Input model winner.** Feel-test Brawl vs PUBG on the Pixel 6a, in this architecture. Decide,
   then prune the loser. (Now also: Floating vs Fixed stick — keep both as a player choice for now.)
2. **Host sim is the first debug target.** It's a mechanical multi-tank port; playtest for: shell
   tunneling on thin corners (currently 4 substeps), tank-tank overlap (no tank↔tank collision yet),
   and turret/aim easing feel across the network at 30Hz (does aim feel laggy? consider raising rate
   or interpolating turret on host).
3. **Reconnection / id stability.** A phone that drops gets a *new* id on reconnect. Fine for now;
   revisit if it matters for scores.

### Decided / done since PoC
- ~~PvE vs PvP~~ → **both ship**, as a host mode toggle (PvP deathmatch + PvE wave defense).
- ~~QR code~~ → **done** (vendored offline lib, on the host card).
- ~~Sound~~ → **done** (synthesized fire/ricochet/death; still **no screen shake** — see non-negotiables).

## Next up (the two big tasks before this is more than a PoC)

1. **Enemy types** — replace the single generic PvE enemy with the *Tanks!* roster
   (Brown/Grey/Teal/Yellow/Red/Green/Purple/White/Black). Full ticketed plan, stats table, wave
   composition, and estimates live in **`ENEMY-TYPES-SPRINT.md`**. Start with T0 (the per-tank stats
   refactor) — everything else depends on it.

2. **Tune game speed / feel.** The PoC defaults were eyeballed, not playtested at party scale. Host
   `cfg` defaults today: `move:300, turret:0.35, body:0.25, shell:520, bounce:2, cd:260, maxshell:5`
   (all live-editable in the ⚙ panel). Open issues to settle on real hardware/TV:
   - Tanks can feel **sluggish on a big TV** and twitchy on a laptop — the arena scales with screen
     size but speeds are absolute. Consider scaling `move`/`shell` to arena size (e.g. px/sec as a
     fraction of `min(W,H)`) so feel is resolution-independent.
   - Shell speed vs bounce count interacts with the new **shell-cancel** mechanic — retune together.
   - Enemy fire cadence in PvE (`driveEnemy` `fireAt`) and wave ramp (`nextWave` count) need a real
     difficulty pass once enemy types exist.
   - Decide final defaults and **bake them into `cfg`** (the panel is for finding them, per the
     SharedPatterns "externalize tunables before committing values" rule).

---

## Conventions

- Client pages: vanilla JS, Canvas 2D, no dependencies, no bundler.
- Server: CommonJS, Node ≥18, single dependency `ws`.
- Colors/feel constants are duplicated intentionally (server palette ↔ host legend) — keep them in sync.
- Keep `reference/` untouched as the feel baseline.
