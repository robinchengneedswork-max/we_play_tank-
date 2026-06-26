"use strict";
// logic — firing, enemy AI, shell physics, per-frame world update, combat resolution.
// COUCH CO-OP: every player-facing function takes a player `p`. Enemy AI targets the nearest LIVING,
// non-cloaked player. Friendly fire is ON — a shell hits any tank (player or enemy) except its owner
// until it arms. Lives are a shared team-wipe pool: a player who dies goes `down` (spectates till the
// wave clears); when EVERYONE is down at once the party spends a team life and re-stages the wave.

// Player effective stats = cfg baseline × that player's class × that player's run mods.
function weightMoveMul(p){ return 1/(1+0.07*Math.max(0, p.weight-p.engine)); }
function pMove(p){   return cfg.move   * (p.class?p.class.moveMul :1) * p.mods.move * weightMoveMul(p) * (p.charged?VIBRANIUM_BOOST:1); }
function pTurret(p){ return cfg.turret * p.mods.turret; }
function pCd(p){     return cfg.cd     * p.mods.cd; }
function pShell(p){  return cfg.shell  * (p.class?p.class.shellMul:1) * p.mods.shell; }
function pBounce(p){ return (p.class?p.class.bounce   :cfg.bounce)   + p.mods.bounce; }
function pMaxShells(p){ return Math.round((p.class?p.class.maxShells:cfg.maxshell) + p.mods.maxShells); }

// ---- arsenal helpers ----
function cellPx(){ return currentMap ? (W-2*FRAME)/currentMap.C : 80; }
function playerCloaked(p){ return p.cloak>0 && (performance.now()-p.cloak) < STEALTH_MS; }
function playerFlying(p){ return p.flying>0 && performance.now() < p.flying; }
// nearest living player that ISN'T cloaked — the enemy AI's aim/approach target (null if none visible)
function nearestTarget(x,y){ let best=null,bd=1e18;
  for(const p of livingPlayers()){ if(playerCloaked(p)) continue; const d=(p.x-x)**2+(p.y-y)**2; if(d<bd){bd=d;best=p;} }
  return best; }

// Deploy player p's equipped gadget. Gated by remaining charges + a per-gadget re-deploy cooldown.
function deployGadget(p){
  const g=p.gadget; if(!g) return;
  const now=performance.now();
  if(p.gadgetCharges<=0 || now<p.gadgetCdUntil) return;
  const it=p.intent, moving=Math.hypot(it.mx,it.my)>0.08;
  const moveDir = moving ? Math.atan2(it.my,it.mx) : p.turretAngle;
  const dir = g.dir==='move' ? moveDir : p.turretAngle;
  p.gadgetCharges--; p.gadgetCdUntil = now + (g.cd||GADGET_CD);
  switch(g.id){
    case 'sentryTeal':  deploySentry(p,'teal',   dir); break;
    case 'sentryGrey':  deploySentry(p,'grey',   dir); break;
    case 'trophy':      deploySentry(p,'trophy', dir); break;
    case 'shield':      deployShield(p,dir);            break;
    case 'spiderMines': deploySpiderMines(p);           break;
    case 'dash':        doDash(p,dir);                  break;
    case 'jumpJets':    doJumpJets(p);                  break;
    case 'stealth':     doStealth(p);                   break;
  }
  SFX.deploy(); updateHud();
}
// --- gadget effects ---
function deploySentry(p,kind,dir){
  const x=Math.max(FRAME+12,Math.min(W-FRAME-12, p.x+Math.cos(dir)*30));
  const y=Math.max(FRAME+12,Math.min(H-FRAME-12, p.y+Math.sin(dir)*30));
  turrets.push({ x,y, r:11, hp:TURRET_HP, team:'player', kind, turretAngle:dir, lastFire:0,
                 expire:performance.now()+TURRET_LIFE });
}
function fireTurret(tu){
  const now=performance.now();
  const cd = tu.kind==='teal'?1400:900, speed = tu.kind==='teal'?470:310, rocket = tu.kind==='teal';
  if(now-(tu.lastFire||0)<cd) return;
  let own=0; for(const s of shells) if(s.owner===tu) own++; if(own>=2) return;
  tu.lastFire=now;
  const a=tu.turretAngle, tx=tu.x+Math.cos(a)*(tu.r+8), ty=tu.y+Math.sin(a)*(tu.r+8);
  shells.push({x:tx,y:ty,vx:Math.cos(a)*speed,vy:Math.sin(a)*speed,b:rocket?0:1,life:3,arm:0.16,team:'player',owner:tu,rocket});
  SFX.turretFire();
}
function deployShield(p,dir){
  const d=cellPx()*0.7;
  const x=Math.max(FRAME+8,Math.min(W-FRAME-8, p.x+Math.cos(dir)*d));
  const y=Math.max(FRAME+8,Math.min(H-FRAME-8, p.y+Math.sin(dir)*d));
  shields.push({x,y,r:SHIELD_R,ang:dir,expire:performance.now()+SHIELD_LIFE});
}
function deploySpiderMines(p){
  for(let i=0;i<SPIDER_COUNT;i++){ const a=Math.random()*Math.PI*2, d=14+Math.random()*16;
    spiderMines.push({x:p.x+Math.cos(a)*d, y:p.y+Math.sin(a)*d, r:5, arm:0.4, dead:false}); }
}
function spiderDetonate(m){
  if(m.dead) return; m.dead=true;
  SFX.mineBoom(); burst(m.x,m.y,'#d8c46a',16); if(cfg.shake) shake=Math.min(shake+6,11);
  const blast=40;
  for(const p of livingPlayers()) if(near(p,m,blast)) damageTank(p,1);                 // FF: your own mine can clip a player
  for(const e of [...enemies]){ if(!e.spawning && near(e,m,blast)) damageTank(e,1); }
}
function doDash(p,dir){
  const steps=12, sx=p.x, sy=p.y; let lx=sx, ly=sy;
  for(let i=1;i<=steps;i++){
    const t=i/steps;
    const cx=Math.max(FRAME+p.r,Math.min(W-FRAME-p.r, sx+Math.cos(dir)*DASH_DIST*t));
    const cy=Math.max(FRAME+p.r,Math.min(H-FRAME-p.r, sy+Math.sin(dir)*DASH_DIST*t));
    if(moveBlockedAt(cx,cy,p.r-2)) break;
    lx=cx; ly=cy;
  }
  for(let i=0;i<10;i++){ const t=i/10; particles.push({x:sx+(lx-sx)*t,y:sy+(ly-sy)*t,vx:0,vy:0,life:0.25,c:'#bfe9ff'}); }
  p.x=lx; p.y=ly; pushOutTerrain(p);
  p.iframes = performance.now()+DASH_IFRAMES;
  SFX.dash();
}
function doJumpJets(p){ p.flying = performance.now()+JET_MS; SFX.jet(); }
function doStealth(p){ p.cloak = performance.now(); SFX.cloak(); }
// --- gadget/entity per-frame updaters ---
function updateTurrets(dt,now){
  for(let i=turrets.length-1;i>=0;i--){
    const tu=turrets[i]; if(!tu) continue;
    if(now>=tu.expire || tu.hp<=0){ burst(tu.x,tu.y,tu.hp<=0?'#c96':'#9ab',12); if(tu.hp<=0) SFX.explode(); turrets.splice(i,1); continue; }
    if(tu.kind==='trophy'){
      for(let j=shells.length-1;j>=0;j--){ const s=shells[j]; if(!s||s.team!=='enemy') continue;
        if(Math.hypot(s.x-tu.x,s.y-tu.y)<TROPHY_R){ burst(s.x,s.y,'#bfe9ff',6); shells.splice(j,1); SFX.trophy(); } }
      continue;
    }
    let near=null,nd=1e9;
    for(const e of enemies){ if(e.spawning) continue; const d=Math.hypot(e.x-tu.x,e.y-tu.y); if(d<nd){nd=d;near=e;} }
    if(near){
      const a=Math.atan2(near.y-tu.y,near.x-tu.x);
      const d=((a-tu.turretAngle+Math.PI)%(2*Math.PI))-Math.PI; tu.turretAngle+=d*0.12;
      if(Math.abs(d)<0.2) fireTurret(tu);
    }
  }
}
function updateShields(dt,now){ for(let i=shields.length-1;i>=0;i--) if(now>=shields[i].expire) shields.splice(i,1); }
function updateSpiderMines(dt,now){
  for(let i=spiderMines.length-1;i>=0;i--){
    const m=spiderMines[i]; if(!m) continue;
    if(m.dead){ spiderMines.splice(i,1); continue; }
    if(m.arm>0) m.arm-=dt;
    let near=null,nd=1e9;
    for(const e of enemies){ if(e.spawning) continue; const d=Math.hypot(e.x-m.x,e.y-m.y); if(d<nd){nd=d;near=e;} }
    if(near){
      const a=Math.atan2(near.y-m.y,near.x-m.x);
      m.x+=Math.cos(a)*SPIDER_SPEED*dt; m.y+=Math.sin(a)*SPIDER_SPEED*dt; pushOutTerrain(m);
      if(m.arm<=0 && nd<near.r+10){ spiderDetonate(m); spiderMines.splice(i,1); }
    }
  }
}
// Vibranium: each charged player rams an overlapping enemy for heavy contact damage, then discharges.
function updateVibranium(){
  for(const p of livingPlayers()){
    if(!p.charged) continue;
    for(const e of enemies){ if(e.spawning) continue;
      if(Math.hypot(p.x-e.x,p.y-e.y) < p.r+e.r){
        damageTank(e, VIBRANIUM_DMG); p.charged=false;
        burst(p.x,p.y,'#9fd8ff',18); if(cfg.shake) shake=Math.min(shake+7,12); SFX.explode();
        break;
      }
    }
  }
}

// Raw muzzle: spawn one shell from `t` along `aim`. The right-slot gun-mode shapes a player's shell.
const SPREAD_ARC=0.16;
function emitShell(t, aim){
  const isP=(t.team==='player');
  const speed  = isP? pShell(t)  : (t.shellSpeed?? cfg.shell);
  const bounce = isP? pBounce(t) : (t.bounce    ?? cfg.bounce);
  const tipX=t.x+Math.cos(aim)*(t.r+10), tipY=t.y+Math.sin(aim)*(t.r+10);
  const sh={x:tipX,y:tipY,vx:Math.cos(aim)*speed,vy:Math.sin(aim)*speed,b:bounce,life:3.2,arm:0.16,team:t.team,owner:t,rocket:!!t.rocket};
  if(isP){
    if(t.gunMode==='apds'){ sh.pierce=APDS_PIERCE; sh.hitSet=new Set(); sh.rocket=true; sh.b=0; }
    else if(t.gunMode==='bounceRocket') sh.bounceRocket=1;
    else if(t.gunMode==='scatter') sh.capWeight=1/SCATTER_PELLETS;
  }
  shells.push(sh);
  for(let i=0;i<6;i++){const sp=60+Math.random()*120,ang=aim+(Math.random()-0.5)*0.7;
    particles.push({x:tipX,y:tipY,vx:Math.cos(ang)*sp,vy:Math.sin(ang)*sp,life:0.25,c:'#e8b24a'});}
}
// Generic fire: any tank shoots along `aim`. Gated by cooldown + own-shell cap, then emits the muzzle.
function fire(t, aim){
  const now=performance.now();
  const isP=(t.team==='player');
  const cd        = isP? pCd(t)        : (t.cd        ?? cfg.cd);
  const maxShells = isP? pMaxShells(t) : (t.maxShells ?? cfg.maxshell);
  if(now-(t.lastFire||0) < cd) return false;
  let own=0; for(const s of shells) if(s.owner===t) own += (s.capWeight ?? 1);
  if(own>=maxShells) return false;
  t.lastFire=now;
  if(isP && t.gunMode==='scatter'){
    for(let i=0;i<SCATTER_PELLETS;i++){
      const ang = aim + (i-(SCATTER_PELLETS-1)/2)*SPREAD_ARC;
      if(i===0) emitShell(t, ang);
      else t.scatterQueue.push({ at: now + i*SCATTER_GAP, ang });
    }
  } else emitShell(t, aim);
  SFX.shoot(isP);
  if(isP){
    t.fireSlowUntil = now + cfg.fireSlowMs;
    if(cfg.shake) shake=Math.min(shake+5,9);
    if(cfg.haptics&&navigator.vibrate) navigator.vibrate(18);
  }
  return true;
}
function tryFire(p){
  if(gameMode==='roguelike' && run.phase==='intermission') return;   // can't fire before the wave goes live
  if(run.phase==='shop' || run.phase==='dead') return;
  p.cloak=0;                                   // firing breaks stealth, whatever the gun mode
  if(p.gunMode==='laser'){ fireLaser(p); return; }
  if(p.gunMode==='wireGuided'){ fireGuided(p); return; }
  fire(p, p.turretAngle);
}
// Laser gun-mode: a hitscan beam tracing the bounce physics up to LASER_RANGE; damages the first enemy.
function fireLaser(p){
  const now=performance.now();
  if(now-(p.lastFire||0) < pCd(p)*LASER_CD_MUL) return;
  p.lastFire=now; p.cloak=0;
  const aim=p.turretAngle, sp=pShell(p);
  let g={x:p.x+Math.cos(aim)*(p.r+10), y:p.y+Math.sin(aim)*(p.r+10), vx:Math.cos(aim)*sp, vy:Math.sin(aim)*sp};
  const pts=[{x:g.x,y:g.y}]; const STEP=1/240; let dist=0, hitEnemy=null;
  while(dist<LASER_RANGE){
    const px=g.x,py=g.y;
    const r=reflectStep(g,0,0,STEP); g.x=r.x;g.y=r.y;g.vx=r.vx;g.vy=r.vy;
    dist+=Math.hypot(g.x-px,g.y-py);
    if(r.hit){ if(r.hitRect&&r.hitRect.crate) damageCrate(r.hitRect); pts.push({x:g.x,y:g.y}); }
    for(const e of enemies){ if(e.spawning) continue; if(Math.hypot(g.x-e.x,g.y-e.y)<e.r+4){ hitEnemy=e; break; } }
    if(hitEnemy) break;
  }
  pts.push({x:g.x,y:g.y});
  beams.push({pts,life:0.12,max:0.12});
  if(hitEnemy) damageTank(hitEnemy,1);
  SFX.laser();
  p.fireSlowUntil=now+cfg.fireSlowMs; if(cfg.shake) shake=Math.min(shake+4,9);
  if(cfg.haptics&&navigator.vibrate) navigator.vibrate(18);
}
// Wire-guided missile: steer toward p's aim while p is aiming; only ONE steered (controlled) missile
// per player at a time — cut the wire (stop aiming) and you can fire another.
function fireGuided(p){
  const now=performance.now();
  if(now-(p.lastFire||0) < pCd(p)*1.4) return;
  if(shells.some(s=>s.owner===p && s.guided && s.controlled)) return;
  p.lastFire=now; p.cloak=0;
  const aim=p.turretAngle, tipX=p.x+Math.cos(aim)*(p.r+10), tipY=p.y+Math.sin(aim)*(p.r+10);
  shells.push({x:tipX,y:tipY,vx:Math.cos(aim)*GUIDED_SPEED,vy:Math.sin(aim)*GUIDED_SPEED,b:0,life:5,arm:0.16,
               team:'player',owner:p,rocket:true,guided:true,controlled:true});
  for(let i=0;i<6;i++){const s2=60+Math.random()*120,a2=aim+(Math.random()-0.5)*0.7;
    particles.push({x:tipX,y:tipY,vx:Math.cos(a2)*s2,vy:Math.sin(a2)*s2,life:0.25,c:'#e8b24a'});}
  SFX.shoot(true);
  p.fireSlowUntil=now+cfg.fireSlowMs; if(cfg.shake) shake=Math.min(shake+4,9);
}
function findConeTarget(sh){
  const heading=Math.atan2(sh.vy,sh.vx); let best=null,bd=1e9;
  for(const e of enemies){ if(e.spawning) continue;
    const a=Math.atan2(e.y-sh.y,e.x-sh.x); const d=((a-heading+Math.PI)%(2*Math.PI))-Math.PI;
    if(Math.abs(d)<=BOUNCE_CONE){ const dist=Math.hypot(e.x-sh.x,e.y-sh.y); if(dist<bd){bd=dist;best=e;} } }
  return best;
}
function addSmoke(x,y){
  smoke.push({ x:x+(Math.random()-0.5)*3, y:y+(Math.random()-0.5)*3,
    vx:(Math.random()-0.5)*14, vy:(Math.random()-0.5)*14, life:0.45, max:0.45,
    r:2.5+Math.random()*1.5 });
}

// ---- enemy AI ----
function scheduleFire(e,now){ e.nextFireAt = now + e.fireGap[0] + Math.random()*(e.fireGap[1]-e.fireGap[0]); }
const FIRE_ALIGN_TOL=0.14;
const SPAWN_FIRE_DELAY=550;
// Predictive fire discipline: march a virtual shell through the bounce physics and refuse a shot that
// would loop back into us or hit an ALLY (another enemy) before reaching the player it's aimed near.
function wouldFriendlyFire(e, aim){
  const speed=e.shellSpeed||cfg.shell;
  const tp=nearestPlayer(e.x,e.y);
  const distToPlayer = tp ? Math.hypot(tp.x-e.x, tp.y-e.y) : 1e9;
  const sim={ x:e.x+Math.cos(aim)*(e.r+10), y:e.y+Math.sin(aim)*(e.r+10),
              vx:Math.cos(aim)*speed, vy:Math.sin(aim)*speed };
  let b=(e.bounce??cfg.bounce), elapsed=0, travel=0;
  const STEP=0.016, HORIZON=1.2;
  while(elapsed<HORIZON){
    const px=sim.x, py=sim.y;
    const r=reflectStep(sim,0,0,STEP); sim.x=r.x; sim.y=r.y; sim.vx=r.vx; sim.vy=r.vy;
    travel+=Math.hypot(sim.x-px, sim.y-py); elapsed+=STEP;
    if(r.hit && --b<0) break;
    if(elapsed>0.16 && Math.hypot(sim.x-e.x, sim.y-e.y)<e.r+6) return true;
    for(const o of enemies){ if(o===e || o.spawning) continue;
      const ax=o.x+(o.vx||0)*elapsed, ay=o.y+(o.vy||0)*elapsed;
      if(Math.hypot(sim.x-ax, sim.y-ay) < o.r+10){
        const allyDist=Math.hypot(o.x-e.x, o.y-e.y);
        if(travel < distToPlayer+40 || allyDist < 140) return true;
      }
    }
  }
  return false;
}
const STUCK_MS=600;

function segBlocked(x0,y0,x1,y1){
  const n=20;
  for(let i=1;i<n;i++){ const t=i/n, x=x0+(x1-x0)*t, y=y0+(y1-y0)*t;
    for(const rects of [blockRects,crates]) for(const o of rects) if(x>o.x&&x<o.x+o.w&&y>o.y&&y<o.y+o.h) return true; }
  return false;
}
function bankSurfaces(){
  const surf=[
    {axis:'x',v:FRAME,    s: 1,lo:FRAME,hi:H-FRAME},
    {axis:'x',v:W-FRAME,  s:-1,lo:FRAME,hi:H-FRAME},
    {axis:'y',v:FRAME,    s: 1,lo:FRAME,hi:W-FRAME},
    {axis:'y',v:H-FRAME,  s:-1,lo:FRAME,hi:W-FRAME},
  ];
  for(const rects of [blockRects,crates]) for(const o of rects){
    surf.push({axis:'x',v:o.x,     s:-1,lo:o.y,hi:o.y+o.h});
    surf.push({axis:'x',v:o.x+o.w, s: 1,lo:o.y,hi:o.y+o.h});
    surf.push({axis:'y',v:o.y,     s:-1,lo:o.x,hi:o.x+o.w});
    surf.push({axis:'y',v:o.y+o.h, s: 1,lo:o.x,hi:o.x+o.w});
  }
  return surf;
}
function bankAim(e,tx,ty){
  for(const {axis,v,s,lo,hi} of bankSurfaces()){
    let bx,by;
    if(axis==='x'){
      if((e.x-v)*s<0) continue;
      const mx=2*v-tx, tt=(v-e.x)/((mx-e.x)||1e-6); if(tt<=0||tt>=1) continue;
      bx=v; by=e.y+(ty-e.y)*tt;
    } else {
      if((e.y-v)*s<0) continue;
      const my=2*v-ty, tt=(v-e.y)/((my-e.y)||1e-6); if(tt<=0||tt>=1) continue;
      by=v; bx=e.x+(tx-e.x)*tt;
    }
    if((axis==='x'?by:bx)<lo || (axis==='x'?by:bx)>hi) continue;
    if(bx<FRAME-1||bx>W-FRAME+1||by<FRAME-1||by>H-FRAME+1) continue;
    if(segBlocked(e.x,e.y,bx,by)||segBlocked(bx,by,tx,ty)) continue;
    return Math.atan2(by-e.y, bx-e.x);
  }
  return null;
}
// chosen aim angle for an enemy against target tgt (a player).
function aimFor(e,tgt){
  if(e.aim==='track') return Math.atan2(tgt.y-e.y, tgt.x-e.x);
  const speed=e.shellSpeed||cfg.shell;
  const lead = e.aim==='cutoff' ? 0.5 : 1;
  let tx=tgt.x,ty=tgt.y;
  for(let k=0;k<2;k++){
    const d=Math.hypot(tx-e.x,ty-e.y), t=d/speed*lead;
    tx=Math.max(FRAME+tgt.r,Math.min(W-FRAME-tgt.r,tgt.x+tgt.vx*t));
    ty=Math.max(FRAME+tgt.r,Math.min(H-FRAME-tgt.r,tgt.y+tgt.vy*t));
  }
  if(e.aim==='cutoff') return Math.atan2(ty-e.y, tx-e.x);
  if(!segBlocked(e.x,e.y,tx,ty)) return Math.atan2(ty-e.y, tx-e.x);
  const bank=bankAim(e,tx,ty);
  return bank!==null ? bank : Math.atan2(ty-e.y, tx-e.x);
}
function driveEnemy(e, now){
  if(e.entering){
    const tgt=nearestPlayer(e.x,e.y) || {x:W/2,y:H/2};
    const dx=tgt.x-e.x, dy=tgt.y-e.y, sp=Math.max(e.speed,70);
    const dir=steerDir(e, Math.atan2(dy,dx));
    e.vx=Math.cos(dir)*sp; e.vy=Math.sin(dir)*sp;
    const md=Math.atan2(e.vy,e.vx); let bd=((md-e.bodyAngle+Math.PI)%(2*Math.PI))-Math.PI; e.bodyAngle+=bd*0.1;
    return;
  }
  const tgt=nearestTarget(e.x,e.y);          // null when every player is cloaked / downed
  const dx=tgt?tgt.x-e.x:0, dy=tgt?tgt.y-e.y:0, dist=Math.hypot(dx,dy)||1;
  // movement
  if(now < (e.immobileUntil||0)){ e.vx=0; e.vy=0; }
  else if(e.speed>0){
    if((e._stuckMs||0) > STUCK_MS && now >= (e.idleUntil||0)){
      e.idleUntil = now + 800 + Math.random()*1000; e.idleHeading = pickClearHeading(e); e._stuckMs=0;
    }
    if(now < (e.idleUntil||0)){
      if(!pathClear(e.x,e.y,e.idleHeading,e.r+34,e.r-2)) e.idleHeading=pickClearHeading(e);
      const sp=e.speed*0.55; e.vx=Math.cos(e.idleHeading)*sp; e.vy=Math.sin(e.idleHeading)*sp;
    } else {
      let dir=null;
      if(tgt){
        if(dist>e.engage+20)      dir=Math.atan2(dy,dx);
        else if(dist<e.engage-20) dir=Math.atan2(-dy,-dx);
      }
      if(dir!==null){ dir=steerDir(e,dir); e.vx=Math.cos(dir)*e.speed; e.vy=Math.sin(dir)*e.speed; }
      else { e.vx*=0.85; e.vy*=0.85; }
    }
    if(Math.abs(e.vx)+Math.abs(e.vy)>1){
      const md=Math.atan2(e.vy,e.vx); let bd=((md-e.bodyAngle+Math.PI)%(2*Math.PI))-Math.PI; e.bodyAngle+=bd*0.1;
    }
  } else { e.vx=0; e.vy=0; }
  // aim + fire
  if(e.aim==='none'){
    if(e.wanderUntil===undefined || now>=e.wanderUntil){
      e.wanderTarget=Math.random()*Math.PI*2;
      e.wanderUntil=now+700+Math.random()*1500;
    }
    let wd=((e.wanderTarget-e.turretAngle+Math.PI)%(2*Math.PI))-Math.PI; e.turretAngle+=wd*0.04;
    if(now>=e.nextFireAt){ if(tgt && !wouldFriendlyFire(e,e.turretAngle)) fire(e, e.turretAngle); scheduleFire(e,now); }
  } else if(tgt){
    const aimAng=aimFor(e,tgt);
    let td=((aimAng-e.turretAngle+Math.PI)%(2*Math.PI))-Math.PI; e.turretAngle+=td*0.07;
    if(now>=e.nextFireAt && Math.abs(td)<FIRE_ALIGN_TOL){
      if(e.fireChance>=1 || Math.random()<e.fireChance){
        if(!wouldFriendlyFire(e,e.turretAngle)) fire(e, e.turretAngle);
      }
      scheduleFire(e,now);
    }
  }
  // mine-layers
  if(e.mines>0 && e.speed>0 && now>=e.nextMineAt){
    let own=0; for(const m of mines) if(m.owner===e && !m.dead) own++;
    if(own<e.mines && (Math.abs(e.vx)+Math.abs(e.vy))>20){ layMine(e); SFX.mineLay(); }
    e.nextMineAt = now + 1400 + Math.random()*2200;
  }
}
function pushOutTerrain(t){
  for(const rects of [blockRects, holeRects, crates]) for(const o of rects){
    const cx=Math.max(o.x,Math.min(t.x,o.x+o.w));
    const cy=Math.max(o.y,Math.min(t.y,o.y+o.h));
    const dx=t.x-cx, dy=t.y-cy, d=Math.hypot(dx,dy);
    if(d<t.r){ const nx=dx/(d||1),ny=dy/(d||1); t.x=cx+nx*t.r; t.y=cy+ny*t.r; }
  }
}
function moveBlockedAt(x,y,pad){
  for(const rects of [blockRects, holeRects, crates]) for(const o of rects)
    if(x>o.x-pad&&x<o.x+o.w+pad&&y>o.y-pad&&y<o.y+o.h+pad) return true;
  return false;
}
function pathClear(x,y,ang,len,pad){
  for(let i=1;i<=4;i++){ const t=i/4; if(moveBlockedAt(x+Math.cos(ang)*len*t, y+Math.sin(ang)*len*t, pad)) return false; }
  return true;
}
function steerDir(e,want){
  const L=e.r+34, pad=e.r-2;
  if(pathClear(e.x,e.y,want,L,pad)) return want;
  const offs=[0.5,-0.5,0.9,-0.9,1.4,-1.4,2.0,-2.0];
  if(e.steerSide<0) for(let i=0;i<offs.length;i++) offs[i]=-offs[i];
  for(const o of offs) if(pathClear(e.x,e.y,want+o,L,pad)){ e.steerSide=o>=0?1:-1; return want+o; }
  return want;
}
function pickClearHeading(e){
  const base=Math.random()*Math.PI*2;
  for(let i=0;i<8;i++){ const a=base+i*(Math.PI/4); if(pathClear(e.x,e.y,a,e.r+40,e.r-2)) return a; }
  return base;
}
// Tanks can't stack: push every overlapping pair (active players + active enemies) apart.
function resolveTankCollisions(){
  const tanks=[];
  for(const p of activePlayers()) tanks.push(p);
  for(const e of enemies) if(!e.spawning) tanks.push(e);
  for(let it=0; it<2; it++){
    for(let i=0;i<tanks.length;i++) for(let j=i+1;j<tanks.length;j++){
      const a=tanks[i], b=tanks[j]; let dx=b.x-a.x, dy=b.y-a.y, d=Math.hypot(dx,dy); const min=a.r+b.r;
      if(d<min){
        if(d<0.001){ dx=Math.random()-0.5; dy=Math.random()-0.5; d=Math.hypot(dx,dy)||1; }
        const push=(min-d)/2, nx=dx/d, ny=dy/d;
        a.x-=nx*push; a.y-=ny*push; b.x+=nx*push; b.y+=ny*push;
      }
    }
  }
  for(const t of tanks){
    if(!(t.team==='player' && playerFlying(t))) pushOutTerrain(t);
    if(t.team!=='player' && t.entering) continue;
    t.x=Math.max(FRAME+t.r,Math.min(W-FRAME-t.r,t.x));
    t.y=Math.max(FRAME+t.r,Math.min(H-FRAME-t.r,t.y));
  }
}
function moveEnemy(e,dt){
  const ox=e.x, oy=e.y;
  e.x+=e.vx*dt; e.y+=e.vy*dt;
  if(e.entering){
    if(e.x>=FRAME && e.x<=W-FRAME && e.y>=FRAME && e.y<=H-FRAME){
      e.entering=false;
      e.nextFireAt=Math.max(e.nextFireAt, performance.now()+SPAWN_FIRE_DELAY);
    }
  } else {
    e.x=Math.max(FRAME+e.r,Math.min(W-FRAME-e.r,e.x));
    e.y=Math.max(FRAME+e.r,Math.min(H-FRAME-e.r,e.y));
  }
  pushOutTerrain(e);
  if(!e.entering){
    const want=Math.hypot(e.vx,e.vy)*dt, got=Math.hypot(e.x-ox, e.y-oy);
    if(want>20*dt && got < want*0.35) e._stuckMs=(e._stuckMs||0)+dt*1000;
    else e._stuckMs=Math.max(0, (e._stuckMs||0)-dt*1500);
  }
}

function trailTank(t,dt){
  const sp=Math.hypot(t.vx,t.vy); if(sp<8) return;
  t._trackAcc=(t._trackAcc||0)+sp*dt;
  if(t._trackAcc>=14){ t._trackAcc=0; tracks.push({x:t.x,y:t.y,a:t.bodyAngle,life:5,max:5}); }
}

// ---- mines ----
function near(a,b,r){ return Math.hypot(a.x-b.x,a.y-b.y)<r; }
function updateMines(dt){
  for(const m of mines){
    if(m.dead) continue;
    if(m.arm>0) m.arm-=dt;
    m.fuse-=dt;
    if(m.fuse<=0){ detonate(m); continue; }
    if(m.arm<=0){
      let tripped=false;
      for(const p of livingPlayers()) if(near(p,m,m.blast*0.6)){ tripped=true; break; }
      if(!tripped) for(const e of enemies){ if(!e.spawning && near(e,m,m.blast*0.6)){ tripped=true; break; } }
      if(tripped){ detonate(m); continue; }
    }
  }
  for(let i=mines.length-1;i>=0;i--) if(mines[i].dead) mines.splice(i,1);
}
function detonate(m){
  if(m.dead) return; m.dead=true;
  SFX.mineBoom(); burst(m.x,m.y,'#e8a23a',22); if(cfg.shake) shake=Math.min(shake+9,13);
  for(const p of livingPlayers()) if(near(p,m,m.blast)) damageTank(p,1);
  for(const e of [...enemies]){ if(!e.spawning && near(e,m,m.blast)) damageTank(e,1); }
  for(const o of mines){ if(!o.dead && near(o,m,m.blast)) detonate(o); }
}

// ---- physics ----
function reflectStep(o,nx,ny,dt){
  let x=o.x,y=o.y,vx=o.vx,vy=o.vy,hit=false,hitRect=null;
  let px=x+vx*dt, py=y+vy*dt;
  if(px<FRAME){px=FRAME;vx=-vx;hit=true;} else if(px>W-FRAME){px=W-FRAME;vx=-vx;hit=true;}
  if(py<FRAME){py=FRAME;vy=-vy;hit=true;} else if(py>H-FRAME){py=H-FRAME;vy=-vy;hit=true;}
  for(const rects of [blockRects, crates]) for(const ob of rects){
    if(px>ob.x&&px<ob.x+ob.w&&py>ob.y&&py<ob.y+ob.h){
      const fromLeft=x<=ob.x, fromRight=x>=ob.x+ob.w;
      const fromTop=y<=ob.y, fromBot=y>=ob.y+ob.h;
      if(fromLeft||fromRight){ vx=-vx; px=fromLeft?ob.x-0.1:ob.x+ob.w+0.1; }
      else if(fromTop||fromBot){ vy=-vy; py=fromTop?ob.y-0.1:ob.y+ob.h+0.1; }
      else { vx=-vx; vy=-vy; }
      hit=true; hitRect=ob;
    }
  }
  return {x:px,y:py,vx,vy,hit,hitRect};
}

// ---- per-player update (movement, aim, fire, deploy) — driven by p.intent ----
function updatePlayer(p, dt, now){
  if(p.down || run.phase==='dead') return;
  const it=p.intent, prevBody=p.bodyAngle;
  const inWarmup = gameMode==='roguelike' && run.phase==='intermission';
  if(inWarmup){ p.vx=0; p.vy=0; }
  else {
    const baseMove=pMove(p);
    const moveSpeed = now<p.fireSlowUntil ? Math.max(20, baseMove-cfg.fireSlow*p.mods.fireSlow) : baseMove;
    const rooted = now < (p.immobileUntil||0);
    const mag = rooted ? 0 : Math.hypot(it.mx,it.my);
    if(mag>0.08){
      const ang=Math.atan2(it.my,it.mx), n=Math.min(1,mag);
      p.vx=Math.cos(ang)*moveSpeed*n; p.vy=Math.sin(ang)*moveSpeed*n;
      let d=((ang-p.bodyAngle+Math.PI)%(2*Math.PI))-Math.PI; p.bodyAngle+=d*cfg.body;
    } else { p.vx*=0.8; p.vy*=0.8; }
    if(rooted){ p.vx=0; p.vy=0; }
    p.x+=p.vx*dt; p.y+=p.vy*dt;
    p.x=Math.max(FRAME+p.r,Math.min(W-FRAME-p.r,p.x));
    p.y=Math.max(FRAME+p.r,Math.min(H-FRAME-p.r,p.y));
    if(!playerFlying(p)) pushOutTerrain(p);
    trailTank(p,dt);
    if(it.firing) tryFire(p);
    for(let i=p.scatterQueue.length-1;i>=0;i--){ if(now>=p.scatterQueue[i].at){ emitShell(p, p.scatterQueue[i].ang); p.scatterQueue.splice(i,1); } }
    if(it.deploy && !p._wasDeploy) deployGadget(p);
    p._wasDeploy=it.deploy;
  }
  // turret aim: while aiming, chase the intent angle; otherwise the gun rides with the hull.
  if(it.aiming){ p.aimTarget=it.aim; }
  else if(p.aimTarget!==undefined){
    const bodyDelta=((p.bodyAngle-prevBody+Math.PI)%(2*Math.PI))-Math.PI; p.aimTarget+=bodyDelta;
  }
  if(p.aimTarget!==undefined){
    const arc = p.class && p.class.turretArc;
    let aim = p.aimTarget;
    if(arc){
      let rel=((aim-p.bodyAngle+Math.PI)%(2*Math.PI))-Math.PI;
      if(Math.abs(rel)>arc){
        const steering = !inWarmup && Math.hypot(it.mx,it.my)>0.08;
        if(!steering){
          p.bodyAngle += Math.sign(rel)*Math.min(Math.abs(rel)-arc, 1.8*dt);
          rel=((aim-p.bodyAngle+Math.PI)%(2*Math.PI))-Math.PI;
        }
        rel=Math.max(-arc,Math.min(arc,rel));
        aim=p.bodyAngle+rel;
      }
    }
    let d=((aim-p.turretAngle+Math.PI)%(2*Math.PI))-Math.PI;
    p.turretAngle+=d*pTurret(p);
  }
}

function update(dt){
  const now=performance.now();
  if(paused) return;
  if(gameMode==='roguelike' && run.phase==='shop') return;
  if(typeof pollLocalInput==='function') pollLocalInput();   // host keyboard/mouse → players[0].intent
  // ---- players ----
  for(const p of players) updatePlayer(p, dt, now);
  // ---- wave intermission (breather + countdown while enemies warp in) ----
  if(gameMode==='roguelike' && run.phase==='intermission'){
    run.timer-=dt*1000;
    if(run.timer<=0){
      run.phase='fighting'; SFX.waveStart();
      for(const e of enemies){
        e.spawning=false;
        const tgt=nearestPlayer(e.x,e.y);
        if(e.aim!=='none' && tgt) e.turretAngle=Math.atan2(tgt.y-e.y, tgt.x-e.x);
        e.nextFireAt=now+SPAWN_FIRE_DELAY+Math.random()*500;
        if(e.invisible){ SFX.electric(); e.cloakStart=now; }
      }
    }
  }
  // ---- enemies ----
  for(const e of enemies){ if(e.spawning) continue; driveEnemy(e, now); moveEnemy(e, dt); trailTank(e,dt); }
  updateVibranium();
  resolveTankCollisions();

  // ---- shells ----
  for(let i=shells.length-1;i>=0;i--){
    const sh=shells[i];
    if(!sh) continue;
    sh.life-=dt; if(sh.life<=0){shells.splice(i,1);continue;}
    sh.arm-=dt;
    // wire-guided steering: steer toward the OWNER's aim while that player is aiming.
    if(sh.guided){
      const o=sh.owner, held = o && o.team==='player' && o.intent && o.intent.aiming && !o.down;
      if(sh.controlled && held){
        const cur=Math.atan2(sh.vy,sh.vx);
        const dRaw=o.turretAngle-cur, d=Math.atan2(Math.sin(dRaw),Math.cos(dRaw));
        const omega=(GUIDED_SPEED/GUIDED_TURNRAD)*dt, turn=Math.max(-omega,Math.min(omega,d));
        const na=cur+turn, spd=Math.hypot(sh.vx,sh.vy);
        sh.vx=Math.cos(na)*spd; sh.vy=Math.sin(na)*spd;
      } else sh.controlled=false;
    }
    const steps=4, sdt=dt/steps; let dead=false;
    const ownerIsPlayer = sh.owner && sh.owner.team==='player';
    for(let k=0;k<steps;k++){
      const r=reflectStep(sh,0,0,sdt); sh.x=r.x;sh.y=r.y;sh.vx=r.vx;sh.vy=r.vy;
      if(r.hit){
        if(r.hitRect && r.hitRect.crate) damageCrate(r.hitRect);
        sh.b--; if(ownerIsPlayer) SFX.ricochet(); if(sh.b<0){dead=true;break;}
        if(sh.bounceRocket && !sh.converted){
          const lock=findConeTarget(sh);
          if(lock){ sh.converted=1; sh.rocket=true; sh.b=0;
            const spd=Math.hypot(sh.vx,sh.vy)*BOUNCE_ROCKET_MUL, a=Math.atan2(lock.y-sh.y,lock.x-sh.x);
            sh.vx=Math.cos(a)*spd; sh.vy=Math.sin(a)*spd; }
        }
      }
      // hit ANY tank — full friendly fire (players included). Owner is immune until the shell arms;
      // flying / i-framed players are passed through (untouchable).
      let victim=null;
      for(const p of activePlayers()){
        if(playerFlying(p) || performance.now()<p.iframes) continue;
        if(sh.owner===p && sh.arm>0) continue;
        if(sh.hitSet && sh.hitSet.has(p)) continue;
        if(Math.hypot(sh.x-p.x,sh.y-p.y)<p.r+4){ victim=p; break; }
      }
      if(!victim){ for(const e of enemies){ if(e.spawning || (sh.owner===e && sh.arm>0) || (sh.hitSet && sh.hitSet.has(e))) continue;
        if(Math.hypot(sh.x-e.x,sh.y-e.y)<e.r+4){ victim=e; break; } } }
      if(victim){
        const act = (victim.armor || victim.tracks) ? resolveHit(victim, sh) : 'damage';
        if(act==='deflect'){
          const nx=sh.x-victim.x, ny=sh.y-victim.y, nl=Math.hypot(nx,ny)||1, ux=nx/nl, uy=ny/nl;
          const dot=sh.vx*ux+sh.vy*uy; sh.vx-=2*dot*ux; sh.vy-=2*dot*uy;
          sh.x=victim.x+ux*(victim.r+6); sh.y=victim.y+uy*(victim.r+6);
          sh.b--; if(ownerIsPlayer) SFX.ricochet();
          victim.plates--;
          burst(sh.x,sh.y,'#cfd3d8',6);
          if(sh.b<0) dead=true;
          break;
        } else if(act==='absorb'){
          if(victim.team==='player'){ victim.immobileUntil = now + HEAVY_STUN_MS;
            if(victim.brokenSides) victim.brokenSides[victim.hitSide]=true; }
          else { victim.trackBroken=true; victim.immobileUntil = Infinity; }
          burst(sh.x,sh.y,victim.color,8); SFX.hit();
          if(cfg.shake) shake=Math.min(shake+3,9);
          dead=true; break;
        }
        damageTank(victim,1);
        if(sh.pierce>0 && victim.team==='enemy'){ sh.pierce--; sh.hitSet.add(victim); }
        else { dead=true; break; }
      }
      // one-way shields: reflect ENEMY shells entering the shield's front; player/turret shells pass
      if(!dead && shields.length && sh.team==='enemy'){
        for(const sd of shields){
          const dx=sh.x-sd.x, dy=sh.y-sd.y;
          if(dx*dx+dy*dy < sd.r*sd.r){
            const movingIn = sh.vx*(-dx)+sh.vy*(-dy) > 0;
            const frontSide = dx*Math.cos(sd.ang)+dy*Math.sin(sd.ang) > 0;
            if(movingIn && frontSide){
              const nl=Math.hypot(dx,dy)||1, ux=dx/nl, uy=dy/nl, dot=sh.vx*ux+sh.vy*uy;
              sh.vx-=2*dot*ux; sh.vy-=2*dot*uy; sh.x=sd.x+ux*(sd.r+3); sh.y=sd.y+uy*(sd.r+3);
              burst(sh.x,sh.y,'#7fdfff',6); SFX.ricochet(); break;
            }
          }
        }
      }
      // deployed turrets are destroyable by any shell that isn't their own
      if(!dead && turrets.length){
        for(const tu of turrets){ if(sh.owner===tu) continue;
          if(Math.hypot(sh.x-tu.x,sh.y-tu.y)<tu.r+4){ tu.hp--; burst(sh.x,sh.y,'#9ab',8); if(ownerIsPlayer) SFX.hit(); dead=true; break; } }
      }
      if(dead)break;
      for(const m of mines){ if(!m.dead && Math.hypot(sh.x-m.x,sh.y-m.y)<10){ detonate(m); dead=true; break; } }
      if(dead)break;
      for(let j=0;j<shells.length;j++){ const o2=shells[j];
        if(o2===sh || o2.life<=0) continue;
        if(Math.hypot(sh.x-o2.x,sh.y-o2.y)<9){ o2.life=-1; burst((sh.x+o2.x)/2,(sh.y+o2.y)/2,'#efe7d2',8); SFX.ricochet(); dead=true; break; } }
      if(dead)break;
    }
    if(dead){ shells.splice(i,1); continue; }
    addSmoke(sh.x,sh.y);
  }
  updateMines(dt);
  updateTurrets(dt,now); updateShields(dt,now); updateSpiderMines(dt,now);
  for(let i=beams.length-1;i>=0;i--){ beams[i].life-=dt; if(beams[i].life<=0) beams.splice(i,1); }
  updatePickups(dt);
  updateSiege(dt, now);
  for(let i=smoke.length-1;i>=0;i--){const s=smoke[i];s.life-=dt;
    if(s.life<=0){smoke.splice(i,1);continue;} s.x+=s.vx*dt;s.y+=s.vy*dt;s.vx*=0.92;s.vy*=0.92;}
  for(let i=tracks.length-1;i>=0;i--){ tracks[i].life-=dt; if(tracks[i].life<=0) tracks.splice(i,1); }
  for(let i=particles.length-1;i>=0;i--){const p=particles[i];p.life-=dt;
    if(p.life<=0){particles.splice(i,1);continue;} p.x+=p.vx*dt;p.y+=p.vy*dt;p.vx*=0.9;p.vy*=0.9;}
  if(shake>0) shake=Math.max(0,shake-dt*30);
}

// ---- combat resolution ----
function burst(x,y,color,n){
  for(let i=0;i<n;i++){const sp=80+Math.random()*200,a=Math.random()*Math.PI*2;
    particles.push({x,y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,life:0.4,c:color});}
}
function resolveHit(victim, sh){
  const a=victim.armor;
  const fa = a ? a.frontArc : ARMOR_SIDE_FRONT, ra = a ? a.rearArc : ARMOR_SIDE_REAR;
  const rel=((Math.atan2(sh.y-victim.y, sh.x-victim.x) - victim.bodyAngle + Math.PI)%(2*Math.PI))-Math.PI;
  const ab=Math.abs(rel);
  if(ab <= fa) return (a && a.deflect && !sh.rocket && victim.plates>0) ? 'deflect' : 'damage';
  if(ab >= Math.PI - ra) return 'damage';
  if(!victim.tracks) return 'damage';
  victim.hitSide = rel>=0 ? 'pos' : 'neg';
  const broken = victim.team==='player' ? !!(victim.brokenSides && victim.brokenSides[victim.hitSide])
                                        : victim.trackBroken;
  return broken ? 'damage' : 'absorb';
}
function damageTank(t, dmg){
  if(t.team==='player'){
    if(gameMode==='roguelike'){
      if(t.down || run.phase==='dead' || run.phase==='shop') return;
      if(playerFlying(t) || performance.now()<t.iframes) return;
      if(t.vibranium && !t.charged){ t.charged=true; burst(t.x,t.y,'#9fd8ff',16); if(cfg.shake) shake=Math.min(shake+5,10); SFX.hit(); return; }
      t.hp-=dmg;
      if(t.hp>0){ burst(t.x,t.y,'#fff',8); if(cfg.shake) shake=Math.min(shake+4,9); SFX.hit(); return; }
      markPlayerDown(t);
    } else {                               // sandbox (single local player)
      if(sbReactHits){
        if(playerFlying(t) || performance.now()<t.iframes) return;
        if(t.vibranium && !t.charged){ t.charged=true; burst(t.x,t.y,'#9fd8ff',16); if(cfg.shake) shake=Math.min(shake+5,10); SFX.hit(); return; }
        burst(t.x,t.y,'#ffffff',18); burst(t.x,t.y,'#e8a23a',12); if(cfg.shake) shake=14; SFX.death();
        const i=players.indexOf(t); resetPlayerToSpawn(t, i<0?0:i, players.length);
      } else {
        burst(t.x,t.y,'#ffffff',12);
        if(cfg.shake) shake=Math.min(shake+8,12);
        if(cfg.haptics&&navigator.vibrate) navigator.vibrate([18,40,18]);
        SFX.hit();
      }
    }
  } else {
    t.hp-=dmg;
    burst(t.x,t.y,t.color,10);
    if(cfg.shake) shake=Math.min(shake+4,9);
    if(t.hp<=0) killEnemy(t); else SFX.hit();
  }
}
// A player went down: they spectate until the wave clears. When EVERYONE is down at once the party
// spends a team life and re-stages the wave (or the run ends).
function markPlayerDown(p){
  if(p.down) return;
  p.down=true; p.vx=0; p.vy=0; p.scatterQueue.length=0;
  burst(p.x,p.y,'#ffffff',20); burst(p.x,p.y,'#e8a23a',20);
  if(cfg.shake) shake=Math.min(shake+10,16);
  if(cfg.haptics&&navigator.vibrate) navigator.vibrate([40,60,120]);
  SFX.death();
  updateHud();
  if(gameMode==='roguelike' && livingPlayers().length===0) loseTeamLife();
}
function loseTeamLife(){
  if(run.phase==='dead') return;
  run.phase='dead';
  run.teamLives=Math.max(0, run.teamLives-1); updateHud();
  if(run.teamLives<=0) setTimeout(showGameOver, 750);
  else                 setTimeout(reviveParty, 900);
}
function killEnemy(e){
  const i=enemies.indexOf(e); if(i<0) return;
  enemies.splice(i,1);
  score++;
  burst(e.x,e.y,e.color,16); SFX.explode();
  if(cfg.shake) shake=Math.min(shake+6,11);
  if(cfg.haptics&&navigator.vibrate) navigator.vibrate([12,28,12]);
  if(gameMode==='roguelike'){ run.kills++;
    if(e.boss){ burst(e.x,e.y,'#e8c84a',26); if(cfg.shake) shake=Math.min(shake+8,13); }
    pickups.push({x:e.x,y:e.y,kind:'scrap',value:e.boss?6:1,life:SCRAP_LIFE,max:SCRAP_LIFE});
    updateHud();
    if(enemies.length===0){
      if(run.siege){ if(run.siege.phase==='assault') capturePoint(); }
      else finishWave();
    }
  }
  else if(gameMode==='sandbox'){ updateHud(); const p=randSpawnPos(); spawnEnemy(e.type,p.x,p.y); }
}

// ---- crates (M3) ----
function damageCrate(c){
  c.hp--;
  burst(c.x+c.w/2, c.y+c.h/2, '#caa46a', 6);
  if(c.hp>0){ SFX.hit(); return; }
  const i=crates.indexOf(c); if(i>=0) crates.splice(i,1);
  burst(c.x+c.w/2, c.y+c.h/2, '#7a5a32', 16); SFX.explode();
  if(cfg.shake) shake=Math.min(shake+3,9);
  maybeDropPickup(c.x+c.w/2, c.y+c.h/2);
}
function maybeDropPickup(x,y){
  if(gameMode!=='roguelike') return;
  const r=Math.random();
  if(r<0.42)      pickups.push({x,y,kind:'heal',   life:11,max:11});
  else if(r<0.62) pickups.push({x,y,kind:'upgrade',life:11,max:11});
}
// A pickup is grabbed by whichever player drives over it first (scrap is a race; heal/upgrade go to
// that player). `pk` is the pickup, `p` the collector.
function applyPickup(pk, p){
  if(pk.kind==='scrap'){ p.scrap+=pk.value; run.waveScrap+=pk.value; burst(pk.x,pk.y,'#caa46a',6); SFX.hit(); updateHud(); return; }
  if(pk.kind==='heal'){ if(p.hp<p.maxHp){ p.hp++; } burst(pk.x,pk.y,'#5fbf6a',14); }
  else { const u=pickUpgrades(1)[0]; if(u) u.apply(p); burst(pk.x,pk.y,'#e8c84a',14); }
  SFX.waveStart(); updateHud();
}
function updatePickups(dt){
  for(let i=pickups.length-1;i>=0;i--){
    const pk=pickups[i]; pk.life-=dt;
    if(pk.life<=0){ pickups.splice(i,1); continue; }
    let grabber=null;
    for(const p of livingPlayers()){ if(Math.hypot(pk.x-p.x,pk.y-p.y)<p.r+11){ grabber=p; break; } }
    if(grabber){ applyPickup(pk, grabber); pickups.splice(i,1); }
  }
}

// ---- siege objective (assault→hold): king-of-the-hill ----
function inHoldZone(t){
  return !!holdRect && t.x>=holdRect.x-6 && t.x<=holdRect.x+holdRect.w+6
                    && t.y>=holdRect.y-6 && t.y<=holdRect.y+holdRect.h+6;
}
function anyPlayerInHold(){ for(const p of livingPlayers()) if(inHoldZone(p)) return true; return false; }
function capturePoint(){
  run.siege.phase='hold';
  run.siege.timer=run.siege.max;
  run.siege.nextSpawn=performance.now()+1200;
  SFX.waveStart();
}
function spawnReinforcement(){
  const roster=waveRoster(run.level);
  const e=spawnEnemy(roster[(Math.random()*roster.length)|0], 0, 0); if(!e) return;
  const p=reinforceSpawn(e.r); e.x=p.x; e.y=p.y; e.entering=true; e.spawning=false;
}
function completeSiege(){
  enemies.length=0; shells.length=0;
  finishWave();
}
// Wave cleared: sweep field scrap into the team haul, hand every player a flat stipend, celebrate.
function finishWave(){
  let got=0;
  for(let i=pickups.length-1;i>=0;i--) if(pickups[i].kind==='scrap'){ got+=pickups[i].value; pickups.splice(i,1); }
  run.waveScrap+=got;
  const share = Math.floor(got/Math.max(1,players.length));
  for(const p of players) p.scrap += STIPEND_PER_WAVE + share;     // flat per-player stipend + an even cut of swept scrap
  run.lastWaveScrap = run.waveScrap;
  if(run.waveScrap>0){ const c=partyCenter(); burst(c.x, c.y-20, '#e8c84a', 18); SFX.waveStart(); }
  updateHud();
  // TODO (B1.10 / B2): a per-player Supply Depot opens here on the wave cadence
  // (run.waveKind==='boss' || run.level%SHOP_EVERY===0). The shop UI is per-player + networked, so it's
  // deferred to the economy/networking pass — for the B1 core loop we roll straight into the next wave.
  nextWave();
}
function updateSiege(dt, now){
  if(!run.siege || run.phase!=='fighting' || run.siege.phase!=='hold') return;
  if(anyPlayerInHold()) run.siege.timer-=dt*1000;        // KotH: clock ticks while ANY player holds the point
  if(run.siege.timer<=0){ completeSiege(); return; }
  const cap=Math.min(3+Math.floor(run.level/2), 6), alive=enemies.length;
  if(now>=run.siege.nextSpawn && alive<cap){ spawnReinforcement(); run.siege.nextSpawn=now+REINFORCE_GAP; }
}
