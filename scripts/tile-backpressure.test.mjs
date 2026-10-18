import {test} from 'bun:test';
import assert from 'node:assert/strict';
import {SurfaceTiles} from '../src/scripts/surface-tiles.ts';
import {TerrainStream} from '../src/scripts/terrain-stream.ts';

for(const terrain of [false,true])test(`${terrain?'terrain cached decode':'surface download'} waits for a pinned atlas slot and resumes after its owner settles`,async()=>{
  const saved={window:globalThis.window,document:globalThis.document,fetch:globalThis.fetch,createImageBitmap:globalThis.createImageBitmap,OffscreenCanvas:globalThis.OffscreenCanvas};
  const cell=terrain?572:544;let fetches=0,decodes=0,settleUpload,reservations=0,runaway=false,closed=0;
  globalThis.window=globalThis;globalThis.document={hidden:false};
  globalThis.fetch=async url=>{
    if(url.endsWith('.json'))return new Promise(()=>{});
    fetches++;return {ok:true,blob:async()=>new Blob(['tile'])};
  };
  globalThis.createImageBitmap=async()=>{decodes++;return {width:cell*2,height:cell,close(){closed++;}};};
  globalThis.OffscreenCanvas=class{
    constructor(width,height){this.width=width;this.height=height;}
    getContext(){return {drawImage(){}};}
    transferToImageBitmap(){return {width:this.width,height:this.height,close(){closed++;}};}
  };
  const gl={TEXTURE0:33984,RGBA:6408,LUMINANCE:6409,getParameter:()=>8192,createTexture:()=>({}),activeTexture(){},bindTexture(){},texImage2D(){},texParameteri(){},texSubImage2D(){},isContextLost:()=>false,deleteTexture(){}};
  const run=(_,signal,action)=>signal.aborted?Promise.reject(signal.reason):action();
  let hold=true;
  const work={moving:false,network:{run},decode:{run},upload:(_,signal,action)=>{
    if(hold){hold=false;return new Promise((resolve,reject)=>{settleUpload=()=>{if(signal.aborted)reject(signal.reason);else{action();resolve();}};});}
    return run(0,signal,async()=>action());
  }};
  const flush=()=>new Promise(resolve=>setImmediate(resolve));
  let stream;
  try{
    stream=terrain?new TerrainStream(gl,true,()=>{},work,undefined,undefined,'tile'):new SurfaceTiles(gl,true,()=>{},'galaxy',work);
    stream.allocated=true;
    const old=terrain?'c799':400,next=terrain?'f0':401,kept=[];
    for(let i=0;i<stream.stats().capacity-1;i++){
      const key=terrain?'c'+i:i,entry=stream.atlas.reserve(key,[],i,terrain?{fine:false,id:i}:{});
      stream.atlas.complete(key,entry,i);kept.push(key);
    }
    if(terrain)stream.parentCache.set(0,Array.from({length:4},()=>new Uint8Array(4)));
    const reserve=stream.atlas.reserve.bind(stream.atlas);
    stream.atlas.reserve=(...args)=>{
      // Bound the pre-fix microtask loop so this regression fails, never hangs.
      if(++reservations>20){runaway=true;stream.dispose();return null;}
      return reserve(...args);
    };
    stream.wanted=[...kept,old];stream.pump();await flush();
    assert.ok(settleUpload);const oldSlot=stream.atlas.entries.get(old).slot;
    stream.wanted=[...kept,next];stream.jobs.retain(stream.wanted);stream.pump();
    // A timer must get a turn even when the replacement's terrain parent is
    // already cached. No repeated network/decode admission can fill this slot.
    await new Promise(resolve=>setTimeout(resolve,0));
    assert.equal(runaway,false);assert.equal(reservations,1);
    assert.equal(fetches,1);assert.equal(decodes,1);
    assert.equal(stream.atlas.entries.get(old).slot,oldSlot);
    settleUpload();await flush();await flush();
    assert.equal(stream.atlas.entries.has(old),false);
    assert.equal(stream.atlas.entries.get(next).slot,oldSlot);
    assert.ok(Number.isFinite(stream.atlas.entries.get(next).loaded));
    assert.equal(stream.stats().pending,0);assert.equal(fetches,terrain?1:2);
    assert.ok(closed>=2);
  }finally{stream?.dispose();Object.assign(globalThis,saved);}
});
