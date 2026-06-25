"use strict";
// data/types — the *Tanks!* enemy roster (T0 of ENEMY-TYPES-SPRINT).
// One row per type; spawnEnemy() copies these onto a tank instance.
// Speeds are px/sec, tuned to the web pacing baseline (player move 180, shell 310).
//
// Fields:
//   color       board fill
//   speed       movement px/sec (0 = stationary)
//   shellSpeed  projectile px/sec   | bounce: wall ricochets before dying
//   cd          fire cooldown (ms)  | maxShells: own live shells cap
//   rocket      fast straight shot (informational; encoded in shellSpeed/bounce)
//   aim         'none' | 'track' | 'predict'   ('predict' falls back to track until M2)
//   engage      preferred distance to hold from the target (px)
//   mines       mines to lay (M3 — not yet implemented)
//   invisible   render near-transparent (M3 — partial: dimmed render only)
//   fireGap     [min,max] ms between fire *attempts*
//   fireChance  (optional, default 1) prob. of taking a clear shot when one's ready; <1 makes a
//               type hold fire some of the time (OG-style sparse firing) → less lethal, less FF
//   hp, r       hit points, body radius
//   armor       (optional) directional armor — shots resolve by which face they hit, vs bodyAngle:
//               { frontArc, rearArc } sector half-widths (rad); deflect: front bounces NON-rocket
//               shells back (rockets penetrate); tracks: first side hit breaks the track —
//               absorbed (no hp), immobilizes permanently, then that side takes normal damage.

const TYPES = {
  brown:  { color:'#9b7b4a', speed:0,   shellSpeed:310, bounce:1, cd:1600, maxShells:1, rocket:false, aim:'none',    engage:9999, mines:0, invisible:false, fireGap:[2600,4200], hp:1, r:16 },
  grey:   { color:'#8a8f98', speed:70,  shellSpeed:310, bounce:1, cd:1000, maxShells:1, rocket:false, aim:'track',   engage:220,  mines:0, invisible:false, fireGap:[1200,2200], fireChance:0.6, hp:1, r:16 },
  teal:   { color:'#3ba6a6', speed:70,  shellSpeed:470, bounce:0, cd:1100, maxShells:1, rocket:true,  aim:'track',   engage:240,  mines:0, invisible:false, fireGap:[1300,2200], hp:1, r:16 },
  yellow: { color:'#d9a441', speed:120, shellSpeed:310, bounce:1, cd:2200, maxShells:1, rocket:false, aim:'track',   engage:200,  mines:4, invisible:false, fireGap:[3000,4500], fireChance:0.55, hp:1, r:16 },
  red:    { color:'#c0584a', speed:150, shellSpeed:310, bounce:1, cd:420,  maxShells:2, rocket:false, aim:'track',   engage:105,  mines:0, invisible:false, fireGap:[350,650],   hp:1, r:16 },
  green:  { color:'#4a9d5b', speed:0,   shellSpeed:470, bounce:2, cd:1500, maxShells:1, rocket:true,  aim:'predict', engage:9999, mines:0, invisible:false, fireGap:[1500,2300], hp:1, r:16 },
  purple: { color:'#8a5cc0', speed:150, shellSpeed:310, bounce:1, cd:420,  maxShells:5, rocket:false, aim:'cutoff',  engage:160,  mines:2, invisible:false, fireGap:[400,750],   hp:1, r:16 },
  white:  { color:'#d8d2c2', speed:110, shellSpeed:310, bounce:1, cd:520,  maxShells:5, rocket:false, aim:'track',   engage:180,  mines:2, invisible:true,  fireGap:[450,850],   fireChance:0.50, hp:1, r:16 },
  black:  { color:'#3a3732', speed:185, shellSpeed:470, bounce:0, cd:620,  maxShells:2, rocket:true,  aim:'track',   engage:120,  mines:2, invisible:false, fireGap:[550,950],   hp:2, r:16 },
  heavy:  { color:'#6b7079', speed:55,  shellSpeed:310, bounce:1, cd:1400, maxShells:1, rocket:false, aim:'track',   engage:200,  mines:0, invisible:false, fireGap:[1800,2800], hp:3, r:19,
            armor:{ frontArc:Math.PI*0.30, rearArc:Math.PI*0.30, deflect:true, tracks:true } },
};
