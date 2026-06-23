"use strict";
// render — reads state, draws the board, tank, shells, particles, sticks. No mutation.

function drawStick(p,color){
  if(!p)return; const s=stickVec(p);
  ctx.save();
  ctx.globalAlpha=0.9;
  ctx.beginPath();ctx.arc(p.bx,p.by,cfg.rad,0,7);ctx.strokeStyle='rgba(255,255,255,.5)';ctx.lineWidth=3;ctx.stroke();
  ctx.beginPath();ctx.arc(p.bx,p.by,cfg.rad,0,7);ctx.fillStyle='rgba(255,255,255,.12)';ctx.fill();
  ctx.beginPath();ctx.arc(p.bx+s.x,p.by+s.y,28,0,7);ctx.fillStyle=color;ctx.fill();
  ctx.strokeStyle='rgba(0,0,0,.18)';ctx.lineWidth=2;ctx.stroke();
  ctx.restore();
}
function drawPreview(){
  if(!cfg.preview)return; const ap=activePointer('aim'); if(!ap)return;
  let g={x:tank.x+Math.cos(tank.aimTarget)*(tank.r+10),
         y:tank.y+Math.sin(tank.aimTarget)*(tank.r+10),
         vx:Math.cos(tank.aimTarget)*cfg.shell, vy:Math.sin(tank.aimTarget)*cfg.shell,b:cfg.bounce};
  ctx.save();ctx.setLineDash([3,7]);ctx.lineWidth=2.5;ctx.strokeStyle='rgba(44,42,38,.45)';
  ctx.beginPath();ctx.moveTo(g.x,g.y);
  const sdt=1/240;
  for(let i=0;i<260;i++){
    const r=reflectStep(g,0,0,sdt); g.x=r.x;g.y=r.y;g.vx=r.vx;g.vy=r.vy;
    if(r.hit){g.b--; if(g.b<0)break;}
    if(targets.some(t=>Math.hypot(g.x-t.x,g.y-t.y)<t.r+4))break;
    ctx.lineTo(g.x,g.y);
  }
  ctx.stroke();ctx.restore();
}
function render(){
  ctx.save();
  if(shake>0) ctx.translate((Math.random()-0.5)*shake,(Math.random()-0.5)*shake);
  // board
  ctx.fillStyle=getCSS('--board');ctx.fillRect(0,0,W,H);
  ctx.strokeStyle=getCSS('--grid');ctx.lineWidth=1;
  const g=34;
  for(let x=FRAME;x<=W-FRAME;x+=g){ctx.beginPath();ctx.moveTo(x,FRAME);ctx.lineTo(x,H-FRAME);ctx.stroke();}
  for(let y=FRAME;y<=H-FRAME;y+=g){ctx.beginPath();ctx.moveTo(FRAME,y);ctx.lineTo(W-FRAME,y);ctx.stroke();}
  // frame
  ctx.strokeStyle=getCSS('--frame');ctx.lineWidth=6;
  ctx.strokeRect(FRAME-3,FRAME-3,W-2*FRAME+6,H-2*FRAME+6);
  // obstacles
  for(const o of obstacles){
    ctx.fillStyle=getCSS('--slate');ctx.fillRect(o.x,o.y,o.w,o.h);
    ctx.fillStyle=getCSS('--slate-top');ctx.fillRect(o.x,o.y,o.w,5);
  }
  drawPreview();
  // targets
  for(const t of targets){
    const pulse=1+Math.sin(t.t*5)*0.06;
    ctx.save();ctx.translate(t.x,t.y);ctx.scale(pulse,pulse);
    ctx.beginPath();ctx.arc(0,0,t.r,0,7);ctx.fillStyle=getCSS('--enemy');ctx.fill();
    ctx.beginPath();ctx.arc(0,0,t.r*0.45,0,7);ctx.fillStyle='rgba(255,255,255,.85)';ctx.fill();
    ctx.restore();
  }
  // shells
  for(const sh of shells){ctx.beginPath();ctx.arc(sh.x,sh.y,5,0,7);ctx.fillStyle=getCSS('--shell');ctx.fill();}
  // particles
  for(const p of particles){ctx.globalAlpha=Math.max(0,p.life*3);ctx.fillStyle=p.c;
    ctx.beginPath();ctx.arc(p.x,p.y,3,0,7);ctx.fill();ctx.globalAlpha=1;}
  // tank
  ctx.save();ctx.translate(tank.x,tank.y);
  ctx.save();ctx.rotate(tank.bodyAngle);
  ctx.fillStyle=getCSS('--tank-dark');ctx.fillRect(-tank.r-2,-tank.r+1,tank.r*2+4,5);
  ctx.fillRect(-tank.r-2,tank.r-6,tank.r*2+4,5);
  ctx.fillStyle=getCSS('--tank');ctx.fillRect(-tank.r,-tank.r+3,tank.r*2,tank.r*2-6);
  ctx.restore();
  // turret
  ctx.rotate(tank.turretAngle);
  ctx.fillStyle=getCSS('--tank-dark');ctx.fillRect(0,-4,tank.r+12,8);
  ctx.beginPath();ctx.arc(0,0,9,0,7);ctx.fill();
  ctx.fillStyle=getCSS('--tank');ctx.beginPath();ctx.arc(0,0,6,0,7);ctx.fill();
  ctx.restore();
  ctx.restore();
  // sticks
  drawStick(activePointer('move'),getCSS('--tank'));
  drawStick(activePointer('aim'),'rgba(217,72,59,.92)');
  // fire button (pubg)
  if(mode==='pubg'){
    const held=activePointer('fire');
    ctx.beginPath();ctx.arc(fireBtn.x,fireBtn.y,fireBtn.r,0,7);
    ctx.fillStyle=held?'rgba(217,72,59,.95)':'rgba(217,72,59,.78)';ctx.fill();
    ctx.strokeStyle='rgba(255,255,255,.8)';ctx.lineWidth=3;ctx.stroke();
    ctx.fillStyle='#fff';ctx.font='600 12px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText('FIRE',fireBtn.x,fireBtn.y);
  }
}
const cssCache={};
function getCSS(v){ if(!cssCache[v]) cssCache[v]=getComputedStyle(document.documentElement).getPropertyValue(v).trim(); return cssCache[v]; }
