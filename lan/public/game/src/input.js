"use strict";
// input — produces the LOCAL player's intent (the host couch seat = players[0]/LP()) from a touch
// twin-stick OR keyboard+mouse. Networked players fill their own intent from the wire (B2); this
// module only ever drives LP(). pollLocalInput() is called once per frame from update().

const pointers=new Map();   // pointerId -> {role, bx,by, cx,cy}
function stickVec(p){
  let dx=p.cx-p.bx, dy=p.cy-p.by;
  const d=Math.hypot(dx,dy)||1;
  const clamp=Math.min(d,cfg.rad);
  return {x:dx/d*clamp, y:dy/d*clamp, mag:clamp, raw:d, ang:Math.atan2(dy,dx)};
}
function activePointer(role){ for(const p of pointers.values()) if(p.role===role) return p; return null; }
function inFireBtn(x,y){ return mode==='pubg' && Math.hypot(x-fireBtn.x,y-fireBtn.y)<fireBtn.r+6; }
function inDeployBtn(x,y){ const lp=LP(); return !!(lp&&lp.gadget) && Math.hypot(x-deployBtn.x,y-deployBtn.y)<deployBtn.r+6; }

// ---- touch twin-stick (host with a touchscreen) ----
cv.addEventListener('pointerdown',e=>{
  if(!started || e.pointerType==='mouse') return;
  cv.setPointerCapture(e.pointerId);
  const x=e.clientX,y=e.clientY;
  if(inDeployBtn(x,y)){ pointers.set(e.pointerId,{role:'deploy'}); return; }
  if(inFireBtn(x,y)){ pointers.set(e.pointerId,{role:'fire'}); return; }   // held → firing via poll
  const role = x < W/2 ? 'move' : 'aim';
  let bx=x, by=y;
  if(cfg.fixedStick){
    if(role==='move'){ bx=cfg.moveCx*W; by=cfg.moveCy*H; }
    else            { bx=cfg.aimCx*W;  by=cfg.aimCy*H; }
  }
  pointers.set(e.pointerId,{role,bx,by,cx:x,cy:y});
});
cv.addEventListener('pointermove',e=>{
  if(e.pointerType==='mouse') return;
  const p=pointers.get(e.pointerId); if(!p||p.role==='fire'||p.role==='deploy')return;
  p.cx=e.clientX; p.cy=e.clientY;
});
function endPointer(e){
  if(e.pointerType==='mouse') return;
  const p=pointers.get(e.pointerId); if(!p)return;
  if(p.role==='aim' && mode==='brawl'){            // brawl: release the aim stick to fire along it
    const s=stickVec(p), lp=LP();
    if(lp && s.mag>cfg.dz){ lp.intent.aim=s.ang; lp.intent.aiming=true; tryFire(lp); }
  }
  pointers.delete(e.pointerId);
}
cv.addEventListener('pointerup',endPointer);
cv.addEventListener('pointercancel',endPointer);

// ---- desktop: WASD/arrows drive, mouse aims, click/space fires, Q/right-click deploys ----
const keys=new Set();
let mouseX=0, mouseY=0, mouseAim=false, mouseDown=false, rmbDown=false;
function kbMoveDir(){            // WASD/arrows → movement angle, or null when idle
  let dx=0, dy=0;
  if(keys.has('KeyW')||keys.has('ArrowUp'))    dy-=1;
  if(keys.has('KeyS')||keys.has('ArrowDown'))  dy+=1;
  if(keys.has('KeyA')||keys.has('ArrowLeft'))  dx-=1;
  if(keys.has('KeyD')||keys.has('ArrowRight')) dx+=1;
  return (dx||dy) ? Math.atan2(dy,dx) : null;
}
window.addEventListener('keydown',e=>{
  if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) e.preventDefault();
  // co-op host: the FIRST Space (when there's no keyboard seat yet) drops in the host keyboard+mouse
  // player; after that Space fires normally. Solo build already has a 'local' seat, so this never triggers.
  if(e.code==='Space' && !e.repeat && started && gameMode && !LP() && typeof ensureLocalPlayer==='function'){ ensureLocalPlayer(); return; }
  keys.add(e.code);
});
window.addEventListener('keyup',e=>{ keys.delete(e.code); });
cv.addEventListener('mousemove',e=>{ mouseX=e.clientX; mouseY=e.clientY; mouseAim=true; });
cv.addEventListener('mousedown',e=>{ if(e.button===0){ mouseDown=true; mouseX=e.clientX; mouseY=e.clientY; mouseAim=true; }
  else if(e.button===2){ rmbDown=true; }
});
window.addEventListener('mouseup',e=>{ if(e.button===0) mouseDown=false; else if(e.button===2) rmbDown=false; });
cv.addEventListener('contextmenu',e=>e.preventDefault());

// ---- per-frame: distill all local input sources into LP()'s intent ----
function pollLocalInput(){
  const p=LP(); if(!p) return;
  const it=p.intent;
  // move — keyboard overrides the touch stick
  const kb=kbMoveDir();
  let mx=0,my=0;
  if(kb!==null){ mx=Math.cos(kb); my=Math.sin(kb); }
  else { const mp=activePointer('move'); if(mp){ const s=stickVec(mp); const n=s.mag/cfg.rad; mx=Math.cos(s.ang)*n; my=Math.sin(s.ang)*n; } }
  it.mx=mx; it.my=my;
  // aim — mouse is absolute (recomputed each frame so it tracks while driving); else the touch aim stick
  const ap=activePointer('aim');
  if(mouseAim){ it.aim=Math.atan2(mouseY-p.y, mouseX-p.x); it.aiming=true; }
  else if(ap){ const s=stickVec(ap); if(s.raw>6) it.aim=s.ang; it.aiming=true; }
  else { it.aiming=false; }
  // fire — held (mouse/space/pubg button) or autofire (aim stick shoved past the ring)
  let firing = mouseDown || keys.has('Space') || !!activePointer('fire');
  if(cfg.autofire && ap && stickVec(ap).raw>cfg.rad) firing=true;
  it.firing=firing;
  // deploy — held deploy button / move-stick shove / Q / right-click
  let deploy=false;
  if(p.gadget){
    if(activePointer('deploy')) deploy=true;
    const mp2=activePointer('move'); if(mp2 && stickVec(mp2).raw>cfg.rad+18) deploy=true;
    if(keys.has('KeyQ')||rmbDown) deploy=true;
  }
  it.deploy=deploy;
}
