/** One submission clock for playback and paused input. Render cost must not
 * restart the interval, and a delayed frame must not queue catch-up draws. */
export class SceneFrameClock {
 private last=0;
 private interactionUntil=0;
 private interactionFPS=60;
 private lastTick=0;
 private ticks:number[]=[];
 private period=0;
 private elapsedRefreshes=0;
 fps:number;
 /** Steady mode renders every k-th display refresh, the largest k that keeps
  * at least the passive rate, and keeps that cadence during gestures. 24 FPS
  * on a 60 Hz display alternates 33/50 ms; 30 FPS there is even. */
 constructor(private passiveFPS=24,private steady=false){this.fps=passiveFPS;}
 interact(now:number,fps=60){this.interactionUntil=now+180;this.interactionFPS=fps;}
 interacting(now:number){return now<this.interactionUntil;}
 reset(now:number){this.last=now;}
 /** Feed every animation-frame timestamp. Steady mode counts refreshes, so
  * timestamp jitter and a slightly wrong period estimate cannot drift. */
 observe(now:number){
  const interval=now-this.lastTick;this.lastTick=now;
  if(interval<=0||interval>250)return;
  this.elapsedRefreshes+=this.period>0?Math.max(1,Math.round(interval/this.period)):1;
  if(interval<4||interval>50)return;
  this.ticks.push(interval);if(this.ticks.length>30)this.ticks.shift();
  if(this.ticks.length<8)return;
  // Between steady renders most refreshes are idle, so the median of recent
  // intervals is the display rate even when GPU backpressure delays every
  // render refresh. It follows a display switching between 60 and 120 Hz
  // within a few dozen frames. Average near it to remove timestamp jitter.
  const median=[...this.ticks].sort((a,b)=>a-b)[this.ticks.length>>1];
  const near=this.ticks.filter(t=>Math.abs(t-median)<median*.2);
  this.period=near.reduce((sum,t)=>sum+t,0)/near.length;
 }
 /** Estimated display refresh interval in milliseconds, or 0 before it is known. */
 get refreshPeriod(){return this.period;}
 private refreshes(){return Math.max(1,Math.floor(1000/(this.passiveFPS*this.period)+.1));}
 due(now:number){
  if(this.steady&&this.period>0){
   const refreshes=this.refreshes();this.fps=1000/(refreshes*this.period);
   if(this.elapsedRefreshes<refreshes)return false;
   // A late frame shifts the phase once; it never queues a catch-up draw.
   this.elapsedRefreshes=0;this.last=now;return true;
  }
  const fps=this.interacting(now)?this.interactionFPS:this.passiveFPS,tolerance=.1,interval=1000/fps;
  if(Math.abs(fps-this.fps)>.01){this.fps=fps;this.last=now-interval;}
  const elapsed=now-this.last;
  // RAF timestamps have sub-millisecond rounding even at exact 60 Hz.
  if(elapsed+tolerance<interval)return false;
  this.last+=Math.max(1,Math.floor((elapsed+tolerance)/interval))*interval;
  return true;
 }
}
