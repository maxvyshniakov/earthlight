type Job={buffer:ArrayBuffer;parent:number;signal:AbortSignal;resolve:(patches:Uint8Array[])=>void;reject:(error:Error)=>void;cancel:()=>void};
type Slot={worker:Worker;job:Job|null};
/** A cancelled decode loses its worker; late results can never reach a new job.
 * Idle workers retain their module, with at most two live workers per input format. */
export class TerrainDecoder {
 private slots:Slot[]=[];
 private queue:Job[]=[];
 private disposed=false;
 created=0;completed=0;milliseconds=0;
 constructor(private mode:'single'|'pool'='single',private format:'tiff'|'packed'='tiff'){}
 run(buffer:ArrayBuffer,parent:number,signal:AbortSignal){
  return new Promise<Uint8Array[]>((resolve,reject)=>{
   if(this.disposed||signal.aborted){reject(Error('Terrain decode cancelled'));return;}
   const job:Job={buffer,parent,signal,resolve,reject,cancel:()=>{
    this.queue=this.queue.filter(value=>value!==job);
    const slot=this.slots.find(value=>value.job===job);
    if(slot)this.remove(slot);
    signal.removeEventListener('abort',job.cancel);reject(Error('Terrain decode cancelled'));this.pump();
   }};
   signal.addEventListener('abort',job.cancel,{once:true});this.queue.push(job);this.pump();
  });
 }
 private remove(slot:Slot){slot.job=null;slot.worker.terminate();slot.worker.onmessage=null;slot.worker.onerror=null;this.slots=this.slots.filter(value=>value!==slot);}
 private pump(){
  while(!this.disposed&&this.queue.length){
   let slot=this.slots.find(value=>!value.job);
   if(!slot){
    if(this.slots.length>=2)return;
    try{
     const worker=this.format==='packed'?new Worker(new URL('./terrain-packed.worker.ts',import.meta.url),{type:'module'}):new Worker(new URL('./terrain-detail.worker.ts',import.meta.url),{type:'module'});
     slot={worker,job:null};this.slots.push(slot);this.created++;
    }catch(error){const job=this.queue.shift()!;job.signal.removeEventListener('abort',job.cancel);job.reject(error instanceof Error?error:Error(String(error)));continue;}
   }
   const active=slot,job=this.queue.shift()!,start=performance.now();active.job=job;
   const finish=(error?:Error,patches?:Uint8Array[])=>{
    if(active.job!==job||this.disposed)return;
    job.signal.removeEventListener('abort',job.cancel);active.job=null;
    this.milliseconds+=performance.now()-start;
    if(error||this.mode==='single')this.remove(active);
    else{active.worker.onmessage=null;active.worker.onerror=null;}
    if(error)job.reject(error);else{this.completed++;job.resolve(patches!);}
    this.pump();
   };
   active.worker.onmessage=event=>finish(event.data.error?Error(event.data.error):undefined,event.data.patches);
   active.worker.onerror=event=>finish(Error(event.message));
   try{active.worker.postMessage({buffer:job.buffer,parent:job.parent},[job.buffer]);}catch(error){finish(error instanceof Error?error:Error(String(error)));}
  }
 }
 get live(){return this.slots.length;}
 dispose(){
  this.disposed=true;
  for(const job of [...this.queue,...this.slots.flatMap(slot=>slot.job?[slot.job]:[])]){job.signal.removeEventListener('abort',job.cancel);job.reject(Error('Terrain decode cancelled'));}
  this.queue=[];for(const slot of [...this.slots])this.remove(slot);
 }
}
