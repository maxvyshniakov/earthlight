import {TerrainDecoder} from './terrain-decoder.ts';
import {cropTextureBitmap} from './texture-bitmap.ts';
import {textureImage2D,textureSubImage2D} from './webgl-context.ts';
import {SceneWork,scenePriority} from './scene-work.ts';
import {visibleSurfaceTiles} from './night-tiles.ts';
import {DEM_CELL as CELL,parentTerrainTile,terrainSourceName} from './terrain-detail.ts';
import {TerrainBound,boundCode,patchMaximum,tileCellMaxima} from './terrain-bound.ts';
type View=Parameters<typeof visibleSurfaceTiles>[0];
type Entry={slot:number;loaded:number;used:number;id:number;fine:boolean};
/** Raw RGBA of an untagged numeric tile. Returns null where 2D readback is unavailable. */
function bitmapPixels(image:ImageBitmap,width:number,height:number){
 try{
  const canvas=typeof OffscreenCanvas==='function'?new OffscreenCanvas(width,height):Object.assign(document.createElement('canvas'),{width,height});
  const context=canvas.getContext('2d',{willReadFrequently:true}) as OffscreenCanvasRenderingContext2D|CanvasRenderingContext2D|null;
  if(!context)return null;
  context.drawImage(image,0,0,width,height,0,0,width,height);
  return context.getImageData(0,0,width,height).data;
 }catch{return null;}
}
/** Both resolutions share unit 15 and a bounded atlas. The first row stores
 * indirection tables; other cells store paired height/mip squares. */
export class TerrainStream {
 private texture:WebGLTexture|null;
 private columns:number;
 private edge:number;
 private capacity:number;
 private coarse=new Set<number>();
 private fine=new Set<number>();
 private entries=new Map<string,Entry>();
 private wanted:string[]=[];
 private pending=new Map<string,AbortController>();
 private failed=new Map<string,number>();
 private parents=new Map<number,{controller:AbortController;promise:Promise<Uint8Array[]>}>();
 private parentCache=new Map<number,Uint8Array[]>();
 private decoder:TerrainDecoder;
 private packedDecoder:TerrainDecoder;
 private packed=new Set<number>();
 private packedDisabled=new Set<number>();
 private packedManifest:Promise<void>=Promise.resolve();
 private packedFallbacks=0;packedDecodes=0;
 private abort=new AbortController();
 private disposed=false;
 private allocated=false;
 private selected=-Infinity;
 private wasMoving=false;
 private needed=0;
 private timer=0;
 private pages=new Uint8Array(800*360*4);
 private bound:TerrainBound|null;
 private boundTexels=0;
 private pageKeys=new Set<number>();
 private locations=new WeakMap<WebGLProgram,{atlas:WebGLUniformLocation|null;layout:WebGLUniformLocation|null}>();
 requests=0;bytes=0;failures=0;decodes=0;
 private gl:WebGLRenderingContext;private mobile:boolean;private notify:()=>void;private work:SceneWork;
 constructor(gl:WebGLRenderingContext,mobile:boolean,notify:()=>void,work=new SceneWork(),private assetBaseURL='/media/earthlight/',private terrainBaseURL='/media/earthlight/dem90/',private uploadMode:'strips'|'tile'='strips',private cacheMode:'small'|'working'='working',private decoderMode:'single'|'pool'='single',private sourceMode:'tiff'|'packed'='tiff',private boundMode:'off'|'regional'='off'){
  this.gl=gl;this.bound=boundMode==='regional'?new TerrainBound():null;this.mobile=mobile;this.notify=notify;this.work=work;
  this.decoder=new TerrainDecoder(decoderMode);this.packedDecoder=new TerrainDecoder(decoderMode,'packed');
  if(sourceMode==='packed')this.packedManifest=work.network.run(scenePriority.tile,this.abort.signal,async()=>{
   const r=await fetch(this.assetBaseURL.replace(/\/+$/, '')+'/terrain-packed/v1/manifest.json',{signal:AbortSignal.any([this.abort.signal,AbortSignal.timeout(8000)])});
   if(!r.ok)throw Error('Packed terrain manifest unavailable');const manifest=await r.json();
   if(manifest.version!==1||!Array.isArray(manifest.files)||!manifest.files.every((f:{id:number})=>Number.isInteger(f.id)&&f.id>=0&&f.id<64800))throw Error('Invalid packed terrain manifest');
   if(!this.disposed)for(const f of manifest.files)this.packed.add(f.id);
  }).catch(()=>{});
  this.columns=mobile?4:6;this.edge=CELL*this.columns;this.capacity=(this.columns*this.columns-this.columns)/2;
  this.texture=gl.createTexture();if(!this.texture)throw Error('Cannot allocate terrain atlas');
  this.bind();textureImage2D(gl,gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
  for(const axis of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,axis,gl.CLAMP_TO_EDGE);
  for(const filter of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,filter,gl.LINEAR);
  for(const fine of [false,true])void work.network.run(scenePriority.tile,this.abort.signal,async()=>{
   const r=await fetch(this.assetBaseURL.replace(/\/+$/, '')+'/terrain-tiles/'+(fine?'copernicus.json':'manifest.json'),{signal:this.abort.signal});if(!r.ok)throw Error('Terrain manifest unavailable');return r.json();
  }).then(data=>{
   if(this.disposed)return;const ids=fine?data:data.tiles;
   if(!Array.isArray(ids)||!ids.every(id=>Number.isInteger(id)&&id>=0&&id<(fine?64800:800)))throw Error('Invalid terrain manifest');
   if(fine)for(const id of ids){const x=id%360,y=Math.floor(id/360);for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++)this.fine.add((y*2+dy)*720+x*2+dx);}
   else this.coarse=new Set(ids);
   this.selected=-Infinity;this.notify();
  }).catch(()=>{});
 }
 /** Global maxima must arrive before any bound is published. */
 setGlobalBound(grid:Uint8Array){if(this.bound&&!this.disposed){this.bound.raiseGrid(grid);this.notify();}}
 private bind(){this.gl.activeTexture(this.gl.TEXTURE15);this.gl.bindTexture(this.gl.TEXTURE_2D,this.texture);}
 update(view:View,width:number,height:number,program:WebGLProgram){
  if(this.disposed)return;const now=performance.now(),gl=this.gl;
  if(this.wasMoving&&!this.work.moving)this.selected=-Infinity;
  this.wasMoving=this.work.moving;
  if(now-this.selected>250){
   this.selected=now;
   const fine=visibleSurfaceTiles(view,width,height,this.fine,this.capacity-(this.mobile?2:5),'terrainFine');
   const coarse=visibleSurfaceTiles(view,width,height,this.coarse,fine.length?(this.mobile?2:5):this.capacity,'terrain');
   this.wanted=[...coarse.map(id=>'c'+id),...fine.map(id=>'f'+id)];
   const parents=new Set(fine.map(parentTerrainTile));
   for(const [id,p] of this.parents)if(!parents.has(id))p.controller.abort();
   for(const [key,c] of this.pending)if(!this.wanted.includes(key))c.abort();
   for(const key of this.wanted){const e=this.entries.get(key);if(e)e.used=now;}
   if(this.wanted.length){this.needed=now;if(!this.allocated&&!this.work.moving){this.bind();textureImage2D(gl,gl.TEXTURE_2D,0,gl.RGBA,this.edge,this.edge,0,gl.RGBA,gl.UNSIGNED_BYTE,null);this.allocated=true;this.pages.fill(0);this.pageKeys.clear();this.bound?.invalidate();}}
   else if(this.allocated&&!this.work.moving&&now-this.needed>2000&&!this.pending.size){this.bind();textureImage2D(gl,gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,null);this.allocated=false;this.entries.clear();this.parentCache.clear();}
   this.pump();
  }
  this.bind();if(!this.locations.has(program))this.locations.set(program,{atlas:gl.getUniformLocation(program,'terrainTileAtlas'),layout:gl.getUniformLocation(program,'terrainTileLayout')});
  const u=this.locations.get(program)!;gl.uniform1i(u.atlas,15);gl.uniform2f(u.layout,this.allocated?this.edge:0,this.columns);
  if(!this.allocated)return;
  // Raise bounds before any page entry can expose the tiles that raised them.
  if(this.bound)this.boundTexels+=this.bound.flush((x,y,w,h,data)=>textureSubImage2D(gl,gl.TEXTURE_2D,0,x,y,w,h,gl.RGBA,gl.UNSIGNED_BYTE,data));
  const active=new Set<number>(),changes:number[]=[];let fading=false;
  const fade=(e?:Entry)=>e?Math.max(0,Math.min(1,(now-e.loaded)/800)):0;
  for(const e of this.entries.values()){
   if(!Number.isFinite(e.loaded))continue;
   const cols=e.fine?720:40,rows=e.fine?360:20,x=e.id%cols,y=Math.floor(e.id/cols),prefix=e.fine?'f':'c';
   const neighbors=[[x-1,y],[x+1,y],[x,y-1],[x,y+1]].map(([nx,ny])=>prefix+(Math.max(0,Math.min(rows-1,ny))*cols+(nx+cols)%cols));
   const p=(y*800+x+(e.fine?0:720))*4;active.add(p);
   const nf=neighbors.map(k=>Math.round(fade(this.entries.get(k))*15));
   const value=[e.slot,Math.round(fade(e)*255),nf[0]*16+nf[1],nf[2]*16+nf[3]];
   if(value.some((v,i)=>v!==this.pages[p+i])){this.pages.set(value,p);changes.push(p);}
   fading ||= fade(e)<1;
  }
  for(const p of this.pageKeys)if(!active.has(p)){this.pages.fill(0,p,p+4);changes.push(p);}
  this.pageKeys=active;
  for(const p of changes)textureSubImage2D(gl,gl.TEXTURE_2D,0,(p/4)%800,Math.floor(p/4/800),1,1,gl.RGBA,gl.UNSIGNED_BYTE,this.pages.subarray(p,p+4));
  if(fading&&!this.timer)this.timer=window.setTimeout(()=>{this.timer=0;this.notify();},50);
 }
 private decode(buffer:ArrayBuffer,parent:number,signal:AbortSignal,packed=false){
  this.decodes++;if(packed)this.packedDecodes++;
  return (packed?this.packedDecoder:this.decoder).run(buffer,parent,signal);
 }
 private async loadParent(parent:number,signal:AbortSignal){
  await this.packedManifest;if(signal.aborted)throw Error('Terrain decode cancelled');
  const packed=this.packed.has(parent)&&!this.packedDisabled.has(parent);
  const fetchDecode=async(usePacked:boolean)=>{
   const url=usePacked?this.assetBaseURL.replace(/\/+$/, '')+'/terrain-packed/v1/'+terrainSourceName(parent)+'.dem':this.terrainBaseURL.replace(/\/+$/, '')+'/'+terrainSourceName(parent)+'.tif';
   const buffer=await this.work.network.run(scenePriority.tile,signal,async()=>{
    const r=await fetch(url,{signal,priority:'low'});if(!r.ok)throw Error('DEM unavailable');const b=await r.arrayBuffer();this.bytes+=b.byteLength;return b;
   });
   return this.work.decode.run(scenePriority.tile,signal,()=>this.decode(buffer,parent,signal,usePacked));
  };
  if(packed){try{return await fetchDecode(true);}catch(error){if(signal.aborted||this.disposed)throw error;this.packedDisabled.add(parent);this.packedFallbacks++;}}
  return fetchDecode(false);
 }
 private fineData(id:number){
  const parent=parentTerrainTile(id),cached=this.parentCache.get(parent);
  if(cached){this.parentCache.delete(parent);this.parentCache.set(parent,cached);return Promise.resolve(cached);}
  const pending=this.parents.get(parent);if(pending&&!pending.controller.signal.aborted)return pending.promise;
  const controller=new AbortController(),signal=controller.signal;
  this.requests++;
  const promise=this.loadParent(parent,signal).then(patches=>{
   if(!this.disposed&&!signal.aborted){this.parentCache.set(parent,patches);while(this.parentCache.size>(this.cacheMode==='working'?(this.mobile?4:6):2)){
     const wanted=new Set(this.wanted.filter(k=>k[0]==='f').map(k=>parentTerrainTile(Number(k.slice(1)))));
     const stale=(this.cacheMode==='working'?[...this.parentCache.keys()].find(id=>!wanted.has(id)):undefined)??this.parentCache.keys().next().value!;
     this.parentCache.delete(stale);
    }}return patches;
  }).finally(()=>{if(this.parents.get(parent)?.controller===controller)this.parents.delete(parent);});
  this.parents.set(parent,{controller,promise});return promise;
 }
 private pump(){
  if(this.disposed||document.hidden||!this.allocated)return;
  for(const key of this.wanted){
   if(this.pending.size>=2)break;
   if(this.entries.has(key)||this.pending.has(key)||(this.failed.get(key)??0)>performance.now())continue;
   const fine=key[0]==='f',id=Number(key.slice(1)),controller=new AbortController(),signal=controller.signal;
   let timedOut=false;this.pending.set(key,controller);const timeout=window.setTimeout(()=>{timedOut=true;controller.abort();if(fine)this.parents.get(parentTerrainTile(id))?.controller.abort();},25000);
   void (async()=>{
    let pixels:Uint8Array|undefined,image:ImageBitmap|undefined;
    try{
     if(fine){const patches=await this.fineData(id);pixels=patches[(Math.floor(id/720)%2)*2+id%2];}
     else{this.requests++;const blob=await this.work.network.run(scenePriority.tile,signal,async()=>{const r=await fetch(this.assetBaseURL.replace(/\/+$/, '')+'/terrain-tiles/'+id+'.png',{signal});if(!r.ok)throw Error('Terrain unavailable');return r.blob();});this.bytes+=blob.size;image=await this.work.decode.run(scenePriority.tile,signal,()=>createImageBitmap(blob,{colorSpaceConversion:'none',premultiplyAlpha:'none'}));}
     if(this.disposed||signal.aborted||!this.wanted.includes(key))return;
     if(this.bound){
      if(pixels)this.bound.raise(id%720,Math.floor(id/720),boundCode(patchMaximum(pixels,CELL)));
      else if(image){
       // Unreadable pixels publish "no bound" (255) for the whole tile.
       const data=bitmapPixels(image,572,572),maxima=data?tileCellMaxima(data):null;
       for(let i=0;i<18*18;i++)this.bound.raise((id%40)*18+i%18,Math.floor(id/40)*18+Math.floor(i/18),maxima?boundCode(maxima[i]):255);
      }
     }
     let slot=0;const used=new Set([...this.entries.values()].map(e=>e.slot));
     for(let i=this.columns;i<this.columns*this.columns-1;i+=2)if(!used.has(i)){slot=i;break;}
     if(!slot){const stale=[...this.entries].filter(([k])=>!this.wanted.includes(k)).sort((a,b)=>a[1].used-b[1].used)[0];if(!stale)return;slot=stale[1].slot;this.entries.delete(stale[0]);}
     this.entries.set(key,{slot,loaded:Infinity,used:performance.now(),fine,id});
     const cell=fine?CELL:572;
     if(image&&(image.width!==cell*2||image.height!==cell))throw Error('Invalid terrain tile');
     if(pixels&&this.uploadMode==='tile'){
      // Paired cells always share an atlas row (both layouts have even columns).
      // Upload the worker's existing packed buffer once, without interleaving
      // twenty writes with draws that sample the same texture.
      await this.work.upload(scenePriority.tile,signal,()=>{this.bind();textureSubImage2D(this.gl,this.gl.TEXTURE_2D,0,slot%this.columns*CELL,Math.floor(slot/this.columns)*CELL,cell*2,cell,this.gl.RGBA,this.gl.UNSIGNED_BYTE,pixels!);});
     }else for(let half=0;half<2;half++){
      if(pixels){for(let y=0;y<cell;y+=64){const rows=Math.min(64,cell-y),strip=new Uint8Array(cell*rows*4);for(let row=0;row<rows;row++)strip.set(pixels.subarray(((y+row)*cell*2+half*cell)*4,((y+row)*cell*2+half*cell+cell)*4),row*cell*4);
       await this.work.upload(scenePriority.tile,signal,()=>{this.bind();const s=slot+half;textureSubImage2D(this.gl,this.gl.TEXTURE_2D,0,s%this.columns*CELL,Math.floor(s/this.columns)*CELL+y,cell,rows,this.gl.RGBA,this.gl.UNSIGNED_BYTE,strip);});}}
      else if(image){const part=await cropTextureBitmap(image,half*cell,0,cell,cell);try{await this.work.upload(scenePriority.tile,signal,()=>{this.bind();const s=slot+half;textureSubImage2D(this.gl,this.gl.TEXTURE_2D,0,s%this.columns*CELL,Math.floor(s/this.columns)*CELL,this.gl.RGBA,this.gl.UNSIGNED_BYTE,part);});}finally{part.close();}}
     }
     this.entries.set(key,{slot,loaded:performance.now(),used:performance.now(),fine,id});this.notify();
    }finally{image?.close();}
   })().catch(()=>{if(this.entries.get(key)?.loaded===Infinity)this.entries.delete(key);if(!this.disposed&&(!signal.aborted||timedOut)){this.failed.set(key,performance.now()+60000);this.failures++;}}).finally(()=>{clearTimeout(timeout);this.pending.delete(key);this.pump();});
  }
 }
 stats(){return {resident:this.entries.size,fineResident:[...this.entries.values()].filter(e=>e.fine&&Number.isFinite(e.loaded)).length,fineWanted:this.wanted.filter(key=>key[0]==='f').length,capacity:this.capacity,pending:this.pending.size,wanted:this.wanted.length,bytes:this.bytes,requests:this.requests,failures:this.failures,uploadMode:this.uploadMode,cacheMode:this.cacheMode,decoderMode:this.decoderMode,sourceMode:this.sourceMode,workersCreated:this.decoder.created+this.packedDecoder.created,workersLive:this.decoder.live+this.packedDecoder.live,decodeMs:this.decoder.milliseconds+this.packedDecoder.milliseconds,packedDecodes:this.packedDecodes,packedFallbacks:this.packedFallbacks,decodes:this.decodes,decodedParents:this.parentCache.size,decodedBytes:[...this.parentCache.values()].reduce((n,patches)=>n+patches.reduce((s,p)=>s+p.byteLength,0),0),boundMode:this.boundMode,boundReady:!!this.bound?.ready,boundCells:this.bound?.cells??0,boundTexels:this.boundTexels,gpuBytes:this.allocated?this.edge*this.edge*4:4};}
 dispose(){this.disposed=true;this.abort.abort();clearTimeout(this.timer);for(const c of this.pending.values())c.abort();for(const p of this.parents.values())p.controller.abort();this.decoder.dispose();this.packedDecoder.dispose();this.pending.clear();this.entries.clear();this.parentCache.clear();if(!this.gl.isContextLost())this.gl.deleteTexture(this.texture);this.texture=null;}
}
