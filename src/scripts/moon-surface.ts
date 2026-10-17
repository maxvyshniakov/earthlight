import { Body, RotationAxis } from 'astronomy-engine';
import { transform } from './celestial-sky';
import { cameraModelShader } from './camera-model';
import { nightScale } from './physical-night';
import { assetURL } from './asset-location';
import { textureImage2D } from './webgl-context.ts';
import type { ShaderProgramBatch } from './shader-programs';
import { SceneWork, scenePriority } from './scene-work';

type Vec3=[number,number,number];
const dot=(a:ArrayLike<number>,b:ArrayLike<number>)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a:ArrayLike<number>,b:ArrayLike<number>):Vec3=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit=(v:Vec3):Vec3=>{const l=Math.hypot(...v);return v.map(x=>x/l) as Vec3;};

/** Selenographic axes in J2000 (EQJ): lon 0, lon 90°E and north, from the
 * IAU rotation model. Its sub-Earth point is astronomy-engine's libration. */
export function lunarAxes(date:Date):[Vec3,Vec3,Vec3] {
  const axis=RotationAxis(Body.Moon,date);
  const pole:Vec3=[axis.north.x,axis.north.y,axis.north.z];
  const node=unit(cross([0,0,1],pole)),w=axis.spin*Math.PI/180;
  const ahead=cross(pole,node);
  const x=node.map((v,i)=>v*Math.cos(w)+ahead[i]*Math.sin(w)) as Vec3;
  return [x,cross(pole,x),pole];
}
let frameSecond=NaN,frameAxes:[Vec3,Vec3,Vec3]=[[1,0,0],[0,1,0],[0,0,1]];
/** Column-major mat3 of the selenographic axes in the scene's Earth-fixed frame. */
export function lunarFrame(date:Date,starToFixed:number[]):number[] {
  // Libration moves the disk by well under a texel within a second.
  const second=Math.floor(date.getTime()/1000);
  if(second!==frameSecond){frameSecond=second;frameAxes=lunarAxes(new Date(second*1000));}
  return frameAxes.flatMap(axis=>transform(starToFixed,axis));
}

/** McEwen (1991) lunar-Lambert weight: Lommel-Seeliger near full Moon, more
 * Lambertian at large phase angles. */
export function lunarLambertWeight(phaseDegrees:number){
  const a=phaseDegrees;
  return Math.max(0,Math.min(1,1-.019*a+.000242*a*a-.00000146*a*a*a));
}
export const lunarShape=(cosIncidence:number,cosEmission:number,weight:number)=>
  cosIncidence<=0?0:(1-weight)*cosIncidence+weight*2*cosIncidence/(cosIncidence+Math.max(0,cosEmission));

export type LunarLuminance={width:number;height:number;scale:number;data:Uint8Array};
// Bilinear, wrapping in longitude, like the GPU's sampler on the full map.
const sampleLuminance=(table:LunarLuminance,lon:number,lat:number)=>{
  const fx=(lon/(2*Math.PI)+.5)*table.width-.5,fy=Math.max(0,Math.min(table.height-1,(.5-lat/Math.PI)*table.height-.5));
  const x0=Math.floor(fx),y0=Math.floor(fy),tx=fx-x0,ty=fy-y0,y1=Math.min(table.height-1,y0+1);
  const at=(x:number,y:number)=>table.data[y*table.width+((x%table.width)+table.width)%table.width];
  const value=(at(x0,y0)*(1-tx)+at(x0+1,y0)*tx)*(1-ty)+(at(x0,y1)*(1-tx)+at(x0+1,y1)*tx)*ty;
  return value/255*table.scale;
};
const FLUX_SAMPLES=2048;
// Fibonacci points with equal projected area, as in lunarSamples().
const fluxDisk=(()=>{
  const disk=new Float64Array(FLUX_SAMPLES*3);
  for(let i=0;i<FLUX_SAMPLES;i++){
    const radius=Math.sqrt((i+.5)/FLUX_SAMPLES),angle=i*2.399963229728653;
    disk[i*3]=radius*Math.cos(angle);disk[i*3+1]=radius*Math.sin(angle);disk[i*3+2]=Math.sqrt(1-radius*radius);
  }
  return disk;
})();
let fluxKey='',fluxValue=1,fluxTable:LunarLuminance|null=null;
/** Scale for the resolved disk so its integrated flux equals the uniform
 * Lambert disk that lunarSamples() convolves: exposure and lens reflections are
 * unchanged. Only the distribution across the disk (albedo, limb, phase law)
 * differs. Earth's occlusion is per pixel and applies to both identically. */
export function lunarFluxScale(direction:ArrayLike<number>,sun:ArrayLike<number>,frame:number[],weight:number,table:LunarLuminance|null){
  // Inputs drift slowly; 1e-4 rad is far below a texel of the flux table.
  const key=[...Array.from(direction).slice(0,3),...Array.from(sun),...frame,weight].map(v=>Math.round(v*1e4)).join()
  if(key===fluxKey&&table===fluxTable)return fluxValue;
  const d=unit([direction[0],direction[1],direction[2]]);
  const t=unit(cross(Math.abs(d[2])<.9?[0,0,1]:[1,0,0],d)),u=cross(d,t);
  let lambert=0,surface=0;
  for(let i=0;i<FLUX_SAMPLES;i++){
    const x=fluxDisk[i*3],y=fluxDisk[i*3+1],z=fluxDisk[i*3+2];
    const n0=t[0]*x+u[0]*y-d[0]*z,n1=t[1]*x+u[1]*y-d[1]*z,n2=t[2]*x+u[2]*y-d[2]*z;
    const incidence=n0*sun[0]+n1*sun[1]+n2*sun[2];
    if(incidence<=0)continue;
    lambert+=incidence;
    let albedo=1;
    if(table){
      const s0=n0*frame[0]+n1*frame[1]+n2*frame[2],s1=n0*frame[3]+n1*frame[4]+n2*frame[5],s2=n0*frame[6]+n1*frame[7]+n2*frame[8];
      albedo=sampleLuminance(table,Math.atan2(s1,s0),Math.asin(Math.max(-1,Math.min(1,s2))));
    }
    surface+=albedo*lunarShape(incidence,z,weight);
  }
  fluxKey=key;fluxTable=table;fluxValue=surface>0?lambert/surface:0;
  return fluxValue;
}

/** At least one equirectangular texel per device pixel at the disk centre. */
export const MOON_TIERS=[1024,2048,4096] as const;
export function lunarTier(radiusDevicePixels:number,maxTexture:number){
  const wanted=2*Math.PI*radiusDevicePixels;
  const tiers=MOON_TIERS.filter(width=>width<=maxTexture);
  return tiers.find(width=>width>=wanted)??tiers[tiers.length-1]??0;
}
/** CSS-pixel radii where the resolved disk replaces the sampled one. Below,
 * the existing 128-point PSF convolution is unchanged and no map is fetched. */
export const LUNAR_RESOLVED_PX=[5,9] as const;
/** Largest halo beyond the limb, in CSS pixels (the shader's PSF reach). */
const LUNAR_REACH_PX=96;
export const lunarResolved=(radiusCss:number)=>{
  const t=Math.max(0,Math.min(1,(radiusCss-LUNAR_RESOLVED_PX[0])/(LUNAR_RESOLVED_PX[1]-LUNAR_RESOLVED_PX[0])));
  return t*t*(3-2*t);
};

export const moonVertexSource=`
attribute vec2 position;
void main(){gl_Position=vec4(position,0.,1.);}
`;
// A resolved Moon: a sphere with LROC colour, LOLA relief and short horizon
// shadows, lit by the same Sun direction as the sampled disk. The lens edge
// response is the measured diffraction ESF (Moffat fit) plus the PSF's 4%
// scatter wing; the field-dependent comatic wing is omitted at this scale.
export const moonFragmentSource=`
precision highp float;
uniform vec2 resolution;
uniform float zoomExcess;
uniform float pixelRatio;
#define FOCAL (1.25*(1.+zoomExcess))
uniform vec3 cameraPosition;
uniform mat3 cameraBasis;
uniform vec4 moon;
uniform vec3 lunarLight;
uniform mat3 lunarFrame;
// x: radiance scale, y: lunar-Lambert weight, z: resolved fraction, w: map ready
uniform vec4 lunarShape;
uniform vec3 lunarMean;
// xy: map size, z: lowest height (km), w: height range (km)
uniform vec4 lunarMapInfo;
uniform sampler2D lunarMap;
#ifdef CAMERA_PUPIL_STATE
uniform sampler2D cameraState;
#endif
${cameraModelShader}
const float LUNAR_KM=1737.4;
vec2 selenographic(vec3 n){
  vec3 s=n*lunarFrame;
  return vec2(atan(s.y,s.x)/6.283185307+.5,.5-asin(clamp(s.z,-1.,1.))/3.141592654);
}
// Divergent branches (the shadow march, terminator samples) have no reliable
// derivatives: select the mip from the projected footprint where possible.
vec4 lunarTexel(vec2 uv,float lod){
#ifdef MOON_EXPLICIT_LOD
  return texture2DLodEXT(lunarMap,uv,lod);
#else
  return texture2D(lunarMap,uv);
#endif
}
float lunarHeight(vec2 uv,float lod){return lunarTexel(uv,lod).a*lunarMapInfo.w+lunarMapInfo.z;}
float edgeSpread(float d,float a){return .5-.5*d/sqrt(d*d+a*a);}
// The measured diffraction edge has no light beyond ~12 px: window the
// Moffat tail. Odd symmetry about the limb conserves flux.
float coreSpread(float d,float a,float spread){
  float tail=edgeSpread(abs(d),a)*exp(-d*d/(64.*spread*spread));
  return d>0.?tail:1.-tail;
}
// Radiance at a point of the orthographic disk (|tangent| <= 1).
vec3 lunarSurface(vec3 tangent,float radiusDevice,out float sunUp){
  vec3 normal=tangent-moon.xyz*sqrt(max(0.,1.-dot(tangent,tangent)));
  vec3 view=-moon.xyz;
  vec2 uv=selenographic(normal);
  vec3 albedo=vec3(1.);
  vec3 lit=normal;
  float shadow=1.;
  sunUp=dot(normal,lunarLight);
  if(lunarShape.w>.5){
    float texelKm=6.283185307*LUNAR_KM/lunarMapInfo.x;
    float pixelKm=LUNAR_KM/(radiusDevice*max(.15,dot(normal,view)));
    float lod=log2(max(1.,pixelKm/texelKm));
    albedo=pow(lunarTexel(uv,lod).rgb,vec3(2.2))/lunarMean;
    vec3 pole=lunarFrame[2];
    float cosLatitude=length(cross(pole,normal));
    if(cosLatitude>.02){
      vec3 east=cross(pole,normal)/cosLatitude,north=cross(normal,east);
      // Differentiate over at least one screen pixel, foreshortened at the limb.
      float stepKm=max(texelKm,pixelKm);
      vec2 du=vec2(stepKm/(6.283185307*LUNAR_KM*cosLatitude),0.),dv=vec2(0.,stepKm/(3.141592654*LUNAR_KM));
      float h0=lunarHeight(uv,lod);
      vec2 slope=vec2(lunarHeight(uv+du,lod)-lunarHeight(uv-du,lod),lunarHeight(uv-dv,lod)-lunarHeight(uv+dv,lod))/(2.*stepKm);
      // The longitude derivative degenerates toward the poles; fade it out.
      lit=normalize(normal-(east*slope.x+north*slope.y)*smoothstep(.02,.08,cosLatitude));
      // Short horizon march toward the Sun near the terminator, along the great
      // circle (no polar singularity). The sphere's curvature lifts the ray,
      // so peaks just past the terminator catch light.
      if(sunUp<.3&&sunUp>-.04){
        vec3 toward=lunarLight-normal*sunUp;
        float horizontal=max(length(toward),.0001);
        toward/=horizontal;
        float rise=sunUp/horizontal;
        float march=1.5*stepKm;
        for(int i=1;i<=16;i++){
          float d=march*float(i);
          vec2 at=selenographic(normalize(normal+toward*(d/LUNAR_KM)));
          float clearance=h0+d*rise+d*d/(2.*LUNAR_KM)-lunarHeight(at,lod);
          // The Sun's 0.53 degree disk sets the penumbra width.
          shadow=min(shadow,clamp(clearance/(d*.0093)+.5,0.,1.));
        }
      }else if(sunUp<=-.04)shadow=0.;
    }
  }
  float incidence=dot(lit,lunarLight);
  float emission=max(0.,dot(lit,view));
  float shape=incidence>0.?(1.-lunarShape.y)*incidence+lunarShape.y*2.*incidence/(incidence+emission):0.;
  if(lunarShape.w<.5)shape*=step(0.,sunUp);
  return albedo*shape*shadow*lunarShape.x;
}
void main(){
  vec2 p=(gl_FragCoord.xy/resolution-.5)*vec2(resolution.x/resolution.y,1.);
  vec3 ray=normalize(cameraBasis*normalize(vec3(p,FOCAL)));
  float cssHeight=resolution.y/pixelRatio;
  float radiusCss=moon.w*cssHeight*FOCAL;
  float radiusDevice=max(radiusCss*pixelRatio,1.);
  float ev=.5;
#ifdef CAMERA_PUPIL_STATE
  ev=decodeCameraEV(texture2D(cameraState,vec2(.5)).rg);
#endif
  float spread=cameraProgram(ev).x/4.;
  // Orthographic disk coordinates, as in lunarSamples().
  vec3 offset=(ray-moon.xyz*dot(ray,moon.xyz))/moon.w;
  float r=length(offset);
  float outside=(r-1.)*radiusCss;
  // The scatter wing falls as 1/d^2; fade it out before the pass's support.
  float reach=min(30.*spread+4.,${LUNAR_REACH_PX.toFixed(1)});
  if(outside>reach)discard;
  // Outside the limb, the halo spreads the radiance of the nearest limb point.
  float inner=1.-.5/radiusDevice;
  float sunUp;
  vec3 radiance=lunarSurface(offset/max(r,.000001)*min(r,inner),radiusDevice,sunUp);
  // An overexposed terminator is a step within one pixel: average four
  // rotated-grid samples in a three-pixel band instead of aliasing it.
  if(abs(sunUp)*radiusDevice<3.){
    vec3 sum=vec3(0.);
    vec2 o=vec2(.125,.375);
    for(int i=0;i<4;i++){
      vec3 t=offset+(cameraBasis[0]*o.x+cameraBasis[1]*o.y)/radiusDevice;
      float tr=length(t);float up;
      sum+=lunarSurface(t/max(tr,.000001)*min(tr,inner),radiusDevice,up);
      o=vec2(-o.y,o.x);
    }
    radiance=sum*.25;
  }
  // Measured diffraction edge (10-90% over 1.5 px at f/4; 7e-4 left at 8 px)
  // and the PSF's 4% scatter wing.
  float core=sqrt(.38*spread*spread+.25/(pixelRatio*pixelRatio));
  float coverage=.96*coreSpread(outside,core,spread)+.04*edgeSpread(outside,2.*spread)*(1.-smoothstep(.4*reach,reach,outside));
  // Earth's limb, as the scene pass masks the sky.
  float b=dot(cameraPosition,ray);
  float tangentHeight=(length(cameraPosition+ray*max(0.,-b))-1.)*6371.;
  float pixelHeight=length(cameraPosition)*6371./resolution.y*.6;
  float sky=b>=0.?1.:smoothstep(-pixelHeight,pixelHeight,tangentHeight);
  gl_FragColor=vec4(radiance*coverage*pow(sky,2.2)*lunarShape.z,0.);
}
`;

export type LunarView={
  date:Date;moon:number[];light:Vec3;starToFixed:number[];cameraBasis:number[];camera:number[];
  focal:number;width:number;height:number;cssHeight:number;phaseAngle:number;
};
type Manifest={color:{meanLinear:number[]};height:{km:[number,number]};luminance:{width:number;height:number;scale:number;data:string};tiers:{width:number;height:number;url:string}[]};

/** Resolved Moon pass. Its map loads only while the Moon is on screen and
 * resolved; it never joins the startup asset plan or the background. */
export class MoonSurface {
  static prepare(batch:ShaderProgramBatch,cameraState:boolean,explicitLod:boolean){
    return batch.add('Moon surface',moonVertexSource,(explicitLod?'#extension GL_EXT_shader_texture_lod : enable\n#define MOON_EXPLICIT_LOD 1\n':'')
      +(cameraState?'#define CAMERA_PUPIL_STATE 1\n':'')+moonFragmentSource);
  }
  private uniforms:Record<string,WebGLUniformLocation|null>={};
  private position:number;
  private texture:WebGLTexture|null=null;
  private manifest:Manifest|null=null;
  private table:LunarLuminance|null=null;
  private manifestPending=false;
  private pendingWidth=0;
  private failed=false;
  private abort=new AbortController();
  private frame:{resolved:number;scale:number;weight:number;lunarFrame:number[];box:[number,number,number,number]}|null=null;
  /** Width of the uploaded map, 0 before any upload. */
  mapWidth=0;
  bytes=0;
  requests=0;
  constructor(private gl:WebGLRenderingContext,private program:WebGLProgram,private work:SceneWork,private base:string|undefined,private notify:()=>void,private cameraStateUnit:number|null){
    for(const name of ['resolution','zoomExcess','pixelRatio','cameraPosition','cameraBasis','moon','lunarLight','lunarFrame','lunarShape','lunarMean','lunarMapInfo','lunarMap','cameraState'])
      this.uniforms[name]=gl.getUniformLocation(program,name);
    this.position=gl.getAttribLocation(program,'position');
  }
  /** Before the scene pass: the sampled disk's remaining share (1 - resolved). */
  prepare(view:LunarView):number{
    this.frame=null;
    const basis=view.cameraBasis,d=view.moon;
    const z=dot(d,basis.slice(6,9));
    const radiusCss=view.moon[3]*view.cssHeight*view.focal;
    const resolved=z>0?lunarResolved(radiusCss):0;
    if(resolved<=0)return 0;
    const aspect=view.width/view.height,pixelRatio=view.height/Math.max(1,view.cssHeight);
    const px=(dot(d,basis.slice(0,3))*view.focal/z/aspect+.5)*view.width;
    const py=(dot(d,basis.slice(3,6))*view.focal/z+.5)*view.height;
    const reach=(radiusCss+LUNAR_REACH_PX)*pixelRatio;
    const x0=Math.max(0,Math.floor(px-reach)),y0=Math.max(0,Math.floor(py-reach));
    const x1=Math.min(view.width,Math.ceil(px+reach)),y1=Math.min(view.height,Math.ceil(py+reach));
    if(x1<=x0||y1<=y0)return 0;
    // Visible and resolved: fetch the map tier that this size needs.
    this.request(lunarTier(radiusCss*pixelRatio,this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE)));
    const frame=lunarFrame(view.date,view.starToFixed);
    const weight=lunarLambertWeight(view.phaseAngle*180/Math.PI);
    const scale=lunarFluxScale(d,view.light,frame,weight,this.mapWidth?this.table:null);
    this.frame={resolved,scale,weight,lunarFrame:frame,box:[x0,y0,x1-x0,y1-y0]};
    return resolved;
  }
  /** Adds the resolved disk to the bound linear target (the world buffer). */
  draw(view:LunarView,zoomExcess:number){
    const frame=this.frame;
    if(!frame)return;
    const gl=this.gl,u=this.uniforms;
    gl.useProgram(this.program);
    gl.uniform2f(u.resolution,view.width,view.height);
    gl.uniform1f(u.zoomExcess,zoomExcess);
    gl.uniform1f(u.pixelRatio,view.height/Math.max(1,view.cssHeight));
    gl.uniform3fv(u.cameraPosition,view.camera);
    gl.uniformMatrix3fv(u.cameraBasis,false,view.cameraBasis);
    gl.uniform4fv(u.moon,view.moon);
    gl.uniform3fv(u.lunarLight,view.light);
    gl.uniformMatrix3fv(u.lunarFrame,false,frame.lunarFrame);
    // 18 is the sampled disk's radiance gain in scene-shader.ts.
    gl.uniform4f(u.lunarShape,18*nightScale('moonDisk')*frame.scale,frame.weight,frame.resolved,this.mapWidth?1:0);
    const mean=this.manifest?.color.meanLinear??[1,1,1];
    gl.uniform3f(u.lunarMean,mean[0],mean[1],mean[2]);
    const km=this.manifest?.height.km??[0,1];
    gl.uniform4f(u.lunarMapInfo,this.mapWidth||1,(this.mapWidth||2)/2,km[0],km[1]-km[0]);
    // Borrow unit 0 and hand Earth's day map back to the volume passes.
    gl.activeTexture(gl.TEXTURE0);
    const previous=gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture|null;
    gl.bindTexture(gl.TEXTURE_2D,this.texture);
    gl.uniform1i(u.lunarMap,0);
    if(this.cameraStateUnit!==null)gl.uniform1i(u.cameraState,this.cameraStateUnit);
    gl.enableVertexAttribArray(this.position);gl.vertexAttribPointer(this.position,2,gl.FLOAT,false,0,0);
    const blend=gl.isEnabled(gl.BLEND),scissor=gl.isEnabled(gl.SCISSOR_TEST);
    gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE);
    // The world buffer's alpha holds ray distance; leave it untouched.
    gl.colorMask(true,true,true,false);
    gl.enable(gl.SCISSOR_TEST);gl.scissor(...frame.box);
    gl.drawArrays(gl.TRIANGLES,0,3);
    gl.colorMask(true,true,true,true);
    if(!scissor)gl.disable(gl.SCISSOR_TEST);
    if(!blend)gl.disable(gl.BLEND);
    gl.bindTexture(gl.TEXTURE_2D,previous);
  }
  private request(width:number){
    if(this.failed||!width||width<=Math.max(this.mapWidth,this.pendingWidth))return;
    if(!this.manifest){if(!this.manifestPending)void this.loadManifest();return;}
    const tier=this.manifest.tiers.find(t=>t.width===width);
    if(tier)void this.load(tier);
  }
  private async loadManifest(){
    this.manifestPending=true;
    try{
      const signal=this.abort.signal;
      const manifest=await this.work.network.run(scenePriority.tile,signal,async()=>{
        this.requests++;
        const response=await fetch(assetURL('moon/moon.json',this.base),{signal});
        if(!response.ok)throw Error(`moon.json: ${response.status}`);
        return await response.json() as Manifest;
      });
      const data=Uint8Array.from(atob(manifest.luminance.data),c=>c.charCodeAt(0));
      if(data.length!==manifest.luminance.width*manifest.luminance.height)throw Error('Invalid lunar luminance table');
      this.table={...manifest.luminance,data};
      this.manifest=manifest;
    }catch(error){if(!this.abort.signal.aborted){this.failed=true;console.warn('Lunar surface unavailable; keeping the uniform disk.',error);}}
    finally{this.manifestPending=false;this.notify();}
  }
  private async load(tier:{width:number;height:number;url:string}){
    const gl=this.gl,signal=this.abort.signal;
    this.pendingWidth=tier.width;
    try{
      const blob=await this.work.network.run(scenePriority.tile,signal,async()=>{
        this.requests++;
        const response=await fetch(assetURL('moon/'+tier.url,this.base),{signal,priority:'low'});
        if(!response.ok)throw Error(`${tier.url}: ${response.status}`);
        return await response.blob();
      });
      await this.work.decode.run(scenePriority.tile,signal,async()=>{
        // Height is in alpha: no premultiplication or colour conversion.
        const image=await createImageBitmap(blob,{premultiplyAlpha:'none',colorSpaceConversion:'none'});
        try{
          if(signal.aborted||gl.isContextLost())return;
          if(image.width!==tier.width||image.height!==tier.height)throw Error('Unexpected lunar map size');
          await this.work.upload(scenePriority.tile,signal,()=>{
            if(tier.width<=this.mapWidth)return;
            const texture=gl.createTexture();
            if(!texture)throw Error('Cannot allocate lunar map');
            gl.activeTexture(gl.TEXTURE0);
            const previous=gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture|null;
            gl.bindTexture(gl.TEXTURE_2D,texture);
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);
            textureImage2D(gl,gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);
            gl.generateMipmap(gl.TEXTURE_2D);
            gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);
            gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);
            gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
            gl.bindTexture(gl.TEXTURE_2D,previous);
            if(this.texture)gl.deleteTexture(this.texture);
            this.texture=texture;this.mapWidth=tier.width;this.bytes+=blob.size;
          });
        }finally{image.close();}
      });
    }catch(error){if(!signal.aborted){this.failed=true;console.warn('Lunar surface map unavailable; keeping the current disk.',error);}}
    finally{if(this.pendingWidth===tier.width)this.pendingWidth=0;this.notify();}
  }
  dispose(){
    this.abort.abort();
    if(this.texture)this.gl.deleteTexture(this.texture);this.texture=null;
    this.gl.deleteProgram(this.program);
  }
}
