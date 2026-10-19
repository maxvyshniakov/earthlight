import {textureImage2D} from './webgl-context.ts';
import type {ShaderProgramBatch} from './shader-programs';
import { FRAME_VEIL_COMPONENTS } from './solar-light';
import { cameraModelShaderFor, EXPOSURE_MIN_EV, NIGHT_EXPOSURE_MAX_EV } from './camera-model';
import { preExposure, preExposureShaderFor } from './pre-exposure';
import { perNightMode, physicalNight, type NightMode } from './physical-night';

/** Per-axis spread of pyramid level k: σ = this · 2^k full-resolution pixels.
 * Box 4×4 downsampling (1.25 texel² per step), the 3×3 tent upsample and the
 * final bilinear read add up to about 1.31 · 4^k pixel² of variance. */
export const GLARE_LEVEL_SPREAD=1.14;
/** Scene radiance cap inside the Sun's lens footprint. Sunlit cloud is below
 * 1, glint a few units; the solar disk is ~3·10⁴ and keeps its analytic veil. */
export const GLARE_SOLAR_CAP=16;
/** The scene draws the solar PSF out to this many CSS pixels past the disk. */
export const SOLAR_PSF_REACH=130;
export const GLARE_MAX_LEVELS=9;
const MAX_LEVELS=GLARE_MAX_LEVELS;
/** Per-axis spread of a downsampled level image read bilinearly, as 2^k times
 * this: the 4×4 boxes (1.25 texel² per step) plus the bilinear tent. */
export const FIELD_LEVEL_SPREAD=.76;

/** Radiance at which a meter block counts as lit (smoothstep), shared with
 * the exposure meter's point samples. Scene units: sunlit cloud ~0.5. */
export const METER_LIT=[.025,.10] as const;
/** METER_LIT holds in scene units up to this EV, the default program's
 * ceiling, and scales with the meter's frame EV above it, never with the
 * camera's own: on a dark frame a subject is what stands 4–6 stops over the
 * frame's metered mid-grey, as daylit Earth does on black sky at EV 5.1.
 * Below it the day is metered exactly as before. Both programs
 * (docs/lab/subject-threshold-2026-10-20.md). */
export const METER_SUBJECT_EV=5.1;
/** The frame EV state spans the physical-night range in every program: the
 * default program's frame can ask for more than its 5.1 ceiling. */
export const FRAME_EV_MAX=NIGHT_EXPOSURE_MAX_EV;
/** Stops the default program's subject threshold may fall below the day's.
 * Its stars and planets are 8 × 10⁴ times their physical radiance: much
 * deeper, the lens wings of a bright planet fill a subject block. Physical
 * night has no such floor. */
export const METER_SUBJECT_DEPTH=2;
/** GLSL: the frame EV from its state texel, and the subject threshold's
 * scale from it. */
export const frameEVShaderFor=perNightMode(mode=>`float decodeFrameEV(vec2 state){return dot(state,vec2(65280.,255.))/65535.*${(FRAME_EV_MAX-EXPOSURE_MIN_EV).toFixed(1)}+${EXPOSURE_MIN_EV.toFixed(1)};}
float subjectScaleFor(vec4 frame){return ${physicalNight(mode)?'':`max(${(2**-METER_SUBJECT_DEPTH).toFixed(6)},`}min(1.,${(2**METER_SUBJECT_EV).toFixed(4)}/exp2(decodeFrameEV(frame.rg)))${physicalNight(mode)?'':')'};}
`);
/** Level whose blocks define a metering subject: about 1/70 of the frame
 * height including the chain's spread (12 px at 800). The lit half of a
 * 40 px Moon fills several; a star fills none. */
export function subjectLevel(height:number,levels:number){
  return Math.max(2,Math.min(levels-1,Math.round(Math.log2(height/200))));
}
/** Largest side of the level the meter reads texel by texel. */
export const METER_MAX_SIDE=64;
/** Finest level the meter can read whole: 37 × 25 for 3:2 frames. */
export function meterLevel(width:number,height:number,levels:number){
  let k=subjectLevel(height,levels)+1;
  while(k<levels&&Math.max(width>>k,height>>k)>METER_MAX_SIDE)k++;
  return Math.min(k,levels);
}

/** Pyramid levels 1..n until the short side would fall below two texels. */
export function glareLevels(width:number,height:number){
  let levels=0;
  while(levels<MAX_LEVELS&&Math.min(width,height)>>(levels+1)>=2)levels++;
  return levels;
}

/** Weights of each pyramid level so their sum is the veil kernel at this
 * focal length (frame-height units; 1.25 at 1x). A β=2
 * Moffat of core radius a is exactly ∫ e^-t G_σ dt with σ² = a²/2t, so the
 * Gaussians with σ below s carry exp(-a²/2s²) of it. Each level takes the
 * mass between the geometric midpoints of its neighbours' spreads; the ends
 * take the rest, so the weights sum to one. The scatter fraction is applied
 * when compositing: weighted half-float levels of faint light would underflow. */
export function glareWeights(height:number,levels:number,focal=1.25){
  const sigma=(k:number)=>GLARE_LEVEL_SPREAD*2**k;
  const weights=new Array<number>(levels).fill(0);
  for(const {share,scale} of FRAME_VEIL_COMPONENTS){
    const a=scale*focal*height;
    const below=(s:number)=>s===Infinity?1:s===0?0:Math.exp(-a*a/(2*s*s));
    for(let k=1;k<=levels;k++){
      const lo=k===1?0:Math.sqrt(sigma(k-1)*sigma(k)),hi=k===levels?Infinity:Math.sqrt(sigma(k)*sigma(k+1));
      weights[k-1]+=share*(below(hi)-below(lo));
    }
  }
  return weights;
}

const vertexSource='attribute vec2 position;void main(){gl_Position=vec4(position,0.,1.);}';
// Each tap is a bilinear read at a texel corner, so four taps average a 4×4
// block. The first pass caps the Sun's footprint; its veil is analytic.
// Alpha carries what the meter needs to tell a subject from a star. Level 1
// marks lit pixels, finer levels average that into the lit share of a block,
// the subject level keeps blocks more than half lit, and coarser levels
// average those into the share of area in subjects. A star never fills a
// subject block however bright it is; a Moon a few blocks wide does.
const downSourceFor=perNightMode(mode=>{const PRE_EXPOSURE=preExposure(mode);return `
precision highp float;
uniform sampler2D source;
uniform vec2 sourceSize;
uniform vec2 targetSize;
uniform vec4 solarMask;
uniform float alphaMode;
uniform sampler2D frameState;
uniform float frameKnown;
${PRE_EXPOSURE?`#define CAMERA_PUPIL_STATE 1
uniform sampler2D cameraState;
${cameraModelShaderFor(mode)}${preExposureShaderFor(mode)}`:''}${frameEVShaderFor(mode)}vec4 tap(vec2 uv){
  vec4 c=texture2D(source,uv);
  if(solarMask.w>.5&&length((uv-.5)*vec2(sourceSize.x/sourceSize.y,1.)-solarMask.xy)<solarMask.z)
    c.rgb=min(c.rgb,vec3(${GLARE_SOLAR_CAP.toFixed(1)})${PRE_EXPOSURE?'*sceneExposure()':''});
  return vec4(max(c.rgb,vec3(0.)),c.a);
}
// Radiance over the subject threshold's scale: the frame EV of the meter's
// last update above EV ${METER_SUBJECT_EV}, never the exposure the frame was taken with.
float subjectScale(){return frameKnown>.5?subjectScaleFor(texture2D(frameState,vec2(.5))):1.;}
float lit(vec3 c){return smoothstep(${METER_LIT[0]},${METER_LIT[1].toFixed(2)},max(c.r,max(c.g,c.b))/(${PRE_EXPOSURE?'sceneExposure()*':''}subjectScale()));}
void main(){
  vec2 uv=gl_FragCoord.xy/targetSize,d=1./sourceSize;
  vec4 a=tap(uv-d),b=tap(uv+d),c=tap(uv+vec2(d.x,-d.y)),e=tap(uv+vec2(-d.x,d.y));
  vec4 block=.25*(a+b+c+e);
  float alpha=block.a;
  if(alphaMode>1.5)alpha=smoothstep(.3,.9,block.a);
  else if(alphaMode>.5)alpha=.25*(lit(a.rgb)+lit(b.rgb)+lit(c.rgb)+lit(e.rgb));
  gl_FragColor=vec4(block.rgb,alpha);
}`;});
// Accumulate from the coarsest level: a 3×3 tent upsample of the coarser sum
// plus this level's weighted image.
const upSource=`
precision highp float;
uniform sampler2D coarse;
uniform sampler2D detail;
uniform vec2 coarseSize;
uniform vec2 targetSize;
uniform float coarseScale;
uniform float detailWeight;
void main(){
  vec2 uv=gl_FragCoord.xy/targetSize,d=1./coarseSize;
  vec3 c=4.*texture2D(coarse,uv).rgb
    +2.*(texture2D(coarse,uv+vec2(d.x,0.)).rgb+texture2D(coarse,uv-vec2(d.x,0.)).rgb
        +texture2D(coarse,uv+vec2(0.,d.y)).rgb+texture2D(coarse,uv-vec2(0.,d.y)).rgb)
    +texture2D(coarse,uv+d).rgb+texture2D(coarse,uv-d).rgb
    +texture2D(coarse,uv+vec2(d.x,-d.y)).rgb+texture2D(coarse,uv+vec2(-d.x,d.y)).rgb;
  gl_FragColor=vec4(c/16.*coarseScale+texture2D(detail,uv).rgb*detailWeight,1.);
}`;

// Copies a level image into its rectangle of the atlas, texel for texel.
const copySource=`
precision highp float;
uniform sampler2D source;
uniform vec4 rect;
void main(){gl_FragColor=texture2D(source,(gl_FragCoord.xy-rect.xy)/rect.zw);}`;

type Level={texture:WebGLTexture;target:WebGLFramebuffer;width:number;height:number};
/** All downsampled levels in one texture, so a shader reads any level of the
 * scene through one sampler: level 1 on the left, the rest stacked beside it.
 * rects holds each level's origin and size in atlas UV, level 1 first. */
export type GlareField={texture:WebGLTexture;rects:Float32Array;levels:number;width:number;height:number};
/** The level the exposure meter reads: rgb is area-mean radiance, alpha the
 * share of area in subjects (blocks mostly lit). rect is in atlas UV. */
export type MeterField={texture:WebGLTexture;rect:[number,number,number,number];width:number;height:number;atlasWidth:number;atlasHeight:number};

/** Veiling glare of the whole frame: L ⊛ V, V normalized, from a half-float image pyramid.
 * Costs a quarter-resolution pass and a few smaller ones; it needs filtered
 * half-float targets and is absent with the RGBE fallback. */
export class CameraGlare {
  static prepare(batch:ShaderProgramBatch,mode:NightMode){return {batch,down:batch.add('Camera glare down',vertexSource,downSourceFor(mode)),up:batch.add('Camera glare up',vertexSource,upSource),copy:batch.add('Camera glare atlas',vertexSource,copySource)};}

  private down:WebGLProgram|null=null;
  private up:WebGLProgram|null=null;
  private copy:WebGLProgram|null=null;
  private atlas:Level|null=null;
  private rects=new Float32Array(4*MAX_LEVELS);
  private atlasRects:[number,number,number,number][]=[];
  private buffer:WebGLBuffer|null=null;
  private images:Level[]=[];
  private sums:Level[]=[];
  private width=0;private height=0;
  private weights:number[]=[];
  private focal=NaN;
  private built=false;
  private uniforms:Record<string,WebGLUniformLocation|null>={};
  constructor(private gl:WebGLRenderingContext,private pixelType:number,prepared?:ReturnType<typeof CameraGlare.prepare>){
    try{
      this.down=prepared?prepared.batch.take(prepared.down):link(gl,downSourceFor('current'));
      this.up=prepared?prepared.batch.take(prepared.up):link(gl,upSource);
      this.copy=prepared?prepared.batch.take(prepared.copy):link(gl,copySource);
      this.buffer=gl.createBuffer();if(!this.buffer)throw Error('Cannot allocate glare pass');
      gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
      this.locate();
    }catch(error){this.dispose();throw error;}
  }
  private locate(){
    const gl=this.gl;
    for(const name of ['source','sourceSize','targetSize','solarMask','alphaMode','cameraState','frameState','frameKnown'])this.uniforms[`down.${name}`]=gl.getUniformLocation(this.down!,name);
    for(const name of ['coarse','detail','coarseSize','targetSize','coarseScale','detailWeight'])this.uniforms[`up.${name}`]=gl.getUniformLocation(this.up!,name);
    for(const name of ['source','rect'])this.uniforms[`copy.${name}`]=gl.getUniformLocation(this.copy!,name);
  }
  /** Use the programs of another night mode; the pyramid stays allocated. */
  replacePrograms(prepared:ReturnType<typeof CameraGlare.prepare>){
    const gl=this.gl;
    for(const program of [this.down,this.up,this.copy])if(program)gl.deleteProgram(program);
    this.down=prepared.batch.take(prepared.down);this.up=prepared.batch.take(prepared.up);this.copy=prepared.batch.take(prepared.copy);
    this.locate();
  }
  /** Returns the glare image at half resolution, or null when the frame is
   * too small for a pyramid. solarMask: Sun centre (frame units), footprint
   * radius, and 1 when the Sun is visible. focal: frame-height focal length. */
  render(image:WebGLTexture,width:number,height:number,solarMask:[number,number,number,number],focal=1.25){
    return this.build(image,width,height,solarMask)?this.scatter(focal):null;
  }
  /** Downsamples the scene into its levels and atlas; false when the frame
   * is too small for a pyramid. Exposure reads these before anything else.
   * cameraState: the exposure a pre-exposed image was rendered with;
   * frameState: the meter's frame EV, which scales the subject threshold. */
  build(image:WebGLTexture,width:number,height:number,solarMask:[number,number,number,number],cameraState:WebGLTexture|null=null,frameState:WebGLTexture|null=null){
    const gl=this.gl;
    if(width!==this.width||height!==this.height)this.allocate(width,height);
    const levels=this.images.length;
    this.built=false;
    if(levels<2)return false;
    const subject=subjectLevel(height,levels);
    gl.useProgram(this.down);
    gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);
    const position=gl.getAttribLocation(this.down!,'position');
    gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
    gl.uniform1i(this.uniforms['down.source'],4);
    if(cameraState){gl.activeTexture(gl.TEXTURE7);gl.bindTexture(gl.TEXTURE_2D,cameraState);gl.uniform1i(this.uniforms['down.cameraState'],7);}
    // Without a frame EV the sampler reads the source unit, never a target.
    if(frameState){gl.activeTexture(gl.TEXTURE5);gl.bindTexture(gl.TEXTURE_2D,frameState);}
    gl.uniform1i(this.uniforms['down.frameState'],frameState?5:4);gl.uniform1f(this.uniforms['down.frameKnown'],frameState?1:0);
    let source=image,sourceWidth=width,sourceHeight=height;
    for(const [k,level] of this.images.entries()){
      gl.bindFramebuffer(gl.FRAMEBUFFER,level.target);gl.viewport(0,0,level.width,level.height);
      gl.activeTexture(gl.TEXTURE4);gl.bindTexture(gl.TEXTURE_2D,source);
      gl.uniform2f(this.uniforms['down.sourceSize'],sourceWidth,sourceHeight);
      gl.uniform2f(this.uniforms['down.targetSize'],level.width,level.height);
      gl.uniform4fv(this.uniforms['down.solarMask'],k===0?solarMask:[0,0,0,0]);
      gl.uniform1f(this.uniforms['down.alphaMode'],k===0?1:k+1===subject?2:0);
      gl.drawArrays(gl.TRIANGLES,0,3);
      source=level.texture;sourceWidth=level.width;sourceHeight=level.height;
    }
    gl.useProgram(this.copy);
    const copyPosition=gl.getAttribLocation(this.copy!,'position');
    gl.enableVertexAttribArray(copyPosition);gl.vertexAttribPointer(copyPosition,2,gl.FLOAT,false,0,0);
    gl.uniform1i(this.uniforms['copy.source'],4);
    gl.bindFramebuffer(gl.FRAMEBUFFER,this.atlas!.target);
    for(const [k,level] of this.images.entries()){
      const rect=this.atlasRects[k];
      gl.viewport(rect[0],rect[1],rect[2],rect[3]);
      gl.activeTexture(gl.TEXTURE4);gl.bindTexture(gl.TEXTURE_2D,level.texture);
      gl.uniform4fv(this.uniforms['copy.rect'],rect);
      gl.drawArrays(gl.TRIANGLES,0,3);
    }
    this.built=true;
    return true;
  }
  /** Accumulates the glare image from the levels of the last build. */
  scatter(focal=1.25){
    const gl=this.gl,levels=this.images.length;
    if(!this.built)return null;
    if(focal!==this.focal){this.focal=focal;this.weights=glareWeights(this.height,levels,focal);}
    gl.useProgram(this.up);
    gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);
    const upPosition=gl.getAttribLocation(this.up!,'position');
    gl.enableVertexAttribArray(upPosition);gl.vertexAttribPointer(upPosition,2,gl.FLOAT,false,0,0);
    gl.uniform1i(this.uniforms['up.coarse'],4);gl.uniform1i(this.uniforms['up.detail'],5);
    for(let k=levels-2;k>=0;k--){
      const coarse=k===levels-2?this.images[levels-1]:this.sums[k+1],level=this.sums[k];
      gl.bindFramebuffer(gl.FRAMEBUFFER,level.target);gl.viewport(0,0,level.width,level.height);
      gl.activeTexture(gl.TEXTURE4);gl.bindTexture(gl.TEXTURE_2D,coarse.texture);
      gl.activeTexture(gl.TEXTURE5);gl.bindTexture(gl.TEXTURE_2D,this.images[k].texture);
      gl.uniform2f(this.uniforms['up.coarseSize'],coarse.width,coarse.height);
      gl.uniform2f(this.uniforms['up.targetSize'],level.width,level.height);
      gl.uniform1f(this.uniforms['up.coarseScale'],k===levels-2?this.weights[levels-1]:1);
      gl.uniform1f(this.uniforms['up.detailWeight'],this.weights[k]);
      gl.drawArrays(gl.TRIANGLES,0,3);
    }
    return this.sums[0].texture;
  }
  /** The levels of the last build, for reading the scene at any spread. */
  get field():GlareField|null{
    const atlas=this.atlas;
    return atlas&&this.built?{texture:atlas.texture,rects:this.rects,levels:this.images.length,width:atlas.width,height:atlas.height}:null;
  }
  get meter():MeterField|null{
    const atlas=this.atlas;
    if(!atlas||!this.built)return null;
    const k=meterLevel(this.width,this.height,this.images.length)-1,level=this.images[k],r=this.rects;
    return {texture:atlas.texture,rect:[r[k*4],r[k*4+1],r[k*4+2],r[k*4+3]],width:level.width,height:level.height,atlasWidth:atlas.width,atlasHeight:atlas.height};
  }
  private allocate(width:number,height:number){
    const gl=this.gl;
    this.release();
    this.width=width;this.height=height;
    const levels=glareLevels(width,height);
    this.focal=NaN;
    const level=(k:number,w=Math.max(1,width>>k),h=Math.max(1,height>>k)):Level=>{
      const texture=gl.createTexture(),target=gl.createFramebuffer();
      if(!texture||!target)throw Error('Cannot allocate glare level');
      gl.activeTexture(gl.TEXTURE4);gl.bindTexture(gl.TEXTURE_2D,texture);
      for(const axis of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,axis,gl.CLAMP_TO_EDGE);
      for(const filter of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,filter,gl.LINEAR);
      textureImage2D(gl,gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,this.pixelType,null);
      gl.bindFramebuffer(gl.FRAMEBUFFER,target);
      gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
      if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Incomplete glare target');
      return {texture,target,width:w,height:h};
    };
    for(let k=1;k<=levels;k++)this.images.push(level(k));
    // The coarsest sum is its weighted image, read directly by the next pass.
    for(let k=1;k<levels;k++)this.sums.push(level(k));
    if(levels<2)return;
    // Level 1 on the left; levels 2 and up stacked in a column to its right.
    const [first,second]=this.images;
    this.atlas=level(0,first.width+second.width,first.height);
    this.atlasRects=this.images.map((image,k)=>{
      const y=k===0?0:this.images.slice(1,k).reduce((sum,previous)=>sum+previous.height,0);
      return [k===0?0:first.width,y,image.width,image.height];
    });
    this.rects.fill(0);
    this.atlasRects.forEach(([x,y,w,h],k)=>this.rects.set([x/this.atlas!.width,y/this.atlas!.height,w/this.atlas!.width,h/this.atlas!.height],k*4));
  }
  private release(){
    for(const level of [...this.images,...this.sums,...(this.atlas?[this.atlas]:[])]){this.gl.deleteTexture(level.texture);this.gl.deleteFramebuffer(level.target);}
    this.images=[];this.sums=[];this.atlas=null;this.atlasRects=[];this.width=0;this.height=0;this.built=false;
  }
  dispose(){
    this.release();
    if(this.down)this.gl.deleteProgram(this.down);
    if(this.up)this.gl.deleteProgram(this.up);
    if(this.copy)this.gl.deleteProgram(this.copy);
    if(this.buffer)this.gl.deleteBuffer(this.buffer);
  }
}

function link(gl:WebGLRenderingContext,fragment:string){
  const program=gl.createProgram();if(!program)throw Error('Cannot allocate glare program');
  for(const [type,source] of [[gl.VERTEX_SHADER,vertexSource],[gl.FRAGMENT_SHADER,fragment]] as const){
    const shader=gl.createShader(type);if(!shader)throw Error('Cannot allocate glare shader');
    gl.shaderSource(shader,source);gl.compileShader(shader);
    if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(shader)??'Glare compilation failed');
    gl.attachShader(program,shader);gl.deleteShader(shader);
  }
  gl.linkProgram(program);
  if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program)??'Glare link failed');
  return program;
}
