import type { FlightInput } from './orbit-navigation.ts';
import type { ScrollSession } from './orbit-camera.ts';
import { SCENE_CONTROLS } from './orbit-camera-drag.ts';

export type FlightCommand='level'|'help'|'route-iss'|'route-polar'|'route-high'|'zoom-in'|'zoom-out';
export type WheelDevice='mouse'|'trackpad';
const HELD=['KeyW','KeyA','KeyS','KeyD','KeyR','KeyF','KeyQ','KeyE','KeyZ','KeyX','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','ShiftLeft','ShiftRight'];
const COMMANDS:Record<string,FlightCommand>={KeyH:'level',Digit1:'route-iss',Digit2:'route-polar',Digit3:'route-high',Equal:'zoom-in',NumpadAdd:'zoom-in',Minus:'zoom-out',NumpadSubtract:'zoom-out'};
type GestureEvent=UIEvent&{scale:number;rotation:number;clientX:number;clientY:number;shiftKey:boolean};
// Shift-wheel steps the lens by a third of a doubling per notch.
const LENS_NOTCH=Math.log(2)/3;

/** Keys, wheels and Safari trackpad gestures on a real-time clock, independent
 * of replay speed and pause. A wheel that clicks approaches; a trackpad scroll
 * drags whatever is under the pointer, as a finger would. With Shift the
 * camera stays put: scrolling looks, and a clicky wheel or a pinch zooms the
 * lens about the pointer. */
export function createFlightControls(surface:HTMLElement,options:{
  enabled:()=>boolean;
  step:(dt:number,input:FlightInput)=>boolean;
  zoom:(log:number,clientX:number,clientY:number,smooth:boolean)=>void;
  /** Lens zoom by e^log about the pointer; positive magnifies. */
  lens:(log:number,clientX:number,clientY:number,smooth:boolean)=>void;
  roll:(angle:number)=>void;
  scroll:(clientX:number,clientY:number,lookOnly:boolean)=>ScrollSession|null;
  command:(command:FlightCommand)=>void;
  key:(code:string,down:boolean)=>void;
  device:(device:WheelDevice)=>void;
  touching:()=>boolean;
  stop:()=>void;
}){
  const keys=new Set<string>();let frame=0,last=0;
  let scroll:{session:ScrollSession|null;timer:number}|null=null;
  let wheel:{kind:'zoom'|'scroll';time:number}|null=null;
  let gesture:{scale:number;rotation:number;rolling:boolean}|null=null;
  const typing=(target:EventTarget|null)=>target instanceof Element&&!!target.closest('input,select,textarea,[contenteditable]:not([contenteditable="false"]),[role="slider"]');
  const control=(target:EventTarget|null)=>target instanceof Element&&!!target.closest(SCENE_CONTROLS);
  const held=(code:string)=>Number(keys.has(code));
  const input=():FlightInput=>({forward:held('KeyW')-held('KeyS'),right:held('KeyD')-held('KeyA'),climb:held('KeyR')-held('KeyF'),
    roll:held('KeyQ')-held('KeyE'),yaw:held('ArrowRight')-held('ArrowLeft'),pitch:held('ArrowUp')-held('ArrowDown'),lens:held('KeyZ')-held('KeyX'),
    fast:keys.has('ShiftLeft')||keys.has('ShiftRight')});
  const loop=(now:number)=>{
    frame=0;if(document.hidden){cancel();return;}
    const dt=last?Math.min(.05,(now-last)/1000):1/60;last=now;
    const active=options.step(dt,input());
    if(active||keys.size||scroll)frame=requestAnimationFrame(loop);else last=0;
  };
  const request=()=>{if(!frame&&!document.hidden)frame=requestAnimationFrame(loop);};
  const release=(code:string)=>{if(keys.delete(code))options.key(code,false);};
  const down=(event:KeyboardEvent)=>{
    if(!options.enabled()||event.defaultPrevented||event.ctrlKey||event.metaKey||event.altKey||typing(event.target))return;
    if(event.key==='?'){event.preventDefault();options.command('help');return;}
    const command=COMMANDS[event.code];
    if(command&&!event.shiftKey){event.preventDefault();if(!event.repeat){options.key(event.code,true);options.command(command);}return;}
    if(!HELD.includes(event.code))return;
    event.preventDefault();
    if(!keys.has(event.code)){keys.add(event.code);options.key(event.code,true);}
    request();
  };
  const up=(event:KeyboardEvent)=>{
    if(COMMANDS[event.code])options.key(event.code,false);
    release(event.code);
    // macOS sends no keyup for keys held while Command goes down.
    if(event.key==='Meta')[...keys].forEach(release);
  };
  const endScroll=()=>{if(scroll){clearTimeout(scroll.timer);scroll=null;}};
  // Chromium on macOS reports clicky wheels in multiples of 4.000244140625;
  // WebKit and Windows report 120-unit legacy deltas that trackpads never match.
  // macOS turns Shift-wheel into a horizontal scroll, so with Shift the same
  // signature counts on the horizontal axis.
  const clicky=(event:WheelEvent)=>{
    if(event.deltaMode!==0)return true;
    const sideways=event.shiftKey&&event.deltaY===0;
    const delta=sideways?event.deltaX:event.deltaY,across=sideways?event.deltaY:event.deltaX;
    if(across!==0||delta===0)return false;
    const legacy=(event as WheelEvent&{wheelDeltaX?:number;wheelDeltaY?:number})[sideways?'wheelDeltaX':'wheelDeltaY'];
    return Math.abs(delta)%4.000244140625===0||!!legacy&&legacy%120===0&&legacy!==-3*delta;
  };
  const onWheel=(event:WheelEvent)=>{
    if(control(event.target)||event.defaultPrevented)return;
    event.preventDefault();
    if(!options.enabled())return;
    const unit=event.deltaMode===1?16:event.deltaMode===2?surface.clientHeight:1;
    // Trackpad pinch arrives as Ctrl-wheel in Chromium and Firefox; with Shift it zooms the lens.
    if(event.ctrlKey){
      if(!gesture){
        endScroll();
        if(event.shiftKey)options.lens(-event.deltaY*unit*.01,event.clientX,event.clientY,false);
        else options.zoom(event.deltaY*unit*.01,event.clientX,event.clientY,false);
        options.device('trackpad');
      }
      return;
    }
    const now=performance.now();
    if(!wheel||now-wheel.time>220)wheel={kind:clicky(event)?'zoom':'scroll',time:now};
    wheel.time=now;
    if(wheel.kind==='zoom'){
      endScroll();options.device('mouse');
      // Shift-wheel may arrive on either axis; wheel up approaches or magnifies.
      const delta=event.deltaY||event.deltaX,size=Math.abs(delta);
      const notches=event.deltaMode===1?size/3:size%4.000244140625===0?size/4.000244140625:size/100;
      const step=Math.sign(delta)*Math.min(3,Math.max(.25,notches));
      if(event.shiftKey)options.lens(-step*LENS_NOTCH,event.clientX,event.clientY,true);
      else options.zoom(step*.28,event.clientX,event.clientY,true);
      return;
    }
    options.device('trackpad');
    // macOS keeps sending momentum after the fingers lift, so a flick coasts.
    if(!scroll)scroll={session:options.scroll(event.clientX,event.clientY,event.shiftKey),timer:0};
    clearTimeout(scroll.timer);scroll.timer=window.setTimeout(endScroll,160);
    scroll.session?.by(-event.deltaX*unit,-event.deltaY*unit);request();
  };
  // Safari reports trackpad pinch and rotation as its own gesture events.
  const gestureStart=(event:Event)=>{
    if(control(event.target)||options.touching())return;
    event.preventDefault();endScroll();gesture={scale:1,rotation:0,rolling:false};
  };
  const gestureChange=(event:Event)=>{
    if(!gesture||options.touching())return;
    event.preventDefault();options.device('trackpad');
    const e=event as GestureEvent;
    // With Shift a pinch zooms the lens instead, and never rolls.
    if(e.shiftKey)options.lens(Math.log(e.scale/gesture.scale),e.clientX,e.clientY,false);
    else{
      options.zoom(-Math.log(e.scale/gesture.scale),e.clientX,e.clientY,false);
      gesture.rolling||=Math.abs(e.rotation)>10;
      if(gesture.rolling)options.roll((e.rotation-gesture.rotation)*Math.PI/180);
    }
    gesture.scale=e.scale;gesture.rotation=e.rotation;
  };
  const gestureEnd=()=>{gesture=null;};
  const cancel=()=>{
    endScroll();gesture=null;[...keys].forEach(release);cancelAnimationFrame(frame);frame=0;last=0;options.stop();
  };
  const visibility=()=>{if(document.hidden)cancel();};
  const focus=(event:FocusEvent)=>{if(typing(event.target))cancel();};
  window.addEventListener('keydown',down);window.addEventListener('keyup',up);window.addEventListener('blur',cancel);
  document.addEventListener('visibilitychange',visibility);document.addEventListener('focusin',focus);
  surface.addEventListener('wheel',onWheel,{passive:false});
  surface.addEventListener('gesturestart',gestureStart);surface.addEventListener('gesturechange',gestureChange);surface.addEventListener('gestureend',gestureEnd);
  return {request,cancel,dispose:()=>{
    cancel();window.removeEventListener('keydown',down);window.removeEventListener('keyup',up);window.removeEventListener('blur',cancel);
    document.removeEventListener('visibilitychange',visibility);document.removeEventListener('focusin',focus);
    surface.removeEventListener('wheel',onWheel);
    surface.removeEventListener('gesturestart',gestureStart);surface.removeEventListener('gesturechange',gestureChange);surface.removeEventListener('gestureend',gestureEnd);
  }};
}
