import {test,afterEach,spyOn,mock} from 'bun:test';
import assert from 'node:assert/strict';
import {VNP46_DISPLAY_RANGE,nightTileShader} from '../src/scripts/surface-tile-shader.ts';
import { issFrame } from '../src/scripts/iss-orbit.ts';
import { tileAt, visibleSurfaceTiles, visibleGalaxyTiles, SurfaceTiles } from '../src/scripts/surface-tiles.ts';

const all=new Set(Array.from({length:12800},(_,i)=>i));
test('unresolved polar day/night detail uses the overview but close views still stream',()=>{
 for(const pole of [-1,1])for(const layer of ['day','night']){
  const view={camera:[0,0,pole*1.066],cameraBasis:[1,0,0,0,pole,0,0,0,-pole],sun:[0,0,layer==='day'?pole:-pole]};
  assert.deepEqual(visibleSurfaceTiles(view,1280,720,all,31,layer),[],`${layer} at pole ${pole}`);
  view.camera=[0,0,pole*1.001];view.focal=10;
  assert.ok(visibleSurfaceTiles(view,1280,720,all,31,layer).length>0,'Resolved close-up retains detail');
 }
});
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

for(const variant of ['night','night-vnp46','day','cloud','galaxy','terrain'])test(`${variant} atlas bounds loads, evicts after seek, closes decodes, and cancels on disposal`,async()=>{
  // night-vnp46: the lab's VNP46A4 tiles, with mipmaps packed like the galaxy's.
  const layer=variant==='night-vnp46'?'night':variant,packed=variant==='galaxy'||variant==='night-vnp46';
  let now=1000;spyOn(performance,'now').mockImplementation(()=>now);
  const cell=(layer==='cloud'||layer==='galaxy')?544:572,columns=layer==='terrain'?40:(layer==='cloud'||layer==='galaxy')?32:160,rows=layer==='terrain'?20:(layer==='cloud'||layer==='galaxy')?16:80;
  const ids=Array.from({length:columns*rows},(_,i)=>i);
  const originals={fetch:globalThis.fetch,createImageBitmap:globalThis.createImageBitmap,window:globalThis.window,document:globalThis.document,OffscreenCanvas:globalThis.OffscreenCanvas};
  const requests=[];let closes=0,deletes=0;const uploads=[];
  globalThis.window=globalThis;
  globalThis.document={hidden:false};
  globalThis.OffscreenCanvas=class{constructor(width,height){this.width=width;this.height=height;}getContext(){return {drawImage(){}};}transferToImageBitmap(){return {width:this.width,height:this.height,close(){closes++;}};}};
  globalThis.__resized=false;globalThis.createImageBitmap=async(...args)=>{const options=args.at(-1);if(options?.resizeWidth)globalThis.__resized=true;return {width:args.length>2?args[3]:options.resizeWidth||cell*(layer==='terrain'||packed?2:1),height:args.length>2?args[4]:options.resizeHeight||cell,close(){closes++;}};};
  globalThis.fetch=async(url,options)=>{
    if(url.endsWith('manifest.json'))return {ok:true,json:async()=>({version:packed?2:1,...(packed?{mipmaps:'packed'}:{}),interior:cell-32,gutter:16,columns,rows,tiles:ids})};
    assert.equal(url.includes('/night-vnp46-tiles/'),variant==='night-vnp46');
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
    atlas=new SurfaceTiles(gl,true,()=>{},layer,undefined,undefined,variant==='night-vnp46'?'night-vnp46-tiles':undefined);
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
    assert.equal(closes,atlas.stats().resident*(layer==='terrain'||packed?3:5));
    if(packed)assert.ok(!globalThis.__resized,'packed mipmaps are uploaded as built, never resized');
    assert.equal(atlas.stats().fading,atlas.stats().resident,'new images are still fading after network completion');
    const previousRevision=atlas.stats().revision;
    now+=1000;
    const program={};atlas.update(first,1600,1100,program);
    assert.equal(atlas.stats().fading,0);
    assert.ok(atlas.stats().revision>previousRevision,'committed coverage changes the lighting input revision');
    const settledRevision=atlas.stats().revision;
    const uploaded=uploads.length;atlas.update(first,1600,1100,program);
    assert.equal(uploads.length,uploaded,'settled page table is not uploaded every frame');
    assert.equal(atlas.stats().revision,settledRevision,'unchanged coverage does not restart lighting');
    atlas.update(layer==='galaxy'?galaxyView(true):issFrame(layer==='night'?1000:3400,.22),1600,1100,{});
    assert.equal(atlas.stats().pending,0,'fast motion does not bypass the selection interval');
    now+=181;
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

afterEach(()=>{mock.restore();});

test('magnified tiles reconstruct a cubic B-spline from four bilinear taps',()=>{
  // The shader's tap positions and weights, applied to a random grid with
  // ideal bilinear filtering, must equal the direct sixteen-texel B-spline.
  const n=12,grid=Array.from({length:n*n},()=>Math.random());
  const texel=(x,y)=>grid[Math.min(n-1,Math.max(0,y))*n+Math.min(n-1,Math.max(0,x))];
  const bilinear=(u,v)=>{const x=u-.5,y=v-.5,i=Math.floor(x),j=Math.floor(y),fx=x-i,fy=y-j;
    return (texel(i,j)*(1-fx)+texel(i+1,j)*fx)*(1-fy)+(texel(i,j+1)*(1-fx)+texel(i+1,j+1)*fx)*fy;};
  const weights=f=>[(1-f)**3/6,(4-6*f*f+3*f**3)/6,(1+3*f+3*f*f-3*f**3)/6,f**3/6];
  for(let k=0;k<200;k++){
    const u=4+Math.random()*4,v=4+Math.random()*4;
    const tx=u-.5,ty=v-.5,ix=Math.floor(tx),iy=Math.floor(ty),wx=weights(tx-ix),wy=weights(ty-iy);
    let direct=0;for(let b=0;b<4;b++)for(let a=0;a<4;a++)direct+=wx[a]*wy[b]*texel(ix-1+a,iy-1+b);
    const ax=wx[0]+wx[1],ay=wy[0]+wy[1],bx=1-ax,by=1-ay;
    const x0=ix-.5+wx[1]/ax,y0=iy-.5+wy[1]/ay,x1=ix+1.5+wx[3]/bx,y1=iy+1.5+wy[3]/by;
    const taps=ay*(ax*bilinear(x0,y0)+bx*bilinear(x1,y0))+by*(ax*bilinear(x0,y1)+bx*bilinear(x1,y1));
    assert.ok(Math.abs(taps-direct)<1e-12,`${taps} vs ${direct}`);
  }
});

test('colour and night layers reconstruct magnified detail; night uses its 30" grid',async()=>{
  const {nightTileShader,dayTileShader,galaxyTileShader,terrainTileShader,cloudTileShader}=await import('../src/scripts/surface-tile-shader.ts');
  for(const shader of [nightTileShader,dayTileShader,galaxyTileShader])assert.match(shader,/Smooth\(vec2 local,float slot\)/);
  assert.doesNotMatch(terrainTileShader,/Smooth\(/);
  // The plates' cloud tiles stay bilinear; only measured clouds (CLOUD_PROPERTIES) magnify.
  const measured=/\n#ifdef CLOUD_PROPERTIES\n[\s\S]*?\n#endif\n/g;
  assert.match(cloudTileShader,/#ifdef CLOUD_PROPERTIES\n[^#]*float cloudSmooth\(vec2 local,float slot\)/);
  assert.doesNotMatch(cloudTileShader.replace(measured,'\n'),/Smooth\(/);
  // Black Marble repeats each 30" value in 2 x 2 blocks: magnify level 1.
  assert.match(nightTileShader,/nightOrigin\(slot\+1\.\)\+vec2\(8\.\)\+local\*270\./);
  assert.match(nightTileShader,/smoothstep\(1\.0,2\.0,footprint\)/);
  assert.match(dayTileShader,/dayOrigin\(slot\)\+vec2\(16\.\)\+local\*540\./);
  assert.match(dayTileShader,/smoothstep\(0\.5,1\.0,footprint\)/);
});

// scripts/vnp46-transfer.py over all 540 granules, 2022-2024 radiance (nW) -> 2016 value.
const GLOBAL_BINS=[[1.2,.034],[1.7,.075],[2.39,.139],[3.36,.253],[4.74,.406],[6.67,.553],[9.39,.662],[13.23,.757],[18.63,.862],[22.11,.931]];

// The build's transfer (scripts/vnp46-global.py: A, R0, P, TOP), radiance -> stored code.
const displayed=L=>{const t=4.567*(Math.log(Math.max(L,1e-6))-Math.log(1.564));return .3572/4.567*(t>15?t:Math.log1p(Math.exp(Math.min(t,15))));};
const vnp46Code=L=>Math.min(2.88,displayed(L))/2.88;

test('VNP46A4 lab tiles interpolate their own 15" grid and carry the 2016 display scale',()=>{
  const night=nightTileShader;
  assert.ok(night.includes('#ifdef NIGHT_VNP46\nvec2 t=nightOrigin(slot)+vec2(16.)+local*540.'),'VNP46 samples level 0 of its independent 15 arcsecond grid');
  assert.match(night,/#ifdef NIGHT_VNP46\nfloat magnify=1\.-smoothstep\(0\.5,1\.0,footprint\);/);
  // The GLSL and the CPU calibration share the stored-code range. Verify the
  // shader's two policies directly; no parsing or execution of shader text.
  assert.ok(night.includes(`float encoded=code*${VNP46_DISPLAY_RANGE};
#ifdef NIGHT_VNP46_EXTENDED
  return encoded;
#else
  return min(1.,encoded);
#endif`));
  const extended=code=>code*VNP46_DISPLAY_RANGE;
  const encoded=L=>Math.min(1,extended(vnp46Code(L)));
  assert.ok(encoded(0)<1e-12&&Math.round(255*vnp46Code(0))===0,'dark land stores 0');
  // Global bins of the fit (vnp46-transfer.py): radiance -> median Black Marble 2016 value.
  for(const [L,e] of GLOBAL_BINS)assert.ok(Math.abs(encoded(L)-e)<.04,`${L} nW`);
  assert.ok(encoded(23)<1&&encoded(28)===1,'saturates near 26 nW like the 2016 plates');
  assert.ok(extended(vnp46Code(1000))>extended(vnp46Code(100))&&extended(vnp46Code(100))>1,'extended range keeps the slope');
  for(let L=.5;L<4900;L*=1.3)assert.ok(extended(vnp46Code(L*1.3))>extended(vnp46Code(L)),'monotonic');
  // Linear in the displayed value: a dark-to-lit ramp is not held black by the toe.
  for(const f of [.25,.5,.75])assert.ok(Math.abs(extended(f*vnp46Code(10))-f*extended(vnp46Code(10)))<1e-9);
});

test('the global VNP46A4 build converts its overview as the shader converts its tiles',async()=>{
  const {sceneAssetPlan,vnp46NightOverview}=await import('../src/scripts/scene-assets.ts');
  for(const desktop of [true,false]){
    const night=vnp46NightOverview(sceneAssetPlan(desktop,16384,false)).filter(asset=>asset.key==='night').map(asset=>asset.url);
    assert.deepEqual(night,['/media/earthlight/night-vnp46-tiles/preview-night.webp',`/media/earthlight/night-vnp46-tiles/earth-night${desktop?'-8k':''}.avif`]);
  }
  // scripts/vnp46-global.py's overview and build-night-vnp46.mjs's packed mips average nightVnp46Encoded.
  const python=await Bun.file(new URL('./vnp46-global.py',import.meta.url)).text();
  const builder=await Bun.file(new URL('./build-night-vnp46.mjs',import.meta.url)).text();
  assert.match(python,/A, R0, P = \.3572, 1\.564, 4\.567\n/);assert.match(python,/TOP = 2\.88 /);
  assert.match(builder,/const TOP = 2\.88;/);assert.match(nightTileShader,/code\*2\.88;/);
});
