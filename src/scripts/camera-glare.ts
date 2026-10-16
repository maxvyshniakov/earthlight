import {textureImage2D} from './webgl-context.ts';
import type {ShaderProgramBatch} from './shader-programs';
import { VEIL_COMPONENTS } from './solar-light';

/** Per-axis spread of pyramid level k: σ = this · 2^k full-resolution pixels.
 * Box 4×4 downsampling (1.25 texel² per step), the 3×3 tent upsample and the
 * final bilinear read add up to about 1.31 · 4^k pixel² of variance. */
export const GLARE_LEVEL_SPREAD=1.14;
/** Scene radiance cap inside the Sun's lens footprint. Sunlit cloud is below
 * 1, glint a few units; the solar disk is ~3·10⁴ and keeps its analytic veil. */
export const GLARE_SOLAR_CAP=16;
/** The scene draws the solar PSF out to this many CSS pixels past the disk. */
export const SOLAR_PSF_REACH=130;
const MAX_LEVELS=9;

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
  for(const {share,scale} of VEIL_COMPONENTS){
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
const downSource=`
precision highp float;
uniform sampler2D source;
uniform vec2 sourceSize;
uniform vec2 targetSize;
uniform vec4 solarMask;
vec3 tap(vec2 uv){
  vec3 c=texture2D(source,uv).rgb;
  if(solarMask.w>.5&&length((uv-.5)*vec2(sourceSize.x/sourceSize.y,1.)-solarMask.xy)<solarMask.z)
    c=min(c,vec3(${GLARE_SOLAR_CAP.toFixed(1)}));
  return max(c,vec3(0.));
}
void main(){
  vec2 uv=gl_FragCoord.xy/targetSize,d=1./sourceSize;
  gl_FragColor=vec4(.25*(tap(uv-d)+tap(uv+d)+tap(uv+vec2(d.x,-d.y))+tap(uv+vec2(-d.x,d.y))),1.);
}`;
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

type Level={texture:WebGLTexture;target:WebGLFramebuffer;width:number;height:number};

/** Veiling glare of the whole frame: L ⊛ V, V normalized, from a half-float image pyramid.
 * Costs a quarter-resolution pass and a few smaller ones; it needs filtered
 * half-float targets and is absent with the RGBE fallback. */
export class CameraGlare {
  static prepare(batch:ShaderProgramBatch){return {batch,down:batch.add('Camera glare down',vertexSource,downSource),up:batch.add('Camera glare up',vertexSource,upSource)};}

  private down:WebGLProgram|null=null;
  private up:WebGLProgram|null=null;
  private buffer:WebGLBuffer|null=null;
  private images:Level[]=[];
  private sums:Level[]=[];
  private width=0;private height=0;
  private weights:number[]=[];
  private focal=NaN;
  private uniforms:Record<string,WebGLUniformLocation|null>={};
  constructor(private gl:WebGLRenderingContext,private pixelType:number,prepared?:ReturnType<typeof CameraGlare.prepare>){
    try{
      this.down=prepared?prepared.batch.take(prepared.down):link(gl,downSource);
      this.up=prepared?prepared.batch.take(prepared.up):link(gl,upSource);
      this.buffer=gl.createBuffer();if(!this.buffer)throw Error('Cannot allocate glare pass');
      gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
      for(const name of ['source','sourceSize','targetSize','solarMask'])this.uniforms[`down.${name}`]=gl.getUniformLocation(this.down,name);
      for(const name of ['coarse','detail','coarseSize','targetSize','coarseScale','detailWeight'])this.uniforms[`up.${name}`]=gl.getUniformLocation(this.up,name);
    }catch(error){this.dispose();throw error;}
  }
  /** Returns the glare image at half resolution, or null when the frame is
   * too small for a pyramid. solarMask: Sun centre (frame units), footprint
   * radius, and 1 when the Sun is visible. focal: frame-height focal length. */
  render(image:WebGLTexture,width:number,height:number,solarMask:[number,number,number,number],focal=1.25){
    const gl=this.gl;
    if(width!==this.width||height!==this.height)this.allocate(width,height);
    const levels=this.images.length;
    if(focal!==this.focal){this.focal=focal;this.weights=glareWeights(height,levels,focal);}
    if(levels<2)return null;
    gl.useProgram(this.down);
    gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);
    const position=gl.getAttribLocation(this.down!,'position');
    gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
    gl.uniform1i(this.uniforms['down.source'],4);
    let source=image,sourceWidth=width,sourceHeight=height;
    for(const [k,level] of this.images.entries()){
      gl.bindFramebuffer(gl.FRAMEBUFFER,level.target);gl.viewport(0,0,level.width,level.height);
      gl.activeTexture(gl.TEXTURE4);gl.bindTexture(gl.TEXTURE_2D,source);
      gl.uniform2f(this.uniforms['down.sourceSize'],sourceWidth,sourceHeight);
      gl.uniform2f(this.uniforms['down.targetSize'],level.width,level.height);
      gl.uniform4fv(this.uniforms['down.solarMask'],k===0?solarMask:[0,0,0,0]);
      gl.drawArrays(gl.TRIANGLES,0,3);
      source=level.texture;sourceWidth=level.width;sourceHeight=level.height;
    }
    gl.useProgram(this.up);
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
  private allocate(width:number,height:number){
    const gl=this.gl;
    this.release();
    this.width=width;this.height=height;
    const levels=glareLevels(width,height);
    this.focal=NaN;
    const level=(k:number):Level=>{
      const texture=gl.createTexture(),target=gl.createFramebuffer();
      if(!texture||!target)throw Error('Cannot allocate glare level');
      const w=Math.max(1,width>>k),h=Math.max(1,height>>k);
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
  }
  private release(){
    for(const level of [...this.images,...this.sums]){this.gl.deleteTexture(level.texture);this.gl.deleteFramebuffer(level.target);}
    this.images=[];this.sums=[];this.width=0;this.height=0;
  }
  dispose(){
    this.release();
    if(this.down)this.gl.deleteProgram(this.down);
    if(this.up)this.gl.deleteProgram(this.up);
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
