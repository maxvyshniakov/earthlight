import {test,spyOn} from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DayPyramid, PYRAMID_DEPTH, PYRAMID_TABLE, pyramidDayTile, pyramidKey, pyramidLevel, pyramidTile } from '../src/scripts/day-pyramid.ts';
import { daySlot, decodeDayPack, decodeIndex, decodePackHeader, DAY_PACK_HEADER, DAY_SLOTS, encodeDayPack, encodeIndex, encodePack, packHeaderLength, packOf, slotMask, slotTile } from '../src/scripts/day-pyramid-pack.ts';
import { repack, verify } from './build-day-pyramid-packs.mjs';
import { SurfaceTiles } from '../src/scripts/night-tiles.ts';

// Straight down from 420 km at a lens magnification of `zoom`.
function nadir(lon,lat,zoom){
  const r=Math.PI/180,up=[Math.cos(lat*r)*Math.cos(lon*r),Math.cos(lat*r)*Math.sin(lon*r),Math.sin(lat*r)];
  const east=[-Math.sin(lon*r),Math.cos(lon*r),0],north=[up[1]*east[2]-up[2]*east[1],up[2]*east[0]-up[0]*east[2],up[0]*east[1]-up[1]*east[0]];
  const camera=up.map(v=>v*(1+420/6371));
  return {camera,cameraBasis:[...east,...north,...up.map(v=>-v)],sun:up,focal:1.25*zoom};
}
const tileOf=(level,lon,lat)=>pyramidKey(level,Math.floor((lon+180)/360*(160<<level)),Math.floor((90-lat)/180*(80<<level)));
const fullMask=()=>{const m=new Uint8Array(11);for(let i=0;i<DAY_SLOTS;i++)m[i>>3]|=1<<(i&7);return m;};
// The release layout's smallest blocks: level 1 over 2 × 2 day tiles, levels 2 and 3 one day tile.
const K=[2,2,3];
function pyramid(entries,root='/media/earthlight/'){
  const result=Object.create(DayPyramid.prototype);
  Object.assign(result,{packs:new Map(entries.map(([id,mask,k=K])=>[id,{mask,k:Uint8Array.from(k)}])),directory:new Uint8Array(12800),table:new Uint8Array(PYRAMID_TABLE.width*PYRAMID_TABLE.height*4),
    wanted:0,requests:0,received:0,cached:0,cache:new Map(),loading:new Map(),signature:'',root:root+'day-pyramid/',cacheBytes:48*2**20});
  return result;
}
const levelsOf=keys=>[...new Set(keys.map(key=>pyramidTile(key).level))].sort();

test('pyramid keys round-trip, stay clear of BMNG ids and name their day tile, slot and pack',()=>{
  assert.equal(PYRAMID_DEPTH,3);
  for(const [level,x,y] of [[1,0,0],[2,639,319],[3,1279,639],[3,747,213]]){
    const key=pyramidKey(level,x,y);
    assert.ok(key>=12800);
    assert.deepEqual(pyramidTile(key),{level,x,y});
    const {id,slot}=pyramidDayTile(key),side=1<<level;
    assert.equal(id,Math.floor(y/side)*160+Math.floor(x/side));
    assert.deepEqual(slotTile(slot),{level,x:x%side,y:y%side});
  }
  for(let i=0;i<DAY_SLOTS;i++){const t=slotTile(i);assert.equal(daySlot(t.level,t.x,t.y),i);}
  // Level 3 at k = 3 is its day tile; level 1 at k = 2 spans 2 × 2 day tiles.
  assert.deepEqual(packOf(3,747,213,3),{path:'3/744-208.pack',level:3,k:3,x:744,y:208,slot:5*8+3});
  assert.deepEqual(packOf(1,187,53,2),{path:'1/184-52.pack',level:1,k:2,x:184,y:52,slot:1*4+3});
});

test('deep levels start once BMNG runs out of texels and stop at 62.5 m',()=>{
  assert.equal(pyramidLevel(40),0);
  assert.equal(pyramidLevel(2),0);
  assert.equal(pyramidLevel(1.5),1);
  assert.equal(pyramidLevel(.25),2);
  assert.equal(pyramidLevel(.13),3);
  assert.equal(pyramidLevel(.001),3);
});

test('day tile packs, release packs and the index round-trip',()=>{
  const tiles=new Map([[0,new Uint8Array([1,2,3])],[daySlot(3,7,7),new Uint8Array([9,9])],[daySlot(2,1,2),new Uint8Array(5).fill(4)]]);
  const day=encodeDayPack(tiles),entries=decodeDayPack(day);
  for(const [slot,bytes] of tiles){const [offset,length]=entries[slot];assert.deepEqual(day.subarray(offset,offset+length),bytes);}
  assert.equal(entries.filter(([,length])=>length).length,3);
  assert.equal(entries[0][0],DAY_PACK_HEADER);
  // A release pack: one level, an aligned block, the header readable from a prefix.
  const slots=new Map([[0,new Uint8Array([7,7,7])],[63,new Uint8Array([8])]]),pack=encodePack(3,3,744,208,slots);
  assert.equal(decodePackHeader(pack.subarray(0,11)),null);
  assert.equal(decodePackHeader(pack.subarray(0,packHeaderLength(3)-1)),null);
  const header=decodePackHeader(pack.subarray(0,packHeaderLength(3)));
  assert.deepEqual([header.level,header.k,header.x,header.y,header.bytes],[3,3,744,208,pack.length]);
  for(const [slot,bytes] of slots){const [offset,length]=header.entries[slot];assert.deepEqual(pack.subarray(offset,offset+length),bytes);}
  assert.throws(()=>encodePack(3,3,745,208,slots),/aligned/);
  const index=encodeIndex([{id:4253,mask:slotMask(entries),k:[2,2,3]},{id:12799,mask:fullMask(),k:[4,3,5]}]),decoded=decodeIndex(index);
  assert.deepEqual([...decoded.keys()],[4253,12799]);
  assert.deepEqual([...decoded.get(12799).k],[4,3,5]);
  const p=pyramid([...decoded].map(([id,{mask,k}])=>[id,mask,k]));
  // BMNG 4253 is column 93, row 26.
  assert.ok(p.has(pyramidKey(1,186,52)));
  assert.ok(!p.has(pyramidKey(1,187,52)));
  assert.ok(p.has(pyramidKey(3,93*8+7,26*8+7)));
  assert.ok(p.has(pyramidKey(2,93*4+1,26*4+2)));
  assert.ok(!p.has(pyramidKey(3,0,0)));
  assert.equal(p.locate(pyramidKey(3,93*8+7,26*8+7)).path,'3/744-208.pack');
  assert.equal(p.locate(pyramidKey(1,186,52)).path,'1/184-52.pack');
  assert.throws(()=>decodeIndex(index.subarray(0,index.length-1)));
});

test('a cold view draws one level from its own packs: no parents, no guard band from other packs',()=>{
  const giza=[31.134,29.979];
  const full=pyramid([[4253,fullMask()]]);
  // At ½× a BMNG texel is half a pixel: nothing deep is wanted.
  assert.deepEqual(full.select(nadir(...giza,.5),1280,800,15),[]);
  for(const [zoom,level] of [[2,1],[20,3],[50,3]]){
    const keys=full.select(nadir(...giza,zoom),1280,800,15);
    assert.ok(keys.length>0&&keys.length<=15);
    assert.deepEqual(levelsOf(keys),[level],`${zoom}× fetches level ${level} only`);
    assert.equal(new Set(keys.map(key=>full.locate(key).path)).size,1,'one pack');
  }
  const deep=full.select(nadir(...giza,20),1280,800,15);
  assert.equal(deep[0],tileOf(3,...giza),'the centre loads first');
  // Only level 1 in the pack: it serves the same view.
  const coarse=new Uint8Array(11);coarse[0]=15;
  const fallback=pyramid([[4253,coarse]]).select(nadir(...giza,20),1280,800,15);
  assert.equal(fallback[0],tileOf(1,...giza));
  assert.deepEqual(levelsOf(fallback),[1]);
  // Outside any pack, nothing.
  assert.deepEqual(full.select(nadir(12.5,41.9,20),1280,800,15),[]);
});

test('parents and the guard band join when their packs cost nothing more',()=>{
  const giza=[31.134,29.979],p=pyramid([[4253,fullMask()],[4254,fullMask()]]);
  const cold=p.select(nadir(...giza,20),1280,800,40);
  const parent=pyramidKey(2,pyramidTile(tileOf(3,...giza)).x>>1,pyramidTile(tileOf(3,...giza)).y>>1);
  assert.ok(!cold.includes(parent));
  // The level-2 pack of this day tile is cached (say from a 4× view): its parents come along.
  p.cache.set(p.locate(parent).path,{bytes:new Uint8Array(1)});
  const warm=p.select(nadir(...giza,20),1280,800,40);
  assert.ok(warm.includes(parent));
  assert.ok(warm.indexOf(parent)>warm.indexOf(tileOf(3,...giza)),'drawn tiles first');
  // Guard tiles of the drawn level only from packs the drawn tiles need.
  const drawnPacks=new Set(cold.filter(key=>pyramidTile(key).level===3).map(key=>p.locate(key).path));
  assert.ok(cold.every(key=>drawnPacks.has(p.locate(key).path)));
});

test('selection wraps across the date line and stops at the poles',()=>{
  const east=pyramid([[6400,fullMask()],[6559,fullMask()]]);
  const keys=east.select(nadir(179.99,-.5,20),1280,800,40).map(pyramidTile);
  assert.ok(keys.some(t=>t.x===0)&&keys.some(t=>t.x===1279),'both sides of 180°');
  const polar=pyramid([[0,fullMask()],[80,fullMask()]]);
  assert.ok(polar.select(nadir(-179,89.9,20),1280,800,40).every(key=>pyramidTile(key).y>=0));
});

test('the page table keeps the deepest resident tile and the one it replaces',()=>{
  const p=pyramid([]);
  // BMNG 4253 is column 93, row 26. Level 1 (187, 53) is its south-east
  // quadrant, cells 4–7; level 3 (748, 212) is cell (4, 4).
  const l1=pyramidKey(1,187,53),l3=pyramidKey(3,748,212);
  const resident=new Map([[l3,{slot:9,loaded:0}],[l1,{slot:3,loaded:0}],[4253,{slot:5,loaded:0}],[pyramidKey(2,374,106),{slot:7,loaded:Infinity}]]);
  assert.equal(p.write(resident,1000),true);
  assert.equal(p.write(resident,1000),false);
  assert.equal(p.directory[4253],1);
  assert.equal(p.directory.reduce((a,b)=>a+b),1);
  const cell=(x,y)=>Array.from(p.table.subarray((y*PYRAMID_TABLE.width+x*2)*4,(y*PYRAMID_TABLE.width+x*2)*4+8));
  assert.deepEqual(cell(4,4),[9,3,255,0,3,1,0,0]);
  assert.deepEqual(cell(5,4),[3,1,255,0,0,0,0,0]);
  assert.deepEqual(cell(7,7),[3,1,255,0,0,0,0,0]);
  assert.deepEqual(cell(3,4),[0,0,0,0,0,0,0,0]);
  assert.deepEqual(cell(4,3),[0,0,0,0,0,0,0,0]);
  // A tile still fading in keeps its ancestor for the shader's cross-fade.
  p.write(new Map([[l1,{slot:3,loaded:0}],[l3,{slot:9,loaded:900}]]),1000);
  const fading=cell(4,4);
  assert.deepEqual([fading[0],fading[1],fading[4],fading[5]],[9,3,3,1]);
  assert.ok(fading[2]>0&&fading[2]<255);
});

// A static host like the media host: no ranges, whole files only. `hold`
// pauses a pack's body after its first `split` bytes until released.
function host(files,{hold}={}){
  const seen=[],gates=new Map();
  const server=Bun.serve({port:0,fetch(request){
    const path=new URL(request.url).pathname.replace(/^\/media\/earthlight\/day-pyramid\//,''),body=files.get(path);
    seen.push({path,range:request.headers.get('range')});
    if(!body)return new Response('missing',{status:404});
    if(hold?.path!==path)return new Response(body);
    let release;const gate=new Promise(resolve=>{release=resolve;});gates.set(path,release);
    return new Response(new ReadableStream({async start(controller){
      controller.enqueue(body.slice(0,hold.split));await gate;controller.enqueue(body.slice(hold.split));controller.close();
    }}),{headers:{'Content-Length':String(body.length)}});
  }});
  return {server,seen,release:path=>gates.get(path)?.(),url:`http://localhost:${server.port}/media/earthlight/`};
}
async function ready(url,cacheBytes){
  return new Promise(resolve=>{const p=new DayPyramid(url,new AbortController().signal,()=>resolve(p),cacheBytes);});
}
const bytesOf=async blob=>new Uint8Array(await blob.arrayBuffer());

test('tiles come from whole packs, one fetch per pack, each tile as soon as its bytes arrive',async()=>{
  // Day tile 4253: level-3 tiles (0, 0) and (2, 5) of its pack, and its first
  // level-1 tile, slot 2 of a level-1 pack over 2 × 2 day tiles.
  const a=new Uint8Array(3000).fill(1),b=new Uint8Array([20,21,22,23]),c=new Uint8Array([5,6]);
  const l3=encodePack(3,3,744,208,new Map([[0,a],[5*8+2,b]])),l1=encodePack(1,2,184,52,new Map([[2,c]]));
  const mask=new Uint8Array(11);for(const slot of [0,daySlot(3,0,0),daySlot(3,2,5)])mask[slot>>3]|=1<<(slot&7);
  const files=new Map([['index.bin',encodeIndex([{id:4253,mask,k:K}])],['3/744-208.pack',l3],['1/184-52.pack',l1]]);
  const {server,seen,release,url}=host(files,{hold:{path:'3/744-208.pack',split:packHeaderLength(3)+a.length}});
  try{
    const p=await ready(url);
    const signal=new AbortController().signal;
    const first=p.load(pyramidKey(3,744,208),signal),second=p.load(pyramidKey(3,746,213),signal);
    // The first tile is complete before the rest of the pack has arrived.
    assert.deepEqual(await bytesOf(await first),a);
    let done=false;second.then(()=>{done=true;});
    await new Promise(resolve=>setTimeout(resolve,30));
    assert.equal(done,false);
    release('3/744-208.pack');
    assert.deepEqual(await bytesOf(await second),b);
    // Cached now: no further request for the same pack.
    assert.deepEqual(await bytesOf(await p.load(pyramidKey(3,746,213),signal)),b);
    assert.deepEqual(await bytesOf(await p.load(pyramidKey(1,186,52),signal)),c);
    const packs=seen.filter(({path})=>path.endsWith('.pack'));
    assert.deepEqual(packs.map(({path})=>path),['3/744-208.pack','1/184-52.pack']);
    assert.ok(packs.every(({range})=>range===null),'no Range header');
    assert.equal(p.requests,2);
    assert.equal(p.received,l3.length+l1.length);
    assert.equal(p.cached,l3.length+l1.length);
    await assert.rejects(p.load(pyramidKey(3,745,208),signal),/absent/);
  }finally{server.stop(true);}
});

test('the pack cache is bounded by bytes, least recently used first',async()=>{
  const files=new Map(),entries=[];
  for(const id of [4253,4254,4255]){
    const x=(id%160)*8,y=Math.floor(id/160)*8,mask=new Uint8Array(11);mask[daySlot(3,0,0)>>3]|=1<<(daySlot(3,0,0)&7);
    files.set(`3/${x}-${y}.pack`,encodePack(3,3,x,y,new Map([[0,new Uint8Array(1000).fill(id&255)]])));entries.push({id,mask,k:K});
  }
  files.set('index.bin',encodeIndex(entries));
  const {server,seen,url}=host(files);
  try{
    const size=files.get('3/744-208.pack').length,p=await ready(url,2*size),signal=new AbortController().signal;
    const key=id=>pyramidKey(3,(id%160)*8,Math.floor(id/160)*8);
    await p.load(key(4253),signal);await p.load(key(4254),signal);
    await p.load(key(4253),signal); // 4253 is now the most recent
    await p.load(key(4255),signal); // evicts 4254
    assert.equal(p.cached,2*size);
    const before=seen.length;
    await p.load(key(4253),signal);
    assert.equal(seen.length,before,'4253 still cached');
    await p.load(key(4254),signal);
    assert.equal(seen.length,before+1,'4254 fetched again');
  }finally{server.stop(true);}
});

test('a view only fetches the levels it draws, and abandoned packs are aborted',async()=>{
  const giza=[31.134,29.979],id=4253,files=new Map(),mask=fullMask(),payload=new Uint8Array(64);
  for(let level=1;level<=3;level++){
    const k=K[level-1],side=1<<level,x0=(id%160)*side>>k<<k,y0=Math.floor(id/160)*side>>k<<k,slots=new Map();
    for(let y=0;y<1<<k;y++)for(let x=0;x<1<<k;x++)slots.set((y<<k)+x,payload);
    files.set(`${level}/${x0}-${y0}.pack`,encodePack(level,k,x0,y0,slots));
  }
  files.set('index.bin',encodeIndex([{id,mask,k:K}]));
  const {server,seen,release,url}=host(files,{hold:{path:'3/744-208.pack',split:20}});
  try{
    const p=await ready(url),controller=new AbortController();
    const keys=p.select(nadir(...giza,20),1280,800,15);
    const loads=keys.map(key=>p.load(key,controller.signal).catch(error=>error));
    await new Promise(resolve=>setTimeout(resolve,30));
    assert.deepEqual(seen.filter(({path})=>path.endsWith('.pack')).map(({path})=>path),['3/744-208.pack']);
    // The view moves away before the pack arrives: nothing wants it any more.
    assert.deepEqual(p.select(nadir(12.5,41.9,20),1280,800,15),[]);
    controller.abort();release('3/744-208.pack');
    assert.ok((await Promise.all(loads)).every(result=>result instanceof Error));
    assert.equal(p.cached,0);
    assert.ok(p.received<files.get('3/744-208.pack').length);
  }finally{server.stop(true);}
});

test('repacking keeps every tile byte-identical and merges sparse blocks under the cap',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'day-pyramid-')),input=join(dir,'build'),output=join(dir,'release');
  try{
    await Bun.write(join(input,'provenance.json'),JSON.stringify({version:1,packs:3}));
    await Bun.write(join(input,'sources.json'),'{}\n');
    // Three day tiles: a dense one, and two sparse ones that share a 2 × 2
    // block of day tiles (94–95, 26–27) beside it.
    const random=n=>Uint8Array.from({length:n},(_,i)=>(i*131+n)&255);
    const days={4253:[...Array(DAY_SLOTS).keys()].map(slot=>[slot,random(2000+slot)]),4254:[[0,random(10)],[daySlot(3,1,1),random(11)]],4415:[[daySlot(2,0,0),random(12)],[daySlot(3,7,7),random(13)]]};
    for(const [id,slots] of Object.entries(days))await Bun.write(join(input,`${id}.pack`),encodeDayPack(new Map(slots)));
    await repack(input,output,20000);
    const result=await verify(input,output);
    assert.equal(result.tiles,DAY_SLOTS+4);
    const index=decodeIndex(new Uint8Array(await readFile(join(output,'index.bin'))));
    // The dense day tile keeps the smallest blocks at levels 2 and 3 (32 kB
    // and 131 kB); its 8 kB of level 1 and the sparse tiles merge to the cap.
    assert.deepEqual([...index.get(4253).k],[5,2,3]);
    assert.deepEqual([index.get(4254).k[2],index.get(4415).k[2]],[4,4]);
    assert.deepEqual((await readdir(join(output,'3'))).sort(),['744-208.pack','752-208.pack']);
    // A changed tile fails verification.
    const path=join(output,'3','744-208.pack'),pack=new Uint8Array(await readFile(path)),[offset]=decodePackHeader(pack).entries[0];
    pack[offset]^=1;await writeFile(path,pack);
    await assert.rejects(verify(input,output),/differs/);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('the day atlas holds deep tiles back until the frame is sharp, then fetches one pack whole',async()=>{
  let now=1000;const clock=spyOn(performance,'now').mockImplementation(()=>now);
  const originals={fetch:globalThis.fetch,createImageBitmap:globalThis.createImageBitmap,window:globalThis.window,document:globalThis.document};
  const giza=[31.134,29.979],slots=new Map(Array.from({length:64},(_,i)=>[i,new Uint8Array([i])]));
  const index=encodeIndex([{id:4253,mask:fullMask(),k:K}]),pack=encodePack(3,3,744,208,slots),packs=[];
  globalThis.window=globalThis;globalThis.document={hidden:false};
  globalThis.createImageBitmap=async()=>({width:572,height:572,close(){}});
  globalThis.fetch=async(url,options={})=>{
    if(url.endsWith('manifest.json'))return {ok:true,json:async()=>({version:1,interior:540,gutter:16,columns:160,rows:80,tiles:[4253]})};
    if(url.endsWith('index.bin'))return new Response(index);
    if(url.endsWith('.pack')){packs.push({url,range:new Headers(options.headers).get('range')});return new Response(pack);}
    return new Promise(()=>{});
  };
  const gl={TEXTURE0:33984,LUMINANCE:6409,RGBA:6408,generateMipmap(){},getParameter:()=>8192,createTexture:()=>({}),activeTexture(){},bindTexture(){},texImage2D(){},texParameteri(){},pixelStorei(){},texSubImage2D(){},getUniformLocation:()=>({}),uniform1i(){},uniform2f(){},isContextLost:()=>false,deleteTexture(){}};
  const flush=()=>new Promise(resolve=>setTimeout(resolve,5));
  let atlas;
  try{
    atlas=new SurfaceTiles(gl,false,()=>{},'day',undefined,undefined,undefined,true);
    await flush();
    const view=nadir(...giza,20);
    atlas.update(view,1280,800,{},false);
    assert.equal(atlas.stats().deepWanted,0,'a defocused frame wants no deep tile');
    now+=200;atlas.update(view,1280,800,{},true);
    assert.equal(atlas.stats().deepWanted,0,'focus reached: the buffer may still be small');
    now+=181;atlas.update(view,1280,800,{},true);
    assert.ok(atlas.stats().deepWanted>0);
    await flush();
    assert.deepEqual(packs,[{url:'/media/earthlight/day-pyramid/3/744-208.pack',range:null}]);
    assert.equal(atlas.stats().deepRequests,1);
    assert.equal(atlas.stats().deepPackBytes,pack.length);
  }finally{
    atlas?.dispose();clock.mockRestore();
    Object.assign(globalThis,originals);
  }
});
