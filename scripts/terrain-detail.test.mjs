import test from 'node:test';
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
  assert.equal(options.redirect,'error');return new Response('dem',{headers:{'content-length':'3'}});
 });
 assert.equal(response.status,200);assert.equal(await response.text(),'dem');
 assert.equal((await terrainResponse(new Request(url,{method:'POST'}),()=>assert.fail())).status,405);
 for(const [upstream,expected] of [[new Response('',{status:404}),404],[new Response('',{status:500}),502],[new Response(''),502],[new Response('',{headers:{'content-length':String(17*1024*1024)}}),502]]){
  assert.equal((await terrainResponse(new Request(url),async()=>upstream)).status,expected);
 }
});
test('shared terrain atlas bounds uploads, retries failures slowly and releases offscreen memory',async t=>{
 let now=1000;t.mock.method(performance,'now',()=>now);
 const originals={fetch:globalThis.fetch,window:globalThis.window,document:globalThis.document,createImageBitmap:globalThis.createImageBitmap};
 const uploads=[];let tileRequests=0,deleted=0;
 globalThis.window=globalThis;globalThis.document={hidden:false};
 globalThis.fetch=async url=>{
  if(url.endsWith('copernicus.json'))return {ok:true,json:async()=>[]};
  if(url.endsWith('manifest.json'))return {ok:true,json:async()=>({tiles:Array.from({length:800},(_,i)=>i)})};
  tileRequests++;return tileRequests===1?{ok:false}:{ok:true,blob:async()=>new Blob(['tile'])};
 };
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
  atlas=new TerrainStream(gl,true,()=>{});
  const id=96*720+132;
  const [a,b]=await Promise.all([atlas.fineData(id),atlas.fineData(id+1)]);
  assert.equal(a,b);assert.equal(requests,1);assert.equal(terminated,1);
  await atlas.fineData(id+2);await atlas.fineData(id+4);
  assert.equal(atlas.parentCache.size,2);assert.equal(requests,3);
  hold=true;const pending=atlas.fineData(id+6);await new Promise(r=>setImmediate(r));
  atlas.dispose();await assert.rejects(pending,/cancelled/);assert.equal(atlas.workers.size,0);assert.equal(atlas.parentCache.size,0);
  atlas=null;
 }finally{atlas?.dispose();Object.assign(globalThis,originals);}
});
