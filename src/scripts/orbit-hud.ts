import { attitude, MIN_ALTITUDE, MAX_ALTITUDE, PROJECTION, type ObserverFrame, type Route } from './orbit-navigation.ts';
import { shellCoverage, SHELL } from './scene-view-scale.ts';
import { EARTH_RADIUS_KM, add, cross, dot, normalize, scale, type Vec3 } from './iss-orbit.ts';

export type Modality='mouse'|'trackpad'|'touch';
const clamp=(x:number,a:number,b:number)=>Math.max(a,Math.min(b,x));
/** Horizon gauge geometry in its 48 px drawing: dial radius, pixels per degree of
 * pitch, and the Earth arc and Sun ring 3 px outside the dial's 1 px stroke. */
export const GAUGE={dial:19,pitch:.42,earthAt:23.25,sun:2.6,sunAt:25.6};
const deg=Math.PI/180;
// The Earth arc never gets shorter than 8 px, so it still reads as an arc.
const EARTH_MIN=4/GAUGE.earthAt/deg;
/** Earth surrounds the view: the frame's centre is on it, or its whole disk is in frame. */
const earthWhole=(camera:ArrayLike<number>,b:number[],focal:number,aspect:number)=>{
  const p:Vec3=[camera[0],camera[1],camera[2]],far=Math.hypot(...p),ahead=dot(p,b.slice(6,9) as Vec3);
  if(ahead<0&&ahead*ahead>far*far-SHELL*SHELL)return true;
  const centre=scale(p,-1/far),sin=Math.min(1,SHELL/far),cos=Math.sqrt(1-sin*sin);
  const u=normalize(cross(centre,Math.abs(centre[2])<.9?[0,0,1]:[1,0,0])),v=cross(centre,u);
  for(let i=0;i<16;i++){
    const t=i*Math.PI/8,limb=add(scale(centre,cos),scale(add(scale(u,Math.cos(t)),scale(v,Math.sin(t))),sin));
    const z=dot(limb,b.slice(6,9) as Vec3);
    if(z<=0||Math.abs(focal*dot(limb,b.slice(0,3) as Vec3)/z)>aspect/2||Math.abs(focal*dot(limb,b.slice(3,6) as Vec3)/z)>.5)return false;
  }
  return true;
};
const arc=(centre:number,half:number)=>{
  const R=GAUGE.earthAt;
  if(half>=179.5)return `M${R} 0A${R} ${R} 0 1 1 ${-R} 0A${R} ${R} 0 1 1 ${R} 0`;
  const at=(a:number)=>`${(R*Math.cos(a*deg)).toFixed(2)} ${(R*Math.sin(a*deg)).toFixed(2)}`;
  return `M${at(centre-half)}A${R} ${R} 0 ${half>90?1:0} 1 ${at(centre+half)}`;
};
const signed=(v:number)=>`${v<0?'−':'+'}${String(Math.abs(Math.round(v))).padStart(2,'0')}°`;
// Whole magnifications read as such; in between, one decimal, as a phone camera shows.
const lensLabel=(zoom:number)=>zoom>=9.95||Math.abs(zoom-Math.round(zoom))<.05?String(Math.round(zoom)):zoom.toFixed(1);

/** Orbit page instruments: a replay clock, camera presets, a logarithmic
 * altitude tape, a horizon gauge, lens presets, gesture hints and the controls
 * panel. Hints and help cover only the inputs this device has. Pure
 * presentation; navigation happens through the callbacks. */
export function createOrbitHud(root:HTMLElement,o:{route:(route:Route)=>void;free:()=>void;altitude:(km:number)=>void;current:()=>number;level:()=>void;
  /** Lens magnification about the image centre, 1–20; animated unless told otherwise. */
  lens:(zoom:number,animate?:boolean)=>void;lensZoom:()=>number}){
  const hud=root.querySelector<HTMLElement>('.orbit-hud'),help=root.querySelector<HTMLElement>('#flight-help'),info=root.querySelector<HTMLElement>('#sky-info');
  if(!hud||!help||!info)return null;
  const tape=hud.querySelector<HTMLElement>('.hud-tape')!,output=hud.querySelector<HTMLOutputElement>('.altitude-output')!;
  const gauge=hud.querySelector<HTMLElement>('.hud-attitude')!,horizon=gauge.querySelector<SVGElement>('.gauge-horizon')!;
  const earthArc=gauge.querySelector<SVGPathElement>('.gauge-earth')!,sunRing=gauge.querySelector<SVGCircleElement>('.gauge-sun')!;
  const readouts=Object.fromEntries([...hud.querySelectorAll<HTMLElement>('[data-attitude]')].map(e=>[e.dataset.attitude!,e]));
  const pulseTemplate=hud.querySelector<HTMLElement>('.hud-pulse')!;
  const fpm=hud.querySelector<HTMLElement>('.hud-fpm')!,speed=fpm.querySelector<HTMLElement>('.hud-speed')!,canvas=root.querySelector('canvas')!;
  const modeButtons=[...hud.querySelectorAll<HTMLButtonElement>('.hud-modes :is([data-route],[data-flight-mode])')];
  const lensControl=hud.querySelector<HTMLElement>('.hud-lens')!,lensButtons=[...lensControl.querySelectorAll<HTMLButtonElement>('[data-lens]')];
  const timers=new Set<number>();
  const later=(fn:()=>void,ms:number)=>{const id=window.setTimeout(()=>{timers.delete(id);fn();},ms);timers.add(id);};
  // Option is a key only on Apple keyboards.
  if(!/Mac|iPhone|iPad/.test(navigator.platform))for(const e of [...hud.querySelectorAll('.hud-alt'),...help.querySelectorAll('.hud-alt')])e.textContent='Alt';
  // Only Safari reports a trackpad rotation.
  if('ongesturestart' in window)hud.dataset.gesture=help.dataset.gesture='';


  // The inputs this device has, so hints and help never teach a missing one. A
  // fine pointer comes with a keyboard; anything else counts once it is used.
  const fine=matchMedia('(any-pointer: fine)').matches,coarse=navigator.maxTouchPoints>0||matchMedia('(any-pointer: coarse)').matches;
  const inputs={pointer:fine||!coarse,touch:coarse,keyboard:fine};
  // An action in the controls panel with no lane left for this device hides its heading too.
  const tidyHelp=()=>{
    for(const head of help.querySelectorAll<HTMLElement>('.help-head')){
      const cells=[...help.querySelectorAll<HTMLElement>(`.help-cell[data-column="${head.dataset.column}"]`)];
      head.hidden=!head.querySelector('.help-note')&&cells.every(cell=>getComputedStyle(cell).display==='none');
    }
  };
  const paintInputs=()=>{for(const e of [hud,help])for(const [name,present] of Object.entries(inputs))e.toggleAttribute(`data-${name}`,present);tidyHelp();};
  const seen=(input:keyof typeof inputs)=>{if(!inputs[input]){inputs[input]=true;paintInputs();}};
  paintInputs();
  let modality:Modality=fine?'mouse':'touch';
  const setModality=(next:Modality)=>{seen(next==='touch'?'touch':'pointer');if(next!==modality){modality=next;hud.dataset.modality=help.dataset.modality=next;}};
  hud.dataset.modality=help.dataset.modality=modality;
  const key=(code:string,down:boolean)=>{
    if(down)seen('keyboard');
    for(const scope of [hud,help])scope.querySelectorAll(`kbd[data-key="${code}"]`).forEach(k=>k.toggleAttribute('data-pressed',down));
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
    lensControl.setAttribute('aria-label',`Lens ${label}×, ${Math.round(30*zoom)} mm`);
  };

  const touchSeen=(event:PointerEvent)=>{if(event.pointerType==='touch')setModality('touch');else if(event.pointerType==='pen'||modality==='touch')setModality('mouse');else seen('pointer');};

  tape.addEventListener('pointerdown',tapeDown);tape.addEventListener('pointermove',tapeMove);
  for(const type of ['pointerup','pointercancel','lostpointercapture'])tape.addEventListener(type,tapeUp as EventListener);
  tape.addEventListener('keydown',tapeKey);tape.addEventListener('wheel',tapeWheel,{passive:false});
  modeButtons.forEach(button=>button.addEventListener('click',mode));
  gauge.addEventListener('click',level);
  lensButtons.forEach(button=>button.addEventListener('click',lensPreset));
  lensControl.addEventListener('wheel',lensWheel,{passive:false});
  // The controls panel docks under the scene and shrinks it, as a phone's
  // browser bars do, so the scene's resize path gets exercised here too.
  const dockInset=()=>root.style.setProperty('--sky-inset-bottom',help.matches(':popover-open')?`${help.offsetHeight}px`:'0px');
  const dockSize=new ResizeObserver(dockInset);
  const helpToggled=()=>{
    const open=help.matches(':popover-open');
    dockInset();root.toggleAttribute('data-controls-open',open);
    if(open)dockSize.observe(help);else dockSize.unobserve(help);
  };
  // It stays open while you fly; Escape closes it unless a dialog takes the key.
  const helpEscape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&help.matches(':popover-open')&&!root.querySelector('[popover="auto"]:popover-open'))help.hidePopover();};
  // The panel scrolls sideways; a plain wheel does that too.
  const helpGrid=help.querySelector<HTMLElement>('.help-grid')!;
  const helpWheel=(event:WheelEvent)=>{if(Math.abs(event.deltaY)>Math.abs(event.deltaX)&&helpGrid.scrollWidth>helpGrid.clientWidth){event.preventDefault();helpGrid.scrollLeft+=event.deltaY;}};
  help.addEventListener('toggle',helpToggled);window.addEventListener('keydown',helpEscape);helpGrid.addEventListener('wheel',helpWheel,{passive:false});
  window.addEventListener('pointerdown',touchSeen,{passive:true});

  const shown={altitude:-1,lens:1,heading:'',pitch:'',roll:'',mode:'',earth:'',sun:''};
  return {
    setModality,key,
    get modality(){return modality;},
    toggleHelp(){help.togglePopover();},
    toggleInfo(){info.togglePopover();},
    frame(frame:ObserverFrame&{focal?:number;sun?:Vec3},free:boolean,route:Route,motion:Vec3){
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
      const shift=clamp(a.pitch*GAUGE.pitch,-38,38);
      horizon.style.setProperty('--pitch',`${shift.toFixed(2)}px`);
      // Earth: an arc about the ground side, out to where the horizon line meets
      // the dial, but no wider than the share of the view Earth fills. It closes
      // when Earth surrounds the view.
      const aspect=r.width/Math.max(1,r.height),coverage=shellCoverage(frame.camera,b,focal,aspect,12,12);
      const ground=shift>=GAUGE.dial?0:shift<=-GAUGE.dial?180:Math.acos(shift/GAUGE.dial)/deg;
      const earth=arc(90+a.roll,earthWhole(frame.camera,b,focal,aspect)?180:Math.max(EARTH_MIN,Math.min(ground,coverage>=.5?180:coverage*360)));
      if(earth!==shown.earth){shown.earth=earth;earthArc.setAttribute('d',earth);}
      // Sun: a ring outside the dial at its direction across the image, faint
      // when behind. In frame it flies inside, as far out as the pitch ladder
      // would put it.
      if(frame.sun){
        const x=dot(frame.sun,b.slice(0,3) as Vec3),y=dot(frame.sun,b.slice(3,6) as Vec3),z=dot(frame.sun,b.slice(6,9) as Vec3),across=Math.hypot(x,y);
        const inFrame=z>0&&Math.abs(focal*x/z)<=aspect/2&&Math.abs(focal*y/z)<=.5;
        const out=inFrame?Math.acos(clamp(z,-1,1))/deg*GAUGE.pitch:GAUGE.sunAt;
        sunRing.toggleAttribute('hidden',!inFrame&&across<1e-3);
        const place=across<1e-6?'translate(0px, 0px)':`translate(${(out*x/across).toFixed(2)}px, ${(-out*y/across).toFixed(2)}px)`;
        if(place!==shown.sun){shown.sun=place;sunRing.style.transform=place;}
        sunRing.toggleAttribute('data-behind',z<0);
      }
      const values={heading:`${String(Math.round(a.heading)%360).padStart(3,'0')}°`,pitch:signed(a.pitch),roll:signed(a.roll)};
      for(const k of ['heading','pitch','roll'] as const)if(shown[k]!==values[k]){shown[k]=values[k];readouts[k].textContent=values[k];}
      const current=free?'free':route;
      if(shown.mode!==current){
        shown.mode=current;
        for(const button of modeButtons)button.setAttribute('aria-pressed',String(button.dataset.route?!free&&button.dataset.route===route:free));
      }
    },
    pulse(clientX:number,clientY:number){
      if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
      const ring=pulseTemplate.cloneNode() as HTMLElement;ring.hidden=false;
      ring.style.left=`${clientX}px`;ring.style.top=`${clientY}px`;hud.append(ring);later(()=>ring.remove(),800);
    },
    dispose(){
      timers.forEach(id=>clearTimeout(id));timers.clear();
      tape.removeEventListener('pointerdown',tapeDown);tape.removeEventListener('pointermove',tapeMove);
      for(const type of ['pointerup','pointercancel','lostpointercapture'])tape.removeEventListener(type,tapeUp as EventListener);
      tape.removeEventListener('keydown',tapeKey);tape.removeEventListener('wheel',tapeWheel);
      modeButtons.forEach(button=>button.removeEventListener('click',mode));
      gauge.removeEventListener('click',level);
      lensButtons.forEach(button=>button.removeEventListener('click',lensPreset));lensControl.removeEventListener('wheel',lensWheel);
      window.removeEventListener('pointerdown',touchSeen);
      help.removeEventListener('toggle',helpToggled);window.removeEventListener('keydown',helpEscape);helpGrid.removeEventListener('wheel',helpWheel);
      dockSize.disconnect();root.style.removeProperty('--sky-inset-bottom');root.removeAttribute('data-controls-open');
    },
  };
}
export type OrbitHud=NonNullable<ReturnType<typeof createOrbitHud>>;
