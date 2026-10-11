/** One submission clock for playback and paused input. Render cost must not
 * restart the interval, and a delayed frame must not queue catch-up draws. */
export class SceneFrameClock {
 private last=0;
 private interactionUntil=0;
 private interactionFPS=60;
 fps:number;
 constructor(private passiveFPS=24){this.fps=passiveFPS;}
 interact(now:number,fps=60){this.interactionUntil=now+180;this.interactionFPS=fps;}
 interacting(now:number){return now<this.interactionUntil;}
 reset(now:number){this.last=now;}
 due(now:number){
  const fps=this.interacting(now)?this.interactionFPS:this.passiveFPS,interval=1000/fps;
  if(fps!==this.fps){this.fps=fps;this.last=now-interval;}
  const elapsed=now-this.last;
  // RAF timestamps have sub-millisecond rounding even at exact 60 Hz.
  if(elapsed+.1<interval)return false;
  this.last+=Math.max(1,Math.floor((elapsed+.1)/interval))*interval;
  return true;
 }
}
