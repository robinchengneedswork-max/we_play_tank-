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
  cd:260, dz:26, rad:80, maxshell:5, preview:true, haptics:true, shake:true,
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

let W=0, H=0, DPR=1;             // canvas size, set in main.resize()
let mode='brawl';                 // 'brawl' | 'pubg'  (right-stick fire model)
let gameMode=null;                // null (menu) | 'sandbox' | 'roguelike'
let started=false;                // true once a mode is running (gates the loop)
let fireBtn={x:0,y:0,r:38};       // PUBG-mode trigger, positioned in resize()
