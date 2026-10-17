import { perNightMode, physicalNight, type NightMode } from './physical-night';
// Pre-exposure (docs/lab/pre-exposure-2026-10-17.md). Physical night radiance
// reaches 2^-34 scene units, below half floats (smallest normal 2^-14) and
// RGBE (2^-32). Every scene radiance target therefore stores radiance times
// 2^ev of the camera state the frame is rendered with, which is one frame old;
// the exposure meter, the glare pyramid and the camera finish divide it back
// out, so absolute thresholds keep their scene units. Off in the default
// program, whose radiance fits half floats as it is.
export const preExposure=(mode:NightMode)=>physicalNight(mode);
/** Largest pre-exposed value a pass writes, under half-float's 65504: a Sun
 * at a night exposure clips while the meter closes down, never overflows. */
export const PRE_EXPOSED_MAX=65000;
/** GLSL after cameraModelShader and the cameraState sampler. Without the
 * camera state in a pass (10 or fewer texture units) nothing is pre-exposed
 * there, so the lab needs it in every scene pass. */
export const preExposureShaderFor=perNightMode(mode=>preExposure(mode)?`
float sceneExposure(){
#ifdef CAMERA_PUPIL_STATE
  return exp2(decodeCameraEV(texture2D(cameraState,vec2(.5)).rg));
#else
  return 1.;
#endif
}
`:'');
