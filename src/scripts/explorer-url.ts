import {LOOK_CONTROLS,LOOK_KEYS,DEFAULT_TIME_SLIDER_POSITION,LENS_MIN,LENS_MAX,rangeValue,normalizeTimeSliderPosition,type LookControl} from './scene-control-model';
import {auroraMode,cloudMode,type AuroraMode,type CloudMode} from './scene-effects';
import {readLensPreset,type LensPreset} from './lens-reflections';
import {readNightMode,type NightMode} from './physical-night';
import {EXPOSURE_MIN_EV,exposureMaxEV} from './camera-exposure';

export type ExplorerSettings={
  look:Record<LookControl,number>;
  view:{yaw:number;pitch:number};
  paused:boolean;
  exposureMode:'auto'|'manual';
  fixedExposure:number;
  lensPreset:LensPreset;
  night:NightMode;
  aurora:AuroraMode;
  clouds:CloudMode;
};
const number=(params:URLSearchParams,key:string,fallback:number)=>params.has(key)&&Number.isFinite(Number(params.get(key)))?Number(params.get(key)):fallback;
/** Only application settings belong here. Renderer experiments and navigation
 * retain their own codecs, and unknown URL parameters survive every write. */
export function readExplorerSettings(params:URLSearchParams):ExplorerSettings&{timeSliderPosition:number;lens:number}{
  const night=readNightMode(params),timeSliderPosition=normalizeTimeSliderPosition(number(params,'rate',DEFAULT_TIME_SLIDER_POSITION));
  const look=Object.fromEntries(LOOK_KEYS.map(key=>{
    const spec=LOOK_CONTROLS[key];
    return [key,rangeValue(number(params,`look-${key}`,spec.default),spec.min,spec.max,spec.step,spec.default)];
  })) as Record<LookControl,number>;
  return {
    look,view:{yaw:Math.max(-180,Math.min(180,number(params,'yaw',0))),pitch:Math.max(-90,Math.min(90,number(params,'pitch',0)))},
    timeSliderPosition,paused:params.get('motion')==='0'||timeSliderPosition===0,
    exposureMode:params.get('exposure-mode')==='manual'?'manual':'auto',
    fixedExposure:rangeValue(number(params,'exposure-fixed',0),EXPOSURE_MIN_EV,exposureMaxEV(night),.1,0),
    lensPreset:readLensPreset(params.get('lens-preset')),
    lens:Math.max(LENS_MIN,Math.min(LENS_MAX,number(params,'lens',1))),
    night,aurora:auroraMode(params),clouds:cloudMode(params),
  };
}
const optional=(params:URLSearchParams,key:string,value:string|null)=>{if(value===null)params.delete(key);else params.set(key,value);};
export function writeLookSettings(params:URLSearchParams,state:ExplorerSettings){
  for(const key of LOOK_KEYS)optional(params,`look-${key}`,state.look[key]===LOOK_CONTROLS[key].default?null:String(state.look[key]));
  optional(params,'exposure-mode',state.exposureMode==='manual'?'manual':null);
  optional(params,'exposure-fixed',state.exposureMode==='manual'?String(state.fixedExposure):null);
  optional(params,'lens-preset',state.lensPreset==='iss'?null:state.lensPreset);
}
export function writeViewSettings(params:URLSearchParams,view:ExplorerSettings['view'],free=false){
  for(const key of ['yaw','pitch'] as const)optional(params,key,!free&&view[key]?String(view[key]):null);
}
export function writePlaybackSettings(params:URLSearchParams,paused:boolean){
  params.delete('still');optional(params,'motion',paused?'0':null);
}
export function writeTimeSliderSetting(params:URLSearchParams,timeSliderPosition:number){optional(params,'rate',timeSliderPosition===DEFAULT_TIME_SLIDER_POSITION?null:String(timeSliderPosition));}
export function writeLensSetting(params:URLSearchParams,lens:number){optional(params,'lens',Math.abs(lens-1)>.0005?String(Math.round(lens*1000)/1000):null);}
export function resetExplorerSettingsURL(params:URLSearchParams){
  for(const key of ['t','yaw','pitch','motion','still','moon','orbit','route','flight','position','heading','elevation','roll','orientation','lens','lens-preset','aurora','clouds','rate','exposure-mode','exposure-fixed',...LOOK_KEYS.map(key=>`look-${key}`)])params.delete(key);
}
