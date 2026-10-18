import type { FlightInput } from './flight-navigation.ts';
import type { ScrollSession } from './camera-controller.ts';
import { SCENE_CONTROLS } from './camera-drag.ts';
import { createCameraGesture } from './camera-gesture.ts';

export type FlightCommand='level'|'reset-camera'|'reset-lens'|'night'|'help'|'info'|'free'|'orbit-iss'|'orbit-polar'|'orbit-high';
export type WheelDevice='mouse'|'trackpad';
export type FlightAction='lens-in'|'lens-out'|'approach-in'|'approach-out'|'roll-left'|'roll-right';
// + and − hold the lens; the keypad's work as the main keys.
const ALIAS:Record<string,string>={NumpadAdd:'Equal',NumpadSubtract:'Minus'};
const HELD=['KeyW','KeyA','KeyS','KeyD','KeyR','KeyF','KeyQ','KeyE','Equal','Minus','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','ShiftLeft','ShiftRight'];
const COMMANDS:Record<string,FlightCommand>={KeyH:'level',Backslash:'reset-camera',Digit0:'reset-lens',KeyN:'night',KeyI:'info',Digit1:'free',Digit2:'orbit-iss',Digit3:'orbit-polar',Digit4:'orbit-high'};
type GestureEvent=UIEvent&{scale:number;rotation:number;clientX:number;clientY:number;shiftKey?:boolean;altKey?:boolean};
type PinchMode='lens'|'approach'|'roll';
// Shift-wheel steps the lens by a third of a doubling per notch.
const LENS_NOTCH=Math.log(2)/3;

/** Keys, wheels and Safari trackpad gestures on a real-time clock, independent
 * of replay speed and pause. A wheel that clicks approaches; a trackpad scroll
 * drags whatever is under the pointer, as a finger would. With Shift the
 * camera stays put: scrolling looks, and a clicky wheel zooms the lens about
 * the pointer. Pinch zooms the lens, Shift-pinch approaches and Option-pinch
 * rolls; Option takes precedence when both modifiers are held. */
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
  /** Direction of a recognized nonzero camera command; null clears feedback. */
  action?:(action:FlightAction|null)=>void;
  /** Time constant (ms) for releasing trackpad scroll to the camera; 0 applies each event. */
  inputSmoothing?:number|(()=>number);
}){
  const keys=new Set<string>();let frame=0,last=0;
  let scroll:{session:ScrollSession|null;timer:number;time:number;look:boolean;axis:'x'|'y'|null}|null=null;
  // A physically held Control key, as opposed to the Ctrl flag Chromium sets
  // on trackpad pinch events.
  let control=false,shift=false,option=false;
  let action:FlightAction|null=null,actionTimer=0;
  const showAction=(next:FlightAction|null,wheelBurst=false)=>{
    clearTimeout(actionTimer);actionTimer=0;
    if(next!==action){action=next;options.action?.(next);}
    if(next&&wheelBurst)actionTimer=window.setTimeout(()=>showAction(null),220);
  };
  const modifiers=(event:KeyboardEvent)=>{
    if(shift!==event.shiftKey||option!==event.altKey)showAction(null);
    control=event.ctrlKey;shift=event.shiftKey;option=event.altKey;
  };
  // Chromium delivers wheel events in bursts while the main thread submits a
  // frame, and macOS momentum ends in small irregular deltas. Applied as they
  // arrive, a frame can get no motion and the next a double step. Optionally
  // release them over a short time constant on every display refresh instead.
  const smoothing=()=>{const value=options.inputSmoothing;return Math.max(0,(typeof value==='function'?value():value)??0)/1000;};
  const pending={x:0,y:0};
  let wheel:{kind:'zoom'|'scroll';time:number}|null=null;
  let gesture:{mode:PinchMode;scale:number;rotation:number;intent:ReturnType<typeof createCameraGesture>}|null=null;
  let pinch:{scale:number;time:number;mode:PinchMode;intent:ReturnType<typeof createCameraGesture>}|null=null;
  // Safari versions differ in whether gesture events expose modifiers. An
  // explicit false is authoritative; only absent properties use keyboard state.
  const pinchMode=(event:{shiftKey?:boolean;altKey?:boolean}):PinchMode=>(event.altKey??option)?'roll':(event.shiftKey??shift)?'approach':'lens';
  const applyPinch=(mode:PinchMode,log:number,x:number,y:number,wheelBurst=false)=>{
    if(!log)return;
    if(mode==='roll')options.roll(log);
    else if(mode==='approach')options.zoom(-log,x,y,false);
    else options.lens(log,x,y,false);
    showAction(mode==='roll'?(log>0?'roll-right':'roll-left'):mode==='approach'?(log>0?'approach-in':'approach-out'):(log>0?'lens-in':'lens-out'),wheelBurst);
  };
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
    modifiers(event);
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
    modifiers(event);
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
    if(!options.enabled()){showAction(null);return;}
    const unit=event.deltaMode===1?16:event.deltaMode===2?surface.clientHeight:1;
    const now=performance.now();
    // A scroll continues, momentum included, while its events keep arriving.
    // Its modifiers are fixed at the start: pressing Shift or Control while
    // the globe coasts must not turn the rest of the swipe into a look or zoom.
    const continuing=!!scroll&&now-scroll.time<=160;
    // Trackpad pinch arrives as Ctrl-wheel in Chromium and Firefox.
    if(event.ctrlKey&&!(continuing&&control)){
      if(!gesture){
        const mode=pinchMode(event),continuation=!!pinch&&now-pinch.time<=220,changed=continuation&&pinch!.mode!==mode;
        // Include any scroll still settling its smoothed motion. Tiny pinch
        // samples leave that session intact until intent clears the threshold.
        if(!continuation||changed){showAction(null);pinch={scale:0,time:now,mode,intent:createCameraGesture({looking:!!scroll})};}
        pinch!.time=now;
        // Rebase a live modifier change at this sample, before accumulating
        // fresh movement for the new operation's intent threshold.
        if(!changed)pinch!.scale-=event.deltaY*unit*.01;
        const motion=pinch!.intent.update({scale:pinch!.scale});
        if(motion.lensActive)endScroll();
        applyPinch(mode,motion.lens,event.clientX,event.clientY,true);
        options.device('trackpad');
      }
      return;
    }
    pinch=null;
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
      if(step)showAction(event.shiftKey?(step<0?'lens-in':'lens-out'):(step<0?'approach-in':'approach-out'),true);
      return;
    }
    showAction(null);
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
    if(inControls(event.target)||event.defaultPrevented||!options.enabled()||options.touching())return;
    const e=event as GestureEvent;
    event.preventDefault();pinch=null;showAction(null);
    gesture={mode:pinchMode(e),scale:e.scale>0?Math.log(e.scale):0,rotation:Number.isFinite(e.rotation)?e.rotation*Math.PI/180:0,intent:createCameraGesture({looking:!!scroll})};
  };
  const gestureChange=(event:Event)=>{
    if(!options.enabled()||options.touching()){gesture=null;showAction(null);return;}
    if(!gesture)return;
    event.preventDefault();options.device('trackpad');
    const e=event as GestureEvent;
    if(!(e.scale>0)||!Number.isFinite(e.scale)||!Number.isFinite(e.rotation))return;
    const mode=pinchMode(e),scale=Math.log(e.scale),rotation=e.rotation*Math.PI/180;
    if(mode!==gesture.mode){showAction(null);gesture={mode,scale,rotation,intent:createCameraGesture({looking:!!scroll})};}
    const motion=gesture.intent.update({scale:scale-gesture.scale,rotation:rotation-gesture.rotation,allowRoll:mode==='lens'});
    if(motion.lensActive||motion.rollActive)endScroll();
    applyPinch(mode,motion.lens,e.clientX,e.clientY);
    if(motion.roll){options.roll(motion.roll);showAction(motion.roll>0?'roll-right':'roll-left');}
  };
  const gestureEnd=()=>{gesture=null;showAction(null);};
  const leave=()=>{gesture=null;pinch=null;showAction(null);};
  const cancel=()=>{
    endScroll();gesture=null;pinch=null;wheel=null;showAction(null);control=false;shift=false;option=false;[...keys].forEach(release);cancelAnimationFrame(frame);frame=0;last=0;options.stop();
  };
  const visibility=()=>{if(document.hidden)cancel();};
  const focus=(event:FocusEvent)=>{if(typing(event.target))cancel();};
  window.addEventListener('keydown',down);window.addEventListener('keyup',up);window.addEventListener('blur',cancel);
  document.addEventListener('visibilitychange',visibility);document.addEventListener('focusin',focus);
  surface.addEventListener('wheel',onWheel,{passive:false});
  surface.addEventListener('pointerleave',leave);
  surface.addEventListener('gesturestart',gestureStart);surface.addEventListener('gesturechange',gestureChange);surface.addEventListener('gestureend',gestureEnd);
  return {request,cancel,hold,clearAction:()=>showAction(null),dispose:()=>{
    cancel();window.removeEventListener('keydown',down);window.removeEventListener('keyup',up);window.removeEventListener('blur',cancel);
    document.removeEventListener('visibilitychange',visibility);document.removeEventListener('focusin',focus);
    surface.removeEventListener('wheel',onWheel);
    surface.removeEventListener('pointerleave',leave);
    surface.removeEventListener('gesturestart',gestureStart);surface.removeEventListener('gesturechange',gestureChange);surface.removeEventListener('gestureend',gestureEnd);
  }};
}
