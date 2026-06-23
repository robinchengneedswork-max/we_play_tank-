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
  ['cd','vCd',v=>v],['dz','vDz',v=>v],['rad','vRad',v=>v],['maxshell','vMax',v=>v]];
function syncPanel(){
  binds.forEach(([id,lbl,fmt])=>{const el=document.getElementById(id);
    el.value=cfg[id]; document.getElementById(lbl).textContent=fmt(cfg[id]);});
  document.getElementById('preview').checked=cfg.preview;
  document.getElementById('haptics').checked=cfg.haptics;
  document.getElementById('shake').checked=cfg.shake;
}
binds.forEach(([id,lbl,fmt])=>{const el=document.getElementById(id);
  el.addEventListener('input',()=>{cfg[id]=parseFloat(el.value);
    document.getElementById(lbl).textContent=fmt(cfg[id]);});});
['preview','haptics','shake'].forEach(id=>{document.getElementById(id)
  .addEventListener('change',e=>cfg[id]=e.target.checked);});
document.getElementById('reset').onclick=()=>{Object.assign(cfg,DEFAULTS);syncPanel();};
syncPanel();

// ---- start: fullscreen + landscape lock ----
document.getElementById('startBtn').onclick=async()=>{
  try{ await document.documentElement.requestFullscreen(); }catch(e){}
  try{ await screen.orientation.lock('landscape'); }catch(e){}
  document.getElementById('start').style.display='none';
  resize(); started=true; tank.aimTarget=tank.turretAngle;
};
