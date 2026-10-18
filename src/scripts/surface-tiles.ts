import {AtlasResidency,TileRequests,type AtlasEntry as Resident} from './tile-residency.ts';
import {tileDimensions as dimensions,validateTileManifest,tileMipSizes,type SurfaceLayer as Layer} from './tile-layout.ts';
import {visibleSurfaceTiles,type SurfaceView as View} from './surface-tile-selection.ts';
export {TILE_SIZE,TILE_CELL,TILE_COLUMNS,TILE_ROWS} from './tile-layout.ts';
import {TILE_COLUMNS,TILE_ROWS} from './tile-layout.ts';
export {tileAt,visibleSurfaceTiles,visibleGalaxyTiles} from './surface-tile-selection.ts';
export {terrainTileShader,galaxyTileShader,nightTileShader,dayTileShader,cloudTileShader} from './surface-tile-shader.ts';
import {cropTextureBitmap} from './texture-bitmap.ts';
import {textureImage2D,textureSubImage2D} from './webgl-context.ts';
import { SceneWork, scenePriority } from './scene-work.ts';
import { DayPyramid, PYRAMID_TABLE } from './day-pyramid.ts';
// Bounded virtual textures: night lights in unit 7, daytime in 6, clouds in 9,
// and galaxy in 14. Units 6/14 are reused only AFTER the scene pass.
// Slot zero holds layer-sized lookup tables: resident slot and fade amount.
// Each resident tile uses two slots: an interior + 16 px gutters, and
// four individually filtered mip levels. No full-resolution CPU image cache.
export class SurfaceTiles {
  private work:SceneWork;
  private gl:WebGLRenderingContext;
  private texture:WebGLTexture|null;
  private columns:number;
  private edge:number;
  private capacity:number;
  private available=new Set<number>();
  private atlas:AtlasResidency<number>;
  private get resident(){return this.atlas.entries;}
  private wanted:number[]=[];
  private jobs=new TileRequests<number>();
  private get pending(){return this.jobs.pending;}
  private abort=new AbortController();
  private pages=new Uint8Array(TILE_COLUMNS*TILE_ROWS*2);
  private colorPages=new Uint8Array(TILE_COLUMNS*TILE_ROWS*8);
  private disposed=false;
  private timer=0;
  private lastSelection=-Infinity;
  private previousView:number[]=[];
  private selectionTimer=0;
  private wasMoving=false;
  private notify:()=>void;
  private layer:Layer;
  private format:number;
  private unit:number;
  private dimensions:ReturnType<typeof dimensions>;
  private allocated=false;
  private prepacked:boolean;
  private lastNeeded=0;
  private tableDirty=true;
  private revision=0;
  private uniforms=new WeakMap<WebGLProgram,{atlas:WebGLUniformLocation|null;layout:WebGLUniformLocation|null}>();
  private pyramid:DayPyramid|null=null;
  private detail=false;
  requests=0;
  bytes=0;
  deepBytes=0;
  // When the first deep day tile became resident (performance.now()), 0 before.
  deepFirst=0;

  // `directory` (below the asset base) replaces `<layer>-tiles` for lab data
  // in the same layout, such as measured cloud properties.
  constructor(gl:WebGLRenderingContext,mobile:boolean,notify:()=>void,layer:Layer='night',work=new SceneWork(),private assetBaseURL='/media/earthlight/',private directory=layer+'-tiles',pyramid=false){
    this.work=work;
    this.gl=gl;this.notify=notify;this.layer=layer;this.dimensions=dimensions(layer);this.prepacked=layer==='terrain'||layer==='galaxy';this.unit=layer==='terrain'?15:layer==='galaxy'?14:layer==='night'?7:layer==='day'?6:9;this.format=layer==='day'||layer==='galaxy'||layer==='terrain'?gl.RGBA:gl.LUMINANCE;
    const {columns,rows,cell}=this.dimensions;
    this.pages=new Uint8Array(columns*rows*2);this.colorPages=new Uint8Array(columns*rows*8);
    this.columns=Math.min((layer==='galaxy'||layer==='terrain')?(mobile?4:6):mobile&&layer!=='night'?6:8,Math.floor(gl.getParameter(gl.MAX_TEXTURE_SIZE)/cell));
    this.edge=this.columns*cell;this.capacity=Math.floor((this.columns*this.columns-1)/2);
    this.atlas=new AtlasResidency(1,this.columns*this.columns);
    this.texture=gl.createTexture();
    if(!this.texture||this.capacity<1)throw new Error('Cannot allocate surface tile atlas');
    this.bind();
    // A dormant layer needs a valid sampler, not an 80 MB empty atlas.
    textureImage2D(gl,gl.TEXTURE_2D,0,this.format,1,1,0,this.format,gl.UNSIGNED_BYTE,null);
    for(const axis of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,axis,gl.CLAMP_TO_EDGE);
    for(const filter of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,filter,gl.LINEAR);
    if(pyramid&&layer==='day')this.pyramid=new DayPyramid(assetBaseURL,this.abort.signal,()=>{this.lastSelection=-Infinity;this.notify();},(mobile?16:48)*2**20,undefined,work);
    this.work.network.run(scenePriority.tile,this.abort.signal,async()=>{
      const response=await fetch(this.assetBaseURL.replace(/\/+$/, '')+'/'+this.directory+'/manifest.json',{signal:this.abort.signal});
      if(!response.ok)throw new Error('Surface tile manifest unavailable');
      return response.json();
    }).then(data=>{
      // Galaxy tiles carry box mipmaps averaged in displayed radiance (version
      // 2), and so do the VNP46A4 night tiles (lab): a resize would average
      // their saturated cores above the 2016 ceiling.
      const manifest=validateTileManifest(data,this.layer),packed=manifest.mipmaps==='packed';
      if(this.disposed)return;
      this.prepacked||=packed;
      this.available=new Set(data.tiles);this.lastSelection=-Infinity;this.notify();
    }).catch(()=>{/* Keep the global map if detail is unavailable. */});
  }

  private bind(){
    this.gl.activeTexture(this.gl.TEXTURE0+this.unit);
    this.gl.bindTexture(this.gl.TEXTURE_2D,this.texture);
  }

  /** `detail` false holds back the day pyramid's deep tiles (a defocused frame). */
  update(view:View,width:number,height:number,program:WebGLProgram,detail=true){
    if(this.disposed)return;
    const {columns,rows}=this.dimensions;
    const count=columns*rows;
    const now=performance.now();
    if(this.wasMoving&&!this.work.moving)this.lastSelection=-Infinity;
    this.wasMoving=this.work.moving;
    const pose=[...Array.from(view.camera),...Array.from(view.cameraBasis),width,height,view.focal??1.25];
    // The buffer grows to full size a frame after focus is reached: the first
    // deep selection waits one selection interval for it.
    if(this.pyramid&&detail!==this.detail){
      this.detail=detail;
      if(detail){this.lastSelection=now;clearTimeout(this.selectionTimer);this.selectionTimer=window.setTimeout(()=>{this.selectionTimer=0;if(!this.disposed)this.notify();},181);}
    }
    // A fast swipe used to bypass the interval every frame for every layer,
    // repeatedly selecting and aborting tiles before they could finish loading.
    if(now-this.lastSelection>180){
      this.lastSelection=now;
      this.previousView=pose;clearTimeout(this.selectionTimer);this.selectionTimer=0;
      this.wanted=visibleSurfaceTiles(view,width,height,this.available,this.capacity,this.layer);
      // Deeper day levels share the atlas: at most half of it, ahead of BMNG.
      if(this.pyramid&&this.detail)this.wanted=[...this.pyramid.select(view,width,height,Math.floor(this.capacity/2)),...this.wanted].slice(0,this.capacity);
      this.jobs.retain(this.wanted);
      this.atlas.touch(this.wanted,now);
      if(this.wanted.length){
        this.lastNeeded=now;
        if(!this.allocated&&!this.work.moving){
          this.bind();textureImage2D(this.gl,this.gl.TEXTURE_2D,0,this.format,this.edge,this.edge,0,this.format,this.gl.UNSIGNED_BYTE,null);
          this.allocated=true;this.tableDirty=true;
        }
      }else if(this.allocated&&!this.work.moving&&now-this.lastNeeded>2000&&this.pending.size===0){
        this.bind();textureImage2D(this.gl,this.gl.TEXTURE_2D,0,this.format,1,1,0,this.format,this.gl.UNSIGNED_BYTE,null);
        this.allocated=false;this.resident.clear();this.pages.fill(0);this.tableDirty=true;
      }
      this.pump();
    }else if(!this.selectionTimer&&pose.some((v,i)=>Math.abs(v-this.previousView[i])>1e-6)){
      // Paused input may stop before the next selection. Revisit the final
      // pose even when no upload/fade would otherwise request another draw.
      this.selectionTimer=window.setTimeout(()=>{this.selectionTimer=0;if(!this.disposed)this.notify();},181-(now-this.lastSelection));
    }
    this.bind();
    if(!this.uniforms.has(program))this.uniforms.set(program,{atlas:this.gl.getUniformLocation(program,this.layer+'TileAtlas'),layout:this.gl.getUniformLocation(program,this.layer+'TileLayout')});
    const uniforms=this.uniforms.get(program)!;
    this.gl.uniform1i(uniforms.atlas,this.unit);
    this.gl.uniform2f(uniforms.layout,this.allocated?this.edge:0,this.columns);
    if(!this.allocated)return;
    if(this.tableDirty)this.pages.fill(0);
    let fading=false;
    for(const [id,entry] of this.resident){
      const fade=Math.max(0,Math.min(1,(now-entry.loaded)/650));
      fading ||= fade<1&&Number.isFinite(entry.loaded);
      if(id>=count)continue;
      const value=Math.round(fade*255);
      if(this.pages[id]!==entry.slot||this.pages[id+count]!==value)this.tableDirty=true;
      this.pages[id]=entry.slot;this.pages[id+count]=value;
    }
    if(this.pyramid?.write(this.resident,now))this.tableDirty=true;
    const gl=this.gl;
    if(this.tableDirty){
      gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);
      const table=this.format===gl.RGBA?this.colorPages:this.pages;
      if(this.format===gl.RGBA)for(let i=0;i<this.pages.length;i++)table[i*4]=this.pages[i];
      if(this.pyramid)for(let i=0;i<count;i++)table[i*4+1]=this.pyramid.directory[i];
      textureSubImage2D(gl,gl.TEXTURE_2D,0,0,0,columns,rows*2,this.format,gl.UNSIGNED_BYTE,table);
      if(this.pyramid)textureSubImage2D(gl,gl.TEXTURE_2D,0,PYRAMID_TABLE.x,PYRAMID_TABLE.y,PYRAMID_TABLE.width,PYRAMID_TABLE.height,gl.RGBA,gl.UNSIGNED_BYTE,this.pyramid.table);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT,4);this.tableDirty=false;this.revision++;
    }
    if(fading&&!this.timer)this.timer=window.setTimeout(()=>{this.timer=0;if(!this.disposed)this.notify();},42);
  }

  private pump(){
    if(this.disposed||document.hidden||!this.allocated||!this.atlas.canReserve(this.wanted))return;
    const cell=this.dimensions.cell;
    for(const id of this.wanted){
      if(this.pending.size>=3)break;
      if(this.resident.has(id))continue;
      const request=this.jobs.begin(id,id>=1e8?30000:12000);if(!request)continue;
      const {controller}=request;this.requests++;
      let reservation:Resident|null=null;
      this.work.network.run(scenePriority.tile,controller.signal,async()=>{
        // Deep day tiles come from their pack, fetched whole and cached.
        if(this.pyramid&&id>=1e8)return this.pyramid.load(id,controller.signal);
        const response=await fetch(this.assetBaseURL.replace(/\/+$/, '')+'/'+this.directory+'/'+id+(this.layer==='terrain'?'.png':'.avif'),{signal:controller.signal,priority:'low'});
        if(!response.ok)throw new Error('Surface tile unavailable');
        return response.blob();
      }).then(blob=>this.work.decode.run(scenePriority.tile,controller.signal,async()=>{
        this.bytes+=blob.size;if(id>=1e8)this.deepBytes+=blob.size;
        const image=await createImageBitmap(blob,{colorSpaceConversion:'none',premultiplyAlpha:'none'});
        try{
          if(this.disposed||controller.signal.aborted||!this.wanted.includes(id))return;
          if(image.width!==cell*(this.prepacked?2:1)||image.height!==cell)throw new Error('Invalid night tile dimensions');
          reservation=this.atlas.reserve(id,this.wanted,performance.now(),{});
          if(!reservation)return;
          const {slot}=reservation;this.tableDirty=true;
          if(this.prepacked){
            // Prepacked mipmaps: never resize packed heights, and never average
            // gamma-encoded galaxy texels, which shifts their displayed radiance.
            for(let half=0;half<2;half++){
              const square=await cropTextureBitmap(image,half*cell,0,cell,cell);
              try{await this.work.upload(scenePriority.tile,controller.signal,()=>{
                this.bind();const target=slot+half;
                textureSubImage2D(this.gl,this.gl.TEXTURE_2D,0,(target%this.columns)*cell,Math.floor(target/this.columns)*cell,this.format,this.gl.UNSIGNED_BYTE,square);
              });}finally{square.close();}
            }
            if(this.jobs.current(id,request)&&this.atlas.complete(id,reservation,performance.now())){this.tableDirty=true;this.notify();}return;
          }
          await this.work.upload(scenePriority.tile,controller.signal,()=>{
            this.bind();
            textureSubImage2D(this.gl,this.gl.TEXTURE_2D,0,(slot%this.columns)*cell,Math.floor(slot/this.columns)*cell,this.format,this.gl.UNSIGNED_BYTE,image);
          });
          const mipSlot=slot+1;
          let offset=0;
          for(const size of tileMipSizes(cell)){
            const mip=await createImageBitmap(image,{resizeWidth:size,resizeHeight:size,resizeQuality:'high',colorSpaceConversion:'none',premultiplyAlpha:'none'});
            try{
              if(!this.jobs.current(id,request))return;
              await this.work.upload(scenePriority.tile,controller.signal,()=>{
                this.bind();
                textureSubImage2D(this.gl,this.gl.TEXTURE_2D,0,(mipSlot%this.columns)*cell+offset,Math.floor(mipSlot/this.columns)*cell,this.format,this.gl.UNSIGNED_BYTE,mip);
              });
            }finally{mip.close();}
            offset+=size;
          }
          if(!this.jobs.current(id,request)||!this.atlas.complete(id,reservation,performance.now()))return;
          if(id>=1e8&&!this.deepFirst)this.deepFirst=performance.now();
          this.tableDirty=true;
          this.notify();
        }finally{image.close();}
      })).catch(()=>{if(!this.disposed&&!controller.signal.aborted&&this.wanted.includes(id))this.jobs.fail(id,request,30000);}).finally(()=>{
        if(reservation&&!Number.isFinite(reservation.loaded)){this.atlas.release(id,reservation);this.tableDirty=true;}
        this.jobs.finish(id,request);this.pump();
      });
    }
  }

  layout(){return [this.allocated?this.edge:0,this.columns];}
  stats(){const now=performance.now();return {revision:this.revision,fading:[...this.resident.values()].filter(entry=>now-entry.loaded<650).length,resident:this.resident.size,capacity:this.capacity,pending:this.pending.size,wanted:this.wanted.length,bytes:this.bytes,requests:this.requests,...(this.pyramid?{deep:[...this.resident.keys()].filter(id=>id>=1e8).length,deepWanted:this.pyramid.wanted,deepBytes:this.deepBytes,deepRequests:this.pyramid.requests,deepPackBytes:this.pyramid.received,deepCached:this.pyramid.cached,deepFirst:Math.round(this.deepFirst)}:{}),gpuBytes:(this.allocated?this.edge*this.edge:1)*(this.format===this.gl.RGBA?4:1)};}
  dispose(){
    this.disposed=true;this.abort.abort();clearTimeout(this.timer);clearTimeout(this.selectionTimer);
    this.jobs.dispose();this.atlas.clear();
    if(!this.gl.isContextLost())this.gl.deleteTexture(this.texture);
    this.texture=null;
  }
}
