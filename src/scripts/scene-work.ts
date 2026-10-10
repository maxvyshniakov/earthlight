type Job={priority:number;queued:number;signal?:AbortSignal;cancel:()=>void;run:()=>void};
/** One budget for all overview and tile producers. Decode slots include the
 * bitmap's upload lifetime, bounding live decoded inputs as well as CPU work. */
class WorkQueue {
 private jobs:Job[]=[];
 private active=0;
 private limit:number;
 private priorityHolds=new Set<{priority:number}>();
 constructor(limit:number){this.limit=limit;}
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
 readonly network=new WorkQueue(4);
 readonly decode=new WorkQueue(2);
 private uploads:{priority:number;queued:number;run:()=>void;cancel:()=>void;signal:AbortSignal}[]=[];
 private timer:ReturnType<typeof setTimeout>|undefined;
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
  while(this.uploads.length&&count++<4&&performance.now()-start<3)this.uploads.shift()!.run();
  if(this.uploads.length)this.timer=setTimeout(()=>this.pump(),16);
 }
}
