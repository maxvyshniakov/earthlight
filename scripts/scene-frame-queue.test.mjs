import {test} from 'bun:test';
import assert from 'node:assert/strict';
import {SceneFrameQueue} from '../src/scripts/scene-frame-queue.ts';
function fixture(){
 let status=1,id=0,flushes=0;const deleted=[];
 const gl={TIMEOUT_EXPIRED:1,WAIT_FAILED:2,SYNC_GPU_COMMANDS_COMPLETE:3,
  fenceSync:()=>({id:++id}),flush:()=>flushes++,deleteSync:s=>deleted.push(s.id),
  clientWaitSync:(_,flags,timeout)=>{assert.equal(flags,0);assert.equal(timeout,0);return status;}};
 return {gl,deleted,status:s=>status=s,flushes:()=>flushes};
}
test('three GPU frames bound a stalled queue without blocking or dropping the latest input',()=>{
 const f=fixture(),q=new SceneFrameQueue(f.gl);
 assert.equal(q.ready(),true);q.submitted();assert.equal(q.ready(),true);q.submitted();assert.equal(q.ready(),true);q.submitted();
 for(let i=0;i<100;i++)assert.equal(q.ready(),false);
 assert.equal(f.flushes(),3);
 f.status(4);assert.equal(q.ready(),true);assert.deepEqual(f.deleted,[1,2,3]);
 q.submitted();q.clear();assert.deepEqual(f.deleted,[1,2,3,4]);
});
test('forced resize draws stay bounded; failed fences and WebGL1 cannot deadlock playback',()=>{
 const f=fixture(),q=new SceneFrameQueue(f.gl);
 for(let i=0;i<5;i++)q.submitted();assert.deepEqual(f.deleted,[1,2]);
 f.status(2);assert.equal(q.ready(),true);assert.deepEqual(f.deleted,[1,2,3,4,5]);
 q.submitted();assert.equal(f.flushes(),5);
 q.clear();f.status(1);q.submitted();assert.equal(f.flushes(),6);
 q.clear();const legacy=new SceneFrameQueue({});legacy.submitted();assert.equal(legacy.ready(),true);legacy.clear();
});

test('browser-delayed fence notification does not reduce a sustainable 24 FPS cadence',async()=>{
 const {SceneFrameClock}=await import('../src/scripts/scene-frame-clock.ts');
 let now=0;const gl={TIMEOUT_EXPIRED:1,WAIT_FAILED:2,SYNC_GPU_COMMANDS_COMPLETE:3,
  // Completion visibility may include compositor/GPU-process buffering. It
  // need not equal shader execution time; this models a bounded 90 ms delay.
  fenceSync:()=>({visibleAt:now+90}),flush(){},deleteSync(){},
  clientWaitSync:f=>now>=f.visibleAt?4:1};
 const queue=new SceneFrameQueue(gl),clock=new SceneFrameClock(24,true);let frames=0;
 for(let i=0;i<1440;i++){
  now+=1000/144;clock.observe(now);
  if(clock.due(now,()=>queue.ready())){queue.submitted();if(i>=144)frames++;}
 }
 assert.equal(frames,216);
 queue.clear();
});
