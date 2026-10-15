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
 const buttons={left:1,right:2};
 return {mouse,close:()=>socket.close(),
  async drag([x0,y0],[x1,y1],button='left',modifiers=0){
   await mouse({type:'mouseMoved',x:x0,y:y0,modifiers});
   await mouse({type:'mousePressed',x:x0,y:y0,button,buttons:buttons[button],clickCount:1,modifiers});
   for(let i=1;i<=10;i++){await mouse({type:'mouseMoved',x:x0+(x1-x0)*i/10,y:y0+(y1-y0)*i/10,button,buttons:buttons[button],modifiers});await new Promise(r=>setTimeout(r,16));}
   await mouse({type:'mouseReleased',x:x1,y:y1,button,buttons:0,clickCount:1,modifiers});
  }};
}

export async function verifyFlight({run,evaluate,wait,base}){
 await run('open',`${base}/?t=1000&motion=0`);
 await wait("document.querySelector('orbital-sky').dataset.focus==='sharp'");
 const read=()=>evaluate(`(()=>{const e=document.querySelector('orbital-sky');return {mode:e.dataset.flightMode,route:e.dataset.route,alt:Number(e.dataset.cameraAltitude),lens:Number(e.dataset.lens),position:e.dataset.cameraPosition,basis:JSON.parse(e.dataset.cameraBasis),roll:document.querySelector('[data-attitude=roll]').textContent,time:e.querySelector('.sky-time').textContent,url:location.search};})()`);
 const same=(a,b,tolerance=1e-7)=>a.basis.every((v,i)=>Math.abs(v-b.basis[i])<tolerance);
 const key=(type,code)=>evaluate(`document.querySelector('.orbit-view').dispatchEvent(new KeyboardEvent('${type}',{code:'${code}',bubbles:true}));true`);
 const before=await read();
 await evaluate("document.querySelector('[data-flight-mode=free]').click();true");
 await run('wait','120');
 const detached=await read();assert.equal(detached.mode,'free');assert.equal(detached.position,before.position);
 assert.ok(same(detached,before),'detaching preserves every camera ray');
 await evaluate("document.querySelector('.orbit-view').focus();true");
 await key('keydown','KeyR');await run('wait','400');await key('keyup','KeyR');
 await run('wait','1700');
 const moved=await read();assert.ok(moved.alt>detached.alt+20);assert.equal(moved.time,detached.time,'camera moves while replay is paused');
 assert.equal(new URLSearchParams(moved.url).get('flight'),'free');
 await run('reload');await wait("document.querySelector('orbital-sky').dataset.focus==='sharp'");
 const restored=await read();assert.ok(Math.abs(restored.alt-moved.alt)<.01);assert.equal(restored.mode,'free');
 assert.ok(same(restored,moved,1e-6));
 // Controls keep their own keys and scrolling. Blur cancels a held movement.
 await evaluate("document.querySelector('#sky-settings').showPopover();document.querySelector('#sky-time').focus();document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyE',bubbles:true}));true");
 await run('wait','200');const typed=await read();assert.equal(typed.position,restored.position);assert.ok(same(typed,restored));
 const panelWheel=await evaluate("(()=>{const e=new WheelEvent('wheel',{deltaY:120,bubbles:true,cancelable:true});document.querySelector('#sky-settings').dispatchEvent(e);return e.defaultPrevented;})()");assert.equal(panelWheel,false);
 await evaluate("document.querySelector('#sky-settings').hidePopover();document.querySelector('.orbit-view').focus();document.querySelector('.orbit-view').dispatchEvent(new KeyboardEvent('keydown',{code:'KeyW',bubbles:true}));window.dispatchEvent(new Event('blur'));true");
 await run('wait','300');const stopped=await read();await run('wait','300');assert.equal((await read()).position,stopped.position);
 const gesture=async(init,target='.orbit-view',x=720,y=180)=>evaluate(`(()=>{const e=new WheelEvent('wheel',{clientX:${x},clientY:${y},...${JSON.stringify(init)},bubbles:true,cancelable:true});document.querySelector('${target}').dispatchEvent(e);return e.defaultPrevented;})()`);
 // A trackpad scroll over the sky turns the camera and keeps the replay clock.
 const looking=await read();
 for(let i=0;i<6;i++)assert.equal(await gesture({deltaX:7,deltaY:-3}),true);
 await run('wait','400');
 const looked=await read();assert.equal(looked.position,looking.position);assert.ok(!same(looked,looking));assert.equal(looked.time,looking.time);
 // Over Earth a trackpad scroll spins the globe and never runs out of travel;
 // with Shift the same scroll only looks.
 const spinFrom=await read(),{width:w}=await evaluate('({width:innerWidth,height:innerHeight})');
 const ground=await evaluate(`(()=>{const e=document.querySelector('orbital-sky'),p=e.dataset.cameraPosition.split(',').map(Number),b=JSON.parse(e.dataset.cameraBasis),h=innerHeight;
  for(let y=h-30;y>0;y-=4){const v=(h/2-y)/h,r=[0,1,2].map(i=>b[3+i]*v+b[6+i]*1.25),n=Math.hypot(...r),d=r.map(x=>x/n),q=p[0]*d[0]+p[1]*d[1]+p[2]*d[2];if(q<0&&q*q-(p[0]**2+p[1]**2+p[2]**2)+1>0)return y;}return null;})()`);
 assert.ok(ground,'Earth is in view');
 for(let i=0;i<4;i++)assert.equal(await gesture({deltaX:0,deltaY:8,shiftKey:true},'.orbit-view',w/2,ground),true);
 await run('wait','400');const shiftLooked=await read();
 assert.equal(shiftLooked.position,spinFrom.position,'Shift-scroll over Earth only looks');assert.ok(!same(shiftLooked,spinFrom));
 assert.equal(shiftLooked.lens,1,'a Shift trackpad scroll never zooms the lens');
 for(let i=0;i<40;i++)await gesture({deltaX:0,deltaY:-12},'.orbit-view',w/2,ground);
 await run('wait','400');const spun=await read();assert.notEqual(spun.position,shiftLooked.position);
 // A swipe keeps its modifiers while its events, momentum included, keep
 // arriving: Shift or Control pressed as the globe coasts neither looks nor
 // zooms. macOS delivers the vertical momentum sideways while Shift is held.
 const coast=await evaluate(`(async()=>{
  const e=document.querySelector('orbital-sky'),view=document.querySelector('.orbit-view'),angle=()=>{const p=e.dataset.cameraPosition.split(',').map(Number),n=Math.hypot(...p);return p.map(v=>v/n);};
  const send=init=>view.dispatchEvent(new WheelEvent('wheel',{clientX:${w/2},clientY:${ground},bubbles:true,cancelable:true,...init}));
  const phase=async(count,init)=>{const from=angle();for(let i=0;i<count;i++){send(init);await new Promise(r=>setTimeout(r,16));}return Math.acos(Math.min(1,from.reduce((s,v,i)=>s+v*angle()[i],0)));};
  const start={alt:Number(e.dataset.cameraAltitude),lens:Number(e.dataset.lens)};
  const plain=await phase(30,{deltaX:0,deltaY:-12});
  const shifted=await phase(30,{deltaX:-12,deltaY:0,shiftKey:true});
  window.dispatchEvent(new KeyboardEvent('keydown',{key:'Control',code:'ControlLeft',ctrlKey:true}));
  const controlled=await phase(30,{deltaX:0,deltaY:-12,ctrlKey:true});
  window.dispatchEvent(new KeyboardEvent('keyup',{key:'Control',code:'ControlLeft'}));
  await new Promise(r=>setTimeout(r,400));
  return {plain,shifted,controlled,alt:Number(e.dataset.cameraAltitude)/start.alt,lens:Number(e.dataset.lens)/start.lens};
 })()`);
 assert.ok(coast.shifted>coast.plain*.6&&coast.controlled>coast.plain*.6,`the globe keeps turning: ${JSON.stringify(coast)}`);
 assert.ok(Math.abs(coast.alt-1)<.01&&coast.lens===1,`no zoom: ${JSON.stringify(coast)}`);
 // A clicky mouse wheel zooms toward the pointer; so does a trackpad pinch,
 // which Chromium reports as Ctrl-wheel. Neither zooms the browser.
 const viewport=await evaluate('visualViewport.scale'),pixelRatio=await evaluate('devicePixelRatio');
 const altitude="Number(document.querySelector('orbital-sky').dataset.cameraAltitude)";
 assert.equal(await gesture({deltaY:3,deltaMode:1}),true);await wait(`${altitude}>${spun.alt}+1`);await run('wait','500');
 const wheeled=await read();
 assert.equal(await gesture({deltaY:-60,ctrlKey:true}),true);await wait(`${altitude}<${wheeled.alt}-1`);await run('wait','300');
 assert.equal(await evaluate('visualViewport.scale'),viewport);
 assert.equal(await gesture({deltaY:-40,ctrlKey:true},'#sky-settings'),false);
 // A scroll still in flight ends with focus loss and moves nothing afterwards.
 await evaluate("(()=>{document.querySelector('.orbit-view').dispatchEvent(new WheelEvent('wheel',{clientX:720,clientY:180,deltaX:30,deltaY:12,bubbles:true,cancelable:true}));window.dispatchEvent(new Event('blur'));return true;})()");
 await run('wait','200');const blurred=await read();await run('wait','200');assert.equal((await read()).position,blurred.position);
 await run('reload');await wait("document.querySelector('orbital-sky').dataset.focus==='sharp'");
 const gestureRestored=await read();assert.ok(same(gestureRestored,blurred,1e-6));
 // Real mouse input: Earth follows the pointer, the sky turns the camera,
 // Option twists the image, and a double-click flies toward a point.
 await evaluate("document.querySelector('[data-route=high]').click();true");
 await run('wait','1500');
 const globe=await read();assert.equal(globe.mode,'follow');assert.equal(globe.route,'high');
 const {width,height}=await evaluate('({width:innerWidth,height:innerHeight})'),centre=[width/2,height/2];
 const input=await mouseInput(run);
 try{
  await input.drag([centre[0]+40,centre[1]+30],[centre[0]+120,centre[1]-10]);await run('wait','300');
  const flung=await read();assert.equal(flung.mode,'free','grabbing Earth starts free flight');assert.notEqual(flung.position,globe.position);
  // A quick release may keep the planet turning for a moment; wait until it settles.
  let flown=flung;
  for(let i=0;i<40;i++){await run('wait','300');const next=await read();if(next.position===flown.position)break;flown=next;}
  await run('wait','300');assert.equal((await read()).position,flown.position);
  // Sky near the top left, clear of the lens tape at the middle of that edge.
  await input.drag([width*.25,90],[width*.25+50,40]);await run('wait','300');
  const turned=await read();assert.equal(turned.position,flown.position);assert.ok(!same(turned,flown));
  await input.drag([centre[0]+50,centre[1]],[centre[0]+60,centre[1]+50],'right');await run('wait','300');
  const rightLook=await read();assert.equal(rightLook.position,turned.position,'right-drag only looks, even over Earth');
  await input.drag([centre[0]+200,centre[1]],[centre[0],centre[1]+200],'left',1);await run('wait','300');
  const rolled=await read();assert.equal(rolled.position,rightLook.position);assert.notEqual(rolled.roll,rightLook.roll);
  await evaluate("document.querySelector('.orbit-view').focus();document.querySelector('.orbit-view').dispatchEvent(new KeyboardEvent('keydown',{code:'KeyH',bubbles:true}));document.querySelector('.orbit-view').dispatchEvent(new KeyboardEvent('keyup',{code:'KeyH',bubbles:true}));true");
  await run('wait','900');assert.match((await read()).roll,/^[+−]00°$/,'H levels the horizon');
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
 await evaluate("document.querySelector('[data-route=iss]').click();true");await run('wait','1500');
 await evaluate("document.querySelector('[data-flight-mode=free]').click();document.querySelector('.orbit-view').focus();true");
 await key('keydown','ArrowUp');await run('wait','2400');await key('keyup','ArrowUp');await run('wait','300');
 assert.match((await read()).roll,/^[+−]1[78]\d°$/,'a loop over the top leaves the camera inverted');
 // The altitude tape is a slider.
 for(const [code,expected] of [['Home',150],['End',50000]]){
  await evaluate(`(()=>{const e=document.querySelector('#sky-altitude');e.focus();e.dispatchEvent(new KeyboardEvent('keydown',{key:'${code}',bubbles:true,cancelable:true}));return true;})()`);
  await wait(`Math.abs(Number(document.querySelector('orbital-sky').dataset.cameraAltitude)-${expected})<.1`);
 }
 for(const [route,altitude] of [['polar',800],['high',20000],['iss',null]]){
  await evaluate(`document.querySelector('[data-route=${route}]').click();true`);
  await run('wait','1500');const state=await read();assert.equal(state.mode,'follow');assert.equal(state.route,route);
  if(altitude)assert.ok(Math.abs(state.alt-altitude)<.01);
  assert.equal(new URLSearchParams(state.url).has('position'),false);
 }
 // With Shift the camera stays put and the lens zooms about the pointer: a
 // pinch (Ctrl-wheel), or a clicky wheel that macOS turned sideways. + and −
 // zoom about the centre, the lens tape jumps, and a followed orbit stays followed.
 const lens="Number(document.querySelector('orbital-sky').dataset.lens)";
 const following=await read();assert.equal(following.mode,'follow');assert.equal(following.lens,1);
 assert.equal(await gesture({deltaY:-60,ctrlKey:true,shiftKey:true}),true);await wait(`${lens}>1.5`);
 const pinched=await read();assert.equal(pinched.mode,'follow','the lens never detaches');assert.equal(pinched.position,following.position);assert.equal(pinched.alt,following.alt);
 await run('wait','300');assert.ok(Math.abs(Number(new URLSearchParams((await read()).url).get('lens'))-pinched.lens)<.01,'the lens is in the link');
 assert.equal(await gesture({deltaX:-4.000244140625*3,deltaY:0,shiftKey:true}),true);await wait(`${lens}>${pinched.lens}*1.6`);
 const stepped=await read();assert.equal(stepped.position,following.position);
 await key('keydown','Minus');await run('wait','600');await key('keyup','Minus');await run('wait','100');
 const widened=await read();assert.ok(widened.lens<stepped.lens/1.3,`− widens: ${widened.lens}`);assert.equal(widened.mode,'follow');
 // A press near a labelled mark on the lens tape takes that mark exactly.
 {const at=await evaluate("(()=>{const r=document.querySelector('#sky-lens [data-mark=\"10\"]').getBoundingClientRect();return [r.left+r.width/2,r.top+2]})()");
  const tap=await mouseInput(run);
  try{await tap.mouse({type:'mouseMoved',x:at[0],y:at[1]});await tap.mouse({type:'mousePressed',x:at[0],y:at[1],button:'left',buttons:1,clickCount:1});await tap.mouse({type:'mouseReleased',x:at[0],y:at[1],button:'left',buttons:0,clickCount:1});}finally{tap.close();}}
 await wait(`Math.abs(${lens}-10)<.01`);
 assert.equal(await evaluate("document.querySelector('#sky-lens').getAttribute('aria-valuenow')"),'10');
 await run('wait','300');await run('reload');await wait("document.querySelector('orbital-sky').dataset.focus==='sharp'");
 const relens=await read();assert.ok(Math.abs(relens.lens-10)<.01,'the lens survives a reload');assert.equal(relens.mode,'follow');
 await evaluate("document.querySelector('[data-flight-mode=free]').click();true");await run('wait','200');
 const freeLens=await read();assert.equal(await gesture({deltaY:40,ctrlKey:true,shiftKey:true}),true);await wait(`${lens}<9`);
 const unpinched=await read();assert.equal(unpinched.position,freeLens.position,'free flight keeps its place too');assert.equal(unpinched.mode,'free');
 await evaluate("document.querySelector('.reset-all').click();true");
 await run('wait','200');const reset=await read();assert.equal(reset.mode,'follow');assert.equal(reset.route,'iss');assert.equal(new URLSearchParams(reset.url).has('flight'),false);
 assert.equal(reset.lens,1);assert.equal(new URLSearchParams(reset.url).has('lens'),false,'Reset all restores the wide lens');
 await run('open',`${base}/?t=1000&motion=0`);
 const outsideScene=await evaluate("(()=>{const e=new WheelEvent('wheel',{deltaY:120,bubbles:true,cancelable:true});document.body.dispatchEvent(e);return {hud:!!document.querySelector('.orbit-hud'),prevented:e.defaultPrevented};})()");
 assert.deepEqual(outsideScene,{hud:true,prevented:false});
 return {detached:detached.alt,moved:moved.alt,restored:restored.alt,limits:[150,50000],routes:['iss','polar','high']};
}
