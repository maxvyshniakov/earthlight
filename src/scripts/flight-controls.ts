import type { FlightInput } from './flight-navigation.ts';
import type { ScrollSession } from './camera-controller.ts';
type ScrollIntent='auto'|'look'|'circle';
import { SCENE_CONTROLS } from './camera-drag.ts';
import { createCameraGesture } from './camera-gesture.ts';

export type FlightCommand='level'|'reset-camera'|'reset-lens'|'night'|'help'|'info'|'free'|'orbit-iss'|'orbit-polar'|'orbit-high'|'mouse'|'trackpad';
export type WheelDevice='mouse'|'trackpad';
export type FlightAction='look'|'lens-in'|'lens-out'|'approach-in'|'approach-out'|'roll-left'|'roll-right';
// + and − hold the lens; the keypad's work as the main keys.
const ALIAS:Record<string,string>={NumpadAdd:'Equal',NumpadSubtract:'Minus'};
const HELD=['KeyW','KeyA','KeyS','KeyD','KeyR','KeyF','KeyQ','KeyE','Equal','Minus','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','ShiftLeft','ShiftRight'];
const COMMANDS:Record<string,FlightCommand>={KeyH:'level',Backslash:'reset-camera',Digit0:'reset-lens',KeyN:'night',KeyI:'info',Digit1:'free',Digit2:'orbit-iss',Digit3:'orbit-polar',Digit4:'orbit-high',KeyM:'mouse',KeyT:'trackpad'};
type GestureEvent=UIEvent&{scale:number;rotation:number;clientX:number;clientY:number};
// A wheel steps the lens by a third of a doubling per notch.
const LENS_NOTCH=Math.log(2)/3;
// A clicky wheel with Option or Control moves as far per notch as a sideways
// trackpad scroll of this fraction of the view height.
const SCROLL_NOTCH=.06;

/** Keys, wheels and Safari trackpad gestures on a real-time clock, independent
 * of replay speed and pause. A trackpad scroll drags whatever is under the
 * pointer, as a finger would; with Shift the camera stays put and looks. With
 * Option, up and down change altitude and sideways rolls; with Control the
 * camera circles the point under the pointer. A wheel that clicks zooms the
 * lens about the pointer, and with Shift approaches; with Option it rolls and
 * with Control it circles, as a sideways scroll would. Pinch zooms the lens
 * whatever the modifiers.
 * Control takes precedence over Option, and Option over Shift. */
export function createFlightControls(surface:HTMLElement,options:{
  enabled:()=>boolean;
  step:(dt:number,input:FlightInput)=>boolean;
  zoom:(log:number,clientX:number,clientY:number,smooth:boolean)=>void;
  /** Lens zoom by e^log about the pointer; positive magnifies. */
  lens:(log:number,clientX:number,clientY:number,smooth:boolean)=>void;
  roll:(angle:number)=>void;
  scroll:(clientX:number,clientY:number,intent:ScrollIntent)=>ScrollSession|null;
  command:(command:FlightCommand)=>void;
  key:(code:string,down:boolean)=>void;
  /** The device a wheel burst or pinch was recognized as, while none is forced. */
  device:(device:WheelDevice)=>void;
  /** The device the viewer chose, which every wheel event is taken from; null detects it. */
  forced?:()=>WheelDevice|null;
  touching:()=>boolean;
  stop:()=>void;
  /** Direction of a recognized nonzero camera command; null clears feedback. */
  action?:(action:FlightAction|null)=>void;
  /** Time constant (ms) for releasing trackpad scroll to the camera; 0 applies each event. */
  inputSmoothing?:number|(()=>number);
}){
  const keys=new Set<string>();let frame=0,last=0;
  let scroll:{session:ScrollSession|null;timer:number;time:number;shift:boolean;axis:'x'|'y'|null}|null=null;
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
  let gesture:{scale:number;rotation:number;intent:ReturnType<typeof createCameraGesture>}|null=null;
  let pinch:{scale:number;time:number;intent:ReturnType<typeof createCameraGesture>}|null=null;
  const applyPinch=(log:number,x:number,y:number,wheelBurst=false)=>{
    if(!log)return;
    options.lens(log,x,y,false);showAction(log>0?'lens-in':'lens-out',wheelBurst);
  };
  // Option: the swipe's first clear axis decides, for the whole swipe, whether
  // it changes altitude (scrolling down descends, as on every tape) or rolls
  // (fingers right turn the image clockwise).
  const adjust=(clientX:number,clientY:number):ScrollSession=>{
    let axis:'x'|'y'|null=null,tx=0,ty=0;
    return {kind:'fly',by(dx,dy){
      const h=Math.max(1,surface.clientHeight);
      if(!axis){tx+=dx;ty+=dy;if(Math.hypot(tx,ty)<4)return;axis=Math.abs(tx)>Math.abs(ty)?'x':'y';dx=tx;dy=ty;}
      if(axis==='y'&&dy){const log=dy/h*2;options.zoom(log,clientX,clientY,false);showAction(log<0?'approach-in':'approach-out',true);}
      else if(axis==='x'&&dx){const angle=dx/h*Math.PI*.75;options.roll(angle);showAction(angle>0?'roll-right':'roll-left',true);}
    }};
  };
  const typing=(target:EventTarget|null)=>target instanceof Element&&!!target.closest('input,select,textarea,[contenteditable]:not([contenteditable="false"]),[role="slider"]');
  const inControls=(target:EventTarget|null)=>target instanceof Element&&!!target.closest(SCENE_CONTROLS);
  const held=(code:string)=>Number(keys.has(code));
  const input=():FlightInput=>({forward:held('KeyW')-held('KeyS'),right:held('KeyD')-held('KeyA'),climb:held('KeyR')-held('KeyF'),
    // Q turns the image anticlockwise and E clockwise, as their icons show.
    roll:held('KeyE')-held('KeyQ'),yaw:held('ArrowRight')-held('ArrowLeft'),pitch:held('ArrowUp')-held('ArrowDown'),lens:held('Equal')-held('Minus'),
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
  const endScroll=()=>{if(scroll){clearTimeout(scroll.timer);scroll.session?.end?.();scroll=null;}pending.x=pending.y=0;};
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
  // Browsers do not say which device sent a wheel event, so its first event
  // decides, as MapLibre does: a clicky signature, lines, a sideways Shift
  // scroll after a wheel (macOS can strip the signature there) mean a mouse;
  // both axes at once, or under 4 px, a trackpad. Otherwise the event waits up
  // to 40 ms: a trackpad sends a stream of small deltas, a wheel a lone notch.
  // A smooth-scrolling mouse passes for a trackpad, so the viewer can choose.
  let detected:WheelDevice|null=null;
  let waiting:{event:WheelEvent;time:number;timer:number}|null=null;
  const recognize=(event:WheelEvent):WheelDevice|null=>{
    const forced=options.forced?.();if(forced)return forced;
    if(clicky(event))return 'mouse';
    if(event.shiftKey&&event.deltaY===0&&event.deltaX!==0&&detected==='mouse')return 'mouse';
    if(event.deltaX!==0&&event.deltaY!==0)return 'trackpad';
    return Math.abs(event.deltaY||event.deltaX)*unit(event)<4?'trackpad':null;
  };
  const seen=(device:WheelDevice)=>{if(!options.forced?.()&&device!==detected){detected=device;options.device(device);}};
  const begin=(device:WheelDevice,time:number)=>{wheel={kind:device==='mouse'?'zoom':'scroll',time};seen(device);};
  const decide=(device:WheelDevice)=>{
    if(!waiting)return;
    const {event,time,timer}=waiting;clearTimeout(timer);waiting=null;
    if(!options.enabled())return;
    begin(device,time);apply(event,time);
  };
  const unit=(event:WheelEvent)=>event.deltaMode===1?16:event.deltaMode===2?surface.clientHeight:1;
  // Notches in a clicky wheel's delta, as Chromium, WebKit and Firefox report them.
  const notches=(event:WheelEvent,delta:number)=>{const size=Math.abs(delta);return event.deltaMode===1?size/3:size%4.000244140625===0?size/4.000244140625:size/100;};
  const onWheel=(event:WheelEvent)=>{
    if(inControls(event.target)||event.defaultPrevented)return;
    event.preventDefault();
    if(!options.enabled()){showAction(null);return;}
    const now=performance.now();
    // Trackpad pinch arrives as Ctrl-wheel in Chromium and Firefox, without
    // the key; with Control waiting it is a Control scroll. Safari's own gesture
    // events carry a pinch, and any wheel alongside them is ignored.
    if(event.ctrlKey&&gesture)return;
    if(event.ctrlKey&&!control){
      seen('trackpad');
      const continuation=!!pinch&&now-pinch.time<=220;
      // Include any scroll still settling its smoothed motion. Tiny pinch
      // samples leave that session intact until intent clears the threshold.
      if(!continuation){showAction(null);pinch={scale:0,time:now,intent:createCameraGesture({looking:!!scroll})};}
      pinch!.time=now;pinch!.scale-=event.deltaY*unit(event)*.01;
      const motion=pinch!.intent.update({scale:pinch!.scale});
      if(motion.lensActive)endScroll();
      applyPinch(motion.lens,event.clientX,event.clientY,true);
      return;
    }
    pinch=null;
    // A second event while the first waits: a quick small one is a trackpad's.
    if(waiting){const value=Math.abs(waiting.event.deltaY||waiting.event.deltaX)*unit(waiting.event);decide(Math.abs((now-waiting.time)*value)<200?'trackpad':'mouse');}
    if(!wheel||now-wheel.time>220){
      const device=recognize(event);
      if(!device){waiting={event,time:now,timer:window.setTimeout(()=>decide('mouse'),40)};return;}
      begin(device,now);
    }
    apply(event,now);
  };
  const apply=(event:WheelEvent,now:number)=>{
    // A scroll continues, momentum included, while its events keep arriving.
    // Its modifiers are fixed at the start: pressing Shift, Option or Control
    // while the globe coasts must not turn the rest of the swipe into another action.
    const continuing=!!scroll&&now-scroll.time<=160;
    wheel!.time=now;
    const moves=event.ctrlKey||event.altKey,signed=clicky(event);
    let dx=event.deltaX*unit(event),dy=event.deltaY*unit(event);
    if(wheel!.kind==='zoom'){
      endScroll();
      if(moves){
        // Shift-wheel already changes altitude, so a wheel with Option or
        // Control does the sideways action: a notch moves as a short sideways
        // scroll, wheel up as fingers to the right.
        const delta=event.deltaY||event.deltaX;
        dx=Math.sign(delta)*Math.min(3,notches(event,delta))*Math.max(1,surface.clientHeight)*SCROLL_NOTCH;dy=0;
      }else{
        // Shift-wheel may arrive on either axis. Wheel down lowers the
        // reading on its tape: the lens widens, the camera comes closer. A
        // notch steps at least a quarter; a smooth wheel moves in proportion.
        const delta=event.deltaY||event.deltaX;
        const step=Math.sign(delta)*Math.min(3,signed?Math.max(.25,notches(event,delta)):notches(event,delta));
        if(event.shiftKey)options.zoom(-step*.28,event.clientX,event.clientY,true);
        else options.lens(-step*LENS_NOTCH,event.clientX,event.clientY,true);
        if(step)showAction(event.shiftKey?(step>0?'approach-in':'approach-out'):(step<0?'lens-in':'lens-out'),true);
        return;
      }
    }
    // macOS keeps sending momentum after the fingers lift, so a flick coasts.
    // A pause starts a new gesture; the previous one may still be landing its
    // smoothed motion, so finish that at once.
    if(scroll&&!continuing){scroll.session?.by(pending.x,pending.y);endScroll();}
    if(!scroll){
      showAction(null);
      const intent:ScrollIntent=event.ctrlKey?'circle':event.shiftKey&&!event.altKey?'look':'auto';
      scroll={session:event.altKey&&!event.ctrlKey?adjust(event.clientX,event.clientY):options.scroll(event.clientX,event.clientY,intent),timer:0,time:now,shift:event.shiftKey,axis:null};
    }
    scroll.time=now;
    // Shift only hints that the camera will turn; a scroll that looks says so.
    if(scroll.session?.kind==='look')showAction('look',true);
    clearTimeout(scroll.timer);scroll.timer=window.setTimeout(settleScroll,160);
    // macOS turns a vertical scroll horizontal while Shift is waiting. Pressed or
    // released mid-swipe, it must not swing the coasting globe sideways.
    if(event.shiftKey!==scroll.shift){
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
    event.preventDefault();pinch=null;showAction(null);seen('trackpad');
    gesture={scale:e.scale>0?Math.log(e.scale):0,rotation:Number.isFinite(e.rotation)?e.rotation*Math.PI/180:0,intent:createCameraGesture({looking:!!scroll})};
  };
  const gestureChange=(event:Event)=>{
    if(!options.enabled()||options.touching()){gesture=null;showAction(null);return;}
    if(!gesture)return;
    event.preventDefault();
    const e=event as GestureEvent;
    if(!(e.scale>0)||!Number.isFinite(e.scale)||!Number.isFinite(e.rotation))return;
    const motion=gesture.intent.update({scale:Math.log(e.scale)-gesture.scale,rotation:e.rotation*Math.PI/180-gesture.rotation});
    if(motion.lensActive||motion.rollActive)endScroll();
    applyPinch(motion.lens,e.clientX,e.clientY);
    if(motion.roll){options.roll(motion.roll);showAction(motion.roll>0?'roll-right':'roll-left');}
  };
  const gestureEnd=()=>{gesture=null;showAction(null);};
  const leave=()=>{gesture=null;pinch=null;showAction(null);};
  const cancel=()=>{
    if(waiting){clearTimeout(waiting.timer);waiting=null;}
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
