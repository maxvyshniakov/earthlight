// A virtual 24 fps camera, not a calibration of a named lens or sensor.
// Shutter stays at 180 degrees (1/48 s), so adaptation cannot invent motion blur.
export const EXPOSURE_MIN_EV=-5.5;
export const EXPOSURE_MAX_EV=4.1;
// Keep the full manual/storage range; automatic metering has a brighter floor.
export const AUTO_EXPOSURE_MIN_EV=-1.5;
export const CAMERA_SHUTTER_SECONDS=1/48;
export function cameraProgram(ev:number){
  const correction=Math.max(-6,Math.min(EXPOSURE_MAX_EV-.5,ev-.5));
  const apertureStops=correction<0?correction*2/3:Math.min(correction,1.1)*.6;
  const opticalGain=2**apertureStops;
  const isoGain=2**(correction-apertureStops);
  return {fNumber:4/Math.sqrt(opticalGain),iso:400*isoGain,opticalGain,isoGain,opening:Math.max(0,Math.min(1,correction/1.1)),shutterSeconds:CAMERA_SHUTTER_SECONDS};
}
export const cameraModelShader=`
// f-number, optical throughput relative to f/4, ISO gain relative to ISO 400,
// and normalized opening across this exposure program. t = 1/48 s throughout.
vec4 cameraProgram(float ev){
  float correction=clamp(ev-.5,-6.,${(EXPOSURE_MAX_EV-.5).toFixed(1)});
  float apertureStops=correction<0.?correction*2./3.:min(correction,1.1)*.6;
  float opticalGain=exp2(apertureStops);
  return vec4(4./sqrt(opticalGain),opticalGain,exp2(correction-apertureStops),clamp(correction/1.1,0.,1.));
}
float decodeCameraEV(vec2 state){return dot(state,vec2(65280.,255.))/65535.*${(EXPOSURE_MAX_EV-EXPOSURE_MIN_EV).toFixed(1)}+${EXPOSURE_MIN_EV.toFixed(1)};}
`;
