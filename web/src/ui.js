"use strict";
// ui — menus, the tuning panel, mode toggle, start overlay wiring.

const panel=document.getElementById('panel');
document.getElementById('gear').onclick=()=>panel.classList.add('open');
document.getElementById('closePanel').onclick=()=>panel.classList.remove('open');
document.getElementById('modeBtn').onclick=()=>{
  mode=mode==='brawl'?'pubg':'brawl';
  const b=document.getElementById('modeBtn');
  b.innerHTML = mode==='brawl' ? 'Fire model: Brawl<small>release stick to fire</small>'
                               : 'Fire model: PUBG<small>aim + index-finger trigger</small>';
};

// Force reload — cache-busts so the latest Vercel deploy is fetched, not a stale copy.
document.getElementById('forceReload').onclick=()=>{
  location.href = location.origin + location.pathname + '?v=' + Date.now();
};

const binds=[['move','vMove',v=>v],['turret','vTurret',v=>(+v).toFixed(2)],
  ['body','vBody',v=>(+v).toFixed(2)],['shell','vShell',v=>v],['bounce','vBounce',v=>v],
  ['cd','vCd',v=>v],['dz','vDz',v=>v],['rad','vRad',v=>v],['maxshell','vMax',v=>v],
  ['fireSlow','vFireSlow',v=>v],['fireSlowMs','vFireSlowMs',v=>v]];
const TOGGLES=['preview','haptics','sound','shake','fixedStick','autofire'];
function syncPanel(){
  binds.forEach(([id,lbl,fmt])=>{const el=document.getElementById(id);
    el.value=cfg[id]; document.getElementById(lbl).textContent=fmt(cfg[id]);});
  TOGGLES.forEach(id=>document.getElementById(id).checked=cfg[id]);
}
binds.forEach(([id,lbl,fmt])=>{const el=document.getElementById(id);
  el.addEventListener('input',()=>{cfg[id]=parseFloat(el.value);
    document.getElementById(lbl).textContent=fmt(cfg[id]); savePrefs();});});
TOGGLES.forEach(id=>{document.getElementById(id)
  .addEventListener('change',e=>{cfg[id]=e.target.checked; savePrefs();});});
document.getElementById('reset').onclick=()=>{Object.assign(cfg,DEFAULTS);syncPanel();savePrefs();};
syncPanel();

// ---- fixed-stick center calibration (2 taps: left thumb, then right thumb) ----
const calib=document.getElementById('calib');
const calibText=document.getElementById('calibText');
let calibStep=null;
document.getElementById('calibBtn').onclick=()=>{
  panel.classList.remove('open');
  calibStep='move'; calibText.textContent='Tap where your LEFT thumb sits (move stick)';
  calib.classList.add('active');
};
calib.addEventListener('pointerdown',e=>{
  const x=e.clientX, y=e.clientY;
  if(calibStep==='move'){
    cfg.moveCx=x/W; cfg.moveCy=y/H; calibStep='aim';
    calibText.textContent='Now tap where your RIGHT thumb sits (aim stick)';
  } else if(calibStep==='aim'){
    cfg.aimCx=x/W; cfg.aimCy=y/H; calibStep=null;
    calib.classList.remove('active');
    cfg.fixedStick=true; savePrefs(); syncPanel();   // defining centers turns Fixed on
  }
});

// ---- HUD stat pills (sandbox: hits · roguelike: level/kills) ----
const elHits=document.getElementById('statHits');
const elRun=document.getElementById('statRun');
const GUN_GLYPH={ laser:'⚡', wireGuided:'➹', scatter:'⁂', bounceRocket:'⤵', apds:'⊳' };
function updateHud(){
  elHits.textContent='Hits '+score;
  let s='Lv '+run.level+' · '+'♥'.repeat(Math.max(0,run.hp))+' · ◆'+run.scrap;
  if(run.gunMode) s+=' · '+(GUN_GLYPH[run.gunMode]||'◗');               // right slot (gun-mode)
  if(run.gadget)       s+=' · ⚙'+run.gadgetCharges+'/'+run.gadgetMaxCharges; // left slot: gadget charges
  else if(run.vibranium) s+=' · ⚡V';                                    // left slot: vibranium
  else if(tank.armor)    s+=' · 🛡';                                     // left slot: front glacis
  elRun.textContent=s;
}

// ---- Supply Depot (FTL-style shop; pauses the sim via run.phase==='shop') ----
// Banked scrap is spent here on à-la-carte stat lines (per-line escalating cost), repairs,
// extra lives, and 2 rolled rulebreakers. Buy as many as you can afford, then leave.
const shopOverlay=document.getElementById('shop');
const shopCards=document.getElementById('shopCards');
function openShop(){
  run.phase='shop';
  shake=0;                  // kill any leftover shake from the wave-ending hit
  rollShopRulebreakers();   // fresh pair of rulebreakers for this visit
  renderShop();
  shopOverlay.classList.add('active');
}
// Build one purchasable card. cost: number; cls: extra class; onbuy: () => void.
function shopCard(name, desc, cost, opts){
  opts=opts||{};
  const afford = run.scrap>=cost && !opts.disabled;
  const b=document.createElement('button');
  b.className='up-card '+(opts.cls||'')+(afford?'':' up-locked');
  const tag = opts.tag ? '<span class="up-tier">'+opts.tag+'</span>' : '';
  const price = opts.sold ? 'SOLD' : (opts.disabled ? opts.disabledLabel||'—' : '◆ '+cost);
  b.innerHTML=tag+'<b>'+name+'</b><small>'+desc+'</small><span class="up-price">'+price+'</span>';
  if(afford) b.onclick=()=>{ run.scrap-=cost; opts.onbuy(); updateHud(); renderShop(); };
  return b;
}
function renderShop(){
  const wt=Math.max(0, run.weight-run.engine);
  document.getElementById('shopBal').textContent =
    '◆ '+run.scrap+' scrap   ·   ♥ '+run.hp+'/'+run.maxHp+' lives   ·   weight '+run.weight+' / engine '+run.engine+(wt>0?'  (−'+Math.round((1-1/(1+0.07*wt))*100)+'% speed)':'');
  shopCards.innerHTML='';
  // stat lines (per-line escalating cost; weighty lines tagged)
  SHOP_STOCK.forEach(line=>{
    const cost=shopLineCost(line);
    shopCards.appendChild(shopCard(line.name, line.desc, cost, {
      cls: line.weight?'up-rare':'',
      onbuy(){ run.buys[line.id]=(run.buys[line.id]||0)+1; if(line.weight) run.weight+=line.weight; line.apply(); }
    }));
  });
  // consumables
  shopCards.appendChild(shopCard('Repair', 'Restore one lost life', REPAIR_COST, {
    disabled: run.hp>=run.maxHp, disabledLabel:'FULL',
    onbuy(){ run.hp=Math.min(run.maxHp, run.hp+1); tank.hp=run.hp; }
  }));
  shopCards.appendChild(shopCard('Extra Life', 'Raise max lives by 1 (filled)', LIFE_COST, {
    onbuy(){ run.maxHp++; run.hp++; tank.maxHp=run.maxHp; tank.hp=run.hp; }
  }));
  if(run.gadget) shopCards.appendChild(shopCard('Rearm: '+run.gadget.name, 'Refill gadget charges', REARM_COST, {
    disabled: run.gadgetCharges>=run.gadgetMaxCharges, disabledLabel:'FULL',
    onbuy(){ run.gadgetCharges=run.gadgetMaxCharges; }
  }));
  // 2 rolled rulebreakers (shared escalating price); bought ones drop out of the pair
  run.shopRb.forEach((u,i)=>{
    if(!u) return;
    shopCards.appendChild(shopCard(u.name, u.desc, rbCost(), {
      cls:'up-rulebreaker', tag:'RULEBREAKER',
      onbuy(){ u.apply(); run.buys._rb=(run.buys._rb||0)+1; run.shopRb[i]=null; }
    }));
  });
}
document.getElementById('shopLeave').onclick=()=>{ shopOverlay.classList.remove('active'); nextWave(); };

// ---- game over / run summary ----
const gameover=document.getElementById('gameover');
function showGameOver(){
  started=false;
  document.getElementById('hud').classList.add('hud-hidden');
  document.getElementById('goStats').textContent='Reached wave '+run.level+' · '+run.kills+' kills';
  gameover.classList.add('active');
}
document.getElementById('goRetry').onclick=()=>{ gameover.classList.remove('active'); startMode('roguelike'); };
document.getElementById('goMenu').onclick =()=>{ gameover.classList.remove('active'); toMenu(); };

// ---- sandbox arsenal lab: class + two-slot loadout + enemy spawning + a test-hits toggle ----
const sbUp=document.getElementById('sbUp');
const sbUpList=document.getElementById('sbUpList');
const SB_CLASS=[['none','None'],['light','Light'],['medium','Medium'],['destroyer','TD'],['heavy','Heavy']];
const SB_GUN  =[['none','None'],['apds','APDS'],['scatter','Scatter'],['laser','Laser'],['wireGuided','Wire'],['bounceRocket','Bounce']];
const SB_ENEMIES=['brown','grey','teal','yellow','red','green','purple','white','black','heavy','boss'];

function sbBtn(label, active, onclick){
  const b=document.createElement('button'); b.className='sb-btn'+(active?' sb-active':''); b.textContent=label; b.onclick=onclick; return b;
}
function sbSection(title, btns){
  const w=document.createElement('div'); w.className='sb-section';
  const h=document.createElement('div'); h.className='sb-h'; h.textContent=title; w.appendChild(h);
  const r=document.createElement('div'); r.className='sb-row'; btns.forEach(b=>r.appendChild(b)); w.appendChild(r);
  return w;
}
function sbCurrentLeft(){ return run.gadget?run.gadget.id : (run.vibranium?'vibranium':(tank.armor?'glacis':'none')); }
// Apply a class loadout live (mirrors startMode's baked-slot setup) so its feel/traits are testable.
function setSandboxClass(key){
  run.class = (key && key!=='none') ? CLASSES[key] : null;
  run.gunMode = (run.class && run.class.bakedGun) || null;
  clearLeftSlot();
  if(run.class && run.class.bakedLeft) setLeftSlot(run.class.bakedLeft);
  tank.tracks = !!(run.class && run.class.tracks);
  tank.rocket = false;
  updateHud(); renderSandboxLab();
}
function renderSandboxLab(){
  sbUpList.innerHTML='';
  const left=sbCurrentLeft();
  const sum=document.createElement('p'); sum.className='sb-sum';
  sum.textContent='Class '+(run.class?run.class.name:'—')+'  ·  Gun '+(run.gunMode||'—')+'  ·  Left '+(left==='none'?'—':left);
  sbUpList.appendChild(sum);
  sbUpList.appendChild(sbSection('Class', SB_CLASS.map(([k,l])=>sbBtn(l,(run.class?run.class.key:'none')===k,()=>setSandboxClass(k)))));
  sbUpList.appendChild(sbSection('Right slot · gun', SB_GUN.map(([k,l])=>sbBtn(l,(run.gunMode||'none')===k,()=>{ run.gunMode=k==='none'?null:k; updateHud(); renderSandboxLab(); }))));
  const leftOpts=[['none','None'],['glacis','Glacis'],['vibranium','Vibranium'],...Object.keys(GADGETS).map(id=>[id,GADGETS[id].name])];
  sbUpList.appendChild(sbSection('Left slot · defense / gadget', leftOpts.map(([k,l])=>sbBtn(l,left===k,()=>{ if(k==='none')clearLeftSlot(); else setLeftSlot(k); updateHud(); renderSandboxLab(); }))));
  sbUpList.appendChild(sbSection('Stat upgrades (stack)', UPGRADES.filter(u=>u.tier!=='rulebreaker').map(u=>sbBtn(u.name,false,()=>{ u.apply(); updateHud(); renderSandboxLab(); }))));
  sbUpList.appendChild(sbSection('Spawn enemy', SB_ENEMIES.map(t=>sbBtn(t,false,()=>sandboxSpawn(t)))));
  sbUpList.appendChild(sbSection('Range', [sbBtn('Clear enemies',false,()=>{ sandboxClearEnemies(); }), sbBtn('Refill range',false,()=>{ spawnSandboxSet(); })]));
  sbUpList.appendChild(sbSection('Options', [
    sbBtn('React to hits: '+(sbReactHits?'ON':'OFF'), sbReactHits, ()=>{ sbReactHits=!sbReactHits; renderSandboxLab(); }),
  ]));
}
function openSandboxUpgrades(){ paused=true; renderSandboxLab(); sbUp.classList.add('active'); }
document.getElementById('sbUpgradeBtn').onclick=openSandboxUpgrades;
document.getElementById('sbMapBtn').onclick=sandboxNextMap;
document.getElementById('sbUpClear').onclick=()=>{
  run.mods=freshMods(); run.maxHp=3; run.hp=3; tank.maxHp=3; tank.hp=3;
  run.gunMode=null; clearLeftSlot(); run.class=null; tank.tracks=false; tank.rocket=false;
  updateHud(); renderSandboxLab();
};
document.getElementById('sbUpClose').onclick=()=>{ sbUp.classList.remove('active'); paused=false; };
