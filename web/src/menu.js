"use strict";
// menu — screen management, mode selection, and the menu ↔ game transitions.
// Screen pattern (per SharedPatterns): one `.screen` is `.active` at a time;
// showScreen(null) clears them so the live game/HUD shows through.

function showScreen(id){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  if(id) document.getElementById(id).classList.add('active');
}

const hud=document.getElementById('hud');
function setHudForMode(){
  document.getElementById('statHits').hidden    = (gameMode!=='sandbox');
  document.getElementById('statRun').hidden     = (gameMode!=='roguelike');
  document.getElementById('sbUpgradeBtn').hidden= (gameMode!=='sandbox');
}

async function startMode(m){
  gameMode=m; paused=false;
  // Fullscreen + landscape lock on the user gesture (best-effort; ignored on desktop).
  try{ await document.documentElement.requestFullscreen(); }catch(e){}
  try{ await screen.orientation.lock('landscape'); }catch(e){}
  showScreen(null);
  hud.classList.remove('hud-hidden');
  resize();                 // size canvas + bake the map's collision rects for current orientation
  resetRun();               // reset run state + upgrade mods (both modes start at baseline)
  resetArena();
  setHudForMode();
  updateHud();
  started=true;
}

function toMenu(){
  started=false; gameMode=null; paused=false;
  ['gameover','sbUp','upgrade'].forEach(id=>document.getElementById(id).classList.remove('active'));
  hud.classList.add('hud-hidden');
  showScreen('screen-menu');   // stay in fullscreen so re-entering a mode is instant
}

document.getElementById('btnSandbox').onclick   = ()=>startMode('sandbox');
document.getElementById('btnRoguelike').onclick = ()=>startMode('roguelike');
document.getElementById('btnSettings').onclick  = ()=>panel.classList.add('open');
document.getElementById('menuBtn').onclick      = toMenu;
