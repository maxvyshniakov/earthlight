import {test,afterEach,spyOn,mock,jest} from 'bun:test';
import assert from 'node:assert/strict';
import {SceneWork,scenePriority} from '../src/scripts/scene-work.ts';
import {SceneAssets} from '../src/scripts/scene-assets.ts';

test('optional manifests queued first cannot occupy preview startup connections',async()=>{
 const work=new SceneWork(),releasePreview=work.network.holdBelow(scenePriority.preview);
 const started=[],finish=[];
 const manifests=Array.from({length:4},(_,i)=>work.network.run(scenePriority.tile,undefined,()=>new Promise(resolve=>{started.push(`manifest${i}`);finish.push(resolve);})));
 spyOn(globalThis,'fetch').mockImplementation(async url=>{started.push(url);return new Response('preview');});
 const plan=Array.from({length:6},(_,i)=>({key:'day',url:`preview${i}`,preview:true}));
 const uploaded=[];
 const assets=new SceneAssets(plan,async asset=>{uploaded.push(asset.url);},()=>{if(assets.previewSettled)releasePreview();},work);
 await assets.start();
 await new Promise(setImmediate);
 assert.deepEqual(started.slice(0,6),plan.map(asset=>asset.url));
 assert.equal(uploaded.length,6);assert.equal(assets.failures.length,0);
 assert.equal(started.length,10,'optional work resumes after previews');
 releasePreview(); // Release is idempotent.
 finish.forEach(resolve=>resolve());await Promise.all(manifests);assets.dispose();
});

test('a queued preview receives its full request timeout after dequeue',async()=>{
 jest.useFakeTimers({doNotFake:['setImmediate','nextTick','performance']});
 const work=new SceneWork(),resume=work.network.holdBelow(-1);let requests=0;
 spyOn(globalThis,'fetch').mockImplementation(async(_url,{signal})=>{
  requests++;assert.equal(signal.aborted,false);return new Response('preview');
 });
 const assets=new SceneAssets([{key:'day',url:'preview',preview:true}],async()=>{},()=>{},work);
 const loading=assets.start();
 jest.advanceTimersByTime(6000);await new Promise(setImmediate);
 assert.equal(requests,0);assert.deepEqual(assets.failures,[]);
 resume();await loading;
 assert.equal(requests,1);assert.equal(assets.previewSettled,true);assert.deepEqual(assets.failures,[]);
 assets.dispose();
});

test('disposing a scene cancels held previews before network starts',async()=>{
 const work=new SceneWork(),resume=work.network.holdBelow(-1);
 spyOn(globalThis,'fetch').mockImplementation(async()=>assert.fail('disposed preview fetched'));
 const assets=new SceneAssets([{key:'day',url:'preview',preview:true}],async()=>{},()=>{},work);
 const loading=assets.start();assets.dispose();resume();await loading;
 assert.deepEqual(assets.failures,[]);
});

test('an active stalled preview still times out after five seconds',async()=>{
 jest.useFakeTimers({doNotFake:['setImmediate','nextTick','performance']});
 spyOn(console,'warn').mockImplementation(()=>{});
 spyOn(globalThis,'fetch').mockImplementation(async(_url,{signal})=>new Promise((_resolve,reject)=>{
  signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
 }));
 const assets=new SceneAssets([{key:'day',url:'stalled-preview',preview:true}],async()=>{},()=>{});
 const loading=assets.start();await new Promise(setImmediate);
 jest.advanceTimersByTime(4999);assert.deepEqual(assets.failures,[]);
 jest.advanceTimersByTime(1);await loading;
 assert.deepEqual(assets.failures,['stalled-preview']);assert.equal(assets.previewSettled,true);
 assets.dispose();
});

afterEach(()=>{mock.restore();jest.useRealTimers();});
