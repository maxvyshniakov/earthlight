import {sceneLook} from './scene-defaults';
import {SceneClock} from './scene-clock';
import {SceneCalendar} from './scene-calendar';
import {FlightNavigation,PROJECTION} from './flight-navigation';
import {initialSceneSeconds} from './iss-orbit';
import {EXPOSURE_MIN_EV,exposureMaxEV} from './camera-exposure';
import {DEFAULT_TIME_SLIDER_POSITION,LOOK_CONTROLS,LOOK_KEYS,rangeValue,normalizeTimeSliderPosition,timeScaleAt,timeScaleFraction,type LookControl} from './scene-control-model';
import {readExplorerSettings,type ExplorerSettings} from './explorer-url';
import type {NightMode} from './physical-night';

/** Application state for one explorer. DOM controls submit commands and render
 * this state; hidden settings inputs are never a storage or command transport. */
export class ExplorerSession {
  readonly settings:ExplorerSettings;
  readonly playback:SceneClock;
  readonly calendar:SceneCalendar;
  readonly navigation=new FlightNavigation();
  /** Last nonzero time scale survives a pause, including rate=0 on first load. */
  timeScale:number;
  constructor(params:URLSearchParams,standalone:boolean,seconds=initialSceneSeconds(params)){
    const {timeSliderPosition,lens,...settings}=readExplorerSettings(params);
    this.settings=settings;
    this.timeScale=timeScaleAt(timeSliderPosition/1000)||timeScaleAt(DEFAULT_TIME_SLIDER_POSITION/1000);
    this.playback=new SceneClock(seconds,this.timeScale);
    this.calendar=new SceneCalendar(params,seconds);
    if(standalone){this.navigation.restore(params);this.navigation.focal=PROJECTION*lens;}
  }
  get paused(){return this.settings.paused;}
  get shownTimeScale(){return this.paused?0:this.timeScale;}
  get timeSliderPosition(){return this.paused?0:Math.round(timeScaleFraction(this.timeScale)*1000);}
  toggle(){this.settings.paused=!this.settings.paused;}
  setTimeSliderPosition(position:number,now:number){
    const next=timeScaleAt(normalizeTimeSliderPosition(position)/1000);
    if(next>0){this.timeScale=next;this.playback.setTimeScale(next,now);}
    const changed=this.paused!==(next===0);
    this.settings.paused=next===0;
    return changed;
  }
  sliderPositionForTimeScale(timeScale:number){return timeScale>0?Math.max(1,Math.round(timeScaleFraction(timeScale)*1000)):0;}
  setTimeScale(timeScale:number,now:number){return this.setTimeSliderPosition(this.sliderPositionForTimeScale(timeScale),now);}
  setLook(key:LookControl,value:number){
    const spec=LOOK_CONTROLS[key];
    this.settings.look[key]=rangeValue(value,spec.min,spec.max,spec.step,spec.default);
  }
  setView(key:'yaw'|'pitch',value:number){const limit=key==='yaw'?180:90;this.settings.view[key]=Number.isFinite(value)?Math.max(-limit,Math.min(limit,value)):0;}
  setFixedExposure(value:number){this.settings.fixedExposure=rangeValue(value,EXPOSURE_MIN_EV,exposureMaxEV(this.settings.night),.1,0);}
  setNight(mode:NightMode){this.settings.night=mode;this.setFixedExposure(this.settings.fixedExposure);}
  setCalendar(kind:'date'|'time',value:number,seconds:number){
    if(kind==='date')this.calendar.setDay(value,seconds);else this.calendar.setMinute(value,seconds);
  }
  get look(){
    const values=Object.fromEntries(LOOK_KEYS.map(key=>[key,this.settings.look[key]*sceneLook[key]])) as typeof sceneLook;
    return {...values,exposure:this.settings.exposureMode==='manual'?0:values.exposure,
      manualExposure:this.settings.exposureMode==='manual'?this.settings.fixedExposure:null,lensPreset:this.settings.lensPreset};
  }
  /** Reset the whole application session; retain the current night/study
   * experiment. The host supplies its scroll composition, never DOM state. */
  reset(params:URLSearchParams,now:number,offset=0,seconds=initialSceneSeconds(new URLSearchParams()),wallTime=Date.now()){
    const defaults=new URLSearchParams(params);defaults.delete('clouds');
    const {timeSliderPosition:_,lens:__,...reset}=readExplorerSettings(new URLSearchParams());
    reset.clouds=readExplorerSettings(defaults).clouds;
    // Reset all has always retained the selected night experiment.
    reset.night=this.settings.night;
    Object.assign(this.settings.look,reset.look);Object.assign(this.settings.view,reset.view);
    Object.assign(this.settings,{...reset,look:this.settings.look,view:this.settings.view});
    this.timeScale=timeScaleAt(DEFAULT_TIME_SLIDER_POSITION/1000);this.playback.setTimeScale(this.timeScale,now);
    this.playback.seek(seconds-offset,now);this.calendar.reset(seconds,wallTime);
    const from=this.navigation.read(seconds,this.settings.view,now);
    this.navigation.follow('iss',from,now,false);this.navigation.focal=PROJECTION;
  }
}
