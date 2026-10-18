type Job={priority:number;queued:number;signal?:AbortSignal;cancel:()=>void;run:()=>void};
/** One budget for all overview and tile producers. Decode slots include the
 * bitmap's upload lifetime, bounding live decoded inputs as well as CPU work. */
class WorkQueue {
 private jobs:Job[]=[];
 private active=0;
 private limit:number;
 private priorityHolds=new Set<{priority:number}>();
 constructor(limit:number){
  if(!Number.isInteger(limit)||limit<1)throw new RangeError('Scene work limits must be positive integers');
  this.limit=limit;
 }
 /** Reserve startup capacity before optional producers enqueue their manifests. */
 holdBelow(priority:number){
  const hold={priority};this.priorityHolds.add(hold);
  return ()=>{if(this.priorityHolds.delete(hold))this.pump();};
 }
 run<T>(priority:number,signal:AbortSignal|undefined,work:()=>Promise<T>):Promise<T>{
  return new Promise((resolve,reject)=>{
   if(signal?.aborted){reject(signal.reason);return;}
   const job:Job={priority,queued:performance.now(),signal,cancel:()=>{
    this.jobs=this.jobs.filter(x=>x!==job);reject(signal?.reason);
   },run:()=>{
    signal?.removeEventListener('abort',job.cancel);this.active++;
    Promise.resolve().then(work).then(resolve,reject).finally(()=>{this.active--;this.pump();});
   }};
   signal?.addEventListener('abort',job.cancel,{once:true});this.jobs.push(job);this.pump();
  });
 }
 private pump(){
  const now=performance.now();
  // Age queued overviews so continuous tile streaming cannot starve them.
  this.jobs.sort((a,b)=>(a.priority-(now-a.queued)/2000)-(b.priority-(now-b.queued)/2000));
  const allowed=Math.min(Infinity,...[...this.priorityHolds].map(x=>x.priority));
  while(this.active<this.limit&&this.jobs.length){
   const index=this.jobs.findIndex(job=>job.priority<=allowed);
   if(index<0)break;
   this.jobs.splice(index,1)[0].run();
  }
 }
}
export const scenePriority={preview:0,tile:1,overview:2} as const;
export class SceneWork {
 readonly network:WorkQueue;
 readonly decode:WorkQueue;
 private uploads:{priority:number;queued:number;run:()=>void;cancel:()=>void;signal:AbortSignal}[]=[];
 private timer:ReturnType<typeof setTimeout>|undefined;
 private resumeTimer:ReturnType<typeof setTimeout>|undefined;
 private releaseNetwork:(()=>void)|undefined;
 private releaseDecode:(()=>void)|undefined;
 private previousView:{camera:number[];forward:number[];time:number}|undefined;
 constructor(private notify=()=>{},limits:{network?:number;decode?:number}={}){
  this.network=new WorkQueue(limits.network??4);
  this.decode=new WorkQueue(limits.decode??2);
 }
 get moving(){return this.releaseNetwork!==undefined;}
 /** Large atlas writes can serialize with the preceding GPU frame. During
  * fast flight retain resident detail and the complete overview, then resume
  * bounded streaming after the camera slows down. Preview work never waits. */
 observeView(camera:ArrayLike<number>,basis:ArrayLike<number>,now:number){
  const current={camera:Array.from(camera),forward:Array.from(basis).slice(6,9),time:now},previous=this.previousView;
  this.previousView=current;
  if(!previous)return;
  const seconds=(now-previous.time)/1000;
  if(seconds<=0)return;
  const travel=Math.hypot(...current.camera.map((v,i)=>v-previous.camera[i]))/seconds;
  const turn=Math.hypot(...current.forward.map((v,i)=>v-previous.forward[i]))/seconds;
  if(travel<.08&&turn<.2)return;
  this.deferDetail();
 }
 deferDetail(){
  this.releaseNetwork??=this.network.holdBelow(scenePriority.preview);
  this.releaseDecode??=this.decode.holdBelow(scenePriority.preview);
  clearTimeout(this.resumeTimer);
  this.resumeTimer=setTimeout(()=>{
   this.resumeDetail();
   this.notify();
  },500);
 }
 private resumeDetail(){
  clearTimeout(this.resumeTimer);this.resumeTimer=undefined;
  const network=this.releaseNetwork,decode=this.releaseDecode;
  this.releaseNetwork=this.releaseDecode=undefined;
  network?.();decode?.();
  if(this.uploads.length&&this.timer===undefined)this.timer=setTimeout(()=>this.pump(),0);
 }
 /** Owners abort their jobs before releasing a context's motion hold. */
 resetMotion(){this.previousView=undefined;this.resumeDetail();}
 /** Upload callbacks must be synchronous and rebind their own GL state.
  * At most four small uploads / 3 ms of submission per 16 ms opportunity.
  * A single driver call cannot be preempted; large inputs must use strips. */
 upload(priority:number,signal:AbortSignal,work:()=>void):Promise<void>{
  return new Promise((resolve,reject)=>{
   if(signal.aborted){reject(signal.reason);return;}
   const job={priority,queued:performance.now(),signal,cancel:()=>{
    this.uploads=this.uploads.filter(x=>x!==job);reject(signal.reason);
   },run:()=>{signal.removeEventListener('abort',job.cancel);try{work();resolve();}catch(error){reject(error);}}};
   signal.addEventListener('abort',job.cancel,{once:true});this.uploads.push(job);
   if(this.timer===undefined)this.timer=setTimeout(()=>this.pump(),0);
  });
 }
 private pump(){
  this.timer=undefined;
  const start=performance.now();
  this.uploads.sort((a,b)=>(a.priority-(start-a.queued)/2000)-(b.priority-(start-b.queued)/2000));
  let count=0;
  while(this.uploads.length&&count++<4&&performance.now()-start<3){
   const next=this.uploads.findIndex(job=>!this.moving||job.priority===scenePriority.preview);
   if(next<0)break;
   this.uploads.splice(next,1)[0].run();
  }
  if(this.uploads.some(job=>!this.moving||job.priority===scenePriority.preview))this.timer=setTimeout(()=>this.pump(),16);
 }
}
