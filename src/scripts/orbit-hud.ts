import { attitude, MIN_ALTITUDE, MAX_ALTITUDE, PROJECTION, type ObserverFrame, type Route } from './orbit-navigation.ts';
import { EARTH_RADIUS_KM, dot, type Vec3 } from './iss-orbit.ts';
import type { CameraAction } from './orbit-camera.ts';

export type Modality='mouse'|'trackpad'|'touch';
const VERBS:CameraAction[]=['fly','look','approach','lens','roll'];
const STORAGE='orbit-controls-learned';
const LABELS:Record<string,string>={fly:'Drag · fly',look:'Drag · look',roll:'Drag · roll'};
const clamp=(x:number,a:number,b:number)=>Math.max(a,Math.min(b,x));
const signed=(v:number)=>`${v<0?'−':'+'}${String(Math.abs(Math.round(v))).padStart(2,'0')}°`;
// Whole magnifications read as such; in between, one decimal, as a phone camera shows.
const lensLabel=(zoom:number)=>zoom>=9.95||Math.abs(zoom-Math.round(zoom))<.05?String(Math.round(zoom)):zoom.toFixed(1);

/** Orbit page instruments: camera presets, a logarithmic altitude tape, a
 * horizon gauge, lens presets and a five-verb tutorial that ticks off as each
 * gesture is tried. Pure presentation; navigation happens through the callbacks. */
export function createOrbitHud(root:HTMLElement,o:{route:(route:Route)=>void;free:()=>void;altitude:(km:number)=>void;current:()=>number;level:()=>void;
  /** Lens magnification about the image centre, 1–20; animated unless told otherwise. */
  lens:(zoom:number,animate?:boolean)=>void;lensZoom:()=>number}){
  const hud=root.querySelector<HTMLElement>('.orbit-hud'),help=root.querySelector<HTMLElement>('#flight-help');
  if(!hud||!help)return null;
  const tape=hud.querySelector<HTMLElement>('.hud-tape')!,output=hud.querySelector<HTMLOutputElement>('.altitude-output')!;
  const gauge=hud.querySelector<HTMLElement>('.hud-attitude')!,horizon=gauge.querySelector<SVGElement>('.gauge-horizon')!;
  const readouts=Object.fromEntries([...hud.querySelectorAll<HTMLElement>('[data-attitude]')].map(e=>[e.dataset.attitude!,e]));
  const cursor=hud.querySelector<HTMLElement>('.hud-cursor')!,cursorLabel=cursor.querySelector<HTMLElement>('.hud-cursor-label')!;
  const pulseTemplate=hud.querySelector<HTMLElement>('.hud-pulse')!;
  const fpm=hud.querySelector<HTMLElement>('.hud-fpm')!,speed=fpm.querySelector<HTMLElement>('.hud-speed')!,canvas=root.querySelector('canvas')!;
  const modeButtons=[...hud.querySelectorAll<HTMLButtonElement>('.hud-modes :is([data-route],[data-flight-mode])')];
  const lensControl=hud.querySelector<HTMLElement>('.hud-lens')!,lensButtons=[...lensControl.querySelectorAll<HTMLButtonElement>('[data-lens]')];
  const lensValue=lensControl.querySelector<HTMLElement>('.lens-value')!,lensFocal=lensControl.querySelector<HTMLElement>('.lens-focal')!;
  const verbs=[...hud.querySelectorAll<HTMLElement>('.hud-verb')];
  const timers=new Set<number>();
  const later=(fn:()=>void,ms:number)=>{const id=window.setTimeout(()=>{timers.delete(id);fn();},ms);timers.add(id);};
  // Option is ⌥ only on Apple keyboards.
  if(!/Mac|iPhone|iPad/.test(navigator.platform)){
    hud.querySelectorAll('.hud-alt').forEach(e=>e.textContent='Alt');
    help.querySelectorAll('[role="cell"]').forEach(e=>{e.textContent=e.textContent!.replaceAll('⌥','Alt');});
  }

  let learned=new Set<string>();
  try{const saved=JSON.parse(localStorage.getItem(STORAGE)??'[]');if(Array.isArray(saved))learned=new Set(saved.filter(v=>VERBS.includes(v)));}catch{/* Storage is optional. */}
  const complete=()=>VERBS.every(v=>learned.has(v));
  const paintLearned=()=>{
    const next=verbs.find(verb=>!learned.has(verb.dataset.verb!));
    for(const verb of verbs){verb.toggleAttribute('data-learned',learned.has(verb.dataset.verb!));verb.toggleAttribute('data-next',verb===next);}
    hud.toggleAttribute('data-learned',complete());hud.toggleAttribute('data-teaching',!complete());
  };
  paintLearned();
  const learn=(action:CameraAction)=>{
    if(learned.has(action))return;
    learned.add(action);
    try{localStorage.setItem(STORAGE,JSON.stringify([...learned]));}catch{/* Storage is optional. */}
    const verb=verbs.find(v=>v.dataset.verb===action);
    if(verb){verb.dataset.justLearned='';later(()=>delete verb.dataset.justLearned,700);}
    // Let the last tick land before the tutorial folds away.
    if(complete()){for(const v of verbs){v.setAttribute('data-learned','');v.removeAttribute('data-next');}later(paintLearned,1400);}
    else paintLearned();
  };
  const replay=()=>{
    learned.clear();try{localStorage.removeItem(STORAGE);}catch{/* Storage is optional. */}
    paintLearned();help.hidePopover();
  };

  let modality:Modality=matchMedia('(any-pointer: fine)').matches?'mouse':'touch';
  const setModality=(next:Modality)=>{if(next!==modality){modality=next;hud.dataset.modality=help.dataset.modality=next;}};
  hud.dataset.modality=help.dataset.modality=modality;
  const keyboard=()=>{hud.setAttribute('data-keyboard','');help.setAttribute('data-keyboard','');};
  if(modality==='mouse')keyboard();
  const key=(code:string,down:boolean)=>{
    if(down)keyboard();
    hud.querySelectorAll(`kbd[data-key="${code}"]`).forEach(k=>k.toggleAttribute('data-pressed',down));
  };

  // The tape is logarithmic, like the climb itself.
  const span=Math.log(MAX_ALTITUDE/MIN_ALTITUDE);
  const kmAt=(clientY:number)=>{const r=tape.getBoundingClientRect();return MIN_ALTITUDE*Math.exp(span*clamp(1-(clientY-r.top)/r.height,0,1));};
  let tapePointer:number|null=null;
  const tapeDown=(event:PointerEvent)=>{
    if(!event.isPrimary||event.button!==0)return;
    tapePointer=event.pointerId;tape.setPointerCapture(event.pointerId);event.preventDefault();tape.focus({preventScroll:true});
    o.altitude(kmAt(event.clientY));
  };
  const tapeMove=(event:PointerEvent)=>{if(event.pointerId===tapePointer)o.altitude(kmAt(event.clientY));};
  const tapeUp=(event:PointerEvent)=>{if(event.pointerId===tapePointer){tapePointer=null;if(tape.hasPointerCapture(event.pointerId))tape.releasePointerCapture(event.pointerId);}};
  const tapeKey=(event:KeyboardEvent)=>{
    const factor:Record<string,number>={ArrowUp:1.15,ArrowRight:1.15,ArrowDown:1/1.15,ArrowLeft:1/1.15,PageUp:2,PageDown:.5};
    const km=event.key==='Home'?MIN_ALTITUDE:event.key==='End'?MAX_ALTITUDE:factor[event.key]?o.current()*factor[event.key]:null;
    if(km===null)return;
    event.preventDefault();o.altitude(clamp(km,MIN_ALTITUDE,MAX_ALTITUDE));
  };
  const tapeWheel=(event:WheelEvent)=>{event.preventDefault();o.altitude(clamp(o.current()*Math.exp(event.deltaY*.004),MIN_ALTITUDE,MAX_ALTITUDE));};
  // A pointer click hands focus back to the scene, so Space pauses again.
  const refocus=(event:Event)=>{if((event as MouseEvent).detail>0)root.closest<HTMLElement>('.orbit-view')?.focus({preventScroll:true});};
  const mode=(event:Event)=>{
    const button=event.currentTarget as HTMLButtonElement;
    if(button.dataset.route)o.route(button.dataset.route as Route);else o.free();
    refocus(event);
  };
  const level=(event:Event)=>{o.level();refocus(event);};
  const lensPreset=(event:Event)=>{o.lens(Number((event.currentTarget as HTMLElement).dataset.lens));refocus(event);};
  const lensWheel=(event:WheelEvent)=>{event.preventDefault();o.lens(o.lensZoom()*Math.exp(-(event.deltaY||event.deltaX)*.004),false);};
  // Like a phone camera, the preset at or below the lens lights up and shows its exact value.
  const paintLens=(zoom:number)=>{
    const label=lensLabel(zoom),active=lensButtons.filter(b=>zoom>=Number(b.dataset.lens)-.005).at(-1)??lensButtons[0];
    for(const button of lensButtons){
      const preset=Number(button.dataset.lens),number=button.querySelector('.lens-number')!,text=button===active?label:String(preset);
      button.toggleAttribute('data-active',button===active);
      button.setAttribute('aria-pressed',String(Math.abs(zoom-preset)<.005*preset));
      if(number.textContent!==text)number.textContent=text;
    }
    lensValue.textContent=`${label}×`;lensFocal.textContent=`${Math.round(30*zoom)} mm`;
    lensControl.setAttribute('aria-label',`Lens ${label}×, ${Math.round(30*zoom)} mm`);
  };

  // Fade the instruments once the tutorial is done and nothing moves for a while.
  let idleTimer=0;
  const wake=()=>{
    root.removeAttribute('data-hud-idle');clearTimeout(idleTimer);
    idleTimer=window.setTimeout(()=>{if(!hud.matches(':hover,:focus-within'))root.setAttribute('data-hud-idle','');},4500);
  };
  const touchSeen=(event:PointerEvent)=>{wake();if(event.pointerType==='touch')setModality('touch');else if(event.pointerType==='pen'||modality==='touch')setModality('mouse');};
  wake();

  tape.addEventListener('pointerdown',tapeDown);tape.addEventListener('pointermove',tapeMove);
  for(const type of ['pointerup','pointercancel','lostpointercapture'])tape.addEventListener(type,tapeUp as EventListener);
  tape.addEventListener('keydown',tapeKey);tape.addEventListener('wheel',tapeWheel,{passive:false});
  modeButtons.forEach(button=>button.addEventListener('click',mode));
  gauge.addEventListener('click',level);
  lensButtons.forEach(button=>button.addEventListener('click',lensPreset));
  lensControl.addEventListener('wheel',lensWheel,{passive:false});
  const replayButton=help.querySelector('.flight-help-replay')!;replayButton.addEventListener('click',replay);
  window.addEventListener('pointerdown',touchSeen,{passive:true});
  window.addEventListener('pointermove',wake,{passive:true});
  window.addEventListener('keydown',wake,{passive:true});
  window.addEventListener('wheel',wake,{passive:true});

  const shown={altitude:-1,lens:1,heading:'',pitch:'',roll:'',state:'',mode:''};
  return {
    learn,setModality,key,
    get modality(){return modality;},
    toggleHelp(){help.togglePopover();},
    frame(frame:ObserverFrame&{focal?:number},free:boolean,route:Route,motion:Vec3){
      // Flight path marker: where the camera is heading, and how fast, through the frame's lens.
      const focal=frame.focal??PROJECTION,b=frame.cameraBasis,kms=Math.hypot(...motion)*EARTH_RADIUS_KM,z=dot(motion,b.slice(6,9) as Vec3);
      const r=canvas.getBoundingClientRect();
      let marked=false;
      if(kms>.5&&z>.08*Math.hypot(...motion)){
        const x=r.left+r.width/2+focal*dot(motion,b.slice(0,3) as Vec3)/z*r.height,y=r.top+r.height/2-focal*dot(motion,b.slice(3,6) as Vec3)/z*r.height;
        if(x>0&&x<innerWidth&&y>0&&y<innerHeight){
          marked=true;fpm.style.setProperty('--x',`${x.toFixed(1)}px`);fpm.style.setProperty('--y',`${y.toFixed(1)}px`);
          const label=`${kms<10?kms.toFixed(1):Math.round(kms).toLocaleString('en-US')} km/s`;if(speed.textContent!==label)speed.textContent=label;
        }
      }
      fpm.hidden=!marked;
      const zoom=focal/PROJECTION;
      if(Math.abs(zoom-shown.lens)>1e-4){shown.lens=zoom;paintLens(zoom);}
      const km=frame.altitude;
      if(Math.abs(km-shown.altitude)>.05){
        shown.altitude=km;
        tape.style.setProperty('--alt',`${(1-clamp(Math.log(km/MIN_ALTITUDE)/span,0,1))*100}%`);
        const label=`${Math.round(km).toLocaleString('en-US')} km`;
        if(output.value!==label){output.value=label;tape.setAttribute('aria-valuenow',String(Math.round(km)));tape.setAttribute('aria-valuetext',label);}
      }
      const a=attitude(frame);
      horizon.style.setProperty('--roll',`${a.roll.toFixed(2)}deg`);
      horizon.style.setProperty('--pitch',`${clamp(a.pitch*.42,-28,28).toFixed(2)}px`);
      const values={heading:`${String(Math.round(a.heading)%360).padStart(3,'0')}°`,pitch:signed(a.pitch),roll:signed(a.roll),
        state:Math.abs(a.roll)>100?'Inverted':'Level'};
      for(const k of ['heading','pitch','roll','state'] as const)if(shown[k]!==values[k]){shown[k]=values[k];readouts[k].textContent=values[k];}
      gauge.toggleAttribute('data-tilted',Math.abs(a.roll)>1.5);
      const current=free?'free':route;
      if(shown.mode!==current){
        shown.mode=current;
        for(const button of modeButtons)button.setAttribute('aria-pressed',String(button.dataset.route?!free&&button.dataset.route===route:free));
      }
    },
    hover(clientX:number|null,clientY:number,kind:CameraAction|null){
      const teach=clientX!==null&&!!kind&&!!LABELS[kind]&&!learned.has(kind)&&modality!=='touch';
      cursor.hidden=!teach;
      if(!teach)return;
      cursor.style.setProperty('--x',`${clientX}px`);cursor.style.setProperty('--y',`${clientY}px`);
      if(cursor.dataset.kind!==kind){cursor.dataset.kind=kind;cursorLabel.textContent=LABELS[kind];}
    },
    pulse(clientX:number,clientY:number){
      if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
      const ring=pulseTemplate.cloneNode() as HTMLElement;ring.hidden=false;
      ring.style.left=`${clientX}px`;ring.style.top=`${clientY}px`;hud.append(ring);later(()=>ring.remove(),800);
    },
    dispose(){
      clearTimeout(idleTimer);timers.forEach(id=>clearTimeout(id));timers.clear();root.removeAttribute('data-hud-idle');
      tape.removeEventListener('pointerdown',tapeDown);tape.removeEventListener('pointermove',tapeMove);
      for(const type of ['pointerup','pointercancel','lostpointercapture'])tape.removeEventListener(type,tapeUp as EventListener);
      tape.removeEventListener('keydown',tapeKey);tape.removeEventListener('wheel',tapeWheel);
      modeButtons.forEach(button=>button.removeEventListener('click',mode));
      gauge.removeEventListener('click',level);replayButton.removeEventListener('click',replay);
      lensButtons.forEach(button=>button.removeEventListener('click',lensPreset));lensControl.removeEventListener('wheel',lensWheel);
      window.removeEventListener('pointerdown',touchSeen);window.removeEventListener('pointermove',wake);
      window.removeEventListener('keydown',wake);window.removeEventListener('wheel',wake);
    },
  };
}
export type OrbitHud=NonNullable<ReturnType<typeof createOrbitHud>>;
