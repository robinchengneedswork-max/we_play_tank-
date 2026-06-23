"use strict";
// logic — firing, shell physics, per-frame world update, scoring.

function tryFire(){
  const now=performance.now();
  if(now-lastFire<cfg.cd) return;
  if(shells.length>=cfg.maxshell) return;
  lastFire=now;
  const a=tank.turretAngle;
  const tipX=tank.x+Math.cos(a)*(tank.r+10);
  const tipY=tank.y+Math.sin(a)*(tank.r+10);
  shells.push({x:tipX,y:tipY,vx:Math.cos(a)*cfg.shell,vy:Math.sin(a)*cfg.shell,b:cfg.bounce,life:3.2});
  for(let i=0;i<6;i++){const sp=60+Math.random()*120,ang=a+(Math.random()-0.5)*0.7;
    particles.push({x:tipX,y:tipY,vx:Math.cos(ang)*sp,vy:Math.sin(ang)*sp,life:0.25,c:'#e8b24a'});}
  if(cfg.shake) shake=Math.min(shake+5,9);
  if(cfg.haptics&&navigator.vibrate) navigator.vibrate(18);
}

// ---- physics ----
function reflectStep(o,nx,ny,dt){
  // step a moving point, reflecting off frame + obstacles. returns {x,y,vx,vy,hit}
  let x=o.x,y=o.y,vx=o.vx,vy=o.vy,hit=false;
  let px=x+vx*dt, py=y+vy*dt;
  if(px<FRAME){px=FRAME;vx=-vx;hit=true;} else if(px>W-FRAME){px=W-FRAME;vx=-vx;hit=true;}
  if(py<FRAME){py=FRAME;vy=-vy;hit=true;} else if(py>H-FRAME){py=H-FRAME;vy=-vy;hit=true;}
  for(const ob of obstacles){
    if(px>ob.x&&px<ob.x+ob.w&&py>ob.y&&py<ob.y+ob.h){
      // resolve on the axis we entered from
      const fromLeft=x<=ob.x, fromRight=x>=ob.x+ob.w;
      const fromTop=y<=ob.y, fromBot=y>=ob.y+ob.h;
      if(fromLeft||fromRight){ vx=-vx; px=fromLeft?ob.x-0.1:ob.x+ob.w+0.1; }
      else if(fromTop||fromBot){ vy=-vy; py=fromTop?ob.y-0.1:ob.y+ob.h+0.1; }
      else { vx=-vx; vy=-vy; }
      hit=true;
    }
  }
  return {x:px,y:py,vx,vy,hit};
}

function update(dt){
  // movement
  const mp=activePointer('move');
  if(mp){ const s=stickVec(mp); const n=s.mag/cfg.rad;
    tank.vx=Math.cos(s.ang)*cfg.move*n; tank.vy=Math.sin(s.ang)*cfg.move*n;
    const target=s.ang; let d=((target-tank.bodyAngle+Math.PI)%(2*Math.PI))-Math.PI;
    tank.bodyAngle+=d*cfg.body;
  } else { tank.vx*=0.8; tank.vy*=0.8; }
  tank.x+=tank.vx*dt; tank.y+=tank.vy*dt;
  // tank vs frame
  tank.x=Math.max(FRAME+tank.r,Math.min(W-FRAME-tank.r,tank.x));
  tank.y=Math.max(FRAME+tank.r,Math.min(H-FRAME-tank.r,tank.y));
  // tank vs obstacles (push out)
  for(const o of obstacles){
    const cx=Math.max(o.x,Math.min(tank.x,o.x+o.w));
    const cy=Math.max(o.y,Math.min(tank.y,o.y+o.h));
    const dx=tank.x-cx, dy=tank.y-cy, d=Math.hypot(dx,dy);
    if(d<tank.r){ const nx=dx/(d||1),ny=dy/(d||1); tank.x=cx+nx*tank.r; tank.y=cy+ny*tank.r; }
  }
  // turret easing toward aim target
  if(tank.aimTarget!==undefined){
    let d=((tank.aimTarget-tank.turretAngle+Math.PI)%(2*Math.PI))-Math.PI;
    tank.turretAngle+=d*cfg.turret;
  }
  // shells
  for(let i=shells.length-1;i>=0;i--){
    const sh=shells[i]; sh.life-=dt; if(sh.life<=0){shells.splice(i,1);continue;}
    const steps=4, sdt=dt/steps; let dead=false;
    for(let k=0;k<steps;k++){
      const r=reflectStep(sh,0,0,sdt); sh.x=r.x;sh.y=r.y;sh.vx=r.vx;sh.vy=r.vy;
      if(r.hit){ sh.b--; if(sh.b<0){dead=true;break;} }
      for(const tg of targets){ if(Math.hypot(sh.x-tg.x,sh.y-tg.y)<tg.r+4){
        hitTarget(tg); dead=true; break; } }
      if(dead)break;
    }
    if(dead) shells.splice(i,1);
  }
  // particles
  for(let i=particles.length-1;i>=0;i--){const p=particles[i];p.life-=dt;
    if(p.life<=0){particles.splice(i,1);continue;} p.x+=p.vx*dt;p.y+=p.vy*dt;p.vx*=0.9;p.vy*=0.9;}
  // targets gentle pulse
  targets.forEach(t=>t.t+=dt);
  if(shake>0) shake=Math.max(0,shake-dt*30);
}
function hitTarget(tg){
  score++; document.getElementById('score').textContent='Hits '+score;
  for(let i=0;i<14;i++){const sp=80+Math.random()*200,a=Math.random()*Math.PI*2;
    particles.push({x:tg.x,y:tg.y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,life:0.4,c:'#c0584a'});}
  if(cfg.shake) shake=Math.min(shake+7,11);
  if(cfg.haptics&&navigator.vibrate) navigator.vibrate([12,30,12]);
  placeTarget(tg);
}
