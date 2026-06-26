"use strict";
// state — world data + layout/spawn setup. No rendering, no input.
// COUCH CO-OP: the singleton `tank` is gone — there is a `players[]` array, each entry a tank that
// carries its OWN build (class, mods, scrap, gun/left slots). `run` holds only shared wave/lives
// state. The sim reads each player's `intent` (filled by the host keyboard seat or, later, the network).

// ---- per-player tank factory ----
// A player owns movement state + its whole build. `intent` decouples the sim from the input source:
// {mx,my} normalized move vector, aim angle, aiming flag, firing (held), deploy (held). The host
// keyboard fills player[0]'s intent; networked controllers fill the rest (B2).
function freshIntent(){ return {mx:0,my:0,aim:-Math.PI/2,aiming:false,firing:false,deploy:false}; }
function makePlayer(id,color,name){
  return { id, color, name,
    x:0,y:0,r:17,bodyAngle:0,turretAngle:-Math.PI/2,aimTarget:-Math.PI/2,vx:0,vy:0,
    team:'player', hp:1, maxHp:1, lastFire:0, fireSlowUntil:0,
    armor:null, trackBroken:false, immobileUntil:0, plates:0,
    brokenSides:{pos:false,neg:false},
    flying:0, cloak:0, charged:false, iframes:0, tracks:false, rocket:false,
    // build (was the per-player half of `run`)
    class:null, mods:freshMods(), scrap:0, maxPlates:0,
    buys:{}, weight:0, engine:0, shopRb:[],
    gunMode:null, leftSlotId:null, gadget:null, gadgetCharges:0, gadgetMaxCharges:0, gadgetCdUntil:0, vibranium:false,
    // co-op status
    down:false, scatterQueue:[],            // spectate-till-clear; per-player staggered Scattergun burst
    intent:freshIntent() };
}
let players=[];          // all player tanks (the local keyboard seat is players[0]; the rest join over the net)
function LP(){ return players[0]; }                       // the local (host keyboard) player, if any
function livingPlayers(){ return players.filter(p=>!p.down); }
function activePlayers(){ return players.filter(p=>!p.down); }   // alias: "in the field" == not downed
function partyCenter(){ const ps=livingPlayers(); if(!ps.length) return {x:W/2,y:H/2};
  let x=0,y=0; for(const p of ps){ x+=p.x; y+=p.y; } return {x:x/ps.length, y:y/ps.length}; }
function nearestPlayer(x,y){ let best=null,bd=1e18;        // nearest living player (cloak-agnostic: spawn spacing)
  for(const p of livingPlayers()){ const d=(p.x-x)**2+(p.y-y)**2; if(d<bd){bd=d;best=p;} } return best; }
function addPlayer(id,color,name){ const p=makePlayer(id,color,name); players.push(p); return p; }
function removePlayer(id){ const i=players.findIndex(p=>p.id===id); if(i>=0) players.splice(i,1); }

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
let turrets=[];          // player-deployed sentries/trophy {x,y,r,hp,team,kind,turretAngle,lastFire,expire}
let shields=[];          // player-deployed one-way arcs {x,y,r,ang,expire}
let spiderMines=[];      // player-deployed walking mines {x,y,vx,vy,arm,dead}
let beams=[];            // transient laser draws {pts:[{x,y}...],life,max}
let tracks=[];           // tread marks {x,y,a,life,max} — fade out; cleared between levels
let score=0;
let shake=0;

// Roguelike run state — SHARED across the party. Per-player build/economy lives on each player now.
// `teamLives` is the full-party-wipe pool (decision: a life is spent only when EVERYONE is down at once).
const run={ level:1, kills:0, phase:'fighting', timer:0, siege:null, waveKind:'normal',
            teamLives:3, maxTeamLives:3,
            waveScrap:0, lastWaveScrap:0 };   // shared celebration counter (total team salvage this wave)
function freshMods(){ return {move:1, turret:1, cd:1, shell:1, maxShells:0, bounce:0, fireSlow:1}; }
const START_TEAM_LIVES=3;
function resetRun(){
  run.level=1; run.kills=0; run.phase='fighting'; run.timer=0; run.siege=null; run.waveKind='normal';
  run.teamLives=START_TEAM_LIVES; run.maxTeamLives=START_TEAM_LIVES;
  run.waveScrap=0; run.lastWaveScrap=0;
  // per-player build is reset in setupPlayerForRun (called per player by startMode)
}
const INTERMISSION_MS=2600;   // breather + countdown before a wave goes live
const ELITE_SPAWN_DIST=280;   // min px from the nearest player for elite/boss warp spawns (normal waves = 170)
const GARRISON_MIN_DIST=150;  // soft min px from the nearest player for a siege garrison (best-effort)
const HOLD_MS=22000;          // king-of-the-hill hold duration (ticks only while a player is in the zone)
const REINFORCE_GAP=2600;     // ms between reinforcement spawns during the hold
const SCRAP_LIFE=18;          // seconds a scrap drop lingers before fading
// ---- Supply Depot (FTL-style shop) ----
const SHOP_EVERY=3;
const REPAIR_COST=3, LIFE_COST=7, REARM_COST=2;
const RB_BASE=8, RB_STEP=4;
const STIPEND_PER_WAVE=2;     // flat per-player scrap handed out at wave clear (co-op decision)
// Stat lines bought à la carte; each line costs more the more you own of THAT line. apply() takes a player.
const SHOP_STOCK=[
  {id:'engine',   name:'Engine',      desc:'+8% speed · +1 weight capacity', base:3, step:3, apply(p){ p.mods.move*=1.08; p.engine++; }},
  {id:'treads',   name:'Treads',      desc:'+15% move speed',                base:3, step:3, apply(p){ p.mods.move*=1.15; }},
  {id:'gyro',     name:'Gyro',        desc:'+20% turret turn',               base:2, step:2, apply(p){ p.mods.turret*=1.2; }},
  {id:'loader',   name:'Autoloader',  desc:'-15% fire cooldown',             base:3, step:2, apply(p){ p.mods.cd*=0.85; }},
  {id:'velocity', name:'Hi-Velocity', desc:'+18% shell speed',               base:2, step:2, apply(p){ p.mods.shell*=1.18; }},
  {id:'magazine', name:'Magazine',    desc:'+1 shell on screen · +1 weight', base:4, step:3, weight:1, apply(p){ p.mods.maxShells+=1; }},
  {id:'ricochet', name:'Ricochet',    desc:'+1 ricochet · +1 weight',        base:4, step:3, weight:1, apply(p){ p.mods.bounce+=1; }},
];
function shopLineCost(p,line){ return line.base + line.step*((p.buys[line.id]||0)); }
function rbCost(p){ return RB_BASE + RB_STEP*((p.buys._rb||0)); }
function rollShopRulebreakers(p){ p.shopRb = pickUpgrades(2,'rulebreaker'); }

// ---- Gadgets (the one active-ability slot; charge-based, deployed via the deploy input) ----
const GADGETS={
  sentryTeal:  { id:'sentryTeal',  name:'Sentry: Rocket', desc:'Deploy an immobile rocket turret', maxCharges:2, cd:1500, dir:'aim'  },
  sentryGrey:  { id:'sentryGrey',  name:'Sentry: Gun',    desc:'Deploy an immobile gun turret',    maxCharges:2, cd:1500, dir:'aim'  },
  trophy:      { id:'trophy',      name:'Trophy System',  desc:'Deploy a turret that zaps incoming shells', maxCharges:2, cd:1500, dir:'aim' },
  shield:      { id:'shield',      name:'One-way Shield', desc:'Deploy a frontal shell-stopping arc', maxCharges:3, cd:1200, dir:'aim' },
  spiderMines: { id:'spiderMines', name:'Spider Mines',   desc:'Release mines that crawl at enemies', maxCharges:3, cd:1500, dir:'aim' },
  dash:        { id:'dash',        name:'Dash',           desc:'Blink a short distance (brief i-frames)', maxCharges:4, cd:700,  dir:'move' },
  jumpJets:    { id:'jumpJets',    name:'Jump Jets',      desc:'Fly 3s — no hits, cross holes & walls', maxCharges:3, cd:2000, dir:'move' },
  stealth:     { id:'stealth',     name:'Stealth',        desc:'Vanish from enemies until you fire (10s)', maxCharges:3, cd:2000, dir:'aim' },
};
function equipGadget(p,g){
  p.gadget=g;
  p.gadgetMaxCharges = g.maxCharges||GADGET_CHARGES;
  p.gadgetCharges = p.gadgetMaxCharges;
  p.gadgetCdUntil = 0;
}
// The LEFT slot holds exactly one of: a gadget, or a defensive passive (vibranium / glacis).
function clearLeftSlot(p){
  p.leftSlotId=null;
  p.gadget=null; p.gadgetCharges=0; p.gadgetMaxCharges=0; p.gadgetCdUntil=0;
  p.vibranium=false;
  p.armor=null; p.maxPlates=0; p.plates=0;
  p.trackBroken=false; p.immobileUntil=0; p.brokenSides={pos:false,neg:false};
}
function setLeftSlot(p,id){
  clearLeftSlot(p);
  p.leftSlotId=id;
  if(id==='vibranium')   p.vibranium=true;
  else if(id==='glacis'){ p.armor=FRONT_ARMOR; p.maxPlates=HEAVY_PLATES; p.plates=p.maxPlates; }
  else if(GADGETS[id])    equipGadget(p,GADGETS[id]);
}

// Upgrade pool offered between waves. apply(p) mutates THAT player's build (mods / hp / slots).
const UPGRADES=[
  {name:'Treads',      tier:'common', desc:'+20% move speed',    apply(p){ p.mods.move*=1.2; }},
  {name:'Gyro',        tier:'common', desc:'+25% turret turn',   apply(p){ p.mods.turret*=1.25; }},
  {name:'Autoloader',  tier:'common', desc:'-18% fire cooldown', apply(p){ p.mods.cd*=0.82; }},
  {name:'Hi-Velocity', tier:'common', desc:'+20% shell speed',   apply(p){ p.mods.shell*=1.2; }},
  {name:'Recoil damp', tier:'common', desc:'-50% fire slow',     apply(p){ p.mods.fireSlow*=0.5; }},
  {name:'Magazine',    tier:'rare',   desc:'+1 shell on screen', apply(p){ p.mods.maxShells+=1; }},
  {name:'Ricochet',    tier:'rare',   desc:'+1 ricochet',        apply(p){ p.mods.bounce+=1; }},
  {name:'Plating',     tier:'rare',   desc:'+1 max HP & heal',   apply(p){ p.maxHp+=1; p.hp=p.maxHp; }},
  // ---- RIGHT slot: gun-modes ----
  {name:'APDS Rounds', tier:'rulebreaker', rulebreaker:true, slot:'gun', desc:'Right slot: sabot rounds punch through tanks', apply(p){ p.gunMode='apds'; }},
  {name:'Scattergun', tier:'rulebreaker', rulebreaker:true, slot:'gun', desc:'Right slot: fire a 3-shell spread', apply(p){ p.gunMode='scatter'; }},
  {name:'Laser', tier:'rulebreaker', rulebreaker:true, slot:'gun', desc:'Right slot: hitscan laser · bounces · slower', apply(p){ p.gunMode='laser'; }},
  {name:'Wire-Guided Missiles', tier:'rulebreaker', rulebreaker:true, slot:'gun', desc:'Right slot: steer the missile (hold aim)', apply(p){ p.gunMode='wireGuided'; }},
  {name:'Bounce Rockets', tier:'rulebreaker', rulebreaker:true, slot:'gun', desc:'Right slot: a bounced shell locks on & rockets in', apply(p){ p.gunMode='bounceRocket'; }},
  // ---- LEFT slot: one defensive passive OR one active gadget ----
  {name:'Front Glacis', tier:'rulebreaker', rulebreaker:true, slot:'left', desc:'Left slot: front deflects shots · 2 plates', apply(p){ setLeftSlot(p,'glacis'); }},
  {name:'Vibranium Plate', tier:'rulebreaker', rulebreaker:true, slot:'left', desc:'Left slot: survive a hit → charge & ram', apply(p){ setLeftSlot(p,'vibranium'); }},
  {name:'Rocket Sentry', tier:'rulebreaker', rulebreaker:true, slot:'left', desc:'Left gadget: an immobile rocket turret', apply(p){ setLeftSlot(p,'sentryTeal'); }},
  {name:'Gun Sentry', tier:'rulebreaker', rulebreaker:true, slot:'left', desc:'Left gadget: an immobile gun turret', apply(p){ setLeftSlot(p,'sentryGrey'); }},
  {name:'Trophy System', tier:'rulebreaker', rulebreaker:true, slot:'left', desc:'Left gadget: a turret that zaps incoming shells', apply(p){ setLeftSlot(p,'trophy'); }},
  {name:'One-way Shield', tier:'rulebreaker', rulebreaker:true, slot:'left', desc:'Left gadget: a frontal shell-stopping arc', apply(p){ setLeftSlot(p,'shield'); }},
  {name:'Spider Mines', tier:'rulebreaker', rulebreaker:true, slot:'left', desc:'Left gadget: mines that crawl at enemies', apply(p){ setLeftSlot(p,'spiderMines'); }},
  {name:'Dash', tier:'rulebreaker', rulebreaker:true, slot:'left', desc:'Left gadget: blink a short distance (i-frames)', apply(p){ setLeftSlot(p,'dash'); }},
  {name:'Jump Jets', tier:'rulebreaker', rulebreaker:true, slot:'left', desc:'Left gadget: fly 3s — no hits, cross terrain', apply(p){ setLeftSlot(p,'jumpJets'); }},
  {name:'Stealth', tier:'rulebreaker', rulebreaker:true, slot:'left', desc:'Left gadget: vanish from enemies until you fire', apply(p){ setLeftSlot(p,'stealth'); }},
];
const TIER_WEIGHT={ common:1, rare:0.42, rulebreaker:0.16 };
function pickUpgrades(n, tierFilter){
  const pool=UPGRADES.filter(u=>!tierFilter || u.tier===tierFilter);
  const lvl=run.level||1;
  const boost=u=>({ common:1, rare:1+lvl*0.05, rulebreaker:1+lvl*0.045 }[u.tier]||1);
  const wt=u=>(TIER_WEIGHT[u.tier]||1)*boost(u);
  const out=[];
  while(out.length<n && pool.length){
    let total=0; for(const u of pool) total+=wt(u);
    let r=Math.random()*total, idx=pool.length-1;
    for(let j=0;j<pool.length;j++){ r-=wt(pool[j]); if(r<=0){ idx=j; break; } }
    out.push(pool.splice(idx,1)[0]);
  }
  return out;
}

// ---- player run setup (per player, from a chosen class) ----
// Mirrors the old startMode baked-slot block, but per player. classKey null = cfg baseline (sandbox).
function setupPlayerForRun(p, classKey){
  p.class = classKey ? CLASSES[classKey] : null;
  p.mods = freshMods();
  p.scrap=0; p.buys={}; p.weight=0; p.engine=0; p.shopRb=[];
  p.maxHp=1; p.hp=1;
  p.gunMode = (p.class && p.class.bakedGun) || null;
  clearLeftSlot(p);
  if(p.class && p.class.bakedLeft) setLeftSlot(p, p.class.bakedLeft);
  p.tracks = !!(p.class && p.class.tracks);   // Heavy: breakable side tracks (baked characteristic)
  p.rocket = false;                            // rockets come from the APDS gun-mode now
  p.down=false;
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
    hp:t.hp, maxHp:t.hp, boss:!!t.boss,
    armor:t.armor||null, tracks:!!(t.armor&&t.armor.tracks), trackBroken:false, immobileUntil:0, plates:t.boss?BOSS_PLATES:(t.armor?HEAVY_PLATES:0),
    speed:t.speed, shellSpeed:t.shellSpeed, bounce:t.bounce, cd:t.cd, maxShells:t.maxShells,
    rocket:t.rocket, aim:t.aim, engage:t.engage, mines:t.mines, invisible:t.invisible,
    fireGap:t.fireGap, fireChance:t.fireChance ?? 1, lastFire:0,
    nextFireAt: now + t.fireGap[0] + Math.random()*(t.fireGap[1]-t.fireGap[0]),
    nextMineAt: now + 900 + Math.random()*1600,
    _stuckMs:0, idleUntil:0, idleHeading:0,
  };
  enemies.push(e);
  return e;
}

function layMine(t){
  mines.push({x:t.x,y:t.y,team:t.team,owner:t,arm:1.0,fuse:6.0,blast:46,dead:false});
}

// A spawn point clear of all players and obstacles.
function randSpawnPos(){
  for(let tries=0;tries<60;tries++){
    const x=FRAME+30+Math.random()*(W-2*FRAME-60);
    const y=FRAME+30+Math.random()*(H-2*FRAME-60);
    const np=nearestPlayer(x,y); if(np && Math.hypot(x-np.x,y-np.y)<200) continue;
    const onTerrain=o=>x>o.x-24&&x<o.x+o.w+24&&y>o.y-24&&y<o.y+o.h+24;
    if(blockRects.some(onTerrain) || holeRects.some(onTerrain) || crates.some(onTerrain)) continue;
    return {x,y};
  }
  return {x:W/2,y:H/2};
}

// Milestone fair-spacing (set in beginWave for elite/boss waves, null otherwise).
let spawnGuard=null;
// A unit vector pointing from the party center toward arena center (jittered).
function pickSpawnDir(){
  const c=partyCenter();
  const base=Math.atan2(H/2-c.y, W/2-c.x) + (Math.random()-0.5)*1.2;
  return {x:Math.cos(base), y:Math.sin(base)};
}
// Warp-style enemy spawn: biased to 'e' hint cells, kept off the NEAREST player.
function enemySpawnPos(){
  const hints=(currentMap&&currentMap.enemyCells)||[];
  const minD = spawnGuard ? spawnGuard.minDist : 170;
  const c=partyCenter();
  for(let t=0;t<46;t++){
    let x,y;
    if(hints.length && t<20){ const p=cellToPx(hints[(Math.random()*hints.length)|0]);
      x=p.x+(Math.random()-0.5)*120; y=p.y+(Math.random()-0.5)*120; }
    else { x=FRAME+30+Math.random()*(W-2*FRAME-60); y=FRAME+30+Math.random()*(H-2*FRAME-60); }
    const np=nearestPlayer(x,y); if(np && Math.hypot(x-np.x,y-np.y)<minD) continue;
    if(spawnGuard && t<30){       // prefer the biased half early (relative to party center)
      const dx=x-c.x, dy=y-c.y;
      if(dx*spawnGuard.dir.x+dy*spawnGuard.dir.y<0) continue;
    }
    const onTerrain=o=>x>o.x-22&&x<o.x+o.w+22&&y>o.y-22&&y<o.y+o.h+22;
    if(blockRects.some(onTerrain)||holeRects.some(onTerrain)||crates.some(onTerrain)) continue;
    const space = t<34 ? 100 : 45;
    if(enemies.some(o=>(o.x||o.y)&&Math.hypot(x-o.x,y-o.y)<space)) continue;
    return {x,y};
  }
  return randSpawnPos();
}
function siegeEntryPos(r){
  const m=r+16, ry=()=>FRAME+r+Math.random()*(H-2*FRAME-2*r), rx=()=>FRAME+r+Math.random()*(W-2*FRAME-2*r);
  switch(Math.floor(Math.random()*4)){
    case 0: return {x:FRAME-m,        y:ry()};
    case 1: return {x:W-FRAME+m,      y:ry()};
    case 2: return {x:rx(),           y:FRAME-m};
    default:return {x:rx(),           y:H-FRAME+m};
  }
}
function placeForWave(e){
  if(currentMap && currentMap.def.spawn==='siege'){ const p=siegeEntryPos(e.r); e.x=p.x; e.y=p.y; e.entering=true; }
  else { const p=enemySpawnPos(); e.x=p.x; e.y=p.y; e.entering=false; }
}
function garrisonSpawnPos(){
  if(!holdRect) return enemySpawnPos();
  for(let t=0;t<30;t++){
    const x=holdRect.x+Math.random()*holdRect.w, y=holdRect.y+Math.random()*holdRect.h;
    const np=nearestPlayer(x,y);
    if(t<22 && np && Math.hypot(x-np.x,y-np.y)<GARRISON_MIN_DIST) continue;
    const onT=o=>x>o.x-8&&x<o.x+o.w+8&&y>o.y-8&&y<o.y+o.h+8;
    if(blockRects.some(onT)||holeRects.some(onT)||crates.some(onT)) continue;
    return {x,y};
  }
  return {x:holdRect.x+holdRect.w/2, y:holdRect.y+holdRect.h/2};
}
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

// Sandbox helpers (single local player).
function spawnSandboxSet(){
  ['brown','grey','teal','red'].forEach(tp=>{ const e=spawnEnemy(tp,0,0); if(e){ const p=enemySpawnPos(); e.x=p.x; e.y=p.y; } });
}
let sbReactHits=false;
function sandboxSpawn(type){ const e=spawnEnemy(type,0,0); if(e){ const p=enemySpawnPos(); e.x=p.x; e.y=p.y; e.spawning=false; } }
function sandboxClearEnemies(){ enemies.length=0; shells.length=0; mines.length=0; turrets.length=0; spiderMines.length=0; }

// Roguelike wave composition.
const WAVES=[
  null,
  ['brown','brown','brown'],
  ['brown','brown','grey','grey'],
  ['grey','grey','grey','teal'],
  ['grey','grey','red','teal'],
  ['red','red','green','teal','teal'],
  ['yellow','yellow','red','red','green'],
  ['purple','red','red','green','green','teal'],
  ['heavy','grey','grey','red','green'],
];
function waveKindFor(level){
  if(level%10===0) return 'boss';
  if(level%5===0)  return 'elite';
  return 'normal';
}
function waveRoster(level){
  const kind=waveKindFor(level);
  if(kind==='boss'){
    const guard = level>=20 ? ['red','red','heavy','black'] : ['red','red','heavy'];
    return ['boss', ...guard];
  }
  let out;
  if(level<WAVES.length) out=WAVES[level].slice();
  else {
    const pool=['grey','teal','red','green','purple','yellow','white','black','heavy'];
    const n=Math.min(6+(level-7),12);
    out=[]; for(let i=0;i<n;i++) out.push(pool[Math.floor(Math.random()*pool.length)]);
    if(level>=9 && !out.includes('white')) out[0]='white';
    if(level>=10 && !out.includes('black')) out[1]='black';
    if(level>=11 && !out.includes('heavy')) out[2]='heavy';
  }
  if(kind==='elite') out.push('heavy','black');
  return out;
}
function beginWave(){
  loadNextMap();
  mines.length=0; tracks.length=0; shells.length=0; smoke.length=0; particles.length=0; pickups.length=0;
  turrets.length=0; shields.length=0; spiderMines.length=0; beams.length=0;
  for(const p of players) p.down=false;     // wave start: everyone is back in the field
  resetAllPlayersToSpawn();
  run.waveScrap=0;
  run.waveKind=waveKindFor(run.level);
  spawnGuard = run.waveKind==='normal' ? null : { minDist: ELITE_SPAWN_DIST, dir: pickSpawnDir() };
  if(currentMap.def.spawn==='siege' && holdRect && run.waveKind==='normal'){
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

// Put one player back at the map spawn (spread around it when there are several), re-aimed up.
function playerSpawnPos(idx,count){
  const base=mapPlayerSpawn();
  if(count<=1) return {x:base.x,y:base.y};
  const ang=(idx/count)*Math.PI*2, rad=36;
  return {x:base.x+Math.cos(ang)*rad, y:base.y+Math.sin(ang)*rad};
}
function resetPlayerToSpawn(p, idx, count){
  const sp=playerSpawnPos(idx||0, count||1);
  p.x=sp.x; p.y=sp.y; p.vx=0; p.vy=0;
  p.bodyAngle=0; p.turretAngle=-Math.PI/2; p.aimTarget=p.turretAngle;
  p.lastFire=0; p.fireSlowUntil=0;
  p.trackBroken=false; p.immobileUntil=0;
  p.brokenSides={pos:false,neg:false};
  p.plates=p.maxPlates||0;
  p.flying=0; p.cloak=0; p.charged=false; p.iframes=0;
  p.scatterQueue.length=0;
  pushOutTerrain(p);
}
function resetAllPlayersToSpawn(){ players.forEach((p,i)=>resetPlayerToSpawn(p,i,players.length)); }

function resetArena(){
  spawnGuard=null;
  shells.length=0; particles.length=0; smoke.length=0; mines.length=0; tracks.length=0; enemies.length=0; pickups.length=0;
  turrets.length=0; shields.length=0; spiderMines.length=0; beams.length=0;
  for(const p of players){ p.team='player'; p.hp=p.maxHp; p.down=false; }
  score=0;
  if(gameMode==='sandbox'){ loadNextMap(); resetAllPlayersToSpawn(); spawnSandboxSet(); }
  else if(gameMode==='roguelike') beginWave();
}

function sandboxNextMap(){
  loadNextMap();
  shells.length=0; smoke.length=0; mines.length=0; tracks.length=0; particles.length=0; enemies.length=0; pickups.length=0;
  turrets.length=0; shields.length=0; spiderMines.length=0; beams.length=0;
  resetAllPlayersToSpawn();
  spawnSandboxSet();
}

// Full-party wipe (everyone down at once): spend a team life and re-stage the wave, keeping the
// enemies you already killed dead. Out of team lives → game over (handled by the caller).
function reviveParty(){
  shells.length=0; mines.length=0; smoke.length=0; particles.length=0; tracks.length=0; pickups.length=0;
  turrets.length=0; shields.length=0; spiderMines.length=0; beams.length=0;
  projectMap();
  for(const p of players) p.down=false;
  resetAllPlayersToSpawn();
  const now=performance.now();
  if(run.siege){ run.siege.timer=run.siege.max; run.siege.nextSpawn=0; }
  for(const e of enemies){
    if(run.siege){
      const p = run.siege.phase==='assault' ? garrisonSpawnPos() : reinforceSpawn(e.r);
      e.x=p.x; e.y=p.y; e.entering = run.siege.phase!=='assault';
    } else { placeForWave(e); }
    e.vx=0; e.vy=0; e.spawning=true; e.cloakStart=0; e.lastFire=0;
    e.nextFireAt = now + e.fireGap[0] + Math.random()*(e.fireGap[1]-e.fireGap[0]);
    e.nextMineAt = now + 900 + Math.random()*1600;
  }
  run.phase='intermission'; run.timer=INTERMISSION_MS;
  updateHud();
}
