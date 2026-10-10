import test from 'node:test';
import assert from 'node:assert/strict';
import { issFrame } from '../src/scripts/iss-orbit.ts';
import { tileAt, visibleSurfaceTiles, visibleGalaxyTiles, SurfaceTiles } from '../src/scripts/night-tiles.ts';

const all=new Set(Array.from({length:12800},(_,i)=>i));
test('tile coordinates wrap at the dateline and clamp at both poles',()=>{
  assert.equal(tileAt(-180,90),0);
  assert.equal(tileAt(180,90),0);
  assert.equal(tileAt(540,90),0);
  assert.equal(tileAt(-180,-90),79*160);
  assert.equal(tileAt(0,0),40*160+80);
  assert.equal(tileAt(-70,-33),54*160+48);
});

test('stream only nonempty night tiles, bounded by the device cache',()=>{
  for(const t of [0,120,1000,2000,4500,5500]){
    const view=issFrame(t,.22);
    const wanted=visibleSurfaceTiles(view,1600,1100,all,63);
    assert.ok(wanted.length>0&&wanted.length<=63);
    assert.equal(new Set(wanted).size,wanted.length);
    const sparse=new Set(wanted.filter((_,i)=>i%2===0));
    const selected=visibleSurfaceTiles(view,1600,1100,sparse,15);
    assert.ok(selected.length<=15);
    assert.ok(selected.every(id=>sparse.has(id)));
  }
  assert.deepEqual(visibleSurfaceTiles(issFrame(0,.22),1600,1100,new Set(),63),[]);
  assert.deepEqual(visibleSurfaceTiles(issFrame(3000,.22),1600,1100,all,63),[]);
  assert.deepEqual(visibleSurfaceTiles(issFrame(0,-.16),1600,1100,all,63),[]);
});


test('day tiles follow the sunlit surface and stop offscreen',()=>{
  assert.ok(visibleSurfaceTiles(issFrame(3000,.22),1600,1100,all,31,'day').length>0);
  assert.deepEqual(visibleSurfaceTiles(issFrame(0,.22),1600,1100,all,31,'day'),[]);
  assert.deepEqual(visibleSurfaceTiles(issFrame(3000,-.16),1600,1100,all,31,'day'),[]);
});

const galaxyView=(second=false,occluded=false)=>({camera:occluded?[1.01,0,0]:second?[0,2,0]:[2,0,0],cameraBasis:occluded?[0,1,0,0,0,1,-1,0,0]:second?[1,0,0,0,0,1,0,1,0]:[0,1,0,0,0,1,1,0,0],galacticBasis:[1,0,0,0,1,0,0,0,1],sun:[1,0,0]});
test('galaxy detail follows sky direction, prioritizes centre and excludes Earth',()=>{
 const ids=new Set(Array.from({length:512},(_,i)=>i)),view=galaxyView();
 const wanted=visibleGalaxyTiles(view,1600,1100,ids,17);
 assert.equal(wanted.length,17);assert.equal(new Set(wanted).size,17);
 assert.ok([7*32+15,7*32+16,8*32+15,8*32+16].includes(wanted[0]));
 assert.deepEqual(visibleGalaxyTiles(galaxyView(false,true),1600,1100,ids,17),[]);
 assert.deepEqual(visibleGalaxyTiles(view,100,60,ids,17),[]);
 const sparse=new Set(wanted.slice(0,3));assert.deepEqual(new Set(visibleGalaxyTiles(view,1600,1100,sparse,17)),sparse);
 const seam={...view,camera:[-2,0,0],cameraBasis:[0,1,0,0,0,1,-1,0,0]};
 const wrap=visibleGalaxyTiles(seam,1600,1100,ids,17);
 assert.ok(wrap.some(id=>id%32===0)&&wrap.some(id=>id%32===31));
});

for(const layer of ['night','day','cloud','galaxy','terrain'])test(`${layer} atlas bounds loads, evicts after seek, closes decodes, and cancels on disposal`,async t=>{
  let now=1000;t.mock.method(performance,'now',()=>now);
  const cell=(layer==='cloud'||layer==='galaxy')?544:572,columns=layer==='terrain'?40:(layer==='cloud'||layer==='galaxy')?32:160,rows=layer==='terrain'?20:(layer==='cloud'||layer==='galaxy')?16:80;
  const ids=Array.from({length:columns*rows},(_,i)=>i);
  const originals={fetch:globalThis.fetch,createImageBitmap:globalThis.createImageBitmap,window:globalThis.window,document:globalThis.document};
  const requests=[];let closes=0,deletes=0;const uploads=[];
  globalThis.window=globalThis;
  globalThis.document={hidden:false};
  globalThis.createImageBitmap=async(...args)=>{const options=args.at(-1);return {width:args.length>2?args[3]:options.resizeWidth||cell*(layer==='terrain'?2:1),height:args.length>2?args[4]:options.resizeHeight||cell,close(){closes++;}};};
  globalThis.fetch=async(url,options)=>{
    if(url.endsWith('manifest.json'))return {ok:true,json:async()=>({version:1,interior:cell-32,gutter:16,columns,rows,tiles:ids})};
    return new Promise((resolve,reject)=>{
      requests.push({url,resolve:()=>resolve({ok:true,blob:async()=>new Blob(['image'])}),signal:options.signal});
      options.signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});
    });
  };
  const gl={
    TEXTURE0:33984,LUMINANCE:6409,RGBA:6408,
    generateMipmap(){},getParameter:()=>8192,createTexture:()=>({}),activeTexture(){},bindTexture(){},texImage2D(){},texParameteri(){},pixelStorei(){},
    texSubImage2D(...args){uploads.push(args);},getUniformLocation:()=>({}),uniform1i(){},uniform2f(){},
    isContextLost:()=>false,deleteTexture(){deletes++;},
  };
  const flush=()=>new Promise(resolve=>setImmediate(resolve));
  let atlas;
  try{
    atlas=new SurfaceTiles(gl,true,()=>{},layer);
    const cells=layer==='galaxy'||layer==='terrain'?4:layer==='night'?8:6,capacity=Math.floor((cells*cells-1)/2);
    assert.equal(atlas.stats().gpuBytes,(layer==='day'||layer==='galaxy'||layer==='terrain')?4:1,'inactive atlas is a single texel');
    await flush();
    const first=layer==='galaxy'?galaxyView():issFrame(layer==='night'?0:3000,.22);
    atlas.update(first,1600,1100,{});
    assert.equal(atlas.stats().pending,3);
    assert.equal(atlas.stats().capacity,capacity);
    assert.equal(atlas.stats().gpuBytes,(cell*cells)**2*((layer==='day'||layer==='galaxy'||layer==='terrain')?4:1));
    const table=uploads.find(a=>a.length===9);
    assert.equal(table[6],(layer==='day'||layer==='galaxy'||layer==='terrain')?gl.RGBA:gl.LUMINANCE);
    assert.equal(table[8].length,columns*rows*2*((layer==='day'||layer==='galaxy'||layer==='terrain')?4:1));
    let processed=0;
    while(atlas.stats().pending){
      const batch=requests.slice(processed);processed=requests.length;
      batch.forEach(r=>r.resolve());await flush();
      assert.ok(atlas.stats().pending<=3);
    }
    assert.equal(atlas.stats().resident,atlas.stats().wanted);
    assert.ok(atlas.stats().resident<=capacity);
    assert.equal(closes,atlas.stats().resident*(layer==='terrain'?3:5));
    now+=1000;
    const program={};atlas.update(first,1600,1100,program);
    const uploaded=uploads.length;atlas.update(first,1600,1100,program);
    assert.equal(uploads.length,uploaded,'settled page table is not uploaded every frame');
    atlas.update(layer==='galaxy'?galaxyView(true):issFrame(layer==='night'?1000:3400,.22),1600,1100,{});
    assert.equal(atlas.stats().pending,3);
    const next=requests.slice(processed);next.forEach(r=>r.resolve());await flush();
    assert.ok(atlas.stats().resident<=capacity,'cache size stays bounded after a jump');
    assert.ok(uploads.filter(a=>a.length===7).every(a=>a[2]>=0&&a[3]>=0&&a[2]+a[6].width<=cell*cells&&a[3]+a[6].height<=cell*cells));
    const active=requests.slice(-3);
    now+=3000;atlas.update(layer==='galaxy'?galaxyView(false,true):issFrame(3000,-.16),1600,1100,program);await flush();
    now+=3000;atlas.update(layer==='galaxy'?galaxyView(false,true):issFrame(3000,-.16),1600,1100,program);
    assert.equal(atlas.stats().gpuBytes,(layer==='day'||layer==='galaxy'||layer==='terrain')?4:1,'offscreen atlas storage is released');
    atlas.dispose();await flush();
    assert.ok(active.every(r=>r.signal.aborted));
    assert.equal(deletes,1);
    assert.equal(atlas.stats().pending,0);
  }finally{
    atlas?.dispose();
    Object.assign(globalThis,originals);
  }
});
