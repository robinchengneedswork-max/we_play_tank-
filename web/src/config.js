"use strict";
// config — core canvas handles, constants, and the live-tunable settings object.
// Loaded first: everything below shares global scope with the later modules.

const cv = document.getElementById('game');
const ctx = cv.getContext('2d');

// ---- tunable config (live-bound to the panel in ui.js) ----
const DEFAULTS = {
  move:300, turret:0.35, body:0.25, shell:520, bounce:2,
  cd:260, dz:26, rad:80, maxshell:5, preview:true, haptics:true, shake:true
};
const cfg = {...DEFAULTS};

const FRAME = 18;                 // board inner margin (px)

let W=0, H=0, DPR=1;             // canvas size, set in main.resize()
let mode='brawl';                 // 'brawl' | 'pubg'  (right-stick fire model)
let started=false;                // gated by the start overlay
let fireBtn={x:0,y:0,r:38};       // PUBG-mode trigger, positioned in resize()
