"use strict";
// ui — menus, the tuning panel, mode toggle, start overlay wiring.

const panel=document.getElementById('panel');
const closePanel=()=>panel.classList.remove('open');
document.getElementById('gear').onclick=()=>panel.classList.toggle('open');   // ⚙ toggles (so it closes too)
document.getElementById('closePanel').onclick=closePanel;
const panelDone=document.getElementById('panelDone'); if(panelDone) panelDone.onclick=closePanel;   // explicit Close button (optional in DOM)
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
// NOTE: a build can include only a SUBSET of these controls (the co-op host trims the gameplay-tuning
// sliders, keeping input + sound/haptics/shake). Every lookup is null-guarded so a missing control is
// simply skipped — the same ui.js drives both the full single-player panel and the trimmed host panel.
function syncPanel(){
  binds.forEach(([id,lbl,fmt])=>{const el=document.getElementById(id); if(!el)return;
    el.value=cfg[id]; const l=document.getElementById(lbl); if(l) l.textContent=fmt(cfg[id]);});
  TOGGLES.forEach(id=>{const t=document.getElementById(id); if(t) t.checked=cfg[id];});
}
binds.forEach(([id,lbl,fmt])=>{const el=document.getElementById(id); if(!el)return;
  el.addEventListener('input',()=>{cfg[id]=parseFloat(el.value);
    const l=document.getElementById(lbl); if(l) l.textContent=fmt(cfg[id]); savePrefs();});});
TOGGLES.forEach(id=>{const t=document.getElementById(id); if(t)
  t.addEventListener('change',e=>{cfg[id]=e.target.checked; savePrefs();});});
const resetBtn=document.getElementById('reset'); if(resetBtn) resetBtn.onclick=()=>{Object.assign(cfg,DEFAULTS);syncPanel();savePrefs();};
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
const GUN_NAME ={ laser:'Laser', wireGuided:'Wire-Guided', scatter:'Scattergun', bounceRocket:'Bounce Rockets', apds:'APDS' };
const GUN_COLOR={ laser:'#8fe3ff', wireGuided:'#c08af0', scatter:'#f0b24a', bounceRocket:'#7ad6a0', apds:'#e86a5a' };
function updateHud(){
  elHits.textContent='Hits '+score;
  // Shared team lives + level; then the LOCAL player's economy/build. (Per-player status for networked
  // players goes to their phones in B2.)
  const p=LP();
  let s='Lv '+run.level+' · '+'♥'.repeat(Math.max(0,run.teamLives));
  if(p){
    s+=' · ◆'+p.scrap;
    if(p.gunMode) s+=' · '+(GUN_GLYPH[p.gunMode]||'◗');               // right slot (gun-mode)
    if(p.gadget)       s+=' · ⚙'+p.gadgetCharges+'/'+p.gadgetMaxCharges; // left slot: gadget charges
    else if(p.vibranium) s+=' · ⚡V';                                  // left slot: vibranium
    else if(p.armor)     s+=' · 🛡';                                   // left slot: front glacis
  }
  elRun.textContent=s;
}

// ---- Supply Depot (FTL-style; pauses the sim via run.phase==='shop' until EVERY living player leaves) ----
// Co-op: each player shops their OWN scrap on their OWN phone; the host keyboard seat (LP) uses the
// on-TV overlay. `shopItems(p)` is the canonical buyable list shared by the local overlay AND the net
// payload; `shopApply(p,key)` is the single source of truth for a purchase.
const shopOverlay=document.getElementById('shop');
const shopCards=document.getElementById('shopCards');
let shopFlash=null;
let shopPending=new Set();   // ids of players still in the depot; the wave waits until it's empty (no timeout)

// One canonical list of what player p can buy right now (stat lines, consumables, rolled rulebreakers).
function shopItems(p){
  const items=[];
  for(const line of SHOP_STOCK) items.push({ key:line.id, name:line.name, desc:line.desc,
    cost:shopLineCost(p,line), level:p.buys[line.id]||0, tag:line.weight?'+WT':'' });
  items.push({ key:'repair', name:'Repair', desc:'Restore 1 HP', cost:REPAIR_COST, disabled:p.hp>=p.maxHp });
  items.push({ key:'life',   name:'Team Life', desc:'+1 shared team life', cost:LIFE_COST });
  if(p.gadget) items.push({ key:'rearm', name:'Rearm: '+p.gadget.name, desc:'Refill gadget charges',
    cost:REARM_COST, disabled:p.gadgetCharges>=p.gadgetMaxCharges });
  p.shopRb.forEach((u,i)=>{ if(u) items.push({ key:'rb'+i, name:u.name, desc:u.desc, cost:rbCost(p), tag:'RULEBREAKER' }); });
  return items;
}
// Apply a purchase to player p (validates affordability). Returns true if it went through.
function shopApply(p,key){
  if(key==='repair'){ if(p.hp<p.maxHp && p.scrap>=REPAIR_COST){ p.scrap-=REPAIR_COST; p.hp++; return true; } return false; }
  if(key==='life'){ if(p.scrap>=LIFE_COST){ p.scrap-=LIFE_COST; run.maxTeamLives++; run.teamLives++; updateHud(); return true; } return false; }
  if(key==='rearm'){ if(p.gadget && p.gadgetCharges<p.gadgetMaxCharges && p.scrap>=REARM_COST){ p.scrap-=REARM_COST; p.gadgetCharges=p.gadgetMaxCharges; return true; } return false; }
  if(key[0]==='r'&&key[1]==='b'){ const i=+key.slice(2), u=p.shopRb[i], c=rbCost(p);
    if(u && p.scrap>=c){ p.scrap-=c; u.apply(p); p.buys._rb=(p.buys._rb||0)+1; p.shopRb[i]=null; return true; } return false; }
  const line=SHOP_STOCK.find(l=>l.id===key);
  if(line){ const c=shopLineCost(p,line); if(p.scrap>=c){ p.scrap-=c; p.buys[line.id]=(p.buys[line.id]||0)+1; if(line.weight) p.weight+=line.weight; line.apply(p); return true; } }
  return false;
}
function pips(n){ return n>0 ? '●'.repeat(Math.min(n,6))+(n>6?' ×'+n:'') : '·'; }
function tankSchematicSVG(p){
  const gc=GUN_COLOR[p.gunMode]||'#cfc8ba';
  const tread=p.tracks?'#7a3b32':'#2c2925';
  const glacis=p.armor?'<rect x="20" y="17" width="40" height="8" rx="3" fill="#e8c84a"/>':'';
  const halo=p.vibranium?'<rect x="13" y="19" width="54" height="62" rx="15" fill="none" stroke="#b98cf0" stroke-width="2.5" opacity=".85"/>':'';
  return '<svg viewBox="0 0 80 100" aria-hidden="true">'+halo
    +'<rect x="8" y="22" width="11" height="58" rx="5" fill="'+tread+'"/>'
    +'<rect x="61" y="22" width="11" height="58" rx="5" fill="'+tread+'"/>'
    +'<rect x="20" y="24" width="40" height="54" rx="8" fill="#5b5750"/>'+glacis
    +'<rect x="36.5" y="6" width="7" height="46" rx="2.5" fill="'+gc+'"/>'
    +'<circle cx="40" cy="54" r="15" fill="#6e695f"/>'
    +'<circle cx="40" cy="54" r="4.5" fill="'+gc+'"/></svg>';
}
function renderShopBuild(p){
  const host=document.getElementById('shopBuild'); if(!host) return;
  const gun = p.gunMode ? (GUN_GLYPH[p.gunMode]||'◗')+' '+(GUN_NAME[p.gunMode]||p.gunMode) : '— standard';
  const left = p.gadget ? '⚙ '+p.gadget.name+' ('+p.gadgetCharges+'/'+p.gadgetMaxCharges+')'
             : p.vibranium ? '⚡ Vibranium'
             : p.armor ? '🛡 Front Glacis ('+(p.maxPlates||0)+' plates)'
             : '— empty';
  const rows = SHOP_STOCK.map(line=>{ const lv=p.buys[line.id]||0;
    return '<div class="bs-row'+(lv?'':' bs-zero')+(shopFlash===line.id?' just-bought':'')+'">'
      +'<span class="bs-name">'+line.name+'</span><span class="bs-pips">'+pips(lv)+'</span></div>'; }).join('');
  host.innerHTML='<div class="build-tank">'+tankSchematicSVG(p)+'</div>'
    +'<div class="build-info">'
      +'<div class="bs-load"><span>Chassis</span><b>'+(p.class?p.class.name:'Standard')+'</b></div>'
      +'<div class="bs-load"><span>Gun</span><b>'+gun+'</b></div>'
      +'<div class="bs-load"><span>Left</span><b>'+left+'</b></div>'
      +'<div class="bs-stats">'+rows+'</div></div>';
}
function shopCard(it, p){
  const afford = p.scrap>=it.cost && !it.disabled;
  const rb = it.tag==='RULEBREAKER';
  const b=document.createElement('button');
  b.className='up-card '+(rb?'up-rulebreaker':(it.tag?'up-rare':''))+(afford?'':' up-locked')+(shopFlash===it.key?' just-bought':'');
  const tag = it.tag ? '<span class="up-tier">'+it.tag+'</span>' : '';
  const lvl = it.level ? '<span class="up-lvl">Lv '+it.level+'</span>' : '';
  const price = it.disabled ? 'FULL' : '◆ '+it.cost;
  b.innerHTML=tag+lvl+'<b>'+it.name+'</b><small>'+it.desc+'</small><span class="up-price">'+price+'</span>';
  if(afford) b.onclick=()=>{ if(shopApply(p,it.key)){ shopFlash=it.key; SFX.hit(); updateHud(); renderShopFor(p); } };
  return b;
}
// The on-TV depot overlay for the LOCAL keyboard seat.
function renderShopFor(p){
  const wt=Math.max(0, p.weight-p.engine);
  document.getElementById('shopBal').textContent =
    '◆ '+p.scrap+' scrap   ·   ♥ team '+run.teamLives+'   ·   weight '+p.weight+' / engine '+p.engine+(wt>0?'  (−'+Math.round((1-1/(1+0.07*wt))*100)+'% speed)':'');
  const salv=document.getElementById('shopSalvage');
  if(salv) salv.textContent = run.lastWaveScrap>0 ? '✦ Salvaged ◆'+run.lastWaveScrap+' from the last push' : '';
  renderShopBuild(p);
  shopCards.innerHTML='';
  for(const it of shopItems(p)) shopCards.appendChild(shopCard(it,p));
  shopFlash=null;
}
// Open the depot for the whole party: roll each player's rulebreakers, pause the sim, show the local
// overlay + push each phone its shop, and wait until everyone has left before the next wave.
function openDepot(){
  run.phase='shop'; shake=0;
  const alive=livingPlayers();
  for(const p of alive) rollShopRulebreakers(p);
  shopPending=new Set(alive.map(p=>p.id));
  const lp=LP();
  if(lp && !lp.down){ renderShopFor(lp); shopOverlay.classList.add('active'); }
  if(typeof netOpenShop==='function') for(const p of alive) if(p.id!=='local') netOpenShop(p);
  updateShopStatus();
  if(shopPending.size===0) closeDepot();       // rare double-KO at clear → nobody to shop
}
function shopDoneFor(p){
  if(!p || !shopPending.has(p.id)) return;
  shopPending.delete(p.id);
  if(p.id==='local') shopOverlay.classList.remove('active');
  else if(typeof netCloseShop==='function') netCloseShop(p);
  updateShopStatus();
  if(shopPending.size===0) closeDepot();
}
function closeDepot(){
  shopOverlay.classList.remove('active');
  const w=document.getElementById('shopwait'); if(w) w.style.display='none';
  nextWave();
}
// TV indicator while the local seat is done but phones are still shopping (host injects #shopwait).
function updateShopStatus(){
  const w=document.getElementById('shopwait'); if(!w) return;
  const names=[...shopPending].map(id=>{ const q=players.find(x=>x.id===id); return q?q.name:id; });
  if(!shopPending.has('local') && shopPending.size>0){ w.style.display='flex'; w.textContent='Depot — waiting for '+names.join(', ')+'…'; }
  else w.style.display='none';
}
document.getElementById('shopLeave').onclick=()=>{ const lp=LP(); if(lp) shopDoneFor(lp); else closeDepot(); };

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
function sbCurrentLeft(){ const p=LP(); if(!p) return 'none'; return p.gadget?p.gadget.id : (p.vibranium?'vibranium':(p.armor?'glacis':'none')); }
// Apply a class loadout live to the local player (mirrors startMode's baked-slot setup).
function setSandboxClass(key){
  const p=LP(); if(!p) return;
  p.class = (key && key!=='none') ? CLASSES[key] : null;
  p.gunMode = (p.class && p.class.bakedGun) || null;
  clearLeftSlot(p);
  if(p.class && p.class.bakedLeft) setLeftSlot(p, p.class.bakedLeft);
  p.tracks = !!(p.class && p.class.tracks);
  p.rocket = false;
  updateHud(); renderSandboxLab();
}
function renderSandboxLab(){
  sbUpList.innerHTML='';
  const p=LP(); if(!p) return;
  const left=sbCurrentLeft();
  const sum=document.createElement('p'); sum.className='sb-sum';
  sum.textContent='Class '+(p.class?p.class.name:'—')+'  ·  Gun '+(p.gunMode||'—')+'  ·  Left '+(left==='none'?'—':left);
  sbUpList.appendChild(sum);
  sbUpList.appendChild(sbSection('Class', SB_CLASS.map(([k,l])=>sbBtn(l,(p.class?p.class.key:'none')===k,()=>setSandboxClass(k)))));
  sbUpList.appendChild(sbSection('Right slot · gun', SB_GUN.map(([k,l])=>sbBtn(l,(p.gunMode||'none')===k,()=>{ p.gunMode=k==='none'?null:k; updateHud(); renderSandboxLab(); }))));
  const leftOpts=[['none','None'],['glacis','Glacis'],['vibranium','Vibranium'],...Object.keys(GADGETS).map(id=>[id,GADGETS[id].name])];
  sbUpList.appendChild(sbSection('Left slot · defense / gadget', leftOpts.map(([k,l])=>sbBtn(l,left===k,()=>{ if(k==='none')clearLeftSlot(p); else setLeftSlot(p,k); updateHud(); renderSandboxLab(); }))));
  sbUpList.appendChild(sbSection('Stat upgrades (stack)', UPGRADES.filter(u=>u.tier!=='rulebreaker').map(u=>sbBtn(u.name,false,()=>{ u.apply(p); updateHud(); renderSandboxLab(); }))));
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
  const p=LP(); if(!p) return;
  p.mods=freshMods(); p.maxHp=1; p.hp=1;
  p.gunMode=null; clearLeftSlot(p); p.class=null; p.tracks=false; p.rocket=false;
  updateHud(); renderSandboxLab();
};
document.getElementById('sbUpClose').onclick=()=>{ sbUp.classList.remove('active'); paused=false; };
