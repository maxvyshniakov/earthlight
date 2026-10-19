import assert from 'node:assert/strict';

// agent-browser's keydown currently omits modifier flags. Send real CDP input
// with explicit modifiers so these checks exercise browser zoom and pointer capture.
async function mouseInput(run){
 const socket=new WebSocket((await run('get','cdp-url')).trim());
 await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
 let id=0;const pending=new Map();
 socket.addEventListener('message',event=>{const message=JSON.parse(event.data),request=pending.get(message.id);if(request){pending.delete(message.id);message.error?request.reject(new Error(message.error.message)):request.resolve(message.result);}});
 const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});socket.send(JSON.stringify({id,method,params,sessionId}));});
 const sceneURL=(await run('get','url')).trim();
 const {targetInfos}=await send('Target.getTargets');
 const page=targetInfos.find(target=>target.type==='page'&&target.url===sceneURL);
 const {sessionId}=await send('Target.attachToTarget',{targetId:page.targetId,flatten:true});
 const mouse=params=>send('Input.dispatchMouseEvent',params,sessionId);
 const buttons={left:1,right:2,middle:4};
 return {mouse,close:()=>socket.close(),
  async drag([x0,y0],[x1,y1],button='left',modifiers=0,during=async()=>{}){
   await mouse({type:'mouseMoved',x:x0,y:y0,modifiers});
   await mouse({type:'mousePressed',x:x0,y:y0,button,buttons:buttons[button],clickCount:1,modifiers});
   await during();
   for(let i=1;i<=10;i++){await mouse({type:'mouseMoved',x:x0+(x1-x0)*i/10,y:y0+(y1-y0)*i/10,button,buttons:buttons[button],modifiers});await new Promise(r=>setTimeout(r,16));}
   await mouse({type:'mouseReleased',x:x1,y:y1,button,buttons:0,clickCount:1,modifiers});
  }};
}

export async function verifyFlight({run,evaluate,wait,base}){
 await run('open',`${base}/?t=1000&motion=0`);
 await wait("document.querySelector('earthlight-explorer').dataset.focus==='sharp'");
 const read=()=>evaluate(`(()=>{const e=document.querySelector('earthlight-explorer');return {mode:e.dataset.flightMode,orbit:e.dataset.orbit,alt:Number(e.dataset.cameraAltitude),lens:Number(e.dataset.lens),position:e.dataset.cameraPosition,basis:JSON.parse(e.dataset.cameraBasis),roll:(()=>{const r=parseFloat(getComputedStyle(document.querySelector('.hud-attitude .gauge')).getPropertyValue('--roll'));return Math.round(((r%360)+540)%360-180);})(),time:e.querySelector('.explorer-time').textContent,url:location.search};})()`);
 const same=(a,b,tolerance=1e-7)=>a.basis.every((v,i)=>Math.abs(v-b.basis[i])<tolerance);
 const radius=state=>Math.hypot(...state.position.split(',').map(Number));
 const key=(type,code)=>evaluate(`document.querySelector('.explorer-view').dispatchEvent(new KeyboardEvent('${type}',{code:'${code}',bubbles:true}));true`);
 const before=await read();
 await evaluate("document.querySelector('[data-flight-mode=free]').click();true");
 await run('wait','120');
 const detached=await read();assert.equal(detached.mode,'free');assert.equal(detached.position,before.position);
 assert.ok(same(detached,before),'detaching preserves every camera ray');
 await evaluate("document.querySelector('.explorer-view').focus();true");
 await key('keydown','KeyR');await run('wait','400');await key('keyup','KeyR');
 await run('wait','1700');
 const moved=await read();assert.ok(moved.alt>detached.alt+20);assert.equal(moved.time,detached.time,'camera moves while replay is paused');
 assert.equal(new URLSearchParams(moved.url).get('flight'),'free');
 await run('reload');await wait("document.querySelector('earthlight-explorer').dataset.focus==='sharp'");
 const restored=await read();assert.ok(Math.abs(restored.alt-moved.alt)<.01);assert.equal(restored.mode,'free');
 assert.ok(same(restored,moved,1e-6));
 // Controls keep their own keys and scrolling. Blur cancels a held movement.
 await evaluate("document.querySelector('#explorer-settings').showPopover();document.querySelector('[data-look=grain]').focus();document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyE',bubbles:true}));true");
 await run('wait','200');const typed=await read();assert.equal(typed.position,restored.position);assert.ok(same(typed,restored));
 const panelWheel=await evaluate("(()=>{const e=new WheelEvent('wheel',{deltaY:120,bubbles:true,cancelable:true});document.querySelector('#explorer-settings').dispatchEvent(e);return e.defaultPrevented;})()");assert.equal(panelWheel,false);
 await evaluate("document.querySelector('#explorer-settings').hidePopover();document.querySelector('.explorer-view').focus();document.querySelector('.explorer-view').dispatchEvent(new KeyboardEvent('keydown',{code:'KeyW',bubbles:true}));window.dispatchEvent(new Event('blur'));true");
 await run('wait','300');const stopped=await read();await run('wait','300');assert.equal((await read()).position,stopped.position);
 const gesture=async(init,target='.explorer-view',x=720,y=180)=>evaluate(`(()=>{const e=new WheelEvent('wheel',{clientX:${x},clientY:${y},...${JSON.stringify(init)},bubbles:true,cancelable:true});document.querySelector('${target}').dispatchEvent(e);return e.defaultPrevented;})()`);
 const pinchBurst=(deltas,shiftKey=false)=>evaluate(`(async()=>{
  const view=document.querySelector('.explorer-view'),explorer=document.querySelector('earthlight-explorer'),samples=[];
  for(const deltaY of ${JSON.stringify(deltas)}){
   const event=new WheelEvent('wheel',{clientX:720,clientY:180,deltaY,ctrlKey:true,shiftKey:${shiftKey},bubbles:true,cancelable:true});
   view.dispatchEvent(event);
   await new Promise(resolve=>setTimeout(resolve,16));
   samples.push({prevented:event.defaultPrevented,lens:Number(explorer.dataset.lens),alt:Number(explorer.dataset.cameraAltitude),action:view.dataset.cameraAction,cursor:getComputedStyle(view).cursor});
  }
  return samples;
 })()`);
 // A trackpad scroll over the sky moves over Earth too, turning the globe,
 // and keeps the replay clock.
 const looking=await read();
 for(let i=0;i<6;i++)assert.equal(await gesture({deltaX:7,deltaY:-3}),true);
 await run('wait','400');
 const looked=await read();assert.notEqual(looked.position,looking.position,'a scroll over the sky turns the globe');assert.equal(looked.time,looking.time);
 // Over Earth a trackpad scroll spins the globe and never runs out of travel;
 // with Shift the same scroll only looks.
 // These are separate swipes. Cancel the old smoothing queue before taking
 // the baseline; the later coast scenario tests uninterrupted momentum.
 await evaluate(`(async()=>{
  window.dispatchEvent(new Event('blur'));
  const e=document.querySelector('earthlight-explorer'),pose=()=>e.dataset.cameraPosition+'|'+e.dataset.cameraBasis;
  await new Promise((resolve,reject)=>{
   let previous=pose(),stableSince=performance.now();
   const timer=setTimeout(()=>reject(new Error('Camera pose did not settle after cancelling the swipe')),5000);
   const sample=now=>{const current=pose();if(current!==previous){previous=current;stableSince=now;}
    if(now-stableSince>=160){clearTimeout(timer);resolve();}else requestAnimationFrame(sample);};
   requestAnimationFrame(sample);
  });
  return true;
 })()`);
 const spinFrom=await read(),{width:w}=await evaluate('({width:innerWidth,height:innerHeight})');
 const ground=await evaluate(`(()=>{const e=document.querySelector('earthlight-explorer'),p=e.dataset.cameraPosition.split(',').map(Number),b=JSON.parse(e.dataset.cameraBasis),h=innerHeight;
  for(let y=h-30;y>0;y-=4){const v=(h/2-y)/h,r=[0,1,2].map(i=>b[3+i]*v+b[6+i]*1.25),n=Math.hypot(...r),d=r.map(x=>x/n),q=p[0]*d[0]+p[1]*d[1]+p[2]*d[2];if(q<0&&q*q-(p[0]**2+p[1]**2+p[2]**2)+1>0)return y;}return null;})()`);
 assert.ok(ground,'Earth is in view');
 // Keep one swipe inside the browser: separate CLI calls can exceed the
 // 160 ms session boundary, especially after the GPU fixtures above.
 const shiftSwipe=await evaluate(`(async()=>{
  const view=document.querySelector('.explorer-view'),explorer=document.querySelector('earthlight-explorer'),samples=[];
  for(let i=0;i<4;i++){
   const event=new WheelEvent('wheel',{clientX:${w/2},clientY:${ground},deltaX:.5,deltaY:8,shiftKey:true,bubbles:true,cancelable:true});
   view.dispatchEvent(event);
   samples.push({prevented:event.defaultPrevented,ready:explorer.hasAttribute('data-ready'),hidden:document.hidden,action:view.dataset.cameraAction});
   await new Promise(resolve=>setTimeout(resolve,16));
  }
  return samples;
 })()`);
 assert.ok(shiftSwipe.every(sample=>sample.prevented&&sample.ready&&!sample.hidden),`Shift swipe admitted: ${JSON.stringify(shiftSwipe)}`);
 assert.ok(shiftSwipe.every(sample=>sample.action==='look'),'a Shift swipe shows the four arrows while it looks');
 await wait(`JSON.parse(document.querySelector('earthlight-explorer').dataset.cameraBasis).some((value,index)=>Math.abs(value-${JSON.stringify(spinFrom.basis)}[index])>1e-7)`);
 await run('wait','400');const shiftLooked=await read();
 assert.equal(shiftLooked.position,spinFrom.position,'Shift-scroll over Earth only looks');assert.ok(!same(shiftLooked,spinFrom));
 assert.equal(shiftLooked.lens,1,'a Shift trackpad scroll never zooms the lens');
 // A trackpad's deltas drift across both axes, which tells it from a wheel.
 for(let i=0;i<40;i++)await gesture({deltaX:-.5,deltaY:-12},'.explorer-view',w/2,ground);
 await run('wait','400');const spun=await read();assert.notEqual(spun.position,shiftLooked.position);
 // A swipe keeps its modifiers while its events, momentum included, keep
 // arriving: Shift or Control pressed as the globe coasts neither looks nor
 // zooms. macOS delivers the vertical momentum sideways while Shift is held.
 const coast=await evaluate(`(async()=>{
  const e=document.querySelector('earthlight-explorer'),view=document.querySelector('.explorer-view'),angle=()=>{const p=e.dataset.cameraPosition.split(',').map(Number),n=Math.hypot(...p);return p.map(v=>v/n);};
  const send=init=>view.dispatchEvent(new WheelEvent('wheel',{clientX:${w/2},clientY:${ground},bubbles:true,cancelable:true,...init}));
  const phase=async(count,init)=>{const from=angle();for(let i=0;i<count;i++){send(init);await new Promise(r=>setTimeout(r,16));}return Math.acos(Math.min(1,from.reduce((s,v,i)=>s+v*angle()[i],0)));};
  const start={alt:Number(e.dataset.cameraAltitude),lens:Number(e.dataset.lens)};
  const plain=await phase(30,{deltaX:-.5,deltaY:-12});
  const shifted=await phase(30,{deltaX:-12,deltaY:0,shiftKey:true});
  window.dispatchEvent(new KeyboardEvent('keydown',{key:'Control',code:'ControlLeft',ctrlKey:true}));
  const controlled=await phase(30,{deltaX:0,deltaY:-12,ctrlKey:true});
  window.dispatchEvent(new KeyboardEvent('keyup',{key:'Control',code:'ControlLeft'}));
  await new Promise(r=>setTimeout(r,400));
  return {plain,shifted,controlled,alt:Number(e.dataset.cameraAltitude)/start.alt,lens:Number(e.dataset.lens)/start.lens};
 })()`);
 assert.ok(coast.shifted>coast.plain*.6&&coast.controlled>coast.plain*.6,`the globe keeps turning: ${JSON.stringify(coast)}`);
 assert.ok(Math.abs(coast.alt-1)<.01&&coast.lens===1,`no zoom: ${JSON.stringify(coast)}`);
 // A clicky mouse wheel with Shift changes altitude. Chromium reports a trackpad pinch
 // as a Ctrl-wheel burst; it crosses a deliberate threshold, then changes only
 // the lens. The activating event rebases the pinch without a catch-up jump.
 const viewport=await evaluate('visualViewport.scale'),pixelRatio=await evaluate('devicePixelRatio');
 const altitude="Number(document.querySelector('earthlight-explorer').dataset.cameraAltitude)";
 const clickyAction=await evaluate("(()=>{const view=document.querySelector('.explorer-view'),event=new WheelEvent('wheel',{clientX:720,clientY:180,deltaY:-3,deltaMode:1,shiftKey:true,bubbles:true,cancelable:true});view.dispatchEvent(event);return {prevented:event.defaultPrevented,action:view.dataset.cameraAction};})()");
 assert.equal(clickyAction.prevented,true);assert.equal(clickyAction.action,'approach-out','Shift clicky wheel shows outward direction');
 await wait(`${altitude}>${spun.alt}+1`);await run('wait','500');
 assert.equal(await evaluate("document.querySelector('.explorer-view').dataset.cameraAction??null"),null,'clicky wheel feedback clears after idle');
 const wheeled=await read();
 const pinching=await pinchBurst([-6,-6,-6,-20,-20]);
 assert.ok(pinching.every(sample=>sample.prevented),'the browser cannot take the pinch');
 assert.equal(pinching[1].lens,wheeled.lens,'a small pinch stays below the threshold');
 assert.equal(pinching[2].lens,wheeled.lens,'activation rebases the lens');
 assert.equal(pinching[1].action,undefined,'a small pinch shows no action');
 assert.equal(pinching[2].action,undefined,'activation shows no action before motion');
 assert.ok(pinching.at(-1).lens>pinching[2].lens,'movement after activation zooms the lens');
 assert.equal(pinching.at(-1).action,'lens-in');
 assert.equal(pinching.at(-1).cursor,'zoom-in');
 assert.ok(pinching.every(sample=>Math.abs(sample.alt-wheeled.alt)<.01),'a pinch never changes altitude');
 assert.equal(await evaluate('visualViewport.scale'),viewport);
 assert.equal(await gesture({deltaY:-40,ctrlKey:true},'#explorer-settings'),false);
 // A scroll still in flight ends with focus loss and moves nothing afterwards.
 await evaluate("(()=>{document.querySelector('.explorer-view').dispatchEvent(new WheelEvent('wheel',{clientX:720,clientY:180,deltaX:30,deltaY:12,bubbles:true,cancelable:true}));window.dispatchEvent(new Event('blur'));return true;})()");
 await run('wait','200');const blurred=await read();await run('wait','200');assert.equal((await read()).position,blurred.position);
 await run('reload');await wait("document.querySelector('earthlight-explorer').dataset.focus==='sharp'");
 const gestureRestored=await read();assert.ok(same(gestureRestored,blurred,1e-6));
 // Real mouse input: Earth follows the pointer, the sky turns the camera,
 // Option twists the image, and a double-click flies toward a point.
 await evaluate("document.querySelector('[data-orbit=high]').click();true");
 await run('wait','1500');
 const globe=await read();assert.equal(globe.mode,'follow');assert.equal(globe.orbit,'high');
 const {width,height}=await evaluate('({width:innerWidth,height:innerHeight})'),centre=[width/2,height/2];
 const input=await mouseInput(run);
 try{
  const cursor=()=>evaluate("(()=>{const e=document.querySelector('.explorer-view');return {kind:e.dataset.cursor,cursor:getComputedStyle(e).cursor,dragging:e.dataset.cameraDragging};})()");
  await input.mouse({type:'mouseMoved',x:width*.25,y:90,modifiers:0});assert.equal((await cursor()).kind,'fly');
  // Shift hints with a crosshair; the four arrows wait for the camera to
  // turn. Control shows the orbit about a point.
  await input.mouse({type:'mouseMoved',x:width*.25,y:90,modifiers:8});
  const shiftedCursor=await cursor();assert.equal(shiftedCursor.kind,'look');assert.equal(shiftedCursor.cursor,'crosshair');
  await input.mouse({type:'mouseMoved',x:width*.25,y:90,modifiers:1});assert.equal((await cursor()).kind,'roll');
  await input.mouse({type:'mouseMoved',x:width*.25,y:90,modifiers:9});assert.equal((await cursor()).kind,'roll','Option takes cursor precedence');
  await input.mouse({type:'mouseMoved',x:width*.25,y:90,modifiers:11});
  const circleCursor=await cursor();assert.equal(circleCursor.kind,'circle','Control takes cursor precedence');assert.match(circleCursor.cursor,/^url\(/);
  assert.notEqual(circleCursor.cursor,shiftedCursor.cursor);
  const hintIcons=await evaluate(`(async()=>Promise.all(${JSON.stringify([circleCursor.cursor])}.map(async cursor=>{
   const image=new Image();image.src=cursor.match(/url\\("([^"]+)"\\)/)[1];await image.decode();return image.naturalWidth>0;
  })))()`);
  assert.deepEqual(hintIcons,[true],'the circle SVG cursor decodes');
  await input.mouse({type:'mouseMoved',x:width*.25,y:90,modifiers:0});assert.equal((await cursor()).kind,'fly');
  await evaluate("window.dispatchEvent(new KeyboardEvent('keydown',{key:'Shift',shiftKey:true}));true");
  assert.equal((await cursor()).kind,'look');
  await evaluate("window.dispatchEvent(new KeyboardEvent('keyup',{key:'Shift'}));true");
  assert.equal((await cursor()).kind,'fly','releasing Shift restores the fly cursor');
  await input.drag([centre[0]+40,centre[1]+30],[centre[0]+120,centre[1]-10]);await run('wait','300');
  const flung=await read();assert.equal(flung.mode,'free','grabbing Earth starts free flight');assert.notEqual(flung.position,globe.position);
  // A quick release may keep the planet turning for a moment; wait until it settles.
  let flown=flung;
  for(let i=0;i<40;i++){await run('wait','300');const next=await read();if(next.position===flown.position)break;flown=next;}
  await run('wait','300');assert.equal((await read()).position,flown.position);
  // A plain drag on the sky moves over Earth too: off the planet the globe
  // turns. Sky near the top left, clear of the presets and the lens tape.
  await input.drag([width*.25,90],[width*.25+50,40]);await run('wait','300');
  const spun=await read();assert.notEqual(spun.position,flown.position,'a drag on the sky turns the globe');
  let settled=spun;
  for(let i=0;i<40;i++){await run('wait','300');const next=await read();if(next.position===settled.position)break;settled=next;}
  // With Shift it looks instead, and the camera stays put.
  let activeShiftCursor;
  await input.drag([width*.25,90],[width*.25+50,40],'left',8,async()=>{activeShiftCursor=await cursor();});await run('wait','300');
  assert.equal(activeShiftCursor.dragging,'look');assert.match(activeShiftCursor.cursor,/^url\(/,'Shift-drag looks under the four arrows');
  const arrows=await evaluate(`(async()=>{const image=new Image();image.src=${JSON.stringify(activeShiftCursor.cursor)}.match(/url\\("([^"]+)"\\)/)[1];await image.decode();return image.naturalWidth>0;})()`);
  assert.ok(arrows,'the four-arrow SVG cursor decodes');
  const turned=await read();assert.equal(turned.position,settled.position,'Shift-drag only looks');assert.ok(!same(turned,settled));
  await input.drag([centre[0]+50,centre[1]],[centre[0]+60,centre[1]+50],'middle');await run('wait','300');
  const rightLook=await read();assert.equal(rightLook.position,turned.position,'middle-drag only looks, even over Earth');
  await input.drag([centre[0]+200,centre[1]],[centre[0],centre[1]+200],'left',1);await run('wait','300');
  const rolled=await read();assert.equal(rolled.position,rightLook.position);assert.notEqual(rolled.roll,rightLook.roll);
  // The right button circles the point under the pointer: the camera moves.
  await input.drag([centre[0],centre[1]+60],[centre[0]+80,centre[1]+40],'right');await run('wait','300');
  const circled=await read();assert.notEqual(circled.position,rolled.position,'right-drag circles a point');assert.equal(circled.mode,'free');
  await evaluate("document.querySelector('.explorer-view').focus();document.querySelector('.explorer-view').dispatchEvent(new KeyboardEvent('keydown',{code:'KeyH',bubbles:true}));document.querySelector('.explorer-view').dispatchEvent(new KeyboardEvent('keyup',{code:'KeyH',bubbles:true}));true");
  await run('wait','900');assert.equal(Math.abs((await read()).roll),0,'H levels the horizon');
  const far=(await read()).alt;
  await input.mouse({type:'mouseMoved',x:centre[0],y:centre[1]});
  await input.mouse({type:'mousePressed',x:centre[0],y:centre[1],button:'left',buttons:1,clickCount:1});await input.mouse({type:'mouseReleased',x:centre[0],y:centre[1],button:'left',buttons:0,clickCount:1});
  await input.mouse({type:'mousePressed',x:centre[0],y:centre[1],button:'left',buttons:1,clickCount:2});await input.mouse({type:'mouseReleased',x:centre[0],y:centre[1],button:'left',buttons:0,clickCount:2});
  await run('wait','1400');assert.ok((await read()).alt<far*.8,'double-click flies toward Earth');
  await input.mouse({type:'mouseWheel',x:centre[0],y:centre[1],deltaX:0,deltaY:-100,modifiers:2});await run('wait','300');
 }finally{input.close();}
 assert.equal(await evaluate('visualViewport.scale'),viewport,'real Ctrl-wheel must not zoom the browser');
 assert.equal(await evaluate('devicePixelRatio'),pixelRatio,'browser page zoom stays unchanged');
 // Pitching through the zenith from the ISS view is a loop, not a clamp.
 await evaluate("document.querySelector('[data-orbit=iss]').click();true");await run('wait','1500');
 await evaluate("document.querySelector('[data-flight-mode=free]').click();document.querySelector('.explorer-view').focus();true");
 await key('keydown','ArrowUp');await run('wait','2400');await key('keyup','ArrowUp');await run('wait','300');
 assert.ok(Math.abs((await read()).roll)>=170,'a loop over the top leaves the camera inverted');
 // The altitude tape is a slider.
 for(const [code,expected] of [['Home',150],['End',50000]]){
  await evaluate(`(()=>{const e=document.querySelector('#explorer-altitude');e.focus();e.dispatchEvent(new KeyboardEvent('keydown',{key:'${code}',bubbles:true,cancelable:true}));return true;})()`);
  await wait(`Math.abs(Number(document.querySelector('earthlight-explorer').dataset.cameraAltitude)-${expected})<.1`);
 }
 for(const [orbit,altitude] of [['polar',800],['high',20000],['iss',null]]){
  await evaluate(`document.querySelector('[data-orbit=${orbit}]').click();true`);
  await run('wait','1500');const state=await read();assert.equal(state.mode,'follow');assert.equal(state.orbit,orbit);
  if(altitude)assert.ok(Math.abs(state.alt-altitude)<.01);
  assert.equal(new URLSearchParams(state.url).has('position'),false);
 }
 // A plain pinch keeps the camera put and zooms the lens about the pointer.
 // A plain clicky wheel steps the lens. + and − zoom about the centre,
 // the lens tape jumps, and a followed orbit stays followed.
 const lens="Number(document.querySelector('earthlight-explorer').dataset.lens)";
 await key('keydown','Digit0');await key('keyup','Digit0');await wait(`${lens}===1`);
 const following=await read();assert.equal(following.mode,'follow');assert.equal(following.lens,1);
 const plainPinch=await pinchBurst([-20,-20,-20,-20,-20]);
 assert.ok(plainPinch.every(sample=>sample.prevented));await wait(`${lens}>1.5`);
 assert.equal(plainPinch.at(-1).action,'lens-in');
 const pinched=await read();assert.equal(pinched.mode,'follow','the lens never detaches');assert.equal(pinched.position,following.position);assert.equal(pinched.alt,following.alt);
 await run('wait','300');assert.ok(Math.abs(Number(new URLSearchParams((await read()).url).get('lens'))-pinched.lens)<.01,'the lens is in the link');
 assert.equal(await evaluate("document.querySelector('.explorer-view').dataset.cameraAction??null"),null,'pinch feedback clears after idle');
 assert.equal(await gesture({deltaX:0,deltaY:-4.000244140625*3}),true);await wait(`${lens}>${pinched.lens}*1.6`);
 const stepped=await read();assert.equal(stepped.position,following.position);
 await key('keydown','Minus');await run('wait','600');await key('keyup','Minus');await run('wait','100');
 const widened=await read();assert.ok(widened.lens<stepped.lens/1.3,`− widens: ${widened.lens}`);assert.equal(widened.mode,'follow');
 // A press near a labelled mark on the lens tape takes that mark exactly.
 {const at=await evaluate("(()=>{const r=document.querySelector('#explorer-lens [data-mark=\"10\"]').getBoundingClientRect();return [r.left+r.width/2,r.top+2]})()");
  const tap=await mouseInput(run);
  try{await tap.mouse({type:'mouseMoved',x:at[0],y:at[1]});await tap.mouse({type:'mousePressed',x:at[0],y:at[1],button:'left',buttons:1,clickCount:1});await tap.mouse({type:'mouseReleased',x:at[0],y:at[1],button:'left',buttons:0,clickCount:1});}finally{tap.close();}}
 await wait(`Math.abs(${lens}-10)<.01`);
 assert.equal(await evaluate("document.querySelector('#explorer-lens').getAttribute('aria-valuenow')"),'10');
 await run('wait','300');await run('reload');await wait("document.querySelector('earthlight-explorer').dataset.focus==='sharp'");
 const relens=await read();assert.ok(Math.abs(relens.lens-10)<.01,'the lens survives a reload');assert.equal(relens.mode,'follow');
 await evaluate("document.querySelector('[data-flight-mode=free]').click();true");await run('wait','200');
 const freeLens=await read();const widening=await pinchBurst([20,20,20,20,20]);
 assert.ok(widening.every(sample=>sample.prevented));await wait(`${lens}<9`);
 assert.equal(widening.at(-1).action,'lens-out');
 assert.equal(widening.at(-1).cursor,'zoom-out');
 const unpinched=await read();assert.equal(unpinched.position,freeLens.position,'free flight keeps its place too');assert.equal(unpinched.mode,'free');
 // Reset also resumes replay. Pause it before checking camera-only gestures.
 await evaluate("document.querySelector('.reset-all').click();document.querySelector('.explorer-motion').click();true");
 await run('wait','200');const reset=await read();assert.equal(reset.mode,'follow');assert.equal(reset.orbit,'iss');assert.equal(new URLSearchParams(reset.url).has('flight'),false);
 assert.equal(reset.lens,1);assert.equal(new URLSearchParams(reset.url).has('lens'),false,'Reset all restores the wide lens');
 // A pinch zooms the lens whatever the modifiers. With Option a swipe changes
 // altitude up and down and rolls sideways; with Control it circles the point
 // under the pointer. Each phase is its own swipe.
 const wheelFeedback=await evaluate(`(async()=>{
  const view=document.querySelector('.explorer-view'),explorer=document.querySelector('earthlight-explorer'),samples=[];
  const state=()=>({lens:Number(explorer.dataset.lens),alt:Number(explorer.dataset.cameraAltitude),position:explorer.dataset.cameraPosition,action:view.dataset.cameraAction,cursor:getComputedStyle(view).cursor,
   roll:parseFloat(getComputedStyle(document.querySelector('.hud-attitude .gauge')).getPropertyValue('--roll'))});
  const frames=n=>new Promise(resolve=>{const step=()=>n--?requestAnimationFrame(step):resolve();step();});
  const phase=async(count,init)=>{
   let prevented=true;
   for(let i=0;i<count;i++){const event=new WheelEvent('wheel',{clientX:720,clientY:180,bubbles:true,cancelable:true,...init});view.dispatchEvent(event);prevented&&=event.defaultPrevented;await new Promise(r=>setTimeout(r,16));}
   // The direction shows while the swipe lasts; the pose once its smoothed
   // motion has landed, which takes longer on slow frames.
   await frames(3);const {action,cursor}=state();
   await new Promise((resolve,reject)=>{
    const pose=()=>explorer.dataset.cameraPosition+'|'+explorer.dataset.cameraBasis;let previous=pose(),since=performance.now();
    const timer=setTimeout(()=>reject(new Error('Camera pose did not settle after '+JSON.stringify(init))),5000);
    const sample=now=>{const current=pose();if(current!==previous){previous=current;since=now;}
     if(now-since>=300){clearTimeout(timer);resolve();}else requestAnimationFrame(sample);};
    requestAnimationFrame(sample);
   });
   const sample={prevented,...state(),action,cursor};samples.push(sample);return sample;
  };
  await phase(5,{deltaY:-20,ctrlKey:true});
  await phase(4,{deltaY:-20,ctrlKey:true,shiftKey:true});
  await phase(4,{deltaY:-20,ctrlKey:true,altKey:true});
  await phase(10,{deltaX:.5,deltaY:10,altKey:true});
  await phase(10,{deltaX:.5,deltaY:-10,altKey:true});
  view.dispatchEvent(new PointerEvent('pointermove',{clientX:720,clientY:180,pointerType:'mouse',isPrimary:true,altKey:true,bubbles:true}));
  await phase(10,{deltaX:-10,deltaY:.5,altKey:true});
  await phase(10,{deltaX:10,deltaY:.5,altKey:true});
  window.dispatchEvent(new KeyboardEvent('keydown',{key:'Control',code:'ControlLeft',ctrlKey:true}));
  await phase(10,{deltaX:-10,deltaY:.5,ctrlKey:true});
  // A clicky wheel circles with Control and rolls with Option.
  await phase(3,{deltaY:-3,deltaMode:1,ctrlKey:true});
  window.dispatchEvent(new KeyboardEvent('keyup',{key:'Control',code:'ControlLeft'}));
  await phase(3,{deltaY:-3,deltaMode:1,altKey:true});
  // Pointer movement keeps live feedback; leaving clears it.
  view.dispatchEvent(new PointerEvent('pointermove',{clientX:720,clientY:180,pointerType:'mouse',isPrimary:true,altKey:true,bubbles:true}));
  for(let i=0;i<4;i++){view.dispatchEvent(new WheelEvent('wheel',{clientX:720,clientY:180,deltaX:10,deltaY:.5,altKey:true,bubbles:true,cancelable:true}));await new Promise(r=>setTimeout(r,16));}
  await frames(2);
  view.dispatchEvent(new PointerEvent('pointermove',{clientX:720,clientY:180,pointerType:'mouse',isPrimary:true,altKey:true,bubbles:true}));
  const afterMove=view.dataset.cameraAction??null;
  view.dispatchEvent(new Event('pointerleave'));
  return {samples,afterMove,afterLeave:view.dataset.cameraAction??null};
 })()`);
 const [plainPinchMode,shiftPinch,optionPinch,climbIn,climbOut,rollRight,rollLeft,circling,wheelCircle,wheelRoll]=wheelFeedback.samples;
 assert.ok(wheelFeedback.samples.every(sample=>sample.prevented));
 assert.ok(plainPinchMode.lens>reset.lens,'plain pinch magnifies the lens');
 assert.equal(plainPinchMode.position,reset.position,'plain pinch keeps the camera in place');
 assert.ok(shiftPinch.lens>plainPinchMode.lens&&optionPinch.lens>shiftPinch.lens,'Shift and Option pinches zoom the lens too');
 assert.equal(optionPinch.position,reset.position,'a pinch never moves the camera');
 assert.ok(radius(climbIn)<radius(optionPinch),'an Option scroll down lowers the camera');assert.equal(climbIn.lens,optionPinch.lens);
 assert.equal(climbIn.action,'approach-in');
 assert.ok(radius(climbOut)>radius(climbIn),'an Option scroll up raises the camera');assert.equal(climbOut.action,'approach-out');
 assert.notEqual(rollRight.roll,climbOut.roll,'Option swipe sideways rolls');assert.equal(rollRight.position,climbOut.position,'rolling leaves the camera in place');
 assert.equal(rollRight.action,'roll-right');assert.equal(rollLeft.action,'roll-left');
 assert.notEqual(circling.position,rollLeft.position,'Control swipe circles a point');assert.equal(circling.lens,rollLeft.lens);
 assert.notEqual(wheelCircle.position,circling.position,'Control-wheel circles a point');assert.equal(wheelCircle.lens,circling.lens);
 assert.notEqual(wheelRoll.roll,wheelCircle.roll,'Option-wheel rolls');assert.equal(wheelRoll.position,wheelCircle.position,'Option-wheel leaves the camera in place');
 assert.equal(wheelRoll.lens,wheelCircle.lens);assert.equal(wheelRoll.action,'roll-right');
 assert.notEqual(climbIn.cursor,climbOut.cursor,'approach cursors point in opposite directions');
 assert.notEqual(rollRight.cursor,rollLeft.cursor,'roll cursors point in opposite directions');
 const cursorIcons=await evaluate(`(async()=>Promise.all(${JSON.stringify([climbIn.cursor,climbOut.cursor,rollRight.cursor,rollLeft.cursor])}.map(async cursor=>{
  const source=cursor.match(/url\\("([^"]+)"\\)/)?.[1];if(!source)return false;
  const image=new Image();image.src=source;await image.decode();return image.naturalWidth>0&&image.naturalHeight>0;
 })))()`);
 assert.deepEqual(cursorIcons,[true,true,true,true],'all directional SVG cursors decode');
 assert.equal(wheelFeedback.afterMove,'roll-left','pointer movement keeps active feedback');
 assert.equal(wheelFeedback.afterLeave,null,'pointer leave clears action feedback');
 const modifierFeedback=await evaluate(`(()=>{
  const view=document.querySelector('.explorer-view');
  for(let i=0;i<3;i++)view.dispatchEvent(new WheelEvent('wheel',{clientX:720,clientY:180,ctrlKey:true,deltaY:-20,bubbles:true,cancelable:true}));
  const before=view.dataset.cameraAction??null;
  window.dispatchEvent(new KeyboardEvent('keydown',{key:'Shift',shiftKey:true}));
  const after=view.dataset.cameraAction??null;
  window.dispatchEvent(new KeyboardEvent('keyup',{key:'Shift'}));
  return {before,after};
 })()`);
 assert.equal(modifierFeedback.before,'lens-in');assert.equal(modifierFeedback.after,null,'modifier change clears action feedback');
 await evaluate("document.querySelector('.reset-all').click();document.querySelector('.explorer-motion').click();true");
 await run('wait','200');const safariStart=await read();assert.equal(safariStart.lens,1);
 // Safari supplies absolute scale and rotation through gesture events. A
 // synthetic sequence checks its threshold and rebase path in Chromium too.
 const safari=await evaluate(`(async()=>{
  const view=document.querySelector('.explorer-view'),explorer=document.querySelector('earthlight-explorer'),samples=[];
  const state=()=>({lens:Number(explorer.dataset.lens),alt:Number(explorer.dataset.cameraAltitude),position:explorer.dataset.cameraPosition,
   roll:parseFloat(getComputedStyle(document.querySelector('.hud-attitude .gauge')).getPropertyValue('--roll'))});
  const send=async(type,scale,rotation,shiftKey=false,altKey=false)=>{
   const before=state();
   const event=new Event(type,{bubbles:true,cancelable:true});
   Object.defineProperties(event,{scale:{value:scale},rotation:{value:rotation},clientX:{value:720},clientY:{value:180},shiftKey:{value:shiftKey},altKey:{value:altKey}});
   view.dispatchEvent(event);
   const action=view.dataset.cameraAction,cursor=getComputedStyle(view).cursor;
   if(action)await new Promise((resolve,reject)=>{
    const field=action.startsWith('lens-')?'lens':action.startsWith('approach-')?'position':'roll';
    const timer=setTimeout(()=>reject(new Error('No rendered Safari '+action+' movement: '+JSON.stringify({before,current:state()}))),2000);
    const sample=()=>{if(state()[field]!==before[field]){clearTimeout(timer);resolve();}else requestAnimationFrame(sample);};sample();
   });
   await new Promise(resolve=>setTimeout(resolve,16));
   samples.push({prevented:event.defaultPrevented,...state(),action,cursor});
  };
  await send('gesturestart',1,0);await send('gesturechange',1.1,0);await send('gesturechange',1.2,0);await send('gesturechange',1.4,0);
  await send('gesturechange',1.2,0);
  await send('gesturechange',1.6,0,true);await send('gesturechange',2,0,true);await send('gesturechange',2.4,0,true);await send('gesturechange',2,0,true);
  await send('gesturechange',2.6,0,true,true);await send('gesturechange',3,0,true,true);await send('gesturechange',3.4,0,true,true);await send('gesturechange',3,0,true,true);
  await send('gestureend',3,0,true,true);
  await send('gesturestart',1,0);await send('gesturechange',1,10);await send('gesturechange',1,20);await send('gesturechange',1,25);await send('gestureend',1,25);
  return samples;
 })()`);
 assert.ok(safari.filter((_,index)=>![13,18].includes(index)).every(sample=>sample.prevented));
 assert.equal(safari[1].lens,1);assert.equal(safari[2].lens,1,'Safari activation rebases the lens');
 assert.ok(safari[3].lens>1,'Safari pinch changes the lens after activation');
 assert.equal(safari[1].action,undefined);assert.equal(safari[2].action,undefined);
 assert.equal(safari[3].action,'lens-in');assert.equal(safari[3].cursor,'zoom-in');
 assert.equal(safari[4].action,'lens-out');assert.equal(safari[4].cursor,'zoom-out');
 assert.equal(safari[3].alt,safariStart.alt,'Safari plain pinch keeps altitude');
 assert.equal(safari[3].position,safariStart.position,'Safari plain pinch keeps position');
 assert.ok(safari[7].lens>safari[4].lens,'Safari Shift pinch zooms the lens');assert.equal(safari[7].position,safari[4].position);
 assert.equal(safari[7].action,'lens-in');assert.equal(safari[8].action,'lens-out');
 assert.ok(safari[11].lens>safari[8].lens,'Safari Option pinch zooms the lens');
 assert.equal(safari[11].position,safari[8].position);assert.equal(safari[11].roll,safari[8].roll);
 assert.equal(safari[11].action,'lens-in');assert.equal(safari[12].action,'lens-out');
 assert.equal(safari[13].action,undefined,'Safari gesture end clears action feedback');
 assert.equal(safari[15].roll,safari[14].roll,'small Safari twist stays below threshold');
 assert.equal(safari[16].roll,safari[15].roll,'Safari twist activation rebases');
 assert.notEqual(safari[17].roll,safari[16].roll,'ordinary Safari twist rolls after activation');
 // Mouse or trackpad: detected until chosen over Help, kept in a cookie
 // across reloads; the chosen button again, or Auto in Settings, forgets it.
 const device=()=>evaluate(`(()=>{const b=document.querySelector('.hud-corner [data-device=mouse]'),s=document.querySelector('#explorer-input-device');
  return {name:b.querySelector('.hud-name').textContent,mouse:b.getAttribute('aria-pressed'),select:s.value,cookie:document.cookie.includes('earthlight-input-device=mouse')};})()`);
 await evaluate("document.querySelector('.hud-corner [data-device=mouse]').click();true");
 assert.deepEqual(await device(),{name:'Mouse',mouse:'true',select:'mouse',cookie:true});
 await run('reload');await wait("document.querySelector('earthlight-explorer').dataset.focus==='sharp'");
 assert.deepEqual(await device(),{name:'Mouse',mouse:'true',select:'mouse',cookie:true},'the chosen device survives a reload');
 const forcedLens=await read();
 assert.equal(await gesture({deltaX:3,deltaY:-20}),true);await wait(`Number(document.querySelector('earthlight-explorer').dataset.lens)>${forcedLens.lens}`);
 assert.equal((await read()).position,forcedLens.position,'with the mouse chosen a trackpad-like scroll zooms the lens');
 await evaluate("(()=>{const s=document.querySelector('#explorer-input-device');s.value='auto';s.dispatchEvent(new Event('change'));return true;})()");
 const auto=await device();assert.equal(auto.select,'auto');assert.equal(auto.cookie,false);
 assert.equal(await evaluate("document.querySelectorAll('.hud-corner [data-device][aria-pressed=true]').length"),1,'the detected device keeps its key down too');
 assert.equal(await evaluate("[...document.querySelectorAll('.hud-corner [data-device] .hud-name')].filter(n=>n.textContent.endsWith('(auto)')).length"),1);
 await evaluate("document.querySelector('.hud-corner [data-device=mouse]').click();true");
 assert.deepEqual(await device(),{name:'Mouse',mouse:'true',select:'mouse',cookie:true});
 await evaluate("document.querySelector('.hud-corner [data-device=mouse]').click();true");
 const toggled=await device();assert.equal(toggled.select,'auto','a second click goes back to Auto');assert.equal(toggled.cookie,false);
 await run('open',`${base}/?t=1000&motion=0`);
 const outsideScene=await evaluate("(()=>{const e=new WheelEvent('wheel',{deltaY:120,bubbles:true,cancelable:true});document.body.dispatchEvent(e);return {hud:!!document.querySelector('.flight-hud'),prevented:e.defaultPrevented};})()");
 assert.deepEqual(outsideScene,{hud:true,prevented:false});
 return {detached:detached.alt,moved:moved.alt,restored:restored.alt,limits:[150,50000],orbits:['iss','polar','high']};
}
