import { cameraModelShader } from './camera-model';
import optics from '../data/optical-psf.json' with { type:'json' };
export { optics };

// This shared PSF is the squared Fourier transform of a broadband rounded
// six-blade pupil, with small wavefront errors and normalized scattering wings.
export const opticalPsfSource = `
uniform sampler2D opticalPsf;
${cameraModelShader}
#ifdef CAMERA_PUPIL_STATE
uniform sampler2D cameraState;
#endif
// One atlas tile per precomputed iris opening. Decode log radiance BEFORE
// interpolating openings so flux remains constant through the exposure ramp.
vec3 diffractionPsf(vec2 delta, float opening) {
  vec2 uv=delta/${optics.span.toFixed(1)}+vec2(.5+.5/${optics.size.toFixed(1)});
  if(any(lessThan(uv,vec2(0.)))||any(greaterThan(uv,vec2(1.))))return vec3(0.);
  uv=clamp(uv,vec2(.5/${optics.size.toFixed(1)}),vec2(1.-.5/${optics.size.toFixed(1)}));
  float position=clamp(opening,0.,1.)*${(optics.states-1).toFixed(1)};
  float first=min(floor(position),${(optics.states-2).toFixed(1)});
  vec2 a=vec2(uv.x,(uv.y+first)/${optics.states.toFixed(1)});
  vec2 b=a+vec2(0.,1./${optics.states.toFixed(1)});
  vec3 low=max(vec3(0.),exp2(texture2D(opticalPsf,a).rgb*26.-24.)-vec3(0.000000059604645));
  vec3 high=max(vec3(0.),exp2(texture2D(opticalPsf,b).rgb*26.-24.)-vec3(0.000000059604645));
  return mix(low,high,position-first);
}
// Broad scatter has no texture-window edge. Its normalized Moffat tail falls
// smoothly below visibility inside the finite star sprite. Keep equal flux.
vec3 pupilPsf(vec2 delta,float opening){
  float r2=dot(delta,delta),scale2=4.;
  float scatter=${optics.integral.toFixed(8)}/(3.141592654*scale2)*pow(1.+r2/scale2,-2.);
  return diffractionPsf(delta,opening)*.96+vec3(scatter*.04);
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
  float diffractionScale=camera.x/4.;
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
  vec3 wing=pupilPsf(pupilDelta,camera.w)/(radialScale*tangentialScale);
  vec3 profile=mix(pupilPsf(delta,camera.w),wing,min(.65,.32*strength));
  return profile/(diffractionScale*diffractionScale);
}
`;
