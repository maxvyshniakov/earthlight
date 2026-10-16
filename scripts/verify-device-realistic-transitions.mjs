// Diagnostic trajectories through actual controls; one run per current policy.
// No seeks, forced quality, screenshots, readbacks or GPU waits during timing.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {sceneDevice} from './scene-device-driver.mjs';
import {deviceSceneTimeline} from './device-scene-timeline.mjs';
import {issFrame} from '../src/scripts/iss-orbit.ts';
import {calendarFrame} from '../src/scripts/scene-calendar.ts';
import {visibleSourceDisk} from '../src/scripts/lens-reflections.ts';
import {SOLAR_RADIUS} from '../src/scripts/solar-light.ts';

const [base='http://127.0.0.1:4356',out='/tmp/earthlight-realistic-transitions']=process.argv.slice(2);
const profiles=(process.env.REALISTIC_PROFILES??'compact,clouds-half').split(',');
assert.ok(profiles.length<=2&&profiles.every(v=>['compact','clouds-half'].includes(v)));
assert.ok(process.env.ANDROID_SERIAL,'Set ANDROID_SERIAL to the reserved Pixel');
const adb=(...args)=>execFileSync('rtk',['proxy','adb',...args],{encoding:'utf8',timeout:15000}).trim();
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const dawn={epoch:'2026-10-06T07:00:00Z',t:330,seconds:60,rate:10};
const orbit={epoch:'2026-10-06T01:32:27Z',t:3235.65,seconds:49.9,rate:10};
const results={started:new Date().toISOString(),conditions:{base,profiles,dawn,orbit,grain:1,aurora:0,
 purpose:'Single-run diagnostics per policy; not a repeated acceptance comparison or isolated half-cloud speedup.',
 viewport:'Native Pixel CSS viewport, no canvas/style overrides; scroll fixed at homepage top.',
 warmup:'Paused initial view until assets/focus/exposure/queues settle, then Play at the existing 10x speed. Startup is measured separately.',
 controls:'Synthetic DOM KeyboardEvents enter the real flight-controls handlers and RAF camera/lens integration. This is keyboard-path coverage, not a physical finger/touch test.',
 geometry:'Homepage keeps its actual scroll=0 composition. Orbit detaches through the Free HUD control before timing, then holds ArrowDown 0.9s, Z 2s, X 2s. Actual movement and focal length are recorded from submitted shader uniforms.',
 metric:'Final draw submission intervals, not compositor presentation or isolated GPU cost. Intervals belong to the phase containing their end; crossingBoundary marks gaps that began in the preceding phase. Uniform capture records the actual camera/sun/lens used for drawing; dataset labels can lag one frame.',
 transitions:'No timed seek, orbit, position, pitch-slider or quality assignments. Frame logs distinguish command boundaries, integrated movement and post-input settling.'},runs:[],clientHashes:{}};
const save=()=>writeFile(out+'/results.json',JSON.stringify(results,null,2)+'\n');

// Extend the existing final-draw/RAF/canvas logger without touching production.
function realisticTimeline(){
 const log=window.__sceneTimeline,get=HTMLCanvasElement.prototype.getContext,wrapped=new WeakSet();
 log.targetAllocations=[];
 HTMLCanvasElement.prototype.getContext=function(...args){
  const g=get.apply(this,args),scene=this.closest('earthlight-explorer');
  if(!g||!scene||!['webgl','webgl2','experimental-webgl'].includes(args[0])||wrapped.has(g))return g;
  wrapped.add(g);
  const names=new WeakMap(),uniforms={},location=g.getUniformLocation;
  g.getUniformLocation=function(program,name){const v=location.call(this,program,name);if(v)names.set(v,name);return v;};
  for(const name of ['uniform3fv','uniformMatrix3fv','uniform1f']){
   const original=g[name];
   g[name]=function(...a){
    const result=original.apply(this,a),key=a[0]&&names.get(a[0]);
    if(key==='cameraPosition'||key==='sunDirection')uniforms[key]=Array.from(a[1]);
    else if(key==='cameraBasis')uniforms[key]=Array.from(a[2]);
    else if(key==='zoomExcess'||key==='time')uniforms[key]=a[1];
    return result;
   };
  }
  for(const name of ['texImage2D','texStorage2D','renderbufferStorage']){
   if(!g[name])continue;
   const original=g[name];
   g[name]=function(...a){
    const time=performance.now(),result=original.apply(this,a);
    if(log.active){
     const size=name==='texImage2D'&&a.length===9&&a[8]===null?[a[3],a[4]]
      :name==='texStorage2D'?[a[3],a[4]]:name==='renderbufferStorage'?[a[2],a[3]]:null;
     if(size)log.targetAllocations.push({time,method:name,width:size[0],height:size[1]});
    }
    return result;
   };
  }
  const draw=g.drawArrays;
  g.drawArrays=function(...a){
   const count=log.frames.length,result=draw.apply(this,a);
   if(log.frames.length>count){
    const frame=log.frames.at(-1),d=scene.dataset;
    Object.assign(frame,{sceneTime:uniforms.time,position:uniforms.cameraPosition,basis:uniforms.cameraBasis,sun:uniforms.sunDirection,
     lens:1+(uniforms.zoomExcess??0),api:d.renderApi,profile:d.renderProfile,cloudPass:d.cloudPass,cloudBuffer:d.cloudBuffer??null,
     phase:d.phase,inspection:d.inspection??'false',flightMode:d.flightMode??d.flight,
     inputYaw:d.cameraYaw,inputPitch:d.cameraPitch,focus:d.focus,visibility:document.visibilityState,documentFocused:document.hasFocus()});
   }
   return result;
  };
  return g;
 };
}
const dot=(a,b)=>a.reduce((sum,x,i)=>sum+x*b[i],0);
const angle=(a,b)=>Math.acos(Math.max(-1,Math.min(1,dot(a,b)/Math.hypot(...a)/Math.hypot(...b))))*180/Math.PI;
function geometry(frame,aspect){
 if(!frame.position||!frame.basis||!frame.sun)return null;
 const camera=frame.position,sun=frame.sun,basis=frame.basis,focal=1.25*frame.lens,radius=Math.hypot(...camera),forward=dot(sun,basis.slice(6,9));
 let earthRays=0,litEarthRays=0;
 for(const x of [-.4,0,.4])for(const y of [-.4,0,.4]){
  let ray=[0,1,2].map(i=>basis[i]*x*aspect+basis[i+3]*y+basis[i+6]*focal);const length=Math.hypot(...ray);ray=ray.map(v=>v/length);
  const b=dot(camera,ray),h=b*b-radius*radius+1;
  if(b<0&&h>=0){earthRays++;const point=camera.map((v,i)=>v+ray[i]*(-b-Math.sqrt(h)));if(dot(point,sun)>0)litEarthRays++;}
 }
 const x=focal*dot(sun,basis.slice(0,3))/forward,y=focal*dot(sun,basis.slice(3,6))/forward;
 return {solar:dot(camera,sun)/radius,sunVisible:visibleSourceDisk(camera,sun,SOLAR_RADIUS),sunX:x,sunY:y,
  sunInFrame:forward>0&&Math.abs(x)<=aspect/2&&Math.abs(y)<=.5,earthRays,litEarthRays,
  note:'Nine geometric Earth-intersection rays; illumination is geometry, not a claim about texture cloud opacity.'};
}
function summarize(run){
 const l=run.timeline,aspect=run.before.css.width/run.before.css.height;
 for(const frame of l.frames)frame.geometry=geometry(frame,aspect);
 const intervals=l.frames.slice(1).map((f,i)=>({start:l.frames[i].time,end:f.time,ms:f.time-l.frames[i].time,width:f.width,height:f.height}));
 return {phases:l.phases.map((p,i)=>{
  const end=l.phases[i+1]?.time??l.ended,frames=l.frames.filter(f=>f.time>=p.time&&f.time<end),gaps=intervals.filter(f=>f.end>=p.time&&f.end<end).map(f=>({...f,crossingBoundary:f.start<p.time}));
  return {...p,end,elapsedMs:end-p.time,frames:frames.length,fps:frames.length*1000/(end-p.time),meanInterval:gaps.length?gaps.reduce((s,v)=>s+v.ms,0)/gaps.length:null,
   longIntervals:gaps.filter(v=>v.ms>100),first:frames[0],last:frames.at(-1),
   actualTurnDegrees:frames[0]?.basis&&frames.at(-1)?.basis?angle(frames[0].basis.slice(6,9),frames.at(-1).basis.slice(6,9)):null,
   resizes:l.sizes.filter(v=>v.time>=p.time&&v.time<end),targetAllocations:l.targetAllocations.filter(v=>v.time>=p.time&&v.time<end)};
 }),inputs:l.commands.filter(c=>c.type==='keydown').map(command=>{
  const up=l.commands.find(c=>c.type==='keyup'&&c.code===command.code&&c.time>=command.time);
  const before=l.frames.filter(f=>f.time<=command.time).at(-1),during=l.frames.filter(f=>f.time>=command.time&&f.time<=(up?.time??l.ended));
  const after=during.at(-1);
  return {code:command.code,source:command.source,down:command.time,up:up?.time,actualHoldMs:up?up.time-command.time:null,
   renderedSamples:during.length,before,after,actualTurnDegrees:before?.basis&&after?.basis?angle(before.basis.slice(6,9),after.basis.slice(6,9)):null,
   lensValues:[...new Set(during.map(f=>f.lens))]};
 }),changes:l.frames.filter((f,i,a)=>!i||f.width!==a[i-1].width||f.height!==a[i-1].height||f.cloudBuffer!==a[i-1].cloudBuffer),
 fiveSecondWindows:Array.from({length:Math.floor((l.ended-l.started)/5000)},(_,i)=>{const start=l.started+i*5000,frames=l.frames.filter(f=>f.time>=start&&f.time<start+5000);return {afterSeconds:i*5,fps:frames.length/5,last:frames.at(-1)};}),longIntervals:intervals.filter(v=>v.ms>100)};
}
await mkdir(out,{recursive:true});
let device,awake,stopRequested=false;
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{stopRequested=true;});
try{
 awake=adb('shell','settings','get','global','stay_on_while_plugged_in');
 results.batteryBefore=adb('shell','dumpsys','battery');
 assert.match(adb('shell','dumpsys','window','policy'),/showing=false/,'Unlock Pixel first');
 adb('shell','settings','put','global','stay_on_while_plugged_in','3');
 device=await sceneDevice('android',base);
 await device.installInitScript(`(${deviceSceneTimeline.toString()})();(${realisticTimeline.toString()})();`);
 const inspect=()=>device.evaluate(`(()=>{const s=document.querySelector('earthlight-explorer'),c=s.querySelector('canvas'),g=c.getContext('webgl2')??c.getContext('webgl'),r=c.getBoundingClientRect();return {data:{...s.dataset},width:c.width,height:c.height,css:{width:r.width,height:r.height},smallHeight:s.querySelector('.explorer-viewport')?.clientHeight??innerHeight,dpr:devicePixelRatio,viewport:[innerWidth,innerHeight],error:g.getError(),speed:s.querySelector('.explorer-speed input').getAttribute('aria-valuetext'),assets:performance.getEntriesByType('resource').filter(r=>r.name.includes('/_astro/')&&r.name.endsWith('.js')).map(r=>r.name)};})()`);
 const settled=async()=>{
  const deadline=Date.now()+120000;
  while(Date.now()<deadline){
   if(await device.evaluate(`(()=>{const s=document.querySelector('earthlight-explorer');if(s?.dataset.shaderStartup==='failed')throw Error('Shader startup failed');return s?.hasAttribute('data-ready')&&s.dataset.focus==='sharp'&&s.dataset.exposure==='settled'&&s.dataset.assetPhase==='settled'&&['dayTiles','nightTiles','cloudTiles','terrainTiles','galaxyTiles'].every(k=>!s.dataset[k]||JSON.parse(s.dataset[k]).pending===0);})()`))return;
   await sleep(250);
  }
  throw Error('Prewarm did not settle');
 };
 for(const profile of profiles){
  for(const kind of ['homepage-dawn','explorer-controls']){
   const config=kind==='homepage-dawn'?dawn:orbit,url=new URL(kind==='homepage-dawn'?'/':'/',base);
   for(const [k,v] of Object.entries({render:profile,quality:'adaptive',motion:0,t:config.t,epoch:config.epoch,aurora:0,'look-grain':1}))url.searchParams.set(k,String(v));
   console.log('PREWARM',profile,kind);
   await device.navigate(url.href);await sleep(400);await settled();
   await device.evaluate(`(()=>{scrollTo(0,0);if(${kind==='explorer-controls'}){const b=document.querySelector('[data-flight-mode="free"]');if(!b)throw Error('Free camera HUD missing');b.click();}return true;})()`);
   await settled();
   const before=await inspect();assert.match(before.speed,/^10 times/);assert.equal(before.data.renderProfile,profile);assert.equal(before.error,0);
   if(profile==='clouds-half')assert.equal(before.data.cloudPass,'half','Do not silently time a fallback as half clouds');
   for(const asset of before.assets)if(!results.clientHashes[asset]){const response=await fetch(asset);assert.ok(response.ok);results.clientHashes[asset]=createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex');if(asset.includes('EarthlightExplorer.'))assert.equal(results.clientHashes[asset],process.env.SCENE_EXPECTED_CLIENT_SHA256??'ab8961f8a4ad0d9818e209967e04803ad909d0da481cf0573a5c89c6063be679','Expected scene client SHA-256');}
   if(kind==='homepage-dawn'){
    const limb=1-.78*Math.min(1,before.smallHeight/before.css.height);
    results.homepagePredicted=Array.from({length:7},(_,i)=>{const t=dawn.t+i*100,p=calendarFrame(issFrame(t,limb),new Date(Date.parse(dawn.epoch)+t*1000));return {t,phase:p.phase,...geometry({position:p.camera,basis:p.cameraBasis,sun:p.sun,lens:1},before.css.width/before.css.height)};});
   }
   console.log('TIMING',profile,kind);
   const timeline=await device.evaluate(`(async()=>{
    const log=window.__sceneTimeline,s=document.querySelector('earthlight-explorer'),button=s.querySelector('.explorer-motion');
    const wait=ms=>new Promise(r=>setTimeout(r,ms));
    const phase=(name,type)=>log.phases.push({name,type,time:performance.now(),state:{...s.dataset}});
    const key=(type,code)=>{log.commands.push({time:performance.now(),type,code,source:'synthetic DOM KeyboardEvent'});window.dispatchEvent(new KeyboardEvent(type,{code,key:code.startsWith('Key')?code.slice(3).toLowerCase():code,bubbles:true,cancelable:true}));};
    const hold=async(code,ms)=>{key('keydown',code);try{await wait(ms);}finally{key('keyup',code);}};
    log.start();log.commands=[];log.targetAllocations=[];
    try{
     phase(${JSON.stringify(kind==='homepage-dawn'?'night-approach':'explorer-baseline')},'baseline');
     log.commands.push({time:performance.now(),type:'Play',source:'existing DOM button'});
     if(button.getAttribute('aria-label')==='Play')button.click();
     if(${kind==='homepage-dawn'}){
      await wait(10000);phase('sunrise-and-dawn','continuous playback');
      await wait(40000);phase('day-after-dawn','continuous playback');await wait(10000);
     }else{
      await wait(10000);phase('turn-input','integrated camera movement');await hold('ArrowDown',900);
      phase('turn-settling','post-input settling');await wait(1000);
      phase('turned-view','settled input');await wait(13000);
      phase('lens-in-input','integrated focal-length change');await hold('Equal',2000);
      phase('lens-in-settling','post-input settling');await wait(1000);
      phase('long-lens-view','settled input');await wait(9000);
      phase('lens-out-input','integrated focal-length change');await hold('Minus',2000);
      phase('lens-out-settling','post-input settling');await wait(1000);
      phase('wide-lens-view','settled input');await wait(10000);
     }
     log.stop();return JSON.parse(JSON.stringify(log));
    }finally{log.stop();for(const code of ['ArrowDown','Equal','Minus'])window.dispatchEvent(new KeyboardEvent('keyup',{code,bubbles:true}));if(button.getAttribute('aria-label')==='Pause')button.click();}
   })()`);
   const after=await inspect(),run={profile,kind,before,after,timeline};run.summary=summarize(run);results.runs.push(run);await save();
   assert.equal(after.error,0);assert.equal(after.data.assetFailures,'0');assert.ok(timeline.frames.length>100);assert.ok(timeline.frames.every(f=>f.visibility==='visible'&&f.documentFocused),'Hidden or unfocused submitted frame');assert.ok(timeline.visibility.filter(v=>v.time>=timeline.frames[0].time).every(v=>v.state==='visible'&&v.focused),'Hidden or unfocused event after first draw');
   assert.ok(timeline.frames.every(f=>f.position&&f.basis&&f.sun),'Actual shader pose telemetry missing');
   if(kind==='homepage-dawn'){
    const first=timeline.frames[0],last=timeline.frames.at(-1);
    assert.ok(first.geometry.solar<-.4&&last.geometry.solar>.15,'Continuous dawn trajectory did not reach the planned lighting change');
    assert.ok(timeline.frames.some(f=>f.geometry.sunInFrame&&f.geometry.sunVisible>.9),'Sun never entered the actual homepage frame');
    assert.ok(timeline.frames.slice(1).every((f,i)=>f.sceneTime>=timeline.frames[i].sceneTime),'Scene time jumped backward');
   }else{
    const turn=run.summary.phases.find(p=>p.name==='turn-input');
    assert.ok(turn.actualTurnDegrees>10,'Keyboard path did not turn the camera');
    const lens=timeline.frames.map(f=>f.lens);
    assert.ok(Math.max(...lens)>1.5&&lens.at(-1)<Math.max(...lens)*.8,'Keyboard lens path did not zoom in and back');
   }
   console.log('RESULT',profile,kind,JSON.stringify(run.summary.phases.map(p=>({name:p.name,fps:p.fps,ms:p.elapsedMs,mean:p.meanInterval,scale:p.last?.scale,size:p.last&&[p.last.width,p.last.height],lens:p.last?.lens,turn:p.actualTurnDegrees,long:p.longIntervals.length}))));
   if(stopRequested)break;
  }
  if(stopRequested)break;
 }
}catch(error){results.error=String(error.stack??error);process.exitCode=1;console.error(error);if(device)try{results.partialTimeline=await device.evaluate('window.__sceneTimeline');}catch{}}
finally{
 results.finished=new Date().toISOString();
 try{results.batteryAfter=adb('shell','dumpsys','battery');results.thermalAfter=adb('shell','dumpsys','thermalservice');}catch{}
 try{await save();}finally{try{if(device)await device.close();}finally{if(awake!==undefined)adb('shell','settings','put','global','stay_on_while_plugged_in',awake);}}
}
