"use strict";
// ui — menus, the tuning panel, mode toggle, start overlay wiring.

const panel=document.getElementById('panel');
document.getElementById('gear').onclick=()=>panel.classList.add('open');
document.getElementById('closePanel').onclick=()=>panel.classList.remove('open');
document.getElementById('modeBtn').onclick=()=>{
  mode=mode==='brawl'?'pubg':'brawl';
  const b=document.getElementById('modeBtn');
  b.innerHTML = mode==='brawl' ? 'Mode: Brawl<small>release stick to fire</small>'
                               : 'Mode: PUBG<small>aim + index-finger trigger</small>';
};

const binds=[['move','vMove',v=>v],['turret','vTurret',v=>(+v).toFixed(2)],
  ['body','vBody',v=>(+v).toFixed(2)],['shell','vShell',v=>v],['bounce','vBounce',v=>v],
  ['cd','vCd',v=>v],['dz','vDz',v=>v],['rad','vRad',v=>v],['maxshell','vMax',v=>v],
  ['fireSlow','vFireSlow',v=>v],['fireSlowMs','vFireSlowMs',v=>v]];
const TOGGLES=['preview','haptics','sound','shake','fixedStick','autofire'];
function syncPanel(){
  binds.forEach(([id,lbl,fmt])=>{const el=document.getElementById(id);
    el.value=cfg[id]; document.getElementById(lbl).textContent=fmt(cfg[id]);});
  TOGGLES.forEach(id=>document.getElementById(id).checked=cfg[id]);
}
binds.forEach(([id,lbl,fmt])=>{const el=document.getElementById(id);
  el.addEventListener('input',()=>{cfg[id]=parseFloat(el.value);
    document.getElementById(lbl).textContent=fmt(cfg[id]); savePrefs();});});
TOGGLES.forEach(id=>{document.getElementById(id)
  .addEventListener('change',e=>{cfg[id]=e.target.checked; savePrefs();});});
document.getElementById('reset').onclick=()=>{Object.assign(cfg,DEFAULTS);syncPanel();savePrefs();};
syncPanel();

// ---- fixed-stick center calibration (2 taps: left thumb, then right thumb) ----
const calib=document.getElementById('calib');
const calibText=document.getElementById('calibText');
let calibStep=null;
document.getElementById('calibBtn').onclick=()=>{
  panel.classList.remove('open');
  calibStep='move'; calibText.textContent='Tap where your LEFT thumb sits (move stick)';
  calib.classList.add('active');
};
calib.addEventListener('pointerdown',e=>{
  const x=e.clientX, y=e.clientY;
  if(calibStep==='move'){
    cfg.moveCx=x/W; cfg.moveCy=y/H; calibStep='aim';
    calibText.textContent='Now tap where your RIGHT thumb sits (aim stick)';
  } else if(calibStep==='aim'){
    cfg.aimCx=x/W; cfg.aimCy=y/H; calibStep=null;
    calib.classList.remove('active');
    cfg.fixedStick=true; savePrefs(); syncPanel();   // defining centers turns Fixed on
  }
});

// ---- HUD stat pills (sandbox: hits · roguelike: level/kills) ----
const elHits=document.getElementById('statHits');
const elRun=document.getElementById('statRun');
function updateHud(){
  elHits.textContent='Hits '+score;
  elRun.textContent='Lv '+run.level+' · '+run.kills+' kills · '+'♥'.repeat(run.hp);
}

// ---- between-wave upgrade pick (3 cards; pauses the sim via run.phase==='upgrade') ----
const upOverlay=document.getElementById('upgrade');
const upCards=document.getElementById('upgradeCards');
function offerUpgrade(){
  run.phase='upgrade';
  upCards.innerHTML='';
  pickUpgrades(3).forEach(u=>{
    const b=document.createElement('button');
    b.className='up-card';
    b.innerHTML='<b>'+u.name+'</b><small>'+u.desc+'</small>';
    b.onclick=()=>{ u.apply(); updateHud(); upOverlay.classList.remove('active'); nextWave(); };
    upCards.appendChild(b);
  });
  upOverlay.classList.add('active');
}

// ---- game over / run summary ----
const gameover=document.getElementById('gameover');
function showGameOver(){
  started=false;
  document.getElementById('hud').classList.add('hud-hidden');
  document.getElementById('goStats').textContent='Reached wave '+run.level+' · '+run.kills+' kills';
  gameover.classList.add('active');
}
document.getElementById('goRetry').onclick=()=>{ gameover.classList.remove('active'); startMode('roguelike'); };
document.getElementById('goMenu').onclick =()=>{ gameover.classList.remove('active'); toMenu(); };

// ---- sandbox upgrade tester: apply any upgrade (stackable) to try combos ----
const sbUp=document.getElementById('sbUp');
const sbUpList=document.getElementById('sbUpList');
function openSandboxUpgrades(){
  paused=true; sbUpList.innerHTML='';
  UPGRADES.forEach(u=>{
    const b=document.createElement('button'); b.className='up-card';
    b.innerHTML='<b>'+u.name+'</b><small>'+u.desc+'</small>';
    b.onclick=()=>{ u.apply(); updateHud(); };   // stackable; overlay stays open
    sbUpList.appendChild(b);
  });
  sbUp.classList.add('active');
}
document.getElementById('sbUpgradeBtn').onclick=openSandboxUpgrades;
document.getElementById('sbUpClear').onclick=()=>{ run.mods=freshMods(); run.maxHp=3; run.hp=3; tank.maxHp=3; tank.hp=3; updateHud(); };
document.getElementById('sbUpClose').onclick=()=>{ sbUp.classList.remove('active'); paused=false; };
