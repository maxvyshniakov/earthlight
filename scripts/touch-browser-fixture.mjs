import assert from 'node:assert/strict';

// Real browser touch input exercises pointer capture and native gesture ownership.
export async function verifyTouch({run,evaluate,wait,base}){
 await run('open',`${base}/?t=1000&motion=0`);
 const socket=new WebSocket((await run('get','cdp-url')).trim());
 await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
 let id=0;const pending=new Map();
 socket.addEventListener('message',event=>{const message=JSON.parse(event.data),request=pending.get(message.id);if(request){pending.delete(message.id);message.error?request.reject(new Error(message.error.message)):request.resolve(message.result);}});
 const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});socket.send(JSON.stringify({id,method,params,sessionId}));});
 const sceneURL=(await run('get','url')).trim();
 const {targetInfos}=await send('Target.getTargets');
 const page=targetInfos.find(target=>target.type==='page'&&target.url===sceneURL);
 const {sessionId}=await send('Target.attachToTarget',{targetId:page.targetId,flatten:true});
 const cdp=(method,params)=>send(method,params,sessionId);
 const touch=(type,points)=>cdp('Input.dispatchTouchEvent',{type,touchPoints:points.map(([id,x,y])=>({id,x,y,radiusX:4,radiusY:4,force:1}))});
 const read=()=>evaluate(`(()=>{const e=document.querySelector('orbital-sky');return {mode:e.dataset.flightMode,position:e.dataset.cameraPosition,basis:e.dataset.cameraBasis,time:e.querySelector('.sky-time').textContent};})()`);
 try{
  await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true});
  await cdp('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
  await touch('touchCancel',[]).catch(()=>{});
  await wait("document.querySelector('orbital-sky').dataset.focus==='sharp'");
  const original=await read(),scale=await evaluate('visualViewport.scale');
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.orbit-gestures')).touchAction"),'none');
  await touch('touchStart',[[1,150,260]]);await touch('touchMove',[[1,210,310]]);await touch('touchEnd',[]);await run('wait','300');
  const looked=await read();assert.notEqual(looked.basis,original.basis);assert.equal(looked.position,original.position);assert.equal(looked.mode,'follow');
  await touch('touchStart',[[1,110,300],[2,250,300]]);
  await touch('touchMove',[[1,145,340],[2,285,340]]);await run('wait','300');
  const panned=await read();assert.notEqual(panned.position,looked.position);assert.equal(panned.basis,looked.basis);assert.equal(panned.mode,'free');
  await touch('touchMove',[[1,115,340],[2,315,340]]);await run('wait','300');
  const pinched=await read();assert.notEqual(pinched.position,panned.position);assert.equal(pinched.basis,panned.basis);
  // Lifting one finger rebases without rotating, then that remaining finger can look.
  await touch('touchEnd',[[2,315,340]]);await run('wait','150');assert.deepEqual(await read(),pinched);
  await touch('touchMove',[[1,155,365]]);await run('wait','200');
  const single=await read();assert.notEqual(single.basis,pinched.basis);assert.equal(single.position,pinched.position);
  await touch('touchCancel',[]);await run('wait','150');assert.deepEqual(await read(),single);
  assert.equal(single.time,original.time,'touch navigation leaves paused replay time unchanged');
  assert.equal(await evaluate('visualViewport.scale'),scale,'pinch moves the scene, not the browser viewport');
  // Native controls remain above the gesture layer and settings can still scroll.
  await evaluate("document.querySelector('#sky-settings').showPopover();true");
  const panel=await evaluate("(()=>{const e=document.querySelector('#sky-settings');e.style.maxHeight='300px';const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y};})()");
  const beforePanel=await read();
  await touch('touchStart',[[1,panel.x,panel.y+265]]);
  for(let i=1;i<=6;i++){await touch('touchMove',[[1,panel.x,panel.y+265-i*28]]);await run('wait','30');}
  await touch('touchEnd',[]);await run('wait','200');
  assert.deepEqual(await read(),beforePanel,'settings gestures cannot move the camera');
  assert.ok(await evaluate("document.querySelector('#sky-settings').scrollTop>0"),'settings retain native touch scrolling');
  await evaluate("document.querySelector('#sky-settings').hidePopover();true");
  await run('reload');await wait("document.querySelector('orbital-sky').dataset.focus==='sharp'");
  const restored=await read();assert.equal(restored.position,single.position);assert.equal(restored.mode,'free');
  assert.equal(await evaluate('visualViewport.scale'),scale);
  return {look:true,pan:true,pinch:true,rebase:true,cancel:true,panelScroll:true,urlRestored:true};
 }finally{
  await touch('touchCancel',[]).catch(()=>{});
  await cdp('Emulation.clearDeviceMetricsOverride',{});
  await cdp('Emulation.setTouchEmulationEnabled',{enabled:false});socket.close();
 }
}
