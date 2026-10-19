import {test} from 'bun:test';
import assert from 'node:assert/strict';
import {createCameraGesture} from '../src/scripts/camera-gesture.ts';
import {createTouchCamera} from '../src/scripts/camera-touch.ts';
import {createFlightControls} from '../src/scripts/flight-controls.ts';

const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-9,`${actual} ≈ ${expected}`);

// Drive the real event adapters without rendering a scene or waiting on timers.
function environment(run){
  const names=['window','document','Element','requestAnimationFrame','cancelAnimationFrame','performance','clearTimeout'];
  const saved=new Map(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  let now=0,id=0;const frames=new Map(),timers=new Map();
  class Surface extends EventTarget{
    controls=false;clientHeight=800;captures=new Set();
    closest(selector){return this.controls&&selector.includes('.explorer-')?this:null;}
    setPointerCapture(id){this.captures.add(id);}
    hasPointerCapture(id){return this.captures.has(id);}
    releasePointerCapture(id){this.captures.delete(id);}
  }
  const surface=new Surface(),window=new EventTarget(),document=Object.assign(new EventTarget(),{hidden:false});
  window.setTimeout=(callback,delay)=>{timers.set(++id,{callback,at:now+delay});return id;};
  const replacements={window,document,Element:Surface,performance:{now:()=>now},
    requestAnimationFrame:callback=>{frames.set(++id,callback);return id;},cancelAnimationFrame:id=>frames.delete(id),clearTimeout:id=>timers.delete(id)};
  for(const [name,value] of Object.entries(replacements))Object.defineProperty(globalThis,name,{value,configurable:true,writable:true});
  const fire=(target,type,values={})=>{const event=Object.assign(new Event(type,{cancelable:true}),values);target.dispatchEvent(event);return event;};
  const frame=()=>{now+=16;const callbacks=[...frames.values()];frames.clear();for(const callback of callbacks)callback(now);};
  try{run({surface,window,document,fire,frame,advance:ms=>{now+=ms;for(const [id,timer] of [...timers])if(timer.at<=now){timers.delete(id);timer.callback();}},timers});}
  finally{for(const [name,descriptor] of saved)if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}
}

function flight(env,{forced=null}={}){
  const calls={lens:[],zoom:[],roll:[],scroll:[],moves:[],action:[],device:[],stop:0};let enabled=true,touching=false;
  const controls=createFlightControls(env.surface,{
    enabled:()=>enabled,touching:()=>touching,step:()=>false,key:()=>{},command:()=>{},device:value=>calls.device.push(value),forced:()=>forced,stop:()=>calls.stop++,
    lens:(...args)=>calls.lens.push(args),zoom:(...args)=>calls.zoom.push(args),roll:value=>calls.roll.push(value),
    action:value=>calls.action.push(value),
    scroll:(...args)=>{calls.scroll.push(args);return {by:(...args)=>calls.moves.push(args)};},
  });
  const wheel=values=>env.fire(env.surface,'wheel',{clientX:300,clientY:200,deltaX:0,deltaY:0,deltaMode:0,ctrlKey:false,shiftKey:false,altKey:false,...values});
  const gesture=(type,values={})=>env.fire(env.surface,type,{clientX:300,clientY:200,scale:1,rotation:0,shiftKey:false,altKey:false,...values});
  return {calls,controls,wheel,gesture,setEnabled:value=>{enabled=value;},setTouching:value=>{touching=value;},setForced:value=>{forced=value;}};
}

test('two-finger translation tolerates spread and twist, then deliberately transitions without a jump',()=>{
  const gesture=createCameraGesture();
  assert.equal(gesture.update({travel:20}).look,true);
  let motion=gesture.update({travel:50,scale:.20,rotation:.20});
  assert.equal(motion.lensActive,false);assert.equal(motion.rollActive,false);
  motion=gesture.update({travel:60,scale:.31,rotation:.20});
  assert.equal(motion.lensActive,true);assert.equal(motion.lens,0);assert.equal(motion.rollActive,false);
  motion=gesture.update({travel:70,scale:.33,rotation:.31});
  close(motion.lens,.02);assert.equal(motion.rollActive,true);assert.equal(motion.roll,0);
  motion=gesture.update({travel:80,scale:.30,rotation:.34});
  close(motion.lens,-.03);close(motion.roll,.03);
});

test('pinch thresholds are symmetric for expansion and contraction, and fresh gestures reset',()=>{
  for(const direction of [-1,1]){
    const gesture=createCameraGesture();
    assert.equal(gesture.update({scale:.13*direction}).lensActive,false);
    const activated=gesture.update({scale:.15*direction});assert.equal(activated.lensActive,true);assert.equal(activated.lens,0);
    close(gesture.update({scale:.17*direction}).lens,.02*direction);
    assert.equal(createCameraGesture().update({scale:.13*direction}).lensActive,false);
  }
});

test('simultaneous pinch and mild twist prefer the lens until twist is deliberate',()=>{
  const gesture=createCameraGesture();
  const first=gesture.update({scale:.20,rotation:.20});
  assert.equal(first.lensActive,true);assert.equal(first.rollActive,false);
  assert.equal(first.lens,0);assert.equal(first.roll,0);
  const second=gesture.update({scale:.21,rotation:.31});
  close(second.lens,.01);assert.equal(second.rollActive,true);assert.equal(second.roll,0);
  close(gesture.update({scale:.21,rotation:.34}).roll,.03);
  const twist=createCameraGesture();twist.update({rotation:.20});
  assert.equal(twist.update({scale:.20,rotation:.21}).lensActive,false,'active roll guards the lens too');
});

test('coincident touch points never send non-finite lens or roll input',()=>environment(env=>{
  const values=[];
  const camera={press:()=>({move:()=>{},end:()=>{}}),look:()=>{},lens:value=>values.push(value),roll:value=>values.push(value),zoom:()=>{},flyTo:()=>{}};
  const touch=createTouchCamera(env.surface,camera,()=>{});
  const pointer=(type,id,x)=>env.fire(env.surface,type,{pointerId:id,pointerType:'touch',clientX:x,clientY:200});
  try{
    pointer('pointerdown',1,200);pointer('pointerdown',2,200);
    for(const span of [1,0,20,30,0,1,40]){pointer('pointermove',1,200-span/2);pointer('pointermove',2,200+span/2);env.frame();}
    assert.ok(values.length>0);assert.ok(values.every(Number.isFinite));
  }finally{touch.dispose();}
}));

test('touch pointer events preserve look during jitter and apply only subsequent pinch and roll motion',()=>environment(env=>{
  const calls={look:[],lens:[],roll:[],zoom:[],fly:[]};
  const camera={press:()=>({move:()=>{},end:()=>{}}),look:(...args)=>calls.look.push(args),lens:(...args)=>calls.lens.push(args),
    roll:value=>calls.roll.push(value),zoom:(...args)=>calls.zoom.push(args),flyTo:(...args)=>calls.fly.push(args)};
  const touch=createTouchCamera(env.surface,camera,()=>{});
  const pointer=(type,id,x,y)=>env.fire(env.surface,type,{pointerId:id,pointerType:'touch',clientX:x,clientY:y});
  const pair=(x,spread=0,rotation=0)=>{
    const half=50*Math.exp(spread),dx=half*Math.cos(rotation),dy=half*Math.sin(rotation);
    pointer('pointermove',1,x-dx,200-dy);pointer('pointermove',2,x+dx,200+dy);env.frame();
  };
  try{
    pointer('pointerdown',1,150,200);pointer('pointerdown',2,250,200);
    pair(220);pair(250,.2,.2);
    assert.ok(calls.look.length>0);assert.equal(calls.lens.length,0);assert.equal(calls.roll.length,0);
    pair(260,.31,.31);assert.equal(calls.lens.length,0);assert.equal(calls.roll.length,0);
    pair(270,.33,.34);close(calls.lens[0][0],.02);close(calls.roll[0],.03);
    assert.equal(calls.zoom.length,0);assert.equal(calls.fly.length,0);
    env.fire(env.window,'blur');assert.equal(touch.active,false);
    pointer('pointerdown',3,150,200);pointer('pointerdown',4,250,200);
    pointer('pointermove',3,144,200);pointer('pointermove',4,256,200);env.frame();
    assert.equal(calls.lens.length,1,'blur resets pinch intent');
    pointer('pointercancel',3,144,200);pointer('pointercancel',4,256,200);
    assert.equal(touch.active,false);assert.equal(calls.fly.length,0);
  }finally{touch.dispose();}
}));

test('Chromium pinch zooms the lens whatever the modifiers',()=>environment(env=>{
  const f=flight(env);
  try{
    for(const modifiers of [{},{shiftKey:true},{altKey:true},{shiftKey:true,altKey:true}]){
      for(const direction of [-1,1]){
        f.controls.cancel();const before=f.calls.lens.length;
        f.wheel({ctrlKey:true,...modifiers,deltaY:-10*direction});
        f.wheel({ctrlKey:true,...modifiers,deltaY:-6*direction});
        assert.equal(f.calls.lens.length,before,'threshold crossing rebases');
        f.wheel({ctrlKey:true,...modifiers,deltaY:-4*direction});
        assert.equal(f.calls.lens.length,before+1);close(f.calls.lens.at(-1)[0],.04*direction);
      }
    }
    assert.equal(f.calls.zoom.length,0);assert.equal(f.calls.roll.length,0);assert.equal(f.calls.scroll.length,0);
  }finally{f.controls.dispose();}
}));

test('a modifier pressed mid-pinch keeps zooming the lens without a fresh threshold',()=>environment(env=>{
  const f=flight(env),pinch=values=>f.wheel({ctrlKey:true,...values});
  try{
    pinch({deltaY:-16});pinch({deltaY:-4});close(f.calls.lens[0][0],.04);
    env.fire(env.window,'keydown',{code:'ShiftLeft',shiftKey:true});pinch({shiftKey:true,deltaY:-4});
    env.fire(env.window,'keydown',{code:'AltLeft',shiftKey:true,altKey:true});pinch({shiftKey:true,altKey:true,deltaY:-4});
    assert.equal(f.calls.lens.length,3);close(f.calls.lens[2][0],.04);
    assert.equal(f.calls.zoom.length,0);assert.equal(f.calls.roll.length,0);
  }finally{f.controls.dispose();}
}));

test('Chromium pinch burst, blur and cancel start with fresh intent',()=>environment(env=>{
  const f=flight(env);
  try{
    f.wheel({ctrlKey:true,deltaY:-16});f.wheel({ctrlKey:true,deltaY:-4});assert.equal(f.calls.lens.length,1);
    env.advance(221);f.wheel({ctrlKey:true,deltaY:-4});assert.equal(f.calls.lens.length,1);
    env.fire(env.window,'blur');f.wheel({ctrlKey:true,deltaY:-4});assert.equal(f.calls.lens.length,1);
    f.controls.cancel();f.wheel({ctrlKey:true,deltaY:-4});assert.equal(f.calls.lens.length,1);
  }finally{f.controls.dispose();}
}));

test('pinch during trackpad scroll waits for the higher threshold; physically held Control preserves momentum',()=>environment(env=>{
  const f=flight(env,{forced:'trackpad'});
  try{
    f.wheel({deltaY:7});assert.equal(f.calls.scroll.length,1);
    f.wheel({ctrlKey:true,deltaY:-20});assert.equal(f.calls.lens.length,0);assert.equal(env.timers.size,1,'scroll remains alive below threshold');
    f.wheel({ctrlKey:true,deltaY:-11});assert.equal(env.timers.size,0,'clear pinch ends scroll');
    f.wheel({ctrlKey:true,deltaY:-4});close(f.calls.lens[0][0],.04);
    f.controls.cancel();f.wheel({deltaY:7});
    env.fire(env.window,'keydown',{code:'ControlLeft',ctrlKey:true});
    f.wheel({ctrlKey:true,deltaY:5});assert.deepEqual(f.calls.moves.at(-1),[-0,-5]);
    assert.equal(f.calls.lens.length,1);assert.equal(f.calls.zoom.length,0);
  }finally{f.controls.dispose();}
}));

test('a scroll moves over Earth, looks with Shift and circles with Control; a clicky wheel zooms the lens, and approaches with Shift',()=>environment(env=>{
  const f=flight(env);
  try{
    f.wheel({deltaX:2,deltaY:7});assert.equal(f.calls.scroll[0][2],'auto');
    f.controls.cancel();f.wheel({deltaY:2,shiftKey:true});assert.equal(f.calls.scroll[1][2],'look');
    // Chromium sets Ctrl on a pinch too; only the key held makes it a Control scroll.
    f.controls.cancel();env.fire(env.window,'keydown',{code:'ControlLeft',ctrlKey:true});
    f.wheel({deltaX:-3,ctrlKey:true,shiftKey:true});assert.equal(f.calls.scroll[2][2],'circle','Control takes precedence');
    assert.deepEqual(f.calls.moves.at(-1),[3,-0]);
    f.controls.cancel();f.wheel({deltaY:3,deltaMode:1});assert.equal(f.calls.lens.length,1);close(f.calls.lens[0][0],-Math.log(2)/3);
    f.controls.cancel();f.wheel({deltaY:-3,deltaMode:1,shiftKey:true});assert.equal(f.calls.zoom.length,1);close(f.calls.zoom[0][0],.28);
    assert.equal(f.calls.lens.length,1);
  }finally{f.controls.dispose();}
}));

test('a wheel burst is recognized from its first event: signature, lines, both axes or a tiny delta',()=>environment(env=>{
  const f=flight(env);
  try{
    f.wheel({deltaY:4.000244140625});assert.equal(f.calls.lens.length,1,'a clicky notch is a mouse at once');
    assert.deepEqual(f.calls.device,['mouse']);
    env.advance(300);f.wheel({deltaX:3,deltaY:5});assert.equal(f.calls.scroll.length,1,'both axes are a trackpad');
    env.advance(300);f.wheel({deltaY:3,deltaMode:1});assert.equal(f.calls.lens.length,2,'lines are a wheel');
    env.advance(300);f.wheel({deltaY:2.5});assert.equal(f.calls.scroll.length,2,'a tiny delta is a trackpad');
    assert.deepEqual(f.calls.device,['mouse','trackpad','mouse','trackpad'],'the device is reported as it changes');
  }finally{f.controls.dispose();}
}));

test('an ambiguous first event waits up to 40 ms: a quick small follower is a trackpad, none or a slow one a wheel',()=>environment(env=>{
  const f=flight(env);
  try{
    f.wheel({deltaY:10});assert.equal(f.calls.lens.length+f.calls.scroll.length,0,'nothing moves while it waits');
    env.advance(39);assert.equal(f.calls.lens.length,0);env.advance(1);assert.equal(f.calls.lens.length,1,'a lone event is a wheel');
    env.advance(300);f.wheel({deltaY:10});env.advance(8);f.wheel({deltaY:12});
    assert.equal(f.calls.scroll.length,1,'a quick follower makes a trackpad');assert.deepEqual(f.calls.moves.map(m=>m[1]),[-10,-12],'both events move');
    env.advance(300);f.wheel({deltaY:50});env.advance(30);f.wheel({deltaY:50});assert.equal(f.calls.lens.length,3,'a slow follower makes both notches a wheel');
    env.advance(300);f.wheel({deltaY:10});f.controls.cancel();env.advance(100);assert.equal(f.calls.lens.length,3,'cancel drops the waiting event');
  }finally{f.controls.dispose();}
}));

test('a sideways Shift scroll after a wheel stays a wheel, as macOS can strip its signature',()=>environment(env=>{
  const f=flight(env);
  try{
    f.wheel({deltaY:4.000244140625});env.advance(300);
    f.wheel({shiftKey:true,deltaX:7.5});assert.equal(f.calls.zoom.length,1,'Shift-wheel changes altitude at once');
    env.advance(300);f.wheel({deltaX:2,deltaY:3});env.advance(300);
    f.wheel({shiftKey:true,deltaX:2});assert.equal(f.calls.scroll.at(-1)[2],'look','after a trackpad it looks');
  }finally{f.controls.dispose();}
}));

test('a pinch shows a trackpad; a chosen device takes every wheel event and is never reported',()=>environment(env=>{
  const f=flight(env);
  try{
    f.wheel({ctrlKey:true,deltaY:-4});assert.deepEqual(f.calls.device,['trackpad']);
    f.controls.cancel();f.setForced('mouse');
    f.wheel({deltaX:3,deltaY:2});assert.equal(f.calls.lens.length,1,'a trackpad-like event zooms the lens');assert.equal(f.calls.scroll.length,0);
    close(f.calls.lens[0][0],-.02*Math.log(2)/3);
    env.advance(300);f.setForced('trackpad');f.wheel({deltaY:4.000244140625});assert.equal(f.calls.scroll.length,1,'a clicky notch scrolls');
    assert.deepEqual(f.calls.device,['trackpad']);
  }finally{f.controls.dispose();}
}));

test('an Option swipe takes its first clear axis: up and down change altitude, sideways rolls',()=>environment(env=>{
  const f=flight(env,{forced:'trackpad'});
  try{
    f.wheel({altKey:true,deltaY:2});assert.equal(f.calls.zoom.length,0,'a few pixels decide nothing yet');
    f.wheel({altKey:true,deltaY:3});assert.equal(f.calls.zoom.length,1);close(f.calls.zoom[0][0],-5/800*2);
    assert.equal(f.calls.action.at(-1),'approach-in','scrolling down descends, as on the tape');
    f.wheel({altKey:true,deltaX:10,deltaY:-1});assert.equal(f.calls.roll.length,0,'the swipe keeps its axis');
    close(f.calls.zoom.at(-1)[0],1/800*2);assert.equal(f.calls.action.at(-1),'approach-out');
    f.controls.cancel();f.wheel({altKey:true,shiftKey:true,deltaX:-6});
    assert.equal(f.calls.roll.length,1,'Option takes precedence over Shift');close(f.calls.roll[0],6/800*Math.PI*.75);
    assert.equal(f.calls.action.at(-1),'roll-right');
    f.wheel({altKey:true,shiftKey:true,deltaY:10});assert.equal(f.calls.roll.length,1);assert.equal(f.calls.zoom.length,2);
    assert.equal(f.calls.scroll.length,0);assert.equal(f.calls.lens.length,0);
  }finally{f.controls.dispose();}
}));

test('a clicky wheel rolls with Option and circles with Control, as a short sideways scroll',()=>environment(env=>{
  const f=flight(env);
  try{
    f.wheel({altKey:true,deltaY:-3,deltaMode:1});close(f.calls.roll[0],.06*Math.PI*.75);
    assert.equal(f.calls.action.at(-1),'roll-right','wheel up turns the image clockwise');
    f.controls.cancel();f.wheel({altKey:true,deltaY:4.000244140625*2});close(f.calls.roll[1],-2*.06*Math.PI*.75);
    f.controls.cancel();env.fire(env.window,'keydown',{code:'ControlLeft',ctrlKey:true});
    f.wheel({ctrlKey:true,deltaY:-3,deltaMode:1});
    assert.equal(f.calls.scroll.at(-1)[2],'circle');assert.deepEqual(f.calls.moves.at(-1),[.06*800,-0]);
    assert.equal(f.calls.zoom.length,0);assert.equal(f.calls.lens.length,0);
  }finally{f.controls.dispose();}
}));

test('ordinary Safari pinch and native twist share intent thresholds',()=>environment(env=>{
  const f=flight(env);
  try{
    f.gesture('gesturestart');
    f.gesture('gesturechange',{scale:Math.exp(.15),rotation:5});assert.equal(f.calls.lens.length,0);
    f.gesture('gesturechange',{scale:Math.exp(.20),rotation:12});close(f.calls.lens[0][0],.05);assert.equal(f.calls.roll.length,0);
    f.gesture('gesturechange',{scale:Math.exp(.21),rotation:18});assert.equal(f.calls.roll.length,0);
    f.gesture('gesturechange',{scale:Math.exp(.22),rotation:20});close(f.calls.roll[0],2*Math.PI/180);
    assert.equal(f.calls.roll.length,1);assert.equal(f.calls.zoom.length,0);
  }finally{f.controls.dispose();}
}));

test('Safari pinch zooms the lens whatever the modifiers',()=>environment(env=>{
  const f=flight(env);
  try{
    for(const modifiers of [{},{shiftKey:true},{altKey:true},{shiftKey:true,altKey:true}]){
      for(const direction of [-1,1]){
        f.controls.cancel();const before=f.calls.lens.length;
        f.gesture('gesturestart',modifiers);
        f.gesture('gesturechange',{...modifiers,scale:Math.exp(.16*direction)});assert.equal(f.calls.lens.length,before);
        f.gesture('gesturechange',{...modifiers,scale:Math.exp(.20*direction)});assert.equal(f.calls.lens.length,before+1);
        close(f.calls.lens.at(-1)[0],.04*direction);
        f.gesture('gestureend');
      }
    }
    assert.equal(f.calls.zoom.length,0);assert.equal(f.calls.roll.length,0);
  }finally{f.controls.dispose();}
}));

test('a wheel alongside a Safari gesture is ignored, even with Control held',()=>environment(env=>{
  const f=flight(env);
  try{
    env.fire(env.window,'keydown',{code:'ControlLeft',ctrlKey:true});
    f.gesture('gesturestart');f.wheel({ctrlKey:true,deltaY:-20});f.wheel({ctrlKey:true,deltaY:-20});
    assert.equal(f.calls.scroll.length,0);assert.equal(f.calls.lens.length,0);
  }finally{f.controls.dispose();}
}));

test('Safari disabled, touch, controls and cancellation gates prevent stale gesture input',()=>environment(env=>{
  const f=flight(env);
  try{
    for(const gate of ['disabled','touch','controls']){
      f.setEnabled(gate!=='disabled');f.setTouching(gate==='touch');env.surface.controls=gate==='controls';
      const event=f.gesture('gesturestart');assert.equal(event.defaultPrevented,false);
      f.gesture('gesturechange',{scale:2});f.gesture('gesturechange',{scale:3});
    }
    assert.equal(f.calls.lens.length,0);env.surface.controls=false;f.setEnabled(true);f.setTouching(false);
    f.gesture('gesturestart');f.gesture('gesturechange',{scale:2});f.controls.cancel();f.gesture('gesturechange',{scale:3});
    assert.equal(f.calls.lens.length,0);
    f.gesture('gesturestart');f.gesture('gesturechange',{scale:2});f.setEnabled(false);f.gesture('gesturechange',{scale:3});
    f.setEnabled(true);f.gesture('gesturechange',{scale:4});assert.equal(f.calls.lens.length,0);
    env.surface.controls=true;assert.equal(f.wheel({ctrlKey:true,deltaY:-50}).defaultPrevented,false);
    assert.equal(f.calls.lens.length,0);assert.equal(f.calls.zoom.length,0);
  }finally{f.controls.dispose();}
}));

test('pinch action feedback starts on applied movement and reverses with the effective delta',()=>environment(env=>{
  const f=flight(env);
  try{
    for(const modifiers of [{},{shiftKey:true},{altKey:true}]){
      f.controls.cancel();const start=f.calls.action.length;
      f.wheel({ctrlKey:true,...modifiers,deltaY:-10});f.wheel({ctrlKey:true,...modifiers,deltaY:-6});
      assert.equal(f.calls.action.length,start,'crossing the threshold alone does not claim movement');
      f.wheel({ctrlKey:true,...modifiers,deltaY:-4});assert.equal(f.calls.action.at(-1),'lens-in');
      f.wheel({ctrlKey:true,...modifiers,deltaY:2});assert.equal(f.calls.action.at(-1),'lens-out','reversal follows the latest applied delta, not total displacement');
      const count=f.calls.action.length;f.wheel({ctrlKey:true,...modifiers,deltaY:2});assert.equal(f.calls.action.length,count,'unchanged direction does not repeat notifications');
      env.advance(219);assert.equal(f.calls.action.at(-1),'lens-out');env.advance(1);assert.equal(f.calls.action.at(-1),null,'wheel burst feedback ends after idle');
    }
  }finally{f.controls.dispose();}
}));

test('a Shift scroll shows that it looks while its events keep arriving',()=>environment(env=>{
  const calls=[];
  const controls=createFlightControls(env.surface,{
    enabled:()=>true,touching:()=>false,step:()=>false,key:()=>{},command:()=>{},device:()=>{},stop:()=>{},
    lens:()=>{},zoom:()=>{},roll:()=>{},action:value=>calls.push(value),
    scroll:(x,y,intent)=>({kind:intent==='look'?'look':'fly',by:()=>{}}),forced:()=>'trackpad',
  });
  const wheel=values=>env.fire(env.surface,'wheel',{clientX:300,clientY:200,deltaX:0,deltaY:0,deltaMode:0,ctrlKey:false,shiftKey:false,altKey:false,...values});
  try{
    wheel({deltaY:7});assert.equal(calls.length,0,'a plain scroll shows nothing');
    controls.cancel();wheel({deltaY:7,shiftKey:true});assert.equal(calls.at(-1),'look');
    env.advance(100);wheel({deltaY:7,shiftKey:true});env.advance(219);assert.equal(calls.at(-1),'look');
    env.advance(1);assert.equal(calls.at(-1),null,'the hint returns once the scroll stops');
  }finally{controls.dispose();}
}));

test('clicky wheel action feedback uses the signed camera operation with and without Shift',()=>environment(env=>{
  const f=flight(env);
  try{
    for(const [shiftKey,deltaY,action] of [[false,-3,'lens-in'],[false,3,'lens-out'],[true,-3,'approach-out'],[true,3,'approach-in']]){
      f.wheel({deltaMode:1,deltaY,shiftKey});assert.equal(f.calls.action.at(-1),action);
    }
    env.advance(220);assert.equal(f.calls.action.at(-1),null);
  }finally{f.controls.dispose();}
}));

test('Safari action feedback follows scale reversals and native twist, then clears at gesture end',()=>environment(env=>{
  const f=flight(env);
  try{
    for(const modifiers of [{},{shiftKey:true},{altKey:true}]){
      const start=f.calls.action.length;
      f.gesture('gesturestart',modifiers);f.gesture('gesturechange',{...modifiers,scale:Math.exp(.16)});
      assert.equal(f.calls.action.length,start);
      f.gesture('gesturechange',{...modifiers,scale:Math.exp(.20)});assert.equal(f.calls.action.at(-1),'lens-in');
      f.gesture('gesturechange',{...modifiers,scale:Math.exp(.18)});assert.equal(f.calls.action.at(-1),'lens-out');
      env.advance(500);assert.equal(f.calls.action.at(-1),'lens-out','Safari keeps feedback until its explicit end');
      f.gesture('gestureend');assert.equal(f.calls.action.at(-1),null);
    }
    const start=f.calls.action.length;f.gesture('gesturestart');f.gesture('gesturechange',{rotation:10});f.gesture('gesturechange',{rotation:20});
    assert.equal(f.calls.action.length,start);
    f.gesture('gesturechange',{rotation:25});assert.equal(f.calls.action.at(-1),'roll-right');
    f.gesture('gesturechange',{rotation:24});assert.equal(f.calls.action.at(-1),'roll-left');
    f.gesture('gestureend');assert.equal(f.calls.action.at(-1),null);
  }finally{f.controls.dispose();}
}));

test('action feedback clears on a modifier change and returns with the next movement',()=>environment(env=>{
  const f=flight(env);
  try{
    f.wheel({ctrlKey:true,deltaY:-16});f.wheel({ctrlKey:true,deltaY:-4});
    env.fire(env.window,'keydown',{code:'ShiftLeft',shiftKey:true,altKey:false});assert.equal(f.calls.action.at(-1),null);
    f.wheel({ctrlKey:true,shiftKey:true,deltaY:-4});assert.equal(f.calls.action.at(-1),'lens-in');
    env.fire(env.window,'keyup',{code:'ShiftLeft',shiftKey:false,altKey:false});assert.equal(f.calls.action.at(-1),null);
  }finally{f.controls.dispose();}
}));

test('pointer movement keeps action feedback; leaving, blur, cancel and disposal clear it and pending timers',()=>environment(env=>{
  const f=flight(env),start=()=>{f.wheel({ctrlKey:true,deltaY:-16});f.wheel({ctrlKey:true,deltaY:-4});assert.equal(f.calls.action.at(-1),'lens-in');};
  try{
    start();env.fire(env.surface,'pointermove');assert.equal(f.calls.action.at(-1),'lens-in');
    env.fire(env.surface,'pointerleave');assert.equal(f.calls.action.at(-1),null);assert.equal(env.timers.size,0);
    f.wheel({ctrlKey:true,deltaY:-4});assert.equal(f.calls.action.at(-1),null,'leaving also resets recognition');
    f.controls.cancel();start();env.fire(env.window,'blur');assert.equal(f.calls.action.at(-1),null);assert.equal(env.timers.size,0);
    start();f.controls.cancel();assert.equal(f.calls.action.at(-1),null);assert.equal(env.timers.size,0);
    start();f.controls.dispose();assert.equal(f.calls.action.at(-1),null);assert.equal(env.timers.size,0);
    const count=f.calls.action.length;env.advance(500);assert.equal(f.calls.action.length,count,'disposed feedback has no late callback');
  }finally{f.controls.dispose();}
}));

test('a host clearing feedback permits the same ongoing action to appear again',()=>environment(env=>{
  const f=flight(env);
  try{
    f.wheel({ctrlKey:true,deltaY:-16});f.wheel({ctrlKey:true,deltaY:-4});
    assert.equal(f.calls.action.at(-1),'lens-in');
    f.controls.clearAction();assert.equal(f.calls.action.at(-1),null);assert.equal(env.timers.size,0);
    const count=f.calls.action.length;
    f.wheel({ctrlKey:true,deltaY:-4});assert.equal(f.calls.action.length,count+1);assert.equal(f.calls.action.at(-1),'lens-in');
  }finally{f.controls.dispose();}
}));
