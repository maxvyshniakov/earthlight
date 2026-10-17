import { cameraModelShaderFor } from './camera-model';
import { preExposureShaderFor } from './pre-exposure';
import { perNightMode } from './physical-night';
import optics from '../data/optical-psf.json' with { type:'json' };
export { optics };
/** Atlas rows: the PSF tiles, then the far-field ray profiles. */
export const OPTICAL_PSF_ROWS=optics.size*optics.states+optics.rays.rows*optics.rays.levels.length*optics.states;
const glsl=(x:number)=>x.toFixed(6);
const rays=optics.rays,tileRows=optics.size*optics.states,rowSamples=optics.size-1;
const widestBlur=rays.levels[rays.levels.length-1],lastMean=rays.mean[rays.mean.length-1];

// This shared PSF is the squared Fourier transform of a broadband rounded
// nine-blade pupil (camera-iris.ts), with small wavefront errors and
// normalized scattering wings. One tile per f-number in OPTICAL_PSF_F_NUMBERS,
// then that f-number's far-field angular profile (scripts/build-optical-psf.mjs).
export const opticalPsfSourceFor = perNightMode(mode=>`
uniform sampler2D opticalPsf;
${cameraModelShaderFor(mode)}
#ifdef CAMERA_PUPIL_STATE
uniform sampler2D cameraState;
#endif
${preExposureShaderFor(mode)}// One atlas tile per tabulated f-number. Decode log radiance BEFORE
// interpolating tiles so flux remains constant through the exposure ramp.
vec3 diffractionPsf(vec2 delta, float state) {
  vec2 uv=delta/${optics.span.toFixed(1)}+vec2(.5+.5/${optics.size.toFixed(1)});
  if(any(lessThan(uv,vec2(0.)))||any(greaterThan(uv,vec2(1.))))return vec3(0.);
  uv=clamp(uv,vec2(.5/${optics.size.toFixed(1)}),vec2(1.-.5/${optics.size.toFixed(1)}));
  float position=clamp(state,0.,${(optics.states-1).toFixed(1)});
  float first=min(floor(position),${(optics.states-2).toFixed(1)});
  vec2 a=vec2(uv.x,(uv.y+first)*${glsl(optics.size/OPTICAL_PSF_ROWS)});
  vec2 b=a+vec2(0.,${glsl(optics.size/OPTICAL_PSF_ROWS)});
  vec3 low=max(vec3(0.),exp2(texture2D(opticalPsf,a).rgb*26.-24.)-vec3(0.000000059604645));
  vec3 high=max(vec3(0.),exp2(texture2D(opticalPsf,b).rgb*26.-24.)-vec3(0.000000059604645));
  return mix(low,high,position-first);
}
// Far-field rays: r³·I (CSS px at f/4, unit flux) towards angle theta for one
// tile and blur level. ${rays.samples} angles run through ${rays.rows} rows that share their
// end samples, so linear filtering stays inside a row.
vec3 apertureRayLevel(float theta,float tile,float level){
  float position=fract(theta/6.283185307)*${glsl(rays.samples)};
  float row=min(floor(position/${glsl(rowSamples)}),${glsl(rays.rows-1)});
  vec2 uv=vec2((position-row*${glsl(rowSamples)}+.5)/${glsl(optics.size)},
    (${glsl(tileRows)}+(tile*${glsl(rays.levels.length)}+level)*${glsl(rays.rows)}+row+.5)/${glsl(OPTICAL_PSF_ROWS)});
  return exp2(texture2D(opticalPsf,uv).rgb*${glsl(rays.encoding[0])}${rays.encoding[1]<0?'-':'+'}${glsl(Math.abs(rays.encoding[1]))});
}
// The profile for a fractional f-number tile, blurred in angle by a
// semicircle of half-width blur (radians): levels ${rays.levels.map(x=>(x*180/Math.PI).toFixed(1)+'°').join(', ')},
// interpolated in log blur; beyond the last the mean, which every blur keeps.
vec3 apertureRayMean(float state){
  float position=clamp(state,0.,${glsl(optics.states-1)});
  ${rays.mean.slice(0,-1).map((_,i)=>`if(position<${glsl(i+1)})return mix(vec3(${rays.mean[i].map(glsl).join(',')}),vec3(${rays.mean[i+1].map(glsl).join(',')}),position-${glsl(i)});`).join('\n  ')}
  return vec3(${lastMean.map(glsl).join(',')});
}
vec3 apertureRays(float theta,float state,float blur){
  float position=clamp(state,0.,${glsl(optics.states-1)}),tile=min(floor(position),${glsl(optics.states-2)}),across=position-tile;
  float level=blur<${glsl(rays.levels[1])}?blur/${glsl(rays.levels[1])}:1.+log2(blur/${glsl(rays.levels[1])});
  level=clamp(level,0.,${glsl(rays.levels.length-1)});
  float first=min(floor(level),${glsl(rays.levels.length-2)}),between=level-first;
  vec3 profile=mix(mix(apertureRayLevel(theta,tile,first),apertureRayLevel(theta,tile,first+1.),between),
    mix(apertureRayLevel(theta,tile+1.,first),apertureRayLevel(theta,tile+1.,first+1.),between),across);
  return mix(profile,apertureRayMean(state),smoothstep(${glsl(widestBlur)},${glsl(2*widestBlur)},blur));
}
// Broad scatter has no texture-window edge. Its normalized Moffat tail falls
// smoothly below visibility inside the finite star sprite. Keep equal flux.
vec3 pupilPsf(vec2 delta,float state){
  float r2=dot(delta,delta),scale2=4.;
  float scatter=${optics.integral.toFixed(8)}/(3.141592654*scale2)*pow(1.+r2/scale2,-2.);
  return diffractionPsf(delta,state)*.96+vec3(scatter*.04);
}
// Field coordinates are projected camera coordinates (viewport-height units),
// not normalized independently per axis: the same ray has the same aberration
// on portrait and landscape crops. 1.25 is the camera's projection distance.
vec3 lensPsf(vec2 delta, vec2 sourcePosition) {
  float ev=.5;
#ifdef CAMERA_PUPIL_STATE
  ev=decodeCameraEV(texture2D(cameraState,vec2(.5)).rg);
#endif
  vec4 camera=cameraProgram(ev);
  float diffractionScale=camera.x/4.,state=opticalPsfState(camera.x);
  delta/=diffractionScale;
  float radius=length(sourcePosition);
  vec2 radial=sourcePosition/max(radius,.00001);
  float field=clamp(radius/1.25,0.,1.);
  float strength=field*field*mix(1.,1.5,camera.w);
  // Keep the aperture's main diffraction pattern fixed to the sensor. A small
  // fraction of energy spreads into a radially stretched, comatic wing.
  // This is a field-dependent approximation, not a calibrated lens prescription.
  float radialScale=1.+.9*strength;
  float tangentialScale=1.+.25*strength;
  vec2 wingDelta=delta-radial*(1.6*strength);
  float along=dot(wingDelta,radial);
  vec2 pupilDelta=radial*(along/radialScale)
    +(wingDelta-radial*along)/tangentialScale;
  vec3 wing=pupilPsf(pupilDelta,state)/(radialScale*tangentialScale);
  vec3 profile=mix(pupilPsf(delta,state),wing,min(.65,.32*strength));
  return profile/(diffractionScale*diffractionScale);
}
`);
/** The default program's lens PSF. */
export const opticalPsfSource=opticalPsfSourceFor('current');
