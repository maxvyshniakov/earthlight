import {cropTextureBitmap} from './texture-bitmap.ts';
import {textureImage2D,textureSubImage2D} from './webgl-context.ts';
import { SceneWork, scenePriority } from './scene-work.ts';
// Bounded virtual textures: night lights in unit 7, daytime in 6, clouds in 9,
// and galaxy in 14. Units 6/14 are reused only AFTER the scene pass.
// Slot zero holds layer-sized lookup tables: resident slot and fade amount.
// Each resident tile uses two slots: an interior + 16 px gutters, and
// four individually filtered mip levels. No full-resolution CPU image cache.
export const TILE_SIZE=540;
export const TILE_CELL=572;
export const TILE_COLUMNS=160;
export const TILE_ROWS=80;
type Layer='night'|'day'|'cloud'|'galaxy'|'terrain'|'terrainFine';
const dimensions=(layer:Layer)=>layer==='terrainFine'?{columns:720,rows:360,interior:600,cell:632}:layer==='terrain'?{columns:40,rows:20,interior:540,cell:572}:(layer==='cloud'||layer==='galaxy')?{columns:32,rows:16,interior:512,cell:544}: {columns:160,rows:80,interior:540,cell:572};

function tileShader(layer:Layer){
  const {columns,rows,interior,cell}=dimensions(layer);
  const valueType=layer==='day'||layer==='galaxy'||layer==='terrain'?'vec3':'float';
  const channel=layer==='day'||layer==='galaxy'||layer==='terrain'?'rgb':'r';
  // Terrain packs height bytes, and clouds are sampled along every view ray.
  const smooth=layer==='night'||layer==='day'||layer==='galaxy';
  // Tile texels per independent source sample (see the night-light note below).
  const sampleSpacing=layer==='night'?2:1;
  return `
uniform sampler2D ${layer}TileAtlas;
uniform vec2 ${layer}TileLayout;
vec2 ${layer}Origin(float slot){return vec2(mod(slot,${layer}TileLayout.y),floor(slot/${layer}TileLayout.y))*${cell}.;}
float ${layer}Fade(vec2 key){
  key=vec2(mod(key.x+${columns}.,${columns}.),clamp(key.y,0.,${rows-1}.));
  return texture2D(${layer}TileAtlas,(key+vec2(.5,${rows+.5}))/${layer}TileLayout.x).r;
}
${valueType} ${layer}Level(vec2 local,float slot,float level){
  vec2 origin=${layer}Origin(slot);
  float size=${cell}.;
  if(level>.5){
    origin=${layer}Origin(slot+1.);
    size=${cell/2}.;
    if(level>1.5){origin.x+=${cell/2}.;size=${cell/4}.;}
    if(level>2.5){origin.x+=${cell/4}.;size=${Math.ceil(cell/8)}.;}
    if(level>3.5){origin.x+=${Math.ceil(cell/8)}.;size=${Math.ceil(cell/16)}.;}
  }
  vec2 p=origin+(vec2(16.)+local*${interior}.)/${cell}.*size;
  return texture2D(${layer}TileAtlas,p/${layer}TileLayout.x).${channel};
}
${smooth?`
// Magnified source grid as a cubic B-spline from four bilinear taps. A
// bilinear ramp between contrasting texels, through the tone curve and the
// camera's clip, reads as a square. The kernel is positive and sums to one:
// no ringing around clipped city cores, no detail beyond the source's own
// resolution. Black Marble's 15" plates repeat each 30" value in 2 x 2 blocks
// aligned to the tile, so night lights interpolate their level 1 instead.
${valueType} ${layer}Smooth(vec2 local,float slot){
  vec2 t=${sampleSpacing>1?`${layer}Origin(slot+1.)+vec2(8.)+local*${interior/2}.`:`${layer}Origin(slot)+vec2(16.)+local*${interior}.`}-.5;
  vec2 i=floor(t),f=t-i,g=f*f,c=g*f;
  vec2 w0=(1.-3.*f+3.*g-c)/6.,w1=(4.-6.*g+3.*c)/6.,w3=c/6.;
  vec2 a=w0+w1,b=1.-a;
  vec2 p0=(i-.5+w1/a)/${layer}TileLayout.x,p1=(i+1.5+w3/b)/${layer}TileLayout.x;
  return a.y*(a.x*texture2D(${layer}TileAtlas,p0).${channel}+b.x*texture2D(${layer}TileAtlas,vec2(p1.x,p0.y)).${channel})
        +b.y*(a.x*texture2D(${layer}TileAtlas,vec2(p0.x,p1.y)).${channel}+b.x*texture2D(${layer}TileAtlas,p1).${channel});
}
`:''}
// Explicit trilinear filtering of isolated mip levels; smooth > 0 only while
// magnifying, where lod is zero.
${valueType} ${layer}Sample(vec2 local,float slot,float lod,float smooth){
  ${valueType} light=smooth<1.?${layer}Level(local,slot,floor(lod)):${valueType}(0.);
  ${smooth?`if(smooth>0.)light=mix(light,${layer}Smooth(local,slot),smooth);`:''}
  if(fract(lod)>0.)light=mix(light,${layer}Level(local,slot,min(4.,floor(lod)+1.)),fract(lod));
  return light;
}
${layer==='day'||layer==='cloud'?`
${valueType} ${layer}Neighbor(vec2 key,vec2 local,float lod,float smooth,${valueType} fallback){
 if(key.y<0.||key.y>=${rows}.)return fallback;
 key=vec2(mod(key.x+${columns}.,${columns}.),clamp(key.y,0.,${rows-1}.));
 float slot=floor(texture2D(${layer}TileAtlas,(key+.5)/${layer}TileLayout.x).r*255.+.5);
 if(slot<.5||${layer}Fade(key)<=0.)return fallback;
 return ${layer}Sample(local,slot,lod,smooth);
}
`:''}
${valueType} detailed${layer==='night'?'Night':layer==='day'?'Day':layer==='galaxy'?'Galaxy':layer==='terrain'?'Terrain':'Cloud'}(vec2 uv,float footprint,${valueType} fallback) {
  if(${layer}TileLayout.x<1. || footprint>=${layer==='cloud'||layer==='galaxy'?'4.':'32.'})return fallback;
  vec2 grid=vec2(fract(uv.x),clamp(1.-uv.y,0.,.999999))*vec2(${columns}.,${rows}.);
  vec2 key=floor(grid);
  float slot=floor(texture2D(${layer}TileAtlas,(key+.5)/${layer}TileLayout.x).r*255.+.5);
  if(slot<.5)return fallback;
  float fade=${layer}Fade(key);
  vec2 local=fract(grid);
  // Each shared edge uses the same pair of fades on both sides. A single
  // minimum over all neighbours creates seams when an unrelated edge is empty.
  vec2 edge=smoothstep(vec2(0.),vec2(.03),min(local,1.-local));
  vec2 stepTo=vec2(local.x<.5?-1.:1.,local.y<.5?-1.:1.);
  if(edge.x<1.)fade*=mix(${layer}Fade(key+vec2(stepTo.x,0.)),1.,edge.x);
  if(edge.y<1.)fade*=mix(${layer}Fade(key+vec2(0.,stepTo.y)),1.,edge.y);
  // At corners all four tiles must agree, including the diagonal neighbour.
  if(edge.x<1.&&edge.y<1.)fade*=mix(${layer}Fade(key+stepTo),1.,max(edge.x,edge.y));
  float lod=clamp(log2(max(1.,footprint*${layer==='cloud'||layer==='galaxy'||layer==='terrain'?'1.':'.5'})),0.,4.);
  // At four source texels the cloud overview resolves this footprint already.
  // Mip gutters contain actual neighboring geography, including across the
  // NASA source plates. Smoothing reaches full weight at two pixels per
  // source sample.
  float smooth=${smooth?`1.-smoothstep(${(sampleSpacing*.5).toFixed(1)},${sampleSpacing.toFixed(1)},footprint)`:'0.'};
  ${valueType} light=${layer}Sample(local,slot,lod,smooth);
  ${layer==='day'||layer==='cloud'?`
  // Independently compressed photos disagree even when both tiles are loaded.
  // Average the SAME geography from their existing overlap, symmetrically at
  // edges/corners. Keep the filter inside the coarsest sampled mip's gutter.
  float band=(16.-.5*exp2(ceil(lod)))/${interior}.;
  vec2 blend=.5*(1.-smoothstep(vec2(0.),vec2(band),min(local,1.-local)));
  if(blend.x>0.||blend.y>0.){
    ${valueType} horizontal=light,vertical=light,diagonal=light;
    if(blend.x>0.)horizontal=${layer}Neighbor(key+vec2(stepTo.x,0.),local-vec2(stepTo.x,0.),lod,smooth,light);
    if(blend.y>0.)vertical=${layer}Neighbor(key+vec2(0.,stepTo.y),local-vec2(0.,stepTo.y),lod,smooth,light);
    if(blend.x>0.&&blend.y>0.)diagonal=${layer}Neighbor(key+stepTo,local-stepTo,lod,smooth,light);
    light=mix(mix(light,horizontal,blend.x),mix(vertical,diagonal,blend.x),blend.y);
  }
  `:''}
  return mix(fallback,light,fade*(1.-smoothstep(${layer==='cloud'||layer==='galaxy'?'2.5,4.':'20.,32.'},footprint)));
}
`;
}
export const terrainTileShader=tileShader('terrain');
export const galaxyTileShader=tileShader('galaxy');
export const nightTileShader=tileShader('night');
export const dayTileShader=tileShader('day');
export const cloudTileShader='#ifdef CLOUD_TILES\n'+tileShader('cloud')+'\n#else\nfloat detailedCloud(vec2 uv,float footprint,float fallback){return fallback;}\n#endif\n';


type View={camera:ArrayLike<number>;cameraBasis:ArrayLike<number>;sun:ArrayLike<number>;galacticBasis?:ArrayLike<number>;focal?:number};
export function tileAt(longitude:number,latitude:number){
  const x=Math.floor(((longitude+180)%360+360)%360/360*TILE_COLUMNS);
  const y=Math.min(TILE_ROWS-1,Math.max(0,Math.floor((90-latitude)/180*TILE_ROWS)));
  return y*TILE_COLUMNS+x;
}

// Sample ground rays, prioritize the nearest night-side detail, and guard one
// tile around each hit so movement doesn't continually expose unloaded edges.
export function visibleSurfaceTiles(view:View,width:number,height:number,available:Set<number>,limit:number,layer:Layer='night'){
  if(layer==='galaxy')return visibleGalaxyTiles(view,width,height,available,limit);
  const {columns,rows,interior}=dimensions(layer);
  const radius=layer==='cloud'?1.0018835:1;
  const scores=new Map<number,number>(),visible=new Set<number>();
  const c=view.camera,m=view.cameraBasis,sun=view.sun,focal=view.focal??1.25;
  const camera2=c[0]*c[0]+c[1]*c[1]+c[2]*c[2];
  for(let iy=0;iy<28;iy++)for(let ix=0;ix<64;ix++){
    const vx=((ix+.5)/64-.5)*width/height,vy=.5-(iy+.5)/28,vz=focal;
    let x=m[0]*vx+m[3]*vy+m[6]*vz,y=m[1]*vx+m[4]*vy+m[7]*vz,z=m[2]*vx+m[5]*vy+m[8]*vz;
    const length=Math.hypot(x,y,z);x/=length;y/=length;z/=length;
    const b=c[0]*x+c[1]*y+c[2]*z,disc=b*b-camera2+radius*radius;
    if(b>=0||disc<=0)continue;
    const distance=-b-Math.sqrt(disc);
    const gx=c[0]+x*distance,gy=c[1]+y*distance,gz=c[2]+z*distance;
    const solar=gx*sun[0]+gy*sun[1]+gz*sun[2];
    if(layer!=='cloud'&&layer!=='terrain'&&layer!=='terrainFine'&&(layer==='night'?solar>.08:solar<-.12))continue;
    // Match the day/night shader's longitude footprint before fetching tiles
    // that it would immediately replace with the filtered overview at a pole.
    const longitudeScale=layer==='day'||layer==='night'?Math.max(.02,Math.hypot(gx,gy)/radius):1;
    const footprint=distance*(columns*interior/(2*Math.PI))/(height*focal*Math.max(.02,-gx*x-gy*y-gz*z)*longitudeScale);
    if(footprint>=32)continue;
    const kx=Math.min(columns-1,Math.floor((Math.atan2(gy,gx)/(2*Math.PI)+.5)*columns));
    const ky=Math.min(rows-1,Math.max(0,Math.floor((.5-Math.asin(Math.max(-1,Math.min(1,gz/radius)))/Math.PI)*rows)));
    visible.add(ky*columns+kx);
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      if(ky+dy<0||ky+dy>=rows)continue;
      const id=(ky+dy)*columns+(kx+dx+columns)%columns;
      if(!available.has(id))continue;
      const focus=layer==='terrainFine'?1+12*(((ix+.5)/64-.5)**2+((iy+.5)/28-.5)**2):1;
      const score=footprint*focus+Math.hypot(dx,dy)*2;
      scores.set(id,Math.min(scores.get(id)??Infinity,score));
    }
  }
  // On-screen detail precedes the speculative guard band. Otherwise a close
  // off-screen neighbor can evict a city that is already visible farther away.
  return [...scores].sort((a,b)=>Number(visible.has(b[0]))-Number(visible.has(a[0]))||a[1]-b[1]).slice(0,limit).map(([id])=>id);
}

/** Select only visible, unoccluded sky, with centre detail before neighbours.
 * The catalog basis columns match dot(direction, galacticBasis[i]) in GLSL. */
export function visibleGalaxyTiles(view:View,width:number,height:number,available:Set<number>,limit:number){
  const g=view.galacticBasis;if(!g||height<=0)return [];
  const m=view.cameraBasis,c=view.camera,camera2=c[0]**2+c[1]**2+c[2]**2,scores=new Map<number,number>(),focal=view.focal??1.25;
  for(let iy=0;iy<24;iy++)for(let ix=0;ix<40;ix++){
    const px=((ix+.5)/40-.5)*width/height,py=.5-(iy+.5)/24;
    let x=m[0]*px+m[3]*py+m[6]*focal,y=m[1]*px+m[4]*py+m[7]*focal,z=m[2]*px+m[5]*py+m[8]*focal;
    const norm=Math.hypot(x,y,z);x/=norm;y/=norm;z/=norm;
    const b=c[0]*x+c[1]*y+c[2]*z;if(b<0&&b*b>=camera2-1)continue;
    const gx=x*g[0]+y*g[1]+z*g[2],gy=x*g[3]+y*g[4]+z*g[5],gz=x*g[6]+y*g[7]+z*g[8];
    const kx=Math.floor(((.5-Math.atan2(gy,gx)/(2*Math.PI))+1)%1*32),ky=Math.min(15,Math.floor((.5-Math.asin(Math.max(-1,Math.min(1,gz)))/Math.PI)*16));
    const footprint=16384/(2*Math.PI*height*focal*Math.max(.1,Math.hypot(gx,gy)));
    if(footprint>=4)continue;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      if(ky+dy<0||ky+dy>=16)continue;
      const id=(ky+dy)*32+(kx+dx+32)%32;if(!available.has(id))continue;
      const score=px*px+py*py+(dx*dx+dy*dy)*4;
      scores.set(id,Math.min(scores.get(id)??Infinity,score));
    }
  }
  return [...scores].sort((a,b)=>a[1]-b[1]||a[0]-b[0]).slice(0,limit).map(([id])=>id);
}

type Resident={slot:number;loaded:number;used:number};
export class SurfaceTiles {
  private work:SceneWork;
  private gl:WebGLRenderingContext;
  private texture:WebGLTexture|null;
  private columns:number;
  private edge:number;
  private capacity:number;
  private available=new Set<number>();
  private resident=new Map<number,Resident>();
  private wanted:number[]=[];
  private pending=new Map<number,AbortController>();
  private failed=new Map<number,number>();
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
  requests=0;
  bytes=0;

  constructor(gl:WebGLRenderingContext,mobile:boolean,notify:()=>void,layer:Layer='night',work=new SceneWork(),private assetBaseURL='/media/earthlight/'){
    this.work=work;
    this.gl=gl;this.notify=notify;this.layer=layer;this.dimensions=dimensions(layer);this.prepacked=layer==='terrain'||layer==='galaxy';this.unit=layer==='terrain'?15:layer==='galaxy'?14:layer==='night'?7:layer==='day'?6:9;this.format=layer==='day'||layer==='galaxy'||layer==='terrain'?gl.RGBA:gl.LUMINANCE;
    const {columns,rows,cell,interior}=this.dimensions;
    this.pages=new Uint8Array(columns*rows*2);this.colorPages=new Uint8Array(columns*rows*8);
    this.columns=Math.min((layer==='galaxy'||layer==='terrain')?(mobile?4:6):mobile&&layer!=='night'?6:8,Math.floor(gl.getParameter(gl.MAX_TEXTURE_SIZE)/cell));
    this.edge=this.columns*cell;this.capacity=Math.floor((this.columns*this.columns-1)/2);
    this.texture=gl.createTexture();
    if(!this.texture||this.capacity<1)throw new Error('Cannot allocate surface tile atlas');
    this.bind();
    // A dormant layer needs a valid sampler, not an 80 MB empty atlas.
    textureImage2D(gl,gl.TEXTURE_2D,0,this.format,1,1,0,this.format,gl.UNSIGNED_BYTE,null);
    for(const axis of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,axis,gl.CLAMP_TO_EDGE);
    for(const filter of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,filter,gl.LINEAR);
    this.work.network.run(scenePriority.tile,this.abort.signal,async()=>{
      const response=await fetch(this.assetBaseURL.replace(/\/+$/, '')+'/'+this.layer+'-tiles/'+'manifest.json',{signal:this.abort.signal});
      if(!response.ok)throw new Error('Surface tile manifest unavailable');
      return response.json();
    }).then(data=>{
      // Galaxy tiles carry box mipmaps averaged in displayed radiance (version 2).
      if(data.version!==(this.layer==='galaxy'?2:1)||(this.layer==='galaxy'&&data.mipmaps!=='packed')||data.interior!==interior||data.gutter!==16||data.columns!==columns||data.rows!==rows||!Array.isArray(data.tiles)
        ||!data.tiles.every((id:unknown)=>typeof id==='number'&&Number.isInteger(id)&&id>=0&&id<columns*rows))throw new Error('Invalid night tile manifest');
      if(this.disposed)return;
      this.available=new Set(data.tiles);this.lastSelection=-Infinity;this.notify();
    }).catch(()=>{/* Keep the global map if detail is unavailable. */});
  }

  private bind(){
    this.gl.activeTexture(this.gl.TEXTURE0+this.unit);
    this.gl.bindTexture(this.gl.TEXTURE_2D,this.texture);
  }

  update(view:View,width:number,height:number,program:WebGLProgram){
    if(this.disposed)return;
    const {columns,rows}=this.dimensions;
    const count=columns*rows;
    const now=performance.now();
    if(this.wasMoving&&!this.work.moving)this.lastSelection=-Infinity;
    this.wasMoving=this.work.moving;
    const pose=[...Array.from(view.camera),...Array.from(view.cameraBasis),width,height,view.focal??1.25];
    // A fast swipe used to bypass the interval every frame for every layer,
    // repeatedly selecting and aborting tiles before they could finish loading.
    if(now-this.lastSelection>180){
      this.lastSelection=now;
      this.previousView=pose;clearTimeout(this.selectionTimer);this.selectionTimer=0;
      this.wanted=visibleSurfaceTiles(view,width,height,this.available,this.capacity,this.layer);
      const desired=new Set(this.wanted);
      for(const [id,controller] of this.pending)if(!desired.has(id))controller.abort();
      for(const id of this.wanted){const entry=this.resident.get(id);if(entry)entry.used=now;}
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
      const value=Math.round(fade*255);
      if(this.pages[id]!==entry.slot||this.pages[id+count]!==value)this.tableDirty=true;
      this.pages[id]=entry.slot;this.pages[id+count]=value;
      fading ||= fade<1&&Number.isFinite(entry.loaded);
    }
    const gl=this.gl;
    if(this.tableDirty){
      gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);
      const table=this.format===gl.RGBA?this.colorPages:this.pages;
      if(this.format===gl.RGBA)for(let i=0;i<this.pages.length;i++)table[i*4]=this.pages[i];
      textureSubImage2D(gl,gl.TEXTURE_2D,0,0,0,columns,rows*2,this.format,gl.UNSIGNED_BYTE,table);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT,4);this.tableDirty=false;this.revision++;
    }
    if(fading&&!this.timer)this.timer=window.setTimeout(()=>{this.timer=0;if(!this.disposed)this.notify();},42);
  }

  private pump(){
    if(this.disposed||document.hidden||!this.allocated)return;
    const cell=this.dimensions.cell;
    for(const id of this.wanted){
      if(this.pending.size>=3)break;
      if(this.resident.has(id)||this.pending.has(id)||(this.failed.get(id)??0)>performance.now())continue;
      const controller=new AbortController();this.pending.set(id,controller);this.requests++;
      const timeout=window.setTimeout(()=>controller.abort(),12000);
      this.work.network.run(scenePriority.tile,controller.signal,async()=>{
        const response=await fetch(this.assetBaseURL.replace(/\/+$/, '')+'/'+this.layer+'-tiles/'+id+(this.layer==='terrain'?'.png':'.avif'),{signal:controller.signal,priority:'low'});
        if(!response.ok)throw new Error('Surface tile unavailable');
        return response.blob();
      }).then(blob=>this.work.decode.run(scenePriority.tile,controller.signal,async()=>{
        this.bytes+=blob.size;
        const image=await createImageBitmap(blob,{colorSpaceConversion:'none',premultiplyAlpha:'none'});
        try{
          if(this.disposed||controller.signal.aborted||!this.wanted.includes(id))return;
          if(image.width!==cell*(this.prepacked?2:1)||image.height!==cell)throw new Error('Invalid night tile dimensions');
          let slot=0;
          const occupied=new Set([...this.resident.values()].map(v=>v.slot));
          for(let i=1;i<this.columns*this.columns-1;i+=2)if(!occupied.has(i)){slot=i;break;}
          if(!slot){
            const stale=[...this.resident].filter(([key])=>!this.wanted.includes(key)).sort((a,b)=>a[1].used-b[1].used)[0];
            if(!stale)return;
            slot=stale[1].slot;this.resident.delete(stale[0]);this.tableDirty=true;
          }
          this.resident.set(id,{slot,loaded:Infinity,used:performance.now()});
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
            this.resident.set(id,{slot,loaded:performance.now(),used:performance.now()});this.tableDirty=true;this.notify();return;
          }
          await this.work.upload(scenePriority.tile,controller.signal,()=>{
            this.bind();
            textureSubImage2D(this.gl,this.gl.TEXTURE_2D,0,(slot%this.columns)*cell,Math.floor(slot/this.columns)*cell,this.format,this.gl.UNSIGNED_BYTE,image);
          });
          const mipSlot=slot+1;
          let offset=0;
          for(const size of [cell/2,cell/4,Math.ceil(cell/8),Math.ceil(cell/16)]){
            const mip=await createImageBitmap(image,{resizeWidth:size,resizeHeight:size,resizeQuality:'high',colorSpaceConversion:'none',premultiplyAlpha:'none'});
            try{
              if(this.disposed||controller.signal.aborted){this.resident.delete(id);this.tableDirty=true;return;}
              await this.work.upload(scenePriority.tile,controller.signal,()=>{
                this.bind();
                textureSubImage2D(this.gl,this.gl.TEXTURE_2D,0,(mipSlot%this.columns)*cell+offset,Math.floor(mipSlot/this.columns)*cell,this.format,this.gl.UNSIGNED_BYTE,mip);
              });
            }finally{mip.close();}
            offset+=size;
          }
          this.resident.set(id,{slot,loaded:performance.now(),used:performance.now()});
          this.tableDirty=true;
          this.notify();
        }finally{image.close();}
      })).catch(()=>{if(this.resident.get(id)?.loaded===Infinity){this.resident.delete(id);this.tableDirty=true;}if(!this.disposed&&!controller.signal.aborted&&this.wanted.includes(id))this.failed.set(id,performance.now()+30000);}).finally(()=>{
        clearTimeout(timeout);this.pending.delete(id);this.pump();
      });
    }
  }

  layout(){return [this.allocated?this.edge:0,this.columns];}
  stats(){const now=performance.now();return {revision:this.revision,fading:[...this.resident.values()].filter(entry=>now-entry.loaded<650).length,resident:this.resident.size,capacity:this.capacity,pending:this.pending.size,wanted:this.wanted.length,bytes:this.bytes,requests:this.requests,gpuBytes:(this.allocated?this.edge*this.edge:1)*(this.format===this.gl.RGBA?4:1)};}
  dispose(){
    this.disposed=true;this.abort.abort();clearTimeout(this.timer);clearTimeout(this.selectionTimer);
    for(const controller of this.pending.values())controller.abort();
    this.pending.clear();this.resident.clear();
    if(!this.gl.isContextLost())this.gl.deleteTexture(this.texture);
    this.texture=null;
  }
}
