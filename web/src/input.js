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

cv.addEventListener('pointerdown',e=>{
  if(!started) return;
  cv.setPointerCapture(e.pointerId);
  const x=e.clientX,y=e.clientY;
  if(inFireBtn(x,y)){ pointers.set(e.pointerId,{role:'fire'}); tryFire(); return; }
  const role = x < W/2 ? 'move' : 'aim';
  pointers.set(e.pointerId,{role,bx:x,by:y,cx:x,cy:y});
});
cv.addEventListener('pointermove',e=>{
  const p=pointers.get(e.pointerId); if(!p||p.role==='fire')return;
  p.cx=e.clientX; p.cy=e.clientY;
  if(p.role==='aim'){ const s=stickVec(p); if(s.raw>6) tank.aimTarget=s.ang; }
});
function endPointer(e){
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
