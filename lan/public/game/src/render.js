"use strict";
// render — reads state, draws the board, tanks, shells, particles, sticks. No mutation.

function drawFixedBase(cx,cy,color){
  ctx.save();ctx.globalAlpha=0.30;
  ctx.beginPath();ctx.arc(cx,cy,cfg.rad,0,7);ctx.strokeStyle=color;ctx.lineWidth=3;ctx.stroke();
  ctx.beginPath();ctx.arc(cx,cy,6,0,7);ctx.fillStyle=color;ctx.fill();
  ctx.restore();
}
function drawStick(p,color){
  if(!p)return; const s=stickVec(p);
  ctx.save();
  ctx.globalAlpha=0.9;
  ctx.beginPath();ctx.arc(p.bx,p.by,cfg.rad,0,7);ctx.strokeStyle='rgba(255,255,255,.5)';ctx.lineWidth=3;ctx.stroke();
  ctx.beginPath();ctx.arc(p.bx,p.by,cfg.rad,0,7);ctx.fillStyle='rgba(255,255,255,.12)';ctx.fill();
  ctx.beginPath();ctx.arc(p.bx+s.x,p.by+s.y,28,0,7);ctx.fillStyle=color;ctx.fill();
  ctx.strokeStyle='rgba(0,0,0,.18)';ctx.lineWidth=2;ctx.stroke();
  ctx.restore();
}
function drawPreview(p){
  if(!cfg.preview || !p || p.down) return;
  if(!(p.intent && p.intent.aiming)) return;          // only while the local player is actively aiming
  const aimA=p.turretAngle, sp=pShell(p);    // real gun direction (respects the TD arc) + class shell speed
  let g={x:p.x+Math.cos(aimA)*(p.r+10),
         y:p.y+Math.sin(aimA)*(p.r+10),
         vx:Math.cos(aimA)*sp, vy:Math.sin(aimA)*sp, b:pBounce(p)};
  ctx.save();ctx.setLineDash([3,7]);ctx.lineWidth=2.5;ctx.strokeStyle='rgba(44,42,38,.45)';
  ctx.beginPath();ctx.moveTo(g.x,g.y);
  const sdt=1/240;
  for(let i=0;i<260;i++){
    const r=reflectStep(g,0,0,sdt); g.x=r.x;g.y=r.y;g.vx=r.vx;g.vy=r.vy;
    if(r.hit){g.b--; if(g.b<0)break;}
    if(enemies.some(e=>Math.hypot(g.x-e.x,g.y-e.y)<e.r+4))break;
    ctx.lineTo(g.x,g.y);
  }
  ctx.stroke();ctx.restore();
}
// darken a #rrggbb by factor f (0..1) → rgb() string, for tank turret/track shading.
function darken(hex,f){
  const n=parseInt(hex.slice(1),16);
  return 'rgb('+Math.round(((n>>16)&255)*f)+','+Math.round(((n>>8)&255)*f)+','+Math.round((n&255)*f)+')';
}
function drawTank(t,col,colDark){
  ctx.save();ctx.translate(t.x,t.y);
  ctx.save();ctx.rotate(t.bodyAngle);
  // treads read red while rooted; a detracked side (player, per-side) stays red after.
  const rooted=(t.immobileUntil||0) > performance.now(), bs=t.brokenSides, RED='#7a3b32';
  ctx.fillStyle=(rooted||(bs&&bs.neg))?RED:colDark; ctx.fillRect(-t.r-2,-t.r+1,t.r*2+4,5);  // top = neg side
  ctx.fillStyle=(rooted||(bs&&bs.pos))?RED:colDark; ctx.fillRect(-t.r-2,t.r-6,t.r*2+4,5);    // bottom = pos side
  ctx.fillStyle=col;ctx.fillRect(-t.r,-t.r+3,t.r*2,t.r*2-6);
  if(t.armor && t.plates>0){ ctx.fillStyle=colDark;ctx.fillRect(t.r-4,-t.r+1,6,t.r*2-2); }  // front glacis (gone once plates spent → front is soft)
  ctx.restore();
  // turret
  ctx.rotate(t.turretAngle);
  ctx.fillStyle=colDark;ctx.fillRect(0,-4,t.r+12,8);
  ctx.beginPath();ctx.arc(0,0,9,0,7);ctx.fill();
  ctx.fillStyle=col;ctx.beginPath();ctx.arc(0,0,6,0,7);ctx.fill();
  ctx.restore();
}
function render(){
  ctx.save();
  if(shake>0) ctx.translate((Math.random()-0.5)*shake,(Math.random()-0.5)*shake);
  // board (no grid lines — the tile grid is an authoring aid only, never drawn)
  ctx.fillStyle=getCSS('--board');ctx.fillRect(0,0,W,H);
  // frame
  ctx.strokeStyle=getCSS('--frame');ctx.lineWidth=6;
  ctx.strokeRect(FRAME-3,FRAME-3,W-2*FRAME+6,H-2*FRAME+6);
  // tread marks (on the floor, under everything)
  ctx.fillStyle='#5a5346';
  for(const tr of tracks){
    ctx.globalAlpha=Math.max(0,(tr.life/tr.max)*0.26);
    ctx.save();ctx.translate(tr.x,tr.y);ctx.rotate(tr.a);
    ctx.fillRect(-3,-9,6,3); ctx.fillRect(-3,6,6,3);
    ctx.restore();
  }
  ctx.globalAlpha=1;
  // holes & water — drive-blocked, but shells & sightlines pass over.
  // Hole: top lip darkest → reads recessed. Water: blue with a light surface band.
  for(const o of holeRects){
    if(o.water){
      ctx.fillStyle=getCSS('--water-rim'); ctx.fillRect(o.x,o.y,o.w,o.h);
      ctx.fillStyle=getCSS('--water');     ctx.fillRect(o.x+2,o.y+2,o.w-4,o.h-4);
      ctx.globalAlpha=0.5;ctx.fillStyle=getCSS('--water-top');ctx.fillRect(o.x+3,o.y+3,o.w-6,3);ctx.globalAlpha=1;
    } else {
      ctx.fillStyle=getCSS('--hole-rim');  ctx.fillRect(o.x,o.y,o.w,o.h);
      ctx.fillStyle=getCSS('--hole');      ctx.fillRect(o.x+2,o.y+2,o.w-4,o.h-4);
      ctx.fillStyle=getCSS('--hole-floor');ctx.fillRect(o.x+2,o.y+6,o.w-4,o.h-8);
    }
  }
  // blocks — raised slabs (lighter top lip)
  for(const o of blockRects){
    ctx.fillStyle=getCSS('--slate');ctx.fillRect(o.x,o.y,o.w,o.h);
    ctx.fillStyle=getCSS('--slate-top');ctx.fillRect(o.x,o.y,o.w,5);
  }
  // crates — wooden destructible cover; darken as they take damage
  for(const c of crates){
    ctx.fillStyle=getCSS('--crate');    ctx.fillRect(c.x,c.y,c.w,c.h);
    ctx.fillStyle=getCSS('--crate-top');ctx.fillRect(c.x,c.y,c.w,4);
    ctx.strokeStyle=getCSS('--crate-edge');ctx.lineWidth=2;
    ctx.strokeRect(c.x+1,c.y+1,c.w-2,c.h-2);
    ctx.beginPath();ctx.moveTo(c.x+3,c.y+3);ctx.lineTo(c.x+c.w-3,c.y+c.h-3);
    ctx.moveTo(c.x+c.w-3,c.y+3);ctx.lineTo(c.x+3,c.y+c.h-3);ctx.stroke();
    if(c.hp<c.max){ ctx.globalAlpha=(1-c.hp/c.max)*0.5;ctx.fillStyle='#2a1d10';ctx.fillRect(c.x,c.y,c.w,c.h);ctx.globalAlpha=1; }
  }
  // siege hold zone — the fortress to capture + defend (red=contested, green=holding, amber=stand-in-it)
  if(holdRect){
    const held=run.siege&&run.siege.phase==='hold', inz=anyPlayerInHold();
    const col = !held ? '217,72,59' : (inz ? '95,191,106' : '232,178,74');
    ctx.save();
    ctx.fillStyle='rgba('+col+',0.12)'; ctx.fillRect(holdRect.x,holdRect.y,holdRect.w,holdRect.h);
    ctx.setLineDash([6,5]); ctx.lineWidth=2; ctx.strokeStyle='rgba('+col+',0.8)';
    ctx.strokeRect(holdRect.x+1,holdRect.y+1,holdRect.w-2,holdRect.h-2);
    ctx.restore();
  }
  // pickups — drops pulsing on the floor (scrap = bronze nut · heal = green + · upgrade = gold ↑)
  for(const p of pickups){
    const k=Math.min(1,p.life/p.max), a=Math.min(1,k*2), pulse=0.65+0.35*Math.sin(performance.now()/180);
    if(p.kind==='scrap'){
      ctx.save(); ctx.globalAlpha=a*pulse; ctx.translate(p.x,p.y); ctx.rotate(Math.PI/4);
      ctx.fillStyle='#c9a063'; ctx.fillRect(-5,-5,10,10);
      ctx.fillStyle='#8a6a3a'; ctx.fillRect(-5,-5,10,3);
      ctx.restore(); ctx.globalAlpha=1; continue;
    }
    ctx.globalAlpha=a*pulse; ctx.fillStyle=p.kind==='heal'?'#5fbf6a':'#e8c84a';
    ctx.beginPath();ctx.arc(p.x,p.y,8,0,7);ctx.fill();
    ctx.globalAlpha=a; ctx.fillStyle='#1a1916';ctx.font='bold 12px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText(p.kind==='heal'?'+':'↑',p.x,p.y+0.5); ctx.globalAlpha=1;
  }
  // mines
  for(const m of mines){
    const armed=m.arm<=0;
    if(armed){ ctx.globalAlpha=0.10;ctx.fillStyle='#d9483b';
      ctx.beginPath();ctx.arc(m.x,m.y,m.blast,0,7);ctx.fill(); }   // faint blast radius hint
    ctx.globalAlpha = armed ? (0.6+0.4*Math.sin(performance.now()/120)) : 0.45;
    ctx.fillStyle = armed ? '#d9483b' : '#9b7b4a';
    ctx.beginPath();ctx.arc(m.x,m.y, armed?5:4,0,7);ctx.fill();
    ctx.globalAlpha=1;
  }
  // player deployables — sentries / trophy / shields / spider mines
  for(const tu of turrets){
    ctx.save(); ctx.translate(tu.x,tu.y);
    if(tu.kind==='trophy'){
      ctx.globalAlpha=0.09; ctx.fillStyle='#5fd0ff'; ctx.beginPath();ctx.arc(0,0,TROPHY_R,0,7);ctx.fill(); ctx.globalAlpha=1;
      ctx.fillStyle='#3a7d9a'; ctx.beginPath();ctx.arc(0,0,tu.r,0,7);ctx.fill();
      ctx.fillStyle='#bfe9ff'; ctx.beginPath();ctx.arc(0,0,tu.r*0.5,0,7);ctx.fill();
    } else {
      const col = tu.kind==='teal'?'#3ba6a6':'#9aa0a8';
      ctx.fillStyle='#2b2b2b'; ctx.beginPath();ctx.arc(0,0,tu.r,0,7);ctx.fill();
      ctx.rotate(tu.turretAngle); ctx.fillStyle=col; ctx.fillRect(0,-3,tu.r+8,6);
      ctx.beginPath();ctx.arc(0,0,tu.r-2,0,7);ctx.fill();
    }
    ctx.restore();
    if(tu.hp<TURRET_HP){ ctx.fillStyle='#d9483b'; ctx.fillRect(tu.x-tu.r, tu.y-tu.r-6, tu.r*2*(tu.hp/TURRET_HP), 3); }
  }
  for(const sd of shields){
    ctx.save(); ctx.translate(sd.x,sd.y);
    ctx.strokeStyle='rgba(127,223,255,.8)'; ctx.lineWidth=4;
    ctx.beginPath(); ctx.arc(0,0,sd.r, sd.ang-Math.PI/2, sd.ang+Math.PI/2); ctx.stroke();   // front-facing arc
    ctx.strokeStyle='rgba(127,223,255,.22)'; ctx.lineWidth=2;
    ctx.beginPath(); ctx.arc(0,0,sd.r-5, sd.ang-Math.PI/2, sd.ang+Math.PI/2); ctx.stroke();
    ctx.restore();
  }
  for(const m of spiderMines){
    ctx.strokeStyle='#caa46a'; ctx.lineWidth=1.5;
    for(let k=0;k<4;k++){ const a=k*Math.PI/2+performance.now()/200;
      ctx.beginPath();ctx.moveTo(m.x,m.y);ctx.lineTo(m.x+Math.cos(a)*7,m.y+Math.sin(a)*7);ctx.stroke(); }
    ctx.fillStyle=m.arm>0?'#caa46a':'#d9483b'; ctx.beginPath();ctx.arc(m.x,m.y,4,0,7);ctx.fill();
  }
  drawPreview(LP());
  // smoke trails (behind everything that moves)
  for(const s of smoke){
    const k=s.life/s.max;                       // 1 → 0
    ctx.globalAlpha=Math.max(0,k*0.4);
    ctx.fillStyle='#6f6a5c';
    ctx.beginPath();ctx.arc(s.x,s.y,s.r*(1+(1-k)*1.6),0,7);ctx.fill();
  }
  ctx.globalAlpha=1;
  // enemies
  for(const e of enemies){
    if(e.spawning && e.entering) continue;       // siege: waiting off-screen, pours in when the wave goes live
    if(e.spawning){                              // warp-in telegraph during the countdown
      ctx.globalAlpha=0.5; drawTank(e, e.color, darken(e.color,0.6));
      ctx.globalAlpha=0.7; ctx.beginPath();ctx.arc(e.x,e.y,e.r+8,0,7);
      ctx.strokeStyle=e.color;ctx.lineWidth=2;ctx.setLineDash([4,5]);ctx.stroke();ctx.setLineDash([]);
    } else {
      let alpha=1;
      if(e.invisible){                            // White: fade to near-invisible on round start
        const el = e.cloakStart ? performance.now()-e.cloakStart : 9999;
        alpha = el<450 ? 1-(el/450)*0.94 : 0.06;  // 1 → 0.06 over 450ms
        if(performance.now()-(e.lastFire||0) < 150) alpha=Math.max(alpha,0.85); // muzzle flash reveal
      }
      ctx.globalAlpha=alpha;
      drawTank(e, e.color, darken(e.color,0.6));
      if(e.boss){                                  // boss: floating HP bar (8 hp needs feedback)
        const bw=e.r*2.2, bx=e.x-bw/2, by=e.y-e.r-12, f=Math.max(0,e.hp/e.maxHp);
        ctx.fillStyle='rgba(0,0,0,.5)';ctx.fillRect(bx-1,by-1,bw+2,6);
        ctx.fillStyle='#d9483b';ctx.fillRect(bx,by,bw*f,4);
      }
    }
    ctx.globalAlpha = 1;
  }
  // shells (rockets render elongated with a flame; normal shells are dots)
  for(const sh of shells){
    if(sh.rocket){
      ctx.save();ctx.translate(sh.x,sh.y);ctx.rotate(Math.atan2(sh.vy,sh.vx));
      ctx.fillStyle='#e8a23a';                                   // exhaust flame
      ctx.beginPath();ctx.moveTo(-7,-2.5);ctx.lineTo(-14,0);ctx.lineTo(-7,2.5);ctx.closePath();ctx.fill();
      ctx.fillStyle=getCSS('--shell');                           // body
      ctx.fillRect(-7,-3,12,6);
      ctx.beginPath();ctx.moveTo(5,-3);ctx.lineTo(11,0);ctx.lineTo(5,3);ctx.closePath();ctx.fill(); // nose
      ctx.restore();
    } else {
      ctx.beginPath();ctx.arc(sh.x,sh.y,5,0,7);ctx.fillStyle=getCSS('--shell');ctx.fill();
    }
  }
  // laser beams (bright, brief — drawn over shells)
  for(const bm of beams){
    const a=Math.max(0,bm.life/bm.max);
    ctx.save(); ctx.globalAlpha=a; ctx.strokeStyle='#ff5b6b'; ctx.lineWidth=3; ctx.shadowColor='#ff5b6b'; ctx.shadowBlur=8;
    ctx.beginPath(); ctx.moveTo(bm.pts[0].x,bm.pts[0].y);
    for(let k=1;k<bm.pts.length;k++) ctx.lineTo(bm.pts[k].x,bm.pts[k].y);
    ctx.stroke(); ctx.restore();
  }
  ctx.globalAlpha=1;
  // particles
  for(const p of particles){ctx.globalAlpha=Math.max(0,p.life*3);ctx.fillStyle=p.c;
    ctx.beginPath();ctx.arc(p.x,p.y,3,0,7);ctx.fill();ctx.globalAlpha=1;}
  // player tanks (drawn last, on top; a downed player spectates and isn't drawn)
  for(const p of activePlayers()){
    if(playerFlying(p)){ ctx.save();ctx.globalAlpha=0.22;ctx.fillStyle='#000';     // airborne shadow
      ctx.beginPath();ctx.ellipse(p.x,p.y+13,p.r+2,p.r*0.55,0,0,7);ctx.fill();ctx.restore(); }
    ctx.save();
    if(playerCloaked(p)) ctx.globalAlpha=0.3;                                       // stealth: faded
    drawTank(p, p.color, darken(p.color,0.55));
    ctx.restore();
    if(p.charged){ ctx.save();ctx.globalAlpha=0.85;ctx.strokeStyle='#9fd8ff';ctx.lineWidth=2.5;  // vibranium charge halo
      ctx.beginPath();ctx.arc(p.x,p.y,p.r+5+Math.sin(performance.now()/90)*2,0,7);ctx.stroke();ctx.restore(); }
  }
  ctx.restore();
  // sticks — show fixed bases where no thumb is down, then the active sticks
  if(cfg.fixedStick){
    if(!activePointer('move')) drawFixedBase(cfg.moveCx*W,cfg.moveCy*H,getCSS('--tank'));
    if(!activePointer('aim'))  drawFixedBase(cfg.aimCx*W, cfg.aimCy*H, 'rgba(217,72,59,.85)');
  }
  drawStick(activePointer('move'),getCSS('--tank'));
  drawStick(activePointer('aim'),'rgba(217,72,59,.92)');
  // fire button (pubg)
  if(mode==='pubg'){
    const held=activePointer('fire');
    ctx.beginPath();ctx.arc(fireBtn.x,fireBtn.y,fireBtn.r,0,7);
    ctx.fillStyle=held?'rgba(217,72,59,.95)':'rgba(217,72,59,.78)';ctx.fill();
    ctx.strokeStyle='rgba(255,255,255,.8)';ctx.lineWidth=3;ctx.stroke();
    ctx.fillStyle='#fff';ctx.font='600 12px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText('FIRE',fireBtn.x,fireBtn.y);
  }
  // deploy button (left index) — the LOCAL player's gadget; dims on cooldown / no charges
  const lp=LP();
  if(lp && lp.gadget){
    const ready = lp.gadgetCharges>0 && performance.now()>=lp.gadgetCdUntil;
    ctx.beginPath();ctx.arc(deployBtn.x,deployBtn.y,deployBtn.r,0,7);
    ctx.fillStyle=ready?'rgba(95,160,210,.85)':'rgba(95,160,210,.4)';ctx.fill();
    ctx.strokeStyle='rgba(255,255,255,.8)';ctx.lineWidth=3;ctx.stroke();
    ctx.fillStyle='#fff';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.font='700 15px system-ui';ctx.fillText('⚙',deployBtn.x,deployBtn.y-6);
    ctx.font='700 12px system-ui';ctx.fillText(lp.gadgetCharges+'/'+lp.gadgetMaxCharges,deployBtn.x,deployBtn.y+11);
  }
  // wave countdown banner (screen-fixed, drawn outside the shake transform)
  if(gameMode==='roguelike' && run.phase==='intermission'){
    ctx.save();ctx.textAlign='center';ctx.textBaseline='middle';
    if(run.waveKind==='boss'){ ctx.fillStyle='#d9483b';ctx.font='800 17px system-ui';ctx.fillText('⚠  BOSS WAVE  ⚠', W/2, H/2-48); }
    else if(run.waveKind==='elite'){ ctx.fillStyle='#d6a64a';ctx.font='800 17px system-ui';ctx.fillText('★  ELITE WAVE  ★', W/2, H/2-48); }
    ctx.fillStyle=getCSS('--ink');
    ctx.font='800 26px system-ui';ctx.fillText('WAVE '+run.level, W/2, H/2-18);
    ctx.font='800 44px system-ui';ctx.fillText(Math.max(1,Math.ceil(run.timer/1000)), W/2, H/2+24);
    if(run.level>1 && run.lastWaveScrap>0){    // wave-clear celebration: what you salvaged last push
      ctx.fillStyle='#e8c84a';ctx.font='800 16px system-ui';
      ctx.fillText('◆ +'+run.lastWaveScrap+' SCRAP SALVAGED', W/2, H/2+62);
    }
    ctx.restore();
  }
  // siege hold banner: timer (counts only while you're on the point) + a nudge if you've left it
  if(gameMode==='roguelike' && run.siege && run.siege.phase==='hold' && run.phase==='fighting'){
    ctx.save();ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillStyle=getCSS('--ink');ctx.font='800 22px system-ui';
    ctx.fillText('HOLD  '+Math.max(0,Math.ceil(run.siege.timer/1000))+'s', W/2, 38);
    if(!anyPlayerInHold()){ ctx.fillStyle='rgba(217,72,59,.95)';ctx.font='800 15px system-ui';
      ctx.fillText('RETURN TO THE POINT', W/2, 62); }
    ctx.restore();
  }
}
const cssCache={};
function getCSS(v){ if(!cssCache[v]) cssCache[v]=getComputedStyle(document.documentElement).getPropertyValue(v).trim(); return cssCache[v]; }
