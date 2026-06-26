"use strict";
// net — HOST networking layer for couch co-op. Loaded only by host.html (after the engine).
// The host is the sole simulator: this module turns controller (phone) messages into engine state —
// each phone is a player in players[], and its input fills that player's `intent`. Discrete fire/deploy
// call the engine directly. See lan/public/shared/protocol.js for message shapes.

const NET = (() => {
  let ws=null;
  const COLORS=['#3b6fb5','#c0584a','#4a9d5b','#d9a441','#8a5cc0','#d97a3b','#3ba6a6','#c05c9a'];
  function pid(id){ for(const p of players) if(p.id===id) return p; return null; }
  const inRun = ()=> started && gameMode==='roguelike';

  // ---- join card + roster UI (injected; no host.html markup needed) ----
  function ui(){
    const s=document.createElement('style');
    s.textContent=`
      #netbar{position:fixed;top:12px;left:12px;z-index:60;display:flex;gap:12px;align-items:center;
        background:rgba(255,255,255,.86);backdrop-filter:blur(4px);border-radius:14px;padding:12px 16px;
        box-shadow:0 4px 16px rgba(0,0,0,.22);font-family:system-ui,sans-serif;color:#2c2a26;}
      #netbar canvas{width:104px;height:104px;border-radius:8px;background:#fff;flex:none;display:none;}
      #netbar h2{font-size:11px;letter-spacing:.08em;text-transform:uppercase;opacity:.55;margin-bottom:3px;}
      #netbar .url{font-size:20px;font-weight:800;}
      #netbar .sub{font-size:11px;opacity:.6;margin-top:2px;}
      #netroster{position:fixed;top:12px;right:12px;z-index:60;display:flex;flex-direction:column;gap:6px;align-items:flex-end;}
      #netroster .pl{display:flex;align-items:center;gap:8px;background:rgba(255,255,255,.86);
        border-radius:999px;padding:5px 12px 5px 8px;font:700 13px system-ui;color:#2c2a26;box-shadow:0 2px 6px rgba(0,0,0,.16);}
      #netroster .sw{width:14px;height:14px;border-radius:4px;}
      #netroster .pl.down{opacity:.45;}
      body.ingame #netbar{opacity:.0;pointer-events:none;transition:opacity .3s;}`;
    document.head.appendChild(s);
    const bar=document.createElement('div'); bar.id='netbar';
    bar.innerHTML=`<canvas id="netqr"></canvas><div><h2>Join on your phone</h2>
      <div class="url" id="neturl">…</div><div class="sub">same Wi-Fi · open in a browser</div></div>`;
    document.body.appendChild(bar);
    const ros=document.createElement('div'); ros.id='netroster'; document.body.appendChild(ros);
  }
  function renderRoster(){
    const ros=document.getElementById('netroster'); if(!ros) return; ros.innerHTML='';
    for(const p of players){
      const d=document.createElement('div'); d.className='pl'+(p.down?' down':'');
      d.innerHTML=`<span class="sw" style="background:${p.color}"></span>${p.name}${p.id==='local'?' ⌨':''}`;
      ros.appendChild(d);
    }
  }
  function renderQR(text){
    if(typeof qrcode!=='function') return;
    const q=qrcode(0,'M'); q.addData(text); q.make();
    const n=q.getModuleCount(), quiet=2, scale=4, size=(n+quiet*2)*scale;
    const c=document.getElementById('netqr'); c.width=size; c.height=size;
    const x=c.getContext('2d'); x.fillStyle='#fff'; x.fillRect(0,0,size,size); x.fillStyle='#1f1d1a';
    for(let r=0;r<n;r++) for(let col=0;col<n;col++) if(q.isDark(r,col)) x.fillRect((col+quiet)*scale,(r+quiet)*scale,scale,scale);
    c.style.display='block';
  }

  // ---- player lifecycle ----
  function join(m){
    if(pid(m.id)) return;
    const color = m.color || COLORS[(players.length)%COLORS.length];
    const p = addPlayer(m.id, color, m.name || ('P'+m.id));
    p.classKey='medium';                                   // default until the phone sends classSelect
    if(inRun()){                                            // mid-run join: set up + spawn, spectate till next wave
      setupPlayerForRun(p, p.classKey);
      resetPlayerToSpawn(p, players.indexOf(p), players.length);
      p.down = (run.phase==='fighting');
    }
    renderRoster();
  }
  function leave(m){ removePlayer(m.id); renderRoster(); }
  function classSelect(m){
    const p=pid(m.id); if(!p) return;
    p.classKey=m.class;
    // safe to (re)apply before the run, or while the player is still spectating (no upgrades yet)
    if(!inRun() || p.down){ if(inRun()){ setupPlayerForRun(p,m.class); resetPlayerToSpawn(p, players.indexOf(p), players.length); p.down=true; } }
    renderRoster();
  }

  function onMessage(m){
    switch(m.type){
      case 'join':   join(m); break;
      case 'leave':  leave(m); break;
      case 'classSelect': classSelect(m); break;
      case 'input': { const p=pid(m.id); if(p){ const it=p.intent; it.mx=m.mx; it.my=m.my; it.aim=m.aim; it.aiming=m.aiming; } break; }
      case 'fire':  { const p=pid(m.id); if(p && !p.down){ p.intent.aim=m.aim; tryFire(p); } break; }
      case 'deploy':{ const p=pid(m.id); if(p && !p.down) deployGadget(p); break; }
      // pick / buy / shopDone → between-wave per-player upgrade & depot flow (deferred to B2 Stage 3).
    }
  }

  function connect(){
    ws=new WebSocket(`ws://${location.host}`);
    ws.onopen=()=>ws.send(JSON.stringify({type:'hello',role:'host'}));
    ws.onclose=()=>setTimeout(connect,1000);
    ws.onmessage=(e)=>{ let m; try{m=JSON.parse(e.data);}catch{return;} onMessage(m); };
  }

  function boot(){
    ui();
    fetch('/api/info').then(r=>r.json()).then(d=>{
      document.getElementById('neturl').textContent=d.ip+':'+d.port;
      renderQR(d.controllerUrl || (location.origin+'/controller'));
    }).catch(()=>{ document.getElementById('neturl').textContent=location.host; renderQR(location.origin+'/controller'); });
    connect();
    renderRoster();
    // keep the roster live (down/respawn state changes during play) without touching the hot loop
    setInterval(renderRoster, 500);
    // fade the join card once a run is underway so it's out of the way
    setInterval(()=>{ document.body.classList.toggle('ingame', !!(started && gameMode)); }, 400);
  }
  return { boot };
})();
window.addEventListener('load', NET.boot);
