"use strict";
// logic — firing, enemy AI, shell physics, per-frame world update, combat resolution.

// Generic fire: any tank shoots along `aim`. Reads per-tank stats, falling back
// to cfg for tanks that don't define them (i.e. the player) — so player feel is
// unchanged. tryFire() is the player's wrapper.
function fire(t, aim){
  const now=performance.now();
  const cd        = t.cd        ?? cfg.cd;
  const maxShells = t.maxShells ?? cfg.maxshell;
  const speed     = t.shellSpeed?? cfg.shell;
  const bounce    = t.bounce    ?? cfg.bounce;
  if(now-(t.lastFire||0) < cd) return;
  let own=0; for(const s of shells) if(s.owner===t) own++;
  if(own>=maxShells) return;
  t.lastFire=now;
  const tipX=t.x+Math.cos(aim)*(t.r+10);
  const tipY=t.y+Math.sin(aim)*(t.r+10);
  shells.push({x:tipX,y:tipY,vx:Math.cos(aim)*speed,vy:Math.sin(aim)*speed,b:bounce,life:3.2,team:t.team,owner:t,rocket:!!t.rocket});
  for(let i=0;i<6;i++){const sp=60+Math.random()*120,ang=aim+(Math.random()-0.5)*0.7;
    particles.push({x:tipX,y:tipY,vx:Math.cos(ang)*sp,vy:Math.sin(ang)*sp,life:0.25,c:'#e8b24a'});}
  if(t.team==='player'){
    tank.fireSlowUntil = now + cfg.fireSlowMs;   // firing brakes movement briefly
    if(cfg.shake) shake=Math.min(shake+5,9);
    if(cfg.haptics&&navigator.vibrate) navigator.vibrate(18);
  }
}
function tryFire(){ fire(tank, tank.turretAngle); }

// soft puff dropped behind a moving shell (velocity-feel trail)
function addSmoke(x,y){
  smoke.push({ x:x+(Math.random()-0.5)*3, y:y+(Math.random()-0.5)*3,
    vx:(Math.random()-0.5)*14, vy:(Math.random()-0.5)*14, life:0.45, max:0.45,
    r:2.5+Math.random()*1.5 });
}

// ---- enemy AI ----
function scheduleFire(e,now){ e.nextFireAt = now + e.fireGap[0] + Math.random()*(e.fireGap[1]-e.fireGap[0]); }

// is the straight segment a→b crossed by an obstacle? (sampled — cheap & good enough)
function segBlocked(x0,y0,x1,y1){
  const n=20;
  for(let i=1;i<n;i++){ const t=i/n, x=x0+(x1-x0)*t, y=y0+(y1-y0)*t;
    for(const o of obstacles) if(x>o.x&&x<o.x+o.w&&y>o.y&&y<o.y+o.h) return true; }
  return false;
}
// approximate 1-bounce bank shot: mirror the target across each wall, aim at the
// bounce point if both legs are clear. Returns an angle or null. (2-cushion is out of scope.)
function bankAim(e,tx,ty){
  const walls=[['x',FRAME],['x',W-FRAME],['y',FRAME],['y',H-FRAME]];
  for(const [axis,v] of walls){
    let mx=tx,my=ty; if(axis==='x') mx=2*v-tx; else my=2*v-ty;
    let bx,by;
    if(axis==='x'){ const tt=(v-e.x)/((mx-e.x)||1e-6); if(tt<=0||tt>=1) continue; bx=v; by=e.y+(my-e.y)*tt; }
    else          { const tt=(v-e.y)/((my-e.y)||1e-6); if(tt<=0||tt>=1) continue; by=v; bx=e.x+(mx-e.x)*tt; }
    if(bx<FRAME-1||bx>W-FRAME+1||by<FRAME-1||by>H-FRAME+1) continue;
    if(segBlocked(e.x,e.y,bx,by)||segBlocked(bx,by,tx,ty)) continue;
    return Math.atan2(by-e.y, bx-e.x);
  }
  return null;
}
// chosen aim angle for an enemy.
//   'track'  = straight at the player's current position.
//   'cutoff' = partial lead (aim slightly ahead of the player's path; rushers like Purple).
//   'predict'= full intercept lead, with a 1-bounce bank fallback around cover (Green).
function aimFor(e){
  if(e.aim==='track') return Math.atan2(tank.y-e.y, tank.x-e.x);
  const speed=e.shellSpeed||cfg.shell;
  const lead = e.aim==='cutoff' ? 0.5 : 1;          // cutoff leads only halfway
  let tx=tank.x,ty=tank.y;
  for(let k=0;k<2;k++){ const d=Math.hypot(tx-e.x,ty-e.y), t=d/speed*lead; tx=tank.x+tank.vx*t; ty=tank.y+tank.vy*t; }
  if(e.aim==='cutoff') return Math.atan2(ty-e.y, tx-e.x);   // rushers don't bother banking
  if(!segBlocked(e.x,e.y,tx,ty)) return Math.atan2(ty-e.y, tx-e.x);
  const bank=bankAim(e,tx,ty);
  return bank!==null ? bank : Math.atan2(ty-e.y, tx-e.x);
}
function driveEnemy(e, now){
  const dx=tank.x-e.x, dy=tank.y-e.y, dist=Math.hypot(dx,dy)||1;
  // movement: hold a band around `engage`
  if(e.speed>0){
    const ux=dx/dist, uy=dy/dist;
    if(dist>e.engage+20){ e.vx=ux*e.speed; e.vy=uy*e.speed; }
    else if(dist<e.engage-20){ e.vx=-ux*e.speed; e.vy=-uy*e.speed; }
    else { e.vx*=0.85; e.vy*=0.85; }
    if(Math.abs(e.vx)+Math.abs(e.vy)>1){
      const md=Math.atan2(e.vy,e.vx); let bd=((md-e.bodyAngle+Math.PI)%(2*Math.PI))-Math.PI; e.bodyAngle+=bd*0.1;
    }
  } else { e.vx=0; e.vy=0; }
  // aim + fire
  if(e.aim==='none'){
    // brown: lazy, doesn't track — occasional loose shot
    if(now>=e.nextFireAt){ fire(e, Math.random()*Math.PI*2); scheduleFire(e,now); }
  } else {
    const aimAng=aimFor(e);
    let td=((aimAng-e.turretAngle+Math.PI)%(2*Math.PI))-Math.PI; e.turretAngle+=td*0.07;
    if(now>=e.nextFireAt){ fire(e, e.turretAngle); scheduleFire(e,now); }
  }
  // mine-layers drop mines on a timer while on the move (up to their `mines` cap)
  if(e.mines>0 && e.speed>0 && now>=e.nextMineAt){
    let own=0; for(const m of mines) if(m.owner===e && !m.dead) own++;
    if(own<e.mines && (Math.abs(e.vx)+Math.abs(e.vy))>20){ layMine(e); SFX.mineLay(); }
    e.nextMineAt = now + 1400 + Math.random()*2200;
  }
}
function moveEnemy(e,dt){
  e.x+=e.vx*dt; e.y+=e.vy*dt;
  e.x=Math.max(FRAME+e.r,Math.min(W-FRAME-e.r,e.x));
  e.y=Math.max(FRAME+e.r,Math.min(H-FRAME-e.r,e.y));
  for(const o of obstacles){
    const cx=Math.max(o.x,Math.min(e.x,o.x+o.w));
    const cy=Math.max(o.y,Math.min(e.y,o.y+o.h));
    const dx=e.x-cx, dy=e.y-cy, d=Math.hypot(dx,dy);
    if(d<e.r){ const nx=dx/(d||1),ny=dy/(d||1); e.x=cx+nx*e.r; e.y=cy+ny*e.r; }
  }
}

// ---- tread marks: dropped while moving; fade out; cleared between levels ----
function trailTank(t,dt){
  const sp=Math.hypot(t.vx,t.vy); if(sp<8) return;
  t._trackAcc=(t._trackAcc||0)+sp*dt;
  if(t._trackAcc>=14){ t._trackAcc=0; tracks.push({x:t.x,y:t.y,a:t.bodyAngle,life:5,max:5}); }
}

// ---- mines: arm → fuse / proximity → explode (team rules like shells) + chain ----
function near(a,b,r){ return Math.hypot(a.x-b.x,a.y-b.y)<r; }
function updateMines(dt){
  for(const m of mines){
    if(m.dead) continue;
    if(m.arm>0) m.arm-=dt;
    m.fuse-=dt;
    if(m.fuse<=0){ detonate(m); continue; }
    if(m.arm<=0){                              // armed: trigger on an opposing tank nearby
      if(m.team!=='player' && near(tank,m,m.blast*0.6)) { detonate(m); continue; }
      for(const e of enemies){ if(!e.spawning && m.team!==e.team && near(e,m,m.blast*0.6)){ detonate(m); break; } }
    }
  }
  for(let i=mines.length-1;i>=0;i--) if(mines[i].dead) mines.splice(i,1);
}
function detonate(m){
  if(m.dead) return; m.dead=true;
  SFX.mineBoom(); burst(m.x,m.y,'#e8a23a',22); if(cfg.shake) shake=Math.min(shake+9,13);
  if(m.team!=='player' && near(tank,m,m.blast)) damageTank(tank,1);
  for(const e of [...enemies]){ if(m.team!==e.team && !e.spawning && near(e,m,m.blast)) damageTank(e,1); }
  for(const o of mines){ if(!o.dead && near(o,m,m.blast)) detonate(o); }   // chain
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
  const now=performance.now();
  // ---- player movement ----
  // recoil brake: speed drops for a moment after firing
  const moveSpeed = now<tank.fireSlowUntil ? Math.max(20, cfg.move-cfg.fireSlow) : cfg.move;
  const mp=activePointer('move');
  if(mp){ const s=stickVec(mp); const n=s.mag/cfg.rad;
    tank.vx=Math.cos(s.ang)*moveSpeed*n; tank.vy=Math.sin(s.ang)*moveSpeed*n;
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
  trailTank(tank,dt);
  // auto-fire: hold the aim stick past the ring to keep firing on cooldown
  if(cfg.autofire){ const ap=activePointer('aim'); if(ap && stickVec(ap).raw>cfg.rad) tryFire(); }
  // ---- wave intermission (breather + countdown while enemies warp in) ----
  if(gameMode==='roguelike' && run.phase==='intermission'){
    run.timer-=dt*1000;
    if(run.timer<=0){
      run.phase='fighting';
      for(const e of enemies){ e.spawning=false; if(e.invisible){ SFX.electric(); e.cloakStart=now; } } // White cloaks on round start
    }
  }
  // ---- enemies (inert while warping in) ----
  for(const e of enemies){ if(e.spawning) continue; driveEnemy(e, now); moveEnemy(e, dt); trailTank(e,dt); }
  // ---- shells ----
  for(let i=shells.length-1;i>=0;i--){
    const sh=shells[i]; sh.life-=dt; if(sh.life<=0){shells.splice(i,1);continue;}
    const steps=4, sdt=dt/steps; let dead=false;
    for(let k=0;k<steps;k++){
      const r=reflectStep(sh,0,0,sdt); sh.x=r.x;sh.y=r.y;sh.vx=r.vx;sh.vy=r.vy;
      if(r.hit){ sh.b--; if(sh.b<0){dead=true;break;} }
      // hit an opposing tank?
      let victim=null;
      if(sh.team!=='player' && Math.hypot(sh.x-tank.x,sh.y-tank.y)<tank.r+4) victim=tank;
      if(!victim){ for(const e of enemies){ if(sh.team!==e.team && !e.spawning && Math.hypot(sh.x-e.x,sh.y-e.y)<e.r+4){ victim=e; break; } } }
      if(victim){ damageTank(victim,1); dead=true; break; }
      if(dead)break;
    }
    if(dead){ shells.splice(i,1); continue; }
    addSmoke(sh.x,sh.y);   // trail behind surviving shells
  }
  // mines
  updateMines(dt);
  // smoke trails
  for(let i=smoke.length-1;i>=0;i--){const s=smoke[i];s.life-=dt;
    if(s.life<=0){smoke.splice(i,1);continue;} s.x+=s.vx*dt;s.y+=s.vy*dt;s.vx*=0.92;s.vy*=0.92;}
  // tread marks
  for(let i=tracks.length-1;i>=0;i--){ tracks[i].life-=dt; if(tracks[i].life<=0) tracks.splice(i,1); }
  // particles
  for(let i=particles.length-1;i>=0;i--){const p=particles[i];p.life-=dt;
    if(p.life<=0){particles.splice(i,1);continue;} p.x+=p.vx*dt;p.y+=p.vy*dt;p.vx*=0.9;p.vy*=0.9;}
  if(shake>0) shake=Math.max(0,shake-dt*30);
}

// ---- combat resolution ----
function burst(x,y,color,n){
  for(let i=0;i<n;i++){const sp=80+Math.random()*200,a=Math.random()*Math.PI*2;
    particles.push({x,y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,life:0.4,c:color});}
}
function damageTank(t, dmg){
  if(t.team==='player'){
    burst(t.x,t.y,'#ffffff',12);
    if(cfg.shake) shake=Math.min(shake+8,12);
    if(cfg.haptics&&navigator.vibrate) navigator.vibrate([18,40,18]);
    if(gameMode==='roguelike'){           // sandbox player is immortal (feedback only)
      t.hp-=dmg; run.hp=Math.max(0,t.hp); updateHud();
      if(t.hp<=0) onPlayerDeath();
    }
  } else {
    t.hp-=dmg;
    burst(t.x,t.y,t.color,10);
    if(cfg.shake) shake=Math.min(shake+4,9);
    if(t.hp<=0) killEnemy(t);
  }
}
function killEnemy(e){
  const i=enemies.indexOf(e); if(i<0) return;
  enemies.splice(i,1);
  score++;
  burst(e.x,e.y,e.color,16);
  if(cfg.shake) shake=Math.min(shake+6,11);
  if(cfg.haptics&&navigator.vibrate) navigator.vibrate([12,28,12]);
  if(gameMode==='roguelike'){ run.kills++; updateHud(); if(enemies.length===0) nextWave(); }
  else if(gameMode==='sandbox'){ updateHud(); const p=randSpawnPos(); spawnEnemy(e.type,p.x,p.y); }
}
function onPlayerDeath(){
  // TODO: proper game-over / run-summary screen. For now, bounce to the menu.
  started=false;
  toMenu();
}
