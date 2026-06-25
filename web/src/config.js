"use strict";
// config — core canvas handles, constants, and the live-tunable settings object.
// Loaded first: everything below shares global scope with the later modules.

const cv = document.getElementById('game');
const ctx = cv.getContext('2d');

// ---- tunable config (live-bound to the panel in ui.js) ----
// Pacing baseline tuned ~60% of the reference for a slower, more cerebral
// Wii-Tanks feel. move/shell are the big "speed" dials; body is chassis turn.
// turret-turn and fire-rate (cd) are left responsive on purpose — they're
// earmarked as run upgrades, and turret lag couples to fire-on-release accuracy.
const DEFAULTS = {
  move:180, turret:0.35, body:0.18, shell:310, bounce:2,
  cd:260, dz:26, rad:80, maxshell:5, preview:true, haptics:true, shake:true, sound:true,
  fixedStick:false, autofire:false,           // input prefs (persisted)
  fireSlow:90, fireSlowMs:250,                 // firing brakes movement
  moveCx:0.20, moveCy:0.70, aimCx:0.80, aimCy:0.70  // fixed-stick centers (fractions of W,H)
};
const cfg = {...DEFAULTS};

// ---- persisted player prefs (input feel survives reloads, like the LAN controller) ----
const PREF_KEYS=['fixedStick','autofire','fireSlow','fireSlowMs','moveCx','moveCy','aimCx','aimCy'];
function savePrefs(){ try{ const o={}; for(const k of PREF_KEYS) o[k]=cfg[k];
  localStorage.setItem('tankPrefs',JSON.stringify(o)); }catch(e){} }
function loadPrefs(){ try{ const s=localStorage.getItem('tankPrefs'); if(!s) return;
  const o=JSON.parse(s); for(const k of PREF_KEYS) if(o[k]!==undefined) cfg[k]=o[k]; }catch(e){} }
loadPrefs();

const FRAME = 18;                 // board inner margin (px)
const HEAVY_STUN_MS = 5000;       // Heavy player: a track hit roots you this long; that side stays detracked (vulnerable) for the life
const HEAVY_PLATES = 2;           // front plates a heavy (class or enemy) starts each life with; each deflect spends one
const BOSS_PLATES = 4;            // a boss starts with a thicker glacis (more front deflects before it goes soft)
// Front glacis (the swappable left-slot deflect plate). Track-break is a separate class
// characteristic (`tracks:true` on Heavy / enemy heavy), NOT part of this.
const FRONT_ARMOR = { frontArc:Math.PI*0.30, rearArc:Math.PI*0.30, deflect:true };
const ARMOR_SIDE_FRONT = Math.PI*0.30, ARMOR_SIDE_REAR = Math.PI*0.30;   // face arcs for track-break when no glacis is equipped
const APDS_PIERCE    = 3;         // tanks an APDS (sabot) round punches through
const SCATTER_PELLETS = 3;        // pellets per shot with the Scattergun gun-mode

// ---- rulebreaker arsenal tunables (gun-modes, gadgets, vibranium) ----
const LASER_RANGE   = 620;        // px total path a laser beam traces (unlimited bounces within it)
const LASER_CD_MUL  = 2.2;        // laser fire cooldown vs the normal gun
const GUIDED_SPEED   = 230;       // wire-guided missile px/sec (slower so you can steer it)
const GUIDED_TURNRAD = 96;        // px turn radius while guided (~2 cells) → ω = speed/radius
const BOUNCE_CONE   = Math.PI/4;  // 45° half-cone a bounce-rocket searches for a lock-on
const BOUNCE_ROCKET_MUL = 1.6;    // speed multiplier when a bounced shell converts to a homing rocket
const TURRET_LIFE   = 12000;      // ms a deployed sentry/trophy lasts before it expires
const TURRET_HP     = 2;          // sentry/trophy hit points (stray/enemy fire can destroy them)
const TROPHY_R      = 130;        // px point-defense radius (trophy zaps enemy shells inside it)
const SHIELD_LIFE   = 9000;       // ms a deployed one-way shield lasts
const SHIELD_R      = 92;         // px shield radius (~2 cells)
const SPIDER_SPEED  = 70;         // px/sec spider mines crawl toward the nearest enemy
const SPIDER_COUNT  = 3;          // spider mines per deploy
const DASH_DIST     = 150;        // px dash teleport distance (~2.5 cells)
const DASH_IFRAMES  = 250;        // ms invulnerable window after a dash
const JET_MS        = 3000;       // ms jump-jets keep you airborne (no hits, cross terrain)
const STEALTH_MS    = 10000;      // ms stealth lasts (or until you fire)
const VIBRANIUM_BOOST = 1.6;      // move multiplier while charged (after surviving a hit)
const VIBRANIUM_DMG   = 3;        // contact damage when you ram an enemy while charged
const GADGET_CHARGES  = 3;        // default charges a gadget starts with / refills to
const GADGET_CD       = 1500;     // default per-gadget re-deploy cooldown (ms)

let W=0, H=0, DPR=1;             // canvas size, set in main.resize()
let mode='brawl';                 // 'brawl' | 'pubg'  (right-stick fire model)
let gameMode=null;                // null (menu) | 'sandbox' | 'roguelike'
let started=false;                // true once a mode is running (gates the loop)
let paused=false;                 // freezes the sim (sandbox upgrade overlay)
let fireBtn={x:0,y:0,r:38};       // PUBG-mode trigger, positioned in resize()
let deployBtn={x:0,y:0,r:34};     // gadget deploy trigger (left index), positioned in resize()

// Player base classes (chosen per run). Layered over cfg + run.mods by the player
// stat helpers (pMove/pBounce/pMaxShells/pShell). `cfg.move` is the Light speed;
// moveMul scales from it. turretArc=null is free 360°; a value (rad) is a frontal
// gun arc (Tank Destroyer) — the hull swings to follow when you aim past it.
// A class = a starting loadout: stat multipliers, baked-in slot items (bakedGun = right slot,
// bakedLeft = left slot), and pure characteristics (turretArc = locked traverse). Slot items can be
// swapped at the depot (you give up the class one); characteristics are permanent.
const CLASSES = {
  light:    { key:'light',    name:'Light',          desc:'Fast · no ricochet · 2 shells',
              moveMul:1.0,  shellMul:1.0,  bounce:0, maxShells:2, turretArc:null },
  medium:   { key:'medium',   name:'Medium',         desc:'Balanced · 2 ricochet · 3 shells',
              moveMul:0.75, shellMul:1.0,  bounce:2, maxShells:3, turretArc:null },
  destroyer:{ key:'destroyer',name:'Tank Destroyer', desc:'Slow · APDS piercing gun · locked frontal traverse',
              moveMul:0.65, shellMul:1.25, bounce:2, maxShells:2, turretArc:Math.PI*35/180, bakedGun:'apds' },
  heavy:    { key:'heavy',    name:'Heavy',          desc:'Slow · breakable side tracks · starts with a front glacis',
              moveMul:0.6,  shellMul:1.0,  bounce:1, maxShells:2, turretArc:null, bakedLeft:'glacis', tracks:true },
};
