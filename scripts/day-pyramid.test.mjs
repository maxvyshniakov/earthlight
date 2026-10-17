import {test} from 'bun:test';
import assert from 'node:assert/strict';
import { DayPyramid, PYRAMID_DEPTH, PYRAMID_TABLE, pyramidKey, pyramidLevel, pyramidPack, pyramidTile } from '../src/scripts/day-pyramid.ts';
import { decodeIndex, decodePackHeader, encodeIndex, encodePack, packMask, packSlot, packTile, PACK_HEADER, PACK_TILES } from '../src/scripts/day-pyramid-pack.ts';

// Straight down from 420 km at a lens magnification of `zoom`.
function nadir(lon,lat,zoom){
  const r=Math.PI/180,up=[Math.cos(lat*r)*Math.cos(lon*r),Math.cos(lat*r)*Math.sin(lon*r),Math.sin(lat*r)];
  const east=[-Math.sin(lon*r),Math.cos(lon*r),0],north=[up[1]*east[2]-up[2]*east[1],up[2]*east[0]-up[0]*east[2],up[0]*east[1]-up[1]*east[0]];
  const camera=up.map(v=>v*(1+420/6371));
  return {camera,cameraBasis:[...east,...north,...up.map(v=>-v)],sun:up,focal:1.25*zoom};
}
const tileOf=(level,lon,lat)=>pyramidKey(level,Math.floor((lon+180)/360*(160<<level)),Math.floor((90-lat)/180*(80<<level)));
const fullMask=()=>{const m=new Uint8Array(11);for(let i=0;i<PACK_TILES;i++)m[i>>3]|=1<<(i&7);return m;};
function pyramid(packs){
  const result=Object.create(DayPyramid.prototype);
  Object.assign(result,{packs:new Map(packs),directory:new Uint8Array(12800),table:new Uint8Array(PYRAMID_TABLE.width*PYRAMID_TABLE.height*4),wanted:0,requests:0,headers:new Map(),wholes:[],signature:'',root:'/media/earthlight/day-pyramid/'});
  return result;
}

test('pyramid keys round-trip, stay clear of BMNG ids and name their pack slot',()=>{
  assert.equal(PYRAMID_DEPTH,3);
  for(const [level,x,y] of [[1,0,0],[2,639,319],[3,1279,639],[3,747,213]]){
    const key=pyramidKey(level,x,y);
    assert.ok(key>=12800);
    assert.deepEqual(pyramidTile(key),{level,x,y});
    const {pack,slot}=pyramidPack(key),side=1<<level;
    assert.equal(pack,Math.floor(y/side)*160+Math.floor(x/side));
    assert.deepEqual(packTile(slot),{level,x:x%side,y:y%side});
  }
  for(let i=0;i<PACK_TILES;i++){const t=packTile(i);assert.equal(packSlot(t.level,t.x,t.y),i);}
});

test('deep levels start once BMNG runs out of texels and stop at 62.5 m',()=>{
  assert.equal(pyramidLevel(40),0);
  assert.equal(pyramidLevel(2),0);
  assert.equal(pyramidLevel(1.5),1);
  assert.equal(pyramidLevel(.25),2);
  assert.equal(pyramidLevel(.13),3);
  assert.equal(pyramidLevel(.001),3);
});

test('packs and the index round-trip',()=>{
  const tiles=new Map([[0,new Uint8Array([1,2,3])],[packSlot(3,7,7),new Uint8Array([9,9])],[packSlot(2,1,2),new Uint8Array(5).fill(4)]]);
  const pack=encodePack(tiles),entries=decodePackHeader(pack.subarray(0,PACK_HEADER));
  for(const [slot,bytes] of tiles){const [offset,length]=entries[slot];assert.deepEqual(pack.subarray(offset,offset+length),bytes);}
  assert.equal(entries.filter(([,length])=>length).length,3);
  assert.equal(entries[0][0],PACK_HEADER);
  const index=encodeIndex([{id:4253,mask:packMask(entries)},{id:12799,mask:fullMask()}]),packs=decodeIndex(index);
  assert.deepEqual([...packs.keys()],[4253,12799]);
  const p=pyramid(packs);
  // BMNG 4253 is column 93, row 26.
  assert.ok(p.has(pyramidKey(1,186,52)));
  assert.ok(!p.has(pyramidKey(1,187,52)));
  assert.ok(p.has(pyramidKey(3,93*8+7,26*8+7)));
  assert.ok(p.has(pyramidKey(2,93*4+1,26*4+2)));
  assert.ok(!p.has(pyramidKey(3,0,0)));
  assert.throws(()=>decodeIndex(index.subarray(0,index.length-1)));
});

test('selection follows the footprint and falls back to the deepest available ancestor',()=>{
  const giza=[31.134,29.979];
  const full=pyramid([[4253,fullMask()]]);
  // At ½× a BMNG texel is half a pixel: nothing deep is wanted.
  assert.deepEqual(full.select(nadir(...giza,.5),1280,800,15),[]);
  const deep=full.select(nadir(...giza,20),1280,800,15);
  assert.ok(deep.length>0&&deep.length<=15);
  assert.ok(deep.includes(tileOf(3,...giza)));
  assert.ok(deep.every(key=>pyramidTile(key).level>=2));
  assert.equal(pyramidTile(deep[0]).level,2,'the coarser parent loads first');
  // Only level 1 in the pack: it serves the same view.
  const coarse=new Uint8Array(11);coarse[0]=15;
  assert.ok(pyramid([[4253,coarse]]).select(nadir(...giza,20),1280,800,15).includes(tileOf(1,...giza)));
  // Outside any pack, nothing.
  assert.deepEqual(full.select(nadir(12.5,41.9,20),1280,800,15),[]);
});

test('selection wraps the guard band across the date line and stops at the poles',()=>{
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

// Range reads against a host that honours Range (as R2 and the dev server do)
// and one that ignores it and answers 200 with the whole object.
for(const ranges of [true,false])test(`tiles load from a pack ${ranges?'with 206 ranges':'from a host without ranges'}`,async()=>{
  const tiles=new Map([[0,new Uint8Array([10,11,12])],[packSlot(3,2,5),new Uint8Array([20,21,22,23])]]);
  const pack=encodePack(tiles),index=encodeIndex([{id:4253,mask:packMask(decodePackHeader(pack.subarray(0,PACK_HEADER)))}]);
  const seen=[];
  const server=Bun.serve({port:0,fetch(request){
    const path=new URL(request.url).pathname,body=path.endsWith('index.bin')?index:path.endsWith('4253.pack')?pack:null;
    if(!body)return new Response('missing',{status:404});
    const range=request.headers.get('range');seen.push([path,range]);
    const m=ranges&&range?.match(/^bytes=(\d+)-(\d+)$/);
    if(m){const start=+m[1],end=Math.min(body.length-1,+m[2]);return new Response(body.slice(start,end+1),{status:206,headers:{'Content-Range':`bytes ${start}-${end}/${body.length}`}});}
    return new Response(body);
  }});
  try{
    const ready=new Promise(resolve=>{const p=new DayPyramid(`http://localhost:${server.port}/media/earthlight/`,new AbortController().signal,()=>resolve(p));});
    const p=await ready;
    assert.ok(p.has(pyramidKey(1,186,52))&&p.has(pyramidKey(3,93*8+2,26*8+5)));
    const signal=new AbortController().signal;
    assert.deepEqual(new Uint8Array(await (await p.load(pyramidKey(1,186,52),signal)).arrayBuffer()),tiles.get(0));
    assert.deepEqual(new Uint8Array(await (await p.load(pyramidKey(3,93*8+2,26*8+5),signal)).arrayBuffer()),tiles.get(packSlot(3,2,5)));
    const packReads=seen.filter(([path])=>path.endsWith('.pack'));
    // One header read, then one range per tile; without ranges the header's whole body serves both.
    assert.equal(packReads.length,ranges?3:1);
    assert.equal(packReads[0][1],`bytes=0-${PACK_HEADER-1}`);
    await assert.rejects(p.load(pyramidKey(1,187,52),signal));
  }finally{server.stop(true);}
});
