import type {ShaderProgramBatch} from './shader-programs';
import { sceneColorShader } from './scene-color';

import { AUTO_EXPOSURE_MIN_EV, EXPOSURE_MIN_EV, EXPOSURE_MAX_EV, exposureMaxEV, cameraModelShaderFor } from './camera-model';
import { SOLAR_IRRADIANCE, SOLAR_RADIUS } from './solar-light';
import { METER_LIT, METER_MAX_SIDE, METER_SUBJECT_EV, type MeterField } from './camera-glare';
import { perNightMode, physicalNight, type NightMode } from './physical-night';
import { preExposure } from './pre-exposure';
export { EXPOSURE_MIN_EV, EXPOSURE_MAX_EV, exposureMaxEV };
export const EXPOSURE_SETTLE_MS=7000;

// A one-pixel meter and two RGBA8 state targets. Exposure stays on the GPU:
// no framebuffer readback or image-sized reduction chain on mobile.
const fragmentFor=perNightMode(mode=>{
// 24 log-luminance bins. Physical night radiance reaches 2^-34 scene units
// (airglow on the sea), so the lab's bins are two stops wide.
const METER_BIN_STOPS=physicalNight(mode)?2:1;
const METER_LOG_FLOOR=-24*METER_BIN_STOPS+8;
// Below this the meter asks for more than the ceiling anyway.
const METER_LUMINANCE_FLOOR=physicalNight(mode)?`exp2(${METER_LOG_FLOOR.toFixed(1)})`:'.00001';
// The scene was rendered pre-exposed with the previous state's EV.
const PRE_EXPOSURE=preExposure(mode),sceneRadiance=PRE_EXPOSURE?'/preExposure':'';
// The night camera's ceiling falls at long focal lengths, where the lens
// cannot open to f/1.4 (camera-model.ts); the meter and manual EV stop there.
const EXPOSURE_MAX_EV=exposureMaxEV(mode),ceiling=physicalNight(mode)?'cameraCeilingEV()':EXPOSURE_MAX_EV.toFixed(1);
return `
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
uniform float zoomExcess;
uniform sampler2D meterField;
uniform vec4 meterRect;
uniform vec2 meterSize;
uniform float useField;
#define FOCAL (1.25*(1.+zoomExcess))
${sceneColorShader}
${cameraModelShaderFor(mode)}
void main(){
${PRE_EXPOSURE?`  float preExposure=exp2(decodeCameraEV(texture2D(previous,vec2(.5)).rg));\n  // Subject thresholds follow the exposure above EV ${METER_SUBJECT_EV} (camera-glare.ts).\n  float subject=min(1.,${(2**METER_SUBJECT_EV).toFixed(4)}/preExposure);\n`:''}  vec3 weights=displayP3>.5?vec3(.2289746,.6917385,.0792869):vec3(.2126,.7152,.0722);
  float total=0.,emission=0.,emissionWeight=0.,coverage=0.,count=0.;
  // Point samples on a 32 x 32 grid, or every texel of the pyramid level once.
  vec2 grid=useField>.5?meterSize:vec2(32.);
  // A log-luminance histogram, entirely on the GPU. Bin sums retain the
  // measured luminance within each stop rather than rounding to bin centres.
  float mass[24];float logs[24];
  for(int bin=0;bin<24;bin++){mass[bin]=0.;logs[bin]=0.;}
  for(int y=0;y<${METER_MAX_SIDE};y++)for(int x=0;x<${METER_MAX_SIDE};x++){
    if(float(x)>=grid.x||float(y)>=grid.y)continue;
    vec2 uv=(vec2(float(x),float(y))+.5)/grid;
    count+=1.;
    vec3 c;float peak,lit;
    if(useField>.5){
      // One area-averaged pyramid texel per tap: every pixel counts, wherever
      // a subject falls. Alpha is the share of the cell in subjects, which
      // hold nearly all of its light on a dark sky.
      vec4 cell=texture2D(meterField,meterRect.xy+uv*meterRect.zw);
      c=cell.rgb${sceneRadiance};lit=cell.a;peak=max(c.r,max(c.g,c.b))/max(lit,.05);
    }else{
      vec4 pixel=texture2D(scene,uv);
      c=sceneLinear>.5?pixel.rgb:unpackSceneRadiance(pixel);
${PRE_EXPOSURE?'      c/=preExposure;\n':''}      peak=max(c.r,max(c.g,c.b));lit=smoothstep(${METER_LIT[0]}${PRE_EXPOSURE?'*subject':''},${METER_LIT[1].toFixed(2)}${PRE_EXPOSURE?'*subject':''},peak);
    }
    float w=1.+exp(-dot(uv-.5,uv-.5)*8.);
    float luminance=dot(c,weights);
    float logL=clamp(log2(max(luminance,exp2(${METER_LOG_FLOOR.toFixed(1)}))),${METER_LOG_FLOOR.toFixed(1)},7.999);
    float bucket=floor((logL-(${METER_LOG_FLOOR.toFixed(1)}))/${METER_BIN_STOPS.toFixed(1)});
    for(int bin=0;bin<24;bin++){
      float included=1.-step(.5,abs(float(bin)-bucket));
      mass[bin]+=w*included;logs[bin]+=w*included*logL;
    }
    total+=w;
    // Highlight-weighted metering uses pixel energy, never object identity.
    // Sparse points may clip; extended bright regions retain their colour.
    float boundedPeak=min(peak,2.${PRE_EXPOSURE?'*subject':''});
    // A cell's subject radiance is light over share; trust cells mostly
    // inside a subject more than its edges, where both are small.
    float trust=useField>.5?lit*lit:lit;
    emission+=boundedPeak*boundedPeak*trust;emissionWeight+=boundedPeak*trust;coverage+=lit;
  }
  // Account for the finite solar disk even when it falls between meter taps.
  // The meter contribution is independent of the artistic reflection slider.
  float radius=${SOLAR_RADIUS.toFixed(8)}*FOCAL;
  float inFrame=(1.-smoothstep(aspect*.5-radius,aspect*.5+radius,abs(sunMeter.x)))
    *(1.-smoothstep(.5-radius,.5+radius,abs(sunMeter.y)));
  vec3 transmission=hasAttenuation>.5?texture2D(sourceAttenuation,vec2(.3,.5)).rgb:vec3(1.);
  float sunMean=${SOLAR_IRRADIANCE}*FOCAL*FOCAL/aspect*sunMeter.z*inFrame*dot(transmission,weights);
  float cumulative=0.,logSum=0.,retained=0.;
  for(int bin=0;bin<24;bin++){
    float count=mass[bin];
    float take=max(0.,min(cumulative+count,total*.98)-max(cumulative,total*.10));
    logSum+=take*logs[bin]/max(count,.00001);retained+=take;
    cumulative+=count;
  }
  float measured=exp2(logSum/max(retained,.00001));
  // Blend within the metering range. A black sky asks for about +15 EV; mixed
  // before clamping, it outweighed any bright subject under 2.5% of the frame,
  // so a small Earth or a zoomed Moon was metered as empty sky.
  float target=clamp(log2(.055/max(measured+sunMean*.45,${METER_LUMINANCE_FLOOR})),${AUTO_EXPOSURE_MIN_EV.toFixed(1)},${ceiling});
  float emissionTarget=clamp(log2(.25/max(emission/max(emissionWeight,.0001),${METER_LUMINANCE_FLOOR})),${AUTO_EXPOSURE_MIN_EV.toFixed(1)},${ceiling});
  // Point samples catch stars, so a subject needs 0.6-2.5% of them.
  if(useField<.5)target=mix(target,min(target,emissionTarget),smoothstep(.006,.025,coverage/count));
  else{
    // Pyramid subjects already exclude stars and count fully from 0.025% of
    // the frame, about two subject blocks. Below that the two requests mix as
    // light, not as EV, with weight (coverage/0.025%)²: a subject half that
    // size is exposed two stops brighter. On a black sky the requests are up
    // to 25 EV apart, and the former ramp, mixing EVs from 0.005%, moved the
    // result up to 31 EV per e-fold of coverage; this moves at most 2.9
    // (docs/lab/meter-blend-2026-10-17.md).
    float weight=min(coverage/count/.00025,1.);weight*=weight;
${PRE_EXPOSURE?`    // At night a subject pulls by its share of the frame, a plain light mix:
    // a city filling an 8× frame sets the exposure, lights at the edge of a
    // moonlit or moonless frame clip as in ISS video, and a Moon on black sky
    // (25 EV apart) still sets it from a fraction of a percent.
    weight=mix(weight,coverage/count,1.-subject);
`:''}    target-=log2(1.-weight+weight*exp2(target-min(target,emissionTarget)));
  }
  vec4 state=texture2D(previous,vec2(.5));
  float old=decodeCameraEV(state.rg);
  // EV is logarithmic; brighten more slowly than the response to daylight.
  float tau=target>old?1.25:.4;
  // Require a sustained darkening request before reacting to a flash.
  // B stores the previous target; A stores up to 0.25 s of its persistence.
  float previousTarget=mix(${EXPOSURE_MIN_EV.toFixed(1)},${EXPOSURE_MAX_EV.toFixed(1)},state.b);
  float age=abs(target-previousTarget)>.5?0.:min(.25,state.a*.25+elapsed);
  float responseTime=target<old?min(elapsed,max(0.,age-.12)):elapsed;
  float ev=initialized<.5?target:mix(old,target,1.-exp(-responseTime/tau));
  if(automatic<.5)ev=clamp(manualEV,${EXPOSURE_MIN_EV.toFixed(1)},${ceiling});
  float encodedEV=floor(clamp((ev-(${EXPOSURE_MIN_EV.toFixed(1)}))/${(EXPOSURE_MAX_EV-EXPOSURE_MIN_EV).toFixed(1)},0.,1.)*65535.+.5);
  gl_FragColor=vec4(floor(encodedEV/256.)/255.,mod(encodedEV,256.)/255.,(target-(${EXPOSURE_MIN_EV.toFixed(1)}))/${(EXPOSURE_MAX_EV-EXPOSURE_MIN_EV).toFixed(1)},age/.25);
}`;
});

// Decodes the state with one range and encodes it with another, as the meter
// does, with the target in B and no persistence in A.
const handOverFragment=`
precision highp float;
uniform sampler2D state;
uniform vec4 ranges;
uniform vec2 limits;
uniform float shift;
void main(){
  vec4 s=texture2D(state,vec2(.5));
  float ev=clamp(dot(s.rg,vec2(65280.,255.))/65535.*ranges.y+ranges.x+shift,limits.x,limits.y);
  float unit=clamp((ev-ranges.z)/ranges.w,0.,1.),encoded=floor(unit*65535.+.5);
  gl_FragColor=vec4(floor(encoded/256.)/255.,mod(encoded,256.)/255.,unit,0.);
}`;

export class CameraExposure {
  static prepare(batch:ShaderProgramBatch,mode:NightMode){return {batch,mode,program:batch.add('Camera exposure','attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}',fragmentFor(mode))};}

  get texture(){return this.targets[this.index].texture;}
  /** The state before the last update: the exposure the metered scene was
   * rendered with, and so its pre-exposure. */
  get previousTexture(){return this.targets[1-this.index].texture;}
  private program:WebGLProgram;
  private buffer:WebGLBuffer;
  private targets:{texture:WebGLTexture;framebuffer:WebGLFramebuffer}[]=[];
  private uniforms:Record<string,WebGLUniformLocation|null>={};
  private position=0;
  private index=0;
  private lastTime:number|null=null;
  /** The night mode whose range the state encodes. */
  mode:NightMode;
  constructor(private gl:WebGLRenderingContext,prepared?:ReturnType<typeof CameraExposure.prepare>){
    this.mode=prepared?.mode??'current';
    const fragment=fragmentFor(this.mode);
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
      this.locate();
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
  /** field: the glare pyramid's meter level; without it (RGBE scenes) the
   * meter point-samples the scene. */
  update(scene:WebGLTexture,linear:boolean,p3:boolean,now:number,sun:[number,number,number]=[0,0,0],aspect=1,attenuation:WebGLTexture|null=null,manualEV:number|null=null,focal=1.25,field:MeterField|null=null){
    const gl=this.gl,next=1-this.index;
    gl.bindFramebuffer(gl.FRAMEBUFFER,this.targets[next].framebuffer);gl.viewport(0,0,1,1);gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,scene);
    gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,this.targets[this.index].texture);
    gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,attenuation??scene);
    gl.uniform1i(this.uniforms.sourceAttenuation,2);
    gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_2D,field?.texture??scene);
    gl.uniform1i(this.uniforms.meterField,3);gl.uniform1f(this.uniforms.useField,field?1:0);
    if(field){gl.uniform4fv(this.uniforms.meterRect,field.rect);gl.uniform2f(this.uniforms.meterSize,field.width,field.height);}
    gl.uniform1f(this.uniforms.hasAttenuation,attenuation?1:0);
    gl.uniform1f(this.uniforms.automatic,manualEV===null?1:0);gl.uniform1f(this.uniforms.manualEV,manualEV??0);gl.uniform3fv(this.uniforms.sunMeter,sun);gl.uniform1f(this.uniforms.aspect,aspect);gl.uniform1f(this.uniforms.zoomExcess,focal/1.25-1);
    gl.uniform1i(this.uniforms.scene,0);gl.uniform1i(this.uniforms.previous,1);
    gl.uniform1f(this.uniforms.sceneLinear,linear?1:0);gl.uniform1f(this.uniforms.displayP3,p3?1:0);
    gl.uniform1f(this.uniforms.initialized,this.lastTime===null?0:1);
    gl.uniform1f(this.uniforms.elapsed,this.lastTime===null?0:Math.min(.25,Math.max(0,(now-this.lastTime)/1000)));
    gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.enableVertexAttribArray(this.position);gl.vertexAttribPointer(this.position,2,gl.FLOAT,false,0,0);
    const dither=gl.isEnabled(gl.DITHER);gl.disable(gl.DITHER);
    gl.drawArrays(gl.TRIANGLES,0,3);if(dither)gl.enable(gl.DITHER);
    this.index=next;
    if(!(this.settle>0&&--this.settle>0))this.lastTime=now;
    return this.targets[next].texture;
  }
  private locate(){
    const gl=this.gl;
    this.position=gl.getAttribLocation(this.program,'p');
    for(const name of ['scene','previous','sceneLinear','displayP3','elapsed','initialized','sunMeter','aspect','manualEV','automatic','sourceAttenuation','hasAttenuation','zoomExcess','meterField','meterRect','meterSize','useField'])this.uniforms[name]=gl.getUniformLocation(this.program,name);
  }
  /** A pass that re-encodes the state into another night mode's range. */
  static prepareHandOver(batch:ShaderProgramBatch){return {batch,program:batch.add('Camera exposure hand-over','attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}',handOverFragment)};}
  /** Meter with the program of another night mode. The state keeps its
   * texels; handOver re-encodes them into the new range. */
  replaceProgram(prepared:ReturnType<typeof CameraExposure.prepare>){
    this.gl.deleteProgram(this.program);
    this.program=prepared.batch.take(prepared.program);this.mode=prepared.mode;this.locate();
  }
  /** Re-encode the state from one mode's range into this one's on the GPU,
   * shifted by `shift` EV, without reading it back. Then, like seed, the
   * meter takes its target at once for `settle` updates. */
  handOver(prepared:ReturnType<typeof CameraExposure.prepareHandOver>,from:NightMode,shift:number,settle:number){
    const gl=this.gl,program=prepared.batch.take(prepared.program);
    const fromSpan=exposureMaxEV(from)-EXPOSURE_MIN_EV,toSpan=exposureMaxEV(this.mode)-EXPOSURE_MIN_EV;
    gl.useProgram(program);
    const at=(name:string)=>gl.getUniformLocation(program,name);
    gl.uniform1i(at('state'),1);gl.uniform2f(at('limits'),AUTO_EXPOSURE_MIN_EV,exposureMaxEV(this.mode));
    gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);
    const position=gl.getAttribLocation(program,'p');
    gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
    const dither=gl.isEnabled(gl.DITHER);gl.disable(gl.DITHER);
    // Current state into the other target in the new range, then back.
    for(const [source,target,ranges,offset] of [[this.index,1-this.index,[EXPOSURE_MIN_EV,fromSpan,EXPOSURE_MIN_EV,toSpan],shift],[1-this.index,this.index,[EXPOSURE_MIN_EV,toSpan,EXPOSURE_MIN_EV,toSpan],0]] as const){
      gl.bindFramebuffer(gl.FRAMEBUFFER,this.targets[target].framebuffer);gl.viewport(0,0,1,1);
      gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,this.targets[source].texture);
      gl.uniform4fv(at('ranges'),ranges);gl.uniform1f(at('shift'),offset);
      gl.drawArrays(gl.TRIANGLES,0,3);
    }
    if(dither)gl.enable(gl.DITHER);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.deleteProgram(program);
    this.settle=settle;this.lastTime=settle>0?null:performance.now();
  }
  private settle=0;
  dispose(){
    const gl=this.gl;gl.deleteProgram(this.program);gl.deleteBuffer(this.buffer);
    for(const target of this.targets){gl.deleteTexture(target.texture);gl.deleteFramebuffer(target.framebuffer);}
    this.targets=[];
  }
}
