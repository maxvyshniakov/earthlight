import {ShaderProgramBatch} from './shader-programs';
import {textureImage2D} from './webgl-context';
import {sceneShadersFor,vertexSource} from './scene-shader';
import {perNightMode,type NightMode} from './physical-night';

// Four adjacent heights per RGBA texel, eight guttered tiles, 32 heights.
// Two 2048 x 1024 textures cost 16 MiB, including the unfinished replacement.
const TILE=512,WIDTH=2048,HEIGHT=1024,STRIPE=64,CHUNKS=64;
const SPAN=Math.PI/6;
/** Use recent submission cadence to bound optional bake work. No nested GPU
 * queries or completion waits: the scene quality timer owns GPU queries. */
export class CloudBakeBudget {
 private last=0;
 private samples:number[]=[];
 rows(now:number){
  const delta=now-this.last;this.last=now;
  if(delta>2000)this.samples=[];
  else if(delta>0){this.samples.push(delta);if(this.samples.length>8)this.samples.shift();}
  if(this.samples.length<3)return 32;
  const sorted=[...this.samples].sort((a,b)=>a-b),cost=sorted[Math.floor(sorted.length*.7)];
  return cost>75?16:cost>50?32:64;
 }
}
const helper=`
uniform sampler2D cloudLightingAtlas;
uniform float cloudLightingReady;
uniform vec4 cloudLightingPatch;
vec2 cloudLightingUV(vec3 point){
 if(cloudLightingReady<.5)return vec2(-1.);
 vec3 n=normalize(cloudCoordinates(point));
 float longitude=atan(n.y,n.x);
 float delta=mod(longitude-cloudLightingPatch.x+3.141592654,6.283185307)-3.141592654;
 return vec2(delta,asin(clamp(n.z,-1.,1.))-cloudLightingPatch.y)/cloudLightingPatch.zw+.5;
}
float cloudLightingSlice(vec2 uv,float index){
 float tileIndex=floor(index/4.);
 vec2 tile=vec2(mod(tileIndex,4.),floor(tileIndex/4.));
 vec4 field=texture2D(cloudLightingAtlas,(tile*512.+vec2(1.5)+clamp(uv,0.,1.)*509.)/vec2(2048.,1024.));
 float channel=mod(index,4.);
 return channel<.5?field.r:channel<1.5?field.g:channel<2.5?field.b:field.a;
}
float cachedCloudLighting(vec3 point,vec2 uv){
 float layer=clamp(((length(point)-1.)*6371.-.6)/11.4*31.,0.,31.);
 return mix(cloudLightingSlice(uv,floor(layer)),cloudLightingSlice(uv,min(31.,floor(layer)+1.)),fract(layer));
}
`;

/** Cached direct-sun transmission; density, ground shadows and source
 * attenuation retain their integrators and footprint filtering. */
export const cloudLightingShader={declarations:helper,shadowPrelude:`
 vec2 uv=cloudLightingUV(point);
 float edge=min(min(uv.x,uv.y),min(1.-uv.x,1.-uv.y));
 float weight=cloudLightingReady*smoothstep(.005,.04,edge);
 if(weight>=.999)return cachedCloudLighting(point,uv);
 if(weight>0.)return mix(cloudLightTransmission(point,sunDirection,6.),cachedCloudLighting(point,uv),weight);
 `};

const bakeSourceFor=perNightMode(mode=>{const {scenePrelude}=sceneShadersFor(mode);return scenePrelude+`
uniform vec4 bakePatch;
vec3 bakePoint(vec2 uv,float index){
 vec2 ll=bakePatch.xy+(uv-.5)*bakePatch.zw;
 return vec3(cos(ll.y)*cos(ll.x),cos(ll.y)*sin(ll.x),sin(ll.y))*(1.+(.6+index/31.*11.4)/6371.);
}
void main(){
 vec2 tile=floor(gl_FragCoord.xy/512.);
 float index=(tile.y*4.+tile.x)*4.;
 vec2 uv=clamp((mod(gl_FragCoord.xy,512.)-vec2(1.5))/509.,0.,1.);
 gl_FragColor=vec4(cloudShadow(bakePoint(uv,index)),cloudShadow(bakePoint(uv,index+1.)),
   cloudShadow(bakePoint(uv,index+2.)),cloudShadow(bakePoint(uv,index+3.)));
}
`;});

type Sample={camera:number[];sun:number[];stamp:string};
type Bake=Sample&{patch:number[];chunk:number};
/** Rotation rate of the plate clouds (radians per scene millisecond). Measured
 * clouds (cloudStudy=global) stay where they were observed: drift 0. */
export const CLOUD_DRIFT=.000008;
function cloudFrame(vector:number[],time:number,drift:number){
  const angle=time*drift,c=Math.cos(angle),s=Math.sin(angle);
  return [c*vector[0]+s*vector[1],-s*vector[0]+c*vector[1],vector[2]];
}
function location(camera:number[]){return [Math.atan2(camera[1],camera[0]),Math.asin(camera[2]/Math.hypot(...camera))];}
function offset(a:number,b:number){return Math.abs(Math.atan2(Math.sin(a-b),Math.cos(a-b)));}
function moved(bake:Bake,sample:Sample,margin:number){
  const [lon,lat]=location(sample.camera);
  return offset(lon,bake.patch[0])>SPAN*margin||Math.abs(lat-bake.patch[1])>SPAN*margin;
}
function relit(bake:Bake,sample:Sample,limit:number){return Math.hypot(...sample.sun.map((x,i)=>x-bake.sun[i]))>limit;}

/** Pure lifecycle policy, shared by the GL owner and lifecycle tests. */
export class CloudLightingSchedule {
  current:Bake|null=null;
  pending:Bake|null=null;
  generation=0;
  private stamp='';
  private changedAt=0;
  constructor(private drift=CLOUD_DRIFT){}
  update(camera:number[],sun:number[],time:number,stamp:string,settled:boolean,now:number){
    const sample={camera:cloudFrame(camera,time,this.drift),sun:cloudFrame(sun,time,this.drift),stamp};
    if(stamp!==this.stamp){this.stamp=stamp;this.changedAt=now;}
    // At polar coordinates the longitude patch degenerates. Retain the traced
    // path there and at high orbit, where this local cache has little coverage.
    const eligible=Math.hypot(...camera)<1.24&&Math.abs(location(sample.camera)[1])<75*Math.PI/180;
    if(!eligible){this.pending=null;return {ready:false,work:false};}
    if(this.pending&&(this.pending.stamp!==stamp||moved(this.pending,sample,.3)||relit(this.pending,sample,.015)))this.pending=null;
    const ready=!!this.current&&!moved(this.current,sample,.45)&&!relit(this.current,sample,.02);
    const refresh=!this.current||this.current.stamp!==stamp||moved(this.current,sample,.15)||relit(this.current,sample,.008);
    if(!this.pending&&refresh&&settled&&now-this.changedAt>=700){
      const [lon,lat]=location(sample.camera);
      this.pending={...sample,patch:[lon,lat,SPAN,SPAN],chunk:0};
    }
    return {ready,work:!!this.pending||refresh};
  }
  advance(rows=STRIPE){
    if(!this.pending)return false;
    this.pending.chunk+=rows/STRIPE;
    if(this.pending.chunk<CHUNKS)return false;
    this.current=this.pending;this.pending=null;this.generation++;return true;
  }
}

export class CloudLightingAtlas {
  private textures:WebGLTexture[]=[];
  private framebuffer:WebGLFramebuffer|null=null;
  private position=0;
  private uniforms:Record<string,WebGLUniformLocation|null>={};
  private bindings=new Map<WebGLProgram,Record<string,WebGLUniformLocation|null>>();
  private schedule:CloudLightingSchedule;
  private active=0;
  private bakeResolution=[1,1];
  private ready=false;
  private wake:ReturnType<typeof setTimeout>|undefined;
  private budget=new CloudBakeBudget();
  private bakeDraws=0;
  static supported(gl:WebGLRenderingContext){return gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS)>15&&gl.getParameter(gl.MAX_TEXTURE_SIZE)>=2048;}
  static prepare(batch:ShaderProgramBatch,header:string,night:NightMode){return batch.add('Cloud lighting bake',vertexSource,header+bakeSourceFor(night));}
  constructor(private gl:WebGLRenderingContext,private program:WebGLProgram,private notify:()=>void,private mode:'fixed'|'budget'='fixed',drift=CLOUD_DRIFT){
    this.schedule=new CloudLightingSchedule(drift);
    const unit=gl.getParameter(gl.ACTIVE_TEXTURE);gl.activeTexture(gl.TEXTURE15);
    const binding=gl.getParameter(gl.TEXTURE_BINDING_2D),target=gl.getParameter(gl.FRAMEBUFFER_BINDING);
    try{
      this.framebuffer=gl.createFramebuffer();if(!this.framebuffer)throw Error('Cannot allocate cloud lighting target');
      gl.bindFramebuffer(gl.FRAMEBUFFER,this.framebuffer);
      for(let i=0;i<2;i++){
        const texture=gl.createTexture();if(!texture)throw Error('Cannot allocate cloud lighting texture');
        this.textures.push(texture);gl.bindTexture(gl.TEXTURE_2D,texture);
        textureImage2D(gl,gl.TEXTURE_2D,0,gl.RGBA,WIDTH,HEIGHT,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
        for(const name of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,name,gl.LINEAR);
        for(const name of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,name,gl.CLAMP_TO_EDGE);
        gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
        if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Cloud lighting framebuffer incomplete');
      }
    }catch(error){this.releaseTextures();throw error;}
    finally{gl.bindFramebuffer(gl.FRAMEBUFFER,target);gl.bindTexture(gl.TEXTURE_2D,binding);gl.activeTexture(unit);}
    this.locate();
  }
  private locate(){
    const gl=this.gl,program=this.program;
    this.position=gl.getAttribLocation(program,'position');
    gl.useProgram(program);
    for(const name of ['bakePatch','resolution','time','cameraPosition','sunDirection','cloudMapWidth','cloudTileLayout','zoomExcess'])this.uniforms[name]=gl.getUniformLocation(program,name);
    gl.uniform1i(gl.getUniformLocation(program,'cloudMap'),2);gl.uniform1i(gl.getUniformLocation(program,'cloudTileAtlas'),9);
  }
  /** Bake with a program built for another night mode. Self-shadowing does
   * not depend on the mode, so the baked atlas stays. */
  replaceProgram(program:WebGLProgram){this.gl.deleteProgram(this.program);this.program=program;this.locate();}
  update(camera:number[],sun:number[],time:number,width:number,height:number,mapWidth:number,layout:Float32Array|number[]|undefined,stamp:string,settled:boolean,state:Record<string,string>){
    clearTimeout(this.wake);this.wake=undefined;
    const now=performance.now(),rows=this.mode==='budget'?this.budget.rows(now):STRIPE;
    const gl=this.gl,status=this.schedule.update(camera,sun,time,stamp,settled,now);
    this.ready=status.ready;
    const bake=this.schedule.pending;
    if(bake&&settled){
      if(bake.chunk===0)this.bakeResolution=[width,height];
      gl.useProgram(this.program);
      gl.uniform4fv(this.uniforms.bakePatch,bake.patch);
      gl.uniform2f(this.uniforms.resolution,this.bakeResolution[0],this.bakeResolution[1]);gl.uniform1f(this.uniforms.time,0);gl.uniform1f(this.uniforms.zoomExcess,0);
      gl.uniform3fv(this.uniforms.cameraPosition,bake.camera);gl.uniform3fv(this.uniforms.sunDirection,bake.sun);
      gl.uniform1f(this.uniforms.cloudMapWidth,mapWidth);if(layout)gl.uniform2fv(this.uniforms.cloudTileLayout,layout);
      gl.bindFramebuffer(gl.FRAMEBUFFER,this.framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.textures[1-this.active],0);
      gl.viewport(0,0,WIDTH,HEIGHT);
      // Same atlas pixels and shader. Stop at a tile boundary when the budget
      // grows partway through a tile; never expose an unfinished replacement.
      const tile=Math.floor(bake.chunk/8),row=(bake.chunk%8)*STRIPE,count=Math.min(rows,TILE-row);
      gl.enable(gl.SCISSOR_TEST);gl.scissor((tile%4)*TILE,Math.floor(tile/4)*TILE+row,TILE,count);
      gl.enableVertexAttribArray(this.position);gl.vertexAttribPointer(this.position,2,gl.FLOAT,false,0,0);
      const dither=gl.isEnabled(gl.DITHER);gl.disable(gl.DITHER);
      try{gl.drawArrays(gl.TRIANGLES,0,3);}finally{gl.disable(gl.SCISSOR_TEST);if(dither)gl.enable(gl.DITHER);}
      this.bakeDraws++;
      if(this.schedule.advance(count)){this.active=1-this.active;this.ready=true;}
    }
    // A paused explorer still completes its bake. The renderer's notify path
    // coalesces this with normal playback; disposal/context loss cancels it.
    if(this.schedule.pending||(status.work&&!bake))this.wake=setTimeout(this.notify,40);
    state.cloudLightingReady=this.ready?'1':'0';
    state.cloudLightingGeneration=String(this.schedule.generation);
    state.cloudLightingProgress=String(this.schedule.pending?.chunk??0);
    state.cloudLightingBytes=String(WIDTH*HEIGHT*4*2);
    state.cloudLightingPatch=JSON.stringify(this.schedule.current?.patch??[]);
    state.cloudLightingBake=this.mode;state.cloudLightingRows=String(rows);state.cloudLightingDraws=String(this.bakeDraws);
  }
  bind(program:WebGLProgram){
    const gl=this.gl;
    let uniforms=this.bindings.get(program);
    if(!uniforms){uniforms={};for(const name of ['cloudLightingAtlas','cloudLightingReady','cloudLightingPatch'])uniforms[name]=gl.getUniformLocation(program,name);this.bindings.set(program,uniforms);}
    gl.activeTexture(gl.TEXTURE15);gl.bindTexture(gl.TEXTURE_2D,this.textures[this.active]);
    gl.uniform1i(uniforms.cloudLightingAtlas,15);gl.uniform1f(uniforms.cloudLightingReady,this.ready?1:0);
    if(this.schedule.current)gl.uniform4fv(uniforms.cloudLightingPatch,this.schedule.current.patch);
  }
  private releaseTextures(){for(const texture of this.textures)this.gl.deleteTexture(texture);this.textures=[];if(this.framebuffer)this.gl.deleteFramebuffer(this.framebuffer);this.framebuffer=null;}
  dispose(){clearTimeout(this.wake);this.releaseTextures();this.gl.deleteProgram(this.program);}
}
