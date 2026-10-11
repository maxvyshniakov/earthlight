import {test} from 'bun:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {TerrainDecoder} from '../src/scripts/terrain-decoder.ts';
import {DEM_PATCH_BYTES,packTerrainParent,decompressTerrainParent} from '../src/scripts/terrain-packed.ts';

test('decoder pool reuses two workers, cancels active and queued jobs, and rejects late results',async()=>{
 const original=globalThis.Worker,workers=[];
 globalThis.Worker=class{constructor(){workers.push(this);}postMessage(value){this.input=value;}terminate(){this.terminated=true;}};
 const pool=new TerrainDecoder('pool'),controllers=Array.from({length:4},()=>new AbortController());
 try{
  const a=pool.run(new ArrayBuffer(4),0,controllers[0].signal),b=pool.run(new ArrayBuffer(4),1,controllers[1].signal),c=pool.run(new ArrayBuffer(4),2,controllers[2].signal);
  assert.equal(workers.length,2);assert.equal(pool.live,2);
  const late=workers[0].onmessage;controllers[0].abort();await assert.rejects(a,/cancelled/);
  assert.equal(workers.length,3);assert.equal(workers[0].terminated,true);late({data:{patches:['stale']}});assert.equal(pool.completed,0);
  workers[1].onmessage({data:{patches:['b']}});workers[2].onmessage({data:{patches:['c']}});
  assert.deepEqual(await b,['b']);assert.deepEqual(await c,['c']);
  const d=pool.run(new ArrayBuffer(4),3,controllers[3].signal);assert.equal(workers.length,3);
  const e=pool.run(new ArrayBuffer(4),4,new AbortController().signal);
  const cancelled=new AbortController(),f=pool.run(new ArrayBuffer(4),5,cancelled.signal);cancelled.abort();await assert.rejects(f,/cancelled/);
  pool.dispose();await assert.rejects(d,/cancelled/);await assert.rejects(e,/cancelled/);assert.equal(pool.live,0);assert.ok(workers.every(w=>w.terminated));
 }finally{pool.dispose();globalThis.Worker=original;}
});

test('failed decoder is replaced while single-use mode always terminates completed workers',async()=>{
 const original=globalThis.Worker,workers=[];
 globalThis.Worker=class{constructor(){workers.push(this);}postMessage(){}terminate(){this.terminated=true;}};
 const pool=new TerrainDecoder('pool'),single=new TerrainDecoder('single');
 try{
  const a=pool.run(new ArrayBuffer(1),0,new AbortController().signal);workers[0].onerror({message:'decode failed'});await assert.rejects(a,/decode failed/);assert.equal(pool.live,0);
  const b=pool.run(new ArrayBuffer(1),0,new AbortController().signal);workers[1].onmessage({data:{patches:[]}});await b;assert.equal(pool.live,1);
  const c=single.run(new ArrayBuffer(1),0,new AbortController().signal);workers[2].onmessage({data:{patches:[]}});await c;assert.equal(single.live,0);
 }finally{pool.dispose();single.dispose();globalThis.Worker=original;}
});

test('prepacked DEM preserves every height and mip byte; identity, corruption and bounds are checked',async()=>{
 const patches=Array.from({length:4},(_,p)=>Uint8Array.from({length:DEM_PATCH_BYTES},(_,i)=>(i*31+p*53)%256));
 const packed=packTerrainParent(1234,patches),compress=bytes=>new Uint8Array(gzipSync(bytes)).buffer;
 const restored=await decompressTerrainParent(compress(packed),1234);
 assert.deepEqual(restored,patches);assert.equal(new Set(restored.map(p=>p.buffer)).size,4);
 await assert.rejects(decompressTerrainParent(compress(packed),1235),/identity/);
 const corrupt=packed.slice();corrupt[0]=0;await assert.rejects(decompressTerrainParent(compress(corrupt),1234),/format/);
 await assert.rejects(decompressTerrainParent(compress(packed.subarray(0,100)),1234),/truncated/);
 await assert.rejects(decompressTerrainParent(compress(new Uint8Array(packed.length+1)),1234),/too large/);
 await assert.rejects(decompressTerrainParent(new ArrayBuffer(10),1234));
});
