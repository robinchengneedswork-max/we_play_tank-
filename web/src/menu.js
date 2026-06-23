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
  document.getElementById('statHits').hidden = (gameMode!=='sandbox');
  document.getElementById('statRun').hidden  = (gameMode!=='roguelike');
}

async function startMode(m){
  gameMode=m;
  // Fullscreen + landscape lock on the user gesture (best-effort; ignored on desktop).
  try{ await document.documentElement.requestFullscreen(); }catch(e){}
  try{ await screen.orientation.lock('landscape'); }catch(e){}
  showScreen(null);
  hud.classList.remove('hud-hidden');
  resize();                 // size canvas + lay out obstacles for current orientation
  if(m==='roguelike') resetRun();
  resetArena();
  setHudForMode();
  updateHud();
  started=true;
}

function toMenu(){
  started=false; gameMode=null;
  hud.classList.add('hud-hidden');
  showScreen('screen-menu');   // stay in fullscreen so re-entering a mode is instant
}

document.getElementById('btnSandbox').onclick   = ()=>startMode('sandbox');
document.getElementById('btnRoguelike').onclick = ()=>startMode('roguelike');
document.getElementById('btnSettings').onclick  = ()=>panel.classList.add('open');
document.getElementById('menuBtn').onclick      = toMenu;
