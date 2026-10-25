/** Bound queued GPU frames without waiting for completion on the main thread.
 * Otherwise a slow GPU can accumulate seconds of obsolete camera poses before
 * the browser finally applies backpressure. WebGL1 retains cadence pacing. */
export class SceneFrameQueue {
 private gl:WebGL2RenderingContext|null;
 private pending:WebGLSync[]=[];
 private failed=false;
 // A third slot tolerates delayed completion notifications in the browser's
 // GPU process without dropping a refresh on an otherwise fast GPU.
 private readonly capacity=3;
 private polls=0;
 private blocked=0;
 private submittedAt:number[]=[];
 private longestCompletion=0;
 constructor(gl:WebGLRenderingContext,private instrument=false){this.gl='fenceSync' in gl?gl as WebGL2RenderingContext:null;}
 ready(){
  const gl=this.gl;if(!gl||this.failed)return true;
  if(this.instrument)this.polls++;
  while(this.pending.length){
   const status=gl.clientWaitSync(this.pending[0],0,0);
   if(status===gl.TIMEOUT_EXPIRED)break;
   if(status===gl.WAIT_FAILED){this.clear();this.failed=true;return true;}
   gl.deleteSync(this.pending.shift()!);
   if(this.instrument)this.longestCompletion=Math.max(this.longestCompletion,performance.now()-this.submittedAt.shift()!);
  }
  if(this.instrument&&this.pending.length>=this.capacity)this.blocked++;
  return this.pending.length<this.capacity;
 }
 submitted(){
  const gl=this.gl;if(!gl||this.failed)return;
  const fence=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);
  if(!fence){this.clear();this.failed=true;return;}
  // Explicit resize/restoration draws may bypass the animated gate. Keep
  // only the newest fences; each covers all preceding commands in order.
  if(this.pending.length===this.capacity){gl.deleteSync(this.pending.shift()!);if(this.instrument)this.submittedAt.shift();}
  this.pending.push(fence);if(this.instrument)this.submittedAt.push(performance.now());gl.flush();
 }
 /** Cumulative counters; completion includes browser notification latency. */
 diagnostics(){return this.instrument?{gpuQueuePolls:String(this.polls),gpuQueueBlocked:String(this.blocked),gpuFenceLongestMs:this.longestCompletion.toFixed(2)}:{};}
 clear(){
  if(this.gl)for(const fence of this.pending)this.gl.deleteSync(fence);
  this.pending=[];this.submittedAt=[];this.failed=false;
 }
}
