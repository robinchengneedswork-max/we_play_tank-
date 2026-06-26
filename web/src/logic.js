"use strict";
// logic — firing, enemy AI, shell physics, per-frame world update, combat resolution.

// Player effective stats = cfg baseline × run upgrade mods (mods default to 1/0,
// so with no upgrades the player is exactly cfg — live tuning + sandbox unchanged).
// class layer: moveMul/shellMul scale cfg; bounce/maxShells come from the class
// (falling back to cfg when no class is set, e.g. sandbox). run.mods stack on top.
// Weight tax: each point of net weight (purchases over engine capacity) shaves move speed;
// Engine upgrades raise capacity to cancel it. No weight/engine (e.g. sandbox) → 1.0, unchanged.
function weightMoveMul(){ return 1/(1+0.07*Math.max(0, run.weight-run.engine)); }
function pMove(){   return cfg.move   * (run.class?run.class.moveMul :1) * run.mods.move * weightMoveMul() * (tank.charged?VIBRANIUM_BOOST:1); }
function pTurret(){ return cfg.turret * run.mods.turret; }
function pCd(){     return cfg.cd     * run.mods.cd; }
function pShell(){  return cfg.shell  * (run.class?run.class.shellMul:1) * run.mods.shell; }
function pBounce(){ return (run.class?run.class.bounce   :cfg.bounce)   + run.mods.bounce; }
function pMaxShells(){ return Math.round((run.class?run.class.maxShells:cfg.maxshell) + run.mods.maxShells); }

// ---- arsenal helpers ----
function cellPx(){ return currentMap ? (W-2*FRAME)/currentMap.C : 80; }   // one map cell in px (sizing for ranges/turn radius)
function playerCloaked(){ return tank.cloak>0 && (performance.now()-tank.cloak) < STEALTH_MS; }
function playerFlying(){ return tank.flying>0 && performance.now() < tank.flying; }

// Deploy the equipped gadget. Gated by remaining charges + a per-gadget re-deploy cooldown.
// Aimed gadgets deploy toward the turret; movement ones toward the drive direction.
function deployGadget(){
  const g=run.gadget; if(!g) return;
  const now=performance.now();
  if(run.gadgetCharges<=0 || now<run.gadgetCdUntil) return;
  const mp=activePointer('move'), kb=kbMoveDir();
  const moveDir = kb!=null ? kb : (mp ? stickVec(mp).ang : tank.turretAngle);
  const dir = g.dir==='move' ? moveDir : tank.turretAngle;
  run.gadgetCharges--; run.gadgetCdUntil = now + (g.cd||GADGET_CD);
  switch(g.id){
    case 'sentryTeal':  deploySentry('teal',   dir); break;
    case 'sentryGrey':  deploySentry('grey',   dir); break;
    case 'trophy':      deploySentry('trophy', dir); break;
    case 'shield':      deployShield(dir);            break;
    case 'spiderMines': deploySpiderMines();          break;
    case 'dash':        doDash(dir);                  break;
    case 'jumpJets':    doJumpJets();                 break;
    case 'stealth':     doStealth();                  break;
  }
  SFX.deploy(); updateHud();
}
// --- gadget effects ---
// Sentry turrets: a small player-team auto-gun (teal=rockets / grey=shells) or a trophy point-defense.
// Placed a little ahead of you, clamped inside the arena. Destroyable; expires after TURRET_LIFE.
function deploySentry(kind,dir){
  const x=Math.max(FRAME+12,Math.min(W-FRAME-12, tank.x+Math.cos(dir)*30));
  const y=Math.max(FRAME+12,Math.min(H-FRAME-12, tank.y+Math.sin(dir)*30));
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
// One-way shield: a frontal arc placed ahead of you that reflects ENEMY shells coming into its front,
// but lets your own (player/turret) shells pass straight through. Expires after SHIELD_LIFE.
function deployShield(dir){
  const d=cellPx()*0.7;
  const x=Math.max(FRAME+8,Math.min(W-FRAME-8, tank.x+Math.cos(dir)*d));
  const y=Math.max(FRAME+8,Math.min(H-FRAME-8, tank.y+Math.sin(dir)*d));
  shields.push({x,y,r:SHIELD_R,ang:dir,expire:performance.now()+SHIELD_LIFE});
}
// Spider mines: a small cluster spawned around you that crawls toward the nearest enemy and blows.
function deploySpiderMines(){
  for(let i=0;i<SPIDER_COUNT;i++){ const a=Math.random()*Math.PI*2, d=14+Math.random()*16;
    spiderMines.push({x:tank.x+Math.cos(a)*d, y:tank.y+Math.sin(a)*d, r:5, arm:0.4, dead:false}); }
}
function spiderDetonate(m){
  if(m.dead) return; m.dead=true;
  SFX.mineBoom(); burst(m.x,m.y,'#d8c46a',16); if(cfg.shake) shake=Math.min(shake+6,11);
  const blast=40;
  if(near(tank,m,blast)) damageTank(tank,1);                                  // FF: your own mine can clip you
  for(const e of [...enemies]){ if(!e.spawning && near(e,m,blast)) damageTank(e,1); }
}
// Dash: blink along `dir` up to DASH_DIST, stopping before any wall/hole; brief i-frames.
function doDash(dir){
  const steps=12, sx=tank.x, sy=tank.y; let lx=sx, ly=sy;
  for(let i=1;i<=steps;i++){
    const t=i/steps;
    const cx=Math.max(FRAME+tank.r,Math.min(W-FRAME-tank.r, sx+Math.cos(dir)*DASH_DIST*t));
    const cy=Math.max(FRAME+tank.r,Math.min(H-FRAME-tank.r, sy+Math.sin(dir)*DASH_DIST*t));
    if(moveBlockedAt(cx,cy,tank.r-2)) break;     // don't blink into terrain
    lx=cx; ly=cy;
  }
  for(let i=0;i<10;i++){ const t=i/10; particles.push({x:sx+(lx-sx)*t,y:sy+(ly-sy)*t,vx:0,vy:0,life:0.25,c:'#bfe9ff'}); }
  tank.x=lx; tank.y=ly; pushOutTerrain(tank);
  tank.iframes = performance.now()+DASH_IFRAMES;
  SFX.dash();
}
// Jump jets: airborne for JET_MS — no hits, cross holes & walls (terrain push is gated while flying;
// once you land, the normal pushOutTerrain shoves you onto clear floor = the "slide off").
function doJumpJets(){ tank.flying = performance.now()+JET_MS; SFX.jet(); }
// Stealth: enemies lose your track until you fire or STEALTH_MS elapses (see playerCloaked + enemy gates).
function doStealth(){ tank.cloak = performance.now(); SFX.cloak(); }
// --- gadget/entity per-frame updaters ---
function updateTurrets(dt,now){
  for(let i=turrets.length-1;i>=0;i--){
    const tu=turrets[i]; if(!tu) continue;       // guard against a mid-loop wave-clear wiping the array
    if(now>=tu.expire || tu.hp<=0){ burst(tu.x,tu.y,tu.hp<=0?'#c96':'#9ab',12); if(tu.hp<=0) SFX.explode(); turrets.splice(i,1); continue; }
    if(tu.kind==='trophy'){
      // point-defense: vaporize enemy shells that enter the trophy's radius
      for(let j=shells.length-1;j>=0;j--){ const s=shells[j]; if(!s||s.team!=='enemy') continue;
        if(Math.hypot(s.x-tu.x,s.y-tu.y)<TROPHY_R){ burst(s.x,s.y,'#bfe9ff',6); shells.splice(j,1); SFX.trophy(); } }
      continue;
    }
    // sentry: slew onto the nearest enemy + fire when lined up
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
    const m=spiderMines[i]; if(!m) continue;     // a kill→finishWave→beginWave can wipe the array mid-loop
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
// Vibranium: while charged (after surviving a hit) you ram enemies for heavy contact damage,
// which discharges you. Run before resolveTankCollisions, while overlaps still exist.
function updateVibranium(){
  if(!tank.charged) return;
  for(const e of enemies){ if(e.spawning) continue;
    if(Math.hypot(tank.x-e.x,tank.y-e.y) < tank.r+e.r){
      damageTank(e, VIBRANIUM_DMG); tank.charged=false;
      burst(tank.x,tank.y,'#9fd8ff',18); if(cfg.shake) shake=Math.min(shake+7,12); SFX.explode();
      break;
    }
  }
}

// Raw muzzle: spawn one shell from `t` along `aim` (no cooldown/capacity gate) + a
// muzzle-spark puff. The right-slot gun-mode shapes the player's shell (APDS pierce, bounce-rocket).
const SPREAD_ARC=0.16;   // rad between Scattergun pellets (slight fan; extra lateral margin so the staggered burst never self-cancels)
function emitShell(t, aim){
  const isP=(t===tank);
  const speed  = isP? pShell()  : (t.shellSpeed?? cfg.shell);
  const bounce = isP? pBounce() : (t.bounce    ?? cfg.bounce);
  const tipX=t.x+Math.cos(aim)*(t.r+10), tipY=t.y+Math.sin(aim)*(t.r+10);
  const sh={x:tipX,y:tipY,vx:Math.cos(aim)*speed,vy:Math.sin(aim)*speed,b:bounce,life:3.2,arm:0.16,team:t.team,owner:t,rocket:!!t.rocket};
  if(isP){   // right-slot gun-mode shapes the player's shell
    if(run.gunMode==='apds'){ sh.pierce=APDS_PIERCE; sh.hitSet=new Set(); sh.rocket=true; sh.b=0; }   // sabot: fast, straight, punches through
    else if(run.gunMode==='bounceRocket') sh.bounceRocket=1;                                           // converts to a homing rocket on its first bounce
    else if(run.gunMode==='scatter') sh.capWeight=1/SCATTER_PELLETS;                                   // each pellet is 1/N of a magazine slot
  }
  shells.push(sh);
  for(let i=0;i<6;i++){const sp=60+Math.random()*120,ang=aim+(Math.random()-0.5)*0.7;
    particles.push({x:tipX,y:tipY,vx:Math.cos(ang)*sp,vy:Math.sin(ang)*sp,life:0.25,c:'#e8b24a'});}
}
// Generic fire: any tank shoots along `aim`. Gated by cooldown + own-shell cap, then
// emits the muzzle. Player Scattergun fans extra pellets from the one trigger pull
// (the side pellets bypass the cap — they're part of the same shot). Returns whether it fired.
function fire(t, aim){
  const now=performance.now();
  const isP=(t===tank);
  const cd        = isP? pCd()        : (t.cd        ?? cfg.cd);
  const maxShells = isP? pMaxShells() : (t.maxShells ?? cfg.maxshell);
  if(now-(t.lastFire||0) < cd) return false;
  let own=0; for(const s of shells) if(s.owner===t) own += (s.capWeight ?? 1);   // Scattergun pellets weigh 1/N
  if(own>=maxShells) return false;
  t.lastFire=now;
  if(isP && run.gunMode==='scatter'){
    // Scattergun: fire the pellets as a quick staggered burst (one after another, slightly fanned) so
    // consecutive pellets stay >9px apart and never trip shell-vs-shell cancellation. First fires now;
    // the rest are queued and emitted by update() (which won't run during the warp-in countdown).
    for(let i=0;i<SCATTER_PELLETS;i++){
      const ang = aim + (i-(SCATTER_PELLETS-1)/2)*SPREAD_ARC;
      if(i===0) emitShell(t, ang);
      else scatterQueue.push({ at: now + i*SCATTER_GAP, ang });
    }
  } else emitShell(t, aim);
  SFX.shoot(isP);
  if(t.team==='player'){
    tank.fireSlowUntil = now + cfg.fireSlowMs;   // firing brakes movement briefly
    if(cfg.shake) shake=Math.min(shake+5,9);
    if(cfg.haptics&&navigator.vibrate) navigator.vibrate(18);
  }
  return true;
}
function tryFire(){
  if(gameMode==='roguelike' && run.phase==='intermission') return;   // can't fire before the wave goes live
  tank.cloak=0;                                   // firing breaks stealth, whatever the gun mode
  if(run.gunMode==='laser'){ fireLaser(); return; }
  if(run.gunMode==='wireGuided'){ fireGuided(); return; }
  fire(tank, tank.turretAngle);
}

// Laser gun-mode: a hitscan beam from the turret, tracing the real bounce physics up to LASER_RANGE
// total path (unlimited bounces within range). Damages the FIRST enemy along the path. Longer cd.
function fireLaser(){
  const now=performance.now();
  if(now-(tank.lastFire||0) < pCd()*LASER_CD_MUL) return;
  tank.lastFire=now; tank.cloak=0;                       // firing breaks stealth
  const aim=tank.turretAngle, sp=pShell();
  let g={x:tank.x+Math.cos(aim)*(tank.r+10), y:tank.y+Math.sin(aim)*(tank.r+10), vx:Math.cos(aim)*sp, vy:Math.sin(aim)*sp};
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
  tank.fireSlowUntil=now+cfg.fireSlowMs; if(cfg.shake) shake=Math.min(shake+4,9);
  if(cfg.haptics&&navigator.vibrate) navigator.vibrate(18);
}

// Wire-guided missile gun-mode: steer the missile toward the current aim while the player holds the
// aim input (≈2-cell turn radius); release ("cut the wire") → it flies straight. Dies on a wall.
// Only ONE wire can be live at a time — once you cut it you can fire another (cooldown permitting),
// so several uncontrolled missiles can be in the air at once.
function fireGuided(){
  const now=performance.now();
  if(now-(tank.lastFire||0) < pCd()*1.4) return;
  if(shells.some(s=>s.owner===tank && s.guided && s.controlled)) return;   // only one STEERED missile at a time — cut a wire (release aim) to fire another
  tank.lastFire=now; tank.cloak=0;
  const aim=tank.turretAngle, tipX=tank.x+Math.cos(aim)*(tank.r+10), tipY=tank.y+Math.sin(aim)*(tank.r+10);
  shells.push({x:tipX,y:tipY,vx:Math.cos(aim)*GUIDED_SPEED,vy:Math.sin(aim)*GUIDED_SPEED,b:0,life:5,arm:0.16,
               team:'player',owner:tank,rocket:true,guided:true,controlled:true});
  for(let i=0;i<6;i++){const s2=60+Math.random()*120,a2=aim+(Math.random()-0.5)*0.7;
    particles.push({x:tipX,y:tipY,vx:Math.cos(a2)*s2,vy:Math.sin(a2)*s2,life:0.25,c:'#e8b24a'});}
  SFX.shoot(true);
  tank.fireSlowUntil=now+cfg.fireSlowMs; if(cfg.shake) shake=Math.min(shake+4,9);
}

// Closest enemy within BOUNCE_CONE of a shell's heading (bounce-rocket lock-on).
function findConeTarget(sh){
  const heading=Math.atan2(sh.vy,sh.vx); let best=null,bd=1e9;
  for(const e of enemies){ if(e.spawning) continue;
    const a=Math.atan2(e.y-sh.y,e.x-sh.x); const d=((a-heading+Math.PI)%(2*Math.PI))-Math.PI;
    if(Math.abs(d)<=BOUNCE_CONE){ const dist=Math.hypot(e.x-sh.x,e.y-sh.y); if(dist<bd){bd=dist;best=e;} } }
  return best;
}

// soft puff dropped behind a moving shell (velocity-feel trail)
function addSmoke(x,y){
  smoke.push({ x:x+(Math.random()-0.5)*3, y:y+(Math.random()-0.5)*3,
    vx:(Math.random()-0.5)*14, vy:(Math.random()-0.5)*14, life:0.45, max:0.45,
    r:2.5+Math.random()*1.5 });
}

// ---- enemy AI ----
function scheduleFire(e,now){ e.nextFireAt = now + e.fireGap[0] + Math.random()*(e.fireGap[1]-e.fireGap[0]); }
const FIRE_ALIGN_TOL=0.14;   // rad (~8°): an aiming tank won't fire until its turret is actually on target
const SPAWN_FIRE_DELAY=550;  // ms after a wave goes live before anyone may fire (turrets settle onto target first)
// Predictive fire discipline: march a virtual shell along `aim` through the REAL
// bounce physics (reflectStep) and refuse the shot if it would hit a teammate or
// loop back into us. Two things the old straight-line check missed: shells bounce
// (an ally/self can be hit after a wall), and the firer is only immune until the
// shell arms — so a shot fired next to a wall comes straight back and suicides.
//
// We deliberately KEEP the "bait enemies into each other" flavor: allies standing
// FARTHER than the player (i.e. behind them along the shot) are fair game — the
// player can still juke a shot meant for them into a tank behind. Only allies in
// front of the player (blocking the lane) and self-returns are spared.
function wouldFriendlyFire(e, aim){
  const speed=e.shellSpeed||cfg.shell;
  const distToPlayer=Math.hypot(tank.x-e.x, tank.y-e.y);
  const sim={ x:e.x+Math.cos(aim)*(e.r+10), y:e.y+Math.sin(aim)*(e.r+10),
              vx:Math.cos(aim)*speed, vy:Math.sin(aim)*speed };
  let b=(e.bounce??cfg.bounce), elapsed=0, travel=0;
  const STEP=0.016, HORIZON=1.2;                       // ~1.2s of near-term flight
  while(elapsed<HORIZON){
    const px=sim.x, py=sim.y;
    const r=reflectStep(sim,0,0,STEP); sim.x=r.x; sim.y=r.y; sim.vx=r.vx; sim.vy=r.vy;
    travel+=Math.hypot(sim.x-px, sim.y-py); elapsed+=STEP;
    if(r.hit && --b<0) break;                           // ran out of bounces
    // never volunteer a shot that loops back through yourself (only once it's armed)
    if(elapsed>0.16 && Math.hypot(sim.x-e.x, sim.y-e.y)<e.r+6) return true;
    // check each ally at the spot it'll occupy WHEN THE SHELL ARRIVES (lead it by its
    // current velocity) — the old static snapshot let fast rushers spray squadmates that
    // were a frame from crossing the lane. Margin widened slightly for the same reason.
    for(const o of enemies){ if(o===e || o.spawning) continue;
      const ax=o.x+(o.vx||0)*elapsed, ay=o.y+(o.vy||0)*elapsed;
      if(Math.hypot(sim.x-ax, sim.y-ay) < o.r+10){
        // normally an ally BEHIND the player is fair bait (juke a shot into them), but in
        // a tight swirl "behind" flips every frame — so don't bait when the ally is close.
        const allyDist=Math.hypot(o.x-e.x, o.y-e.y);
        if(travel < distToPlayer+40 || allyDist < 140) return true;
      }
    }
  }
  return false;
}
const STUCK_MS=600;   // ms a tank can be wall/corner-jammed before it switches to idle wander
let wasDeploy=false;  // deploy-input edge state (rising edge fires the gadget once)

// is the straight segment a→b crossed by an obstacle? (sampled — cheap & good enough)
function segBlocked(x0,y0,x1,y1){
  const n=20;
  for(let i=1;i<n;i++){ const t=i/n, x=x0+(x1-x0)*t, y=y0+(y1-y0)*t;
    for(const rects of [blockRects,crates]) for(const o of rects) if(x>o.x&&x<o.x+o.w&&y>o.y&&y<o.y+o.h) return true; }
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
  for(const rects of [blockRects,crates]) for(const o of rects){   // blocks + (alive) crates are bank surfaces
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
  if(playerCloaked()) return e.turretAngle;     // stealth: enemies can't track you → turret holds
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
  if(e.entering){
    // siege: roll straight in toward the player until inside the arena, no shooting yet.
    // Force a minimum entry speed so even stationary types still drive in (then stop).
    const dx=tank.x-e.x, dy=tank.y-e.y, d=Math.hypot(dx,dy)||1, sp=Math.max(e.speed,70);
    const dir=steerDir(e, Math.atan2(dy,dx));
    e.vx=Math.cos(dir)*sp; e.vy=Math.sin(dir)*sp;
    const md=Math.atan2(e.vy,e.vx); let bd=((md-e.bodyAngle+Math.PI)%(2*Math.PI))-Math.PI; e.bodyAngle+=bd*0.1;
    return;
  }
  const dx=tank.x-e.x, dy=tank.y-e.y, dist=Math.hypot(dx,dy)||1;
  // movement: hold a band around `engage`, steering around cover to reach it
  if(now < (e.immobileUntil||0)){ e.vx=0; e.vy=0; }   // track-broken: dead in the water, but turret still hunts
  else if(e.speed>0){
    // cut off behind a wall / boxed in a corner → amble a clear heading instead of
    // grinding into cover and stacking with the rest. Turret keeps hunting (see below),
    // so a wandering tank is still a threat the moment it gets a sightline.
    if((e._stuckMs||0) > STUCK_MS && now >= (e.idleUntil||0)){
      e.idleUntil = now + 800 + Math.random()*1000; e.idleHeading = pickClearHeading(e); e._stuckMs=0;
    }
    if(now < (e.idleUntil||0)){
      if(!pathClear(e.x,e.y,e.idleHeading,e.r+34,e.r-2)) e.idleHeading=pickClearHeading(e);
      const sp=e.speed*0.55; e.vx=Math.cos(e.idleHeading)*sp; e.vy=Math.sin(e.idleHeading)*sp;
    } else {
      let dir=null;
      if(!playerCloaked()){                                // stealth: enemies lose your position → coast
        if(dist>e.engage+20)      dir=Math.atan2(dy,dx);     // approach
        else if(dist<e.engage-20) dir=Math.atan2(-dy,-dx);   // back off
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
    // brown: lazy — turret drifts toward a wandering heading, fires loosely along it
    if(e.wanderUntil===undefined || now>=e.wanderUntil){
      e.wanderTarget=Math.random()*Math.PI*2;
      e.wanderUntil=now+700+Math.random()*1500;
    }
    let wd=((e.wanderTarget-e.turretAngle+Math.PI)%(2*Math.PI))-Math.PI; e.turretAngle+=wd*0.04;
    if(now>=e.nextFireAt){ if(!playerCloaked() && !wouldFriendlyFire(e,e.turretAngle)) fire(e, e.turretAngle); scheduleFire(e,now); }
  } else {
    const aimAng=aimFor(e);
    let td=((aimAng-e.turretAngle+Math.PI)%(2*Math.PI))-Math.PI; e.turretAngle+=td*0.07;
    // Fire only when due AND the turret has actually swung onto the target — never loose
    // a shot mid-slew (the cause of fresh-spawn tanks firing in whatever random direction
    // they happened to point). If due but still slewing, HOLD (don't reschedule) so the
    // shot goes off the instant we line up.
    if(now>=e.nextFireAt && Math.abs(td)<FIRE_ALIGN_TOL){
      // OG-style sparse firing: less-lethal types (fireChance<1) coin-flip each ready shot;
      // a declined beat still costs a full fireGap, so effective interval ≈ fireGap/fireChance.
      if(e.fireChance>=1 || Math.random()<e.fireChance){
        if(!playerCloaked() && !wouldFriendlyFire(e,e.turretAngle)) fire(e, e.turretAngle);
      }
      scheduleFire(e,now);
    }
  }
  // mine-layers drop mines on a timer while on the move (up to their `mines` cap)
  if(e.mines>0 && e.speed>0 && now>=e.nextMineAt){
    let own=0; for(const m of mines) if(m.owner===e && !m.dead) own++;
    if(own<e.mines && (Math.abs(e.vx)+Math.abs(e.vy))>20){ layMine(e); SFX.mineLay(); }
    e.nextMineAt = now + 1400 + Math.random()*2200;
  }
}
// Push a circular tank out of any rect it overlaps. Blocks, holes AND crates all
// stop movement (you can't drive into a pit or a box). Shells + LOS deliberately
// do NOT use this — holes are see/fire-through; crates are handled separately.
function pushOutTerrain(t){
  for(const rects of [blockRects, holeRects, crates]) for(const o of rects){
    const cx=Math.max(o.x,Math.min(t.x,o.x+o.w));
    const cy=Math.max(o.y,Math.min(t.y,o.y+o.h));
    const dx=t.x-cx, dy=t.y-cy, d=Math.hypot(dx,dy);
    if(d<t.r){ const nx=dx/(d||1),ny=dy/(d||1); t.x=cx+nx*t.r; t.y=cy+ny*t.r; }
  }
}
// ---- enemy steering (M3): cheap whisker avoidance so tanks slip around cover
// instead of wedging (they have no real pathfinding). ----
function moveBlockedAt(x,y,pad){
  for(const rects of [blockRects, holeRects, crates]) for(const o of rects)
    if(x>o.x-pad&&x<o.x+o.w+pad&&y>o.y-pad&&y<o.y+o.h+pad) return true;
  return false;
}
function pathClear(x,y,ang,len,pad){
  for(let i=1;i<=4;i++){ const t=i/4; if(moveBlockedAt(x+Math.cos(ang)*len*t, y+Math.sin(ang)*len*t, pad)) return false; }
  return true;
}
// Return a heading near `want` whose short look-ahead is clear; prefers the last
// side it dodged to (less jitter). Falls back to `want` if fully boxed in.
function steerDir(e,want){
  const L=e.r+34, pad=e.r-2;
  if(pathClear(e.x,e.y,want,L,pad)) return want;
  const offs=[0.5,-0.5,0.9,-0.9,1.4,-1.4,2.0,-2.0];
  if(e.steerSide<0) for(let i=0;i<offs.length;i++) offs[i]=-offs[i];
  for(const o of offs) if(pathClear(e.x,e.y,want+o,L,pad)){ e.steerSide=o>=0?1:-1; return want+o; }
  return want;
}
// Pick a heading whose short look-ahead is clear, for idle/unstuck wandering. Sampled
// from a RANDOM base around the circle so a clump of cut-off tanks scatters different
// ways instead of all shoving the same corner. Falls back to the base if fully boxed in.
function pickClearHeading(e){
  const base=Math.random()*Math.PI*2;
  for(let i=0;i<8;i++){ const a=base+i*(Math.PI/4); if(pathClear(e.x,e.y,a,e.r+40,e.r-2)) return a; }
  return base;
}
// Tanks can't stack: push every overlapping pair (player + active enemies) apart.
// Run after movement; a couple of passes settles clusters. Then re-resolve terrain.
function resolveTankCollisions(){
  const tanks=[];
  if(!(gameMode==='roguelike' && run.phase==='dead')) tanks.push(tank);
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
  for(const t of tanks){                       // keep everyone out of terrain + frame after shoving
    if(!(t===tank && playerFlying())) pushOutTerrain(t);   // the airborne player passes over terrain
    if(t!==tank && t.entering) continue;        // entering reinforcements aren't frame-clamped yet
    t.x=Math.max(FRAME+t.r,Math.min(W-FRAME-t.r,t.x));
    t.y=Math.max(FRAME+t.r,Math.min(H-FRAME-t.r,t.y));
  }
}
function moveEnemy(e,dt){
  const ox=e.x, oy=e.y;
  e.x+=e.vx*dt; e.y+=e.vy*dt;
  if(e.entering){
    // siege: no frame clamp until the tank's center crosses into the arena, then clamp normally
    if(e.x>=FRAME && e.x<=W-FRAME && e.y>=FRAME && e.y<=H-FRAME){
      e.entering=false;
      e.nextFireAt=Math.max(e.nextFireAt, performance.now()+SPAWN_FIRE_DELAY);  // settle before firing on arrival
    }
  } else {
    e.x=Math.max(FRAME+e.r,Math.min(W-FRAME-e.r,e.x));
    e.y=Math.max(FRAME+e.r,Math.min(H-FRAME-e.r,e.y));
  }
  pushOutTerrain(e);
  // stuck detection: wanted to move but the frame/terrain ate most of it. Accrues while
  // jammed, bleeds off faster when moving freely; driveEnemy reads _stuckMs to flip a
  // cut-off tank into idle wander. Skipped while entering (those drive in from off-screen).
  if(!e.entering){
    const want=Math.hypot(e.vx,e.vy)*dt, got=Math.hypot(e.x-ox, e.y-oy);
    if(want>20*dt && got < want*0.35) e._stuckMs=(e._stuckMs||0)+dt*1000;
    else e._stuckMs=Math.max(0, (e._stuckMs||0)-dt*1500);
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
  // step a moving point, reflecting off frame + blocks + crates.
  // returns {x,y,vx,vy,hit,hitRect} — hitRect lets the shell loop damage a crate
  // (the aim preview reuses this and just ignores hitRect, so no side effects here).
  let x=o.x,y=o.y,vx=o.vx,vy=o.vy,hit=false,hitRect=null;
  let px=x+vx*dt, py=y+vy*dt;
  if(px<FRAME){px=FRAME;vx=-vx;hit=true;} else if(px>W-FRAME){px=W-FRAME;vx=-vx;hit=true;}
  if(py<FRAME){py=FRAME;vy=-vy;hit=true;} else if(py>H-FRAME){py=H-FRAME;vy=-vy;hit=true;}
  for(const rects of [blockRects, crates]) for(const ob of rects){
    if(px>ob.x&&px<ob.x+ob.w&&py>ob.y&&py<ob.y+ob.h){
      // resolve on the axis we entered from
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

function update(dt){
  const now=performance.now();
  if(paused) return;                                            // sandbox upgrade overlay
  if(gameMode==='roguelike' && run.phase==='shop') return;      // paused while shopping the depot
  const playerDead = gameMode==='roguelike' && run.phase==='dead';
  // ---- player movement (skipped once dead — the wreck just sits while it explodes) ----
  if(!playerDead){
    const prevBody=tank.bodyAngle;               // to carry the turret along with hull rotation (below)
    // frozen during the warp-in countdown — the player can't move before the wave goes live
    const inWarmup = gameMode==='roguelike' && run.phase==='intermission';
    if(inWarmup){
      tank.vx=0; tank.vy=0;
    } else {
      // recoil brake: speed drops for a moment after firing
      const baseMove = pMove();
      const moveSpeed = now<tank.fireSlowUntil ? Math.max(20, baseMove-cfg.fireSlow*run.mods.fireSlow) : baseMove;
      const rooted = now < (tank.immobileUntil||0);  // Heavy track blown: no drive/turn until it repairs
      const mp = rooted ? null : activePointer('move');
      const kbDir = rooted ? null : kbMoveDir();   // desktop: WASD/arrows drive at full speed
      if(kbDir!==null){
        tank.vx=Math.cos(kbDir)*moveSpeed; tank.vy=Math.sin(kbDir)*moveSpeed;
        let d=((kbDir-tank.bodyAngle+Math.PI)%(2*Math.PI))-Math.PI; tank.bodyAngle+=d*cfg.body;
      } else if(mp){ const s=stickVec(mp); const n=s.mag/cfg.rad;
        tank.vx=Math.cos(s.ang)*moveSpeed*n; tank.vy=Math.sin(s.ang)*moveSpeed*n;
        const target=s.ang; let d=((target-tank.bodyAngle+Math.PI)%(2*Math.PI))-Math.PI;
        tank.bodyAngle+=d*cfg.body;
      } else { tank.vx*=0.8; tank.vy*=0.8; }
      if(rooted){ tank.vx=0; tank.vy=0; }          // track blown: hard stop, no coasting
      tank.x+=tank.vx*dt; tank.y+=tank.vy*dt;
      // tank vs frame
      tank.x=Math.max(FRAME+tank.r,Math.min(W-FRAME-tank.r,tank.x));
      tank.y=Math.max(FRAME+tank.r,Math.min(H-FRAME-tank.r,tank.y));
      // tank vs terrain (blocks + holes both block movement) — skipped while jump-jets fly you over
      if(!playerFlying()) pushOutTerrain(tank);
      trailTank(tank,dt);
      // auto-fire: hold the aim stick past the ring to keep firing on cooldown
      if(cfg.autofire){ const ap=activePointer('aim'); if(ap && stickVec(ap).raw>cfg.rad) tryFire(); }
      if(fireHeld()) tryFire();    // desktop: hold mouse / space to fire (cooldown-gated)
      // emit any due Scattergun pellets (staggered burst — see fire())
      for(let i=scatterQueue.length-1;i>=0;i--){ if(now>=scatterQueue[i].at){ emitShell(tank, scatterQueue[i].ang); scatterQueue.splice(i,1); } }
      const dHeld=deployHeld();    // gadget deploy — edge-triggered so a held input fires once
      if(dHeld && !wasDeploy) deployGadget();
      wasDeploy=dHeld;
    }
    // desktop: turret tracks the mouse cursor (recomputed each frame so it stays
    // locked while the tank drives, not just when the mouse moves).
    if(mouseAim && !activePointer('aim')) tank.aimTarget=Math.atan2(mouseY-tank.y, mouseX-tank.x);
    // no active aim input → keep the gun fixed RELATIVE to the hull, so it rides
    // along as you steer instead of holding a fixed compass heading. (Mouse aim is
    // absolute and latches `mouseAim`, so this only affects twin-stick / keyboard.)
    const aimingNow = !!activePointer('aim') || mouseAim;
    if(!aimingNow && tank.aimTarget!==undefined){
      const bodyDelta=((tank.bodyAngle-prevBody+Math.PI)%(2*Math.PI))-Math.PI;
      tank.aimTarget+=bodyDelta;
    }
    // turret aim — Tank Destroyer's gun is limited to a frontal arc; when you aim
    // past it, the hull swings to follow (unless you're actively driving).
    if(tank.aimTarget!==undefined){
      const arc = run.class && run.class.turretArc;
      let aim = tank.aimTarget;
      if(arc){
        let rel=((aim-tank.bodyAngle+Math.PI)%(2*Math.PI))-Math.PI;
        if(Math.abs(rel)>arc){
          const steering = !inWarmup && (!!activePointer('move') || kbMoveDir()!==null);
          if(!steering){                                  // swing the hull toward the target
            tank.bodyAngle += Math.sign(rel)*Math.min(Math.abs(rel)-arc, 1.8*dt);
            rel=((aim-tank.bodyAngle+Math.PI)%(2*Math.PI))-Math.PI;
          }
          rel=Math.max(-arc,Math.min(arc,rel));           // clamp the gun to the arc
          aim=tank.bodyAngle+rel;
        }
      }
      let d=((aim-tank.turretAngle+Math.PI)%(2*Math.PI))-Math.PI;
      tank.turretAngle+=d*pTurret();
    }
  }
  // ---- wave intermission (breather + countdown while enemies warp in) ----
  if(gameMode==='roguelike' && run.phase==='intermission'){
    run.timer-=dt*1000;
    if(run.timer<=0){
      run.phase='fighting'; SFX.waveStart();
      // Wave goes live: don't let anyone fire on frame 1 from their RANDOM spawn angle.
      // Point aiming turrets at the player to start, and stagger first shots behind a
      // settle delay so the turrets line up first (no opening random volley / self-fire).
      for(const e of enemies){
        e.spawning=false;
        if(e.aim!=='none') e.turretAngle=Math.atan2(tank.y-e.y, tank.x-e.x);
        e.nextFireAt=now+SPAWN_FIRE_DELAY+Math.random()*500;
        if(e.invisible){ SFX.electric(); e.cloakStart=now; }   // White cloaks on round start
      }
    }
  }
  // ---- enemies (inert while warping in) ----
  for(const e of enemies){ if(e.spawning) continue; driveEnemy(e, now); moveEnemy(e, dt); trailTank(e,dt); }
  updateVibranium();          // charged ram damage (before collisions push tanks apart)
  resolveTankCollisions();    // no stacking — push overlapping tanks apart

  // ---- shells ----
  for(let i=shells.length-1;i>=0;i--){
    const sh=shells[i];
    if(!sh) continue;        // a kill mid-loop (killEnemy→finishWave→beginWave) can wipe shells[]; skip the holes
    sh.life-=dt; if(sh.life<=0){shells.splice(i,1);continue;}
    sh.arm-=dt;                                   // firer is immune only until the shell arms (no muzzle suicide)
    // wire-guided steering: while controlled + the player holds aim, curve toward the current aim
    // at a capped turn rate (≈2-cell radius); release → fly straight from here on.
    if(sh.guided){
      const held = !!activePointer('aim') || (mouseAim&&mouseDown) || keys.has('Space');
      if(sh.controlled && held){
        const cur=Math.atan2(sh.vy,sh.vx);
        // shortest signed turn toward the aim. atan2(sin,cos) normalizes to [-π,π] for ANY
        // input — the old ((d+π)%2π)-π biased one way when d<-π (JS % is negative for negatives),
        // which spun the missile the wrong way ("always turns left").
        const dRaw=tank.turretAngle-cur, d=Math.atan2(Math.sin(dRaw),Math.cos(dRaw));
        const omega=(GUIDED_SPEED/GUIDED_TURNRAD)*dt, turn=Math.max(-omega,Math.min(omega,d));
        const na=cur+turn, spd=Math.hypot(sh.vx,sh.vy);
        sh.vx=Math.cos(na)*spd; sh.vy=Math.sin(na)*spd;
      } else sh.controlled=false;
    }
    const steps=4, sdt=dt/steps; let dead=false;
    for(let k=0;k<steps;k++){
      const r=reflectStep(sh,0,0,sdt); sh.x=r.x;sh.y=r.y;sh.vx=r.vx;sh.vy=r.vy;
      if(r.hit){
        if(r.hitRect && r.hitRect.crate) damageCrate(r.hitRect);
        sh.b--; if(sh.owner===tank) SFX.ricochet(); if(sh.b<0){dead=true;break;}
        // bounce-propelled rocket: on a surviving bounce, lock the closest enemy in a 45° cone of
        // the new heading → become a faster, non-bouncing homing rocket aimed straight at it.
        if(sh.bounceRocket && !sh.converted){
          const lock=findConeTarget(sh);
          if(lock){ sh.converted=1; sh.rocket=true; sh.b=0;
            const spd=Math.hypot(sh.vx,sh.vy)*BOUNCE_ROCKET_MUL, a=Math.atan2(lock.y-sh.y,lock.x-sh.x);
            sh.vx=Math.cos(a)*spd; sh.vy=Math.sin(a)*spd; }
        }
      }
      // hit ANY tank — full friendly fire, no teams (bait enemies into each other / your own ricochet)
      let victim=null;
      if((sh.owner!==tank || sh.arm<=0) && Math.hypot(sh.x-tank.x,sh.y-tank.y)<tank.r+4) victim=tank;
      if(!victim){ for(const e of enemies){ if(e.spawning || (sh.owner===e && sh.arm>0) || (sh.hitSet && sh.hitSet.has(e))) continue;
        if(Math.hypot(sh.x-e.x,sh.y-e.y)<e.r+4){ victim=e; break; } } }
      if(victim){
        const act = (victim.armor || victim.tracks) ? resolveHit(victim, sh) : 'damage';   // glacis and/or breakable tracks read the struck face
        if(act==='deflect'){
          // bounce the shell off the glacis plate (reflect about the hull normal, like a wall)
          const nx=sh.x-victim.x, ny=sh.y-victim.y, nl=Math.hypot(nx,ny)||1, ux=nx/nl, uy=ny/nl;
          const dot=sh.vx*ux+sh.vy*uy; sh.vx-=2*dot*ux; sh.vy-=2*dot*uy;
          sh.x=victim.x+ux*(victim.r+6); sh.y=victim.y+uy*(victim.r+6);   // nudge clear so it doesn't re-hit
          sh.b--; if(sh.owner===tank) SFX.ricochet();
          victim.plates--;                            // spent a front plate (front goes soft at 0)
          burst(sh.x,sh.y,'#cfd3d8',6);
          if(sh.b<0) dead=true;                       // spent its bounces → fizzle; else it flies on (maybe back at you)
          break;
        } else if(act==='absorb'){
          // track hit absorbed (no hp): player heavy is rooted for HEAVY_STUN_MS AND that
          // side is detracked for the rest of the life (now soft there); enemy heavy breaks
          // globally + immobile permanently.
          if(victim.team==='player'){ victim.immobileUntil = now + HEAVY_STUN_MS;
            if(victim.brokenSides) victim.brokenSides[victim.hitSide]=true; }
          else { victim.trackBroken=true; victim.immobileUntil = Infinity; }
          burst(sh.x,sh.y,victim.color,8); SFX.hit();
          if(cfg.shake) shake=Math.min(shake+3,9);
          dead=true; break;                                          // shell consumed, no hp loss
        }
        damageTank(victim,1);
        // Piercing Rounds: the shell punches on through enemy tanks (logging each so it
        // can't re-hit the same one), spending one pierce per body. Otherwise it dies here.
        if(sh.pierce>0 && victim!==tank){ sh.pierce--; sh.hitSet.add(victim); }
        else { dead=true; break; }
      }
      // one-way shields: reflect ENEMY shells entering the shield's front; player/turret shells pass
      if(!dead && shields.length && sh.team==='enemy'){
        for(const sd of shields){
          const dx=sh.x-sd.x, dy=sh.y-sd.y;
          if(dx*dx+dy*dy < sd.r*sd.r){
            const movingIn = sh.vx*(-dx)+sh.vy*(-dy) > 0;                         // heading into the shield
            const frontSide = dx*Math.cos(sd.ang)+dy*Math.sin(sd.ang) > 0;         // on the facing side
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
          if(Math.hypot(sh.x-tu.x,sh.y-tu.y)<tu.r+4){ tu.hp--; burst(sh.x,sh.y,'#9ab',8); if(sh.owner===tank) SFX.hit(); dead=true; break; } }
      }
      if(dead)break;
      // any shell detonates a mine it touches
      for(const m of mines){ if(!m.dead && Math.hypot(sh.x-m.x,sh.y-m.y)<10){ detonate(m); dead=true; break; } }
      if(dead)break;
      // shell-vs-shell: two shells that meet cancel each other out
      for(let j=0;j<shells.length;j++){ const o2=shells[j];
        if(o2===sh || o2.life<=0) continue;
        if(Math.hypot(sh.x-o2.x,sh.y-o2.y)<9){ o2.life=-1; burst((sh.x+o2.x)/2,(sh.y+o2.y)/2,'#efe7d2',8); SFX.ricochet(); dead=true; break; } }
      if(dead)break;
    }
    if(dead){ shells.splice(i,1); continue; }
    addSmoke(sh.x,sh.y);   // trail behind surviving shells
  }
  // mines
  updateMines(dt);
  // player deployables (sentries / trophy / shields / spider mines) + transient laser beams
  updateTurrets(dt,now); updateShields(dt,now); updateSpiderMines(dt,now);
  for(let i=beams.length-1;i>=0;i--){ beams[i].life-=dt; if(beams[i].life<=0) beams.splice(i,1); }
  // crate pickups (heal / upgrade) — float on the floor until grabbed or they fade
  updatePickups(dt);
  // siege objective: capture → hold the point while reinforcements pour in
  updateSiege(dt, now);
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
// Directional armor (heavy): which face did `sh` strike, and what happens?
// Returns 'deflect' (front bounces a non-rocket back), 'absorb' (track break — no hp,
// immobilize), or 'damage'. Unarmored tanks (incl. the player) always take 'damage'.
function resolveHit(victim, sh){
  const a=victim.armor;                                        // front glacis (left-slot item; may be null)
  const fa = a ? a.frontArc : ARMOR_SIDE_FRONT, ra = a ? a.rearArc : ARMOR_SIDE_REAR;
  const rel=((Math.atan2(sh.y-victim.y, sh.x-victim.x) - victim.bodyAngle + Math.PI)%(2*Math.PI))-Math.PI;  // signed
  const ab=Math.abs(rel);
  if(ab <= fa) return (a && a.deflect && !sh.rocket && victim.plates>0) ? 'deflect' : 'damage';   // glacis turns a normal shell while plates last; rockets punch through
  if(ab >= Math.PI - ra) return 'damage';                      // rear is always soft
  if(!victim.tracks) return 'damage';                          // no breakable-tracks characteristic → side just damages
  // side hit. Player tracks break PER-SIDE (each side stays vulnerable once detracked);
  // the enemy heavy uses a single global break. `hitSide` is read by the absorb branch.
  victim.hitSide = rel>=0 ? 'pos' : 'neg';
  const broken = victim.team==='player' ? !!(victim.brokenSides && victim.brokenSides[victim.hitSide])
                                        : victim.trackBroken;
  return broken ? 'damage' : 'absorb';                         // already-detracked side → soft; else absorb the hit
}
function damageTank(t, dmg){
  if(t.team==='player'){
    if(gameMode==='roguelike'){
      if(run.phase==='dead' || run.phase==='shop') return;      // already gone / wave already won (shopping)
      if(playerFlying() || performance.now()<tank.iframes) return;   // jump-jets airborne / dash i-frames: untouchable
      if(run.vibranium && !tank.charged){                       // Vibranium: survive the hit, charge up (now vulnerable until you ram)
        tank.charged=true; burst(t.x,t.y,'#9fd8ff',16); if(cfg.shake) shake=Math.min(shake+5,10); SFX.hit(); return;
      }
      onPlayerDeath();                     // any hit is lethal → lose a life, retry the wave
    } else {                               // sandbox
      if(sbReactHits){                     // test mode: react like a run (vibranium charge / lethal → respawn)
        if(playerFlying() || performance.now()<tank.iframes) return;
        if(run.vibranium && !tank.charged){ tank.charged=true; burst(t.x,t.y,'#9fd8ff',16); if(cfg.shake) shake=Math.min(shake+5,10); SFX.hit(); return; }
        burst(t.x,t.y,'#ffffff',18); burst(t.x,t.y,'#e8a23a',12); if(cfg.shake) shake=14; SFX.death();
        resetPlayerToSpawn();              // "death" in sandbox = just respawn in place, no run to lose
      } else {                             // default: immortal (feedback only)
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
function killEnemy(e){
  const i=enemies.indexOf(e); if(i<0) return;
  enemies.splice(i,1);
  score++;
  burst(e.x,e.y,e.color,16); SFX.explode();
  if(cfg.shake) shake=Math.min(shake+6,11);
  if(cfg.haptics&&navigator.vibrate) navigator.vibrate([12,28,12]);
  if(gameMode==='roguelike'){ run.kills++;
    if(e.boss){ burst(e.x,e.y,'#e8c84a',26); if(cfg.shake) shake=Math.min(shake+8,13); }
    pickups.push({x:e.x,y:e.y,kind:'scrap',value:e.boss?6:1,life:SCRAP_LIFE,max:SCRAP_LIFE});  // boss drops a fat scrap pile
    updateHud();
    if(enemies.length===0){
      if(run.siege){ if(run.siege.phase==='assault') capturePoint(); }   // fortress cleared → start the hold
      else finishWave();                                                 // warp: clear-all → maybe-upgrade
    }
  }
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

// ---- crates (M3): a shell hit chips a crate; when it breaks it clears + may drop a pickup ----
function damageCrate(c){
  c.hp--;
  burst(c.x+c.w/2, c.y+c.h/2, '#caa46a', 6);
  if(c.hp>0){ SFX.hit(); return; }
  const i=crates.indexOf(c); if(i>=0) crates.splice(i,1);   // broken → floor (LOS/bounce/movement clear next frame)
  burst(c.x+c.w/2, c.y+c.h/2, '#7a5a32', 16); SFX.explode();
  if(cfg.shake) shake=Math.min(shake+3,9);
  maybeDropPickup(c.x+c.w/2, c.y+c.h/2);
}
// Roguelike only: a broken crate may drop a heal (+1 life) or a free upgrade.
function maybeDropPickup(x,y){
  if(gameMode!=='roguelike') return;
  const r=Math.random();
  if(r<0.42)      pickups.push({x,y,kind:'heal',   life:11,max:11});
  else if(r<0.62) pickups.push({x,y,kind:'upgrade',life:11,max:11});
}
function applyPickup(p){
  if(p.kind==='scrap'){ run.scrap+=p.value; run.waveScrap+=p.value; burst(p.x,p.y,'#caa46a',6); SFX.hit(); updateHud(); return; }
  if(p.kind==='heal'){ if(run.hp<run.maxHp){ run.hp++; tank.hp=run.hp; } burst(p.x,p.y,'#5fbf6a',14); }
  else { const u=pickUpgrades(1)[0]; if(u) u.apply(); burst(p.x,p.y,'#e8c84a',14); }
  SFX.waveStart(); updateHud();
}
function updatePickups(dt){
  for(let i=pickups.length-1;i>=0;i--){
    const p=pickups[i]; p.life-=dt;
    if(p.life<=0){ pickups.splice(i,1); continue; }
    if(Math.hypot(p.x-tank.x,p.y-tank.y)<tank.r+11){ applyPickup(p); pickups.splice(i,1); }
  }
}

// ---- siege objective (assault→hold): king-of-the-hill defence of the fortress ----
function inHoldZone(t){
  return !!holdRect && t.x>=holdRect.x-6 && t.x<=holdRect.x+holdRect.w+6
                    && t.y>=holdRect.y-6 && t.y<=holdRect.y+holdRect.h+6;
}
function capturePoint(){           // garrison cleared → you've taken the point; start the hold
  run.siege.phase='hold';
  run.siege.timer=run.siege.max;
  run.siege.nextSpawn=performance.now()+1200;
  SFX.waveStart();
}
function spawnReinforcement(){     // one fresh attacker, driving in from an authored edge
  const roster=waveRoster(run.level);
  const e=spawnEnemy(roster[(Math.random()*roster.length)|0], 0, 0); if(!e) return;
  const p=reinforceSpawn(e.r); e.x=p.x; e.y=p.y; e.entering=true; e.spawning=false;
}
function completeSiege(){          // held long enough → attackers break off; collect, then maybe upgrade
  enemies.length=0; shells.length=0;
  finishWave();
}
// Wave cleared: auto-sweep any scrap still on the field (a beaten level never
// wastes it), then only open the upgrade pick if you can afford it; else roll on.
function finishWave(){
  let got=0;
  for(let i=pickups.length-1;i>=0;i--) if(pickups[i].kind==='scrap'){ run.scrap+=pickups[i].value; run.waveScrap+=pickups[i].value; got+=pickups[i].value; pickups.splice(i,1); }
  if(got>0){ SFX.hit(); updateHud(); }
  // Wave-clear celebration: stash this wave's total haul + a gold pop at the player; the figure
  // is surfaced in the intermission banner (warp) and the depot header (shop waves).
  run.lastWaveScrap = run.waveScrap;
  if(run.waveScrap>0){ burst(tank.x, tank.y-tank.r, '#e8c84a', 18); SFX.waveStart(); }
  // Scrap banks; a depot opens every few waves (and after every boss) to spend it. Else fight on.
  if(run.waveKind==='boss' || run.level%SHOP_EVERY===0) openShop();
  else nextWave();
}
function updateSiege(dt, now){
  if(!run.siege || run.phase!=='fighting' || run.siege.phase!=='hold') return;
  if(inHoldZone(tank)) run.siege.timer-=dt*1000;        // KotH: clock only ticks while you hold the point
  if(run.siege.timer<=0){ completeSiege(); return; }
  const cap=Math.min(3+Math.floor(run.level/2), 6), alive=enemies.length;
  if(now>=run.siege.nextSpawn && alive<cap){ spawnReinforcement(); run.siege.nextSpawn=now+REINFORCE_GAP; }
}
