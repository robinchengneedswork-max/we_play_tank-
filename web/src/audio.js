"use strict";
// audio — lazy Web Audio SFX. The AudioContext is created on first use (browsers
// block autoplay before a user gesture; the menu tap that starts a mode counts).
// All SFX no-op when cfg.sound is off.

let actx=null;
function ac(){
  if(!actx){ try{ actx=new (window.AudioContext||window.webkitAudioContext)(); }catch(e){ return null; } }
  if(actx.state==='suspended') actx.resume();
  return actx;
}
function tone(type,f0,f1,dur,gain){
  if(!cfg.sound) return; const a=ac(); if(!a) return;
  const t=a.currentTime, o=a.createOscillator(), g=a.createGain();
  o.type=type; o.frequency.setValueAtTime(f0,t);
  if(f1!=null) o.frequency.exponentialRampToValueAtTime(Math.max(1,f1),t+dur);
  g.gain.setValueAtTime(gain,t); g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
  o.connect(g).connect(a.destination); o.start(t); o.stop(t+dur);
}
function noise(dur,gain,freq,type){
  if(!cfg.sound) return; const a=ac(); if(!a) return;
  const t=a.currentTime, n=Math.floor(a.sampleRate*dur);
  const buf=a.createBuffer(1,n,a.sampleRate), d=buf.getChannelData(0);
  for(let i=0;i<n;i++) d[i]=Math.random()*2-1;
  const src=a.createBufferSource(); src.buffer=buf;
  const f=a.createBiquadFilter(); f.type=type||'bandpass'; f.frequency.value=freq||1200;
  const g=a.createGain(); g.gain.setValueAtTime(gain,t); g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
  src.connect(f).connect(g).connect(a.destination); src.start(t); src.stop(t+dur);
}
const SFX={
  electric(){ tone('sawtooth',1100,120,0.34,0.16); noise(0.34,0.10,2600,'bandpass'); },  // White cloaking zap
  mineLay(){ tone('square',440,300,0.07,0.10); },
  mineBoom(){ tone('sawtooth',190,40,0.5,0.22); noise(0.5,0.28,420,'lowpass'); },
};
