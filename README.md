# Tank Arena

LAN multiplayer *Wii Play Tanks*-style game. Host screen on a TV, phones as twin-stick controllers.
Same Wi-Fi, browser only, nothing to install on the phones.

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
| `server/server.js` | WebSocket relay + static server + LAN-IP discovery |
| `public/host.html` | TV screen — simulates and renders the game |
| `public/controller.html` | Phone — twin-stick input, sends intent |
| `public/shared/protocol.js` | Wire protocol reference |
| `reference/tank-controller-test.html` | Standalone feel-test (the feel baseline) |

See **CLAUDE.md** for architecture, decisions, and the open task list.
