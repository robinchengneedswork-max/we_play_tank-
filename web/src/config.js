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
  cd:260, dz:26, rad:80, maxshell:5, preview:true, haptics:true, shake:true
};
const cfg = {...DEFAULTS};

const FRAME = 18;                 // board inner margin (px)

let W=0, H=0, DPR=1;             // canvas size, set in main.resize()
let mode='brawl';                 // 'brawl' | 'pubg'  (right-stick fire model)
let gameMode=null;                // null (menu) | 'sandbox' | 'roguelike'
let started=false;                // true once a mode is running (gates the loop)
let fireBtn={x:0,y:0,r:38};       // PUBG-mode trigger, positioned in resize()
