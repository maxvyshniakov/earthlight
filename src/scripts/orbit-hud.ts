import { attitude, MIN_ALTITUDE, MAX_ALTITUDE, PROJECTION, type ObserverFrame, type Route } from './orbit-navigation.ts';
import { shellCoverage, SHELL } from './scene-view-scale.ts';
import { EARTH_RADIUS_KM, add, cross, dot, normalize, scale, type Vec3 } from './iss-orbit.ts';
import { dayOfYear, daysInYear } from './scene-calendar.ts';
import { GLOBE_LAND } from './globe-land.ts';
import { celestialFrame } from './celestial-sky.ts';

export type Modality='mouse'|'trackpad'|'touch';
const clamp=(x:number,a:number,b:number)=>Math.max(a,Math.min(b,x));
/** Horizon gauge geometry in its 48-unit drawing (64 px): dial radius, units per
 * degree of pitch, the Earth arc's radius, and the Sun's and Moon's marker radii
 * and where they fly: the Sun clear outside the arc, the Moon along it. */
export const GAUGE={dial:16.33,pitch:.42,earthAt:23.25,sun:4.2,sunAt:29.3,moon:3.3,moonAt:23.25};
/** The lens range, as magnifications of the 1× pinhole (about 30 mm): from a
 * 15 mm wide angle to 600 mm. */
export const LENS_MIN=.5,LENS_MAX=20;
/** Exposure compensation range in EV, shared by Settings and the HUD tape. */
export const EV_MIN=-3,EV_MAX=4;
/** Time scale, from 0× (time stands still, which is what pausing means) to
 * 1000×. Settings' slider and the HUD tape share one scale over a 0–1 fraction
 * in five equal stretches: linear from 0 to 0.1×, then four logarithmic
 * decades. Speeds keep two significant figures. */
export const SPEED_MAX=1000;
const SPEED_LOW=.1,SPEED_LOW_SHARE=1/5;
export const speedAt=(fraction:number)=>{
  const f=clamp(fraction,0,1),raw=f<=SPEED_LOW_SHARE?SPEED_LOW*f/SPEED_LOW_SHARE:SPEED_LOW*10**((f-SPEED_LOW_SHARE)/(1-SPEED_LOW_SHARE)*4);
  return raw>0?Number(raw.toPrecision(2)):0;
};
export const speedFraction=(speed:number)=>speed<=SPEED_LOW?clamp(speed,0,SPEED_LOW)/SPEED_LOW*SPEED_LOW_SHARE:clamp(SPEED_LOW_SHARE+Math.log10(speed/SPEED_LOW)/4*(1-SPEED_LOW_SHARE),0,1);
const deg=Math.PI/180;
// The Earth arc never gets shorter than 8 px, so it still reads as an arc.
const EARTH_MIN=4/GAUGE.earthAt/deg;
/** Earth fills the frame, or its whole disk is in frame. The directions that
 * meet Earth make a convex patch of the image, so it fills the frame once all
 * four corners are on it. (A frame centre on Earth used to count, which closed
 * the arc with half the frame still sky.) */
const earthWhole=(camera:ArrayLike<number>,b:number[],focal:number,aspect:number)=>{
  const p:Vec3=[camera[0],camera[1],camera[2]],far=Math.hypot(...p);
  const onEarth=(u:number,v:number)=>{
    const ray=normalize(add(add(scale(b.slice(0,3) as Vec3,u),scale(b.slice(3,6) as Vec3,v)),scale(b.slice(6,9) as Vec3,focal))),along=dot(p,ray);
    return along<0&&along*along>far*far-SHELL*SHELL;
  };
  if([[-1,-1],[1,-1],[-1,1],[1,1]].every(([u,v])=>onEarth(u*aspect/2,v/2)))return true;
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
// Whole magnifications read as such; in between, one decimal, as a phone camera shows.
const lensLabel=(zoom:number)=>zoom>=9.95||Math.abs(zoom-Math.round(zoom))<.05?String(Math.round(zoom)):zoom.toFixed(1);

/** Orbit page instruments: a replay clock, camera presets, logarithmic altitude
 * and lens tapes, a horizon gauge and the controls panel. Help covers only the
 * inputs this device has. Pure presentation; navigation happens through the
 * callbacks. */
export function createOrbitHud(root:HTMLElement,o:{route:(route:Route)=>void;free:()=>void;altitude:(km:number)=>void;current:()=>number;level:()=>void;
  /** Lens magnification about the image centre, LENS_MIN–LENS_MAX; animated unless told otherwise. */
  lens:(zoom:number,animate?:boolean)=>void;lensZoom:()=>number;
  /** Press or release a held flight key, as the keyboard would. */
  hold:(code:string,down:boolean)=>void;
  /** Reset the camera, as \ does. */
  resetCamera:()=>void;
  /** Turn the camera to face Earth's centre, or the Sun. */
  faceEarth:()=>void;faceSun:()=>void;faceMoon:()=>void;
  /** Exposure compensation in EV, or null under manual exposure; and setting it. */
  exposure:()=>number|null;setExposure:(ev:number)=>void;
  /** Set the replay's day of the year and minute of the day (UTC). */
  setDay:(day:number)=>void;setMinute:(minute:number)=>void;
  /** The time scale, 0 while time stands still; set it (0 stops time), or step it by hundredths of the scale. */
  speed:()=>number;setSpeed:(speed:number)=>void;stepSpeed:(notches:number)=>void}){
  const hud=root.querySelector<HTMLElement>('.orbit-hud'),help=root.querySelector<HTMLElement>('#flight-help'),info=root.querySelector<HTMLElement>('#sky-info');
  if(!hud||!help||!info)return null;
  const tape=hud.querySelector<HTMLElement>('#sky-altitude')!,output=hud.querySelector<HTMLOutputElement>('.altitude-output')!;
  // The dial's fill and the cuts in its mask turn together, from the variables on the dial.
  const gauge=hud.querySelector<HTMLElement>('.hud-attitude')!,horizon=gauge.querySelector<SVGElement>('.gauge')!;
  // The Sun's and Moon's cut-outs in the gauge's masks move with their markers.
  const earthArc=[...gauge.querySelectorAll<SVGPathElement>('.gauge-earth path')],sunRing=gauge.querySelector<SVGGElement>('.gauge-sun')!,sunCuts=[...gauge.querySelectorAll<SVGPathElement>('.gauge-sun-cut')];
  const moonMark=gauge.querySelector<SVGGElement>('.gauge-moon')!,moonCuts=[...gauge.querySelectorAll<SVGPathElement>('.gauge-moon-cut')];
  const pulseTemplate=hud.querySelector<HTMLElement>('.hud-pulse')!;
  const fpm=hud.querySelector<HTMLElement>('.hud-fpm')!,speed=fpm.querySelector<HTMLElement>('.hud-speed')!,canvas=root.querySelector('canvas')!;
  const modeButtons=[...hud.querySelectorAll<HTMLButtonElement>('.hud-modes :is([data-route],[data-flight-mode])')];
  const lensTape=hud.querySelector<HTMLElement>('#sky-lens')!,lensOutput=hud.querySelector<HTMLOutputElement>('.lens-output')!;
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
    tapePointer=event.pointerId;tape.setPointerCapture(event.pointerId);event.preventDefault();
    o.altitude(kmAt(event.clientY));
  };
  const tapeMove=(event:PointerEvent)=>{if(event.pointerId===tapePointer)o.altitude(kmAt(event.clientY));};
  // A pointer leaves no focus on a tape, so flight keys keep working; Tab still reaches it.
  const tapeUp=(event:PointerEvent)=>{if(event.pointerId===tapePointer){tapePointer=null;if(tape.hasPointerCapture(event.pointerId))tape.releasePointerCapture(event.pointerId);scene();}};
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
  // The lens tape mirrors the altitude tape. A press eases to its point, a drag
  // follows the pointer, and near a labelled mark either takes the mark exactly.
  const lensSpan=Math.log(LENS_MAX/LENS_MIN),lensMarks=[...lensTape.querySelectorAll<HTMLElement>('[data-mark]')].map(e=>Number(e.dataset.mark));
  const zoomAt=(clientY:number)=>{
    const r=lensTape.getBoundingClientRect(),y=(zoom:number)=>r.top+(1-Math.log(zoom/LENS_MIN)/lensSpan)*r.height;
    return lensMarks.find(zoom=>Math.abs(y(zoom)-clientY)<5)??LENS_MIN*Math.exp(lensSpan*clamp(1-(clientY-r.top)/r.height,0,1));
  };
  let lensPointer:number|null=null;
  const lensDown=(event:PointerEvent)=>{
    if(!event.isPrimary||event.button!==0)return;
    lensPointer=event.pointerId;lensTape.setPointerCapture(event.pointerId);event.preventDefault();
    o.lens(zoomAt(event.clientY));
  };
  const lensMove=(event:PointerEvent)=>{if(event.pointerId===lensPointer)o.lens(zoomAt(event.clientY),false);};
  const lensUp=(event:PointerEvent)=>{if(event.pointerId===lensPointer){lensPointer=null;if(lensTape.hasPointerCapture(event.pointerId))lensTape.releasePointerCapture(event.pointerId);scene();}};
  const lensKey=(event:KeyboardEvent)=>{
    const factor:Record<string,number>={ArrowUp:1.15,ArrowRight:1.15,ArrowDown:1/1.15,ArrowLeft:1/1.15,PageUp:2,PageDown:.5};
    const zoom=event.key==='Home'?LENS_MIN:event.key==='End'?LENS_MAX:factor[event.key]?o.lensZoom()*factor[event.key]:null;
    if(zoom===null)return;
    event.preventDefault();o.lens(clamp(zoom,LENS_MIN,LENS_MAX));
  };
  const lensWheel=(event:WheelEvent)=>{event.preventDefault();o.lens(o.lensZoom()*Math.exp(-(event.deltaY||event.deltaX)*.004),false);};
  const paintLens=(zoom:number)=>{
    const label=`${lensLabel(zoom)}×`;
    lensTape.style.setProperty('--at',`${(1-clamp(Math.log(zoom/LENS_MIN)/lensSpan,0,1))*100}%`);
    if(lensOutput.value!==label){lensOutput.value=label;lensTape.setAttribute('aria-valuenow',lensLabel(zoom));lensTape.setAttribute('aria-valuetext',`${label}, ${Math.round(30*zoom)} mm`);}
  };

  // Key caps on the screen work as the keys: hold R, F, + or −, the roll keys or
  // the arrows; Space stops or starts time, 0 takes the lens to 1×, \ resets the camera.
  // Focus goes back to the scene, so the keyboard keeps working.
  const scene=()=>root.closest<HTMLElement>('.orbit-view')?.focus({preventScroll:true});
  const holdButtons=[...hud.querySelectorAll<HTMLButtonElement>('[data-hold]')];
  const holdDown=(event:PointerEvent)=>{
    if(!event.isPrimary||event.button!==0)return;
    const button=event.currentTarget as HTMLButtonElement;
    event.preventDefault();button.setPointerCapture(event.pointerId);o.hold(button.dataset.hold!,true);
  };
  const holdUp=(event:PointerEvent)=>{o.hold((event.currentTarget as HTMLElement).dataset.hold!,false);scene();};
  const motionToggle=hud.querySelector<HTMLButtonElement>('.hud-time-toggle')!;
  const actions:Record<string,()=>void>={Space:()=>motionToggle.click(),Digit0:()=>o.lens(1),Backslash:()=>o.resetCamera()};
  const pressButtons=[...hud.querySelectorAll<HTMLButtonElement>('[data-press]')];
  const press=(event:Event)=>{
    const code=(event.currentTarget as HTMLElement).dataset.press!;
    actions[code]?.();key(code,true);later(()=>key(code,false),120);refocus(event);
  };

  // Exposure compensation: a short linear tape over the lens tape. A press or
  // drag sets it to a tenth of a stop, and near a whole stop takes the stop.
  const evMeter=hud.querySelector<HTMLElement>('.hud-ev')!,evTape=evMeter.querySelector<HTMLElement>('.hud-tape')!,evOutput=evTape.querySelector<HTMLOutputElement>('output')!;
  const evSet=(ev:number)=>o.setExposure(clamp(Math.round(ev*10)/10,EV_MIN,EV_MAX));
  const evAt=(clientY:number)=>{
    const r=evTape.getBoundingClientRect(),ev=EV_MAX-(EV_MAX-EV_MIN)*clamp((clientY-r.top)/r.height,0,1),stop=Math.round(ev);
    return Math.abs(r.top+(EV_MAX-stop)/(EV_MAX-EV_MIN)*r.height-clientY)<5?stop:ev;
  };
  let evPointer:number|null=null,evWheelRest=0;
  const evDown=(event:PointerEvent)=>{
    if(!event.isPrimary||event.button!==0)return;
    evPointer=event.pointerId;evTape.setPointerCapture(event.pointerId);event.preventDefault();
    evSet(evAt(event.clientY));
  };
  const evMove=(event:PointerEvent)=>{if(event.pointerId===evPointer)evSet(evAt(event.clientY));};
  const evUp=(event:PointerEvent)=>{if(event.pointerId===evPointer){evPointer=null;if(evTape.hasPointerCapture(event.pointerId))evTape.releasePointerCapture(event.pointerId);scene();}};
  const evKey=(event:KeyboardEvent)=>{
    const step:Record<string,number>={ArrowUp:.1,ArrowRight:.1,ArrowDown:-.1,ArrowLeft:-.1,PageUp:1,PageDown:-1},now=o.exposure()??0;
    const ev=event.key==='Home'?EV_MIN:event.key==='End'?EV_MAX:event.key in step?now+step[event.key]:null;
    if(ev===null)return;
    event.preventDefault();evSet(ev);
  };
  // Small trackpad deltas add up until they make a tenth of a stop.
  const evWheel=(event:WheelEvent)=>{
    event.preventDefault();evWheelRest-=(event.deltaY||event.deltaX)*.005;
    const tenths=Math.trunc(evWheelRest*10)/10;
    if(tenths){evWheelRest-=tenths;evSet((o.exposure()??0)+tenths);}
  };

  // The top tapes run sideways: press or drag along one, scroll over it, or use
  // the arrow keys. A press near a labelled mark takes the mark.
  const sideways=(tape:HTMLElement,set:(fraction:number)=>void,step:(steps:number)=>void)=>{
    const marks=[...tape.querySelectorAll<HTMLElement>('[data-at]')].map(e=>Number(e.dataset.at));
    const at=(clientX:number)=>{const r=tape.getBoundingClientRect(),f=clamp((clientX-r.left)/r.width,0,1);return marks.find(m=>Math.abs(m-f)*r.width<5)??f;};
    let pointer:number|null=null,rest=0;
    const down=(event:PointerEvent)=>{
      if(!event.isPrimary||event.button!==0)return;
      pointer=event.pointerId;tape.setPointerCapture(event.pointerId);event.preventDefault();set(at(event.clientX));
    };
    const move=(event:PointerEvent)=>{if(event.pointerId===pointer)set(at(event.clientX));};
    const up=(event:PointerEvent)=>{if(event.pointerId===pointer){pointer=null;if(tape.hasPointerCapture(event.pointerId))tape.releasePointerCapture(event.pointerId);scene();}};
    const key=(event:KeyboardEvent)=>{
      const steps:Record<string,number>={ArrowRight:1,ArrowUp:1,ArrowLeft:-1,ArrowDown:-1,PageUp:10,PageDown:-10};
      if(event.key==='Home'||event.key==='End'){event.preventDefault();set(event.key==='Home'?0:1);}
      else if(event.key in steps){event.preventDefault();step(steps[event.key]);}
    };
    // A wheel notch is a few steps; small trackpad deltas add up.
    const wheel=(event:WheelEvent)=>{
      event.preventDefault();rest+=(Math.abs(event.deltaX)>Math.abs(event.deltaY)?event.deltaX:-event.deltaY)/40;
      const steps=Math.trunc(rest);if(steps){rest-=steps;step(steps);}
    };
    const ends=['pointerup','pointercancel','lostpointercapture'];
    tape.addEventListener('pointerdown',down);tape.addEventListener('pointermove',move);ends.forEach(type=>tape.addEventListener(type,up as EventListener));
    tape.addEventListener('keydown',key);tape.addEventListener('wheel',wheel,{passive:false});
    return ()=>{
      tape.removeEventListener('pointerdown',down);tape.removeEventListener('pointermove',move);ends.forEach(type=>tape.removeEventListener(type,up as EventListener));
      tape.removeEventListener('keydown',key);tape.removeEventListener('wheel',wheel);
    };
  };
  // The date tape spans a common year; a leap year's last day sits at its end.
  const dayTape=hud.querySelector<HTMLElement>('#sky-day')!,minuteTape=hud.querySelector<HTMLElement>('#sky-minute')!,speedTape=hud.querySelector<HTMLElement>('#sky-speed')!;
  let today={day:0,days:365,minute:0};
  const clockTapes=[
    sideways(dayTape,f=>o.setDay(Math.min(today.days-1,Math.round(f*365))),n=>o.setDay(clamp(today.day+n,0,today.days-1))),
    sideways(minuteTape,f=>o.setMinute(Math.min(1439,Math.round(f*1440))),n=>o.setMinute(clamp(Math.floor(today.minute)+n*5,0,1439))),
    sideways(speedTape,f=>o.setSpeed(speedAt(f)),n=>o.stepSpeed(n)),
  ];
  const clockDate=new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'});
  const paintClock=(date:Date)=>{
    const day=dayOfYear(date),minute=(date.getTime()-Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate()))/60000;
    today={day,days:daysInYear(date.getUTCFullYear()),minute};
    dayTape.style.setProperty('--at',`${clamp((day+minute/1440)/365,0,1)*100}%`);
    minuteTape.style.setProperty('--at',`${minute/1440*100}%`);
    const dayLabel=clockDate.format(date),timeLabel=`${date.toISOString().slice(11,19)} UTC`;
    if(shown.day!==dayLabel){shown.day=dayLabel;dayTape.querySelector('output')!.value=dayLabel;dayTape.setAttribute('aria-valuenow',String(day));dayTape.setAttribute('aria-valuetext',dayLabel);}
    if(shown.time!==timeLabel){shown.time=timeLabel;minuteTape.querySelector('output')!.value=timeLabel;minuteTape.setAttribute('aria-valuenow',String(Math.floor(minute)));minuteTape.setAttribute('aria-valuetext',timeLabel);}
    const speed=o.speed();
    if(shown.speed!==speed){shown.speed=speed;speedTape.style.setProperty('--at',`${speedFraction(speed)*100}%`);speedTape.setAttribute('aria-valuenow',String(speed));speedTape.setAttribute('aria-valuetext',`${speed}×`);}
  };

  // The WASD globe: an orthographic Earth centred under the camera, north up,
  // with land filled the colour of the tapes' ticks and the far side unseen.
  // Each device pixel of the disc is traced back to a latitude and longitude
  // in the land mask, four samples a pixel for smooth coasts.
  const landBits=Uint8Array.from(atob(GLOBE_LAND.bits),c=>c.charCodeAt(0));
  const onLand=(lat:number,lon:number)=>{
    const x=Math.floor((lon/(2*Math.PI)+.5)*GLOBE_LAND.width)%GLOBE_LAND.width,y=Math.min(GLOBE_LAND.height-1,Math.floor((lat/Math.PI+.5)*GLOBE_LAND.height)),i=y*GLOBE_LAND.width+x;
    return (landBits[i>>3]>>(i&7))&1;
  };
  const globeCanvas=hud.querySelector<HTMLCanvasElement>('.hud-globe canvas')!,globeContext=globeCanvas.getContext('2d');
  const paintGlobe=(latitude:number,longitude:number)=>{
    if(!globeContext)return;
    const ratio=Math.min(3,Math.max(1,Math.round(devicePixelRatio||1))),size=18*ratio,radius=8.5*ratio,centre=size/2;
    if(globeCanvas.width!==size){globeCanvas.width=size;globeCanvas.height=size;}
    const lat0=latitude*deg,lon0=longitude*deg,sl=Math.sin(lat0),cl=Math.cos(lat0),so=Math.sin(lon0),co=Math.cos(lon0);
    const image=globeContext.createImageData(size,size);
    for(let py=0;py<size;py++)for(let px=0;px<size;px++){
      let covered=0;
      for(const [sx,sy] of [[.25,.25],[.75,.25],[.25,.75],[.75,.75]]){
        const x=(px+sx-centre)/radius,y=(centre-py-sy)/radius,d=x*x+y*y;
        if(d>1)continue;
        // East, north and out from the centre point, in Earth-fixed axes.
        const z=Math.sqrt(1-d),wx=-so*x-sl*co*y+cl*co*z,wy=co*x-sl*so*y+cl*so*z,wz=cl*y+sl*z;
        covered+=onLand(Math.asin(Math.max(-1,Math.min(1,wz))),Math.atan2(wy,wx));
      }
      if(covered){const i=(py*size+px)*4;image.data[i]=image.data[i+1]=image.data[i+2]=255;image.data[i+3]=Math.round(covered/4*128);}
    }
    globeContext.putImageData(image,0,0);
  };

  // The ground pin. Points on the ground round the anchor are projected through
  // the last frame's camera; sizes scale with the depth so the pin keeps its
  // size on screen. It hides on Earth's far side or behind the camera.
  const pinLayer=hud.querySelector<HTMLElement>('.hud-pin')!,pinSpot=pinLayer.querySelector<SVGPathElement>('.pin-spot')!;
  const pinRings=[...pinLayer.querySelectorAll<SVGPathElement>('.pin-ring')],pinStalks=[...pinLayer.querySelectorAll<SVGLineElement>('.pin-stalk')];
  const pinHead=pinLayer.querySelector<SVGCircleElement>('.pin-head')!,pinRipples=[...pinLayer.querySelectorAll<SVGPathElement>('.pin-ripples path')];
  let view:{camera:Vec3;basis:number[];focal:number}|null=null,pinned:{anchor:Vec3;since:number;until:number}|null=null,pinFrame=0;
  const PIN={ring:12,stalk:26,ripple:900,fade:250};
  const drawPin=(now:number)=>{
    pinFrame=0;
    if(!pinned||!view){pinLayer.toggleAttribute('hidden',true);return;}
    const {anchor,since,until}=pinned,up=normalize(anchor),r=canvas.getBoundingClientRect(),b=view.basis;
    const toward=add(anchor,scale(view.camera,-1)),depth=dot(toward,b.slice(6,9) as Vec3);
    const fading=until?Math.max(0,1-(now-until)/PIN.fade):1;
    if(until&&fading===0){pinned=null;pinLayer.toggleAttribute('hidden',true);return;}
    // The near side faces the camera; behind it, or past the horizon, nothing shows.
    if(depth<=1e-6||dot(toward,up)>=0){pinLayer.toggleAttribute('hidden',true);pinFrame=requestAnimationFrame(drawPin);return;}
    const project=(p:Vec3)=>{const d=add(p,scale(view!.camera,-1)),z=Math.max(1e-6,dot(d,b.slice(6,9) as Vec3));return [r.width/2+view!.focal*dot(d,b.slice(0,3) as Vec3)/z*r.height,r.height/2-view!.focal*dot(d,b.slice(3,6) as Vec3)/z*r.height];};
    const perPixel=depth/(view.focal*r.height),across=normalize(cross(up,Math.abs(up[2])<.9?[0,0,1]:[1,0,0])),along=cross(up,across);
    const ring=(pixels:number)=>Array.from({length:41},(_,i)=>{const a=i/40*2*Math.PI;return project(add(anchor,scale(add(scale(across,Math.cos(a)),scale(along,Math.sin(a))),pixels*perPixel)));}).map(([x,y],i)=>`${i?'L':'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('')+'Z';
    const base=project(anchor),top=project(add(anchor,scale(up,PIN.stalk*perPixel))),outline=ring(PIN.ring);
    pinSpot.setAttribute('d',outline);pinRings.forEach(path=>path.setAttribute('d',outline));
    pinStalks.forEach(line=>{line.setAttribute('x1',base[0].toFixed(1));line.setAttribute('y1',base[1].toFixed(1));line.setAttribute('x2',top[0].toFixed(1));line.setAttribute('y2',top[1].toFixed(1));});
    pinHead.setAttribute('cx',top[0].toFixed(1));pinHead.setAttribute('cy',top[1].toFixed(1));
    // Ripples spread over the ground as the pin lands, like rings on water.
    let rippling=false;
    pinRipples.forEach((path,i)=>{
      const t=still.matches?1:(now-since-i*220)/PIN.ripple;
      if(t<=0||t>=1){path.setAttribute('d','');return;}
      rippling=true;path.setAttribute('d',ring(PIN.ring*(1+2.6*t)));path.style.opacity=String((1-t)*.9);
    });
    pinLayer.style.opacity=String(fading);pinLayer.toggleAttribute('hidden',false);
    if(!until||fading>0||rippling)pinFrame=requestAnimationFrame(drawPin);
  };
  const showPin=(anchor:Vec3,until:number)=>{const now=performance.now();pinned={anchor,since:now,until};cancelAnimationFrame(pinFrame);drawPin(now);};

  const touchSeen=(event:PointerEvent)=>{if(event.pointerType==='touch')setModality('touch');else if(event.pointerType==='pen'||modality==='touch')setModality('mouse');else seen('pointer');};

  tape.addEventListener('pointerdown',tapeDown);tape.addEventListener('pointermove',tapeMove);
  for(const type of ['pointerup','pointercancel','lostpointercapture'])tape.addEventListener(type,tapeUp as EventListener);
  tape.addEventListener('keydown',tapeKey);tape.addEventListener('wheel',tapeWheel,{passive:false});
  modeButtons.forEach(button=>button.addEventListener('click',mode));
  // A click on the dial levels the view, and turns a level one over, as H does.
  // The gauge's three targets: the dial levels or flips, as H does; the Earth
  // arc and the Sun ring turn the camera to face them. Enter or Space works on
  // each, as on a button.
  const gaugeTargets:[Element,()=>void][]=[[gauge.querySelector('.gauge-dial')!,()=>o.level()],[gauge.querySelector('.gauge-earth')!,()=>o.faceEarth()],[sunRing,()=>o.faceSun()],[moonMark,()=>o.faceMoon()]];
  const gaugeClick=(event:Event)=>{gaugeTargets.find(([target])=>target===event.currentTarget)?.[1]();refocus(event);};
  const gaugeKey=(event:Event)=>{const key=(event as KeyboardEvent).key;if(key==='Enter'||key===' '){event.preventDefault();event.stopPropagation();gaugeTargets.find(([target])=>target===event.currentTarget)?.[1]();}};
  gaugeTargets.forEach(([target])=>{target.addEventListener('click',gaugeClick);target.addEventListener('keydown',gaugeKey);});
  lensTape.addEventListener('pointerdown',lensDown);lensTape.addEventListener('pointermove',lensMove);
  for(const type of ['pointerup','pointercancel','lostpointercapture'])lensTape.addEventListener(type,lensUp as EventListener);
  lensTape.addEventListener('keydown',lensKey);lensTape.addEventListener('wheel',lensWheel,{passive:false});
  evTape.addEventListener('pointerdown',evDown);evTape.addEventListener('pointermove',evMove);
  for(const type of ['pointerup','pointercancel','lostpointercapture'])evTape.addEventListener(type,evUp as EventListener);
  evTape.addEventListener('keydown',evKey);evTape.addEventListener('wheel',evWheel,{passive:false});
  for(const button of holdButtons){
    button.addEventListener('pointerdown',holdDown);
    for(const type of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(type,holdUp as EventListener);
  }
  pressButtons.forEach(button=>button.addEventListener('click',press));
  // The controls panel docks under the scene and shrinks it, as a phone's
  // browser bars do, so the scene's resize path gets exercised here too. While
  // it slides the scene ends at its edge, frame by frame, and the lens rides
  // above the tab on that edge.
  const helpTab=help.querySelector<HTMLElement>('.help-close')!;
  const dockInset=()=>{
    const style=getComputedStyle(help),tab=helpTab.offsetHeight;
    const slid=style.transform==='none'?0:new DOMMatrixReadOnly(style.transform).m42;
    const shown=style.display==='none'?0:Math.max(0,help.offsetHeight+tab-slid);
    root.style.setProperty('--sky-inset-bottom',`${Math.max(0,shown-tab)}px`);
    root.style.setProperty('--hud-dock-lift',`${Math.min(shown,tab)}px`);
  };
  const dockSize=new ResizeObserver(dockInset);
  let dockFrame=0;
  const dockFollow=()=>{dockInset();dockFrame=help.getAnimations().length?requestAnimationFrame(dockFollow):0;};
  const helpToggled=()=>{
    const open=help.matches(':popover-open');
    root.toggleAttribute('data-controls-open',open);
    if(open)dockSize.observe(help);else dockSize.unobserve(help);
    cancelAnimationFrame(dockFrame);dockFollow();
  };
  // It stays open while you fly; Escape closes it unless a dialog takes the key.
  const helpEscape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&help.matches(':popover-open')&&!root.querySelector('[popover="auto"]:popover-open'))help.hidePopover();};
  // The panel scrolls sideways; a plain wheel does that too, unless it is too
  // short for its lanes and has to scroll down as well.
  const helpGrid=help.querySelector<HTMLElement>('.help-grid')!;
  const helpWheel=(event:WheelEvent)=>{if(Math.abs(event.deltaY)>Math.abs(event.deltaX)&&helpGrid.scrollWidth>helpGrid.clientWidth&&helpGrid.scrollHeight<=helpGrid.clientHeight){event.preventDefault();helpGrid.scrollLeft+=event.deltaY;}};
  help.addEventListener('toggle',helpToggled);window.addEventListener('keydown',helpEscape);helpGrid.addEventListener('wheel',helpWheel,{passive:false});
  window.addEventListener('pointerdown',touchSeen,{passive:true});

  let dialRoll=0;
  // The Earth arc eases to each new extent, so it closes and opens visibly
  // instead of snapping; its centre follows the roll at once.
  const earth={centre:90,half:EARTH_MIN,target:EARTH_MIN,at:0,frame:0},still=matchMedia('(prefers-reduced-motion: reduce)');
  const easeEarth=(now:number)=>{
    const dt=earth.at?Math.min(.1,(now-earth.at)/1000):0;
    earth.half=still.matches?earth.target:earth.target+(earth.half-earth.target)*Math.exp(-dt/.09);
    if(Math.abs(earth.half-earth.target)<.1)earth.half=earth.target;
    const d=arc(earth.centre,earth.half);
    if(d!==shown.earth){shown.earth=d;earthArc.forEach(path=>path.setAttribute('d',d));}
    const moving=earth.half!==earth.target;
    earth.at=moving?now:0;earth.frame=moving?requestAnimationFrame(easeEarth):0;
  };
  const shown={moon:'',globe:[999,0],ev:NaN as number|null,day:'',time:'',speed:NaN,altitude:-1,lens:-1,mode:'',earth:'',sun:''};
  return {
    setModality,key,
    get modality(){return modality;},
    toggleHelp(){help.togglePopover();},
    toggleInfo(){info.togglePopover();},
    frame(frame:ObserverFrame&{focal?:number;sun?:Vec3},free:boolean,route:Route,motion:Vec3){
      // Flight path marker: where the camera is heading, and how fast, through the frame's lens.
      const focal=frame.focal??PROJECTION,b=frame.cameraBasis,kms=Math.hypot(...motion)*EARTH_RADIUS_KM,z=dot(motion,b.slice(6,9) as Vec3);
      const r=canvas.getBoundingClientRect();
      view={camera:[frame.camera[0],frame.camera[1],frame.camera[2]],basis:[...b],focal};
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
      paintClock(frame.date);
      // The globe redraws only once the camera has moved a tenth of a degree.
      if(Math.abs(frame.latitude-shown.globe[0])>.1||Math.abs(((frame.longitude-shown.globe[1])%360+540)%360-180)>.1){shown.globe=[frame.latitude,frame.longitude];paintGlobe(frame.latitude,frame.longitude);}
      const ev=o.exposure();
      if(ev!==shown.ev){
        shown.ev=ev;evMeter.hidden=ev===null;
        if(ev!==null){
          const label=`${ev>0?'+':ev<0?'−':''}${Math.abs(ev).toFixed(1)} EV`;
          evTape.style.setProperty('--at',`${(EV_MAX-ev)/(EV_MAX-EV_MIN)*100}%`);
          evOutput.value=label;evTape.setAttribute('aria-valuenow',String(ev));evTape.setAttribute('aria-valuetext',label);
        }
      }
      const km=frame.altitude;
      if(Math.abs(km-shown.altitude)>.05){
        shown.altitude=km;
        tape.style.setProperty('--at',`${(1-clamp(Math.log(km/MIN_ALTITUDE)/span,0,1))*100}%`);
        const label=`${Math.round(km).toLocaleString('en-US')} km`;
        if(output.value!==label){output.value=label;tape.setAttribute('aria-valuenow',String(Math.round(km)));tape.setAttribute('aria-valuetext',label);}
      }
      const a=attitude(frame);
      // Roll runs on past ±180°, so the dial's short transition never spins the
      // long way round when the view turns over.
      dialRoll=a.roll+360*Math.round((dialRoll-a.roll)/360);
      horizon.style.setProperty('--roll',`${dialRoll.toFixed(2)}deg`);
      // The dial's horizon is the one in the picture: Earth's edge, which sinks
      // below the local horizontal as the camera climbs (12° at 150 km, 30° at
      // 1,000 km, 71° at 13,000 km). Once Earth's disk is narrower than the
      // dial's reach, its ground side stretches, so looking straight down still
      // fills the dial and the horizon never swings about the nadir.
      const far=Math.hypot(frame.camera[0],frame.camera[1],frame.camera[2]),dip=Math.acos(Math.min(1,1/far))/deg;
      const above=a.pitch+dip,seen=above<0?above*Math.max(1,GAUGE.dial/GAUGE.pitch/Math.max(1,90-dip)):above;
      const shift=clamp(seen*GAUGE.pitch,-38,38);
      horizon.style.setProperty('--pitch',`${shift.toFixed(2)}px`);
      // Earth: an arc about the ground side, as long as the share of Earth's
      // surface in frame against what looking straight at it would show. A sliver at the
      // edge is a short arc; it closes once Earth fills the frame or its whole
      // disk is in it, and stays closed while flying straight away from it.
      const aspect=r.width/Math.max(1,r.height),down=scale(frame.camera as unknown as Vec3,-1/far);
      const across=normalize(cross(down,Math.abs(down[2])<.9?[0,0,1]:[1,0,0])),straight=[...across,...cross(down,across),...down];
      const most=shellCoverage(frame.camera,straight,focal,aspect,32,20,1),share=most>0?Math.min(1,shellCoverage(frame.camera,b,focal,aspect,32,20,1)/most):0;
      earth.centre=90+a.roll;
      earth.target=earthWhole(frame.camera,b,focal,aspect)?180:Math.max(EARTH_MIN,180*share);
      if(!earth.frame)easeEarth(performance.now());
      // Sun and Moon: markers at their directions across the image, the Sun
      // outside the Earth arc and the Moon along it. In frame each flies inside
      // the dial, as far out as the pitch ladder would put it.
      const mark=(direction:Vec3,at:number,marker:SVGGElement,cuts:SVGPathElement[],key:'sun'|'moon')=>{
        const x=dot(direction,b.slice(0,3) as Vec3),y=dot(direction,b.slice(3,6) as Vec3),z=dot(direction,b.slice(6,9) as Vec3),across=Math.hypot(x,y);
        const inFrame=z>0&&Math.abs(focal*x/z)<=aspect/2&&Math.abs(focal*y/z)<=.5;
        const out=inFrame?Math.acos(clamp(z,-1,1))/deg*GAUGE.pitch:at;
        const hidden=!inFrame&&across<1e-3;marker.toggleAttribute('hidden',hidden);cuts.forEach(cut=>cut.toggleAttribute('hidden',hidden));
        const point=across<1e-6?[0,0]:[out*x/across,-out*y/across],place=`translate(${point[0].toFixed(2)}px, ${point[1].toFixed(2)}px)`;
        if(place!==shown[key]){shown[key]=place;marker.style.transform=place;cuts.forEach(cut=>cut.style.transform=place);}
        return point;
      };
      if(frame.sun){
        mark(frame.sun,GAUGE.sunAt,sunRing,sunCuts,'sun');
        mark(celestialFrame(frame.date,frame.camera as Vec3).moon.slice(0,3) as Vec3,GAUGE.moonAt,moonMark,moonCuts,'moon');
      }
      const current=free?'free':route;
      if(shown.mode!==current){
        shown.mode=current;
        for(const button of modeButtons)button.setAttribute('aria-pressed',String(button.dataset.route?!free&&button.dataset.route===route:free));
      }
    },
    /** Pin the point a right-drag circles, or let it go (null), fading out. */
    pin(anchor:Vec3|null){
      if(anchor)showPin(anchor,0);
      else if(pinned&&!pinned.until){pinned.until=performance.now();if(!pinFrame)pinFrame=requestAnimationFrame(drawPin);}
    },
    /** Drop the pin where a double-click flies: it lands with ripples, then fades. */
    drop(anchor:Vec3){showPin(anchor,performance.now()+PIN.ripple+200);},
    pulse(clientX:number,clientY:number){
      if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
      const ring=pulseTemplate.cloneNode() as HTMLElement;ring.hidden=false;
      ring.style.left=`${clientX}px`;ring.style.top=`${clientY}px`;hud.append(ring);later(()=>ring.remove(),800);
    },
    dispose(){
      timers.forEach(id=>clearTimeout(id));timers.clear();cancelAnimationFrame(pinFrame);
      tape.removeEventListener('pointerdown',tapeDown);tape.removeEventListener('pointermove',tapeMove);
      for(const type of ['pointerup','pointercancel','lostpointercapture'])tape.removeEventListener(type,tapeUp as EventListener);
      tape.removeEventListener('keydown',tapeKey);tape.removeEventListener('wheel',tapeWheel);
      modeButtons.forEach(button=>button.removeEventListener('click',mode));
      gaugeTargets.forEach(([target])=>{target.removeEventListener('click',gaugeClick);target.removeEventListener('keydown',gaugeKey);});
      lensTape.removeEventListener('pointerdown',lensDown);lensTape.removeEventListener('pointermove',lensMove);
      for(const type of ['pointerup','pointercancel','lostpointercapture'])lensTape.removeEventListener(type,lensUp as EventListener);
      lensTape.removeEventListener('keydown',lensKey);lensTape.removeEventListener('wheel',lensWheel);
      evTape.removeEventListener('pointerdown',evDown);evTape.removeEventListener('pointermove',evMove);
      for(const type of ['pointerup','pointercancel','lostpointercapture'])evTape.removeEventListener(type,evUp as EventListener);
      evTape.removeEventListener('keydown',evKey);evTape.removeEventListener('wheel',evWheel);
      clockTapes.forEach(dispose=>dispose());
      for(const button of holdButtons){
        button.removeEventListener('pointerdown',holdDown);
        for(const type of ['pointerup','pointercancel','lostpointercapture'])button.removeEventListener(type,holdUp as EventListener);
      }
      pressButtons.forEach(button=>button.removeEventListener('click',press));
      window.removeEventListener('pointerdown',touchSeen);
      help.removeEventListener('toggle',helpToggled);window.removeEventListener('keydown',helpEscape);helpGrid.removeEventListener('wheel',helpWheel);
      dockSize.disconnect();cancelAnimationFrame(dockFrame);cancelAnimationFrame(earth.frame);root.style.removeProperty('--sky-inset-bottom');root.style.removeProperty('--hud-dock-lift');root.removeAttribute('data-controls-open');
    },
  };
}
export type OrbitHud=NonNullable<ReturnType<typeof createOrbitHud>>;
