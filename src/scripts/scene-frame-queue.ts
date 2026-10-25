/** Bound queued GPU frames without waiting for completion on the main thread.
 * Otherwise a slow GPU can accumulate seconds of obsolete camera poses before
 * the browser finally applies backpressure. WebGL1 retains cadence pacing. */
export class SceneFrameQueue {
 private gl:WebGL2RenderingContext|null;
 private pending:WebGLSync[]=[];
 private failed=false;
 constructor(gl:WebGLRenderingContext){this.gl='fenceSync' in gl?gl as WebGL2RenderingContext:null;}
 ready(){
  const gl=this.gl;if(!gl||this.failed)return true;
  while(this.pending.length){
   const status=gl.clientWaitSync(this.pending[0],0,0);
   if(status===gl.TIMEOUT_EXPIRED)break;
   if(status===gl.WAIT_FAILED){this.clear();this.failed=true;return true;}
   gl.deleteSync(this.pending.shift()!);
  }
  return this.pending.length<2;
 }
 submitted(){
  const gl=this.gl;if(!gl||this.failed)return;
  const fence=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);
  if(!fence){this.clear();this.failed=true;return;}
  // Explicit resize/restoration draws may bypass the animated gate. Keep
  // only the newest fences; each covers all preceding commands in order.
  if(this.pending.length===2)gl.deleteSync(this.pending.shift()!);
  this.pending.push(fence);gl.flush();
 }
 clear(){
  if(this.gl)for(const fence of this.pending)this.gl.deleteSync(fence);
  this.pending=[];this.failed=false;
 }
}
