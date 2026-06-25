"use strict";
// input — pointer events → twin-stick move/aim + fire intent.
// Left half of the screen = move stick, right half = aim stick.

const pointers=new Map();   // pointerId -> {role, bx,by, cx,cy}
function stickVec(p){
  let dx=p.cx-p.bx, dy=p.cy-p.by;
  const d=Math.hypot(dx,dy)||1;
  const clamp=Math.min(d,cfg.rad);
  return {x:dx/d*clamp, y:dy/d*clamp, mag:clamp, raw:d, ang:Math.atan2(dy,dx)};
}
function inFireBtn(x,y){ return mode==='pubg' && Math.hypot(x-fireBtn.x,y-fireBtn.y)<fireBtn.r+6; }
function inDeployBtn(x,y){ return run.gadget && Math.hypot(x-deployBtn.x,y-deployBtn.y)<deployBtn.r+6; }

cv.addEventListener('pointerdown',e=>{
  if(!started || e.pointerType==='mouse') return;   // mouse is handled by the desktop scheme below
  cv.setPointerCapture(e.pointerId);
  const x=e.clientX,y=e.clientY;
  if(inDeployBtn(x,y)){ pointers.set(e.pointerId,{role:'deploy'}); return; }   // edge-detected in update()
  if(inFireBtn(x,y)){ pointers.set(e.pointerId,{role:'fire'}); tryFire(); return; }
  const role = x < W/2 ? 'move' : 'aim';
  // Floating: base = touch point. Fixed: base = the stick's defined center.
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
  if(p.role==='aim'){ const s=stickVec(p); if(s.raw>6) tank.aimTarget=s.ang; }
});
function endPointer(e){
  if(e.pointerType==='mouse') return;
  const p=pointers.get(e.pointerId); if(!p)return;
  if(p.role==='aim'){
    const s=stickVec(p);
    if(mode==='brawl' && s.mag>cfg.dz){ tank.aimTarget=s.ang; tryFire(); }
    // pubg: no fire on release; both keep last turret angle
  }
  pointers.delete(e.pointerId);
}
cv.addEventListener('pointerup',endPointer);
cv.addEventListener('pointercancel',endPointer);
function activePointer(role){ for(const p of pointers.values()) if(p.role===role) return p; return null; }

// ---- desktop scheme: WASD/arrows drive, mouse aims the turret, click or space fires.
// Coexists with touch — the pointer handlers above bail on mouse pointers, and these
// only feed flags that update() reads, so nothing fires while not started / mid-menu.
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
function fireHeld(){ return mouseDown || keys.has('Space'); }
// Deploy intent (edge-detected in update): the left deploy button, a hard shove of the move stick
// past its ring, the Q key, or a right-click. `deployHeld()` is the raw held state.
function deployHeld(){
  if(!run.gadget) return false;
  for(const p of pointers.values()) if(p.role==='deploy') return true;
  const mp=activePointer('move'); if(mp && stickVec(mp).raw>cfg.rad+18) return true;
  return keys.has('KeyQ') || rmbDown;
}

window.addEventListener('keydown',e=>{
  if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) e.preventDefault();
  keys.add(e.code);
});
window.addEventListener('keyup',e=>{ keys.delete(e.code); });
cv.addEventListener('mousemove',e=>{ mouseX=e.clientX; mouseY=e.clientY; mouseAim=true; });
cv.addEventListener('mousedown',e=>{ if(e.button===0){ mouseDown=true; mouseX=e.clientX; mouseY=e.clientY; mouseAim=true; }
  else if(e.button===2){ rmbDown=true; }   // right-click = deploy gadget (desktop)
});
window.addEventListener('mouseup',e=>{ if(e.button===0) mouseDown=false; else if(e.button===2) rmbDown=false; });
cv.addEventListener('contextmenu',e=>e.preventDefault());   // no context menu on a right-click mid-fight
