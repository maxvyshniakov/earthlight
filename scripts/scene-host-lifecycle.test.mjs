import {test} from 'bun:test';
import assert from 'node:assert/strict';
import {SceneHostLifecycle} from '../src/scripts/scene-host-lifecycle.ts';
import {SceneFrameClock} from '../src/scripts/scene-frame-clock.ts';
import {SceneClock} from '../src/scripts/scene-clock.ts';

function display(){
  let id=0,hidden=false;
  const pending=new Map();
  return {
    environment:{request:callback=>{pending.set(++id,callback);return id;},cancel:handle=>pending.delete(handle),hidden:()=>hidden},
    get pending(){return pending.size;},
    hide(value){hidden=value;},
    frame(now){const callbacks=[...pending.values()];pending.clear();callbacks.forEach(callback=>callback(now));},
  };
}
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};

test('reentrant first-light and resize resyncs leave one animation chain',()=>{
  const screen=display();let frames=0;
  const runtime=new SceneHostLifecycle({running:()=>true,frame:()=>{frames++;runtime.stop();runtime.animate();}},screen.environment);
  runtime.animate();runtime.animate();assert.equal(screen.pending,1);
  screen.frame(16);assert.equal(frames,1);assert.equal(screen.pending,1);
  screen.frame(32);assert.equal(frames,2);assert.equal(screen.pending,1);
  runtime.dispose();assert.equal(screen.pending,0);
});
test('paused invalidations coalesce and obey the existing submission clock',()=>{
  const screen=display(),clock=new SceneFrameClock(24);let draws=0,running=false;
  clock.reset(0);
  const runtime=new SceneHostLifecycle({running:()=>running,drawing:()=>!running,frame:()=>{},draw:now=>{
    clock.observe(now);if(!clock.due(now))return false;draws++;
  }},screen.environment);
  runtime.invalidate();runtime.invalidate();assert.equal(screen.pending,1);
  screen.frame(16);screen.frame(32);assert.equal(draws,0);assert.equal(screen.pending,1);
  screen.frame(48);assert.equal(draws,1);assert.equal(screen.pending,0);
  running=true;runtime.invalidate();assert.equal(screen.pending,0);
  runtime.dispose();
});
test('visibility suspension never draws or catches up hidden playback',()=>{
  const screen=display(),clock=new SceneClock(100,10);let now=0,frames=0;
  const runtime=new SceneHostLifecycle({running:()=>true,frame:()=>frames++},screen.environment);
  const sync=()=>{runtime.stop();clock.setRunning(!screen.environment.hidden(),now);runtime.animate();};
  sync();screen.frame(16);now=1000;screen.hide(true);sync();
  assert.equal(clock.read(1000),110);assert.equal(screen.pending,0);
  runtime.animate();runtime.invalidate();screen.frame(9000);assert.equal(frames,1);
  now=10000;screen.hide(false);sync();assert.equal(clock.read(now),110);
  screen.frame(10016);assert.equal(frames,2);assert.equal(clock.read(11000),120);
  runtime.dispose();
});
test('host policies independently suspend offscreen and reduced-motion backgrounds',()=>{
  const screen=display();let visible=false,reduced=false,frames=0;
  const runtime=new SceneHostLifecycle({running:()=>visible&&!reduced,frame:()=>frames++},screen.environment);
  runtime.animate();assert.equal(screen.pending,0);
  visible=true;runtime.animate();screen.frame(16);assert.equal(frames,1);
  reduced=true;runtime.stop();runtime.animate();assert.equal(screen.pending,0);
  reduced=false;runtime.animate();visible=false;screen.frame(32);assert.equal(frames,1);assert.equal(screen.pending,0);
  runtime.dispose();
});
test('context loss cancels both paths and stale restore completion cannot resume them',async()=>{
  const screen=display();let settled=0;
  const runtime=new SceneHostLifecycle({running:()=>true,drawing:()=>true,frame:()=>{},draw:()=>{}},screen.environment);
  runtime.animate();runtime.invalidate();assert.equal(screen.pending,2);
  runtime.loseContext();assert.equal(screen.pending,0);assert.equal(runtime.lost,true);
  const old=deferred(),first=runtime.restoreContext(()=>old.promise,()=>settled++);
  runtime.loseContext();old.resolve(true);await first;assert.equal(settled,0);assert.equal(runtime.lost,true);
  await runtime.restoreContext(async()=>false,()=>settled++);assert.equal(runtime.lost,true);assert.equal(settled,1);
  await runtime.restoreContext(async()=>true,()=>{settled++;runtime.animate();});assert.equal(runtime.lost,false);assert.equal(screen.pending,1);
  runtime.dispose();
});
test('disposal invalidates async restore and a frame cannot restart its disposed host',async()=>{
  const screen=display(),pending=deferred();let settled=false;
  const runtime=new SceneHostLifecycle({running:()=>true,frame:()=>runtime.dispose()},screen.environment);
  runtime.animate();screen.frame(16);assert.equal(screen.pending,0);runtime.animate();assert.equal(screen.pending,0);
  const another=new SceneHostLifecycle({running:()=>true,frame:()=>{}},screen.environment);
  another.loseContext();const restore=another.restoreContext(()=>pending.promise,()=>settled=true);
  another.dispose();pending.resolve(true);await restore;assert.equal(settled,false);assert.equal(screen.pending,0);
});
test('browser binding owns only visibility, resize and context listeners and releases them',async()=>{
  const previous=globalThis.ResizeObserver,observed=[];let resize,disconnected=0;
  globalThis.ResizeObserver=class {
    constructor(callback){resize=callback;}
    observe(target){observed.push(target);}
    disconnect(){disconnected++;}
    unobserve(){}
  };
  try{
    const screen=display(),doc=new EventTarget(),canvas=new EventTarget(),targets=[canvas,{}];
    let syncs=0,resizes=0,losses=0,restores=0;
    const runtime=new SceneHostLifecycle({running:()=>true,frame:()=>{}},screen.environment);
    runtime.connect({canvas,document:doc,resizeTargets:targets,resize:()=>resizes++,sync:()=>syncs++,contextLost:()=>losses++,contextRestored:async()=>true,restored:()=>restores++});
    assert.deepEqual(observed,targets);resize();assert.equal(resizes,1);
    runtime.animate();doc.dispatchEvent(new Event('visibilitychange'));assert.equal(screen.pending,0);assert.equal(syncs,1);
    const lost=new Event('webglcontextlost',{cancelable:true});canvas.dispatchEvent(lost);assert.equal(lost.defaultPrevented,true);assert.equal(losses,1);
    canvas.dispatchEvent(new Event('webglcontextrestored'));await Promise.resolve();assert.equal(restores,1);
    runtime.dispose();assert.equal(disconnected,1);
    doc.dispatchEvent(new Event('visibilitychange'));canvas.dispatchEvent(new Event('webglcontextlost'));resize();
    assert.equal(syncs,1);assert.equal(losses,1);assert.equal(resizes,1);
  }finally{globalThis.ResizeObserver=previous;}
});
