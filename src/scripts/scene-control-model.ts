/** Domain scales shared by settings, HUD and keyboard commands. */
const clamp=(x:number,a:number,b:number)=>Math.max(a,Math.min(b,x));
/** The lens range, as magnifications of the 1× pinhole (about 30 mm): from a
 * 15 mm wide angle to 1500 mm. */
export const LENS_MIN=.5,LENS_MAX=50;
/** Exposure compensation range in EV, shared by Settings and the HUD tape. */
export const EV_MIN=-3,EV_MAX=4;
/** Time scale, from 0× (time stands still, which is what pausing means) to
 * 1000×. Settings' slider and the HUD tape share one scale over a 0–1 fraction
 * in five equal stretches: linear from 0 to 0.1×, then four logarithmic
 * decades. Time scales keep two significant figures. */
export const MAX_TIME_SCALE=1000;
const MIN_LOG_TIME_SCALE=.1,LINEAR_TIME_SCALE_FRACTION=1/5;
export const timeScaleAt=(fraction:number)=>{
  const f=clamp(fraction,0,1),raw=f<=LINEAR_TIME_SCALE_FRACTION?MIN_LOG_TIME_SCALE*f/LINEAR_TIME_SCALE_FRACTION:MIN_LOG_TIME_SCALE*10**((f-LINEAR_TIME_SCALE_FRACTION)/(1-LINEAR_TIME_SCALE_FRACTION)*4);
  return raw>0?Number(raw.toPrecision(2)):0;
};
export const timeScaleFraction=(timeScale:number)=>timeScale<=MIN_LOG_TIME_SCALE?clamp(timeScale,0,MIN_LOG_TIME_SCALE)/MIN_LOG_TIME_SCALE*LINEAR_TIME_SCALE_FRACTION:clamp(LINEAR_TIME_SCALE_FRACTION+Math.log10(timeScale/MIN_LOG_TIME_SCALE)/4*(1-LINEAR_TIME_SCALE_FRACTION),0,1);

export const DEFAULT_TIME_SLIDER_POSITION=Math.round(timeScaleFraction(10)*1000);
export const LOOK_CONTROLS={
  exposure:{min:EV_MIN,max:EV_MAX,step:.1,default:0},
  ghosts:{min:0,max:2,step:.05,default:1},
  grain:{min:0,max:2,step:.05,default:1},
  chromatic:{min:0,max:2,step:.05,default:1},
  galaxy:{min:0,max:2,step:.05,default:1},
} as const;
export type LookControl=keyof typeof LOOK_CONTROLS;
export const LOOK_KEYS=Object.keys(LOOK_CONTROLS) as LookControl[];
/** Match range-input clamping and step rounding independently of the DOM. */
export function rangeValue(value:number,min:number,max:number,step:number,fallback:number){
  if(!Number.isFinite(value))return fallback;
  return Number(clamp(min+Math.round((clamp(value,min,max)-min)/step)*step,min,max).toFixed(8));
}
export const normalizeTimeSliderPosition=(position:number)=>rangeValue(position,0,1000,1,DEFAULT_TIME_SLIDER_POSITION);
