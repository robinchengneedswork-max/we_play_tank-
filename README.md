# Tank Arena

LAN multiplayer *Wii Play Tanks*-style game. Host screen on a TV, phones as twin-stick controllers.
Same Wi-Fi, browser only, nothing to install on the phones.

There are two ways to play:

- **`web/`** — a **single-player** build (your tank + targets, twin-stick on one phone). Pure static,
  no server. This is what deploys to **Vercel** (`vercel.json` serves `web/`); open `web/index.html`
  directly to play offline.
- **`lan/`** — the **LAN multiplayer** build (host screen + phone controllers over a `ws` server).
  Needs Node; run it locally (below). Vercel can't host the persistent WebSocket server.

## Run

```bash
npm install
npm start
```

The server prints two URLs:

- **Host** (open on the TV/laptop): `http://<lan-ip>:3000/host`
- **Phones** (each player): `http://<lan-ip>:3000/controller`

Phones must be on the same Wi-Fi. Tested on Pixel 6a / Chrome, landscape.

## What's here

| Path | Role |
|---|---|
| `web/index.html` + `web/src/*.js` | Single-player static build (deployed to Vercel) |
| `lan/server/server.js` | WebSocket relay + static server + LAN-IP discovery |
| `lan/public/host.html` | TV screen — simulates and renders the game |
| `lan/public/controller.html` | Phone — twin-stick input, sends intent |
| `lan/public/shared/protocol.js` | Wire protocol reference |
| `reference/tank-controller-test.html` | Standalone feel-test (the feel baseline) |
| `vercel.json` | Static deploy config (serves `web/`) |

See **CLAUDE.md** for architecture, decisions, and the open task list.
