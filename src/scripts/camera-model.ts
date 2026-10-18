import { SCENE_CANDELA } from './radiometry';
import { perNightMode, type NightMode } from './physical-night';
// A virtual 24 fps camera, not a calibration of a named lens or sensor.
// The default program keeps a 180-degree shutter (1/48 s), so its adaptation
// cannot invent motion blur.
// With `night=video|still` the program continues past f/3.2 to ISS night
// settings (docs/lab/physical-night-2026-10-17.md, docs/lab/night-camera-2026-10-17.md).
export const EXPOSURE_MIN_EV=-5.5;
/** Top of the exposure state's range with `night=video|still`. */
export const NIGHT_EXPOSURE_MAX_EV=22.1;
/** Top of the exposure state's range in a mode; the state encodes EV over
 * [EXPOSURE_MIN_EV, exposureMaxEV(mode)]. */
export const exposureMaxEV=(mode:NightMode)=>mode==='current'?5.1:NIGHT_EXPOSURE_MAX_EV;
/** The default program's top of range. */
export const EXPOSURE_MAX_EV=exposureMaxEV('current');
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

/** Lens focal length in frame heights at 1× (30 mm on a 24 mm frame). */
export const LENS_FOCAL_1X=1.25;
const FRAME_HEIGHT_MM=24;
/** The night lens. Fast primes reach f/1.4 from 14 mm (Sigma 14 mm f/1.4)
 * through 24 and 50 mm (Nikkor f/1.4, ISS030-E-102292). Past that the front
 * element limits a lens: the ISS's Nikkor 400 mm f/2.8 (ISS030-E-99324) and
 * 800 mm f/5.6E both have a 143 mm entrance pupil, and the 800 mm with its
 * 1.4× converter is 1 120 mm f/8 (140 mm). So the widest aperture is
 * max(f/1.4, focal / 143 mm): f/1.4 to 200 mm, f/10.5 at 1 500 mm. */
export const NIGHT_LENS={fastest:1.4,pupilMm:143} as const;
export const widestFNumber=(focal:number)=>Math.max(NIGHT_LENS.fastest,focal*FRAME_HEIGHT_MM/NIGHT_LENS.pupilMm);
/** Focal length in frame heights for a full-frame focal length in mm. */
export const focalFromMm=(mm:number)=>mm/FRAME_HEIGHT_MM;

// Past f/3.2 and ISO 543 the night programs spend their stops in order, up to
// the camera's highest ISO. Below that (1.1 stops of correction, f/3.18 and
// ISO 543) every mode is the base program, at every focal length.
type StageKind='nd'|'shutter'|'aperture'|'iso';
type Stage={kind:StageKind;stops:number};
const BASE_OPEN=1.1,BASE_WIDEST=4/2**(BASE_OPEN*.3),BASE_TOP_ISO=400*2**(BASE_OPEN*.4);
/** Stops from the base program's widest f/3.18 to the lens's widest at a
 * focal length. Negative from 455 mm on, where f/3.18 is wider than a real
 * lens: the day program keeps it, and the night program stops down to the
 * lens's widest while the neutral-density filter comes out, with ISO making
 * up the difference, so settings stay continuous in EV. */
export const nightApertureStops=(focal:number)=>2*Math.log2(BASE_WIDEST/widestFNumber(focal));
export const NIGHT_CAMERAS={
  // Sony α7S-class video: 360° at 24 fps, then the lens, up to ISO 409 600.
  video:{isoMax:409600,stages:['nd','shutter','aperture','iso']},
  // Nikon D3S-class stills: the lens, up to 1.3 s, then ISO up to 102 400 (Hi 3).
  still:{isoMax:102400,stages:['nd','aperture','shutter','iso']},
} as const satisfies Record<Exclude<NightMode,'current'>,{isoMax:number;stages:readonly StageKind[]}>;
export function nightStages(mode:Exclude<NightMode,'current'>,focal=LENS_FOCAL_1X):Stage[]{
  const camera=NIGHT_CAMERAS[mode];
  const stops:Record<StageKind,number>={nd:BASE_ND_STOPS,shutter:mode==='video'?1:Math.log2(1.3*48),
    aperture:Math.max(0,nightApertureStops(focal)),iso:Math.log2(camera.isoMax/BASE_TOP_ISO)};
  return camera.stages.map(kind=>({kind,stops:stops[kind]}));
}
/** Highest EV the camera reaches at a focal length; the meter stops there. */
export function exposureCeiling(mode:NightMode,focal=LENS_FOCAL_1X){
  if(mode==='current')return 5.1;
  const closing=Math.min(0,nightApertureStops(focal));
  return Math.min(NIGHT_EXPOSURE_MAX_EV,.5+BASE_OPEN+closing+nightStages(mode,focal).reduce((sum,stage)=>sum+stage.stops,0));
}

export function cameraProgramFor(mode:NightMode,ev:number,focal=LENS_FOCAL_1X){
  const max=exposureCeiling(mode,focal);
  const correction=Math.max(-6,Math.min(max-.5,ev-.5));
  let apertureStops=correction<0?correction*2/3:Math.min(correction,BASE_OPEN)*.6;
  let isoStops=Math.min(correction,BASE_OPEN)-apertureStops,shutterStops=0,ndRemoved=0;
  if(mode==='current')isoStops=correction-apertureStops;
  else{
    let extra=Math.max(0,correction-BASE_OPEN);
    const closing=Math.min(0,nightApertureStops(focal));
    for(const stage of nightStages(mode,focal)){
      const used=Math.min(extra,stage.stops);extra-=used;
      if(stage.kind==='nd'){
        // Stop down to the lens's widest as the filter comes out.
        const close=closing*used/stage.stops;
        ndRemoved+=used;apertureStops+=close;extra-=close;
      }
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
/** The default program's settings. */
export function cameraProgram(ev:number,focal=LENS_FOCAL_1X){return cameraProgramFor('current',ev,focal);}

const baseProgramShader=`vec4 cameraProgram(float ev){
  float correction=clamp(ev-.5,-6.,${(exposureMaxEV('current')-.5).toFixed(1)});
  float apertureStops=correction<0.?correction*2./3.:min(correction,1.1)*.6;
  float isoStops=min(correction,1.1)-apertureStops;
  isoStops=correction-apertureStops;
  return vec4(4./sqrt(exp2(apertureStops)),exp2(correction-isoStops),exp2(isoStops),clamp(correction/1.1,0.,1.));
}
`;
// The night stages in GLSL, each consuming up to its stops. The lens stage
// takes FOCAL where the shader defines it before this source; passes without
// it use 1×, which only the loading defocus and the PSF tile read (both the
// same from f/1.4 to f/3.2).
const nightProgramShader=(mode:Exclude<NightMode,'current'>)=>{
  const g=(x:number)=>x.toFixed(6),stages=nightStages(mode);
  const fixed=stages.filter(stage=>stage.kind!=='aperture').reduce((sum,stage)=>sum+stage.stops,0);
  const steps=stages.map(stage=>`  used=min(extra,${stage.kind==='aperture'?'max(0.,lens)':g(stage.stops)});extra-=used;${stage.kind==='aperture'?'apertureStops+=used;':stage.kind==='iso'?'isoStops+=used;':stage.kind==='nd'?`close=min(0.,lens)*used/${g(stage.stops)};apertureStops+=close;extra-=close;`:''}\n`).join('');
  return `float cameraFocal(){
#ifdef FOCAL
  return FOCAL;
#else
  return ${LENS_FOCAL_1X.toFixed(2)};
#endif
}
// From f/${BASE_WIDEST.toFixed(2)} to max(f/${NIGHT_LENS.fastest}, focal / ${NIGHT_LENS.pupilMm} mm); negative past 455 mm.
float nightApertureStops(){
  float widest=max(${NIGHT_LENS.fastest.toFixed(2)},cameraFocal()*${g(FRAME_HEIGHT_MM/NIGHT_LENS.pupilMm)});
  return 2.*log2(${g(BASE_WIDEST)}/widest);
}
float cameraCeilingEV(){float lens=nightApertureStops();return min(${NIGHT_EXPOSURE_MAX_EV.toFixed(1)},${g(.5+BASE_OPEN+fixed)}+lens);}
vec4 cameraProgram(float ev){
  float correction=clamp(ev-.5,-6.,cameraCeilingEV()-.5);
  float apertureStops=correction<0.?correction*2./3.:min(correction,1.1)*.6;
  float isoStops=min(correction,1.1)-apertureStops;
  float extra=max(0.,correction-1.1),lens=nightApertureStops(),used,close;
${steps}  return vec4(4./sqrt(exp2(apertureStops)),exp2(correction-isoStops),exp2(isoStops),clamp(correction/1.1,0.,1.));
}
`;
};
export const cameraModelShaderFor=perNightMode(mode=>`
// f-number, light on the sensor relative to f/4 at 1/48 s, ISO gain relative
// to ISO 400, and normalized opening across the f/16-f/3.2 program.
${mode==='current'?baseProgramShader:nightProgramShader(mode)}// Fractional PSF tile for an f-number, 0 at f/3.2 to ${OPTICAL_PSF_F_NUMBERS.length-1} at f/16.
float opticalPsfState(float fNumber){
  return clamp(log(fNumber/${OPTICAL_PSF_F_NUMBERS[0].toFixed(1)})/${Math.log(OPTICAL_PSF_F_NUMBERS.at(-1)!/OPTICAL_PSF_F_NUMBERS[0]).toFixed(6)}*${(OPTICAL_PSF_F_NUMBERS.length-1).toFixed(1)},0.,${(OPTICAL_PSF_F_NUMBERS.length-1).toFixed(1)});
}
float decodeCameraEV(vec2 state){return dot(state,vec2(65280.,255.))/65535.*${(exposureMaxEV(mode)-EXPOSURE_MIN_EV).toFixed(1)}+${EXPOSURE_MIN_EV.toFixed(1)};}
`);
/** The default program's camera model. */
export const cameraModelShader=cameraModelShaderFor('current');
