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
const run={ level:1, kills:0, hp:3, maxHp:3, phase:'fighting', timer:0 };
function resetRun(){ run.level=1; run.kills=0; run.maxHp=3; run.hp=run.maxHp; run.phase='fighting'; run.timer=0; }
const INTERMISSION_MS=2600;   // breather + countdown before a wave goes live

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

// Roguelike wave composition (T7). Hand-authored opener; procedural escalation at 8+.
// Yellow/White are held back to M3 (their mine/invisibility signatures aren't built yet).
const WAVES=[
  null,                                               // [0] unused (waves are 1-indexed)
  ['brown','brown','brown'],
  ['brown','brown','grey','grey'],
  ['grey','grey','grey','teal'],
  ['grey','grey','red','teal'],
  ['red','red','green','teal','teal'],
  ['red','red','green','purple','teal'],
  ['purple','red','red','green','green','teal'],
];
function waveRoster(level){
  if(level<WAVES.length) return WAVES[level].slice();
  // 8+: procedural escalation from the working roster, introduce Black, cap ~12
  const pool=['grey','teal','red','green','purple','black'];
  const n=Math.min(6+(level-7),12);
  const out=[]; for(let i=0;i<n;i++) out.push(pool[Math.floor(Math.random()*pool.length)]);
  if(level>=9 && !out.includes('black')) out[0]='black';
  return out;
}
// Spawn the current level's wave in "warp-in" state and start the countdown.
function beginWave(){
  waveRoster(run.level).forEach(tp=>{ const p=randSpawnPos(); const e=spawnEnemy(tp,p.x,p.y); if(e) e.spawning=true; });
  run.phase='intermission'; run.timer=INTERMISSION_MS;
  updateHud();
}
function nextWave(){ run.level++; beginWave(); }

// Reset the arena for a fresh start of either mode.
function resetArena(){
  shells.length=0; particles.length=0; smoke.length=0; enemies.length=0;
  tank.x=W*0.16; tank.y=H*0.6; tank.vx=0; tank.vy=0;
  tank.bodyAngle=0; tank.turretAngle=-Math.PI/2; tank.aimTarget=tank.turretAngle;
  tank.team='player'; tank.lastFire=0; tank.fireSlowUntil=0; tank.maxHp=run.maxHp; tank.hp=run.maxHp;
  score=0;
  if(gameMode==='sandbox')        spawnSandboxSet();
  else if(gameMode==='roguelike') beginWave();
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
