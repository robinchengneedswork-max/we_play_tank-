"use strict";
// state — world data + layout setup. No rendering, no input.

const tank={x:0,y:0,r:17,bodyAngle:0,turretAngle:-Math.PI/2,vx:0,vy:0};
let obstacles=[];
let targets=[];
let shells=[];
let particles=[];
let lastFire=0;
let score=0;
let shake=0;

function layoutObstacles(){
  // proportional blocks for bank-shot practice
  obstacles=[
    {x:W*0.30,y:H*0.28,w:W*0.10,h:H*0.20},
    {x:W*0.60,y:H*0.52,w:W*0.12,h:H*0.18},
    {x:W*0.46,y:H*0.12,w:W*0.08,h:H*0.14},
  ];
  if(!tank.x){ tank.x=W*0.16; tank.y=H*0.6; }
  if(targets.length===0){
    for(let i=0;i<3;i++) targets.push({x:0,y:0,r:15,t:0});
    targets.forEach(placeTarget);
  }
}
function placeTarget(tg){
  for(let tries=0;tries<60;tries++){
    const x=FRAME+30+Math.random()*(W-2*FRAME-60);
    const y=FRAME+30+Math.random()*(H-2*FRAME-60);
    if(Math.hypot(x-tank.x,y-tank.y)<160) continue;
    if(obstacles.some(o=>x>o.x-20&&x<o.x+o.w+20&&y>o.y-20&&y<o.y+o.h+20)) continue;
    tg.x=x; tg.y=y; tg.t=0; return;
  }
  tg.x=W/2; tg.y=H/2;
}
