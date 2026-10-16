import type { FlightInput } from './flight-navigation.ts';
import type { ScrollSession } from './camera-controller.ts';
import { SCENE_CONTROLS } from './camera-drag.ts';

export type FlightCommand='level'|'reset-camera'|'reset-lens'|'help'|'info'|'free'|'orbit-iss'|'orbit-polar'|'orbit-high';
export type WheelDevice='mouse'|'trackpad';
// + and − hold the lens; the keypad's work as the main keys.
const ALIAS:Record<string,string>={NumpadAdd:'Equal',NumpadSubtract:'Minus'};
const HELD=['KeyW','KeyA','KeyS','KeyD','KeyR','KeyF','KeyQ','KeyE','Equal','Minus','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','ShiftLeft','ShiftRight'];
const COMMANDS:Record<string,FlightCommand>={KeyH:'level',Backslash:'reset-camera',Digit0:'reset-lens',KeyI:'info',Digit1:'free',Digit2:'orbit-iss',Digit3:'orbit-polar',Digit4:'orbit-high'};
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
  /** Time constant (ms) for releasing trackpad scroll to the camera; 0 applies each event. */
  inputSmoothing?:number|(()=>number);
}){
  const keys=new Set<string>();let frame=0,last=0;
  let scroll:{session:ScrollSession|null;timer:number;time:number;look:boolean;axis:'x'|'y'|null}|null=null;
  // A physically held Control key, as opposed to the Ctrl flag Chromium sets
  // on trackpad pinch events.
  let control=false;
  // Chromium delivers wheel events in bursts while the main thread submits a
  // frame, and macOS momentum ends in small irregular deltas. Applied as they
  // arrive, a frame can get no motion and the next a double step. Optionally
  // release them over a short time constant on every display refresh instead.
  const smoothing=()=>{const value=options.inputSmoothing;return Math.max(0,(typeof value==='function'?value():value)??0)/1000;};
  const pending={x:0,y:0};
  let wheel:{kind:'zoom'|'scroll';time:number}|null=null;
  let gesture:{scale:number;rotation:number;rolling:boolean}|null=null;
  const typing=(target:EventTarget|null)=>target instanceof Element&&!!target.closest('input,select,textarea,[contenteditable]:not([contenteditable="false"]),[role="slider"]');
  const inControls=(target:EventTarget|null)=>target instanceof Element&&!!target.closest(SCENE_CONTROLS);
  const held=(code:string)=>Number(keys.has(code));
  const input=():FlightInput=>({forward:held('KeyW')-held('KeyS'),right:held('KeyD')-held('KeyA'),climb:held('KeyR')-held('KeyF'),
    roll:held('KeyQ')-held('KeyE'),yaw:held('ArrowRight')-held('ArrowLeft'),pitch:held('ArrowUp')-held('ArrowDown'),lens:held('Equal')-held('Minus'),
    fast:keys.has('ShiftLeft')||keys.has('ShiftRight')});
  const loop=(now:number)=>{
    frame=0;if(document.hidden){cancel();return;}
    const dt=last?Math.min(.05,(now-last)/1000):1/60;last=now;
    if(scroll&&(pending.x||pending.y)){
      const time=smoothing(),part=time<=0||Math.hypot(pending.x,pending.y)<.05?1:1-Math.exp(-dt/time);
      const x=pending.x*part,y=pending.y*part;pending.x-=x;pending.y-=y;
      scroll.session?.by(x,y);
    }
    const active=options.step(dt,input());
    if(active||keys.size||scroll)frame=requestAnimationFrame(loop);else last=0;
  };
  const request=()=>{if(!frame&&!document.hidden)frame=requestAnimationFrame(loop);};
  const release=(code:string)=>{if(keys.delete(code))options.key(code,false);};
  // Key caps on the screen hold the same keys as the keyboard.
  const hold=(code:string,pressed:boolean)=>{
    if(!pressed){release(code);return;}
    if(!options.enabled()||!HELD.includes(code)||keys.has(code))return;
    keys.add(code);options.key(code,true);request();
  };
  const down=(event:KeyboardEvent)=>{
    control=event.ctrlKey;
    if(!options.enabled()||event.defaultPrevented||event.ctrlKey||event.metaKey||event.altKey||typing(event.target))return;
    // ? or F1, which also keeps the browser's own help page from opening.
    if(event.key==='?'||event.code==='F1'){event.preventDefault();if(!event.repeat){options.key('Slash',true);options.command('help');}return;}
    const code=ALIAS[event.code]??event.code,command=COMMANDS[code];
    if(command&&!event.shiftKey){event.preventDefault();if(!event.repeat){options.key(code,true);options.command(command);}return;}
    if(!HELD.includes(code))return;
    event.preventDefault();
    if(!keys.has(code)){keys.add(code);options.key(code,true);}
    request();
  };
  const up=(event:KeyboardEvent)=>{
    control=event.ctrlKey;
    const code=ALIAS[event.code]??event.code;
    if(COMMANDS[code]||code==='Slash')options.key(code,false);else if(code==='F1')options.key('Slash',false);
    release(code);
    // macOS sends no keyup for keys held while Command goes down.
    if(event.key==='Meta')[...keys].forEach(release);
  };
  const endScroll=()=>{if(scroll){clearTimeout(scroll.timer);scroll=null;}pending.x=pending.y=0;};
  // The session outlives its last event until the released motion has landed.
  const settleScroll=()=>{if(scroll&&Math.hypot(pending.x,pending.y)>=.05)scroll.timer=window.setTimeout(settleScroll,50);else endScroll();};
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
    const ticks=Math.abs(delta)/4.000244140625;
    return Math.abs(ticks-Math.round(ticks))<1e-6||!!legacy&&legacy%120===0&&legacy!==-3*delta;
  };
  // A wheel that has shown its clicks stays a wheel: macOS turns Shift-wheel
  // into a sideways scroll whose deltas can lose that signature, and it would
  // pass for a Shift trackpad scroll, which looks. A plain trackpad scroll
  // forgets it.
  let mouseWheel=false;
  const onWheel=(event:WheelEvent)=>{
    if(inControls(event.target)||event.defaultPrevented)return;
    event.preventDefault();
    if(!options.enabled())return;
    const unit=event.deltaMode===1?16:event.deltaMode===2?surface.clientHeight:1;
    const now=performance.now();
    // A scroll continues, momentum included, while its events keep arriving.
    // Its modifiers are fixed at the start: pressing Shift or Control while
    // the globe coasts must not turn the rest of the swipe into a look or zoom.
    const continuing=!!scroll&&now-scroll.time<=160;
    // Trackpad pinch arrives as Ctrl-wheel in Chromium and Firefox; with Shift it zooms the lens.
    if(event.ctrlKey&&!(continuing&&control)){
      if(!gesture){
        endScroll();
        if(event.shiftKey)options.lens(-event.deltaY*unit*.01,event.clientX,event.clientY,false);
        else options.zoom(event.deltaY*unit*.01,event.clientX,event.clientY,false);
        options.device('trackpad');
      }
      return;
    }
    if(!wheel||now-wheel.time>220){
      const signed=clicky(event),sideways=event.shiftKey&&event.deltaY===0&&event.deltaX!==0;
      const kind=signed||sideways&&mouseWheel?'zoom':'scroll';
      if(signed)mouseWheel=true;else if(!event.shiftKey)mouseWheel=false;
      wheel={kind,time:now};
    }
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
    // A pause starts a new gesture; the previous one may still be landing its
    // smoothed motion, so finish that at once.
    if(scroll&&!continuing){scroll.session?.by(pending.x,pending.y);endScroll();}
    if(!scroll)scroll={session:options.scroll(event.clientX,event.clientY,event.shiftKey),timer:0,time:now,look:event.shiftKey,axis:null};
    scroll.time=now;
    clearTimeout(scroll.timer);scroll.timer=window.setTimeout(settleScroll,160);
    let dx=event.deltaX*unit,dy=event.deltaY*unit;
    // macOS turns a vertical scroll horizontal while Shift is held. Pressed or
    // released mid-swipe, it must not swing the coasting globe sideways.
    if(event.shiftKey!==scroll.look){
      if(dy===0&&dx!==0&&scroll.axis==='y'){dy=dx;dx=0;}
      else if(dx===0&&dy!==0&&scroll.axis==='x'){dx=dy;dy=0;}
    }else if(Math.abs(dx)!==Math.abs(dy))scroll.axis=Math.abs(dx)>Math.abs(dy)?'x':'y';
    if(smoothing()>0){pending.x-=dx;pending.y-=dy;}
    else scroll.session?.by(-dx,-dy);
    request();
  };
  // Safari reports trackpad pinch and rotation as its own gesture events.
  const gestureStart=(event:Event)=>{
    if(inControls(event.target)||options.touching())return;
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
    endScroll();gesture=null;control=false;[...keys].forEach(release);cancelAnimationFrame(frame);frame=0;last=0;options.stop();
  };
  const visibility=()=>{if(document.hidden)cancel();};
  const focus=(event:FocusEvent)=>{if(typing(event.target))cancel();};
  window.addEventListener('keydown',down);window.addEventListener('keyup',up);window.addEventListener('blur',cancel);
  document.addEventListener('visibilitychange',visibility);document.addEventListener('focusin',focus);
  surface.addEventListener('wheel',onWheel,{passive:false});
  surface.addEventListener('gesturestart',gestureStart);surface.addEventListener('gesturechange',gestureChange);surface.addEventListener('gestureend',gestureEnd);
  return {request,cancel,hold,dispose:()=>{
    cancel();window.removeEventListener('keydown',down);window.removeEventListener('keyup',up);window.removeEventListener('blur',cancel);
    document.removeEventListener('visibilitychange',visibility);document.removeEventListener('focusin',focus);
    surface.removeEventListener('wheel',onWheel);
    surface.removeEventListener('gesturestart',gestureStart);surface.removeEventListener('gesturechange',gestureChange);surface.removeEventListener('gestureend',gestureEnd);
  }};
}
