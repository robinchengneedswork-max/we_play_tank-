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
//              Streamed ~30Hz, only while values change.
//   C->S->H  { type:"fire", aim:number }                  // discrete shot at angle `aim`
//
// FEEDBACK  (host is authority; tells the relevant phone to buzz)
//   H->S->C  { type:"haptic", to:id, pattern:[ms,...] }   // server strips `to`, delivers {type:"haptic",pattern}
//
// DESIGN NOTES
//   - Host simulates everything. Controllers send INTENT only; they never run physics.
//   - Two right-stick fire models ship in the controller (Brawl release-to-fire, PUBG trigger).
//     Both emit the SAME {fire} message, so the host is agnostic to which model won.
//   - No DeviceOrientation anywhere => no secure-context requirement => plain http+ws on the LAN.

window.TANK_PROTOCOL_VERSION = 1;
