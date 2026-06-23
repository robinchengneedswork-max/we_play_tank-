"use strict";
// logic — firing, enemy AI, shell physics, per-frame world update, combat resolution.

// Player effective stats = cfg baseline × run upgrade mods (mods default to 1/0,
// so with no upgrades the player is exactly cfg — live tuning + sandbox unchanged).
function pMove(){   return cfg.move    * run.mods.move; }
function pTurret(){ return cfg.turret  * run.mods.turret; }
function pCd(){     return cfg.cd      * run.mods.cd; }
function pShell(){  return cfg.shell   * run.mods.shell; }
function pBounce(){ return cfg.bounce  + run.mods.bounce; }
function pMaxShells(){ return Math.round(cfg.maxshell + run.mods.maxShells); }

// Generic fire: any tank shoots along `aim`. Enemies read their per-tank stats;
// the player reads cfg×mods. tryFire() is the player's wrapper.
function fire(t, aim){
  const now=performance.now();
  const isP=(t===tank);
  const cd        = isP? pCd()        : (t.cd        ?? cfg.cd);
  const maxShells = isP? pMaxShells() : (t.maxShells ?? cfg.maxshell);
  const speed     = isP? pShell()     : (t.shellSpeed?? cfg.shell);
  const bounce    = isP? pBounce()    : (t.bounce    ?? cfg.bounce);
  if(now-(t.lastFire||0) < cd) return;
  let own=0; for(const s of shells) if(s.owner===t) own++;
  if(own>=maxShells) return;
  t.lastFire=now;
  const tipX=t.x+Math.cos(aim)*(t.r+10);
  const tipY=t.y+Math.sin(aim)*(t.r+10);
  shells.push({x:tipX,y:tipY,vx:Math.cos(aim)*speed,vy:Math.sin(aim)*speed,b:bounce,life:3.2,team:t.team,owner:t,rocket:!!t.rocket});
  for(let i=0;i<6;i++){const sp=60+Math.random()*120,ang=aim+(Math.random()-0.5)*0.7;
    particles.push({x:tipX,y:tipY,vx:Math.cos(ang)*sp,vy:Math.sin(ang)*sp,life:0.25,c:'#e8b24a'});}
  SFX.shoot(isP);
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
    for(const o of blockRects) if(x>o.x&&x<o.x+o.w&&y>o.y&&y<o.y+o.h) return true; }
  return false;
}
// approximate 1-bounce bank shot: reflect the target across each candidate
// surface, aim at the crossing point if it lies on that surface's span and both
// legs are clear. Surfaces = the arena frame AND every block edge (shells bounce
// off blocks too, not just the walls). Holes are NOT surfaces (M1) — bankAim only
// ever reads blockRects. Returns an angle or null. (2-cushion is out of scope.)
function bankSurfaces(){
  // each surface: axis ('x' vertical / 'y' horizontal), position v, facing side s
  // (shooter must satisfy (e[axis]-v)*s >= 0), and the [lo,hi] span on the other axis.
  const surf=[
    {axis:'x',v:FRAME,    s: 1,lo:FRAME,hi:H-FRAME},
    {axis:'x',v:W-FRAME,  s:-1,lo:FRAME,hi:H-FRAME},
    {axis:'y',v:FRAME,    s: 1,lo:FRAME,hi:W-FRAME},
    {axis:'y',v:H-FRAME,  s:-1,lo:FRAME,hi:W-FRAME},
  ];
  for(const o of blockRects){
    surf.push({axis:'x',v:o.x,     s:-1,lo:o.y,hi:o.y+o.h});   // left face
    surf.push({axis:'x',v:o.x+o.w, s: 1,lo:o.y,hi:o.y+o.h});   // right face
    surf.push({axis:'y',v:o.y,     s:-1,lo:o.x,hi:o.x+o.w});   // top face
    surf.push({axis:'y',v:o.y+o.h, s: 1,lo:o.x,hi:o.x+o.w});   // bottom face
  }
  return surf;
}
function bankAim(e,tx,ty){
  for(const {axis,v,s,lo,hi} of bankSurfaces()){
    let bx,by;
    if(axis==='x'){
      if((e.x-v)*s<0) continue;                                // must face the surface
      const mx=2*v-tx, tt=(v-e.x)/((mx-e.x)||1e-6); if(tt<=0||tt>=1) continue;
      bx=v; by=e.y+(ty-e.y)*tt;
    } else {
      if((e.y-v)*s<0) continue;
      const my=2*v-ty, tt=(v-e.y)/((my-e.y)||1e-6); if(tt<=0||tt>=1) continue;
      by=v; bx=e.x+(tx-e.x)*tt;
    }
    if((axis==='x'?by:bx)<lo || (axis==='x'?by:bx)>hi) continue;  // crossing on the surface span?
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
  // intercept point, folded back inside the walls each step — the player clamps/
  // slides along the frame, so a lead that runs past a wall would just miss.
  let tx=tank.x,ty=tank.y;
  for(let k=0;k<2;k++){
    const d=Math.hypot(tx-e.x,ty-e.y), t=d/speed*lead;
    tx=Math.max(FRAME+tank.r,Math.min(W-FRAME-tank.r,tank.x+tank.vx*t));
    ty=Math.max(FRAME+tank.r,Math.min(H-FRAME-tank.r,tank.y+tank.vy*t));
  }
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
// Push a circular tank out of any rect it overlaps. Blocks AND holes both stop
// movement (you can't drive into a pit), so both lists are tested here. Shells +
// LOS deliberately do NOT use this — they read blockRects only (holes are see/fire-through).
function pushOutTerrain(t){
  for(const rects of [blockRects, holeRects]) for(const o of rects){
    const cx=Math.max(o.x,Math.min(t.x,o.x+o.w));
    const cy=Math.max(o.y,Math.min(t.y,o.y+o.h));
    const dx=t.x-cx, dy=t.y-cy, d=Math.hypot(dx,dy);
    if(d<t.r){ const nx=dx/(d||1),ny=dy/(d||1); t.x=cx+nx*t.r; t.y=cy+ny*t.r; }
  }
}
function moveEnemy(e,dt){
  e.x+=e.vx*dt; e.y+=e.vy*dt;
  e.x=Math.max(FRAME+e.r,Math.min(W-FRAME-e.r,e.x));
  e.y=Math.max(FRAME+e.r,Math.min(H-FRAME-e.r,e.y));
  pushOutTerrain(e);
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
    if(m.arm<=0){                              // armed: any tank nearby trips it
      if(near(tank,m,m.blast*0.6)) { detonate(m); continue; }
      for(const e of enemies){ if(!e.spawning && near(e,m,m.blast*0.6)){ detonate(m); break; } }
    }
  }
  for(let i=mines.length-1;i>=0;i--) if(mines[i].dead) mines.splice(i,1);
}
// Mines hit EVERYONE in the blast, regardless of team — bait enemies into them, but mind your own feet.
function detonate(m){
  if(m.dead) return; m.dead=true;
  SFX.mineBoom(); burst(m.x,m.y,'#e8a23a',22); if(cfg.shake) shake=Math.min(shake+9,13);
  if(near(tank,m,m.blast)) damageTank(tank,1);
  for(const e of [...enemies]){ if(!e.spawning && near(e,m,m.blast)) damageTank(e,1); }
  for(const o of mines){ if(!o.dead && near(o,m,m.blast)) detonate(o); }   // chain
}

// ---- physics ----
function reflectStep(o,nx,ny,dt){
  // step a moving point, reflecting off frame + blocks. returns {x,y,vx,vy,hit}
  let x=o.x,y=o.y,vx=o.vx,vy=o.vy,hit=false;
  let px=x+vx*dt, py=y+vy*dt;
  if(px<FRAME){px=FRAME;vx=-vx;hit=true;} else if(px>W-FRAME){px=W-FRAME;vx=-vx;hit=true;}
  if(py<FRAME){py=FRAME;vy=-vy;hit=true;} else if(py>H-FRAME){py=H-FRAME;vy=-vy;hit=true;}
  for(const ob of blockRects){
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
  if(paused) return;                                            // sandbox upgrade overlay
  if(gameMode==='roguelike' && run.phase==='upgrade') return;   // paused while choosing an upgrade
  const playerDead = gameMode==='roguelike' && run.phase==='dead';
  // ---- player movement (skipped once dead — the wreck just sits while it explodes) ----
  if(!playerDead){
    // frozen during the warp-in countdown — the player can't move before the wave goes live
    const inWarmup = gameMode==='roguelike' && run.phase==='intermission';
    if(inWarmup){
      tank.vx=0; tank.vy=0;
    } else {
      // recoil brake: speed drops for a moment after firing
      const baseMove = pMove();
      const moveSpeed = now<tank.fireSlowUntil ? Math.max(20, baseMove-cfg.fireSlow*run.mods.fireSlow) : baseMove;
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
      // tank vs terrain (blocks + holes both block movement)
      pushOutTerrain(tank);
      trailTank(tank,dt);
      // auto-fire: hold the aim stick past the ring to keep firing on cooldown
      if(cfg.autofire){ const ap=activePointer('aim'); if(ap && stickVec(ap).raw>cfg.rad) tryFire(); }
    }
    // turret easing toward aim target (allowed during warm-up so you can pre-aim)
    if(tank.aimTarget!==undefined){
      let d=((tank.aimTarget-tank.turretAngle+Math.PI)%(2*Math.PI))-Math.PI;
      tank.turretAngle+=d*pTurret();
    }
  }
  // ---- wave intermission (breather + countdown while enemies warp in) ----
  if(gameMode==='roguelike' && run.phase==='intermission'){
    run.timer-=dt*1000;
    if(run.timer<=0){
      run.phase='fighting'; SFX.waveStart();
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
      if(r.hit){ sh.b--; if(sh.team==='player') SFX.ricochet(); if(sh.b<0){dead=true;break;} }
      // hit an opposing tank?
      let victim=null;
      if(sh.team!=='player' && Math.hypot(sh.x-tank.x,sh.y-tank.y)<tank.r+4) victim=tank;
      if(!victim){ for(const e of enemies){ if(sh.team!==e.team && !e.spawning && Math.hypot(sh.x-e.x,sh.y-e.y)<e.r+4){ victim=e; break; } } }
      if(victim){ damageTank(victim,1); dead=true; break; }
      // any shell detonates a mine it touches
      for(const m of mines){ if(!m.dead && Math.hypot(sh.x-m.x,sh.y-m.y)<10){ detonate(m); dead=true; break; } }
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
    if(gameMode==='roguelike'){
      if(run.phase==='dead') return;      // already gone
      onPlayerDeath();                     // any hit is lethal → lose a life, retry the wave
    } else {                               // sandbox player is immortal (feedback only)
      burst(t.x,t.y,'#ffffff',12);
      if(cfg.shake) shake=Math.min(shake+8,12);
      if(cfg.haptics&&navigator.vibrate) navigator.vibrate([18,40,18]);
      SFX.hit();
    }
  } else {
    t.hp-=dmg;
    burst(t.x,t.y,t.color,10);
    if(cfg.shake) shake=Math.min(shake+4,9);
    if(t.hp<=0) killEnemy(t); else SFX.hit();
  }
}
function killEnemy(e){
  const i=enemies.indexOf(e); if(i<0) return;
  enemies.splice(i,1);
  score++;
  burst(e.x,e.y,e.color,16); SFX.explode();
  if(cfg.shake) shake=Math.min(shake+6,11);
  if(cfg.haptics&&navigator.vibrate) navigator.vibrate([12,28,12]);
  if(gameMode==='roguelike'){ run.kills++; updateHud(); if(enemies.length===0) offerUpgrade(); }
  else if(gameMode==='sandbox'){ updateHud(); const p=randSpawnPos(); spawnEnemy(e.type,p.x,p.y); }
}
function onPlayerDeath(){
  if(run.phase==='dead') return;
  run.phase='dead';
  run.hp=Math.max(0,run.hp-1); tank.hp=run.hp; updateHud();   // spend a life
  burst(tank.x,tank.y,'#ffffff',20); burst(tank.x,tank.y,'#e8a23a',20);
  if(cfg.shake) shake=18;
  if(cfg.haptics&&navigator.vibrate) navigator.vibrate([40,60,120]);
  SFX.death();
  // out of lives → run summary; otherwise retry the wave (killed tanks stay dead)
  if(run.hp<=0) setTimeout(showGameOver, 750);
  else          setTimeout(restartLevel, 900);
}
