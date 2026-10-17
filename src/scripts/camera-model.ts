import { SCENE_CANDELA } from './radiometry';
import { NIGHT_MODE, type NightMode } from './physical-night';
// A virtual 24 fps camera, not a calibration of a named lens or sensor.
// Shutter stays at 180 degrees (1/48 s), so adaptation cannot invent motion blur.
// With `night=video|still` the program continues past f/3.2 to ISS night
// settings (docs/lab/physical-night-2026-10-17.md).
export const EXPOSURE_MIN_EV=-5.5;
export const EXPOSURE_MAX_EV=NIGHT_MODE==='current'?5.1:22.1;
// Keep the full manual/storage range; automatic metering has a brighter floor.
export const AUTO_EXPOSURE_MIN_EV=-3;
export const CAMERA_SHUTTER_SECONDS=1/48;
/** f-numbers of the PSF table's tiles, evenly spaced in log f across the
 * program from its widest f/3.2 to f/16 (scripts/build-optical-psf.mjs). */
export const OPTICAL_PSF_F_NUMBERS=[3.2,5.47,9.36,16] as const;

/** EV100 that renders scene radiance at 2^-ev of sensor white: ISO 12232
 * saturation (78/S lx·s) with the ISO 2720 lens constant q = 0.65. */
export const EV100_AT_ZERO=Math.log2(SCENE_CANDELA*.65*100/78);
/** The base program states f-numbers and ISO 7.5 stops more sensitive than
 * EV100_AT_ZERO: as stated settings it carries this neutral-density filter. */
export const BASE_ND_STOPS=EV100_AT_ZERO-(Math.log2(16*48*100/400)+.5);
// Past f/3.2 and ISO 543 the night programs spend their stops in order. The
// last stage, ISO, absorbs the rest up to EXPOSURE_MAX_EV.
type Stage={kind:'nd'|'shutter'|'aperture'|'iso';stops:number};
// From the base program's widest f/3.18 (0.66 stops past f/4) to f/1.4.
const APERTURE_TO_F1_4=2*Math.log2(4/2**.33/1.4);
export const NIGHT_STAGES:Record<Exclude<NightMode,'current'>,Stage[]>={
  // Sony α7S-class video: 360° at 24 fps, f/1.4, up to ISO 409 600.
  video:[{kind:'nd',stops:BASE_ND_STOPS},{kind:'shutter',stops:1},{kind:'aperture',stops:APERTURE_TO_F1_4},{kind:'iso',stops:99}],
  // Nikon D3S-class stills: f/1.4, up to 1.3 s, then ISO (ISS night frames).
  still:[{kind:'nd',stops:BASE_ND_STOPS},{kind:'aperture',stops:APERTURE_TO_F1_4},{kind:'shutter',stops:Math.log2(1.3*48)},{kind:'iso',stops:99}],
};
const BASE_OPEN=1.1;

export function cameraProgramFor(mode:NightMode,ev:number){
  const max=mode==='current'?5.1:22.1;
  const correction=Math.max(-6,Math.min(max-.5,ev-.5));
  let apertureStops=correction<0?correction*2/3:Math.min(correction,BASE_OPEN)*.6;
  let isoStops=Math.min(correction,BASE_OPEN)-apertureStops,shutterStops=0,ndRemoved=0;
  if(mode==='current')isoStops=correction-apertureStops;
  else{
    let extra=Math.max(0,correction-BASE_OPEN);
    for(const stage of NIGHT_STAGES[mode]){
      const used=Math.min(extra,stage.stops);extra-=used;
      if(stage.kind==='nd')ndRemoved+=used;
      else if(stage.kind==='shutter')shutterStops+=used;
      else if(stage.kind==='aperture')apertureStops+=used;
      else isoStops+=used;
    }
  }
  const isoGain=2**isoStops;
  // Light reaching the sensor relative to f/4 at 1/48 s, before ISO gain.
  const opticalGain=2**correction/isoGain;
  const fNumber=4/Math.sqrt(2**apertureStops);
  const shutterSeconds=CAMERA_SHUTTER_SECONDS*2**shutterStops;
  const ndStops=mode==='current'?0:BASE_ND_STOPS-ndRemoved;
  const iso=400*isoGain;
  return {fNumber,iso,opticalGain,isoGain,opening:Math.max(0,Math.min(1,correction/BASE_OPEN)),shutterSeconds,ndStops,
    ev100:Math.log2(fNumber*fNumber/shutterSeconds)-Math.log2(iso/100)+ndStops};
}
export function cameraProgram(ev:number){return cameraProgramFor(NIGHT_MODE,ev);}

// GLSL for the night stages: each consumes up to its stops of `extra`.
const nightStagesShader=NIGHT_MODE==='current'?'  isoStops=correction-apertureStops;\n':(()=>{
  let start=0,code='  float extra=max(0.,correction-1.1);\n';
  for(const stage of NIGHT_STAGES[NIGHT_MODE]){
    const used=`clamp(extra-${start.toFixed(4)},0.,${stage.stops.toFixed(4)})`;
    if(stage.kind==='aperture')code+=`  apertureStops+=${used};\n`;
    if(stage.kind==='iso')code+=`  isoStops+=${used};\n`;
    start+=stage.stops;
  }
  return code;
})();
export const cameraModelShader=`
// f-number, light on the sensor relative to f/4 at 1/48 s, ISO gain relative
// to ISO 400, and normalized opening across the f/16-f/3.2 program.
vec4 cameraProgram(float ev){
  float correction=clamp(ev-.5,-6.,${(EXPOSURE_MAX_EV-.5).toFixed(1)});
  float apertureStops=correction<0.?correction*2./3.:min(correction,1.1)*.6;
  float isoStops=min(correction,1.1)-apertureStops;
${nightStagesShader}  return vec4(4./sqrt(exp2(apertureStops)),exp2(correction-isoStops),exp2(isoStops),clamp(correction/1.1,0.,1.));
}
// Fractional PSF tile for an f-number, 0 at f/3.2 to ${OPTICAL_PSF_F_NUMBERS.length-1} at f/16.
float opticalPsfState(float fNumber){
  return clamp(log(fNumber/${OPTICAL_PSF_F_NUMBERS[0].toFixed(1)})/${Math.log(OPTICAL_PSF_F_NUMBERS.at(-1)!/OPTICAL_PSF_F_NUMBERS[0]).toFixed(6)}*${(OPTICAL_PSF_F_NUMBERS.length-1).toFixed(1)},0.,${(OPTICAL_PSF_F_NUMBERS.length-1).toFixed(1)});
}
float decodeCameraEV(vec2 state){return dot(state,vec2(65280.,255.))/65535.*${(EXPOSURE_MAX_EV-EXPOSURE_MIN_EV).toFixed(1)}+${EXPOSURE_MIN_EV.toFixed(1)};}
`;
