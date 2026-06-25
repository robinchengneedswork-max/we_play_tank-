"use strict";
// state — world data + layout/spawn setup. No rendering, no input.

const tank={x:0,y:0,r:17,bodyAngle:0,turretAngle:-Math.PI/2,vx:0,vy:0,
            team:'player',hp:3,maxHp:3,lastFire:0,fireSlowUntil:0,
            armor:null,trackBroken:false,immobileUntil:0,plates:0,
            brokenSides:{pos:false,neg:false}};   // Heavy class: directional armor, front plates, timed root, per-side detrack
let blockRects=[];       // solid obstacle rects (pixel space); baked from the map by projectMap()
let holeRects=[];        // pits (+ water, tagged): block movement, but shells fly over + LOS clear (M1)
let crates=[];           // destructible cover {x,y,w,h,hp,max,crate} — bounce+block until broken (M3)
let pickups=[];          // crate drops {x,y,kind,life,max}: 'heal' / 'upgrade' (M3)
let holdRect=null;       // siege hold zone (pixel rect) — the fortress to capture + defend (siege rework)
let enemies=[];          // typed enemy tanks (see data/types.js)
let shells=[];           // {x,y,vx,vy,b,life,team,owner}
let particles=[];        // sparks (muzzle / hit / death bursts)
let smoke=[];            // shell smoke trails (drawn behind shells)
let mines=[];            // {x,y,team,owner,arm,fuse,blast,dead}
let tracks=[];           // tread marks {x,y,a,life,max} — fade out; cleared between levels
let score=0;
let shake=0;

// Roguelike run state. `mods` are the player's run upgrades, layered over cfg
// as multipliers/adders (so cfg stays the live-tunable baseline; sandbox = baseline).
const run={ level:1, kills:0, hp:3, maxHp:3, phase:'fighting', timer:0, mods:freshMods(), siege:null, scrap:0, upgradesTaken:0, class:null, maxPlates:0 };
function freshMods(){ return {move:1, turret:1, cd:1, shell:1, maxShells:0, bounce:0, fireSlow:1}; }
function resetRun(){
  run.level=1; run.kills=0; run.maxHp=3; run.hp=run.maxHp;
  run.phase='fighting'; run.timer=0; run.mods=freshMods(); run.siege=null;
  run.scrap=0; run.upgradesTaken=0; run.maxPlates=0;
  // run.class is set by startMode after resetRun (sandbox leaves it null = cfg baseline)
}
const INTERMISSION_MS=2600;   // breather + countdown before a wave goes live
// Siege rework: assault→hold objective. `run.siege` = {phase:'assault'|'hold', timer, max, nextSpawn}.
const HOLD_MS=22000;          // king-of-the-hill hold duration (ticks only while you're in the zone)
const REINFORCE_GAP=2600;     // ms between reinforcement spawns during the hold
// Scrap economy: kills drop scrap (collect by driving over it); upgrades cost scrap
// and the price climbs per purchase, so upgrades are earned, not every-wave.
const SCRAP_LIFE=18;          // seconds a scrap drop lingers before fading
const UPGRADE_BASE=3, UPGRADE_STEP=2;
function upgradeCost(){ return UPGRADE_BASE + run.upgradesTaken*UPGRADE_STEP; }

// Upgrade pool offered between waves. apply() mutates run.mods (or HP).
const UPGRADES=[
  {name:'Treads',      desc:'+20% move speed',    apply(){ run.mods.move*=1.2; }},
  {name:'Gyro',        desc:'+25% turret turn',   apply(){ run.mods.turret*=1.25; }},
  {name:'Autoloader',  desc:'-18% fire cooldown', apply(){ run.mods.cd*=0.82; }},
  {name:'Hi-Velocity', desc:'+20% shell speed',   apply(){ run.mods.shell*=1.2; }},
  {name:'Magazine',    desc:'+1 shell on screen', apply(){ run.mods.maxShells+=1; }},
  {name:'Ricochet',    desc:'+1 ricochet',        apply(){ run.mods.bounce+=1; }},
  {name:'Plating',     desc:'+1 max HP & heal',   apply(){ run.maxHp+=1; run.hp=run.maxHp; tank.maxHp=run.maxHp; tank.hp=run.maxHp; }},
  {name:'Recoil damp', desc:'-50% fire slow',     apply(){ run.mods.fireSlow*=0.5; }},
  {name:'Armor Plating', desc:'Front deflects shots · +2 plates', rulebreaker:true,
    apply(){ if(!tank.armor) tank.armor=FRONT_ARMOR; run.maxPlates+=HEAVY_PLATES; tank.plates=run.maxPlates; }},
];
function pickUpgrades(n){
  const pool=[...UPGRADES], out=[];
  for(let i=0;i<n && pool.length;i++) out.push(pool.splice(Math.floor(Math.random()*pool.length),1)[0]);
  return out;
}

// ---- enemy spawning ----
function spawnEnemy(typeName, x, y){
  const t=TYPES[typeName];
  if(!t){ console.warn('unknown enemy type:', typeName); return null; }
  const now=performance.now();
  const e={
    type:typeName, team:'enemy', color:t.color,
    x, y, r:t.r, vx:0, vy:0,
    bodyAngle:Math.random()*Math.PI*2, turretAngle:Math.random()*Math.PI*2, aimTarget:0,
    hp:t.hp, maxHp:t.hp,
    armor:t.armor||null, trackBroken:false, immobileUntil:0, plates:t.armor?HEAVY_PLATES:0,   // heavy: directional armor + front plates + track break
    // per-tank combat stats (fire() reads these; players have none → cfg fallback)
    speed:t.speed, shellSpeed:t.shellSpeed, bounce:t.bounce, cd:t.cd, maxShells:t.maxShells,
    rocket:t.rocket, aim:t.aim, engage:t.engage, mines:t.mines, invisible:t.invisible,
    fireGap:t.fireGap, fireChance:t.fireChance ?? 1, lastFire:0,
    nextFireAt: now + t.fireGap[0] + Math.random()*(t.fireGap[1]-t.fireGap[0]),
    nextMineAt: now + 900 + Math.random()*1600,
    _stuckMs:0, idleUntil:0, idleHeading:0,   // idle-wander when cut off (logic.js)
  };
  enemies.push(e);
  return e;
}

// Drop a mine under a tank (owner-tagged, team-tagged).
function layMine(t){
  mines.push({x:t.x,y:t.y,team:t.team,owner:t,arm:1.0,fuse:6.0,blast:46,dead:false});
}

// A spawn point clear of the player and obstacles.
function randSpawnPos(){
  for(let tries=0;tries<60;tries++){
    const x=FRAME+30+Math.random()*(W-2*FRAME-60);
    const y=FRAME+30+Math.random()*(H-2*FRAME-60);
    if(Math.hypot(x-tank.x,y-tank.y)<200) continue;
    const onTerrain=o=>x>o.x-24&&x<o.x+o.w+24&&y>o.y-24&&y<o.y+o.h+24;
    if(blockRects.some(onTerrain) || holeRects.some(onTerrain) || crates.some(onTerrain)) continue;
    return {x,y};
  }
  return {x:W/2,y:H/2};
}

// Warp-style enemy spawn: a clear floor point, biased toward the map's 'e' hint
// cells when it has them, falling back to anywhere valid (never on block/hole/player).
function enemySpawnPos(){
  const hints=(currentMap&&currentMap.enemyCells)||[];
  for(let t=0;t<46;t++){
    let x,y;
    if(hints.length && t<20){ const p=cellToPx(hints[(Math.random()*hints.length)|0]);
      x=p.x+(Math.random()-0.5)*120; y=p.y+(Math.random()-0.5)*120; }   // wide jitter spreads hint clusters
    else { x=FRAME+30+Math.random()*(W-2*FRAME-60); y=FRAME+30+Math.random()*(H-2*FRAME-60); }
    if(Math.hypot(x-tank.x,y-tank.y)<170) continue;
    const onTerrain=o=>x>o.x-22&&x<o.x+o.w+22&&y>o.y-22&&y<o.y+o.h+22;
    if(blockRects.some(onTerrain)||holeRects.some(onTerrain)||crates.some(onTerrain)) continue;
    const space = t<34 ? 100 : 45;     // keep tanks well apart; relax late so we always find a spot
    if(enemies.some(o=>(o.x||o.y)&&Math.hypot(x-o.x,y-o.y)<space)) continue;
    return {x,y};
  }
  return randSpawnPos();
}
// Siege-style spawn: just outside a random edge, aligned along it; the tank then
// drives inward (the frame-clamp is skipped while `entering` — see moveEnemy).
function siegeEntryPos(r){
  const m=r+16, ry=()=>FRAME+r+Math.random()*(H-2*FRAME-2*r), rx=()=>FRAME+r+Math.random()*(W-2*FRAME-2*r);
  switch(Math.floor(Math.random()*4)){
    case 0: return {x:FRAME-m,        y:ry()};   // left
    case 1: return {x:W-FRAME+m,      y:ry()};   // right
    case 2: return {x:rx(),           y:FRAME-m};// top
    default:return {x:rx(),           y:H-FRAME+m};// bottom
  }
}
// Position an enemy for the start of a wave per the current map's spawn style.
function placeForWave(e){
  if(currentMap && currentMap.def.spawn==='siege'){ const p=siegeEntryPos(e.r); e.x=p.x; e.y=p.y; e.entering=true; }
  else { const p=enemySpawnPos(); e.x=p.x; e.y=p.y; e.entering=false; }
}

// Siege garrison: spawn inside the hold zone (the fortress defenders you assault).
function garrisonSpawnPos(){
  if(!holdRect) return enemySpawnPos();
  for(let t=0;t<30;t++){
    const x=holdRect.x+Math.random()*holdRect.w, y=holdRect.y+Math.random()*holdRect.h;
    const onT=o=>x>o.x-8&&x<o.x+o.w+8&&y>o.y-8&&y<o.y+o.h+8;
    if(blockRects.some(onT)||holeRects.some(onT)||crates.some(onT)) continue;
    return {x,y};
  }
  return {x:holdRect.x+holdRect.w/2, y:holdRect.y+holdRect.h/2};
}
// Siege reinforcements: enter off-screen from the edge nearest an 'e' hint (so
// maps stay directional/linear); fall back to a random edge if a map has none.
function reinforceSpawn(r){
  const hints=(currentMap&&currentMap.enemyCells)||[];
  if(!hints.length) return siegeEntryPos(r);
  const p=cellToPx(hints[(Math.random()*hints.length)|0]), m=r+16;
  const dL=p.x-FRAME, dR=(W-FRAME)-p.x, dT=p.y-FRAME, dB=(H-FRAME)-p.y;
  const mn=Math.min(dL,dR,dT,dB);
  if(mn===dL) return {x:FRAME-m,   y:p.y};
  if(mn===dR) return {x:W-FRAME+m, y:p.y};
  if(mn===dT) return {x:p.x, y:FRAME-m};
  return            {x:p.x, y:H-FRAME+m};
}

// Sandbox: a respawning range of M1 types to test weapons/feel against.
function spawnSandboxSet(){
  ['brown','grey','teal','red'].forEach(tp=>{ const e=spawnEnemy(tp,0,0); if(e){ const p=enemySpawnPos(); e.x=p.x; e.y=p.y; } });
}

// Roguelike wave composition (T7). Hand-authored opener; procedural escalation at 8+.
const WAVES=[
  null,                                               // [0] unused (waves are 1-indexed)
  ['brown','brown','brown'],
  ['brown','brown','grey','grey'],
  ['grey','grey','grey','teal'],
  ['grey','grey','red','teal'],
  ['red','red','green','teal','teal'],
  ['yellow','yellow','red','red','green'],            // wave 6: mines arrive
  ['purple','red','red','green','green','teal'],
  ['heavy','grey','grey','red','green'],              // wave 8: the heavy arrives
];
function waveRoster(level){
  if(level<WAVES.length) return WAVES[level].slice();
  // 9+: procedural escalation; introduce White, Black, then Heavy, cap ~12
  const pool=['grey','teal','red','green','purple','yellow','white','black','heavy'];
  const n=Math.min(6+(level-7),12);
  const out=[]; for(let i=0;i<n;i++) out.push(pool[Math.floor(Math.random()*pool.length)]);
  if(level>=9 && !out.includes('white')) out[0]='white';
  if(level>=10 && !out.includes('black')) out[1]='black';
  if(level>=11 && !out.includes('heavy')) out[2]='heavy';
  return out;
}
// Load a fresh map, spawn the level's wave (warp-in or off-screen siege per the
// map), and start the countdown. Cleanup: wipe leftovers so nothing from the
// cleared wave (esp. in-flight shells) carries into the frozen warp-in.
function beginWave(){
  loadNextMap();                 // rotate to a new arena each wave (rebuilds crates at full hp)
  mines.length=0; tracks.length=0; shells.length=0; smoke.length=0; particles.length=0; pickups.length=0;
  resetPlayerToSpawn();          // player to the new map's 'S'
  if(currentMap.def.spawn==='siege' && holdRect){
    // SIEGE: garrison warps into the fortress; you assault, then hold (see updateSiege).
    run.siege={ phase:'assault', timer:HOLD_MS, max:HOLD_MS, nextSpawn:0 };
    const roster=waveRoster(run.level), gn=Math.min(roster.length, 3+Math.floor(run.level/2));
    for(let i=0;i<gn;i++){ const e=spawnEnemy(roster[i],0,0); if(e){ const p=garrisonSpawnPos(); e.x=p.x; e.y=p.y; e.entering=false; e.spawning=true; } }
  } else {
    run.siege=null;
    waveRoster(run.level).forEach(tp=>{ const e=spawnEnemy(tp,0,0); if(e){ placeForWave(e); e.spawning=true; } });
  }
  run.phase='intermission'; run.timer=INTERMISSION_MS;
  updateHud();
}
function nextWave(){ run.level++; beginWave(); }

// Put the player tank back at the current map's spawn, stationary and re-aimed up.
function resetPlayerToSpawn(){
  const p=mapPlayerSpawn();
  tank.x=p.x; tank.y=p.y; tank.vx=0; tank.vy=0;
  tank.bodyAngle=0; tank.turretAngle=-Math.PI/2; tank.aimTarget=tank.turretAngle;
  tank.lastFire=0; tank.fireSlowUntil=0;
  tank.trackBroken=false; tank.immobileUntil=0;    // tracks repaired on (re)spawn
  tank.brokenSides={pos:false,neg:false};
  tank.plates=run.maxPlates||0;                    // front plates refill each life
}

// Reset the arena for a fresh start of either mode.
function resetArena(){
  shells.length=0; particles.length=0; smoke.length=0; mines.length=0; tracks.length=0; enemies.length=0; pickups.length=0;
  tank.team='player'; tank.maxHp=run.maxHp; tank.hp=run.maxHp;
  score=0;
  if(gameMode==='sandbox'){ loadNextMap(); resetPlayerToSpawn(); spawnSandboxSet(); }
  else if(gameMode==='roguelike') beginWave();   // beginWave loads the map + places the player
}

// Sandbox: cycle to the next map (clears the range + respawns it on the new arena).
function sandboxNextMap(){
  loadNextMap();
  shells.length=0; smoke.length=0; mines.length=0; tracks.length=0; particles.length=0; enemies.length=0; pickups.length=0;
  resetPlayerToSpawn();
  spawnSandboxSet();
}

// Death with lives left: respawn the player and clear projectiles, but keep the
// SURVIVING enemies (the tanks you already killed stay dead). Re-warps the
// survivors at fresh spots and re-enters the intermission breather (frozen start).
function restartLevel(){
  if(!(gameMode==='roguelike' && run.phase==='dead')) return;   // guard the delayed call
  shells.length=0; mines.length=0; smoke.length=0; particles.length=0; tracks.length=0; pickups.length=0;
  projectMap();                  // same map, but rebuild crates to full hp for the retry
  resetPlayerToSpawn();          // same map (retry), so spawn is unchanged
  const now=performance.now();
  if(run.siege){ run.siege.timer=run.siege.max; run.siege.nextSpawn=0; }   // reset the hold clock on retry
  for(const e of enemies){
    if(run.siege){                              // siege: garrison back in the fortress / reinforcements back to the edges
      const p = run.siege.phase==='assault' ? garrisonSpawnPos() : reinforceSpawn(e.r);
      e.x=p.x; e.y=p.y; e.entering = run.siege.phase!=='assault';
    } else { placeForWave(e); }                 // warp: re-warp / re-enter per the map's style
    e.vx=0; e.vy=0; e.spawning=true; e.cloakStart=0; e.lastFire=0;
    e.nextFireAt = now + e.fireGap[0] + Math.random()*(e.fireGap[1]-e.fireGap[0]);
    e.nextMineAt = now + 900 + Math.random()*1600;
  }
  run.phase='intermission'; run.timer=INTERMISSION_MS;
  updateHud();
}
