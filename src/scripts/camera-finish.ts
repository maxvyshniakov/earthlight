import {halfFloatTarget,textureImage2D} from './webgl-context.ts';
import type {ShaderProgramBatch} from './shader-programs';
import { sceneImageShader } from './scene-image';
import { CameraDefocus } from './camera-defocus';
import { SOLAR_IRRADIANCE, SOLAR_RADIUS, SOLAR_SCATTER_FRACTION } from './solar-light';
import { lensReflectionShader } from './lens-reflections';
import { sceneColorShader } from './scene-color';
import { poissonQuantiles, POISSON_COLUMNS, POISSON_ROWS } from './sensor-noise';
import { CameraExposure } from './camera-exposure';
import { cameraModelShader } from './camera-model';
export const CAMERA_EXPOSURE_EV=0;
export type LensFrame={moon:[number,number,number];sun:[number,number,number];points:Float32Array;pointAmount:number;attenuation:WebGLTexture|null;sunReflections?:number;focal?:number};
const fragmentSource = `
precision highp float;
precision highp sampler2D;
uniform sampler2D scene;
uniform vec2 resolution;
uniform float pixelRatio;
uniform float grainFrame;
uniform float grainAmount;
uniform float chromaticAmount;
uniform sampler2D poisson;
uniform float focusRadius;
uniform float sceneLinear;
uniform float exposureEV;
uniform sampler2D exposureState;
uniform vec3 moonGhost;
uniform vec3 sunGhost;
uniform float sunReflectionAmount;
uniform vec4 pointGhosts[3];
uniform float pointGhostAmount;
uniform sampler2D sourceAttenuation;
uniform float hasAttenuation;
uniform float zoomExcess;
#define FOCAL (1.25*(1.+zoomExcess))
${sceneColorShader}
${cameraModelShader}
float cameraOpening;
float cameraPupilScale;
float ghostSourceRadius;
${lensReflectionShader}
vec3 sourceEnergy(float column){
  return hasAttenuation>.5?texture2D(sourceAttenuation,vec2(column,.5)).rgb:vec3(1.);
}
vec3 reflectionsAt(vec2 p,float aspect){
  vec3 result=vec3(0.);
  ghostSourceRadius=0.;
  if(moonGhost.z>0.)result+=lensReflections(p,moonGhost.xy,aspect,1.)*moonGhost.z*sourceEnergy(.1);
  if(sunGhost.z>0.){
    // Finite solar disk broadens the conjugate image even with a closed iris.
    // Keep reflection energy below the sensor shoulder, not alpha-composited.
#ifndef FOCAL
#define FOCAL 1.25
#endif
    ghostSourceRadius=${SOLAR_RADIUS}*FOCAL;
    float projectionArea=FOCAL*FOCAL*pow(1.+dot(sunGhost.xy,sunGhost.xy)/(FOCAL*FOCAL),1.5);
    result+=lensReflections(p,sunGhost.xy,aspect,1.)*sunGhost.z*${SOLAR_IRRADIANCE}*projectionArea*sunReflectionAmount*sourceEnergy(.3);
  }
  ghostSourceRadius=0.;
  if(pointGhostAmount>0.)for(int i=0;i<3;i++){
    vec4 source=pointGhosts[i];
    if(source.z>0.){
      float bv=clamp(source.w,-.35,2.);
      vec3 tint=bv<.45?mix(vec3(.64,.76,1.),vec3(1.),(bv+.35)/.8)
        :mix(vec3(1.),vec3(1.,.62,.35),(bv-.45)/1.55);
      result+=lensReflections(p,source.xy,aspect,0.)*source.z*pointGhostAmount*pow(tint,vec3(2.2))*sourceEnergy((float(i)+2.5)/5.);
    }
  }
  return lensToOutputLinear(result);
}
// Smooth forward scatter is separate from the colored reflection ghosts.
// Kernels integrate to one in angular coordinates; their energy comes from
// the same solar irradiance as the disk. Do not clip the halo to Earth's limb.
vec3 solarVeil(vec2 p){
  if(sunGhost.z<=0.)return vec3(0.);
  vec2 delta=(p-sunGhost.xy)/1.25;
  float r2=dot(delta,delta);
  float narrow=1./(3.14159265*.000225)*pow(1.+r2/.000225,-2.);
  float broad=1./(3.14159265*.0064)*pow(1.+r2/.0064,-2.);
  float acceptance=1.-smoothstep(.8,1.4,length(sunGhost.xy)/1.25);
  return sceneToOutputLinear(vec3(1.,.97,.92))*sourceEnergy(.3)*sunGhost.z
    *${SOLAR_IRRADIANCE*SOLAR_SCATTER_FRACTION}*(.8*narrow+.2*broad)*acceptance;
}
${sceneImageShader}
float hash(vec2 p) {
  vec3 p3=fract(vec3(p.xyx)*.1031);
  p3+=dot(p3,p3.yzx+33.33);
  return fract((p3.x+p3.y)*p3.z);
}
// Equivalent RGB sensor in linear output primaries. Shot/read noise precede
// ISO amplification and the display curve; ISO never creates extra photons.
float sensorChannel(float opticalSignal,float isoGain,vec2 seed) {
  float electronsAtWhite=36000./max(.0001,grainAmount*grainAmount);
  float expected=max(0.,opticalSignal)*electronsAtWhite;
  if(grainAmount<.001)return min(max(0.,opticalSignal),4.)*isoGain;
  float u=max(hash(seed),.000001);
  float angle=6.283185307*hash(seed+vec2(113.7,47.1));
  vec2 normal=sqrt(-2.*log(u))*vec2(cos(angle),sin(angle));
  float measured;
  if(expected<16.) {
    float quantile=hash(seed+vec2(219.3,97.8));
    float row=floor(sqrt(expected/16.)*${POISSON_ROWS-1}.+.5);
    measured=texture2D(poisson,vec2(quantile,(row+.5)/${POISSON_ROWS}. )).r*255.;
  } else {
    measured=expected+sqrt(expected)*normal.x;
  }
  // Upstream read noise plus downstream electronics referred back through ISO.
  // This smooth preset deliberately avoids inventing a dual-gain switching ISO.
  float readNoise=sqrt(.9*.9+pow(.8/isoGain,2.));
  measured+=readNoise*normal.y;
  return clamp(measured/electronsAtWhite,0.,4.)*isoGain;
}

// Display highlight roll-off after exposure and ISO. Retain color below the
// shoulder, then approach neutral white as sensor highlights overexpose.
// This photographic approximation preserves the existing peak-energy curve.
vec3 cameraHighlights(vec3 linear) {
  float peak=max(linear.r,max(linear.g,linear.b));
  if(peak<=.8)return linear;
  float shoulder=.8+.2*(1.-exp(-(peak-.8)/.2));
  float white=smoothstep(.8,2.,peak);
  return mix(linear/peak,vec3(1.),white)*shoulder;
}

void main() {
  float automaticEV=decodeCameraEV(texture2D(exposureState,vec2(.5)).rg);
  vec4 camera=cameraProgram(automaticEV);
  cameraOpening=camera.w;
  cameraPupilScale=4./camera.x;
  vec2 uv=gl_FragCoord.xy/resolution;
  vec2 field=(uv-.5)*vec2(resolution.x/resolution.y,1.)/1.25;
  // Lateral chromatic magnification: zero on-axis, increasing quadratically
  // toward the edges. The normalized 100% baseline is half its previous strength.
  // Deliberately visible photographic grading, not calibration.
  vec2 shift=field*length(field)*chromaticAmount*9.*pixelRatio/resolution;
  vec3 linear=vec3(imageAt(uv-shift).r,imageAt(uv).g,imageAt(uv+shift).b);
  float aspect=resolution.x/resolution.y;
  vec2 p=(uv-.5)*vec2(aspect,1.);
  // Ghost paths have their own conjugates; focus changes their size/softness
  // in apertureGhost instead of convolving them with the scene's pupil.
  linear+=reflectionsAt(p,aspect)+solarVeil(p);
  // Aperture changes collected light; ISO amplifies the sampled sensor signal.
  // Their product exactly retains the previously accepted metered exposure.
  float vignette=max(0.,1.-mix(.20,.28,cameraOpening)*pow(length(p/vec2(aspect*.8,.9)),2.));
  linear*=exp2(.5+exposureEV)*camera.y*pow(vignette,2.2);
  vec2 grainSeed=vec2(hash(vec2(grainFrame,19.3)),hash(vec2(71.7,grainFrame)))*256.;
  const float grainSizeCss=1.;
  vec2 sensorPixel=floor(gl_FragCoord.xy/(max(pixelRatio,.001)*grainSizeCss))+grainSeed;
  linear=vec3(sensorChannel(linear.r,camera.z,sensorPixel),
              sensorChannel(linear.g,camera.z,sensorPixel+vec2(51.3,173.9)),
              sensorChannel(linear.b,camera.z,sensorPixel+vec2(137.2,23.6)));
  linear=cameraHighlights(linear);
  vec3 color=linearToDisplay(max(linear,vec3(0.)));

  gl_FragColor=vec4(max(color,0.),1.);
}
`;

/** Optical channel separation precedes sensor noise; page content never enters this pass. */
export class CameraFinish {
  static prepare(batch:ShaderProgramBatch){return {batch,program:batch.add('Camera finish','attribute vec2 position;void main(){gl_Position=vec4(position,0.,1.);}',fragmentSource),exposure:CameraExposure.prepare(batch),defocus:CameraDefocus.prepare(batch)};}

  get exposureTexture(){return this.exposure!.texture;}
  get linear(){return this.pixelType!==this.gl.UNSIGNED_BYTE;}
  private program:WebGLProgram|null=null;
  private buffer:WebGLBuffer|null=null;
  private texture:WebGLTexture|null=null;
  private framebuffer:WebGLFramebuffer|null=null;
  private width=0;
  private height=0;
  private pixelType:number;
  private uniforms:Record<string,WebGLUniformLocation|null>={};
  private noiseTexture:WebGLTexture|null=null;
  private position=0;
  private exposure:CameraExposure|null=null;
  private defocus:CameraDefocus|null=null;
  constructor(private gl:WebGLRenderingContext,private displayP3=false,prepared?:ReturnType<typeof CameraFinish.prepare>){
    this.pixelType=halfFloatTarget(gl,true)??gl.UNSIGNED_BYTE;
    const shaders:WebGLShader[]=[];
    try {
      this.program=prepared?prepared.batch.take(prepared.program):gl.createProgram();
      if(!this.program)throw new Error('Cannot allocate camera finish');
      if(!prepared){
        for(const [type,source] of [[gl.VERTEX_SHADER,'attribute vec2 position;void main(){gl_Position=vec4(position,0.,1.);}'],[gl.FRAGMENT_SHADER,fragmentSource]] as const){
          const shader=gl.createShader(type);
          if(!shader)throw new Error('Cannot allocate camera shader');
          shaders.push(shader);gl.shaderSource(shader,source);gl.compileShader(shader);
          if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(shader)??'Camera shader failed');
          gl.attachShader(this.program,shader);
        }
        gl.linkProgram(this.program);
        if(!gl.getProgramParameter(this.program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(this.program)??'Camera link failed');
      }
      this.buffer=gl.createBuffer();this.texture=gl.createTexture();this.framebuffer=gl.createFramebuffer();
      if(!this.buffer||!this.texture||!this.framebuffer)throw new Error('Cannot allocate camera target');
      gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);
      gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
      gl.activeTexture(gl.TEXTURE6);gl.bindTexture(gl.TEXTURE_2D,this.texture);
      for(const axis of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,axis,gl.CLAMP_TO_EDGE);
      for(const filter of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,filter,this.linear?gl.LINEAR:gl.NEAREST);
      this.noiseTexture=gl.createTexture();if(!this.noiseTexture)throw Error('Cannot allocate sensor LUT');
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.noiseTexture);
      textureImage2D(gl,gl.TEXTURE_2D,0,gl.LUMINANCE,POISSON_COLUMNS,POISSON_ROWS,0,gl.LUMINANCE,gl.UNSIGNED_BYTE,poissonQuantiles());
      for(const axis of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,axis,gl.CLAMP_TO_EDGE);
      for(const filter of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,filter,gl.NEAREST);
      this.position=gl.getAttribLocation(this.program,'position');
      for(const name of ['zoomExcess','scene','resolution','pixelRatio','grainFrame','grainAmount','chromaticAmount','poisson','focusRadius','sceneLinear','exposureEV','exposureState','moonGhost','sunGhost','sunReflectionAmount','pointGhosts[0]','pointGhostAmount','sourceAttenuation','hasAttenuation','displayP3'])this.uniforms[name]=gl.getUniformLocation(this.program,name);
      this.exposure=new CameraExposure(gl,prepared?.exposure);
      this.defocus=new CameraDefocus(gl,this.pixelType,prepared?.defocus);
    } catch(error){this.dispose();throw error;}
    finally {shaders.forEach(shader=>gl.deleteShader(shader));}
  }
  begin(width:number,height:number){
    const gl=this.gl;
    gl.activeTexture(gl.TEXTURE6);gl.bindTexture(gl.TEXTURE_2D,this.texture);
    gl.bindFramebuffer(gl.FRAMEBUFFER,this.framebuffer);
    if(width!==this.width||height!==this.height){
      this.width=width;this.height=height;
      textureImage2D(gl,gl.TEXTURE_2D,0,gl.RGBA,width,height,0,gl.RGBA,this.pixelType,null);
      gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.texture,0);
      if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('Incomplete camera target');
    }
    gl.viewport(0,0,width,height);
  }
  render(pixelRatio:number,grainFrame:number,grainAmount:number,chromaticAmount:number,focusRadius:number,lens:LensFrame,exposureCompensation=0,manualExposure:number|null=null){
    const gl=this.gl;
    const exposure=this.exposure!.update(this.texture!,this.linear,this.displayP3,performance.now(),lens.sun,this.width/this.height,lens.attenuation,manualExposure,lens.focal);
    const image=this.defocus!.render(this.texture!,exposure,this.width,this.height,pixelRatio,focusRadius);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,this.width,this.height);gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,exposure);
    gl.uniform1i(this.uniforms.exposureState,2);
    gl.activeTexture(gl.TEXTURE6);gl.bindTexture(gl.TEXTURE_2D,image);
    gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.noiseTexture);
    gl.uniform1i(this.uniforms.poisson,0);
    const position=this.position;
    gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
    gl.uniform1i(this.uniforms.scene,6);
    gl.uniform2f(this.uniforms.resolution,this.width,this.height);
    gl.uniform1f(this.uniforms.pixelRatio,pixelRatio);
    gl.uniform1f(this.uniforms.grainFrame,grainFrame);
    gl.uniform1f(this.uniforms.grainAmount,grainAmount);
    gl.uniform1f(this.uniforms.chromaticAmount,chromaticAmount);
    gl.uniform1f(this.uniforms.focusRadius,focusRadius);
    gl.uniform1f(this.uniforms.zoomExcess,(lens.focal??1.25)/1.25-1);
    gl.uniform1f(this.uniforms.sceneLinear,this.linear?1:0);
    // Compensation follows metering, so automatic adaptation cannot cancel
    // the user's adjustment. It remains in linear light before highlights.
    gl.uniform1f(this.uniforms.exposureEV,CAMERA_EXPOSURE_EV+exposureCompensation);
    gl.uniform1f(this.uniforms.displayP3,this.displayP3?1:0);
    gl.uniform3fv(this.uniforms.moonGhost,lens.moon);
    gl.uniform3fv(this.uniforms.sunGhost,lens.sun);
    gl.uniform1f(this.uniforms.sunReflectionAmount,lens.sunReflections??1);
    gl.uniform4fv(this.uniforms['pointGhosts[0]'],lens.points);
    gl.uniform1f(this.uniforms.pointGhostAmount,lens.pointAmount);
    gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,lens.attenuation??this.noiseTexture);
    gl.uniform1i(this.uniforms.sourceAttenuation,1);
    gl.uniform1f(this.uniforms.hasAttenuation,lens.attenuation?1:0);
    gl.drawArrays(gl.TRIANGLES,0,3);
  }
  resume(){
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER,this.framebuffer);
    this.gl.viewport(0,0,this.width,this.height);
  }
  dispose(){
    const gl=this.gl;
    this.exposure?.dispose();this.exposure=null;
    this.defocus?.dispose();this.defocus=null;
    if(this.program)gl.deleteProgram(this.program);
    if(this.texture)gl.deleteTexture(this.texture);
    if(this.framebuffer)gl.deleteFramebuffer(this.framebuffer);
    if(this.buffer)gl.deleteBuffer(this.buffer);
    if(this.noiseTexture)gl.deleteTexture(this.noiseTexture);
  }
}
