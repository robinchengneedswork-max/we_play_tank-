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
const HEAVY_STUN_MS = 10000;      // Heavy player: a track hit roots you this long; that side stays detracked (vulnerable) for the life

let W=0, H=0, DPR=1;             // canvas size, set in main.resize()
let mode='brawl';                 // 'brawl' | 'pubg'  (right-stick fire model)
let gameMode=null;                // null (menu) | 'sandbox' | 'roguelike'
let started=false;                // true once a mode is running (gates the loop)
let paused=false;                 // freezes the sim (sandbox upgrade overlay)
let fireBtn={x:0,y:0,r:38};       // PUBG-mode trigger, positioned in resize()

// Player base classes (chosen per run). Layered over cfg + run.mods by the player
// stat helpers (pMove/pBounce/pMaxShells/pShell). `cfg.move` is the Light speed;
// moveMul scales from it. turretArc=null is free 360°; a value (rad) is a frontal
// gun arc (Tank Destroyer) — the hull swings to follow when you aim past it.
const CLASSES = {
  light:    { key:'light',    name:'Light',          desc:'Fast · no ricochet · 2 shells',
              moveMul:1.0,  shellMul:1.0,  bounce:0, maxShells:2, rocket:false, turretArc:null },
  medium:   { key:'medium',   name:'Medium',         desc:'Balanced · 2 ricochet · 3 shells',
              moveMul:0.75, shellMul:1.0,  bounce:2, maxShells:3, rocket:false, turretArc:null },
  destroyer:{ key:'destroyer',name:'Tank Destroyer', desc:'Slow · rocket gun · 2 ricochet · frontal gun',
              moveMul:0.65, shellMul:1.25, bounce:2, maxShells:2, rocket:true,  turretArc:Math.PI*35/180 },
  heavy:    { key:'heavy',    name:'Heavy',          desc:'Slow · front deflects shots · tracks can be blown',
              moveMul:0.6,  shellMul:1.0,  bounce:1, maxShells:2, rocket:false, turretArc:null,
              armor:{ frontArc:Math.PI*0.30, rearArc:Math.PI*0.30, deflect:true, tracks:true } },
};
