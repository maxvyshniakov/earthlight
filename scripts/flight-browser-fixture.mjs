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
 return {mouse:params=>send('Input.dispatchMouseEvent',params,sessionId),close:()=>socket.close()};
}

export async function verifyFlight({run,evaluate,wait,base}){
 await run('open',`${base}/?t=1000&motion=0`);
 await wait("document.querySelector('orbital-sky').dataset.focus==='sharp'");
 const read=()=>evaluate(`(()=>{const e=document.querySelector('orbital-sky');return {mode:e.dataset.flightMode,route:e.dataset.route,alt:Number(e.dataset.cameraAltitude),position:e.dataset.cameraPosition,basis:JSON.parse(e.dataset.cameraBasis),time:e.querySelector('.sky-time').textContent,url:location.search};})()`);
 const before=await read();
 await evaluate("document.querySelector('[data-flight-mode=free]').click();true");
 await run('wait','120');
 const detached=await read();assert.equal(detached.mode,'free');assert.equal(detached.position,before.position);
 for(let i=0;i<9;i++)assert.ok(Math.abs(detached.basis[i]-before.basis[i])<1e-7,'detaching preserves every camera ray');
 await evaluate("document.querySelector('.orbit-view').focus();document.querySelector('.orbit-view').dispatchEvent(new KeyboardEvent('keydown',{code:'KeyE',bubbles:true}));true");
 await run('wait','400');
 await evaluate("document.querySelector('.orbit-view').dispatchEvent(new KeyboardEvent('keyup',{code:'KeyE',bubbles:true}));true");
 await run('wait','1700');
 const moved=await read();assert.ok(moved.alt>detached.alt+20);assert.equal(moved.time,detached.time,'camera moves while replay is paused');
 assert.equal(new URLSearchParams(moved.url).get('flight'),'free');
 await run('reload');await wait("document.querySelector('orbital-sky').dataset.focus==='sharp'");
 const restored=await read();assert.ok(Math.abs(restored.alt-moved.alt)<.01);assert.equal(restored.mode,'free');
 for(let i=0;i<9;i++)assert.ok(Math.abs(restored.basis[i]-moved.basis[i])<1e-6);
 // Controls keep their own keys and scrolling. Blur cancels a held movement.
 await evaluate("document.querySelector('#sky-settings').showPopover();document.querySelector('#sky-time').focus();document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyE',bubbles:true}));true");
 await run('wait','200');assert.equal((await read()).position,restored.position);
 const panelWheel=await evaluate("(()=>{const e=new WheelEvent('wheel',{deltaY:120,bubbles:true,cancelable:true});document.querySelector('#sky-settings').dispatchEvent(e);return e.defaultPrevented;})()");assert.equal(panelWheel,false);
 await evaluate("document.querySelector('#sky-settings').hidePopover();document.querySelector('.orbit-view').focus();document.querySelector('.orbit-view').dispatchEvent(new KeyboardEvent('keydown',{code:'KeyW',bubbles:true}));window.dispatchEvent(new Event('blur'));true");
 const stopped=await read();await run('wait','200');assert.equal((await read()).position,stopped.position);
 const gesture=async(init,target='.orbit-view')=>evaluate(`(()=>{const e=new WheelEvent('wheel',{...${JSON.stringify(init)},bubbles:true,cancelable:true});document.querySelector('${target}').dispatchEvent(e);return e.defaultPrevented;})()`);
 const looking=await read();
 assert.equal(await gesture({deltaX:80,deltaY:-40}),true);await run('wait','300');
 const looked=await read();assert.equal(looked.position,looking.position);assert.notDeepEqual(looked.basis,looking.basis);
 assert.equal(looked.time,looking.time);
 // Modifier changes affect the gesture, not the browser viewport or scene clock.
 assert.equal(await gesture({deltaX:60,deltaY:30,shiftKey:true}),true);await run('wait','300');
 const panned=await read();assert.notEqual(panned.position,looked.position);
 for(let i=0;i<9;i++)assert.ok(Math.abs(panned.basis[i]-looked.basis[i])<1e-7,'Shift-scroll keeps image orientation');
 const viewport=await evaluate('visualViewport.scale'),pixelRatio=await evaluate('devicePixelRatio');
 assert.equal(await gesture({deltaY:120,ctrlKey:true}),true);await run('wait','300');
 const zoomed=await read();assert.notEqual(zoomed.position,panned.position);
 assert.equal(await evaluate('visualViewport.scale'),viewport);
 for(let i=0;i<9;i++)assert.ok(Math.abs(zoomed.basis[i]-panned.basis[i])<1e-7);
 assert.equal(await gesture({deltaY:-40,ctrlKey:true},'#sky-settings'),false);
 // A queued gesture must not outlive loss of focus.
 await evaluate("(()=>{document.querySelector('.orbit-view').dispatchEvent(new WheelEvent('wheel',{deltaY:200,shiftKey:true,bubbles:true,cancelable:true}));window.dispatchEvent(new Event('blur'));return true;})()");
 await run('wait','200');assert.equal((await read()).position,zoomed.position);
 await run('reload');await wait("document.querySelector('orbital-sky').dataset.focus==='sharp'");
 const gestureRestored=await read();
 for(let i=0;i<9;i++)assert.ok(Math.abs(gestureRestored.basis[i]-zoomed.basis[i])<1e-6);
 // Real mouse and modifier events, including switching modes mid-drag at nadir.
 await evaluate("(()=>{const e=document.querySelector('#sky-route');e.value='high';e.dispatchEvent(new Event('change'));return true;})()");
 await run('wait','1500');await evaluate("document.querySelector('[data-flight-mode=free]').click();document.querySelector('.orbit-view').focus();true");
 assert.equal(await evaluate("document.querySelector('[data-view=pitch]').closest('.setting').hidden"),true);
 await run('wait','200');const nadir=await read();
 const input=await mouseInput(run);
 try{
  await input.mouse({type:'mousePressed',x:300,y:300,button:'left',buttons:1,clickCount:1,modifiers:8});
  await input.mouse({type:'mouseMoved',x:380,y:340,button:'left',buttons:1,modifiers:8});await run('wait','150');
  const draggedPan=await read();assert.notEqual(draggedPan.position,nadir.position);
  for(let i=0;i<9;i++)assert.ok(Math.abs(draggedPan.basis[i]-nadir.basis[i])<1e-7,'Shift-drag at nadir cannot roll the camera');
  await input.mouse({type:'mouseMoved',x:381,y:341,button:'left',buttons:1,modifiers:0});await run('wait','100');
  const rebased=await read();
  for(let i=0;i<9;i++)assert.ok(Math.abs(rebased.basis[i]-draggedPan.basis[i])<1e-7,'switching modifiers rebases without a jump');
  await input.mouse({type:'mouseMoved',x:440,y:240,button:'left',buttons:1});
  await input.mouse({type:'mouseReleased',x:440,y:240,button:'left',buttons:0,clickCount:1});await run('wait','300');
  const draggedLook=await read();assert.equal(draggedLook.position,rebased.position);assert.notDeepEqual(draggedLook.basis,rebased.basis);
  await input.mouse({type:'mouseWheel',x:440,y:240,deltaY:-100,deltaX:0,modifiers:2});await run('wait','300');
  const pinched=await read();assert.notEqual(pinched.position,draggedLook.position);
 }finally{input.close();}
 assert.equal(await evaluate('visualViewport.scale'),viewport,'real Ctrl-wheel must not zoom the browser');
 assert.equal(await evaluate('devicePixelRatio'),pixelRatio,'browser page zoom stays unchanged');
 const fullTurn=await read();
 const height=await evaluate("document.querySelector('.orbit-view').clientHeight");
 await gesture({deltaY:height*120/55});await run('wait','300');
 const beyondPole=await read();assert.notDeepEqual(beyondPole.basis,fullTurn.basis);
 const cosine=beyondPole.basis.slice(6).reduce((sum,v,i)=>sum+v*fullTurn.basis[i+6],0);
 assert.ok(Math.abs(cosine-Math.cos(120*Math.PI/180))<1e-6,'free pitch crosses 90 degrees');
 await gesture({deltaY:-height*120/55});await run('wait','300');
 const back=await read();for(let i=0;i<9;i++)assert.ok(Math.abs(back.basis[i]-fullTurn.basis[i])<1e-7);
 for(const [position,expected] of [['0',150],['1',50000]]){
  await evaluate(`(()=>{const e=document.querySelector('#sky-altitude');e.value='${position}';e.dispatchEvent(new Event('input'));return true;})()`);
  await wait(`Math.abs(Number(document.querySelector('orbital-sky').dataset.cameraAltitude)-${expected})<.1`);
 }
 for(const [route,height] of [['polar',800],['high',20000],['iss',null]]){
  await evaluate(`(()=>{const e=document.querySelector('#sky-route');e.value='${route}';e.dispatchEvent(new Event('change'));return true;})()`);
  await run('wait','1500');const state=await read();assert.equal(state.mode,'follow');assert.equal(state.route,route);
  if(height)assert.ok(Math.abs(state.alt-height)<.01);
  assert.equal(new URLSearchParams(state.url).has('position'),false);
 }
 await evaluate("document.querySelector('[data-flight-mode=free]').click();document.querySelector('.reset-all').click();true");
 await run('wait','200');const reset=await read();assert.equal(reset.mode,'follow');assert.equal(reset.route,'iss');assert.equal(new URLSearchParams(reset.url).has('flight'),false);
 await run('open',`${base}/?t=1000&motion=0`);
 const outsideScene=await evaluate("(()=>{const e=new WheelEvent('wheel',{deltaY:120,bubbles:true,cancelable:true});document.body.dispatchEvent(e);return {route:!!document.querySelector('#sky-route'),prevented:e.defaultPrevented};})()");
 assert.deepEqual(outsideScene,{route:true,prevented:false});
 return {detached:detached.alt,moved:moved.alt,restored:restored.alt,limits:[150,50000],routes:['iss','polar','high']};
}
