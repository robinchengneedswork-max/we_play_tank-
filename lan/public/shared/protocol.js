// Tank Arena — wire protocol (shared reference).
// Loaded by both host.html and controller.html. Kept tiny and dependency-free.
//
// Direction legend:  C = controller (phone),  S = server,  H = host (TV).
//
// HANDSHAKE
//   C->S  { type:"hello", role:"controller", name?:string }
//   H->S  { type:"hello", role:"host" }
//   S->C  { type:"assigned", id:number, color:string }   // your player id + color
//   S->H  { type:"ready" }                                // host registered
//   S->H  { type:"join",  id, color, name }               // a controller connected
//   S->H  { type:"leave", id }                            // a controller dropped
//
// GAMEPLAY  (server tags controller messages with id, then forwards to host)
//   C->S->H  { type:"input", mx:number, my:number, aim:number, aiming:boolean }
//              mx,my in [-1..1] (normalized stick vector). aim in radians. aiming = right stick held.
//              Streamed ~30Hz, only while values change. Fills players[id].intent on the host.
//   C->S->H  { type:"fire", aim:number }                  // discrete shot along `aim` → tryFire(player)
//   C->S->H  { type:"deploy" }                            // discrete gadget deploy → deployGadget(player)
//
// LOBBY  (couch co-op: each phone is its own tank with its own class)
//   C->S->H  { type:"classSelect", class:"medium"|"light"|"destroyer"|"heavy" }  // chosen on the phone
//   C->S->H  { type:"ready" }                             // (reserved) explicit lobby ready-up
//
// BETWEEN-WAVE CHOICES  (reserved — per-player upgrade pick + Supply Depot; B2 Stage 3)
//   H->S->C  { type:"offer", to:id, choices:[{name,desc,tier}...] }   // pick 1 of N
//   C->S->H  { type:"pick", idx:number }
//   H->S->C  { type:"shop",  to:id, ...stock }            // open the depot for this player
//   C->S->H  { type:"buy",   itemId:string }
//   C->S->H  { type:"shopDone" }
//   H->S->C  { type:"state", to:id, hp, scrap, charges, ... }         // per-player HUD on the phone
//
// FEEDBACK  (host is authority; tells the relevant phone to buzz)
//   H->S->C  { type:"haptic", to:id, pattern:[ms,...] }   // server strips `to`, delivers {type:"haptic",pattern}
//
// RELAY RULES (server.js)
//   - Controller->host: only the C2H set {input,fire,deploy,classSelect,ready,pick,buy,shopDone} is
//     forwarded, each tagged with the sender's id. Everything else is dropped.
//   - Host->controller: `haptic` is special-cased; ANY other host message carrying `to` is delivered
//     to that one controller with `to` stripped.
//
// DESIGN NOTES
//   - Host simulates everything. Controllers send INTENT only; they never run physics.
//   - Two right-stick fire models ship in the controller (Brawl release-to-fire, PUBG trigger).
//     Both emit the SAME {fire} message, so the host is agnostic to which model won.
//   - No DeviceOrientation anywhere => no secure-context requirement => plain http+ws on the LAN.

window.TANK_PROTOCOL_VERSION = 2;
