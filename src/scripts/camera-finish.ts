import {halfFloatTarget,textureImage2D} from './webgl-context.ts';
import type {ShaderProgramBatch} from './shader-programs';
import { sceneImageShader } from './scene-image';
import { CameraDefocus } from './camera-defocus';
import { CameraGlare, FIELD_LEVEL_SPREAD, GLARE_MAX_LEVELS, GLARE_SOLAR_CAP, SOLAR_PSF_REACH } from './camera-glare';
import { FRAME_SCATTER_FRACTION, SOLAR_IRRADIANCE, SOLAR_RADIUS, SOLAR_SCATTER_FRACTION, VEIL_COMPONENTS } from './solar-light';
import { fieldReflectionShader, lensReflectionShader } from './lens-reflections';
import { lensDirtShader } from './lens-dirt';
import { sceneColorShader } from './scene-color';
import { poissonQuantiles, POISSON_COLUMNS, POISSON_ROWS, GRAIN_AMOUNT, LOOK_ELECTRONS, LOOK_ISO_GAIN_MAX, SENSOR_ELECTRONS, SENSOR_ROWS } from './sensor-noise';
import { perNightMode, physicalNight, type NightMode } from './physical-night';
import { CameraExposure } from './camera-exposure';
import { cameraModelShaderFor } from './camera-model';
import { preExposure } from './pre-exposure';
export const CAMERA_EXPOSURE_EV=0;
/** Camera poses of this and the previous submitted frame, for shutter blur. */
export type ShutterMotion={shutter:number;sky:boolean;camera:ArrayLike<number>;basis:ArrayLike<number>;previousCamera:ArrayLike<number>;previousBasis:ArrayLike<number>;previousFocal:number};
export type LensFrame={reflectance?:number;moon:[number,number,number];moonRadius?:number;glare?:boolean;fieldReflections?:boolean;pyramidMeter?:boolean;sun:[number,number,number];points:Float32Array;pointAmount:number;attenuation:WebGLTexture|null;sunReflections?:number;focal?:number;motion?:ShutterMotion|null};
const nightSensorShader=`// Equivalent RGB sensor in linear output primaries. Shot/read noise precede
// ISO amplification and the display curve; ISO never creates extra photons.
// Night lab (docs/lab/night-camera-2026-10-17.md): a grain cell, one CSS
// pixel, bins the photosites of a 12 MP sensor (sensor-noise.ts), and the
// default program's grain stays as a look up to the day program's top ISO.
float nightSensorChannel(float opticalSignal,float isoGain,vec2 seed) {
  if(grainAmount<.001)return min(max(0.,opticalSignal),4.)*isoGain;
  float lookElectrons=${LOOK_ELECTRONS.toFixed(1)}/(grainAmount*grainAmount);
  float photosites=max(1.,pow(${SENSOR_ROWS.toFixed(1)}*pixelRatio/resolution.y,2.));
  float electronsAtWhite=photosites*${SENSOR_ELECTRONS.toFixed(1)}*${(GRAIN_AMOUNT*GRAIN_AMOUNT).toFixed(4)}/(grainAmount*grainAmount);
  float expected=max(0.,opticalSignal)*electronsAtWhite;
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
  // Read noise of every binned photosite.
  float readNoise=sqrt(.9*.9+pow(.8/isoGain,2.))*sqrt(photosites);
  measured+=readNoise*normal.y;
  float signal=clamp(measured/electronsAtWhite,0.,4.)*isoGain;
  // The look: the variance the default program's single cell had above the
  // binned sensor's, at most at ISO ${Math.round(400*LOOK_ISO_GAIN_MAX)}.
  float lookVariance=min(isoGain,${LOOK_ISO_GAIN_MAX.toFixed(4)})*max(0.,opticalSignal*isoGain)*max(0.,1./lookElectrons-1./electronsAtWhite);
  float v=max(hash(seed+vec2(31.9,211.4)),.000001);
  float look=sqrt(-2.*log(v))*cos(6.283185307*hash(seed+vec2(97.1,5.3)));
  return clamp(signal+sqrt(lookVariance)*look,0.,4.*isoGain);
}

`;
const fragmentSourceFor=perNightMode(mode=>{
const PRE_EXPOSURE=preExposure(mode),sensor=physicalNight(mode)?'nightSensorChannel':'sensorChannel';
return `
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
${PRE_EXPOSURE?'// The state the scene was rendered with: its pre-exposure.\nuniform sampler2D sceneState;\n':''}uniform vec3 moonGhost;
uniform float moonGhostRadius;
uniform vec3 sunGhost;
uniform float sunReflectionAmount;
// The lens preset's ghost gain (lensReflectance); the slider stays separate.
uniform float lensReflectance;
uniform vec4 pointGhosts[3];
uniform float pointGhostAmount;
uniform sampler2D sourceAttenuation;
uniform sampler2D glare;
uniform float glareAmount;
uniform vec4 glareMask;
uniform float hasAttenuation;
uniform float zoomExcess;
uniform float motionShutter;
uniform float motionSky;
uniform mat3 motionBasis,motionPreviousBasis;
uniform vec3 motionCamera,motionPreviousCamera;
uniform float motionPreviousFocal;
#define FOCAL (1.25*(1.+zoomExcess))
${sceneColorShader}
${cameraModelShaderFor(mode)}
float cameraOpening;
float cameraPupilScale;
float ghostFocalScale;
float ghostSourceRadius;
${lensReflectionShader}
${fieldReflectionShader(FIELD_LEVEL_SPREAD,GLARE_MAX_LEVELS)}
${lensDirtShader}
// At coated-lens reflectance the field's reflections stay a few output levels,
// so they fade in only as the Lens flares control rises from 100% to 125%.
uniform float reflectionFieldWeight;
// What the field already reflects of a source inside the picture; the
// analytic chain keeps the rest, so no source is reflected twice.
float fieldShare(vec2 source,float aspect){
  return reflectionLevelCount>1.5?reflectionFieldWeight*fieldWindow(source/vec2(aspect,1.)+.5):0.;
}
vec3 sourceEnergy(float column){
  return hasAttenuation>.5?texture2D(sourceAttenuation,vec2(column,.5)).rgb:vec3(1.);
}
vec3 reflectionsAt(vec2 p,float aspect){
  vec3 result=vec3(0.);
  // The Moon is as wide as the Sun; at long focal lengths its disk, not the
  // aperture, sets the size of a reflection.
  ghostSourceRadius=moonGhostRadius*FOCAL;
  if(moonGhost.z>0.)result+=lensReflections(p,moonGhost.xy,aspect,1.)*moonGhost.z*sourceEnergy(.1)*(1.-fieldShare(moonGhost.xy,aspect));
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
      result+=lensReflections(p,source.xy,aspect,0.)*source.z*pointGhostAmount*pow(tint,vec3(2.2))*sourceEnergy((float(i)+2.5)/5.)
        *(1.-fieldShare(source.xy,aspect));
    }
  }
  return lensToOutputLinear(result)*lensReflectance;
}
// Forward scatter is separate from the colored reflection ghosts. Kernels
// integrate to one over solid angle: scatter at the window and front element
// happens before the lens focuses, so the halo grows with focal length at
// constant surface brightness. Do not clip it to Earth's limb. Contamination
// breaks the round kernel into lobes fixed to the lens (veilPatternRGB,
// lens-dirt.ts) without changing its integral.
vec3 solarVeil(vec2 p){
  if(sunGhost.z<=0.)return vec3(0.);
  vec2 delta=(p-sunGhost.xy)/FOCAL;
  float r2=dot(delta,delta);
  // The smudges and the cleaning swirl the Sun's beam currently crosses take
  // their share from every kernel alike, so the round veil keeps its profile:
  // drawn from the broad kernel alone, they left its tail at 0.3 rad half as
  // bright and falling as θ^-2.6 instead of the reference's θ^-2.
  vec2 sunAngle=atan(sunGhost.xy/FOCAL);
  float lobes=smudgeShare(sunAngle);
  float kernel=(1.-lobes)*(${VEIL_COMPONENTS.map(({share,scale})=>`${share.toFixed(4)}/(3.14159265*${(scale*scale).toFixed(8)})*pow(1.+r2/${(scale*scale).toFixed(8)},-2.)`).join('+')});
  float acceptance=1.-smoothstep(.8,1.4,length(sunGhost.xy)/1.25);
  return sceneToOutputLinear(vec3(1.,.97,.92))*sourceEnergy(.3)*sunGhost.z
    *${SOLAR_IRRADIANCE*SOLAR_SCATTER_FRACTION}*(kernel*veilPatternRGB(delta)+smudgeVeilRGB(delta,sunAngle))*acceptance;
}
// Window dust lit from behind by the Sun (lens-dirt.ts): out-of-focus specks
// a few 1e-6 of the solar flux each, so they show only in heavy flare.
vec3 solarDustGlints(vec2 p){
  if(sunGhost.z<=0.)return vec3(0.);
  float acceptance=1.-smoothstep(.8,1.4,length(sunGhost.xy)/1.25);
  float projectionArea=FOCAL*FOCAL*pow(1.+dot(sunGhost.xy,sunGhost.xy)/(FOCAL*FOCAL),1.5);
  return sceneToOutputLinear(vec3(1.,.97,.92))*sourceEnergy(.3)*sunGhost.z*${SOLAR_IRRADIANCE}*projectionArea*dustGlints(p,sunGhost.xy,4./cameraPupilScale)*acceptance;
}
// The rest of the frame scatters with the same kernel (CameraGlare). Glare
// moves light: what the pyramid spreads out is taken from where it was.
vec3 glareSource(vec3 c,vec2 p){
  if(glareMask.w>.5&&length(p-glareMask.xy)<glareMask.z)c=min(c,vec3(${GLARE_SOLAR_CAP.toFixed(1)}));
  return max(c,vec3(0.));
}
${sceneImageShader}
// Defined with the sensor model below, which is also tested on its own.
float hash(vec2);
vec2 previousOf(vec3 d){
  vec3 v=vec3(dot(d,motionPreviousBasis[0]),dot(d,motionPreviousBasis[1]),dot(d,motionPreviousBasis[2]));
  return motionPreviousFocal*v.xy/max(.001,v.z);
}
// Earth and what travels with it: the solid sphere, its clouds and the glowing
// air up to 120 km. Every ray passing higher sees the sky at infinity. Treating
// the bright air as sky smeared it into space with the camera's turn, a noisy
// halo along a spin. The shell stays well below the orbital camera: one that
// contained it would give every star below its horizontal, about 20 degrees
// above the limb from the ISS, Earth's motion.
bool movesWithEarth(vec2 p){
  vec3 ray=normalize(motionBasis*normalize(vec3(p,FOCAL)));
  float b=dot(motionCamera,ray),c=dot(motionCamera,motionCamera);
  float shell=min(1.+120./6371.,mix(1.,sqrt(c),.5));
  return b<0.&&c-b*b<shell*shell;
}
// Where this pixel's scene point projected in the previous frame. Earth's
// sphere supplies parallax while flying. Clouds and air above the solid limb
// use their point of closest approach, continuous with the ground at the
// limb's tangent point.
vec2 previousProjection(vec2 p){
  vec3 ray=normalize(motionBasis*normalize(vec3(p,FOCAL)));
  float b=dot(motionCamera,ray),c=dot(motionCamera,motionCamera),disc=b*b-c+1.;
  if(disc>0.)return previousOf(motionCamera+ray*(-b-sqrt(disc))-motionPreviousCamera);
  return previousOf(motionCamera-ray*b-motionPreviousCamera);
}
// An open shutter integrates the scene along each pixel's motion between
// frames, centred on this frame. Earth moves with its parallax; the sky at
// infinity streaks only with the camera's turn, or stays sharp without
// motionSky. Samples never cross between Earth and sky, so the limb stays a
// clean edge. Lens ghosts and sensor noise stay per-frame.
vec3 shutterImage(vec2 uv,vec2 shift,vec2 p,float aspect){
  vec3 sharp=vec3(imageAt(uv-shift).r,imageAt(uv).g,imageAt(uv+shift).b);
  if(motionShutter<=0.)return sharp;
  bool earth=movesWithEarth(p);
  if(!earth&&motionSky<.5)return sharp;
  vec2 previous=earth?previousProjection(p):previousOf(motionBasis*normalize(vec3(p,FOCAL)));
  vec2 delta=(p-previous)*motionShutter/vec2(aspect,1.);
  float pixels=length(delta*resolution);
  if(pixels<.75)return sharp;
  // Short streaks keep their length; long sweeps (far views, fast spins)
  // approach about 24 CSS pixels instead of smearing across the frame.
  float limit=24.*pixelRatio,streak=pixels/(1.+pixels/limit);
  delta*=streak/pixels;
  float taps=min(16.,ceil(streak/1.5));
  // A per-pixel offset turns the gaps between taps into fine noise instead of
  // discrete copies of bright edges, such as the limb, along long streaks.
  float jitter=hash(gl_FragCoord.xy+vec2(grainFrame*.618,grainFrame*.382))-.5;
  vec3 sum=sharp;float weight=1.;
  for(int i=0;i<16;i++){
    if(float(i)>=taps)break;
    vec2 at=uv+delta*((float(i)+.5+jitter)/taps-.5);
    if(movesWithEarth((at-.5)*vec2(aspect,1.))!=earth)continue;
    sum+=vec3(imageAt(at-shift).r,imageAt(at).g,imageAt(at+shift).b);weight+=1.;
  }
  return sum/weight;
}
${physicalNight(mode)?nightSensorShader:''}float hash(vec2 p) {
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
  ghostFocalScale=FOCAL/1.25;
  vec2 uv=gl_FragCoord.xy/resolution;
  vec2 field=(uv-.5)*vec2(resolution.x/resolution.y,1.)/1.25;
  // Lateral chromatic magnification: zero on-axis, increasing quadratically
  // toward the edges. The normalized 100% baseline is half its previous strength.
  // Deliberately visible photographic grading, not calibration.
  vec2 shift=field*length(field)*chromaticAmount*9.*pixelRatio/resolution;
  float aspect=resolution.x/resolution.y;
  vec2 p=(uv-.5)*vec2(aspect,1.);
  vec3 linear=shutterImage(uv,shift,p,aspect);
${PRE_EXPOSURE?'  float sceneScale=exp2(-decodeCameraEV(texture2D(sceneState,vec2(.5)).rg));\n  linear*=sceneScale;\n':''}  // Ghost paths have their own conjugates; focus changes their size/softness
  // in apertureGhost instead of convolving them with the scene's pupil.
  if(glareAmount>.5)linear+=${FRAME_SCATTER_FRACTION.toFixed(5)}*(texture2D(glare,uv).rgb${PRE_EXPOSURE?'*sceneScale':''}-glareSource(linear,p));
  // The lens barrel's bore shades the veil where it shades its own ghost.
  float barrelShade=sunGhost.z>0.?mix(1.,barrelVeilShadow(p,sunGhost.xy),clamp(sunReflectionAmount,0.,1.)):1.;
  linear+=reflectionsAt(p,aspect)+fieldReflections(p,aspect)${PRE_EXPOSURE?'*sceneScale':''}*sunReflectionAmount*lensReflectance*reflectionFieldWeight+solarVeil(p)*barrelShade+solarDustGlints(p);
  // Dust on the filter stack shades whatever light reaches the sensor.
  linear*=dustShadow(p,camera.x);
  // Aperture changes collected light; ISO amplifies the sampled sensor signal.
  // Their product exactly retains the previously accepted metered exposure.
  float vignette=max(0.,1.-mix(.20,.28,cameraOpening)*pow(length(p/vec2(aspect*.8,.9)),2.));
  linear*=exp2(.5+exposureEV)*camera.y*pow(vignette,2.2);
  vec2 grainSeed=vec2(hash(vec2(grainFrame,19.3)),hash(vec2(71.7,grainFrame)))*256.;
  const float grainSizeCss=1.;
  vec2 sensorPixel=floor(gl_FragCoord.xy/(max(pixelRatio,.001)*grainSizeCss))+grainSeed;
  linear=vec3(${sensor}(linear.r,camera.z,sensorPixel),
              ${sensor}(linear.g,camera.z,sensorPixel+vec2(51.3,173.9)),
              ${sensor}(linear.b,camera.z,sensorPixel+vec2(137.2,23.6)));
  linear=cameraHighlights(linear);
  vec3 color=linearToDisplay(max(linear,vec3(0.)));

  gl_FragColor=vec4(max(color,0.),1.);
}
`;
});

/** Optical channel separation precedes sensor noise; page content never enters this pass. */
export class CameraFinish {
  static prepare(batch:ShaderProgramBatch,mode:NightMode){return {batch,mode,program:batch.add('Camera finish','attribute vec2 position;void main(){gl_Position=vec4(position,0.,1.);}',fragmentSourceFor(mode)),exposure:CameraExposure.prepare(batch,mode),defocus:CameraDefocus.prepare(batch,mode),glare:CameraGlare.prepare(batch,mode)};}

  get exposureTexture(){return this.exposure!.texture;}
  /** The exposure meter, for a hand-over between night modes. */
  get meter(){return this.exposure!;}
  /** The night mode its programs were built for. */
  mode:NightMode;
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
  private glare:CameraGlare|null=null;
  constructor(private gl:WebGLRenderingContext,private displayP3=false,prepared?:ReturnType<typeof CameraFinish.prepare>){
    this.pixelType=halfFloatTarget(gl,true)??gl.UNSIGNED_BYTE;
    this.mode=prepared?.mode??'current';
    const shaders:WebGLShader[]=[];
    try {
      this.program=prepared?prepared.batch.take(prepared.program):gl.createProgram();
      if(!this.program)throw new Error('Cannot allocate camera finish');
      if(!prepared){
        for(const [type,source] of [[gl.VERTEX_SHADER,'attribute vec2 position;void main(){gl_Position=vec4(position,0.,1.);}'],[gl.FRAGMENT_SHADER,fragmentSourceFor(this.mode)]] as const){
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
      this.locate();
      this.exposure=new CameraExposure(gl,prepared?.exposure);
      this.defocus=new CameraDefocus(gl,this.pixelType,prepared?.defocus);
      // RGBE scene values cannot be filtered, so the fallback keeps only the
      // analytic solar veil. Prepared programs are taken either way.
      const glare=prepared?.glare;
      if(this.linear)this.glare=new CameraGlare(gl,this.pixelType,glare);
      else if(glare)for(const program of [glare.down,glare.up,glare.copy])gl.deleteProgram(glare.batch.take(program));
    } catch(error){this.dispose();throw error;}
    finally {shaders.forEach(shader=>gl.deleteShader(shader));}
  }
  private locate(){
    const gl=this.gl;
    this.position=gl.getAttribLocation(this.program!,'position');
    for(const name of ['zoomExcess','scene','resolution','pixelRatio','grainFrame','grainAmount','chromaticAmount','poisson','focusRadius','sceneLinear','exposureEV','exposureState','sceneState','moonGhost','moonGhostRadius','sunGhost','sunReflectionAmount','lensReflectance','pointGhosts[0]','pointGhostAmount','sourceAttenuation','hasAttenuation','displayP3','motionShutter','motionSky','motionBasis','motionPreviousBasis','motionCamera','motionPreviousCamera','motionPreviousFocal','glare','glareAmount','glareMask','reflectionField','reflectionLevels[0]','reflectionFieldSize','reflectionLevelCount','reflectionFieldWeight'])this.uniforms[name]=gl.getUniformLocation(this.program!,name);
  }
  /** Use the programs of another night mode. Targets, the sensor LUT and the
   * exposure state stay; the caller hands the state over (handOver). */
  replacePrograms(prepared:ReturnType<typeof CameraFinish.prepare>){
    const gl=this.gl;
    if(this.program)gl.deleteProgram(this.program);
    this.program=prepared.batch.take(prepared.program);this.mode=prepared.mode;this.locate();
    this.exposure!.replaceProgram(prepared.exposure);
    this.defocus!.replaceProgram(prepared.defocus);
    if(this.glare)this.glare.replacePrograms(prepared.glare);
    else for(const program of [prepared.glare.down,prepared.glare.up,prepared.glare.copy])gl.deleteProgram(prepared.glare.batch.take(program));
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
    const focal=lens.focal??1.25,sun=lens.sun;
    const glareMask:[number,number,number,number]=[sun[0],sun[1],SOLAR_RADIUS*focal+SOLAR_PSF_REACH*pixelRatio/this.height,sun[2]>0?1:0];
    // One pyramid of the focused scene serves the meter, glare and the
    // reflections of the whole frame, so it is built first. Loading defocus
    // blurs the picture only; glare is far broader than that blur.
    const PRE_EXPOSURE=preExposure(this.mode);
    const built=this.glare?.build(this.texture!,this.width,this.height,glareMask,PRE_EXPOSURE?this.exposure!.texture:null,PRE_EXPOSURE?this.exposure!.frameTexture:null)??false;
    const meter=built&&lens.pyramidMeter!==false?this.glare!.meter:null;
    const exposure=this.exposure!.update(this.texture!,this.linear,this.displayP3,performance.now(),lens.sun,this.width/this.height,lens.attenuation,manualExposure,lens.focal,meter);
    const image=this.defocus!.render(this.texture!,exposure,this.width,this.height,pixelRatio,focusRadius);
    const slider=lens.sunReflections??1,t=Math.max(0,Math.min(1,(slider-1)/.25)),fieldWeight=t*t*(3-2*t);
    const wantsGlare=lens.glare!==false,wantsField=lens.fieldReflections!==false&&fieldWeight>0;
    const glare=built&&wantsGlare?this.glare!.scatter(focal):null,field=built&&wantsField?this.glare!.field:null;
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,this.width,this.height);gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,exposure);
    gl.uniform1i(this.uniforms.exposureState,2);
    if(PRE_EXPOSURE){gl.activeTexture(gl.TEXTURE4);gl.bindTexture(gl.TEXTURE_2D,this.exposure!.previousTexture);gl.uniform1i(this.uniforms.sceneState,4);}
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
    gl.uniform1f(this.uniforms.moonGhostRadius,lens.moonRadius??0);
    gl.uniform3fv(this.uniforms.sunGhost,lens.sun);
    gl.uniform1f(this.uniforms.sunReflectionAmount,lens.sunReflections??1);
    gl.uniform1f(this.uniforms.lensReflectance,lens.reflectance??1);
    gl.uniform4fv(this.uniforms['pointGhosts[0]'],lens.points);
    gl.uniform1f(this.uniforms.pointGhostAmount,lens.pointAmount);
    gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,lens.attenuation??this.noiseTexture);
    gl.uniform1i(this.uniforms.sourceAttenuation,1);
    gl.uniform1f(this.uniforms.hasAttenuation,lens.attenuation?1:0);
    gl.activeTexture(gl.TEXTURE5);gl.bindTexture(gl.TEXTURE_2D,glare??this.noiseTexture);
    gl.uniform1i(this.uniforms.glare,5);gl.uniform1f(this.uniforms.glareAmount,glare?1:0);
    gl.uniform4fv(this.uniforms.glareMask,glareMask);
    gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_2D,field?.texture??this.noiseTexture);
    gl.uniform1i(this.uniforms.reflectionField,3);
    gl.uniform1f(this.uniforms.reflectionLevelCount,field?.levels??0);
    gl.uniform1f(this.uniforms.reflectionFieldWeight,fieldWeight);
    if(field){gl.uniform4fv(this.uniforms['reflectionLevels[0]'],field.rects);gl.uniform2f(this.uniforms.reflectionFieldSize,field.width,field.height);}
    const motion=lens.motion;
    gl.uniform1f(this.uniforms.motionShutter,motion?motion.shutter:0);
    if(motion){
      gl.uniformMatrix3fv(this.uniforms.motionBasis,false,Array.from(motion.basis));gl.uniformMatrix3fv(this.uniforms.motionPreviousBasis,false,Array.from(motion.previousBasis));
      gl.uniform3fv(this.uniforms.motionCamera,Array.from(motion.camera));gl.uniform3fv(this.uniforms.motionPreviousCamera,Array.from(motion.previousCamera));
      gl.uniform1f(this.uniforms.motionPreviousFocal,motion.previousFocal);
      gl.uniform1f(this.uniforms.motionSky,motion.sky?1:0);
    }
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
    this.glare?.dispose();this.glare=null;
    if(this.program)gl.deleteProgram(this.program);
    if(this.texture)gl.deleteTexture(this.texture);
    if(this.framebuffer)gl.deleteFramebuffer(this.framebuffer);
    if(this.buffer)gl.deleteBuffer(this.buffer);
    if(this.noiseTexture)gl.deleteTexture(this.noiseTexture);
  }
}
