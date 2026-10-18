import {test,afterEach,mock,spyOn} from 'bun:test';
import assert from 'node:assert/strict';
import {DayPyramid,pyramidKey} from '../src/scripts/day-pyramid.ts';
import {daySlot,encodeIndex,encodePack} from '../src/scripts/day-pyramid-pack.ts';
import {SceneWork,scenePriority} from '../src/scripts/scene-work.ts';
import {SceneAssets} from '../src/scripts/scene-assets.ts';
import {SurfaceTiles} from '../src/scripts/surface-tiles.ts';

const tick=()=>new Promise(setImmediate);
const gate=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const mask=new Uint8Array(11),slot=daySlot(3,0,0);mask[slot>>3]|=1<<(slot&7);
const entries=[{id:4253,mask,k:[2,2,3]}],bytes=encodeIndex(entries);
const make=(work,abort,notify=()=>{})=>new DayPyramid('/test/',abort.signal,notify,undefined,undefined,work);

test('one shared connection gives previews priority over the pyramid index and bounds competing metadata',async()=>{
 const work=new SceneWork(()=>{},{network:1}),releasePreview=work.network.holdBelow(scenePriority.preview);
 const abort=new AbortController(),body=gate(),started=[];let notified=0,active=0,peak=0;
 spyOn(globalThis,'fetch').mockImplementation(async url=>{
  started.push(url);peak=Math.max(peak,++active);
  if(url.endsWith('index.bin'))return {ok:true,arrayBuffer:async()=>{await body.promise;active--;return bytes.buffer;}};
  return {ok:true,blob:async()=>{active--;return new Blob(['preview']);}};
 });
 const pyramid=make(work,abort,()=>notified++);
 const overview=work.network.run(scenePriority.overview,undefined,async()=>{started.push('overview');assert.equal(active,0);});
 const assets=new SceneAssets([{key:'day',url:'preview',preview:true}],async()=>{},()=>{if(assets.previewSettled)releasePreview();},work);
 try{
  await assets.start();await tick();
  assert.deepEqual(started,['preview','/test/day-pyramid/index.bin']);
  assert.equal(pyramid.index.size,0);assert.equal(notified,0);
  body.resolve();await overview;await tick();
  assert.deepEqual(started,['preview','/test/day-pyramid/index.bin','overview']);
  assert.equal(peak,1);assert.equal(active,0);assert.equal(notified,1);assert.equal(pyramid.index.size,1);
 }finally{body.resolve();abort.abort();assets.dispose();releasePreview();}
},1000);

test('the day surface routes its index and manifest through the supplied shared budget',async()=>{
 const work=new SceneWork(()=>{},{network:1}),releasePreview=work.network.holdBelow(scenePriority.preview),body=gate(),started=[];
 const gl={TEXTURE0:33984,RGBA:6408,getParameter:()=>8192,createTexture:()=>({}),activeTexture(){},bindTexture(){},texImage2D(){},texParameteri(){},isContextLost:()=>false,deleteTexture(){}};
 spyOn(globalThis,'fetch').mockImplementation(async url=>{
  started.push(url);
  if(url.endsWith('index.bin'))return {ok:true,arrayBuffer:async()=>{await body.promise;return bytes.buffer;}};
  return {ok:true,json:async()=>({version:1,interior:540,gutter:16,columns:160,rows:80,tiles:[4253]})};
 });
 const surface=new SurfaceTiles(gl,false,()=>{},'day',work,'/test/',undefined,true);
 try{
  await tick();assert.deepEqual(started,[],'both optional producers respect the startup preview hold');
  releasePreview();await tick();assert.deepEqual(started,['/test/day-pyramid/index.bin']);
  body.resolve();await tick();assert.deepEqual(started,['/test/day-pyramid/index.bin','/test/day-tiles/manifest.json']);
  await work.network.run(scenePriority.overview,undefined,async()=>{});
 }finally{body.resolve();surface.dispose();releasePreview();}
},1000);

test('an index deferred during motion is cancelled before context cleanup resumes detail',async()=>{
 const work=new SceneWork(()=>{},{network:1}),abort=new AbortController();work.deferDetail();
 const fetch=spyOn(globalThis,'fetch').mockImplementation(()=>assert.fail('cancelled moving index fetched'));
 make(work,abort);await tick();assert.equal(fetch.mock.calls.length,0);
 abort.abort();work.resetMotion();
 await work.network.run(scenePriority.overview,undefined,async()=>{});
 assert.equal(fetch.mock.calls.length,0);
},1000);

test('a queued index is removed on owner disposal and a new owner can use the same one-connection budget',async()=>{
 const work=new SceneWork(()=>{},{network:1}),block=gate(),abort=new AbortController(),freshAbort=new AbortController();
 const blocker=work.network.run(scenePriority.preview,undefined,()=>block.promise);
 const fetch=spyOn(globalThis,'fetch').mockResolvedValue(new Response(bytes));let oldNotified=0,freshNotified=0;
 const old=make(work,abort,()=>oldNotified++);abort.abort();
 const fresh=make(work,freshAbort,()=>freshNotified++);
 try{
  await tick();assert.equal(fetch.mock.calls.length,0);
  block.resolve();await blocker;await tick();
  assert.equal(fetch.mock.calls.length,1);assert.equal(old.index.size,0);assert.equal(oldNotified,0);
  assert.equal(fresh.index.size,1);assert.equal(freshNotified,1);
  await work.network.run(scenePriority.overview,undefined,async()=>{});
 }finally{block.resolve();freshAbort.abort();}
},1000);

test('disposal between index admission and its callback prevents even an aborted fetch',async()=>{
 const work=new SceneWork(()=>{},{network:1}),abort=new AbortController();
 const fetch=spyOn(globalThis,'fetch').mockImplementation(()=>assert.fail('disposed index fetched'));
 make(work,abort);abort.abort();
 await work.network.run(scenePriority.overview,undefined,async()=>{});
 assert.equal(fetch.mock.calls.length,0);
},1000);

test('an in-flight index receives owner cancellation and returns its sole network ticket',async()=>{
 const work=new SceneWork(()=>{},{network:1}),abort=new AbortController();let signal,notified=0;
 spyOn(globalThis,'fetch').mockImplementation((_url,options)=>{
  signal=options.signal;return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
 });
 const pyramid=make(work,abort,()=>notified++);await tick();assert.equal(signal.aborted,false);
 abort.abort();assert.equal(signal.aborted,true);
 await work.network.run(scenePriority.overview,undefined,async()=>{});
 assert.equal(pyramid.index.size,0);assert.equal(notified,0);
},1000);

test('a late index body after context disposal cannot publish into the restored owner',async()=>{
 const work=new SceneWork(()=>{},{network:1}),oldAbort=new AbortController(),freshAbort=new AbortController(),body=gate();
 let oldNotified=0,freshNotified=0;
 const fetch=spyOn(globalThis,'fetch').mockResolvedValueOnce({ok:true,arrayBuffer:()=>body.promise}).mockResolvedValueOnce(new Response(bytes));
 const old=make(work,oldAbort,()=>oldNotified++);await tick();oldAbort.abort();
 const fresh=make(work,freshAbort,()=>freshNotified++);
 try{
  await tick();assert.equal(fetch.mock.calls.length,1,'non-cooperative body still owns the connection until it settles');
  body.resolve(bytes.buffer);await tick();
  assert.equal(old.index.size,0);assert.equal(oldNotified,0);
  assert.equal(fresh.index.size,1);assert.equal(freshNotified,1);assert.equal(fetch.mock.calls.length,2);
  await work.network.run(scenePriority.overview,undefined,async()=>{});
 }finally{body.resolve(bytes.buffer);freshAbort.abort();}
},1000);

test('a deep tile can fetch and reuse a pack while holding the sole network ticket',async()=>{
 const work=new SceneWork(()=>{},{network:1}),abort=new AbortController(),indexReady=gate();
 const pack=encodePack(3,3,744,208,new Map([[0,new Uint8Array([7,8,9])]]));
 const fetch=spyOn(globalThis,'fetch').mockImplementation(async url=>new Response(url.endsWith('index.bin')?bytes:pack));
 const pyramid=make(work,abort,indexReady.resolve);await indexReady.promise;
 try{
  const load=()=>work.network.run(scenePriority.tile,abort.signal,()=>pyramid.load(pyramidKey(3,744,208),abort.signal));
  assert.deepEqual([...new Uint8Array(await (await load()).arrayBuffer())],[7,8,9]);
  await work.network.run(scenePriority.overview,undefined,async()=>{});
  assert.equal((await load()).size,3);assert.equal(fetch.mock.calls.length,2);assert.equal(pyramid.cached,pack.length);
 }finally{abort.abort();}
},1000);

test('scene budgets reject limits that cannot admit work',()=>{
 for(const network of [0,-1,1.5,NaN,Infinity])assert.throws(()=>new SceneWork(()=>{},{network}),/positive integers/);
 assert.throws(()=>new SceneWork(()=>{},{decode:0}),/positive integers/);
});

afterEach(()=>mock.restore());
