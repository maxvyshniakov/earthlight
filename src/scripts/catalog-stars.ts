import {radianceTarget,textureImage2D} from './webgl-context.ts';
import type {ShaderProgramBatch} from './shader-programs';
import { opticalPsfSource, optics } from './optical-psf';
import { pointBrightnessShader } from './point-photometry';

const vertexSource = `
precision highp float;
precision highp sampler2D;
attribute vec3 direction;
attribute vec3 velocity;
attribute vec2 photometry;
uniform mat3 starToFixed;
uniform mat3 cameraBasis;
uniform vec2 resolution;
uniform float pixelRatio;
uniform float maxPointSize;
uniform float years;
uniform float zoomExcess;
#define FOCAL (1.25*(1.+zoomExcess))
varying vec3 tint;
varying float energy;
varying float pixelScale;
varying float size;
varying vec2 sourcePosition;
varying vec2 centerPixel;
${pointBrightnessShader}
void main() {
  vec3 earthDirection=starToFixed*normalize(direction+velocity*years);
  vec3 view=vec3(dot(earthDirection,cameraBasis[0]),dot(earthDirection,cameraBasis[1]),dot(earthDirection,cameraBasis[2]));
  gl_Position=view.z>.01 ? vec4(2.*FOCAL*view.x/(view.z*resolution.x/resolution.y),2.*FOCAL*view.y/view.z,0.,1.) : vec4(2.,2.,2.,1.);
  sourcePosition=FOCAL*view.xy/max(view.z,.01);
  centerPixel=(gl_Position.xy*.5+.5)*resolution;
  // Pogson magnitude scale in linear light. A finite optical footprint
  // integrates subpixel stars without independent procedural twinkling.
  energy=pointBrightness(photometry.x);
  pixelScale=pixelRatio;
  // Bright sources need room for optical wings; faint stars stay tiny.
  size=min(maxPointSize,ceil(pixelRatio*(8.+56.*smoothstep(.015,.4,energy))));
  // Leave room for the off-axis wing; retain the same angular field on resize.
  float field=clamp(length(sourcePosition)/1.25,0.,1.);
  size=min(maxPointSize,ceil(size*(1.+.9*field*field)+pixelRatio*3.2*field*field));
  gl_PointSize=size;
  float bv=clamp(photometry.y,-.35,2.);
  tint=bv<.45 ? mix(vec3(.64,.76,1.),vec3(1.),(bv+.35)/.8)
    : mix(vec3(1.),vec3(1.,.62,.35),(bv-.45)/1.55);
}
`;
const fragmentSource = `
precision highp float;
precision highp sampler2D;
varying vec3 tint;
varying float energy;
varying float pixelScale;
varying float size;
varying vec2 sourcePosition;
varying vec2 centerPixel;
uniform float linearOutput;
#define CAMERA_PUPIL_STATE 1
${opticalPsfSource}
// Integral of a Gaussian across each sensor pixel. Keeping the true projected
// center avoids point-sprite snapping as a subpixel star moves across the frame.
vec2 gaussianCdf(vec2 x){
  vec2 a=abs(x)*.7071067812;
  vec2 t=1./(1.+.3275911*a);
  vec2 erf=1.-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-.284496736)*t+.254829592)*t*exp(-a*a);
  return .5+.5*sign(x)*erf;
}
void main() {
  vec2 delta=(gl_FragCoord.xy-centerPixel)/pixelScale;
  float edge=1.-smoothstep(.80,1.,length(delta)/(size/pixelScale*.5));
  float ev=decodeCameraEV(texture2D(cameraState,vec2(.5)).rg);
  float sigma=.30*cameraProgram(ev).x/4.;
  float footprint=1./pixelScale;
  vec2 covered=gaussianCdf((delta+footprint*.5)/sigma)-gaussianCdf((delta-footprint*.5)/sigma);
  float core=${optics.integral.toFixed(8)}*covered.x*covered.y/(footprint*footprint);
  // Fixed, flux-conserving core/wing mixture: faint sources have the same
  // optics, but only bright sources lift the weak wings above visibility.
  vec3 profile=vec3(core*.96)+lensPsf(delta,sourcePosition)*.04;
  vec3 radiance=pow(tint,vec3(2.2))*energy*profile*edge;
  gl_FragColor=vec4(mix(pow(radiance,vec3(1./2.2)),radiance,linearOutput),1.);
}
`;

/** A catalog point pass; Earth's occlusion and extinction happen in the scene pass. */
export class CatalogStars {
  static prepare(batch:ShaderProgramBatch){return {batch,program:batch.add('Catalog stars',vertexSource,fragmentSource)};}

  private program:WebGLProgram|null=null;
  private buffer:WebGLBuffer|null=null;
  private framebuffer:WebGLFramebuffer|null=null;
  readonly texture:WebGLTexture;
  readonly linear:boolean;
  private pixelType:number;
  private width=0;
  private height=0;
  private count=0;
  private maxPointSize=1;
  private uniforms:Record<string,WebGLUniformLocation|null>={};

  constructor(private gl:WebGLRenderingContext,prepared?:ReturnType<typeof CatalogStars.prepare>) {
    const texture=gl.createTexture();
    if(!texture)throw new Error('Cannot allocate catalog target');
    this.texture=texture;
    const half=radianceTarget(gl);
    this.linear=half!==null;
    this.pixelType=half??gl.UNSIGNED_BYTE;
    this.maxPointSize=gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1];
    const shaders:WebGLShader[]=[];
    try {
      this.program=prepared?prepared.batch.take(prepared.program):gl.createProgram();
      if(!this.program)throw new Error('Cannot allocate catalog program');
      if(!prepared){
        for(const [type,source] of [[gl.VERTEX_SHADER,vertexSource],[gl.FRAGMENT_SHADER,fragmentSource]] as const){
          const shader=gl.createShader(type);
          if(!shader)throw new Error('Cannot allocate catalog shader');
          shaders.push(shader);
          gl.shaderSource(shader,source);gl.compileShader(shader);
          if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(shader)??'Catalog shader failed');
          gl.attachShader(this.program,shader);
        }
        gl.linkProgram(this.program);
        if(!gl.getProgramParameter(this.program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(this.program)??'Catalog link failed');
      }
      this.buffer=gl.createBuffer();this.framebuffer=gl.createFramebuffer();
      if(!this.buffer||!this.framebuffer)throw new Error('Cannot allocate catalog geometry');
      gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_2D,texture);
      for(const axis of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,axis,gl.CLAMP_TO_EDGE);
      for(const filter of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,filter,gl.NEAREST);
      for(const name of ['starToFixed','cameraBasis','resolution','years','zoomExcess','pixelRatio','maxPointSize','opticalPsf','linearOutput','cameraState'])this.uniforms[name]=gl.getUniformLocation(this.program,name);
    } catch(error) { this.dispose();throw error; }
    finally { shaders.forEach(shader=>gl.deleteShader(shader)); }
  }

  upload(data:Float32Array) {
    const gl=this.gl;
    this.count=data.length/8;
    gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER,data,gl.STATIC_DRAW);
  }

  render(width:number,height:number,pixelRatio:number,starToFixed:number[],cameraBasis:number[],years:number,cameraState:WebGLTexture,focal=1.25) {
    const gl=this.gl;
    gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_2D,this.texture);
    gl.bindFramebuffer(gl.FRAMEBUFFER,this.framebuffer);
    if(width!==this.width||height!==this.height){
      this.width=width;this.height=height;
      textureImage2D(gl,gl.TEXTURE_2D,0,gl.RGBA,width,height,0,gl.RGBA,this.pixelType,null);
      gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.texture,0);
      if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('Incomplete catalog framebuffer');
    }
    gl.viewport(0,0,width,height);
    gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
    if(this.count){
      gl.useProgram(this.program);gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);
      for(const [name,size,offset] of [['direction',3,0],['velocity',3,12],['photometry',2,24]] as const){
        const attribute=gl.getAttribLocation(this.program!,name);
        gl.enableVertexAttribArray(attribute);gl.vertexAttribPointer(attribute,size,gl.FLOAT,false,32,offset);
      }
      gl.uniformMatrix3fv(this.uniforms.starToFixed,false,starToFixed);
      gl.uniformMatrix3fv(this.uniforms.cameraBasis,false,cameraBasis);
      gl.uniform2f(this.uniforms.resolution,width,height);
      gl.uniform1f(this.uniforms.pixelRatio,pixelRatio);
      gl.uniform1f(this.uniforms.maxPointSize,this.maxPointSize);
      gl.uniform1f(this.uniforms.years,years);
      gl.uniform1f(this.uniforms.zoomExcess,focal/1.25-1);
      gl.uniform1i(this.uniforms.opticalPsf,4);
      gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,cameraState);
      gl.uniform1i(this.uniforms.cameraState,2);
      gl.uniform1f(this.uniforms.linearOutput,this.linear?1:0);
      gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE);
      gl.drawArrays(gl.POINTS,0,this.count);
      gl.disable(gl.BLEND);
      for(const name of ['direction','velocity','photometry'])gl.disableVertexAttribArray(gl.getAttribLocation(this.program!,name));
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
  }

  dispose() {
    const gl=this.gl;
    gl.deleteTexture(this.texture);
    if(this.framebuffer)gl.deleteFramebuffer(this.framebuffer);
    if(this.buffer)gl.deleteBuffer(this.buffer);
    if(this.program)gl.deleteProgram(this.program);
  }
}
