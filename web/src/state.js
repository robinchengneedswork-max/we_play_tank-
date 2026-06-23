"use strict";
// state — world data + layout/spawn setup. No rendering, no input.

const tank={x:0,y:0,r:17,bodyAngle:0,turretAngle:-Math.PI/2,vx:0,vy:0,
            team:'player',hp:3,maxHp:3,lastFire:0,fireSlowUntil:0};
let obstacles=[];
let enemies=[];          // typed enemy tanks (see data/types.js)
let shells=[];           // {x,y,vx,vy,b,life,team,owner}
let particles=[];        // sparks (muzzle / hit / death bursts)
let smoke=[];            // shell smoke trails (drawn behind shells)
let score=0;
let shake=0;

// Roguelike run state (scaffold — grows with the run system: upgrades, biomes, etc.)
const run={ level:1, kills:0, hp:3, maxHp:3 };
function resetRun(){ run.level=1; run.kills=0; run.maxHp=3; run.hp=run.maxHp; }

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
    // per-tank combat stats (fire() reads these; players have none → cfg fallback)
    speed:t.speed, shellSpeed:t.shellSpeed, bounce:t.bounce, cd:t.cd, maxShells:t.maxShells,
    rocket:t.rocket, aim:t.aim, engage:t.engage, mines:t.mines, invisible:t.invisible,
    fireGap:t.fireGap, lastFire:0,
    nextFireAt: now + t.fireGap[0] + Math.random()*(t.fireGap[1]-t.fireGap[0]),
  };
  enemies.push(e);
  return e;
}

// A spawn point clear of the player and obstacles.
function randSpawnPos(){
  for(let tries=0;tries<60;tries++){
    const x=FRAME+30+Math.random()*(W-2*FRAME-60);
    const y=FRAME+30+Math.random()*(H-2*FRAME-60);
    if(Math.hypot(x-tank.x,y-tank.y)<200) continue;
    if(obstacles.some(o=>x>o.x-24&&x<o.x+o.w+24&&y>o.y-24&&y<o.y+o.h+24)) continue;
    return {x,y};
  }
  return {x:W/2,y:H/2};
}

// Sandbox: a respawning range of M1 types to test weapons/feel against.
function spawnSandboxSet(){
  ['brown','grey','teal','red'].forEach(tp=>{ const p=randSpawnPos(); spawnEnemy(tp,p.x,p.y); });
}

// Roguelike waves. Minimal ramp for now — full composition table is sprint T7.
function waveRoster(level){
  const out=[]; const n=Math.min(2+Math.ceil(level*1.2),10);
  for(let i=0;i<n;i++){
    const r=Math.random(); let tp;
    if(level<=1)      tp = r<0.6 ?'brown':'grey';
    else if(level<=3) tp = r<0.4 ?'grey' : r<0.7?'brown':'teal';
    else if(level<=5) tp = r<0.35?'grey' : r<0.6?'red'  : r<0.8?'teal':'yellow';
    else              tp = r<0.25?'red'  : r<0.45?'teal': r<0.6?'green': r<0.78?'purple': r<0.9?'yellow':'grey';
    out.push(tp);
  }
  return out;
}
function spawnWave(){ waveRoster(run.level).forEach(tp=>{ const p=randSpawnPos(); spawnEnemy(tp,p.x,p.y); }); }
function nextWave(){ run.level++; updateHud(); spawnWave(); }

// Reset the arena for a fresh start of either mode.
function resetArena(){
  shells.length=0; particles.length=0; smoke.length=0; enemies.length=0;
  tank.x=W*0.16; tank.y=H*0.6; tank.vx=0; tank.vy=0;
  tank.bodyAngle=0; tank.turretAngle=-Math.PI/2; tank.aimTarget=tank.turretAngle;
  tank.team='player'; tank.lastFire=0; tank.fireSlowUntil=0; tank.maxHp=run.maxHp; tank.hp=run.maxHp;
  score=0;
  if(gameMode==='sandbox')        spawnSandboxSet();
  else if(gameMode==='roguelike') spawnWave();
}

function layoutObstacles(){
  // proportional blocks for bank-shot practice
  obstacles=[
    {x:W*0.30,y:H*0.28,w:W*0.10,h:H*0.20},
    {x:W*0.60,y:H*0.52,w:W*0.12,h:H*0.18},
    {x:W*0.46,y:H*0.12,w:W*0.08,h:H*0.14},
  ];
  if(!tank.x){ tank.x=W*0.16; tank.y=H*0.6; }
}
