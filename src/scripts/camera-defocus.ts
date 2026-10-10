import {textureImage2D} from './webgl-context.ts';
import type {ShaderProgramBatch} from './shader-programs';
import { sceneColorShader } from './scene-color';
import { cameraModelShader } from './camera-model';
import { sceneImageShader } from './scene-image';
const fragmentSource=`
precision highp float;
uniform sampler2D scene;
uniform sampler2D exposureState;
uniform vec2 resolution;
uniform float pixelRatio;
uniform float focusRadius;
uniform float sceneLinear;
float cameraOpening;
float cameraPupilScale;
${sceneColorShader}
${cameraModelShader}
${sceneImageShader}
vec3 defocusedImage(vec2 uv){
  if(focusRadius<.01)return imageAt(uv);
  vec3 sum=vec3(0.);
  // Fixed area-uniform samples of a rounded six-blade pupil. Optical energy
  // is averaged in linear light. No temporal jitter and no blur of sensor noise.
  for(int i=0;i<48;i++){
    float a=float(i)*2.39996323;
    float r=sqrt((float(i)+.5)/48.);
    float sector=mod(a-.27+.523598776,1.047197551)-.523598776;
    float pupil=mix(1.,.866025404/cos(sector),mix(.75,.20,cameraOpening));
    vec2 offset=vec2(cos(a),sin(a))*r*pupil*focusRadius*cameraPupilScale*pixelRatio/resolution;
    sum+=imageAt(uv+offset);
  }
  return sum/48.;
}

void main(){
  vec4 camera=cameraProgram(decodeCameraEV(texture2D(exposureState,vec2(.5)).rg));
  cameraOpening=camera.w;cameraPupilScale=4./camera.x;
  vec3 color=defocusedImage(gl_FragCoord.xy/resolution);
  gl_FragColor=sceneLinear>.5?vec4(color,1.):packSceneRadiance(color);
}
`;
/** A temporary optical image reused by all three chromatic channels. Full
 * scene resolution avoids a soft last frame; the scene already scales while
 * loading. Once focused there is no pass or retained defocus render target. */
export class CameraDefocus {
 static prepare(batch:ShaderProgramBatch){return {batch,program:batch.add('Camera defocus','attribute vec2 position;void main(){gl_Position=vec4(position,0.,1.);}',fragmentSource)};}

 private program:WebGLProgram|null=null;
 private buffer:WebGLBuffer|null=null;
 private target:WebGLFramebuffer|null=null;
 private texture:WebGLTexture|null=null;
 private width=0;private height=0;
 private position=0;
 private uniforms:Record<string,WebGLUniformLocation|null>={};
 private gl:WebGLRenderingContext;
 private pixelType:number;
 constructor(gl:WebGLRenderingContext,pixelType:number,prepared?:ReturnType<typeof CameraDefocus.prepare>){
  this.gl=gl;this.pixelType=pixelType;
  const shaders:WebGLShader[]=[];
  try{
   this.program=prepared?prepared.batch.take(prepared.program):gl.createProgram();this.buffer=gl.createBuffer();
   if(!this.program||!this.buffer)throw Error('Cannot allocate defocus pass');
   if(!prepared){
     for(const [type,source] of [[gl.VERTEX_SHADER,'attribute vec2 position;void main(){gl_Position=vec4(position,0.,1.);}'],[gl.FRAGMENT_SHADER,fragmentSource]] as const){
      const shader=gl.createShader(type);if(!shader)throw Error('Cannot allocate defocus shader');
      shaders.push(shader);gl.shaderSource(shader,source);gl.compileShader(shader);
      if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(shader)??'Defocus compilation failed');
      gl.attachShader(this.program,shader);
     }
     gl.linkProgram(this.program);
     if(!gl.getProgramParameter(this.program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(this.program)??'Defocus link failed');
   }
   gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
   this.position=gl.getAttribLocation(this.program,'position');
   for(const name of ['scene','exposureState','resolution','pixelRatio','focusRadius','sceneLinear'])this.uniforms[name]=gl.getUniformLocation(this.program,name);
  }catch(error){this.dispose();throw error;}finally{for(const shader of shaders)gl.deleteShader(shader);}
 }
 render(scene:WebGLTexture,exposure:WebGLTexture,width:number,height:number,pixelRatio:number,radius:number){
  if(radius<.01){this.releaseTarget();return scene;}
  const gl=this.gl,linear=this.pixelType!==gl.UNSIGNED_BYTE;
  if(!this.texture){
   this.texture=gl.createTexture();this.target=gl.createFramebuffer();
   if(!this.texture||!this.target)throw Error('Cannot allocate defocus image');
   gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_2D,this.texture);
   for(const axis of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,axis,gl.CLAMP_TO_EDGE);
   for(const filter of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,filter,linear?gl.LINEAR:gl.NEAREST);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER,this.target);
  if(width!==this.width||height!==this.height){
   gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_2D,this.texture);
   textureImage2D(gl,gl.TEXTURE_2D,0,gl.RGBA,width,height,0,gl.RGBA,this.pixelType,null);
   gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.texture,0);
   if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Incomplete defocus target');
   this.width=width;this.height=height;
  }
  gl.viewport(0,0,width,height);gl.useProgram(this.program);
  gl.activeTexture(gl.TEXTURE6);gl.bindTexture(gl.TEXTURE_2D,scene);gl.uniform1i(this.uniforms.scene,6);
  gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,exposure);gl.uniform1i(this.uniforms.exposureState,2);
  gl.uniform2f(this.uniforms.resolution,width,height);gl.uniform1f(this.uniforms.pixelRatio,pixelRatio);
  gl.uniform1f(this.uniforms.focusRadius,radius);gl.uniform1f(this.uniforms.sceneLinear,linear?1:0);
  gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.enableVertexAttribArray(this.position);gl.vertexAttribPointer(this.position,2,gl.FLOAT,false,0,0);
  const dither=gl.isEnabled(gl.DITHER);if(!linear)gl.disable(gl.DITHER);
  gl.drawArrays(gl.TRIANGLES,0,3);if(dither&&!linear)gl.enable(gl.DITHER);
  return this.texture!;
 }
 private releaseTarget(){
  if(this.texture)this.gl.deleteTexture(this.texture);
  if(this.target)this.gl.deleteFramebuffer(this.target);
  this.texture=null;this.target=null;this.width=0;this.height=0;
 }
 dispose(){this.releaseTarget();if(this.program)this.gl.deleteProgram(this.program);if(this.buffer)this.gl.deleteBuffer(this.buffer);}
}
