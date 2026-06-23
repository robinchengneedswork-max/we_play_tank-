"use strict";
// main — canvas sizing, the delta-time game loop, and initial boot.

function resize(){
  DPR=Math.min(window.devicePixelRatio||1,2);
  W=window.innerWidth; H=window.innerHeight;
  cv.width=W*DPR; cv.height=H*DPR;
  cv.style.width=W+'px'; cv.style.height=H+'px';
  ctx.setTransform(DPR,0,0,DPR,0,0);
  fireBtn.x=W-58; fireBtn.y=64; fireBtn.r=40;
  layoutObstacles();
}
window.addEventListener('resize',resize);
window.addEventListener('orientationchange',()=>setTimeout(resize,200));

let last=0;
function loop(t){
  const dt=Math.min((t-last)/1000||0,0.05); last=t;
  if(started){ update(dt); render(); }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

resize();
