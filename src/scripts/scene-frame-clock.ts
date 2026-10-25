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
 // Gestures may render faster on whole refreshes too. Late frames slow the
 // gesture cadence one refresh at a time; a long clean run tries faster again.
 private slower=0;
 private lateRenders:boolean[]=[];
 private cleanRenders=0;
 private cleanNeeded=240;
 private probing=false;
 private fastBefore=false;
 private slowedAt=-Infinity;
 private cadenceStep=0;
 /** True only when due() changes the scheduled spacing, not its estimated FPS. */
 cadenceChanged=false;
 fps:number;
 /** Steady mode renders every k-th display refresh, the largest k that keeps
  * at least the passive rate. 24 FPS on a 60 Hz display alternates 33/50 ms;
  * 30 FPS there is even. A gesture asking for more renders up to that rate,
  * as fast as the device keeps every frame on time. */
 constructor(private passiveFPS=24,private steady=false){this.fps=passiveFPS;}
 interact(now:number,fps=60){
  // A new gesture tries the fast cadence again unless the last one was
  // slowed recently. Loading or a busy moment must not cost every later swipe.
  if(now>this.interactionUntil+1000&&now-this.slowedAt>20000){this.slower=0;this.cleanNeeded=240;this.probing=false;this.lateRenders=[];this.cleanRenders=0;}
  this.interactionUntil=now+180;this.interactionFPS=fps;
 }
 private judge(late:boolean,canSlow:boolean,now:number){
  this.lateRenders.push(late);if(this.lateRenders.length>24)this.lateRenders.shift();
  if(canSlow&&this.lateRenders.filter(Boolean).length>=3){
   // A failed attempt at the faster rate waits twice as long before the next.
   if(this.probing)this.cleanNeeded=Math.min(1920,this.cleanNeeded*2);
   this.slower++;this.slowedAt=now;this.probing=false;this.lateRenders=[];this.cleanRenders=0;return;
  }
  this.cleanRenders=late?0:this.cleanRenders+1;
  if(this.probing&&this.cleanRenders>=240){this.probing=false;this.cleanNeeded=240;}
  if(this.slower>0&&!this.probing&&this.cleanRenders>=this.cleanNeeded){this.slower--;this.probing=true;this.cleanRenders=0;this.lateRenders=[];}
 }
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
  // Missed refreshes may dominate under GPU backpressure. Estimate from
  // the faster fifth, not the median, while genuine short intervals remain.
  // A sustained display-rate change replaces the 30-sample window entirely.
  const sorted=[...this.ticks].sort((a,b)=>a-b),baseline=sorted[Math.floor((sorted.length-1)*.2)];
  const near=this.ticks.filter(t=>Math.abs(t-baseline)<baseline*.2);
  this.period=near.reduce((sum,t)=>sum+t,0)/near.length;
 }
 /** Estimated display refresh interval in milliseconds, or 0 before it is known. */
 get refreshPeriod(){return this.period;}
 private refreshes(fps:number){return Math.max(1,Math.floor(1000/(fps*this.period)+.1));}
 /** The steady rate without a gesture, in frames per second. */
 get passiveRate(){return this.steady&&this.period>0?1000/(this.refreshes(this.passiveFPS)*this.period):this.passiveFPS;}
 private schedule(step:number){
  this.cadenceChanged=step!==this.cadenceStep;this.cadenceStep=step;
 }
 due(now:number){
  if(this.steady&&this.period>0){
   const passive=this.refreshes(this.passiveFPS);
   const fast=this.interacting(now)&&this.interactionFPS>this.passiveFPS;
   const refreshes=fast?Math.min(passive,this.refreshes(this.interactionFPS)+this.slower):passive;
   this.schedule(refreshes);
   this.fps=1000/(refreshes*this.period);
   if(this.elapsedRefreshes<refreshes)return false;
   // The first fast frame follows a slower one; only later ones can be late.
   // Missing one or two refreshes is overload; a longer stall happens
   // elsewhere and says nothing about the cadence.
   if(fast&&this.fastBefore&&this.elapsedRefreshes<=refreshes+2)this.judge(this.elapsedRefreshes>refreshes,refreshes<passive,now);
   this.fastBefore=fast;
   // A late frame shifts the phase once; it never queues a catch-up draw.
   this.elapsedRefreshes=0;this.last=now;return true;
  }
  const fps=this.interacting(now)?this.interactionFPS:this.passiveFPS,tolerance=.1,interval=1000/fps;
  this.schedule(-fps);
  if(Math.abs(fps-this.fps)>.01){this.fps=fps;this.last=now-interval;}
  const elapsed=now-this.last;
  // RAF timestamps have sub-millisecond rounding even at exact 60 Hz.
  if(elapsed+tolerance<interval)return false;
  this.last+=Math.max(1,Math.floor((elapsed+tolerance)/interval))*interval;
  return true;
 }
}
