import {diagnostics} from './scene-diagnostics';
import {diagnosticTestFrame,diagnosticTestPhase} from './diagnostic-test';
import {sceneLook} from './scene-defaults';
import {SceneFrameClock} from './scene-frame-clock';
import {SceneHostLifecycle} from './scene-host-lifecycle';
import {NightCrossfade} from './night-crossfade';
import {rememberedScale,rememberScale} from './scene-scale-memory';
import {ViewScale,shellCoverage,viewScaleFor} from './scene-view-scale';
import { createCameraDrag, draggedCamera } from './camera-drag';
import { createTouchCamera } from './camera-touch';
import { createFlightControls, type FlightCommand } from './flight-controls';
import { createCameraController } from './camera-controller';
import { createFlightHud, type FlightHud } from './flight-hud';
import { createInputDevice, type InputDevicePreference } from './input-device';
import { LENS_MIN, LENS_MAX, type LookControl } from './scene-control-model';
import { ExplorerSession } from './explorer-session';
import { writeLookSettings, writeViewSettings, writePlaybackSettings, writeTimeSliderSetting, writeLensSetting, resetExplorerSettingsURL } from './explorer-url';
import { type NightMode } from './physical-night';
import { calendarFrame, dayOfYear, daysInYear, utcDay } from './scene-calendar';
import { followLens, orbitPeriod, PROJECTION, ORBIT_LABELS, type Orbit, type ObserverFrame, type FlightInput } from './flight-navigation';
import { createScenePanels } from './scene-panels';
import { EXPOSURE_SETTLE_MS, EXPOSURE_MIN_EV, exposureMaxEV } from './camera-exposure';
import { issFrame, ISS_PERIOD_SECONDS, initialSceneSeconds, cross, dot, normalize, type Vec3 } from './iss-orbit';
import { celestialFrame, currentLunarPhase } from './celestial-sky';
import { createSceneRenderer, type SceneLook } from './scene-renderer';
import { SceneFocus } from './scene-assets';
import { sceneBufferSize, sceneComposition, focusRenderScale, focusGrainScale, bufferDensity } from './scene-viewport';
import { sceneProfile } from './scene-profile';
import {cloudMode as readCloudMode} from './scene-effects';
import {isWebGL2,sceneContext} from './webgl-context';
import {modisStudyURL} from './modis-study-view';
import {cloudPropertiesDate,cloudPropertiesDay,cloudPropertiesPath,cloudPropertiesURL,type CloudPropertiesView} from './cloud-properties';
import {assetURL} from './asset-location';

export class EarthlightExplorer extends HTMLElement {
  private cleanup?: () => void;

  connectedCallback() {
    if (this.cleanup) return;
    const entry=new URL(location.href),studyView=entry.searchParams.get('studyView');
    if(this.dataset.composition==='explorer'&&['day','low','oblique'].includes(studyView??'')){
      const preset=modisStudyURL(location.href,studyView as 'day'|'low'|'oblique',entry.searchParams.get('cloudStudy')==='photo'?'photo':'modis');
      for(const key of ['api','quality'])if(entry.searchParams.has(key))preset.searchParams.set(key,entry.searchParams.get(key)!);
      history.replaceState(history.state,'',preset);
    }
    const diagnostic=diagnostics();
    diagnostic?.event('explorer-connected');
    const canvas = this.querySelector('canvas')!;
    // Holds the last frame of one night mode while the next one meters.
    const crossfade=this.querySelector<HTMLCanvasElement>('.explorer-crossfade');
    const heldFrame=crossfade?new NightCrossfade(crossfade):null;
    const viewport = this.querySelector<HTMLElement>('.explorer-viewport')!;
    const motionButtons = [...this.querySelectorAll<HTMLButtonElement>('.explorer-motion')];
    const controls = this.querySelector<HTMLElement>('.explorer-controls')!;
    const settingsToggle = this.querySelector<HTMLButtonElement>('.explorer-settings-toggle')!;
    const explorerLink = this.querySelector<HTMLAnchorElement>('.explorer-link');
    const timeSliderInput = this.querySelector<HTMLInputElement>('.explorer-speed input')!;
    const timeScaleOutput = this.querySelector<HTMLOutputElement>('.explorer-speed output')!;
    const orbitInput = this.querySelector<HTMLInputElement>('.explorer-track input')!;
    const orbitOutput = this.querySelector<HTMLOutputElement>('.explorer-track output')!;
    const timeStatus = this.querySelector<HTMLTimeElement>('.explorer-time')!;
    // The HUD sets date and time apart by spacing alone; the embedded caption is one line.
    const dateStatus=timeStatus.querySelector<HTMLElement>('.explorer-date'),clockStatus=timeStatus.querySelector<HTMLElement>('.explorer-clock');
    const coordinateStatus = this.querySelector<HTMLElement>('.explorer-coordinates');
    const timeScaleOutputs = [...this.querySelectorAll<HTMLElement>('[data-time-scale]')];
    const lookInputs = [...this.querySelectorAll<HTMLInputElement>('[data-look]')];
    const exposureMode=this.querySelector<HTMLSelectElement>('#explorer-exposure-mode')!;
    const auroraMode=this.querySelector<HTMLSelectElement>('#explorer-aurora')!;
    const cloudsMode=this.querySelector<HTMLSelectElement>('#explorer-clouds')!;
    const lensPreset=this.querySelector<HTMLSelectElement>('#explorer-lens-preset')!;
    const fixedExposure=this.querySelector<HTMLInputElement>('#explorer-fixed-exposure')!;
    const viewInputs=[...this.querySelectorAll<HTMLInputElement>('[data-view]')];
    const resetAll = this.querySelector<HTMLButtonElement>('.reset-all')!;
    // Slider 100% is the accepted image grade; renderer gains retain its appearance.
    const lookBase = sceneLook;
    const look:SceneLook = { ...lookBase };
    const standalone=this.dataset.composition==='explorer';
    const attributes:WebGLContextAttributes={alpha:false,antialias:false,depth:false,powerPreference:standalone?'high-performance':'low-power'};
    const gl=sceneContext(canvas,new URLSearchParams(location.search),attributes);
    // The poster is only for an explorer that cannot draw at all.
    if (!gl) { this.dataset.unavailable = ''; return; }
    this.dataset.renderApi=isWebGL2(gl)?'webgl2':'webgl';
    if(diagnostic){
      const debug=gl.getExtension('WEBGL_debug_renderer_info');
      diagnostic.environment({api:this.dataset.renderApi,powerPreference:gl.getContextAttributes()?.powerPreference,
        gpuRenderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):null,gpuVendor:debug?gl.getParameter(debug.UNMASKED_VENDOR_WEBGL):null,
        maxTextureSize:gl.getParameter(gl.MAX_TEXTURE_SIZE)});
      diagnostic.event('context-created');
    }
    let diagnosticStarted:number|null=null,diagnosticPhase='',diagnosticPaused=false,diagnosticSeconds=0;

    const runtime=new SceneHostLifecycle({
      running:()=>!session.paused&&this.hasAttribute('data-ready'),
      drawing:()=>session.paused||!this.hasAttribute('data-ready'),
      frame:now=>tick(now),draw:now=>flushDraw(now),
    });
    // Repeatable frames and opt-in render comparisons.
    const params = new URLSearchParams(location.search);
    const initialSeconds=initialSceneSeconds(params);
    const session=new ExplorerSession(params,standalone,initialSeconds);
    const calendarInputs=[...this.querySelectorAll<HTMLInputElement>('[data-calendar]')];
    const settings=session.settings;
    const {playback,calendar,navigation}=session;
    const cameraView=settings.view;
    auroraMode.value=settings.aurora;
    cloudsMode.value=settings.clouds;
    cloudsMode.closest<HTMLElement>('.setting')!.hidden=['photo','modis','global','plates'].includes(params.get('cloudStudy')??'');
    exposureMode.value=settings.exposureMode;
    lensPreset.value=settings.lensPreset;
    // Physical night (`night=video|still`): the renderer starts in the mode
    // the address names and N switches it in place.
    this.dataset.nightMode=settings.night;
    // The markup is built for the default range; night mode widens it.
    const fixedRange=()=>{fixedExposure.min=String(EXPOSURE_MIN_EV);fixedExposure.max=String(exposureMaxEV(settings.night));};
    fixedRange();
    fixedExposure.value=String(settings.fixedExposure);
    const profile=sceneProfile(params);
    this.dataset.renderProfile=profile.name;
    for(const input of lookInputs)input.value=String(settings.look[input.dataset.look as LookControl]);
    timeSliderInput.value=String(session.timeSliderPosition);
    // Release trackpad scroll over this many milliseconds (`inputSmoothing=0`
    // applies it at once). Touch and mouse drags already arrive once per
    // frame; smoothing them only weakens short flicks, so they keep their own,
    // normally zero, constant.
    const number=(key:string,fallback:number)=>params.has(key)&&Number.isFinite(Number(params.get(key)))?Number(params.get(key)):fallback;
    // By default about two frames of the current cadence: 90 ms at 24 FPS,
    // short enough at 60 FPS not to trail the fingers.
    const inputSmoothing=params.has('inputSmoothing')?Math.max(0,Math.min(200,number('inputSmoothing',90))):()=>2.2*1000/frameClock.fps;
    navigation.inputSmoothing=Math.max(0,Math.min(200,Number(params.get('dragSmoothing'))||0))/1000;
    // One finger turns the globe like a trackpad scroll, so a drag never runs
    // out of travel at the limb; `touchMode=grab` holds the touched point
    // instead. Earth turns `touchGain` times faster than the finger; a fling
    // may reach `flingLimit` rad/s and coasts `flingCoast` s.
    const touchSpin=params.get('touchMode')!=='grab';
    const touchGain=Math.max(1,Math.min(4,number('touchGain',2.5)));
    navigation.flingLimit=Math.max(.5,Math.min(10,number('flingLimit',8)));
    navigation.flingCoast=Math.max(.1,Math.min(2,number('flingCoast',1.1)));
    let flightControls:ReturnType<typeof createFlightControls>|undefined;
    let keyFlightUntil=0;
    let hud:FlightHud|null=null;
    let navigationURLTimer=0;
    for(const input of viewInputs)input.value=String(cameraView[input.dataset.view as keyof typeof cameraView]);
    let urlUpdateFrame=0;
    // The explorer renders on whole display refreshes (`cadence=timer` keeps
    // the old 24 FPS timer); the background keeps its passive budget.
    const steadyCadence=standalone&&params.get('cadence')!=='timer';
    const frameClock=new SceneFrameClock(profile.fps,steadyCadence);
    // Late frames lower the explorer's scale before motion stutters.
    const headroom=standalone&&params.get('headroom')!=='0';
    // Opt-in readout for on-device A/B checks: submitted scene frames, not
    // display refreshes, plus the adaptive scale and work switches.
    const perf=params.get('perf')==='1'?document.createElement('div'):null;
    const perfFrames:number[]=[];let perfShown=0;
    // Animation frames that arrive a refresh or more late: the compositor
    // skipped a frame, usually because the GPU had not finished the last one.
    const perfTicks:{at:number;late:boolean;gap:number}[]=[];let perfTick=0,longFrames:{at:number;ms:number}[]=[];
    const perfObserve=(now:number)=>{
      if(!perf)return;
      const gap=perfTick?now-perfTick:0,period=frameClock.refreshPeriod;perfTick=now;
      if(gap>0&&gap<250)perfTicks.push({at:now,late:period>0&&gap>period*1.5,gap});
      while(perfTicks.length&&perfTicks[0].at<now-3000)perfTicks.shift();
    };
    let perfObserver:PerformanceObserver|undefined;
    if(perf)try{perfObserver=new PerformanceObserver(list=>{for(const entry of list.getEntries())longFrames.push({at:entry.startTime+entry.duration,ms:entry.duration});});perfObserver.observe({type:'long-animation-frame',buffered:false});}catch{/* unsupported */}
    if(perf){perf.className='explorer-perf';(this.querySelector('.explorer-service')??this).append(perf);}
    let scrollTimer=0;
    let pendingURL:URL|null=null;
    const updateURL=(url:URL)=>{
      calendar.write(url.searchParams);
      pendingURL=url;
      if(urlUpdateFrame)return;
      urlUpdateFrame=requestAnimationFrame(()=>{
        urlUpdateFrame=0;
        if(pendingURL){history.replaceState(null,'',pendingURL);pendingURL=null;}
      });
    };
    // The Moon's phase follows the scene's date; links from when it could be
    // set by hand drop their `moon`.
    if(standalone&&params.has('moon')){const url=new URL(location.href);url.searchParams.delete('moon');updateURL(url);}
    const scrollComposition=this.dataset.composition==='page';
    let statusTimer=0;
    const replayDateFormat=new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'});
    let grainIndex = 0;
    const rangeInputs=[...this.querySelectorAll<HTMLInputElement>('input[type="range"]')];
    const paintRange=(input:HTMLInputElement)=>{
      if(input.dataset.fill==='none')return;
      const min=Number(input.min),span=Number(input.max)-min;
      const position=(Number(input.value)-min)/span*100;
      const origin=input.dataset.fill==='default'?(Number(input.defaultValue)-min)/span*100:input.dataset.fill==='center'?-min/span*100:0;
      input.style.setProperty('--range-start',`${Math.min(origin,position)}%`);
      input.style.setProperty('--range-end',`${Math.max(origin,position)}%`);
    };
    rangeInputs.forEach(paintRange);
    // Stopped time reads 0×; the time scale it had waits for Play.
    const updateTimeScaleLabel = () => {
      const shown=session.paused?0:session.timeScale;
      if(document.activeElement!==timeSliderInput)timeSliderInput.value=String(session.paused?0:session.timeSliderPosition);
      timeScaleOutput.value = `${shown}×`;
      for(const output of timeScaleOutputs)output.textContent=`${shown}×`;
      timeSliderInput.setAttribute('aria-valuetext', session.paused?'Time stands still':`${shown} times orbital speed`);
      paintRange(timeSliderInput);
    };
    let lastAnimationDraw = 0;
    let controlsInView = true;
    // Autoplay by default, including legacy links carrying `still`.
    // Explicit motion=0 remains available for repeatable screenshots.
    updateTimeScaleLabel();
    let lastStatus = -1;

    let renderer:ReturnType<typeof createSceneRenderer>;
    const focus=new SceneFocus();
    let focusTimer=0;
    let exposureTimer=0,exposureUntil=0;
    let exposureSceneTime:number|null=null;
    let focusRadius=6,focusDensity=1.5;
    let qualityScale:number=profile.scale;
    let qualitySince=0,qualitySaved=0;
    let inspection=false;
    let qualityFrame=0;
    // The explorer enlarges its buffer when Earth fills less of the frame; the
    // adaptive scale then holds for a covered view. `viewScale` is the cost of
    // a sky pixel relative to a planet pixel; `viewScale=0` turns it off.
    const viewSkyParam=number('viewScale',.1);
    const viewSky=standalone&&viewSkyParam>=.05&&viewSkyParam<=.6?viewSkyParam:null;
    const viewScale=new ViewScale();
    const bufferScale=()=>Math.min(1,qualityScale*viewScale.factor);
    let cssHeight=1,smallHeight=1;
    const updateFocus=()=>{
      if(runtime.disposed||runtime.lost||document.hidden)return;
      const stats=[this.dataset.dayTiles,this.dataset.nightTiles,this.dataset.cloudTiles].filter(Boolean).map(x=>JSON.parse(x!));
      const tilesSettled=stats.every(x=>x.pending===0&&x.resident>=x.wanted);
      const ready=this.hasAttribute('data-ready');
      const blur=matchMedia('(prefers-reduced-motion: reduce)').matches&&ready?0:focus.value(performance.now(),ready,renderer.assets.detailProgress,tilesSettled);
      const changed=Math.abs(focusRadius-blur)>.0001;
      const previousScale=focusRenderScale(focusRadius,focusDensity);
      focusRadius=blur<.01?0:blur;
      if(previousScale!==focusRenderScale(focusRadius,focusDensity)){
        cancelAnimationFrame(qualityFrame);qualityFrame=requestAnimationFrame(resize);
      }
      this.dataset.focusRadius=focusRadius.toFixed(3);
      this.dataset.focus=blur<.01?'sharp':'acquiring';
      this.dataset.assets=renderer.assets.settled?'settled':'loading';
      this.dataset.assetBytes=String(renderer.assets.bytes);
      if(blur>=.01)focusTimer=window.setTimeout(updateFocus,1000/24);
      if(changed&&session.paused&&ready)draw();
    };
    const composition = () => sceneComposition(window.scrollY,smallHeight,cssHeight,scrollComposition);
    const observerAt=(seconds:number,now=performance.now()):ObserverFrame&{focal:number}=>{
      const view=composition();
      if(diagnosticStarted!==null){
        const elapsed=(now-diagnosticStarted)/1000,phase=diagnosticTestPhase(elapsed);
        if(elapsed>=60){diagnostic?.cancelTest?.();return observerAt(playback.read(now)+view.offset,now);}
        if(phase!==diagnosticPhase){diagnosticPhase=phase;window.dispatchEvent(new CustomEvent('earthlight-diagnostic-phase',{detail:phase}));}
        const frame=diagnosticTestFrame(elapsed);if(frame)return frame;
        diagnostic?.cancelTest?.();
      }
      const pose=standalone?navigation.read(seconds,cameraView,now):issFrame(seconds,view.limb,cameraView,view.altitudeLift);
      return {...calendarFrame(pose,calendar.date(seconds)),focal:standalone?navigation.focal:PROJECTION};
    };
    const currentObserver=()=>observerAt(playback.read(performance.now())+composition().offset);
    const period=()=>standalone?orbitPeriod(navigation.orbit):ISS_PERIOD_SECONDS;
    const updateNavigationUI=()=>{
      if(!standalone)return;
      this.dataset.flightMode=navigation.mode;this.dataset.orbit=navigation.orbit;
      const title=this.querySelector('.explorer-title');
      if(title)title.textContent=navigation.free?'Free flight':ORBIT_LABELS[navigation.orbit];
      this.querySelector<HTMLElement>('.explorer-track')!.hidden=!!navigation.free;
      for(const input of viewInputs)input.closest<HTMLElement>('.setting')!.hidden=!!navigation.free;
      orbitInput.setAttribute('aria-label',`Position in ${ORBIT_LABELS[navigation.orbit]}`);
    };
    updateNavigationUI();
    const updateExplorerLink = (sceneTime=playback.read(performance.now())+composition().offset) => {
      if(!explorerLink)return;
      const url=new URL(this.dataset.exploreUrl??'/',location.href);
      for(const key of ['render','compare','api','texture','aurora','cloudShape','cloudStudy','cloudStudyView','cloudLighting'])if(params.has(key))url.searchParams.set(key,params.get(key)!);
      if(settings.night!=='current')url.searchParams.set('night',settings.night);
      url.searchParams.set('t',sceneTime.toFixed(2));
      calendar.write(url.searchParams);
      if(session.paused)url.searchParams.set('motion','0');
      if(cameraView.yaw)url.searchParams.set('yaw',String(cameraView.yaw));
      if(cameraView.pitch)url.searchParams.set('pitch',String(cameraView.pitch));
      writeLookSettings(url.searchParams,settings);
      explorerLink.href=url.href;
    };
    const prepareExplorerLink = () => updateExplorerLink();
    const updateStatus = (sceneTime:number,frame?:ObserverFrame) => {
      updateExplorerLink(sceneTime);
      // Align to the UTC second shown to the user, including the epoch fraction.
      const second=Math.floor(calendar.date(sceneTime).getTime()/1000);
      if(lastStatus===second)return;
      const observer=frame??observerAt(sceneTime);
      {
        lastStatus = second;
        const duration=period(),orbitPhase=((sceneTime%duration)+duration)%duration;
        orbitInput.value = String(orbitPhase/duration*100);
        paintRange(orbitInput);
        orbitInput.setAttribute('aria-valuetext',`${Math.floor(orbitPhase/60)} minutes, ${observer.phase}`);
        orbitOutput.value = observer.phase;
        this.dataset.phase = observer.phase.toLowerCase();
        this.dataset.sun=JSON.stringify(observer.sun);
        for(const input of calendarInputs){
          const isDate=input.dataset.calendar==='date';
          const value=isDate?dayOfYear(observer.date):observer.date.getUTCHours()*60+observer.date.getUTCMinutes();
          if(isDate)input.max=String(daysInYear(observer.date.getUTCFullYear())-1);
          if(document.activeElement!==input)input.value=String(value);
          const label=isDate?replayDateFormat.format(observer.date):observer.date.toISOString().slice(11,16);
          this.querySelector<HTMLOutputElement>(`[data-calendar-output=${input.dataset.calendar}]`)!.value=label;
          input.setAttribute('aria-valuetext',label);
        }
        // The Moon's phase as the renderer lights it, from the scene's date.
        this.dataset.moonPhase=String(currentLunarPhase(observer.date));
        timeStatus.dateTime=observer.date.toISOString();
        if(dateStatus&&clockStatus){dateStatus.textContent=replayDateFormat.format(observer.date);clockStatus.textContent=`${observer.date.toISOString().slice(11,19)} UTC`;}
        else timeStatus.textContent=`${replayDateFormat.format(observer.date)} · ${observer.date.toISOString().slice(11,19)} UTC`;
        if(coordinateStatus)coordinateStatus.textContent=`${Math.abs(observer.latitude).toFixed(1)}° ${observer.latitude<0?'S':'N'} · ${Math.abs(observer.longitude).toFixed(1)}° ${observer.longitude<0?'W':'E'} · ${Math.round(observer.altitude)} km`;
      }
    };
    const statusTick = () => {
      clearTimeout(statusTimer);
      if(session.paused || document.hidden || runtime.lost || !this.hasAttribute('data-ready'))return;
      const sceneTime=playback.read(performance.now())+composition().offset;
      updateStatus(sceneTime);
      const milliseconds=calendar.date(sceneTime).getTime();
      const remainder=((milliseconds%1000)+1000)%1000;
      // Schedule against the next actual second, independently of rendering cadence.
      statusTimer=window.setTimeout(statusTick,Math.max(8,(1000-remainder)/session.timeScale));
    };
    const flushDraw=(now:number)=>{
      frameClock.observe(now);perfObserve(now);
      if(runtime.disposed||runtime.lost||document.hidden||(!session.paused&&this.hasAttribute('data-ready')))return;
      if(!frameDue(now))return false;
      renderFrame();
    };
    const draw=()=>{
      // Inputs only invalidate. Playback owns its regular frame; a paused or
      // loading scene coalesces all pending changes into one capped RAF draw.
      runtime.invalidate();
    };
    const renderFrame = () => {
      if(runtime.lost||!renderer)return;
      if(!('surfaceReady' in renderer.state)&&!('galaxyReady' in renderer.state))return;
      const view=composition();
      const sceneTime=playback.read(performance.now())+view.offset;
      const observer=observerAt(sceneTime);
      // Grain cells are buffer pixels: keep the settled noise per CSS area.
      const focusLook=focusRadius>0?{...look,grain:look.grain*focusGrainScale(focusRadius,focusDensity)}:look;
      // A paused view at rest has no frame rate to protect: its frames only
      // carry exposure toward inspection, so they are not timed either. Timed,
      // a busy GPU stepped the scale, and each resize's tiles restarted the
      // settle window, deferring inspection indefinitely.
      const still=standalone&&session.paused&&!frameClock.interacting(performance.now());
      const diagnosticFrameStart=diagnostic?performance.now():0;
      const result=renderer.render(observer,canvas.width,canvas.height,cssHeight,sceneTime,grainIndex,focusLook,focusRadius,session.timeScale,inspection||still);
      if(!result)return;
      diagnostic?.frame(performance.now()-diagnosticFrameStart);
      if(result.nightSwitch==='handover')holdFrame();
      else if(result.nightSwitch==='settled'){delete this.dataset.nightSwitch;settleFrame(true);}
      else if(crossfade&&!crossfade.hidden&&crossfade.dataset.fading===undefined)settleFrame(false);
      const now=performance.now();
      if(standalone){
        // The flight path marker shows where keyboard flight is heading. Dragging or
        // flinging the globe also moves the camera, but there it only drew a stray
        // marker high above Earth.
        hud?.frame(observer,!!navigation.free,navigation.orbit,now<keyFlightUntil?navigation.motion:[0,0,0]);
        this.dataset.cameraPosition=observer.camera.map(v=>v.toFixed(8)).join(',');
        this.dataset.cameraAltitude=observer.altitude.toFixed(3);
        this.dataset.cameraBasis=JSON.stringify(observer.cameraBasis);
        this.dataset.lens=(observer.focal/PROJECTION).toFixed(3);
      }
      clearTimeout(exposureTimer);
      if(exposureSceneTime!==sceneTime){exposureSceneTime=sceneTime;exposureUntil=now+EXPOSURE_SETTLE_MS;}
      if(session.paused&&!document.hidden&&now<exposureUntil){
        exposureTimer=window.setTimeout(()=>{if(!runtime.disposed&&!runtime.lost&&!document.hidden)draw();},1000/24);
      }
      this.dataset.exposure=now<exposureUntil?'adapting':'settled';
      // Loading detail refreshes exposure, but must not shrink an already
      // inspected image. Otherwise a weak GPU oscillates between two sizes,
      // repeatedly loading and discarding tiles visible only at the larger one.
      const inspect=standalone&&session.paused&&(inspection||now>=exposureUntil)&&!frameClock.interacting(now)&&focusRadius===0;
      if(inspect!==inspection){inspection=inspect;this.dataset.inspection=String(inspect);cancelAnimationFrame(qualityFrame);qualityFrame=requestAnimationFrame(resize);}
      Object.assign(this.dataset,result.state);
      if(viewSky!==null&&!inspection){
        const coverage=shellCoverage(observer.camera,observer.cameraBasis,observer.focal??PROJECTION,canvas.width/Math.max(1,canvas.height));
        this.dataset.viewCoverage=coverage.toFixed(2);
        const target=Math.min(viewScaleFor(coverage,viewSky),Math.max(1,1/qualityScale));
        if(viewScale.update(target,now,frameClock.interacting(now))){cancelAnimationFrame(qualityFrame);qualityFrame=requestAnimationFrame(resize);}
      }
      if(diagnostic){this.dataset.qualityScale=result.scale.toFixed(3);this.dataset.viewScale=viewScale.factor.toFixed(3);}
      this.dataset.renderScale=(Math.min(1,result.scale*viewScale.factor)*focusRenderScale(focusRadius,focusDensity)).toFixed(2);
      if(perf){
        perfFrames.push(now);while(perfFrames.length>1&&perfFrames[0]<now-2000)perfFrames.shift();
        if(now-perfShown>500){
          perfShown=now;
          const fps=perfFrames.length>1?(perfFrames.length-1)*1000/(now-perfFrames[0]):0;
          longFrames=longFrames.filter(entry=>entry.at>now-3000);
          const late=perfTicks.filter(tick=>tick.late).length,worst=Math.max(0,...perfTicks.map(tick=>tick.gap));
          const jank=`late refreshes ${late}/${perfTicks.length} · max gap ${worst.toFixed(0)} ms · long tasks ${longFrames.length}${longFrames.length?` (max ${Math.max(...longFrames.map(entry=>entry.ms)).toFixed(0)} ms)`:''}`;
          perf.textContent=`${fps.toFixed(1)} fps · scale ${this.dataset.renderScale}${viewSky!==null?` (×${viewScale.factor.toFixed(2)} view ${this.dataset.viewCoverage??'-'})`:''} · ${canvas.width}×${canvas.height}\n${this.dataset.renderApi??''} · clouds ${result.state.cloudReuse==='temporal'?'temporal':'full'} · terrain ${result.state.terrainBound==='regional'?'bound':'9 km'} · noise ${result.state.noise}\nstart ${this.dataset.startScale??'1.00'} · target ${frameClock.fps.toFixed(1)} fps${steadyCadence?' steady':''}\n${jank}`;
        }
      }
      if(Math.abs(result.scale-qualityScale)>.001){qualityScale=result.scale;qualitySince=now;cancelAnimationFrame(qualityFrame);qualityFrame=requestAnimationFrame(resize);}
      // Remember a size that held for ten seconds of sharp, animated frames.
      if(renderer.adaptive&&!session.paused&&!inspection&&focusRadius===0&&now-qualitySince>10000&&now-qualitySaved>10000){
        qualitySaved=now;const bounds=canvas.getBoundingClientRect();
        rememberScale(qualityScale/profile.scale,bounds.width,bounds.height,devicePixelRatio,profile.name);
      }
      if(result.terrain)this.dataset.terrainTiles=JSON.stringify(result.terrain);
      if(result.galaxy)this.dataset.galaxyTiles=JSON.stringify(result.galaxy);
      if(result.cloud)this.dataset.cloudTiles=JSON.stringify(result.cloud);
      if(result.day)this.dataset.dayTiles=JSON.stringify(result.day);
      if(result.night)this.dataset.nightTiles=JSON.stringify(result.night);
      if(session.paused||!this.hasAttribute('data-ready')||standalone)updateStatus(sceneTime,observer);
      this.dataset.starsReady='';
      if (!this.hasAttribute('data-ready')) {
        this.dataset.ready = '';
        controls.hidden = !controlsInView || !this.hasAttribute('data-ready');
        sync();
        clearTimeout(focusTimer);updateFocus();
      }
    };
    const resize = () => {
      // Bound fragment work on Retina/4K screens; retain subpixel star energy.
      const { width, height } = canvas.getBoundingClientRect();
      const nextSmall=viewport.clientHeight;
      panelController.position();
      // Restore cloud detail after a touch gesture too. A still phone frame
      // keeps the normal mobile pixel budget; only desktop inspection gets
      // the larger Retina target. Motion resumes at the adaptive scale.
      const desktopInspection=inspection&&!matchMedia('(pointer: coarse)').matches;
      focusDensity=bufferDensity(width,height,devicePixelRatio,inspection?1:bufferScale());
      const size=sceneBufferSize(width,height,devicePixelRatio,(inspection?1:bufferScale())*focusRenderScale(focusRadius,focusDensity),desktopInspection);
      const changed=canvas.width!==size.width||canvas.height!==size.height||cssHeight!==height||smallHeight!==nextSmall;
      if(changed)diagnostic?.event('buffer-resize',{from:[canvas.width,canvas.height],to:[size.width,size.height],qualityScale,viewScale:viewScale.factor,focusRadius,inspection});
      cssHeight=height;smallHeight=nextSmall;
      // Assigning even an unchanged dimension clears the drawing buffer.
      if(canvas.width!==size.width)canvas.width=size.width;
      if(canvas.height!==size.height)canvas.height=size.height;
      if(!changed)return;
      gl.viewport(0, 0, canvas.width, canvas.height);
      // Resizing clears an opaque drawing buffer. Repaint before yielding
      // to the compositor, including between normal playback ticks.
      if(!document.hidden)renderFrame();
    };
    const tick = (now: number) => {
      if (session.paused || document.hidden || runtime.lost || !this.hasAttribute('data-ready')) return;
      frameClock.observe(now);perfObserve(now);
      renderer.observeAnimationFrame(now,profile.fps/24);
      if (frameDue(now)) {
        if(headroom)renderer.setCadence(1000/frameClock.passiveRate*profile.fps/24,frameClock.refreshPeriod*profile.fps/24,true);
        if(lastAnimationDraw&&focusRadius===0)renderer.observeCadence((now-lastAnimationDraw)*profile.fps/24,now,!frameClock.interacting(now));
        lastAnimationDraw=focusRadius===0?now:0;
        grainIndex=(grainIndex+1)%65536;
        renderFrame();
      }
    };
    // Flight gestures follow display refresh (up to 60 Hz); passive playback
    // retains its 24 FPS budget. Keep the fractional deadline when paused too,
    // instead of starting a new full interval after each render finishes.
    const frameDue=(now:number)=>{
      const previous=frameClock.fps,due=frameClock.due(now);
      if(previous!==frameClock.fps)lastAnimationDraw=0;
      this.dataset.targetFps=String(frameClock.fps);
      if(diagnostic)this.dataset.refreshPeriodMs=frameClock.refreshPeriod.toFixed(3);
      return due;
    };
    const sync = () => {
      diagnostic?.resetFrames();
      clearTimeout(exposureTimer);
      frameClock.reset(performance.now());
      clearTimeout(focusTimer);
      if(renderer&&this.hasAttribute('data-ready')&&this.dataset.focus!=='sharp')updateFocus();
      runtime.stop();
      clearTimeout(statusTimer);
      playback.setRunning(!session.paused && !document.hidden && !runtime.lost && this.hasAttribute('data-ready'),performance.now());
      lastAnimationDraw=0;
      renderer?.resetCadence();
      this.toggleAttribute('data-paused',session.paused);
      updateTimeScaleLabel();
      for(const button of motionButtons){
        button.querySelector('.motion-play')?.toggleAttribute('data-hidden',!session.paused);
        button.querySelector('.motion-pause')?.toggleAttribute('data-hidden',session.paused);
        button.setAttribute('aria-label', session.paused ? 'Play' : 'Pause');
        button.title = session.paused ? 'Play' : 'Pause';
      }
      updateExplorerLink();
      if(session.paused&&!document.hidden&&!runtime.lost&&this.hasAttribute('data-ready')&&performance.now()<exposureUntil)draw();
      if (!session.paused && !document.hidden && !runtime.lost && this.hasAttribute('data-ready')) {
        statusTick();
        runtime.animate();
      }
    };
    const scroll = () => {
      // Animated frames already read scroll position. A paused scene still
      // follows the page's orbital offset without advancing the playback clock
      // or the grain seed.
      if(!scrollComposition || !session.paused || document.hidden || scrollTimer) return;
      scrollTimer=window.setTimeout(()=>{
        scrollTimer=0;
        if(!runtime.disposed && session.paused && !document.hidden)draw();
      },1000/24);
    };
    // The link follows: paused, it reopens on this frame (motion=0 and its t);
    // playing, it plays on from here.
    const toggle = () => {
      session.toggle();
      sync();
      const url=new URL(pendingURL??location.href);
      url.searchParams.set('t',playback.read(performance.now()).toFixed(2));
      writePlaybackSettings(url.searchParams,session.paused);
      updateURL(url);
      // The frame and clock on screen are the ones the link names, not the last drawn.
      if(session.paused){draw();lastStatus=-1;updateStatus(playback.read(performance.now())+composition().offset);}
    };
    const playbackKey = (event:KeyboardEvent) => {
      if(this.dataset.composition!=='explorer'||event.code!=='Space'||event.repeat||event.defaultPrevented
        ||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey)return;
      const target=event.target;
      if(target instanceof Element&&target.closest('input,textarea,select,button,a,[contenteditable]:not([contenteditable="false"]),[role="slider"]'))return;
      event.preventDefault();toggle();
      hud?.key('Space',true);window.setTimeout(()=>hud?.key('Space',false),120);
    };
    const seek = () => {
      const offset=composition().offset;
      const now=performance.now();
      const duration=period(),cycle = Math.floor((playback.read(now)+offset)/duration);
      const elapsed = (cycle+Math.min(.99999,Number(orbitInput.value)/100))*duration-offset;
      playback.seek(elapsed,now);
      paintRange(orbitInput);
      lastStatus = -1;
      draw();
      const url = new URL(pendingURL??location.href);
      url.searchParams.set('t',elapsed.toFixed(2));
      writePlaybackSettings(url.searchParams,session.paused);
      updateURL(url);
    };
    // Settings, HUD and keyboard all enter the same playback command.
    const setTimeSliderPosition=(position:number)=>{
      const changed=session.setTimeSliderPosition(position,performance.now());
      if(changed){
        sync();
        const url=new URL(pendingURL??location.href);
        url.searchParams.set('t',playback.read(performance.now()).toFixed(2));
        writePlaybackSettings(url.searchParams,session.paused);updateURL(url);
        if(session.paused){draw();lastStatus=-1;updateStatus(playback.read(performance.now())+composition().offset);}
      }else updateTimeScaleLabel();
      statusTick();
    };
    const changeTimeScale=()=>setTimeSliderPosition(Number(timeSliderInput.value));
    const updateViewLabels=()=>{
      for(const input of viewInputs){
        const key=input.dataset.view as keyof typeof cameraView;
        const value=Math.round(cameraView[key]);
        const label=key==='yaw' ? (Math.abs(value)===180?'Back':value===0?'Forward':`${Math.abs(value)}° ${value<0?'left':'right'}`)
          :value===0?'Default':`${Math.abs(value)}° ${value<0?'down':'up'}`;
        this.querySelector<HTMLOutputElement>(`[data-view-output="${key}"]`)!.value=label;
        input.setAttribute('aria-valuetext',label);
        paintRange(input);
      }
      this.dataset.cameraYaw=String(cameraView.yaw);
      this.dataset.cameraPitch=String(cameraView.pitch);
    };
    const changeView=()=>{
      if(standalone&&navigation.free)return;
      const url=new URL(pendingURL??location.href);
      for(const input of viewInputs)session.setView(input.dataset.view as keyof typeof cameraView,Number(input.value));
      writeViewSettings(url.searchParams,cameraView);
      updateURL(url);
      updateViewLabels();
      updateExplorerLink();
      if(standalone&&navigation.free)saveNavigation();
      exposureUntil=performance.now()+EXPOSURE_SETTLE_MS;
      draw();
    };
    updateViewLabels();
    const saveNavigation=()=>{
      clearTimeout(navigationURLTimer);navigationURLTimer=0;
      const url=new URL(pendingURL??location.href);
      navigation.write(url.searchParams);
      url.searchParams.set('t',(playback.read(performance.now())+composition().offset).toFixed(2));
      writeViewSettings(url.searchParams,cameraView,!!navigation.free);
      writeLensSetting(url.searchParams,navigation.focal/PROJECTION);
      writePlaybackSettings(url.searchParams,session.paused);
      updateURL(url);
    };
    const enterFree=()=>{
      if(!navigation.free){
        const pose=currentObserver();
        navigation.detach(pose,cameraView);
        viewInputs.forEach(input=>input.value=String(cameraView[input.dataset.view as keyof typeof cameraView]));updateViewLabels();
      }
      updateNavigationUI();
      lastStatus=-1;saveNavigation();
    };
    const followOrbit=(orbit:Orbit)=>{
      const from=currentObserver();
      navigation.follow(orbit,from,performance.now(),!matchMedia('(prefers-reduced-motion: reduce)').matches);
      cameraView.yaw=0;cameraView.pitch=0;
      viewInputs.forEach(input=>input.value='0');updateViewLabels();updateNavigationUI();
      lastStatus=-1;saveNavigation();flightControls?.request();
      exposureUntil=performance.now()+EXPOSURE_SETTLE_MS;draw();
    };
    const calendarChanged=()=>{
      if(!propertiesPanel.hidden)updatePropertiesDate(calendar.date(playback.read(performance.now())+composition().offset));
      lastStatus=-1;exposureUntil=performance.now()+EXPOSURE_SETTLE_MS;
      saveNavigation();updateExplorerLink();draw();statusTick();
    };
    const changeCalendar=(event:Event)=>{
      const input=event.currentTarget as HTMLInputElement,seconds=playback.read(performance.now())+composition().offset;
      session.setCalendar(input.dataset.calendar as 'date'|'time',Number(input.value),seconds);
      calendarChanged();
    };
    const applyLook = () => {
      Object.assign(look,session.look);
      exposureMode.value=settings.exposureMode;fixedExposure.value=String(settings.fixedExposure);lensPreset.value=settings.lensPreset;
      for(const input of lookInputs){
        const key=input.dataset.look as keyof typeof lookBase;
        input.value=String(settings.look[key]);
        const value=key==='exposure'?`${look.exposure>0?'+':''}${look.exposure.toFixed(1)} EV`:`${Math.round(Number(input.value)*100)}%`;
        this.querySelector<HTMLOutputElement>(`[data-output="${key}"]`)!.value=value;
        input.setAttribute('aria-valuetext',value);
        paintRange(input);
      }
      const exposureInput=lookInputs.find(input=>input.dataset.look==='exposure')!;
      const manual=settings.exposureMode==='manual';
      this.querySelector<HTMLElement>('[data-manual-setting]')!.hidden=!manual;
      exposureInput.closest<HTMLElement>('.setting')!.hidden=manual;
      const fixedLabel=`${Number(fixedExposure.value)>0?'+':''}${Number(fixedExposure.value).toFixed(1)} EV`;
      this.querySelector<HTMLOutputElement>('[data-fixed-output]')!.value=fixedLabel;
      fixedExposure.setAttribute('aria-valuetext',fixedLabel);paintRange(fixedExposure);
      exposureUntil=performance.now()+EXPOSURE_SETTLE_MS;
      draw();
    };
    const saveLook=()=>{
      applyLook();
      const url=new URL(pendingURL??location.href);writeLookSettings(url.searchParams,settings);updateURL(url);
    };
    const changeLook=(event:Event)=>{
      const input=event.currentTarget as HTMLInputElement|HTMLSelectElement;
      if(input.dataset.look)session.setLook(input.dataset.look as LookControl,Number(input.value));
      else if(input===fixedExposure)session.setFixedExposure(Number(input.value));
      else if(input===exposureMode)settings.exposureMode=exposureMode.value==='manual'?'manual':'auto';
      else if(input===lensPreset)settings.lensPreset=lensPreset.value==='flare'?'flare':'iss';
      saveLook();
    };
    const restoreAll = () => {
      const resetAurora=settings.aurora!=='auto';
      const cloudDefaults=new URLSearchParams(location.search);cloudDefaults.delete('clouds');
      const resetClouds=settings.clouds!==readCloudMode(cloudDefaults);
      cloudsMode.value=readCloudMode(cloudDefaults);
      auroraMode.value='auto';
      const now=performance.now();
      session.reset(new URLSearchParams(location.search),now,composition().offset);
      timeSliderInput.value=String(session.timeSliderPosition);
      lensGoal=null;flightControls?.cancel();updateNavigationUI();
      lastStatus=-1;
      viewInputs.forEach(input=>{input.value=String(cameraView[input.dataset.view as keyof typeof cameraView]);});
      const url=new URL(pendingURL??location.href);
      resetExplorerSettingsURL(url.searchParams);
      updateURL(url);
      updateTimeScaleLabel();updateViewLabels();
      exposureUntil=now+EXPOSURE_SETTLE_MS;
      saveLook();
      if(resetAurora||resetClouds){reloadScene();return;}
      sync();
    };
    const resetValueButtons=[...this.querySelectorAll<HTMLButtonElement>('.reset-value')];
    const restoreValue=(event:Event)=>{
      const input=(event.currentTarget as HTMLElement).closest('.setting')!.querySelector<HTMLInputElement>('input')!;
      if(input.dataset.calendar){
        const seconds=playback.read(performance.now())+composition().offset,date=calendar.date(seconds),now=new Date();
        const milliseconds=input.dataset.calendar==='date'?utcDay(now)+(date.getTime()-utcDay(date)):utcDay(date)+(now.getTime()-utcDay(now));
        calendar.set(new Date(milliseconds),seconds);calendarChanged();
      }else if(input===orbitInput){
        playback.seek(initialSceneSeconds(new URLSearchParams())-composition().offset,performance.now());
        const url=new URL(pendingURL??location.href);url.searchParams.delete('t');url.searchParams.delete('still');updateURL(url);
        lastStatus=-1;draw();
      }else{
        input.value=input.defaultValue;
        input.dispatchEvent(new Event('input'));
      }
    };
    resetValueButtons.forEach(button=>button.addEventListener('click',restoreValue));
    try {renderer=createSceneRenderer(gl,canvas,params,()=>{
      if(runtime.disposed||runtime.lost)return;
      exposureUntil=performance.now()+EXPOSURE_SETTLE_MS;
      Object.assign(this.dataset,renderer.state);
      diagnostic?.state(renderer.state);
      // No frame will come: shaders failed on this GPU, or every first-light
      // asset failed. A failed refinement keeps the preview and is not this.
      if(!this.hasAttribute('data-ready')&&(renderer.state.shaderStartup==='failed'||renderer.state.firstLight==='failed'))this.dataset.unavailable='';
      if(session.paused||!this.hasAttribute('data-ready'))draw();
    },{assetBaseURL:this.dataset.assetBase,terrainBaseURL:this.dataset.terrainBase});}
    catch(error){console.warn('The scene is unavailable.',error);this.dataset.unavailable='';return;}
    // Restoring controls must not turn a fresh visit into a dated replay URL.
    applyLook();
    const dragSurface=this.dataset.composition==='explorer'?this.closest<HTMLElement>('.explorer-view'):null;
    // Throttled rather than debounced, so a long glide keeps its link current.
    // A device with headroom renders gestures and their coast at up to 60 FPS;
    // the steady clock slows that while frames come late. Loading can cost a
    // desktop a few scale steps, so steady mode asks only for 0.75; a phone at
    // its floor keeps its passive cadence (swipeFps=24 does so on the old timer).
    const interactionFPS=()=>qualityScale>=(steadyCadence?.75:.9)?60:steadyCadence||params.get('swipeFps')==='24'?profile.fps:30;
    const cameraChanged=()=>{const now=performance.now();frameClock.interact(now,interactionFPS());lastStatus=-1;exposureUntil=now+EXPOSURE_SETTLE_MS;draw();if(!navigationURLTimer)navigationURLTimer=window.setTimeout(()=>{navigationURLTimer=0;saveNavigation();},180);};
    const lookCamera=(view:typeof cameraView)=>{
      for(const input of viewInputs)input.value=String(view[input.dataset.view as keyof typeof view]);
      Object.assign(cameraView,view);updateViewLabels();updateExplorerLink();cameraChanged();saveNavigation();
    };
    const ready=()=>!runtime.lost&&this.hasAttribute('data-ready');
    const reducedMotion=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
    // The lens magnifies about a screen point and never moves the camera: free
    // flight re-aims the rig, a followed orbit re-aims its yaw and pitch.
    let lensGoal:{log:number;x:number;y:number}|null=null;
    const lensZoom=()=>navigation.focal/PROJECTION;
    const applyLens=(zoom:number,x=0,y=0)=>{
      const from=navigation.focal,to=PROJECTION*Math.max(LENS_MIN,Math.min(LENS_MAX,zoom));
      if(Math.abs(to-from)<1e-9)return;
      const view=navigation.free||(!x&&!y)?null:followLens(currentObserver(),cameraView,x,y,from,to);
      navigation.setLens(to,x,y);
      if(view)lookCamera(view);else cameraChanged();
    };
    const zoomLens=(log:number,x:number,y:number,smooth:boolean)=>{
      if(!standalone||!log)return;
      if(!smooth){lensGoal=null;applyLens(lensZoom()*Math.exp(log),x,y);return;}
      // Queue eased steps, clamped so a burst past either end leaves nothing pending.
      const current=Math.log(lensZoom()),queued=lensGoal?.log??0;
      lensGoal={log:Math.max(Math.log(LENS_MIN),Math.min(Math.log(LENS_MAX),current+queued+log))-current,x,y};
      flightControls?.request();
    };
    const lensTo=(zoom:number,animate=true)=>{
      if(!ready())return;
      if(animate&&!reducedMotion()){lensGoal={log:Math.log(Math.max(LENS_MIN,Math.min(LENS_MAX,zoom))/lensZoom()),x:0,y:0};flightControls?.request();}
      else{lensGoal=null;applyLens(zoom);}
    };
    // Z and X zoom about the centre, about ×2 per second; Shift is faster.
    const stepLens=(dt:number,input:FlightInput)=>{
      if(input.lens){lensGoal=null;applyLens(lensZoom()*2**(input.lens*(input.fast?2.5:1)*dt));return;}
      if(!lensGoal)return;
      const goal=lensGoal,part=Math.abs(goal.log)<1e-3?goal.log:goal.log*(1-Math.exp(-dt/.09));
      goal.log-=part;if(goal.log===0)lensGoal=null;
      applyLens(lensZoom()*Math.exp(part),goal.x,goal.y);
    };
    const settleLens=()=>{const goal=lensGoal;lensGoal=null;if(goal)applyLens(lensZoom()*Math.exp(goal.log),goal.x,goal.y);};
    const camera=createCameraController({canvas,navigation,frame:currentObserver,ready,detach:enterFree,
      followLook:(dx,dy)=>lookCamera(draggedCamera(cameraView.yaw,cameraView.pitch,dx,dy,canvas.getBoundingClientRect().height,navigation.focal)),
      lens:zoomLens,
      changed:cameraChanged,request:()=>flightControls?.request(),
      // Earth takes the ground pin with its ripples; the sky keeps the flat pulse.
      marked:(x,y,anchor)=>anchor?hud?.drop(anchor):hud?.pulse(x,y),pin:anchor=>hud?.pin(anchor),reducedMotion});
    // While following an orbit, arrows turn the head and any other flight key
    // starts free flight from the current pose.
    const followKeys=(dt:number,input:FlightInput)=>{
      if(input.forward||input.right||input.climb||input.roll){enterFree();return;}
      if(!input.yaw&&!input.pitch)return;
      const rate=60*(input.fast?2.5:1)*dt/lensZoom();
      lookCamera({yaw:((cameraView.yaw+input.yaw*rate+180)%360+360)%360-180,pitch:Math.max(-90,Math.min(90,cameraView.pitch+input.pitch*rate))});
    };
    // A followed orbit's look-around eases to a new view rather than jumping.
    let lookTween=0;
    const tweenLook=(to:typeof cameraView)=>{
      cancelAnimationFrame(lookTween);
      if(reducedMotion()){lookCamera(to);return;}
      const from={...cameraView},turn=((to.yaw-from.yaw)%360+540)%360-180,start=performance.now();
      const step=(now:number)=>{
        const t=Math.min(1,(now-start)/450),e=t*t*(3-2*t),yaw=from.yaw+turn*e;
        lookCamera({yaw:((yaw+540)%360)-180,pitch:from.pitch+(to.pitch-from.pitch)*e});
        if(t<1)lookTween=requestAnimationFrame(step);
      };
      lookTween=requestAnimationFrame(step);
    };
    // Turn to a world direction, Earth's centre or the Sun. A followed orbit
    // re-aims its look-around and keeps following; past its reach (the high
    // orbit cannot look above its horizon), or in free flight, the camera turns.
    const face=(target:()=>Vec3)=>{
      if(!ready())return;
      if(!navigation.free){
        const now=performance.now(),base=navigation.read(playback.read(now)+composition().offset,{yaw:0,pitch:0},now);
        // The basis, not the ISS frame's own right and forward, which are inertial.
        const b=base.cameraBasis,up=normalize([...base.camera] as Vec3),side=[b[0],b[1],b[2]] as Vec3,along=cross(up,side),d=target();
        const elevation=Math.asin(Math.max(-1,Math.min(1,dot([b[6],b[7],b[8]],up))));
        const yaw=Math.atan2(dot(d,side),dot(d,along))*180/Math.PI,pitch=(Math.asin(Math.max(-1,Math.min(1,dot(d,up))))-elevation)*180/Math.PI;
        // Straight down or up, yaw means nothing; keep the current one.
        const vertical=Math.abs(dot(d,up))>.9999;
        if(Math.abs(pitch)<=90){tweenLook({yaw:vertical?cameraView.yaw:yaw,pitch});return;}
      }
      enterFree();navigation.face(target,reducedMotion());cameraChanged();flightControls?.request();
    };
    // Mouse or trackpad: detected from the wheel until chosen with M or T, the
    // buttons over Help or Settings; M, T or a button again goes back to Auto.
    const inputDeviceSelect=this.querySelector<HTMLSelectElement>('#explorer-input-device');
    const inputDevice=createInputDevice((device,preference)=>{
      hud?.setDevice(device,preference);
      if(inputDeviceSelect){
        inputDeviceSelect.value=preference;
        const auto=inputDeviceSelect.querySelector<HTMLOptionElement>('option[value="auto"]');
        if(auto)auto.textContent=`Auto (${inputDevice.detected})`;
      }
    });
    const chooseInputDevice=()=>inputDevice.choose(inputDeviceSelect!.value as InputDevicePreference);
    const command=(name:FlightCommand)=>{
      if(name==='mouse'||name==='trackpad'){inputDevice.toggle(name);return;}
      if(!ready())return;
      if(name==='help')hud?.toggleHelp();
      else if(name==='info')hud?.toggleInfo();
      // A followed orbit first drops its look-around; once facing ahead, H flies free to turn over.
      else if(name==='level'){
        if(!navigation.free&&(cameraView.yaw||cameraView.pitch))lookCamera({yaw:0,pitch:0});
        else{enterFree();navigation.level(reducedMotion());cameraChanged();flightControls?.request();}
      }
      // \ and the gauge's dial bring back the horizon: a followed orbit drops
      // its look-around; free flight levels and looks out along its heading as
      // an orbit at this height would (Earth's arc on the gauge faces it instead).
      else if(name==='reset-camera'){
        if(!navigation.free)tweenLook({yaw:0,pitch:0});
        else{navigation.horizon(reducedMotion());cameraChanged();flightControls?.request();}
      }
      // 0 takes the lens back to 1×.
      else if(name==='reset-lens')lensTo(1);
      // N switches physical night in place: the next mode compiles while
      // this one keeps drawing (switchNight below).
      else if(name==='night')switchNight();
      else if(name==='free'){enterFree();draw();}
      else followOrbit(name.slice(6) as Orbit);
    };
    if(dragSurface)flightControls=createFlightControls(dragSurface,{
      enabled:ready,inputSmoothing,
      step:(dt,input)=>{
        // The marker shows where WASD flight heads. R and F only climb or
        // descend, straight up or down, where it only marked the ground below.
        if(input.forward||input.right)keyFlightUntil=performance.now()+1500;
        else if(input.climb)keyFlightUntil=0;
        if(!ready())return false;
        stepLens(dt,input);
        if(!navigation.free)followKeys(dt,input);
        if(navigation.free?navigation.step(dt,input):navigation.moving)cameraChanged();
        return navigation.moving||lensGoal!==null;
      },
      zoom:(log,x,y,smooth)=>camera.zoom(log,x,y,smooth),
      lens:(log,x,y,smooth)=>camera.lens(log,x,y,smooth),
      roll:angle=>camera.roll(angle),
      scroll:(x,y,intent)=>camera.scroll(x,y,intent),
      command,
      key:(code,down)=>hud?.key(code,down),
      device:device=>inputDevice.detect(device),forced:inputDevice.forced,
      action:action=>{
        if(action&&ready())dragSurface.dataset.cameraAction=action;
        else delete dragSurface.dataset.cameraAction;
      },
      touching:()=>!!touch?.active,
      stop:()=>{navigation.stop();settleLens();},
    });
    const disposeCameraDrag=dragSurface?createCameraDrag(dragSurface,camera,(x,y,intent)=>{
      if(x===null||!ready()){delete dragSurface.dataset.cursor;flightControls?.clearAction();return;}
      // A plain drag moves over Earth wherever it starts, so the cursor is Earth's.
      const kind=intent==='auto'?'fly':intent;
      if(dragSurface.dataset.cursor!==kind)flightControls?.clearAction();
      dragSurface.dataset.cursor=kind;
    },()=>inputDevice.device==='trackpad'):()=>{};
    const touchSurface=dragSurface?.querySelector<HTMLElement>('.explorer-gestures');
    const touch=touchSurface?createTouchCamera(touchSurface,camera,()=>hud?.setModality('touch'),touchGain,touchSpin):null;
    const calendarSet=(kind:'date'|'time',value:number)=>{
      session.setCalendar(kind,value,playback.read(performance.now())+composition().offset);calendarChanged();
    };
    hud=standalone?createFlightHud(this,{
      orbit:orbit=>{if(ready())followOrbit(orbit);},
      free:()=>{if(ready()){enterFree();draw();}},
      altitude:km=>{if(!ready())return;enterFree();navigation.setAltitude(km);flightControls?.request();},
      current:()=>currentObserver().altitude,
      lens:lensTo,
      lensZoom,
      hold:(code,down)=>flightControls?.hold(code,down),
      resetCamera:()=>command('reset-camera'),
      // A first click brings back the horizon, as \ does; once there, upright
      // or turned over, each click flips the view clockwise, as H does.
      dial:()=>command((navigation.free?navigation.atHorizon():!cameraView.yaw&&!cameraView.pitch)?'level':'reset-camera'),
      night:()=>command('night'),nightOn:settings.night!=='current',
      faceEarth:()=>face(()=>normalize(currentObserver().camera.map(v=>-v) as Vec3)),
      faceSun:()=>face(()=>normalize([...currentObserver().sun] as Vec3)),
      faceMoon:()=>face(()=>{const f=currentObserver();return normalize(celestialFrame(f.date,f.camera as Vec3).moon.slice(0,3) as Vec3);}),
      exposure:()=>settings.exposureMode==='manual'?null:settings.look.exposure,
      setExposure:ev=>{session.setLook('exposure',ev);saveLook();},
      // The top tapes submit the same commands as Settings.
      setDay:day=>calendarSet('date',day),setMinute:minute=>calendarSet('time',minute),
      timeScale:()=>session.paused?0:session.timeScale,
      setTimeScale:target=>setTimeSliderPosition(session.sliderPositionForTimeScale(target)),
      stepTimeScale:notches=>setTimeSliderPosition(session.timeSliderPosition+notches*10),
      device:device=>inputDevice.toggle(device),
    }):null;
    inputDevice.notify();
    // Night switch. The key latches at once; the address, the manual
    // exposure range and the link follow when the new mode draws. The last
    // frame of the old mode stays over the canvas until the new camera has
    // metered, then dissolves into it: no reload, poster or black frame.
    let nightTarget:NightMode|null=null;
    // The new mode's first frames are submitted at once, but on a cold GPU
    // cache their pipelines take seconds to build, and that stall reaches
    // this thread a few frames later. Dissolve only after the meter has
    // settled and frames have kept their pace for a while (or after 4 s).
    const NIGHT_STEADY_FRAMES=6;
    let steadyFrames=0,steadySince=0,lastHeldFrame=0;
    const settleFrame=(settled:boolean)=>{
      const now=performance.now(),gap=now-lastHeldFrame;lastHeldFrame=now;
      if(settled){steadyFrames=NIGHT_STEADY_FRAMES;steadySince=now;return;}
      if(!steadyFrames)return;
      steadyFrames=gap>200?NIGHT_STEADY_FRAMES:steadyFrames-1;
      if(!steadyFrames||now-steadySince>4000){steadyFrames=0;releaseFrame();}
    };
    const holdFrame=()=>{
      if(!heldFrame)return;
      heldFrame.hold(canvas);steadyFrames=0;
      // A paused view draws the new mode's first frames itself.
      draw();
    };
    const releaseFrame=()=>heldFrame?.release(matchMedia('(prefers-reduced-motion: reduce)').matches);
    const switchNight=()=>{
      const next:NightMode=(nightTarget??settings.night)==='current'?'video':'current';
      nightTarget=next;hud?.setNight(next!=='current');
      this.dataset.nightTarget=next;
      exposureUntil=performance.now()+EXPOSURE_SETTLE_MS;
      // The switch starts once the latched key has painted: building the next
      // mode's programs can hold this thread, and the press must show at once.
      requestAnimationFrame(()=>requestAnimationFrame(()=>{
        if(nightTarget!==next||runtime.disposed)return;
        void renderer.switchNight(next).then(swapped=>{
          if(nightTarget!==next||runtime.disposed)return;
          nightTarget=null;delete this.dataset.nightTarget;
          // Nothing to dissolve into: superseded, failed, or already in this mode.
          if(!swapped||next===settings.night){hud?.setNight(settings.night!=='current');releaseFrame();delete this.dataset.nightSwitch;return;}
          session.setNight(next);this.dataset.nightMode=next;
          const url=new URL(pendingURL??location.href);
          if(next==='current')url.searchParams.delete('night');else url.searchParams.set('night',next);
          updateURL(url);
          fixedRange();
          applyLook();updateExplorerLink();
        });
      }));
    };
    const panelController=createScenePanels(this,controls,settingsToggle);
    const comparison=this.querySelector<HTMLElement>('.scene-comparison')!;
    const profileSelect=comparison.querySelector<HTMLSelectElement>('select')!;
    profileSelect.value=profile.name;
    comparison.querySelector('p')!.textContent=profile.description;
    comparison.hidden=!params.has('compare');
    const reloadScene=(url=new URL(pendingURL??location.href))=>{
      url.searchParams.set('t',playback.read(performance.now()).toFixed(4));
      calendar.write(url.searchParams);
      if(standalone)navigation.write(url.searchParams);
      writePlaybackSettings(url.searchParams,session.paused);
      writeLookSettings(url.searchParams,settings);
      writeTimeSliderSetting(url.searchParams,session.timeSliderPosition);
      writeViewSettings(url.searchParams,cameraView,!!navigation.free);
      if(standalone)writeLensSetting(url.searchParams,navigation.focal/PROJECTION);
      location.assign(url);
    };
    const changeProfile=()=>{
      const url=new URL(pendingURL??location.href);
      url.searchParams.set('render',profileSelect.value);
      url.searchParams.set('compare','1');
      reloadScene(url);
    };
    const modisPanel=this.querySelector<HTMLElement>('.modis-study')!;
    const modisMode=modisPanel.querySelector<HTMLSelectElement>('select')!;
    modisPanel.hidden=!['photo','modis'].includes(params.get('cloudStudy')??'');
    modisMode.value=params.get('cloudStudy')??'modis';
    for(const link of modisPanel.querySelectorAll<HTMLAnchorElement>('[data-modis-view]')){
      link.href=modisStudyURL(location.href,link.dataset.modisView as 'day'|'low'|'oblique',modisMode.value).href;
    }
    const changeModis=()=>{
      const url=new URL(pendingURL??location.href);url.searchParams.set('cloudStudy',modisMode.value);
      reloadScene(url);
    };
    modisMode.addEventListener('change',changeModis);
    // Measured clouds (cloudStudy=global) against the calibrated plates.
    const propertiesPanel=this.querySelector<HTMLElement>('.cloud-properties-study')!;
    const propertiesMode=propertiesPanel.querySelector<HTMLSelectElement>('select')!;
    propertiesPanel.hidden=!['global','plates'].includes(params.get('cloudStudy')??'');
    propertiesMode.value=params.get('cloudStudy')==='plates'?'plates':'global';
    const propertiesStudy=(url:URL,mode:string)=>{
      url.searchParams.set('cloudStudy',mode);
      if(mode==='plates')url.searchParams.set('clouds','calibrated');else url.searchParams.delete('clouds');
      return url;
    };
    for(const link of propertiesPanel.querySelectorAll<HTMLAnchorElement>('[data-cloud-properties-view]'))
      link.href=propertiesStudy(cloudPropertiesURL(location.href,link.dataset.cloudPropertiesView as CloudPropertiesView),propertiesMode.value).href;
    const qualityLink=propertiesPanel.querySelector<HTMLAnchorElement>('[data-cloud-properties-quality]')!;
    const quality=new URL(location.href);
    if(params.get('cloudStudyView')==='quality')quality.searchParams.delete('cloudStudyView');else propertiesStudy(quality,'global').searchParams.set('cloudStudyView','quality');
    qualityLink.href=quality.href;qualityLink.textContent=params.get('cloudStudyView')==='quality'?'Без диагностики':'Диагностика';
    // The renderer draws the measured day it chose at load; a calendar change
    // to another day keeps that sky and says so.
    const cloudDay=cloudPropertiesDate(params);
    const dayLabel=(day:string)=>new Date(day+'T12:00:00Z').toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).replace(/\s*г\.$/,'');
    const propertiesDate=propertiesPanel.querySelector<HTMLElement>('[data-cloud-properties-date]')!;
    const updatePropertiesDate=(scene:Date)=>{
      const now=cloudPropertiesDay(scene);
      propertiesDate.textContent=dayLabel(cloudDay.date)+(now.measured&&now.date===cloudDay.date?'':now.measured?' · дата сцены изменилась, перезагрузите':' · на дату сцены данных нет');
    };
    updatePropertiesDate(calendar.date(initialSeconds));
    propertiesPanel.querySelector<HTMLAnchorElement>('[data-cloud-properties-manifest]')!.href=assetURL(cloudPropertiesPath(cloudDay.date)+'/manifest.json',this.dataset.assetBase);
    const changeProperties=()=>reloadScene(propertiesStudy(new URL(pendingURL??location.href),propertiesMode.value));
    propertiesMode.addEventListener('change',changeProperties);
    const cloudShapeSelect=comparison.querySelector<HTMLSelectElement>('#cloud-shape')!;
    cloudShapeSelect.value=params.get('cloudShape')==='texture'?'texture':'current';
    const changeCloudShape=()=>{
      const url=new URL(pendingURL??location.href);
      if(cloudShapeSelect.value==='texture')url.searchParams.set('cloudShape','texture');
      else url.searchParams.delete('cloudShape');
      url.searchParams.set('compare','1');
      reloadScene(url);
    };
    const changeAurora=()=>{
      const url=new URL(pendingURL??location.href);
      settings.aurora=auroraMode.value as typeof settings.aurora;
      if(settings.aurora==='auto')url.searchParams.delete('aurora');
      else url.searchParams.set('aurora',settings.aurora==='on'?'1':'0');
      reloadScene(url);
    };
    const changeClouds=()=>{
      const url=new URL(pendingURL??location.href);
      settings.clouds=cloudsMode.value as typeof settings.clouds;
      url.searchParams.set('clouds',settings.clouds);
      reloadScene(url);
    };
    auroraMode.addEventListener('change',changeAurora);
    cloudsMode.addEventListener('change',changeClouds);
    inputDeviceSelect?.addEventListener('change',chooseInputDevice);
    profileSelect.addEventListener('change',changeProfile);
    cloudShapeSelect.addEventListener('change',changeCloudShape);
    calendarInputs.forEach(input=>input.addEventListener('input',changeCalendar));
    explorerLink?.addEventListener('pointerdown',prepareExplorerLink);
    explorerLink?.addEventListener('click',prepareExplorerLink);
    explorerLink?.addEventListener('focus',prepareExplorerLink);
    lookInputs.forEach(input=>input.addEventListener('input',changeLook));
    exposureMode.addEventListener('change',changeLook);fixedExposure.addEventListener('input',changeLook);lensPreset.addEventListener('change',changeLook);
    resetAll.addEventListener('click',restoreAll);
    viewInputs.forEach(input=>input.addEventListener('input',changeView));
    const contextLost = () => {
      flightControls?.cancel();
      clearTimeout(exposureTimer);
      clearTimeout(focusTimer);
      renderer.contextLost();
      delete this.dataset.terrainReady;
      delete this.dataset.galaxyReady;
      delete this.dataset.starsReady;
      delete this.dataset.surfaceReady;
      delete this.dataset.modisReady;
      delete this.dataset.ready;
      controls.hidden = true;
      panelController.close();
      sync();
    };
    runtime.connect({
      canvas,resizeTargets:[canvas,viewport],resize,sync,contextLost,
      contextRestored:()=>{
        const pending=renderer.contextRestored();Object.assign(this.dataset,renderer.state);return pending;
      },
      restored:ready=>{
        Object.assign(this.dataset,renderer.state);
        if(ready){resize();controls.hidden=!controlsInView||!this.hasAttribute('data-ready');sync();}
      },
    });
    // The transparent page keeps the sky visible below the introduction;
    // only its controls hide when the introduction leaves the viewport.
    const hero = document.querySelector('.hero');
    const visibility = new IntersectionObserver(entries => {
      controlsInView = entries[0].isIntersecting;
      controls.hidden = !controlsInView || runtime.lost || !this.hasAttribute('data-ready');
      if(controls.hidden)panelController.close();
    });
    if (hero) visibility.observe(hero);
    motionButtons.forEach(button=>button.addEventListener('click', toggle));
    window.addEventListener('keydown',playbackKey);
    timeSliderInput.addEventListener('input', changeTimeScale);
    orbitInput.addEventListener('input', seek);
    if(scrollComposition)window.addEventListener('scroll',scroll,{passive:true});
    if(standalone&&params.get('startScale')!=='fresh'&&params.get('quality')!=='fixed'){
      const bounds=canvas.getBoundingClientRect(),remembered=rememberedScale(bounds.width,bounds.height,devicePixelRatio,profile.name);
      if(remembered!==null){qualityScale=profile.scale*remembered;renderer.seedScale(remembered);this.dataset.startScale=remembered.toFixed(2);}
    }
    resize();
    controls.hidden = true;
    sync();
    renderer.load();
    const cancelDiagnosticTest=()=>{
      if(diagnosticStarted===null)return;
      diagnosticStarted=null;session.settings.paused=diagnosticPaused;playback.seek(diagnosticSeconds,performance.now());sync();draw();
      window.dispatchEvent(new CustomEvent('earthlight-diagnostic-phase',{detail:'free'}));
    };
    if(diagnostic){
      diagnostic.cancelTest=cancelDiagnosticTest;
      diagnostic.test=()=>{
        if(!this.hasAttribute('data-ready')||diagnosticStarted!==null)return false;
        diagnosticPaused=session.paused;diagnosticSeconds=playback.read(performance.now());diagnosticStarted=performance.now();diagnosticPhase='';
        session.settings.paused=false;sync();draw();return true;
      };
    }
    const interruptDiagnostic=(event:Event)=>{if(!(event.target as Element)?.closest?.('.earthlight-diagnostics'))cancelDiagnosticTest();};
    if(diagnostic)for(const name of ['pointerdown','keydown','wheel'])window.addEventListener(name,interruptDiagnostic,{capture:true});
    this.cleanup = () => {
      cancelDiagnosticTest();
      if(diagnostic){diagnostic.test=undefined;diagnostic.cancelTest=undefined;for(const name of ['pointerdown','keydown','wheel'])window.removeEventListener(name,interruptDiagnostic,true);}

      flightControls?.dispose();clearTimeout(navigationURLTimer);
      calendarInputs.forEach(input=>input.removeEventListener('input',changeCalendar));
      disposeCameraDrag();
      touch?.dispose();
      hud?.dispose();
      runtime.dispose();heldFrame?.dispose();
      perfObserver?.disconnect();perf?.remove();
      clearTimeout(exposureTimer);
      clearTimeout(scrollTimer);
      clearTimeout(statusTimer);
      clearTimeout(focusTimer);
      cancelAnimationFrame(qualityFrame);
      cancelAnimationFrame(urlUpdateFrame);
      visibility.disconnect();
      motionButtons.forEach(button=>button.removeEventListener('click', toggle));
      window.removeEventListener('keydown',playbackKey);
      panelController.close();
      explorerLink?.removeEventListener('pointerdown',prepareExplorerLink);
      explorerLink?.removeEventListener('click',prepareExplorerLink);
      explorerLink?.removeEventListener('focus',prepareExplorerLink);
      panelController.dispose();
      profileSelect.removeEventListener('change',changeProfile);
      cloudShapeSelect.removeEventListener('change',changeCloudShape);
      modisMode.removeEventListener('change',changeModis);
      propertiesMode.removeEventListener('change',changeProperties);
      lookInputs.forEach(input=>input.removeEventListener('input',changeLook));
      exposureMode.removeEventListener('change',changeLook);fixedExposure.removeEventListener('input',changeLook);lensPreset.removeEventListener('change',changeLook);
      auroraMode.removeEventListener('change',changeAurora);
      cloudsMode.removeEventListener('change',changeClouds);
      inputDeviceSelect?.removeEventListener('change',chooseInputDevice);
      resetAll.removeEventListener('click',restoreAll);
      resetValueButtons.forEach(button=>button.removeEventListener('click',restoreValue));
      viewInputs.forEach(input=>input.removeEventListener('input',changeView));
      timeSliderInput.removeEventListener('input', changeTimeScale);
      orbitInput.removeEventListener('input', seek);
      window.removeEventListener('scroll',scroll);
      renderer.dispose();
      this.removeAttribute('data-paused');
      delete this.dataset.ready;
      delete this.dataset.surfaceReady;
      delete this.dataset.starsReady;
      delete this.dataset.galaxyReady;
      delete this.dataset.terrainReady;
    };
  }

  disconnectedCallback() { this.cleanup?.(); this.cleanup = undefined; }
}
