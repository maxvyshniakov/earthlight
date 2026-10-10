import { createCameraDrag, draggedCamera } from './orbit-camera-drag';
import { createTouchCamera } from './orbit-touch';
import { createFlightControls } from './flight-controls';
import { SceneCalendar, calendarFrame, dayOfYear, daysInYear, utcDay } from './scene-calendar';
import { OrbitNavigation, routePeriod, ROUTE_LABELS, altitudeAt, altitudePosition, type Route, type ObserverFrame } from './orbit-navigation';
import { createScenePanels } from './scene-panels';
import { EXPOSURE_SETTLE_MS } from './camera-exposure';
import { OrbitPlayback } from './orbit-playback';
import { issFrame, ORBIT_SECONDS, initialOrbitSeconds } from './iss-orbit';
import { currentLunarPhase } from './celestial-sky';
import { createOrbitRenderer, type SceneLook } from './orbit-renderer';
import { SceneFocus } from './scene-assets';
import { sceneBufferSize, sceneComposition, focusRenderScale } from './scene-viewport';
import { sceneProfile } from './scene-profile';
import {auroraMode as readAuroraMode} from './scene-effects';
import {isWebGL2,sceneContext} from './webgl-context';

export class OrbitalSky extends HTMLElement {
  private cleanup?: () => void;

  connectedCallback() {
    if (this.cleanup) return;
    const canvas = this.querySelector('canvas')!;
    const viewport = this.querySelector<HTMLElement>('.sky-viewport')!;
    const button = this.querySelector<HTMLButtonElement>('.sky-motion')!;
    const controls = this.querySelector<HTMLElement>('.sky-controls')!;
    const settingsToggle = this.querySelector<HTMLButtonElement>('.sky-settings-toggle')!;
    const orbitLink = this.querySelector<HTMLAnchorElement>('.sky-orbit-link');
    const speedInput = this.querySelector<HTMLInputElement>('.sky-speed input')!;
    const speedOutput = this.querySelector<HTMLOutputElement>('.sky-speed output')!;
    const orbitInput = this.querySelector<HTMLInputElement>('.sky-track input')!;
    const orbitOutput = this.querySelector<HTMLOutputElement>('.sky-track output')!;
    const timeStatus = this.querySelector<HTMLTimeElement>('.sky-time')!;
    const coordinateStatus = this.querySelector<HTMLElement>('.sky-coordinates')!;
    const lookInputs = [...this.querySelectorAll<HTMLInputElement>('[data-look]')];
    const exposureMode=this.querySelector<HTMLSelectElement>('#sky-exposure-mode')!;
    const auroraMode=this.querySelector<HTMLSelectElement>('#sky-aurora')!;
    const auroraStatus=this.querySelector<HTMLElement>('#sky-aurora-status')!;
    const fixedExposure=this.querySelector<HTMLInputElement>('#sky-fixed-exposure')!;
    const viewInputs=[...this.querySelectorAll<HTMLInputElement>('[data-view]')];
    const resetAll = this.querySelector<HTMLButtonElement>('.reset-all')!;
    const moonInput = this.querySelector<HTMLInputElement>('.sky-moon')!;
    const moonOutput = this.querySelector<HTMLOutputElement>('[data-moon-output]')!;
    // Slider 100% is the accepted image grade; renderer gains retain its appearance.
    const lookBase = { galaxy: .2625, grain: 1.1, chromatic: .625, ghosts: 1, exposure: 1 };
    const look:SceneLook = { ...lookBase, moonPhase:null };
    const playIcon = this.querySelector('.motion-play')!;
    const pauseIcon = this.querySelector('.motion-pause')!;
    const attributes:WebGLContextAttributes={alpha:false,antialias:false,depth:false,powerPreference:'low-power'};
    const gl=sceneContext(canvas,new URLSearchParams(location.search),attributes);
    if (!gl) return;
    this.dataset.renderApi=isWebGL2(gl)?'webgl2':'webgl';

    let disposed = false;
    // Repeatable frames and opt-in render comparisons.
    const params = new URLSearchParams(location.search);
    auroraMode.value=readAuroraMode(params);
    exposureMode.value=params.get('exposure-mode')==='manual'?'manual':'auto';
    const restoredFixed=Number(params.get('exposure-fixed'));
    if(Number.isFinite(restoredFixed))fixedExposure.value=String(Math.max(-5.5,Math.min(4.1,restoredFixed)));
    const profile=sceneProfile(params);
    this.dataset.renderProfile=profile.name;
    for(const input of [...lookInputs,speedInput]){
      const key=input===speedInput?'rate':`look-${input.dataset.look}`;
      const value=Number(params.get(key));
      if(params.has(key)&&Number.isFinite(value))input.value=String(Math.max(Number(input.min),Math.min(Number(input.max),value)));
    }
    for(const input of lookInputs)look[input.dataset.look as keyof typeof lookBase]=Number(input.value)*lookBase[input.dataset.look as keyof typeof lookBase];
    const standalone=this.dataset.composition==='orbit';
    const initialSeconds=initialOrbitSeconds(params);
    const calendar=new SceneCalendar(params,initialSeconds);
    const calendarInputs=[...this.querySelectorAll<HTMLInputElement>('[data-calendar]')];
    const navigation=new OrbitNavigation();
    if(standalone)navigation.restore(params);
    const routeInput=this.querySelector<HTMLSelectElement>('#sky-route');
    const altitudeInput=this.querySelector<HTMLInputElement>('#sky-altitude');
    const altitudeOutput=this.querySelector<HTMLOutputElement>('.altitude-output');
    const modeButtons=[...this.querySelectorAll<HTMLButtonElement>('[data-flight-mode]')];
    const flightHint=this.querySelector<HTMLElement>('.flight-hint');
    let flightControls:ReturnType<typeof createFlightControls>|undefined;
    let navigationURLTimer=0;
    const moonParam=params.get('moon');
    if(moonParam!==null&&Number.isFinite(Number(moonParam)))look.moonPhase=Math.max(0,Math.min(360,Number(moonParam)));
    const cameraView={yaw:0,pitch:0};
    for(const input of viewInputs){
      const key=input.dataset.view as keyof typeof cameraView;
      const value=Number(params.get(key));
      cameraView[key]=Number.isFinite(value)?Math.max(Number(input.min),Math.min(Number(input.max),value)):0;
      input.value=String(cameraView[key]);
    }
    let frame = 0,drawRequest=0,urlUpdateFrame=0;
    let lastRenderTime=-Infinity;
    let scrollTimer=0;
    let lastDraw=0;
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
    const scrollComposition=this.dataset.composition==='page';
    // The midpoint is 10x, retaining the existing 0.25x–120x range.
    const timeScale=(position:number)=>Math.round((10+position*(position<0?.0975:1.1))*100)/100;
    const playback=new OrbitPlayback(initialSeconds,timeScale(Number(speedInput.value)));
    let statusTimer=0;
    const replayDateFormat=new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'});
    let grainIndex = 0;
    let speed = timeScale(Number(speedInput.value));
    const rangeInputs=[...this.querySelectorAll<HTMLInputElement>('input[type="range"]')];
    const paintRange=(input:HTMLInputElement)=>{
      if(input.dataset.fill==='none')return;
      const min=Number(input.min),span=Number(input.max)-min;
      const position=(Number(input.value)-min)/span*100;
      const origin=input.dataset.fill==='default'?(Number(input.defaultValue)-min)/span*100:input.dataset.fill==='center'?-min/span*100:0;
      input.style.setProperty('--range-start',`${Math.min(origin,position)}%`);
      input.style.setProperty('--range-end',`${Math.max(origin,position)}%`);
    };
    const updateMoonLabel=(date=calendar.date(playback.read(performance.now())))=>{
      const phase=look.moonPhase??currentLunarPhase(date);
      const names=['New moon','Waxing crescent','First quarter','Waxing gibbous','Full moon','Waning gibbous','Last quarter','Waning crescent'];
      const name=names[Math.round(phase/45)%8];
      moonInput.value=String(phase);
      moonOutput.value=(look.moonPhase==null?'Auto · ':'')+name;
      moonInput.setAttribute('aria-valuetext',moonOutput.value);
      paintRange(moonInput);
      this.dataset.moonPhase=String(phase);
      this.dataset.moonMode=look.moonPhase==null?'auto':'manual';
    };
    updateMoonLabel();
    rangeInputs.forEach(paintRange);
    const updateSpeedLabel = () => {

      speedOutput.value = `${speed}×`;
      speedInput.setAttribute('aria-valuetext', `${speed} times orbital speed`);
      paintRange(speedInput);
    };
    updateSpeedLabel();
    let lastAnimationDraw = 0;
    let lost = false;
    let contextGeneration=0;
    let controlsInView = true;
    // Autoplay by default, including legacy links carrying `still`.
    // Explicit motion=0 remains available for repeatable screenshots.
    let paused = params.get('motion')==='0';
    let lastStatus = -1;

    let renderer:ReturnType<typeof createOrbitRenderer>;
    const focus=new SceneFocus();
    let focusTimer=0;
    let exposureTimer=0,exposureUntil=0;
    let exposureSceneTime:number|null=null;
    let focusRadius=6;
    let qualityScale:number=profile.scale;
    let inspection=false;
    let qualityFrame=0;
    let cssHeight=1,smallHeight=1;
    const updateFocus=()=>{
      if(disposed||lost||document.hidden)return;
      const stats=[this.dataset.dayTiles,this.dataset.nightTiles,this.dataset.cloudTiles].filter(Boolean).map(x=>JSON.parse(x!));
      const tilesSettled=stats.every(x=>x.pending===0&&x.resident>=x.wanted);
      const ready=this.hasAttribute('data-ready');
      const blur=matchMedia('(prefers-reduced-motion: reduce)').matches&&ready?0:focus.value(performance.now(),ready,renderer.assets.settled,tilesSettled);
      const changed=Math.abs(focusRadius-blur)>.0001;
      const previousScale=focusRenderScale(focusRadius);
      focusRadius=blur<.01?0:blur;
      if(previousScale!==focusRenderScale(focusRadius)){
        cancelAnimationFrame(qualityFrame);qualityFrame=requestAnimationFrame(resize);
      }
      this.dataset.focusRadius=focusRadius.toFixed(3);
      this.dataset.focus=blur<.01?'sharp':'acquiring';
      this.dataset.assets=renderer.assets.settled?'settled':'loading';
      this.dataset.assetBytes=String(renderer.assets.bytes);
      if(blur>=.01)focusTimer=window.setTimeout(updateFocus,1000/24);
      if(changed&&paused&&ready)draw();
    };
    const composition = () => sceneComposition(window.scrollY,smallHeight,cssHeight,scrollComposition);
    const observerAt=(seconds:number,now=performance.now())=>{
      const view=composition();
      const pose=standalone?navigation.read(seconds,cameraView,now):issFrame(seconds,view.limb,cameraView,view.altitudeLift);
      return calendarFrame(pose,calendar.date(seconds));
    };
    const currentObserver=()=>observerAt(playback.read(performance.now())+composition().offset);
    const period=()=>standalone?routePeriod(navigation.route):ORBIT_SECONDS;
    const updateNavigationUI=()=>{
      if(!standalone)return;
      routeInput!.value=navigation.route;
      for(const button of modeButtons)button.setAttribute('aria-pressed',String(button.dataset.flightMode===navigation.mode));
      this.dataset.flightMode=navigation.mode;this.dataset.route=navigation.route;
      this.querySelector('.sky-title')!.textContent=navigation.free?'Free flight':ROUTE_LABELS[navigation.route];
      this.querySelector<HTMLElement>('.sky-track')!.hidden=!!navigation.free;
      for(const input of viewInputs)input.closest<HTMLElement>('.setting')!.hidden=!!navigation.free;
      orbitInput.setAttribute('aria-label',`Position in ${ROUTE_LABELS[navigation.route]}`);
    };
    updateNavigationUI();
    const updateOrbitLink = (sceneTime=playback.read(performance.now())+composition().offset) => {
      if(!orbitLink)return;
      const url=new URL('/orbit/',location.href);
      for(const key of ['render','compare','api','texture','aurora'])if(params.has(key))url.searchParams.set(key,params.get(key)!);
      url.searchParams.set('t',sceneTime.toFixed(2));
      calendar.write(url.searchParams);
      if(paused)url.searchParams.set('motion','0');
      if(look.moonPhase!=null)url.searchParams.set('moon',String(look.moonPhase));
      if(cameraView.yaw)url.searchParams.set('yaw',String(cameraView.yaw));
      if(cameraView.pitch)url.searchParams.set('pitch',String(cameraView.pitch));
      for(const input of lookInputs)if(input.value!==input.defaultValue)url.searchParams.set(`look-${input.dataset.look}`,input.value);
      if(exposureMode.value==='manual'){url.searchParams.set('exposure-mode','manual');url.searchParams.set('exposure-fixed',fixedExposure.value);}
      orbitLink.href=url.pathname+url.search;
    };
    const prepareOrbitLink = () => updateOrbitLink();
    const updateStatus = (sceneTime:number,frame?:ObserverFrame) => {
      updateOrbitLink(sceneTime);
      // Align to the UTC second shown to the user, including the epoch fraction.
      const second=Math.floor(calendar.date(sceneTime).getTime()/1000);
      if(lastStatus===second)return;
      const orbit=frame??observerAt(sceneTime);
      {
        lastStatus = second;
        const duration=period(),orbitPhase=((sceneTime%duration)+duration)%duration;
        orbitInput.value = String(orbitPhase/duration*100);
        paintRange(orbitInput);
        orbitInput.setAttribute('aria-valuetext',`${Math.floor(orbitPhase/60)} minutes, ${orbit.phase}`);
        orbitOutput.value = orbit.phase;
        this.dataset.phase = orbit.phase.toLowerCase();
        this.dataset.sun=JSON.stringify(orbit.sun);
        for(const input of calendarInputs){
          const isDate=input.dataset.calendar==='date';
          const value=isDate?dayOfYear(orbit.date):orbit.date.getUTCHours()*60+orbit.date.getUTCMinutes();
          if(isDate)input.max=String(daysInYear(orbit.date.getUTCFullYear())-1);
          if(document.activeElement!==input)input.value=String(value);
          const label=isDate?replayDateFormat.format(orbit.date):orbit.date.toISOString().slice(11,16);
          this.querySelector<HTMLOutputElement>(`[data-calendar-output=${input.dataset.calendar}]`)!.value=label;
          input.setAttribute('aria-valuetext',label);
        }
        if(look.moonPhase==null)updateMoonLabel(orbit.date);
        timeStatus.dateTime=orbit.date.toISOString();
        timeStatus.textContent=`${replayDateFormat.format(orbit.date)} · ${orbit.date.toISOString().slice(11,19)} UTC`;
        coordinateStatus.textContent=`${Math.abs(orbit.latitude).toFixed(1)}° ${orbit.latitude<0?'S':'N'} · ${Math.abs(orbit.longitude).toFixed(1)}° ${orbit.longitude<0?'W':'E'} · ${Math.round(orbit.altitude)} km`;
      }
    };
    const statusTick = () => {
      clearTimeout(statusTimer);
      if(paused || document.hidden || lost || !this.hasAttribute('data-ready'))return;
      const sceneTime=playback.read(performance.now())+composition().offset;
      updateStatus(sceneTime);
      const milliseconds=calendar.date(sceneTime).getTime();
      const remainder=((milliseconds%1000)+1000)%1000;
      // Schedule against the next actual second, independently of rendering cadence.
      statusTimer=window.setTimeout(statusTick,Math.max(8,(1000-remainder)/speed));
    };
    const flushDraw=(now:number)=>{
      drawRequest=0;
      if(disposed||lost||document.hidden||(!paused&&this.hasAttribute('data-ready')))return;
      if(now-lastRenderTime<1000/profile.fps){drawRequest=requestAnimationFrame(flushDraw);return;}
      renderFrame();
    };
    const draw=()=>{
      // Inputs only invalidate. Playback owns its regular frame; a paused or
      // loading scene coalesces all pending changes into one capped RAF draw.
      if(disposed||lost||document.hidden||(!paused&&this.hasAttribute('data-ready'))||drawRequest)return;
      drawRequest=requestAnimationFrame(flushDraw);
    };
    const renderFrame = () => {
      if(lost||!renderer)return;
      if(!('surfaceReady' in renderer.state)&&!('galaxyReady' in renderer.state))return;
      const view=composition();
      const sceneTime=playback.read(performance.now())+view.offset;
      const orbit=observerAt(sceneTime);
      const result=renderer.render(orbit,canvas.width,canvas.height,cssHeight,sceneTime,grainIndex,look,focusRadius,speed,inspection);
      if(!result)return;
      const now=performance.now();
      lastRenderTime=now;
      if(standalone){
        const label=`${Math.round(orbit.altitude).toLocaleString('en-US')} km`;
        if(altitudeOutput!.value!==label)altitudeOutput!.value=label;
        if(document.activeElement!==altitudeInput)altitudeInput!.value=String(altitudePosition(orbit.altitude));
        altitudeInput!.setAttribute('aria-valuetext',label);
        this.dataset.cameraPosition=orbit.camera.map(v=>v.toFixed(8)).join(',');
        this.dataset.cameraAltitude=orbit.altitude.toFixed(3);
        this.dataset.cameraBasis=JSON.stringify(orbit.cameraBasis);
      }
      clearTimeout(exposureTimer);
      if(exposureSceneTime!==sceneTime){exposureSceneTime=sceneTime;exposureUntil=now+EXPOSURE_SETTLE_MS;}
      if(paused&&!document.hidden&&now<exposureUntil){
        exposureTimer=window.setTimeout(()=>{if(!disposed&&!lost&&!document.hidden)draw();},1000/24);
      }
      this.dataset.exposure=now<exposureUntil?'adapting':'settled';
      const inspect=standalone&&paused&&now>=exposureUntil&&focusRadius===0&&!matchMedia('(pointer: coarse)').matches;
      if(inspect!==inspection){inspection=inspect;this.dataset.inspection=String(inspect);cancelAnimationFrame(qualityFrame);qualityFrame=requestAnimationFrame(resize);}
      Object.assign(this.dataset,result.state);
      this.dataset.renderScale=(result.scale*focusRenderScale(focusRadius)).toFixed(2);
      if(Math.abs(result.scale-qualityScale)>.001){qualityScale=result.scale;cancelAnimationFrame(qualityFrame);qualityFrame=requestAnimationFrame(resize);}
      if(result.terrain)this.dataset.terrainTiles=JSON.stringify(result.terrain);
      if(result.galaxy)this.dataset.galaxyTiles=JSON.stringify(result.galaxy);
      if(result.cloud)this.dataset.cloudTiles=JSON.stringify(result.cloud);
      if(result.day)this.dataset.dayTiles=JSON.stringify(result.day);
      if(result.night)this.dataset.nightTiles=JSON.stringify(result.night);
      if(paused||!this.hasAttribute('data-ready')||standalone)updateStatus(sceneTime,orbit);
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
      const size=sceneBufferSize(width,height,devicePixelRatio,(inspection?1:qualityScale)*focusRenderScale(focusRadius),inspection);
      const changed=canvas.width!==size.width||canvas.height!==size.height||cssHeight!==height||smallHeight!==nextSmall;
      cssHeight=height;smallHeight=nextSmall;
      // Assigning even an unchanged dimension clears the drawing buffer.
      if(canvas.width!==size.width)canvas.width=size.width;
      if(canvas.height!==size.height)canvas.height=size.height;
      if(!changed)return;
      gl.viewport(0, 0, canvas.width, canvas.height);
      // Playback will draw the new size on its next 24 FPS tick.
      if(paused||!this.hasAttribute('data-ready'))draw();
    };
    const tick = (now: number) => {
      frame = 0;
      if (paused || document.hidden || lost || !this.hasAttribute('data-ready')) return;
      renderer.observeAnimationFrame(now,profile.fps/24);
      const interval = 1000/profile.fps;
      if (now - lastDraw >= interval) {
        if(lastAnimationDraw&&focusRadius===0)renderer.observeCadence((now-lastAnimationDraw)*profile.fps/24,now);
        lastAnimationDraw=focusRadius===0?now:0;
        grainIndex=(grainIndex+1)%65536;
        renderFrame();
        // Carry the remainder: on 60Hz screens this alternates 2/3 refreshes
        // instead of rounding the requested frame rate down to a divisor of 60.
        lastDraw = now-(now-lastDraw)%interval;
      }
      frame = requestAnimationFrame(tick);
    };
    const sync = () => {
      clearTimeout(exposureTimer);
      lastDraw=performance.now();
      clearTimeout(focusTimer);
      if(renderer&&this.hasAttribute('data-ready')&&this.dataset.focus!=='sharp')updateFocus();
      cancelAnimationFrame(frame);
      cancelAnimationFrame(drawRequest);drawRequest=0;
      frame = 0;
      clearTimeout(statusTimer);
      playback.setRunning(!paused && !document.hidden && !lost && this.hasAttribute('data-ready'),performance.now());
      lastAnimationDraw=0;
      renderer?.resetCadence();
      playIcon.toggleAttribute('data-hidden',!paused);
      pauseIcon.toggleAttribute('data-hidden',paused);
      button.setAttribute('aria-label', paused ? 'Play' : 'Pause');
      button.title = paused ? 'Play' : 'Pause';
      updateOrbitLink();
      if(paused&&!document.hidden&&!lost&&this.hasAttribute('data-ready')&&performance.now()<exposureUntil)draw();
      if (!paused && !document.hidden && !lost && this.hasAttribute('data-ready')) {
        statusTick();
        frame = requestAnimationFrame(tick);
      }
    };
    const scroll = () => {
      // Animated frames already read scroll position. A paused scene still
      // follows the page's orbital offset without advancing the playback clock
      // or the grain seed.
      if(!scrollComposition || !paused || document.hidden || scrollTimer) return;
      scrollTimer=window.setTimeout(()=>{
        scrollTimer=0;
        if(!disposed && paused && !document.hidden)draw();
      },1000/24);
    };
    const toggle = () => {
      paused = !paused;
      if(!paused) {
        const url=new URL(pendingURL??location.href);
        url.searchParams.delete('motion');
        url.searchParams.delete('still');
        updateURL(url);
      }
      sync();
    };
    const playbackKey = (event:KeyboardEvent) => {
      if(this.dataset.composition!=='orbit'||event.code!=='Space'||event.repeat||event.defaultPrevented
        ||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey)return;
      const target=event.target;
      if(target instanceof Element&&target.closest('input,textarea,select,button,a,[contenteditable]:not([contenteditable="false"]),[role="slider"]'))return;
      event.preventDefault();toggle();
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
      url.searchParams.delete('still');
      if(paused)url.searchParams.set('motion','0');
      else url.searchParams.delete('motion');
      updateURL(url);
    };
    const changeSpeed = () => {
      speed = timeScale(Number(speedInput.value));
      playback.setSpeed(speed,performance.now());
      updateSpeedLabel();
      statusTick();
    };
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
      for(const input of viewInputs){
        const key=input.dataset.view as keyof typeof cameraView;
        cameraView[key]=Number(input.value);
        if(cameraView[key])url.searchParams.set(key,String(cameraView[key]));
        else url.searchParams.delete(key);
      }
      updateURL(url);
      updateViewLabels();
      updateOrbitLink();
      if(standalone&&navigation.free)saveNavigation();
      exposureUntil=performance.now()+EXPOSURE_SETTLE_MS;
      draw();
    };
    updateViewLabels();
    const saveNavigation=()=>{
      clearTimeout(navigationURLTimer);
      const url=new URL(pendingURL??location.href);
      navigation.write(url.searchParams);
      url.searchParams.set('t',(playback.read(performance.now())+composition().offset).toFixed(2));
      for(const key of ['yaw','pitch'] as const){if(!navigation.free&&cameraView[key])url.searchParams.set(key,String(cameraView[key]));else url.searchParams.delete(key);}
      if(paused)url.searchParams.set('motion','0');else url.searchParams.delete('motion');
      updateURL(url);
    };
    let hintSeen=false;try{hintSeen=sessionStorage.getItem('orbit-flight-hint')==='seen';}catch{/* Storage is optional. */}
    const dismissHint=()=>{if(flightHint)flightHint.hidden=true;hintSeen=true;try{sessionStorage.setItem('orbit-flight-hint','seen');}catch{/* Storage is optional. */}};
    const enterFree=()=>{
      if(!navigation.free){
        const pose=currentObserver();
        navigation.detach(pose,cameraView);
        viewInputs.forEach(input=>input.value=String(cameraView[input.dataset.view as keyof typeof cameraView]));updateViewLabels();
      }
      updateNavigationUI();
      if(flightHint&&!hintSeen){flightHint.hidden=false;hintSeen=true;try{sessionStorage.setItem('orbit-flight-hint','seen');}catch{/* Storage is optional. */}}
      lastStatus=-1;saveNavigation();
    };
    const followRoute=(route:Route)=>{
      const from=currentObserver();
      navigation.follow(route,from,performance.now(),!matchMedia('(prefers-reduced-motion: reduce)').matches);
      cameraView.yaw=0;cameraView.pitch=0;
      viewInputs.forEach(input=>input.value='0');updateViewLabels();updateNavigationUI();
      if(flightHint)flightHint.hidden=true;
      lastStatus=-1;saveNavigation();flightControls?.request();
      exposureUntil=performance.now()+EXPOSURE_SETTLE_MS;draw();
    };
    const changeRoute=()=>followRoute(routeInput!.value as Route);
    const changeMode=(event:Event)=>{
      if((event.currentTarget as HTMLElement).dataset.flightMode==='free'){enterFree();draw();}
      else followRoute(navigation.route);
    };
    const changeAltitude=()=>{const km=altitudeAt(Number(altitudeInput!.value));enterFree();navigation.setAltitude(km);flightControls?.request();};
    const calendarChanged=()=>{
      lastStatus=-1;exposureUntil=performance.now()+EXPOSURE_SETTLE_MS;
      updateMoonLabel(calendar.date(playback.read(performance.now())+composition().offset));
      saveNavigation();updateOrbitLink();draw();statusTick();
    };
    const changeCalendar=(event:Event)=>{
      const input=event.currentTarget as HTMLInputElement,seconds=playback.read(performance.now())+composition().offset;
      if(input.dataset.calendar==='date')calendar.setDay(Number(input.value),seconds);
      else calendar.setMinute(Number(input.value),seconds);
      calendarChanged();
    };
    const applyLook = () => {
      for(const input of lookInputs){
        const key=input.dataset.look as keyof typeof lookBase;
        look[key]=Number(input.value)*lookBase[key];
        const value=key==='exposure'?`${look.exposure>0?'+':''}${look.exposure.toFixed(1)} EV`:`${Math.round(Number(input.value)*100)}%`;
        this.querySelector<HTMLOutputElement>(`[data-output="${key}"]`)!.value=value;
        input.setAttribute('aria-valuetext',value);
        paintRange(input);
      }
      const exposureInput=lookInputs.find(input=>input.dataset.look==='exposure')!;
      const manual=exposureMode.value==='manual';
      look.manualExposure=manual?Number(fixedExposure.value):null;
      if(manual)look.exposure=0;
      this.querySelector<HTMLElement>('[data-manual-setting]')!.hidden=!manual;
      exposureInput.closest<HTMLElement>('.setting')!.hidden=manual;
      const fixedLabel=`${Number(fixedExposure.value)>0?'+':''}${Number(fixedExposure.value).toFixed(1)} EV`;
      this.querySelector<HTMLOutputElement>('[data-fixed-output]')!.value=fixedLabel;
      fixedExposure.setAttribute('aria-valuetext',fixedLabel);paintRange(fixedExposure);
      exposureUntil=performance.now()+EXPOSURE_SETTLE_MS;
      draw();
    };
    const changeLook = () => {
      applyLook();
      const url=new URL(pendingURL??location.href);
      const exposureInput=lookInputs.find(input=>input.dataset.look==='exposure')!;
      if(exposureInput.value===exposureInput.defaultValue)url.searchParams.delete('look-exposure');else url.searchParams.set('look-exposure',exposureInput.value);
      if(exposureMode.value==='manual'){url.searchParams.set('exposure-mode','manual');url.searchParams.set('exposure-fixed',fixedExposure.value);}
      else{url.searchParams.delete('exposure-mode');url.searchParams.delete('exposure-fixed');}
      updateURL(url);
    };
    const changeMoon=()=>{
      look.moonPhase=Number(moonInput.value);
      const url=new URL(pendingURL??location.href);url.searchParams.set('moon',String(look.moonPhase));
      updateURL(url);
      updateMoonLabel();updateOrbitLink();
      exposureUntil=performance.now()+EXPOSURE_SETTLE_MS;
      draw();
    };
    const restoreAll = () => {
      const resetAurora=auroraMode.value!=='auto';
      auroraMode.value='auto';
      const now=performance.now();
      speedInput.value=speedInput.defaultValue;
      speed=timeScale(Number(speedInput.value));
      playback.setSpeed(speed,now);
      playback.seek(initialOrbitSeconds(new URLSearchParams())-composition().offset,now);
      paused=false;
      calendar.reset(playback.read(now)+composition().offset);
      navigation.follow('iss',currentObserver(),now,false);flightControls?.cancel();updateNavigationUI();
      if(flightHint)flightHint.hidden=true;
      lastStatus=-1;
      viewInputs.forEach(input=>{input.value=input.defaultValue;});
      cameraView.yaw=0;cameraView.pitch=0;
      lookInputs.forEach(input=>{input.value=input.defaultValue;});
      exposureMode.value="auto";fixedExposure.value=fixedExposure.defaultValue;
      const url=new URL(pendingURL??location.href);
      for(const key of ['t','yaw','pitch','motion','still','moon','route','flight','position','heading','elevation','roll','orientation','aurora'])url.searchParams.delete(key);
      for(const input of [...lookInputs,speedInput])url.searchParams.delete(input===speedInput?'rate':`look-${input.dataset.look}`);
      updateURL(url);
      look.moonPhase=null;updateMoonLabel();
      updateSpeedLabel();updateViewLabels();
      exposureUntil=now+EXPOSURE_SETTLE_MS;
      changeLook();
      if(resetAurora){reloadScene();return;}
      sync();
    };
    const resetValueButtons=[...this.querySelectorAll<HTMLButtonElement>('.reset-value')];
    const restoreValue=(event:Event)=>{
      const input=(event.currentTarget as HTMLElement).closest('.setting')!.querySelector<HTMLInputElement>('input')!;
      if(input.dataset.calendar){
        const seconds=playback.read(performance.now())+composition().offset,date=calendar.date(seconds),now=new Date();
        const milliseconds=input.dataset.calendar==='date'?utcDay(now)+(date.getTime()-utcDay(date)):utcDay(date)+(now.getTime()-utcDay(now));
        calendar.set(new Date(milliseconds),seconds);calendarChanged();
      }else if(input===moonInput){
        look.moonPhase=null;
        const url=new URL(pendingURL??location.href);url.searchParams.delete('moon');updateURL(url);
        updateMoonLabel();updateOrbitLink();
        exposureUntil=performance.now()+EXPOSURE_SETTLE_MS;draw();
      }else if(input===orbitInput){
        playback.seek(initialOrbitSeconds(new URLSearchParams())-composition().offset,performance.now());
        const url=new URL(pendingURL??location.href);url.searchParams.delete('t');url.searchParams.delete('still');updateURL(url);
        lastStatus=-1;draw();
      }else{
        input.value=input.defaultValue;
        input.dispatchEvent(new Event('input'));
      }
    };
    resetValueButtons.forEach(button=>button.addEventListener('click',restoreValue));
    try {renderer=createOrbitRenderer(gl,canvas,params,()=>{
      if(disposed||lost)return;
      exposureUntil=performance.now()+EXPOSURE_SETTLE_MS;
      Object.assign(this.dataset,renderer.state);
      if(paused||!this.hasAttribute('data-ready'))draw();
    });}
    catch(error){console.warn('Orbital scene unavailable.',error);return;}
    // Restoring controls must not turn a fresh visit into a dated replay URL.
    applyLook();
    const dragSurface=this.dataset.composition==='orbit'?this.closest<HTMLElement>('.orbit-view'):null;
    const cameraChanged=()=>{lastStatus=-1;exposureUntil=performance.now()+EXPOSURE_SETTLE_MS;draw();clearTimeout(navigationURLTimer);navigationURLTimer=window.setTimeout(saveNavigation,180);};
    const lookCamera=(view:typeof cameraView)=>{
      for(const input of viewInputs)input.value=String(view[input.dataset.view as keyof typeof view]);
      Object.assign(cameraView,view);updateViewLabels();updateOrbitLink();cameraChanged();saveNavigation();
    };
    const lookDelta=(dx:number,dy:number)=>{
      if(lost||!this.hasAttribute('data-ready'))return;
      if(navigation.free){
        const degrees=55/Math.max(1,dragSurface!.clientHeight);
        navigation.turn(-dx*degrees,dy*degrees);cameraChanged();saveNavigation();
      }else lookCamera(draggedCamera(cameraView.yaw,cameraView.pitch,dx,dy,dragSurface!.clientHeight));
    };
    const panCamera=(dx:number,dy:number)=>{
      if(lost||!this.hasAttribute('data-ready'))return;
      if(!navigation.free)enterFree();
      navigation.pan(cameraView,dx,dy,dragSurface!.clientHeight);cameraChanged();
    };
    const zoomCamera=(delta:number)=>{
      if(lost||!this.hasAttribute('data-ready'))return;
      if(!navigation.free)enterFree();
      navigation.zoom(cameraView,delta);cameraChanged();
    };
    if(dragSurface)flightControls=createFlightControls(dragSurface,{
      enabled:()=>!!navigation.free&&!lost&&this.hasAttribute('data-ready'),
      step:(dt,input,fast)=>{if(lost||!this.hasAttribute('data-ready'))return false;navigation.step(dt,cameraView,input,fast);return navigation.moving;},
      gesture:(kind,dx,dy)=>{
        if(lost||!this.hasAttribute('data-ready'))return;
        if(kind==='look')lookDelta(dx,dy);
        else if(kind==='pan')panCamera(dx,dy);
        else zoomCamera(dy);
      },
      changed:cameraChanged,
      stop:()=>navigation.stop(),
    });
    const disposeCameraDrag=dragSurface?createCameraDrag(dragSurface,lookDelta,panCamera):()=>{};
    const touchSurface=dragSurface?.querySelector<HTMLElement>('.orbit-gestures');
    const disposeTouchCamera=touchSurface?createTouchCamera(touchSurface,lookDelta,panCamera,zoomCamera):()=>{};
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
      if(paused)url.searchParams.set('motion','0');else url.searchParams.delete('motion');
      for(const input of [...lookInputs,speedInput]){
        const key=input===speedInput?'rate':`look-${input.dataset.look}`;
        if(input.value!==input.defaultValue)url.searchParams.set(key,input.value);else url.searchParams.delete(key);
      }
      location.assign(url);
    };
    const changeProfile=()=>{
      const url=new URL(pendingURL??location.href);
      url.searchParams.set('render',profileSelect.value);
      url.searchParams.set('compare','1');
      reloadScene(url);
    };
    const changeAurora=()=>{
      const url=new URL(pendingURL??location.href);
      if(auroraMode.value==='auto')url.searchParams.delete('aurora');
      else url.searchParams.set('aurora',auroraMode.value==='on'?'1':'0');
      reloadScene(url);
    };
    const updateAuroraStatus=()=>{
      auroraStatus.textContent=this.dataset.aurora==='unsupported'?'Aurora is unavailable on this device.':auroraMode.value==='auto'?'Auto turns aurora off on phones and tablets.':'';
      auroraStatus.hidden=!auroraStatus.textContent;
    };
    const auroraObserver=new MutationObserver(updateAuroraStatus);
    auroraObserver.observe(this,{attributes:true,attributeFilter:['data-aurora']});
    updateAuroraStatus();
    auroraMode.addEventListener('change',changeAurora);
    profileSelect.addEventListener('change',changeProfile);
    calendarInputs.forEach(input=>input.addEventListener('input',changeCalendar));
    routeInput?.addEventListener('change',changeRoute);
    altitudeInput?.addEventListener('input',changeAltitude);
    modeButtons.forEach(button=>button.addEventListener('click',changeMode));
    flightHint?.querySelector('button')?.addEventListener('click',dismissHint);
    orbitLink?.addEventListener('pointerdown',prepareOrbitLink);
    orbitLink?.addEventListener('click',prepareOrbitLink);
    orbitLink?.addEventListener('focus',prepareOrbitLink);
    lookInputs.forEach(input=>input.addEventListener('input',changeLook));
    exposureMode.addEventListener('change',changeLook);fixedExposure.addEventListener('input',changeLook);
    resetAll.addEventListener('click',restoreAll);
    moonInput.addEventListener('input',changeMoon);
    viewInputs.forEach(input=>input.addEventListener('input',changeView));
    const contextLost = (event: Event) => {
      event.preventDefault();
      contextGeneration++;
      lost = true;
      flightControls?.cancel();
      clearTimeout(exposureTimer);
      clearTimeout(focusTimer);
      renderer.contextLost();
      delete this.dataset.terrainReady;
      delete this.dataset.galaxyReady;
      delete this.dataset.starsReady;
      delete this.dataset.surfaceReady;
      delete this.dataset.ready;
      controls.hidden = true;
      panelController.close();
      sync();
    };
    const contextRestored = async() => {
      if(disposed)return;
      const current=contextGeneration;
      const pending=renderer.contextRestored();
      Object.assign(this.dataset,renderer.state);
      const restored=await pending;
      if(disposed||current!==contextGeneration)return;
      Object.assign(this.dataset,renderer.state);
      lost = !restored;
      if (!lost) { resize(); controls.hidden = !controlsInView || !this.hasAttribute('data-ready'); sync(); }
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    observer.observe(viewport);
    // The transparent page keeps the sky visible below the introduction;
    // only its controls hide when the introduction leaves the viewport.
    const hero = document.querySelector('.hero');
    const visibility = new IntersectionObserver(entries => {
      controlsInView = entries[0].isIntersecting;
      controls.hidden = !controlsInView || lost || !this.hasAttribute('data-ready');
      if(controls.hidden)panelController.close();
    });
    if (hero) visibility.observe(hero);
    button.addEventListener('click', toggle);
    window.addEventListener('keydown',playbackKey);
    speedInput.addEventListener('input', changeSpeed);
    orbitInput.addEventListener('input', seek);
    document.addEventListener('visibilitychange', sync);
    if(scrollComposition)window.addEventListener('scroll',scroll,{passive:true});
    canvas.addEventListener('webglcontextlost', contextLost);
    canvas.addEventListener('webglcontextrestored', contextRestored);
    resize();
    controls.hidden = true;
    sync();
    renderer.load();
    this.cleanup = () => {
      flightControls?.dispose();clearTimeout(navigationURLTimer);
      calendarInputs.forEach(input=>input.removeEventListener('input',changeCalendar));
      routeInput?.removeEventListener('change',changeRoute);
      altitudeInput?.removeEventListener('input',changeAltitude);
      modeButtons.forEach(button=>button.removeEventListener('click',changeMode));
      flightHint?.querySelector('button')?.removeEventListener('click',dismissHint);
      disposeCameraDrag();
      disposeTouchCamera();
      disposed = true;
      clearTimeout(exposureTimer);
      clearTimeout(scrollTimer);
      cancelAnimationFrame(frame);
      clearTimeout(statusTimer);
      clearTimeout(focusTimer);
      cancelAnimationFrame(qualityFrame);
      cancelAnimationFrame(drawRequest);
      cancelAnimationFrame(urlUpdateFrame);
      observer.disconnect();
      visibility.disconnect();
      button.removeEventListener('click', toggle);
      window.removeEventListener('keydown',playbackKey);
      panelController.close();
      orbitLink?.removeEventListener('pointerdown',prepareOrbitLink);
      orbitLink?.removeEventListener('click',prepareOrbitLink);
      orbitLink?.removeEventListener('focus',prepareOrbitLink);
      panelController.dispose();
      profileSelect.removeEventListener('change',changeProfile);
      lookInputs.forEach(input=>input.removeEventListener('input',changeLook));
      exposureMode.removeEventListener('change',changeLook);fixedExposure.removeEventListener('input',changeLook);
      auroraObserver.disconnect();auroraMode.removeEventListener('change',changeAurora);
      resetAll.removeEventListener('click',restoreAll);
      resetValueButtons.forEach(button=>button.removeEventListener('click',restoreValue));
      moonInput.removeEventListener('input',changeMoon);
      viewInputs.forEach(input=>input.removeEventListener('input',changeView));
      speedInput.removeEventListener('input', changeSpeed);
      orbitInput.removeEventListener('input', seek);
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('scroll',scroll);
      canvas.removeEventListener('webglcontextlost', contextLost);
      canvas.removeEventListener('webglcontextrestored', contextRestored);
      renderer.dispose();
      delete this.dataset.ready;
      delete this.dataset.surfaceReady;
      delete this.dataset.starsReady;
      delete this.dataset.galaxyReady;
      delete this.dataset.terrainReady;
    };
  }

  disconnectedCallback() { this.cleanup?.(); this.cleanup = undefined; }
}
