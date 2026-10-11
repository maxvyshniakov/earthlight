import {test,afterEach,spyOn,mock} from 'bun:test';
import assert from 'node:assert/strict';
import {packTerrainPatch,parentTerrainTile,terrainSourceName,DEM_CELL} from '../src/scripts/terrain-detail.ts';
import {terrainSource,terrainResponse} from '../server/terrain-source.mjs';
import {TerrainStream} from '../src/scripts/terrain-stream.ts';
import {issFrame} from '../src/scripts/iss-orbit.ts';

test('DEM coordinates retain hemisphere, parent quadrant and dateline',()=>{
 assert.equal(terrainSourceName(parentTerrainTile(96*720+132)),'N41W114');
 assert.equal(parentTerrainTile(97*720+133),parentTerrainTile(96*720+132));
 assert.equal(terrainSourceName(0),'N89W180');
 assert.equal(terrainSourceName(64799),'S90E179');
});
test('DEM regridding preserves slopes, shared half-degree gutters and numeric mipmaps',()=>{
 const width=800,height=1200,data=Float32Array.from({length:width*height},(_,i)=>1500+(i%width)*2+Math.floor(i/width));
 const a=packTerrainPatch(data,width,height,0,0),b=packTerrainPatch(data,width,height,1,0),cell=DEM_CELL;
 const h=(v,x,y)=>{const p=(y*cell*2+x)*4;return (v[p]*256+v[p+1])*8;};
 for(let y=0;y<cell;y+=13)for(let x=0;x<32;x++)assert.equal(h(a,600+x,y),h(b,x,y));
 for(let y=16;y<616;y+=31)for(let x=16;x<616;x+=29){
  assert.ok(Math.abs(h(a,x,y)-(1500+(x-16+.5)/1200*width*2+y-16+.5))<=4);
 }
 for(let y=0;y<316;y+=17)for(let x=0;x<316;x+=19){
  const mean=(h(a,x*2,y*2)+h(a,x*2+1,y*2)+h(a,x*2,y*2+1)+h(a,x*2+1,y*2+1))/4;
  assert.ok(Math.abs(h(a,cell+x,y)-mean)<=8);
 }
});
test('DEM proxy accepts only the fixed public dataset and handles upstream failures',async()=>{
 for(const path of ['/media/orbit/dem90/N90E000.tif','/media/orbit/dem90/S00W000.tif','/media/orbit/dem90/N41E180.tif','/media/orbit/dem90/https://example.com','/other/N41W114.tif'])assert.equal(terrainSource(path),null);
 const url='http://localhost/media/orbit/dem90/N41W114.tif';
 const response=await terrainResponse(new Request(url),async(u,options)=>{
  assert.match(u,/^https:\/\/copernicus-dem-90m.s3.amazonaws.com\/Copernicus_DSM_COG_30_N41_00_W114_00_DEM\//);
  assert.equal(options.redirect,'manual');return new Response('dem',{headers:{'content-length':'3'}});
 });
 assert.equal(response.status,200);assert.equal(await response.text(),'dem');
 assert.equal((await terrainResponse(new Request(url,{method:'POST'}),()=>assert.fail())).status,405);
 for(const [upstream,expected] of [[new Response('',{status:404}),404],[new Response('',{status:500}),502],[new Response(''),502],[new Response('',{headers:{'content-length':String(17*1024*1024)}}),502]]){
  assert.equal((await terrainResponse(new Request(url),async()=>upstream)).status,expected);
 }
});
test('shared terrain atlas bounds uploads, retries failures slowly and releases offscreen memory',async()=>{
 let now=1000;spyOn(performance,'now').mockImplementation(()=>now);
 const originals={fetch:globalThis.fetch,window:globalThis.window,document:globalThis.document,createImageBitmap:globalThis.createImageBitmap,OffscreenCanvas:globalThis.OffscreenCanvas};
 const uploads=[];let tileRequests=0,deleted=0;
 globalThis.window=globalThis;globalThis.document={hidden:false};
 globalThis.fetch=async url=>{
  if(url.endsWith('copernicus.json'))return {ok:true,json:async()=>[]};
  if(url.endsWith('manifest.json'))return {ok:true,json:async()=>({tiles:Array.from({length:800},(_,i)=>i)})};
  tileRequests++;return tileRequests===1?{ok:false}:{ok:true,blob:async()=>new Blob(['tile'])};
 };
 globalThis.OffscreenCanvas=class{constructor(width,height){this.width=width;this.height=height;}getContext(){return {drawImage(){}};}transferToImageBitmap(){return {width:this.width,height:this.height,close(){}};}};
 globalThis.createImageBitmap=async(...args)=>({width:args.length>2?572:1144,height:572,close(){}});
 const gl={createTexture:()=>({}),activeTexture(){},bindTexture(){},texImage2D(){},texParameteri(){},texSubImage2D(...a){uploads.push(a);},getUniformLocation:()=>({}),uniform1i(){},uniform2f(){},isContextLost:()=>false,deleteTexture(){deleted++;}};
 const work={network:{run:(_,signal,f)=>signal.aborted?Promise.reject(signal.reason):f()},decode:{run:(_,signal,f)=>signal.aborted?Promise.reject(signal.reason):f()},upload:async(_,signal,f)=>{if(signal.aborted)throw signal.reason;f();}};
 let atlas;
 const flush=()=>new Promise(r=>setImmediate(r));
 try{
  atlas=new TerrainStream(gl,true,()=>{},work);await flush();
  const view=issFrame(3000,.22);atlas.update(view,1600,1100,{});await flush();
  assert.equal(atlas.stats().capacity,6);assert.ok(atlas.stats().resident<=6);
  assert.equal(atlas.stats().failures,1);
  const requests=tileRequests;now+=1000;atlas.update(view,1600,1100,{});await flush();assert.equal(tileRequests,requests);
  assert.ok(uploads.filter(a=>a.length===7).every(a=>a[2]>=0&&a[3]>=0&&a[2]+a[6].width<=632*4&&a[3]+a[6].height<=632*4));
  now+=3000;atlas.update(issFrame(3000,-.16),1600,1100,{});await flush();
  now+=3000;atlas.update(issFrame(3000,-.16),1600,1100,{});
  assert.equal(atlas.stats().gpuBytes,4);assert.equal(atlas.stats().resident,0);
  atlas.dispose();atlas=null;assert.equal(deleted,1);
 }finally{atlas?.dispose();Object.assign(globalThis,originals);}
});
test('fine DEM deduplicates parent downloads, caps decoded cache and cancels workers',async()=>{
 const originals={fetch:globalThis.fetch,Worker:globalThis.Worker,window:globalThis.window};
 let requests=0,terminated=0,hold=false;
 globalThis.window=globalThis;
 globalThis.fetch=async url=>url.endsWith('.json')?{ok:true,json:async()=>url.endsWith('copernicus.json')?[]:{tiles:[]}}:{ok:true,arrayBuffer:async()=>{requests++;return new ArrayBuffer(4);}};
 globalThis.Worker=class{
  postMessage(){if(!hold)queueMicrotask(()=>this.onmessage({data:{patches:[new Uint8Array(4),new Uint8Array(4),new Uint8Array(4),new Uint8Array(4)]}}));}
  terminate(){terminated++;}
 };
 const gl={createTexture:()=>({}),activeTexture(){},bindTexture(){},texImage2D(){},texParameteri(){},isContextLost:()=>false,deleteTexture(){}};
 let atlas;
 try{
  atlas=new TerrainStream(gl,true,()=>{},undefined,undefined,undefined,'strips','small');
  const id=96*720+132;
  const [a,b]=await Promise.all([atlas.fineData(id),atlas.fineData(id+1)]);
  assert.equal(a,b);assert.equal(requests,1);assert.equal(terminated,1);
  await atlas.fineData(id+2);await atlas.fineData(id+4);
  assert.equal(atlas.parentCache.size,2);assert.equal(requests,3);
  hold=true;const pending=atlas.fineData(id+6);await new Promise(r=>setImmediate(r));
  atlas.dispose();await assert.rejects(pending,/cancelled/);assert.equal(atlas.decoder.live,0);assert.equal(atlas.parentCache.size,0);
  atlas=null;
 }finally{atlas?.dispose();Object.assign(globalThis,originals);}
});

test('whole DEM upload preserves every atlas byte and publishes only after completion',async()=>{
 const original={window:globalThis.window,document:globalThis.document,fetch:globalThis.fetch};
 globalThis.window=globalThis;globalThis.document={hidden:false};
 globalThis.fetch=async()=>({ok:true,json:async()=>[]});
 const pixels=Uint8Array.from({length:DEM_CELL*DEM_CELL*2*4},(_,i)=>(i*31+Math.floor(i/127))%256);
 const render=async(mode,mobile)=>{
  const columns=mobile?4:6,edge=columns*DEM_CELL,bytes=new Uint8Array(edge*edge*4),calls=[];
  const gl={createTexture:()=>({}),activeTexture(){},bindTexture(){},texImage2D(){},texParameteri(){},isContextLost:()=>false,deleteTexture(){},
   texSubImage2D(_target,_level,x,y,w,h,_format,_type,data){
    assert.ok(x+w<=edge&&y+h<=edge);calls.push({x,y,w,h});
    for(let row=0;row<h;row++)bytes.set(data.subarray(row*w*4,(row+1)*w*4),((y+row)*edge+x)*4);
   }};
  const jobs=[];
  const work={network:{run:async(_,signal,f)=>f()},upload:(_,signal,f)=>new Promise((resolve,reject)=>jobs.push(()=>{if(signal.aborted){reject(signal.reason);return;}f();resolve();}))};
  const atlas=new TerrainStream(gl,mobile,()=>{},work,undefined,undefined,mode);
  atlas.fineData=async()=>[pixels,pixels,pixels,pixels];
  // Last paired cells exercise the atlas edge, beyond the indirection row.
  for(let slot=columns;slot<columns*columns-2;slot+=2)atlas.entries.set('c'+slot,{slot,loaded:0,used:0,id:slot,fine:false});
  atlas.wanted=['f0'];atlas.pump();
  try{
   while(atlas.pending.size){
    await new Promise(r=>setImmediate(r));
    if(jobs.length){assert.equal(atlas.entries.get('f0').loaded,Infinity);jobs.shift()();}
   }
   assert.equal(atlas.stats().fineResident,1);assert.equal(atlas.stats().failures,0);
   assert.equal(calls.length,mode==='tile'?1:20);
   const slot=atlas.entries.get('f0').slot;assert.equal(slot,columns*columns-2);
   // Heights AND packed mipmaps match the decoder buffer, not just each other.
   for(let row=0;row<DEM_CELL;row++)assert.deepEqual(bytes.subarray(((Math.floor(slot/columns)*DEM_CELL+row)*edge+slot%columns*DEM_CELL)*4,((Math.floor(slot/columns)*DEM_CELL+row)*edge+slot%columns*DEM_CELL+2*DEM_CELL)*4),pixels.subarray(row*2*DEM_CELL*4,(row+1)*2*DEM_CELL*4));
   return bytes;
  }finally{atlas.dispose();}
 };
 try{for(const mobile of [true,false])assert.deepEqual(await render('tile',mobile),await render('strips',mobile));}
 finally{Object.assign(globalThis,original);}
});

test('working DEM cache keeps visible parents and stays within its memory budget',async()=>{
 const original={window:globalThis.window,fetch:globalThis.fetch,Worker:globalThis.Worker};
 globalThis.window=globalThis;
 let requests=0;
 globalThis.fetch=async url=>url.endsWith('.json')?{ok:true,json:async()=>url.endsWith('copernicus.json')?[]:{tiles:[]}}:{ok:true,arrayBuffer:async()=>{requests++;return new ArrayBuffer(4);}};
 globalThis.Worker=class{postMessage(){queueMicrotask(()=>this.onmessage({data:{patches:Array.from({length:4},()=>new Uint8Array(8))}}));}terminate(){}};
 const gl={createTexture:()=>({}),activeTexture(){},bindTexture(){},texImage2D(){},texParameteri(){},isContextLost:()=>false,deleteTexture(){}};
 try{for(const mobile of [true,false]){
  const atlas=new TerrainStream(gl,mobile,()=>{});
  try{
   assert.equal(atlas.stats().cacheMode,'working');assert.equal(atlas.stats().uploadMode,'strips');
   atlas.wanted=['f0'];const expected=await atlas.fineData(0);
   for(let id=2;id<20;id+=2)await atlas.fineData(id);
   assert.equal(atlas.parentCache.size,mobile?4:6);
   const before=requests;assert.equal(await atlas.fineData(0),expected);assert.equal(requests,before,'visible parent must not be downloaded or decoded twice');
   assert.equal(atlas.stats().decodedBytes,(mobile?4:6)*32);
  }finally{atlas.dispose();assert.equal(atlas.stats().decodedBytes,0);}
 }}finally{Object.assign(globalThis,original);}
});

afterEach(()=>{mock.restore();});


test('missing or corrupt prepared terrain falls back to TIFF and avoids repeated failed packed requests',async()=>{
 const original={window:globalThis.window,Worker:globalThis.Worker,fetch:globalThis.fetch};globalThis.window=globalThis;
 const requests=[];
 globalThis.fetch=async url=>{requests.push(url);return {ok:true,json:async()=>url.includes('terrain-packed')?{version:1,files:[{id:0}]}:url.endsWith('copernicus.json')?[]:{tiles:[]},arrayBuffer:async()=>new ArrayBuffer(4)};};
 globalThis.Worker=class{constructor(url){this.packed=String(url).includes('packed');}postMessage(){queueMicrotask(()=>this.onmessage({data:this.packed?{error:'corrupt'}:{patches:Array.from({length:4},()=>new Uint8Array(4))}}));}terminate(){}};
 const gl={createTexture:()=>({}),activeTexture(){},bindTexture(){},texImage2D(){},texParameteri(){},isContextLost:()=>false,deleteTexture(){}};
 const atlas=new TerrainStream(gl,false,()=>{},undefined,undefined,undefined,'strips','working','pool','packed');
 try{
  await atlas.fineData(0);assert.equal(atlas.stats().packedFallbacks,1);assert.equal(atlas.stats().failures,0);
  atlas.parentCache.clear();await atlas.fineData(0);
  assert.equal(requests.filter(url=>url.endsWith('.dem')).length,1);assert.equal(requests.filter(url=>url.endsWith('.tif')).length,2);
  await atlas.fineData(2);assert.equal(requests.filter(url=>url.endsWith('.dem')).length,1,'unprepared regions go directly to TIFF');
 }finally{atlas.dispose();assert.equal(atlas.stats().workersLive,0);Object.assign(globalThis,original);}
});
