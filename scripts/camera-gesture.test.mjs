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

function flight(env){
  const calls={lens:[],zoom:[],roll:[],scroll:[],moves:[],action:[],stop:0};let enabled=true,touching=false;
  const controls=createFlightControls(env.surface,{
    enabled:()=>enabled,touching:()=>touching,step:()=>false,key:()=>{},command:()=>{},device:()=>{},stop:()=>calls.stop++,
    lens:(...args)=>calls.lens.push(args),zoom:(...args)=>calls.zoom.push(args),roll:value=>calls.roll.push(value),
    action:value=>calls.action.push(value),
    scroll:(...args)=>{calls.scroll.push(args);return {by:(...args)=>calls.moves.push(args)};},
  });
  const wheel=values=>env.fire(env.surface,'wheel',{clientX:300,clientY:200,deltaX:0,deltaY:0,deltaMode:0,ctrlKey:false,shiftKey:false,altKey:false,...values});
  const gesture=(type,values={})=>env.fire(env.surface,type,{clientX:300,clientY:200,scale:1,rotation:0,shiftKey:false,altKey:false,...values});
  return {calls,controls,wheel,gesture,setEnabled:value=>{enabled=value;},setTouching:value=>{touching=value;}};
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

test('Chromium pinch maps ordinary to lens, Shift to approach, and Option to roll with precedence',()=>environment(env=>{
  const f=flight(env);
  try{
    for(const [modifiers,channel,sign] of [[{},'lens',1],[{shiftKey:true},'zoom',-1],[{altKey:true},'roll',1],[{shiftKey:true,altKey:true},'roll',1]]){
      for(const direction of [-1,1]){
        f.controls.cancel();const before=Object.fromEntries(['lens','zoom','roll'].map(name=>[name,f.calls[name].length]));
        f.wheel({ctrlKey:true,...modifiers,deltaY:-10*direction});
        f.wheel({ctrlKey:true,...modifiers,deltaY:-6*direction});
        for(const name of ['lens','zoom','roll'])assert.equal(f.calls[name].length,before[name],'threshold crossing rebases');
        f.wheel({ctrlKey:true,...modifiers,deltaY:-4*direction});
        for(const name of ['lens','zoom','roll'])assert.equal(f.calls[name].length,before[name]+Number(name===channel));
        const applied=f.calls[channel].at(-1);close(channel==='roll'?applied:applied[0],.04*direction*sign);
      }
    }
    assert.equal(f.calls.scroll.length,0);
  }finally{f.controls.dispose();}
}));

test('Chromium live pinch modifiers rebase and require new intent before changing operation',()=>environment(env=>{
  const f=flight(env),pinch=values=>f.wheel({ctrlKey:true,...values});
  try{
    pinch({deltaY:-16});pinch({deltaY:-4});close(f.calls.lens[0][0],.04);
    for(const modifiers of [{shiftKey:true},{shiftKey:true,altKey:true},{}]){
      const before=[f.calls.lens.length,f.calls.zoom.length,f.calls.roll.length];
      pinch({...modifiers,deltaY:-100});pinch({...modifiers,deltaY:-10});pinch({...modifiers,deltaY:-6});
      assert.deepEqual([f.calls.lens.length,f.calls.zoom.length,f.calls.roll.length],before,'old motion and fresh threshold do not move the next operation');
      pinch({...modifiers,deltaY:-4});
    }
    assert.equal(f.calls.lens.length,2);assert.equal(f.calls.zoom.length,1);assert.equal(f.calls.roll.length,1);
    close(f.calls.zoom[0][0],-.04);close(f.calls.roll[0],.04);close(f.calls.lens[1][0],.04);
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
  const f=flight(env);
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

test('ordinary scroll, Shift-look and clicky wheel retain their camera operations',()=>environment(env=>{
  const f=flight(env);
  try{
    f.wheel({deltaX:2,deltaY:7});assert.equal(f.calls.scroll[0][2],false);
    f.controls.cancel();f.wheel({deltaY:7,shiftKey:true});assert.equal(f.calls.scroll[1][2],true);
    f.controls.cancel();f.wheel({deltaY:3,deltaMode:1});assert.equal(f.calls.zoom.length,1);
    f.controls.cancel();f.wheel({deltaY:-3,deltaMode:1,shiftKey:true});assert.equal(f.calls.lens.length,1);close(f.calls.lens[0][0],Math.log(2)/3);
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

test('Safari pinch modifier mapping matches Chromium, and modified pinches ignore native twist',()=>environment(env=>{
  const f=flight(env);
  try{
    for(const [modifiers,channel,sign] of [[{},'lens',1],[{shiftKey:true},'zoom',-1],[{altKey:true},'roll',1],[{shiftKey:true,altKey:true},'roll',1]]){
      for(const direction of [-1,1]){
        f.controls.cancel();const before=Object.fromEntries(['lens','zoom','roll'].map(name=>[name,f.calls[name].length]));
        f.gesture('gesturestart',modifiers);
        f.gesture('gesturechange',{...modifiers,scale:Math.exp(.16*direction)});
        for(const name of ['lens','zoom','roll'])assert.equal(f.calls[name].length,before[name]);
        f.gesture('gesturechange',{...modifiers,scale:Math.exp(.20*direction)});
        for(const name of ['lens','zoom','roll'])assert.equal(f.calls[name].length,before[name]+Number(name===channel));
        const applied=f.calls[channel].at(-1);close(channel==='roll'?applied:applied[0],.04*direction*sign);
        if(channel!=='lens'){
          const rolls=f.calls.roll.length;
          f.gesture('gesturechange',{...modifiers,scale:Math.exp(.20*direction),rotation:45});
          f.gesture('gesturechange',{...modifiers,scale:Math.exp(.20*direction),rotation:60});
          assert.equal(f.calls.roll.length,rolls,'modified pinch does not also consume native twist');
        }
      }
    }
  }finally{f.controls.dispose();}
}));

test('Safari live modifiers rebase absolute scale and native rotation before starting the new operation',()=>environment(env=>{
  const f=flight(env);
  try{
    f.gesture('gesturestart');f.gesture('gesturechange',{scale:Math.exp(.16)});f.gesture('gesturechange',{scale:Math.exp(.20)});
    let base=1;
    for(const modifiers of [{shiftKey:true},{shiftKey:true,altKey:true},{}]){
      const before=[f.calls.lens.length,f.calls.zoom.length,f.calls.roll.length];
      for(const delta of [0,.10,.16])f.gesture('gesturechange',{...modifiers,scale:Math.exp(base+delta),rotation:60});
      assert.deepEqual([f.calls.lens.length,f.calls.zoom.length,f.calls.roll.length],before);
      f.gesture('gesturechange',{...modifiers,scale:Math.exp(base+.20),rotation:60});base++;
    }
    assert.equal(f.calls.lens.length,2);assert.equal(f.calls.zoom.length,1);assert.equal(f.calls.roll.length,1);
    close(f.calls.zoom[0][0],-.04);close(f.calls.roll[0],.04);close(f.calls.lens[1][0],.04);
  }finally{f.controls.dispose();}
}));

test('Safari missing modifier fields use keyboard state; explicit false and blur remain authoritative',()=>environment(env=>{
  const f=flight(env);
  const pinch=modifiers=>{
    f.gesture('gesturestart',modifiers);
    f.gesture('gesturechange',{...modifiers,scale:Math.exp(.16)});
    f.gesture('gesturechange',{...modifiers,scale:Math.exp(.20)});
    f.gesture('gestureend');
  };
  try{
    env.fire(env.window,'keydown',{code:'AltLeft',altKey:true,shiftKey:true});
    pinch({altKey:undefined,shiftKey:undefined});assert.equal(f.calls.roll.length,1);assert.equal(f.calls.zoom.length,0);
    pinch({altKey:false,shiftKey:false});assert.equal(f.calls.lens.length,1);assert.equal(f.calls.roll.length,1);
    pinch({altKey:false,shiftKey:true});assert.equal(f.calls.zoom.length,1);
    env.fire(env.window,'keyup',{code:'AltLeft',altKey:false,shiftKey:true});
    pinch({altKey:undefined,shiftKey:undefined});assert.equal(f.calls.zoom.length,2);
    env.fire(env.window,'blur');pinch({altKey:undefined,shiftKey:undefined});assert.equal(f.calls.lens.length,2);
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
    for(const [modifiers,positive,negative] of [[{},'lens-in','lens-out'],[{shiftKey:true},'approach-in','approach-out'],[{altKey:true},'roll-right','roll-left']]){
      f.controls.cancel();const start=f.calls.action.length;
      f.wheel({ctrlKey:true,...modifiers,deltaY:-10});f.wheel({ctrlKey:true,...modifiers,deltaY:-6});
      assert.equal(f.calls.action.length,start,'crossing the threshold alone does not claim movement');
      f.wheel({ctrlKey:true,...modifiers,deltaY:-4});assert.equal(f.calls.action.at(-1),positive);
      f.wheel({ctrlKey:true,...modifiers,deltaY:2});assert.equal(f.calls.action.at(-1),negative,'reversal follows the latest applied delta, not total displacement');
      const count=f.calls.action.length;f.wheel({ctrlKey:true,...modifiers,deltaY:2});assert.equal(f.calls.action.length,count,'unchanged direction does not repeat notifications');
      env.advance(219);assert.equal(f.calls.action.at(-1),negative);env.advance(1);assert.equal(f.calls.action.at(-1),null,'wheel burst feedback ends after idle');
    }
  }finally{f.controls.dispose();}
}));

test('clicky wheel action feedback uses the signed camera operation with and without Shift',()=>environment(env=>{
  const f=flight(env);
  try{
    for(const [shiftKey,deltaY,action] of [[false,-3,'approach-in'],[false,3,'approach-out'],[true,-3,'lens-in'],[true,3,'lens-out']]){
      f.wheel({deltaMode:1,deltaY,shiftKey});assert.equal(f.calls.action.at(-1),action);
    }
    env.advance(220);assert.equal(f.calls.action.at(-1),null);
  }finally{f.controls.dispose();}
}));

test('Safari action feedback follows scale reversals and native twist, then clears at gesture end',()=>environment(env=>{
  const f=flight(env);
  try{
    for(const [modifiers,positive,negative] of [[{},'lens-in','lens-out'],[{shiftKey:true},'approach-in','approach-out'],[{altKey:true},'roll-right','roll-left']]){
      const start=f.calls.action.length;
      f.gesture('gesturestart',modifiers);f.gesture('gesturechange',{...modifiers,scale:Math.exp(.16)});
      assert.equal(f.calls.action.length,start);
      f.gesture('gesturechange',{...modifiers,scale:Math.exp(.20)});assert.equal(f.calls.action.at(-1),positive);
      f.gesture('gesturechange',{...modifiers,scale:Math.exp(.18)});assert.equal(f.calls.action.at(-1),negative);
      env.advance(500);assert.equal(f.calls.action.at(-1),negative,'Safari keeps feedback until its explicit end');
      f.gesture('gestureend');assert.equal(f.calls.action.at(-1),null);
    }
    const start=f.calls.action.length;f.gesture('gesturestart');f.gesture('gesturechange',{rotation:10});f.gesture('gesturechange',{rotation:20});
    assert.equal(f.calls.action.length,start);
    f.gesture('gesturechange',{rotation:25});assert.equal(f.calls.action.at(-1),'roll-right');
    f.gesture('gesturechange',{rotation:24});assert.equal(f.calls.action.at(-1),'roll-left');
    f.gesture('gestureend');assert.equal(f.calls.action.at(-1),null);
  }finally{f.controls.dispose();}
}));

test('action feedback clears on modifier transitions before the new operation passes its threshold',()=>environment(env=>{
  const f=flight(env);
  try{
    f.wheel({ctrlKey:true,deltaY:-16});f.wheel({ctrlKey:true,deltaY:-4});
    env.fire(env.window,'keydown',{code:'ShiftLeft',shiftKey:true,altKey:false});assert.equal(f.calls.action.at(-1),null);
    f.wheel({ctrlKey:true,shiftKey:true,deltaY:-100});f.wheel({ctrlKey:true,shiftKey:true,deltaY:-16});assert.equal(f.calls.action.at(-1),null);
    f.wheel({ctrlKey:true,shiftKey:true,deltaY:-4});assert.equal(f.calls.action.at(-1),'approach-in');
    env.fire(env.window,'keyup',{code:'ShiftLeft',shiftKey:false,altKey:false});assert.equal(f.calls.action.at(-1),null);
    f.controls.cancel();f.gesture('gesturestart');f.gesture('gesturechange',{scale:1.2});f.gesture('gesturechange',{scale:1.4});
    assert.equal(f.calls.action.at(-1),'lens-in');
    f.gesture('gesturechange',{scale:2,altKey:true});assert.equal(f.calls.action.at(-1),null);
    f.gesture('gesturechange',{scale:2.4,altKey:true});assert.equal(f.calls.action.at(-1),null);
    f.gesture('gesturechange',{scale:2.6,altKey:true});assert.equal(f.calls.action.at(-1),'roll-right');
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
