import type {ShaderProgramBatch} from './shader-programs';
import { sceneColorShader } from './scene-color';

import { AUTO_EXPOSURE_MIN_EV, EXPOSURE_MIN_EV, EXPOSURE_MAX_EV, cameraModelShader } from './camera-model';
import { SOLAR_IRRADIANCE, SOLAR_RADIUS } from './solar-light';
export { EXPOSURE_MIN_EV, EXPOSURE_MAX_EV };
export const EXPOSURE_SETTLE_MS=7000;

// A one-pixel meter and two RGBA8 state targets. Exposure stays on the GPU:
// no framebuffer readback or image-sized reduction chain on mobile.
const fragment=`
precision highp float;
precision highp sampler2D;
uniform sampler2D scene;
uniform sampler2D previous;
uniform float sceneLinear;
uniform float elapsed;
uniform float initialized;
uniform vec3 sunMeter;
uniform float aspect;
uniform float manualEV;
uniform float automatic;
uniform sampler2D sourceAttenuation;
uniform float hasAttenuation;
${sceneColorShader}
${cameraModelShader}
void main(){
  vec3 weights=displayP3>.5?vec3(.2289746,.6917385,.0792869):vec3(.2126,.7152,.0722);
  float total=0.,emission=0.,emissionWeight=0.,coverage=0.;
  // A log-luminance histogram, entirely on the GPU. Bin sums retain the
  // measured luminance within each stop rather than rounding to bin centres.
  float mass[24];float logs[24];
  for(int bin=0;bin<24;bin++){mass[bin]=0.;logs[bin]=0.;}
  for(int y=0;y<32;y++)for(int x=0;x<32;x++){
    vec2 uv=(vec2(float(x),float(y))+.5)/32.;
    vec4 pixel=texture2D(scene,uv);
    vec3 c=sceneLinear>.5?pixel.rgb:unpackSceneRadiance(pixel);
    float w=1.+exp(-dot(uv-.5,uv-.5)*8.);
    float luminance=dot(c,weights);
    float logL=clamp(log2(max(luminance,exp2(-16.))),-16.,7.999);
    float bucket=floor(logL+16.);
    for(int bin=0;bin<24;bin++){
      float included=1.-step(.5,abs(float(bin)-bucket));
      mass[bin]+=w*included;logs[bin]+=w*included*logL;
    }
    total+=w;
    // Highlight-weighted metering uses pixel energy, never object identity.
    // Sparse points may clip; extended bright regions retain their colour.
    float peak=max(c.r,max(c.g,c.b));
    float lit=smoothstep(.025,.10,peak);
    float boundedPeak=min(peak,2.);
    emission+=boundedPeak*boundedPeak*lit;emissionWeight+=boundedPeak*lit;coverage+=lit;
  }
  // Account for the finite solar disk even when it falls between meter taps.
  // The meter contribution is independent of the artistic reflection slider.
  float radius=${(SOLAR_RADIUS*1.25).toFixed(8)};
  float inFrame=(1.-smoothstep(aspect*.5-radius,aspect*.5+radius,abs(sunMeter.x)))
    *(1.-smoothstep(.5-radius,.5+radius,abs(sunMeter.y)));
  vec3 transmission=hasAttenuation>.5?texture2D(sourceAttenuation,vec2(.3,.5)).rgb:vec3(1.);
  float sunMean=${SOLAR_IRRADIANCE}*1.5625/aspect*sunMeter.z*inFrame*dot(transmission,weights);
  float cumulative=0.,logSum=0.,retained=0.;
  for(int bin=0;bin<24;bin++){
    float count=mass[bin];
    float take=max(0.,min(cumulative+count,total*.98)-max(cumulative,total*.10));
    logSum+=take*logs[bin]/max(count,.00001);retained+=take;
    cumulative+=count;
  }
  float measured=exp2(logSum/max(retained,.00001));
  float target=log2(.055/max(measured+sunMean*.45,.00001));
  float emissionTarget=log2(.25/max(emission/max(emissionWeight,.0001),.00001));
  target=mix(target,min(target,emissionTarget),smoothstep(.006,.025,coverage/1024.));
  target=clamp(target,${AUTO_EXPOSURE_MIN_EV},${EXPOSURE_MAX_EV});
  vec4 state=texture2D(previous,vec2(.5));
  float old=decodeCameraEV(state.rg);
  // EV is logarithmic; brighten more slowly than the response to daylight.
  float tau=target>old?1.25:.4;
  // Require a sustained darkening request before reacting to a flash.
  // B stores the previous target; A stores up to 0.25 s of its persistence.
  float previousTarget=mix(${EXPOSURE_MIN_EV},${EXPOSURE_MAX_EV},state.b);
  float age=abs(target-previousTarget)>.5?0.:min(.25,state.a*.25+elapsed);
  float responseTime=target<old?min(elapsed,max(0.,age-.12)):elapsed;
  float ev=initialized<.5?target:mix(old,target,1.-exp(-responseTime/tau));
  if(automatic<.5)ev=clamp(manualEV,${EXPOSURE_MIN_EV},${EXPOSURE_MAX_EV});
  float encodedEV=floor(clamp((ev-(${EXPOSURE_MIN_EV}))/${EXPOSURE_MAX_EV-EXPOSURE_MIN_EV},0.,1.)*65535.+.5);
  gl_FragColor=vec4(floor(encodedEV/256.)/255.,mod(encodedEV,256.)/255.,(target-(${EXPOSURE_MIN_EV}))/${EXPOSURE_MAX_EV-EXPOSURE_MIN_EV},age/.25);
}`;

export class CameraExposure {
  static prepare(batch:ShaderProgramBatch){return {batch,program:batch.add('Camera exposure','attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}',fragment)};}

  get texture(){return this.targets[this.index].texture;}
  private program:WebGLProgram;
  private buffer:WebGLBuffer;
  private targets:{texture:WebGLTexture;framebuffer:WebGLFramebuffer}[]=[];
  private uniforms:Record<string,WebGLUniformLocation|null>={};
  private position=0;
  private index=0;
  private lastTime:number|null=null;
  constructor(private gl:WebGLRenderingContext,prepared?:ReturnType<typeof CameraExposure.prepare>){
    const program=prepared?prepared.batch.take(prepared.program):gl.createProgram(),buffer=gl.createBuffer();
    if(!program||!buffer){gl.deleteProgram(program);gl.deleteBuffer(buffer);throw Error('Cannot allocate exposure meter');}
    this.program=program;this.buffer=buffer;
    const shaders:WebGLShader[]=[];
    try{
      if(!prepared){
        for(const [type,source] of [[gl.VERTEX_SHADER,'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}'],[gl.FRAGMENT_SHADER,fragment]] as const){
          const shader=gl.createShader(type);if(!shader)throw Error('Cannot allocate exposure shader');
          shaders.push(shader);gl.shaderSource(shader,source);gl.compileShader(shader);
          if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(shader)??'Exposure shader failed');
          gl.attachShader(program,shader);
        }
        gl.linkProgram(program);
        if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program)??'Exposure link failed');
      }
      this.position=gl.getAttribLocation(program,'p');
      for(const name of ['scene','previous','sceneLinear','displayP3','elapsed','initialized','sunMeter','aspect','manualEV','automatic','sourceAttenuation','hasAttenuation'])this.uniforms[name]=gl.getUniformLocation(program,name);
      gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
      for(let i=0;i<2;i++){
        const texture=gl.createTexture(),framebuffer=gl.createFramebuffer();
        if(!texture||!framebuffer){gl.deleteTexture(texture);gl.deleteFramebuffer(framebuffer);throw Error('Cannot allocate exposure state');}
        this.targets.push({texture,framebuffer});gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array(4));
        for(const axis of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,axis,gl.CLAMP_TO_EDGE);
        for(const filter of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,filter,gl.NEAREST);
        gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
        if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Incomplete exposure target');
      }
    }catch(error){this.dispose();throw error;}
    finally{shaders.forEach(shader=>gl.deleteShader(shader));gl.bindFramebuffer(gl.FRAMEBUFFER,null);}
  }
  update(scene:WebGLTexture,linear:boolean,p3:boolean,now:number,sun:[number,number,number]=[0,0,0],aspect=1,attenuation:WebGLTexture|null=null,manualEV:number|null=null){
    const gl=this.gl,next=1-this.index;
    gl.bindFramebuffer(gl.FRAMEBUFFER,this.targets[next].framebuffer);gl.viewport(0,0,1,1);gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,scene);
    gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,this.targets[this.index].texture);
    gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,attenuation??scene);
    gl.uniform1i(this.uniforms.sourceAttenuation,2);
    gl.uniform1f(this.uniforms.hasAttenuation,attenuation?1:0);
    gl.uniform1f(this.uniforms.automatic,manualEV===null?1:0);gl.uniform1f(this.uniforms.manualEV,manualEV??0);gl.uniform3fv(this.uniforms.sunMeter,sun);gl.uniform1f(this.uniforms.aspect,aspect);
    gl.uniform1i(this.uniforms.scene,0);gl.uniform1i(this.uniforms.previous,1);
    gl.uniform1f(this.uniforms.sceneLinear,linear?1:0);gl.uniform1f(this.uniforms.displayP3,p3?1:0);
    gl.uniform1f(this.uniforms.initialized,this.lastTime===null?0:1);
    gl.uniform1f(this.uniforms.elapsed,this.lastTime===null?0:Math.min(.25,Math.max(0,(now-this.lastTime)/1000)));
    gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.enableVertexAttribArray(this.position);gl.vertexAttribPointer(this.position,2,gl.FLOAT,false,0,0);
    const dither=gl.isEnabled(gl.DITHER);gl.disable(gl.DITHER);
    gl.drawArrays(gl.TRIANGLES,0,3);if(dither)gl.enable(gl.DITHER);
    this.index=next;this.lastTime=now;
    return this.targets[next].texture;
  }
  dispose(){
    const gl=this.gl;gl.deleteProgram(this.program);gl.deleteBuffer(this.buffer);
    for(const target of this.targets){gl.deleteTexture(target.texture);gl.deleteFramebuffer(target.framebuffer);}
    this.targets=[];
  }
}
