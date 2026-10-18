/** A monotonic simulation clock. Rendering samples time but never advances it. */
export class SceneClock {
  private anchor=0;
  private running=false;
  private seconds:number;
  private timeScale:number;
  constructor(seconds:number,timeScale:number){this.seconds=seconds;this.timeScale=timeScale;}
  read(now:number){return this.seconds+(this.running?(now-this.anchor)*this.timeScale/1000:0);}
  setRunning(running:boolean,now:number){
    this.seconds=this.read(now);
    this.anchor=now;
    this.running=running;
  }
  seek(seconds:number,now:number){this.seconds=seconds;this.anchor=now;}
  setTimeScale(timeScale:number,now:number){
    this.seconds=this.read(now);
    this.anchor=now;
    this.timeScale=timeScale;
  }
}
