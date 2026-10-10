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
 const glide=async(from,to,steps=8)=>{for(let i=1;i<=steps;i++){await touch('touchMove',from.map(([id,x,y],j)=>[id,x+(to[j][1]-x)*i/steps,y+(to[j][2]-y)*i/steps]));await run('wait','16');}};
 const read=()=>evaluate(`(()=>{const e=document.querySelector('orbital-sky');return {mode:e.dataset.flightMode,position:e.dataset.cameraPosition,basis:e.dataset.cameraBasis,alt:Number(e.dataset.cameraAltitude),roll:document.querySelector('[data-attitude=roll]').textContent,time:e.querySelector('.sky-time').textContent};})()`);
 try{
  await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true});
  await cdp('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
  await touch('touchCancel',[]).catch(()=>{});
  await wait("document.querySelector('orbital-sky').dataset.focus==='sharp'");
  const original=await read(),scale=await evaluate('visualViewport.scale');
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.orbit-gestures')).touchAction"),'none');
  // One finger on the sky looks around while the orbit keeps following.
  await touch('touchStart',[[1,150,300]]);await glide([[1,150,300]],[[1,210,350]]);await touch('touchEnd',[]);await run('wait','300');
  const looked=await read();assert.notEqual(looked.basis,original.basis);assert.equal(looked.position,original.position);assert.equal(looked.mode,'follow');
  assert.equal(await evaluate("document.querySelector('.orbit-hud').dataset.modality"),'touch','the tutorial switches to touch gestures');
  // Two fingers moving together also look; they never move the camera.
  await touch('touchStart',[[1,110,300],[2,250,300]]);await glide([[1,110,300],[2,250,300]],[[1,145,340],[2,285,340]]);await run('wait','200');
  const turned=await read();assert.notEqual(turned.basis,looked.basis);assert.equal(turned.position,looked.position);assert.equal(turned.mode,'follow');
  // Spreading them zooms in toward their centre, which starts free flight.
  await glide([[1,145,340],[2,285,340]],[[1,115,340],[2,315,340]]);await run('wait','300');
  const pinched=await read();assert.notEqual(pinched.position,turned.position);assert.equal(pinched.mode,'free');
  // Lifting one finger rebases without a jump, and that finger carries on alone.
  await touch('touchEnd',[[2,315,340]]);await run('wait','150');assert.deepEqual(await read(),pinched);
  await glide([[1,115,340]],[[1,155,380]]);await run('wait','200');
  const single=await read();assert.notEqual(single.basis,pinched.basis);assert.equal(single.position,pinched.position);
  await touch('touchCancel',[]);await run('wait','150');assert.deepEqual(await read(),single);
  // Twisting two fingers rolls the horizon in place.
  await touch('touchStart',[[1,140,400],[2,250,400]]);
  for(let i=1;i<=10;i++){const a=i*.06;await touch('touchMove',[[1,195-55*Math.cos(a),400-55*Math.sin(a)],[2,195+55*Math.cos(a),400+55*Math.sin(a)]]);await run('wait','16');}
  await touch('touchEnd',[]);await run('wait','300');
  const twisted=await read();assert.equal(twisted.position,single.position);assert.notEqual(twisted.roll,single.roll);
  // Look down first, here with a hardware keyboard as on an iPad.
  await evaluate("document.querySelector('.orbit-view').dispatchEvent(new KeyboardEvent('keydown',{code:'ArrowDown',bubbles:true}));true");await run('wait','600');
  await evaluate("document.querySelector('.orbit-view').dispatchEvent(new KeyboardEvent('keyup',{code:'ArrowDown',bubbles:true}));true");await run('wait','300');
  // One finger on Earth flies over it. Find the lowest screen row above the
  // telemetry whose camera ray meets the planet, through the shaders' pinhole.
  const ground=await evaluate(`(()=>{const e=document.querySelector('orbital-sky'),p=e.dataset.cameraPosition.split(',').map(Number),b=JSON.parse(e.dataset.cameraBasis),h=innerHeight;
   for(let y=h-140;y>0;y-=4){const v=(h/2-y)/h,r=[0,1,2].map(i=>b[3+i]*v+b[6+i]*1.25),n=Math.hypot(...r),d=r.map(x=>x/n),q=p[0]*d[0]+p[1]*d[1]+p[2]*d[2];if(q<0&&q*q-(p[0]**2+p[1]**2+p[2]**2)+1>0)return y;}return null;})()`);
  assert.ok(ground>200,'Earth is in view');
  await touch('touchStart',[[1,195,ground]]);await glide([[1,195,ground]],[[1,195,ground-60]]);await touch('touchEnd',[]);await run('wait','600');
  const flown=await read();assert.notEqual(flown.position,twisted.position);assert.equal(flown.roll,(await read()).roll);
  assert.equal(flown.time,original.time,'touch navigation leaves paused replay time unchanged');
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
  await run('wait','400');const settled=await read();
  await run('reload');await wait("document.querySelector('orbital-sky').dataset.focus==='sharp'");
  const restored=await read();assert.equal(restored.position,settled.position);assert.equal(restored.mode,'free');
  // A double-tap flies toward the tapped point: climb away, then tap Earth's centre.
  await evaluate("(()=>{const e=document.querySelector('#sky-altitude');e.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true,cancelable:true}));return true;})()");
  await wait("Number(document.querySelector('orbital-sky').dataset.cameraAltitude)>49999");
  const higher=(await read()).alt;
  const [x,y]=await evaluate(`(()=>{const e=document.querySelector('orbital-sky'),p=e.dataset.cameraPosition.split(',').map(Number),b=JSON.parse(e.dataset.cameraBasis),d=p.map(v=>-v),dot=(a,i)=>a[0]*b[i]+a[1]*b[i+1]+a[2]*b[i+2],z=dot(d,6),h=innerHeight;return [innerWidth/2+1.25*dot(d,0)/z*h,h/2-1.25*dot(d,3)/z*h];})()`);
  for(let i=0;i<2;i++){await touch('touchStart',[[1,x,y]]);await run('wait','40');await touch('touchEnd',[]);await run('wait','90');}
  await run('wait','1400');assert.ok((await read()).alt<higher,'double-tap descends toward the ground');
  assert.equal(await evaluate('visualViewport.scale'),scale);
  return {look:true,twoFingerLook:true,pinch:true,rebase:true,cancel:true,roll:true,fly:true,doubleTap:true,panelScroll:true,urlRestored:true};
 }finally{
  await touch('touchCancel',[]).catch(()=>{});
  await cdp('Emulation.clearDeviceMetricsOverride',{});
  await cdp('Emulation.setTouchEmulationEnabled',{enabled:false});socket.close();
 }
}
