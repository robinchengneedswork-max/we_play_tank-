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
  document.getElementById('sbMapBtn').hidden    = (gameMode!=='sandbox');
}

let runClassKey=null;       // remembered so game-over Retry keeps the chosen class
const LOCAL_COLOR='#3b6fb5';   // the host keyboard seat's tank colour (matches the server's P1 colour)
async function startMode(m, classKey){
  gameMode=m; paused=false;
  // Fullscreen + landscape lock on the user gesture (best-effort; ignored on desktop).
  try{ await document.documentElement.requestFullscreen(); }catch(e){}
  try{ await screen.orientation.lock('landscape'); }catch(e){}
  showScreen(null);
  hud.classList.remove('hud-hidden');
  resize();                 // size canvas + bake the map's collision rects for current orientation
  resetRun();               // reset SHARED run state (level / lives / phase)
  // Add the host keyboard seat only when nobody has joined over the net (solo/testbed use). On a
  // co-op host with phones already connected, there's no idle keyboard tank — phones are the players.
  if(players.length===0) addPlayer('local', LOCAL_COLOR, 'P1');
  runClassKey = (m==='roguelike') ? (classKey||runClassKey||'medium') : null;
  // each player gets its OWN build from its OWN class: the local seat uses the class screen pick;
  // network players use the class they chose on their phone (p.classKey), default medium.
  for(const p of players){
    const ck = (m==='sandbox') ? null : (p.id==='local' ? runClassKey : (p.classKey || 'medium'));
    setupPlayerForRun(p, ck);
  }
  resetArena();
  setHudForMode();
  updateHud();
  started=true;
}

// Add the host keyboard+mouse seat on demand (bound to Spacebar in input.js). On a co-op host you
// usually let phones play, but the operator can drop in a keyboard tank any time.
function ensureLocalPlayer(){
  if(LP()) return LP();
  const p=addPlayer('local', LOCAL_COLOR, 'Keyboard');
  const ck=(gameMode==='sandbox')?null:(runClassKey||'medium');
  setupPlayerForRun(p, ck);
  if(started && gameMode){ resetPlayerToSpawn(p, players.indexOf(p), players.length); p.down=false; }
  updateHud();
  return p;
}

function toMenu(){
  started=false; gameMode=null; paused=false;
  players.length=0;            // drop the seats; startMode re-adds the local one (network players re-join)
  ['gameover','sbUp','shop','pause'].forEach(id=>document.getElementById(id).classList.remove('active'));
  hud.classList.add('hud-hidden');
  showScreen('screen-menu');   // stay in fullscreen so re-entering a mode is instant
}

// Pause: the ☰ button freezes the sim (paused) and shows the pause overlay; Back-to-menu lives here.
function openPause(){ if(!started) return; paused=true; document.getElementById('pause').classList.add('active'); }
function closePause(){ paused=false; document.getElementById('pause').classList.remove('active'); }

document.getElementById('btnSandbox').onclick   = ()=>startMode('sandbox');
document.getElementById('btnRoguelike').onclick = ()=>showScreen('screen-class');   // choose a class first
document.getElementById('btnSettings').onclick  = ()=>panel.classList.add('open');
document.getElementById('classBack').onclick    = ()=>showScreen('screen-menu');
document.querySelectorAll('#screen-class [data-class]').forEach(b=>{
  b.onclick = ()=>startMode('roguelike', b.dataset.class);
});
document.getElementById('menuBtn').onclick      = openPause;
document.getElementById('pauseResume').onclick  = closePause;
document.getElementById('pauseMenu').onclick    = ()=>{ closePause(); toMenu(); };
