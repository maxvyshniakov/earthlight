/** Hysteresis over GPU samples, not viewport width. Texture fidelity and the
 * path-dependent cloud integration budget is preserved; only the target scales.
 */
export class SceneQuality {
 scale=1;
 private samples:number[]=[];
 private coolUntil=0;
 private firstGPUWindow=true;
 get warmingUp(){return this.firstGPUWindow;}
 private lastCadence=0;
 private lastAnimationFrame=0;
 private animationIntervals:number[]=[];
 private acquiringCadence=true;
 private materialPending=false;
 private severeStalls:number[]=[];
 // RAF quantization informs the tail only. A slower RAF under GPU load must
 // never relax the mean delivery budget and disguise a real FPS deficit.
 observeAnimationFrame(now:number,cadenceFactor=1){
  if(!Number.isFinite(now)||!Number.isFinite(cadenceFactor)||cadenceFactor<=0)return;
  const interval=(now-this.lastAnimationFrame)*cadenceFactor;
  if(this.lastAnimationFrame&&interval>0&&interval<250){
   this.animationIntervals.push(interval);
   if(this.animationIntervals.length>60)this.animationIntervals.shift();
  }else this.animationIntervals=[];
  this.lastAnimationFrame=now;
 }
 resetCadence(){
  this.samples=[];this.stableSince=null;this.overloadedWindows=0;this.materialPending=false;
  this.lastCadence=0;this.lastAnimationFrame=0;this.animationIntervals=[];this.severeStalls=[];
 }
 private cadenceTailLimit(){
  if(this.animationIntervals.length<6)return 75;
  const sorted=[...this.animationIntervals].sort((a,b)=>a-b);
  const period=sorted[Math.floor(sorted.length*.2)];
  return Math.ceil((1000/24)/period-1e-6)*period+8;
 }
 private stableSince:number|null=null;
 private probeFrom:number|null=null;
 private probeAfter=0;
 private retryDelay=15000;
 private overloadedWindows=0;
 // A capped 24 FPS stream cannot prove spare GPU capacity. Try a small upscale
 // after sustained delivery, then roll it back if the new size misses deadlines.
 observeCadence(milliseconds:number,now:number){
  if(!Number.isFinite(milliseconds)||milliseconds<=0||milliseconds>5000||!Number.isFinite(now)){
   this.samples=[];this.stableSince=null;this.overloadedWindows=0;this.materialPending=false;this.severeStalls=[];return false;
  }
  if(this.lastCadence&&now-this.lastCadence>2000){this.samples=[];this.stableSince=null;this.overloadedWindows=0;this.materialPending=false;this.severeStalls=[];}
  this.lastCadence=now;
  if(!this.acquiringCadence){
   this.severeStalls=milliseconds>120?[...this.severeStalls,milliseconds].slice(-6):[];
  }
  // Do not lose sustained emergency evidence while a resize is settling.
  const prolonged=this.severeStalls.length===6&&this.severeStalls.reduce((sum,ms)=>sum+ms,0)>=2400-1e-6;
  if(now<this.coolUntil&&!prolonged)return false;
  this.samples.push(milliseconds);
  const recent=prolonged?this.severeStalls:this.samples.slice(-6);
  // Established quality also gives short, size-independent upload bursts a
  // bounded first step. Six 400 ms frames still justify emergency recovery;
  // startup retains its original six-stall response.
  const severe=recent.length===6&&recent.every(ms=>ms>120)
   &&(this.acquiringCadence||recent.reduce((sum,ms)=>sum+ms,0)>=2400-1e-6);
  // A material load change must not spend two slow windows and five seconds
  // at each obsolete size. GPU backpressure can bunch a long callback with
  // a short one, so require a mean deficit rather than every frame being slow.
  // Excluding the largest of eight samples protects an isolated upload stall.
  const materialWindow=this.samples.slice(-8).sort((a,b)=>a-b);
  const materialMean=materialWindow.slice(0,-1).reduce((sum,ms)=>sum+ms,0)/7;
  const material=!severe&&!this.acquiringCadence&&materialWindow.length===8&&materialMean>62.5;
  if(this.samples.length<(this.acquiringCadence?12:24)&&!severe&&!material)return false;
  const window=severe?recent:material?this.samples.slice(-8):this.samples;
  if(severe)this.severeStalls=[];
  const sorted=window.sort((a,b)=>a-b),interval=sorted[Math.floor(sorted.length*.9)];
  // Startup has only twelve samples and no second confirming window. Drop
  // one outlier there so a single asset/upload stall does not blur the scene.
  const delivery=this.acquiringCadence&&!severe?sorted.slice(0,-1):sorted;
  const mean=delivery.reduce((sum,ms)=>sum+ms,0)/delivery.length;
  this.samples=[];
  // At 30 Hz, healthy 24 FPS includes 67 ms intervals. The tail alone is
  // not overload evidence. A steady 50 ms cadence is still only 20 FPS,
  // regardless of whether slow RAF callbacks look like a 20 Hz display.
  if(mean>46){
   this.stableSince=null;
   this.overloadedWindows++;
   if(!severe&&!material&&!this.acquiringCadence&&this.probeFrom===null&&this.overloadedWindows<2)return false;
   this.overloadedWindows=0;
   const previous=this.scale;
   if(this.probeFrom!==null){
    this.scale=severe?Math.max(.45,this.probeFrom*Math.sqrt(45/interval)):this.probeFrom;
    this.probeFrom=null;this.probeAfter=now+this.retryDelay;
    this.retryDelay=Math.min(60000,this.retryDelay*2);
    this.materialPending=material;
   }else if(this.acquiringCadence){
    // Find a working size promptly after the first sharp animated frames.
    // Limit each normal reduction to 30%; emergency stalls may reach the floor.
    const factor=severe?Math.sqrt(45/interval):Math.max(.7,Math.min(.95,Math.sqrt((1000/24)/mean)*.95));
    this.scale=Math.max(.45,this.scale*factor);
   }else if(material){
    // The first response is only one quality step: a short upload burst must
    // not produce a large blur that takes a minute of upward probes to undo.
    // Escalate only when material overload survives the settling interval.
    if(!this.materialPending)this.scale=Math.max(.45,this.scale-.1);
    else {
     // Leave room for the next refresh boundary, including 30 Hz. This fixed
     // budget cannot be inflated by callback delays caused by GPU work.
     const factor=Math.max(.55,Math.min(.9,Math.sqrt((1000/30)/mean)*.98));
     this.scale=Math.max(.45,this.scale*factor);
    }
    this.materialPending=true;
   }else this.scale=severe?Math.max(.45,this.scale*Math.sqrt(45/interval)):Math.max(.45,this.scale-.1);
   // A short settling interval also limits a two-second upload burst to one
   // material reduction. Upward probes retain their independent slow policy.
   this.coolUntil=now+(this.acquiringCadence?300:1500);
   return Math.abs(previous-this.scale)>.001;
  }
  this.overloadedWindows=0;this.materialPending=false;
  // Borderline delivery is not evidence for another step up. Isolated stalls
  // do not lower the scale, but also do not count toward stable recovery.
  if(interval>this.cadenceTailLimit()){this.stableSince=null;return false;}
  this.stableSince??=now;
  if(this.acquiringCadence){
   if(now-this.stableSince<3000)return false;
   this.acquiringCadence=false;
  }
  if(this.probeFrom!==null){
   if(now-this.stableSince>=3000){this.probeFrom=null;this.retryDelay=15000;this.stableSince=now;}
   return false;
  }
  if(this.scale>=1||now<this.probeAfter||now-this.stableSince<8000)return false;
  this.probeFrom=this.scale;
  this.scale=Math.min(1,Math.round((this.scale+.05)*10000)/10000);
  this.stableSince=null;
  this.coolUntil=now+300; // Let the resize finish before judging its cadence.
  return true;
 }
 observe(milliseconds:number,now:number){
  if(!Number.isFinite(milliseconds)||milliseconds<=0||milliseconds>5000||now<this.coolUntil)return false;
  this.samples.push(milliseconds);
  if(this.samples.length<(this.firstGPUWindow?6:12))return false;
  this.firstGPUWindow=false;
  const sorted=this.samples.sort((a,b)=>a-b),cost=sorted[Math.floor(sorted.length*.7)];
  this.samples=[];
  const next=cost>80?Math.max(.45,this.scale*Math.sqrt(30/cost)):cost>34?Math.max(.45,this.scale-.1):cost<17?Math.min(1,this.scale+.05):this.scale;
  if(Math.abs(next-this.scale)<.001)return false;
  this.scale=next;this.coolUntil=now+(cost>80?1500:cost>34?5000:15000);return true;
 }
}

// WebGL 1 timer extension has no DOM TS declaration. Queries are asynchronous,
// sparse and bounded. Never wait for GPU completion on the main thread.
type TimerExtension={TIME_ELAPSED_EXT:number;GPU_DISJOINT_EXT:number;QUERY_RESULT_AVAILABLE_EXT:number;QUERY_RESULT_EXT:number;
 createQueryEXT():object;beginQueryEXT(target:number,query:object):void;endQueryEXT(target:number):void;
 getQueryObjectEXT(query:object,name:number):number|boolean;deleteQueryEXT(query:object):void};
export class SceneTimer {
 readonly quality=new SceneQuality();
 private ext:TimerExtension|null;
 private active:object|null=null;
 private pending:object[]=[];
 private frame=0;
 private gl:WebGLRenderingContext;
 constructor(gl:WebGLRenderingContext){
  this.gl=gl;
  if('createQuery' in gl){
   const core=gl as WebGL2RenderingContext,ext=gl.getExtension('EXT_disjoint_timer_query_webgl2');
   this.ext=ext?{
    TIME_ELAPSED_EXT:ext.TIME_ELAPSED_EXT,GPU_DISJOINT_EXT:ext.GPU_DISJOINT_EXT,
    QUERY_RESULT_AVAILABLE_EXT:core.QUERY_RESULT_AVAILABLE,QUERY_RESULT_EXT:core.QUERY_RESULT,
    createQueryEXT:()=>core.createQuery()!,
    beginQueryEXT:(target,query)=>core.beginQuery(target,query),endQueryEXT:target=>core.endQuery(target),
    getQueryObjectEXT:(query,name)=>core.getQueryParameter(query,name),deleteQueryEXT:query=>core.deleteQuery(query),
   }:null;
  }else this.ext=gl.getExtension('EXT_disjoint_timer_query');
 }
 observeAnimationFrame(now:number,cadenceFactor=1){if(!this.ext)this.quality.observeAnimationFrame(now,cadenceFactor);}
 resetCadence(){if(!this.ext)this.quality.resetCadence();}
 observeCadence(milliseconds:number,now:number){if(!this.ext)this.quality.observeCadence(milliseconds,now);}
 begin(){
  if(!this.ext)return;
  const ext=this.ext;
  if(this.gl.getParameter(ext.GPU_DISJOINT_EXT)){for(const q of this.pending)ext.deleteQueryEXT(q);this.pending=[];return;}
  this.pending=this.pending.filter(q=>{
   if(!ext.getQueryObjectEXT(q,ext.QUERY_RESULT_AVAILABLE_EXT))return true;
   this.quality.observe(Number(ext.getQueryObjectEXT(q,ext.QUERY_RESULT_EXT))/1e6,performance.now());ext.deleteQueryEXT(q);return false;
  });
  // Poll completed queries every frame. Waiting twelve slow frames before
  // polling delayed adaptation by tens of seconds on overloaded phones.
  if(this.frame++%(this.quality.warmingUp||this.quality.scale<1?3:12)!==0)return;
  if(this.pending.length>=2)return;
  this.active=ext.createQueryEXT();ext.beginQueryEXT(ext.TIME_ELAPSED_EXT,this.active);
 }
 end(){if(this.ext&&this.active){this.ext.endQueryEXT(this.ext.TIME_ELAPSED_EXT);this.pending.push(this.active);this.active=null;}}
 dispose(){if(!this.ext)return;if(this.active){this.ext.endQueryEXT(this.ext.TIME_ELAPSED_EXT);this.pending.push(this.active);}for(const q of this.pending)this.ext.deleteQueryEXT(q);this.pending=[];this.active=null;}
}
