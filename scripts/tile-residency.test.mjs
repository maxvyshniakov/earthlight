import {test} from 'bun:test';
import assert from 'node:assert/strict';
import {AtlasResidency,TileRequests} from '../src/scripts/tile-residency.ts';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};

test('pending atlas uploads keep their slot across view changes until their owner settles',async()=>{
  const atlas=new AtlasResidency(1,6),first=atlas.reserve('old',[],0,{}),resident=atlas.reserve('resident',[],1,{});
  atlas.complete('resident',resident,1);
  const upload=deferred(),writes=[];
  const oldJob=(async()=>{await upload.promise;writes.push(first.slot);atlas.release('old',first);})();
  // A view change makes old unwanted but cannot reuse its still-writable slot.
  const next=atlas.reserve('new',['new'],2,{});
  assert.equal(next.slot,resident.slot);
  assert.notEqual(next.slot,first.slot);
  assert.equal(atlas.reserve('another',['new','another'],3,{}),null);
  upload.resolve();await oldJob;
  const replacement=atlas.reserve('old',['new','old'],4,{});
  assert.equal(replacement.slot,first.slot);
  atlas.release('old',first);
  assert.equal(atlas.entries.get('old'),replacement,'late cleanup cannot remove a newer reservation');
  assert.equal(atlas.complete('old',first,5),false,'late completion cannot publish a newer slot');
  assert.deepEqual(writes,[first.slot]);
});

test('paired slots exclude table cells and evict the least recently used completed tile',()=>{
  const atlas=new AtlasResidency(6,36);
  for(let i=0;i<15;i++){const entry=atlas.reserve(i,[],i,{});assert.equal(entry.slot,6+i*2);atlas.complete(i,entry,i);}
  atlas.touch([0],100);
  const replacement=atlas.reserve(15,[0],101,{});
  assert.equal(replacement.slot,8);assert.ok(atlas.entries.has(0));assert.ok(!atlas.entries.has(1));
});

test('request cancellation, retries and late finishes are owned by request identity',()=>{
  let now=100;const jobs=new TileRequests(()=>now);
  const old=jobs.begin('tile',10000);
  jobs.retain([]);assert.ok(old.controller.signal.aborted);assert.equal(jobs.current('tile',old),false);
  jobs.finish('tile',old);
  const next=jobs.begin('tile',10000);jobs.finish('tile',old);
  assert.equal(jobs.pending.get('tile'),next);
  jobs.fail('tile',old,30000);assert.ok(jobs.current('tile',next));
  jobs.fail('tile',next,100);jobs.finish('tile',next);
  assert.equal(jobs.begin('tile',10000),null);
  now=200;const retry=jobs.begin('tile',10000);assert.ok(retry);
  jobs.dispose();assert.ok(retry.controller.signal.aborted);assert.equal(jobs.current('tile',retry),false);
  jobs.finish('tile',retry);assert.equal(jobs.begin('later',10000),null);
});

test('timeout aborts its owner and preserves source-specific timeout notification',async()=>{
  let timedOut=0;const jobs=new TileRequests(),request=jobs.begin(7,1,()=>timedOut++);
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(timedOut,1);assert.ok(request.timedOut);assert.ok(request.controller.signal.aborted);
  jobs.finish(7,request);jobs.dispose();
});
