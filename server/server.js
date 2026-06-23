// Tank Arena — LAN server
// Roles: ONE host (the TV screen, simulation authority) + N controllers (phones).
// The server is a dumb relay + player registry. It does NOT simulate the game.
//
//   controller --input/fire--> server --(tag with playerId)--> host
//   host --haptic{to:id}-----> server --------------------> that controller
//
// Run: npm install && npm start   then open the printed Host URL on the TV.

const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, "..", "public");

// Player colors handed out in join order. Keep in sync with host.html legend.
const COLORS = ["#3b6fb5", "#c0584a", "#4a9d5b", "#d9a441", "#8a5cc0", "#d97a3b", "#3ba6a6", "#c05c9a"];

// ---- LAN IP so the host can tell phones where to connect ----
function lanIP() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces) {
      if (i.family === "IPv4" && !i.internal) return i.address;
    }
  }
  return "localhost";
}
const IP = lanIP();

// ---- static file serving ----
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" };
function send(res, code, body, type = "text/plain") {
  res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-cache" });
  res.end(body);
}
function serveFile(res, file) {
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, "Not found");
    send(res, 200, data, MIME[path.extname(file)] || "application/octet-stream");
  });
}

const server = http.createServer((req, res) => {
  const url = req.url.split("?")[0];
  if (url === "/api/info") {
    return send(res, 200, JSON.stringify({ ip: IP, port: PORT, controllerUrl: `http://${IP}:${PORT}/controller` }), "application/json");
  }
  let rel = url === "/" ? "/host.html"
          : url === "/host" ? "/host.html"
          : url === "/controller" ? "/controller.html"
          : url;
  const file = path.join(PUBLIC, path.normalize(rel));
  if (!file.startsWith(PUBLIC)) return send(res, 403, "Forbidden");
  serveFile(res, file);
});

// ---- websocket relay ----
const wss = new WebSocketServer({ server });
let hostSocket = null;
const controllers = new Map(); // id -> ws
let nextId = 1;

function safeSend(ws, obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

wss.on("connection", (ws) => {
  ws.role = null;
  ws.pid = null;

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // First message must declare a role.
    if (msg.type === "hello") {
      if (msg.role === "host") {
        hostSocket = ws; ws.role = "host";
        // replay current roster to a (re)connecting host
        for (const [id, c] of controllers) safeSend(ws, { type: "join", id, color: c.color, name: c.name });
        safeSend(ws, { type: "ready" });
      } else {
        const id = nextId++;
        const color = COLORS[(id - 1) % COLORS.length];
        ws.role = "controller"; ws.pid = id; ws.color = color; ws.name = msg.name || `P${id}`;
        controllers.set(id, ws);
        safeSend(ws, { type: "assigned", id, color });
        safeSend(hostSocket, { type: "join", id, color, name: ws.name });
      }
      return;
    }

    // Controller -> host (tag with player id)
    if (ws.role === "controller") {
      if (msg.type === "input" || msg.type === "fire") {
        msg.id = ws.pid;
        safeSend(hostSocket, msg);
      }
      return;
    }

    // Host -> a specific controller (e.g. haptic feedback on a hit)
    if (ws.role === "host") {
      if (msg.type === "haptic" && msg.to != null) {
        safeSend(controllers.get(msg.to), { type: "haptic", pattern: msg.pattern || [20] });
      }
      return;
    }
  });

  ws.on("close", () => {
    if (ws.role === "host" && hostSocket === ws) hostSocket = null;
    if (ws.role === "controller") {
      controllers.delete(ws.pid);
      safeSend(hostSocket, { type: "leave", id: ws.pid });
    }
  });
});

server.listen(PORT, () => {
  console.log(`\n  Tank Arena running`);
  console.log(`  Host (open on the TV):  http://${IP}:${PORT}/host`);
  console.log(`  Phones join at:         http://${IP}:${PORT}/controller\n`);
});
