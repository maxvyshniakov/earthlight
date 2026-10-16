// Foreground Android Chrome: native cadence, real API selection and recovery.
// Requires ADB reverse for base's port and Chrome CDP forwarded to localhost:9223.
// Unlock the phone and leave Chrome foregrounded; waking does not unlock it.
import {sceneDevice} from './scene-device-driver.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const [base='http://127.0.0.1:4350',out='/tmp/earthlight-device-quality']=process.argv.slice(2);
const adb=(...args)=>execFileSync('rtk',['proxy','adb',...args],{encoding:'utf8',timeout:15000}).trim();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
await mkdir(out,{recursive:true});
const originalAwake=adb('shell','settings','get','global','stay_on_while_plugged_in');
const results={started:new Date().toISOString(),batteryBefore:adb('shell','dumpsys','battery'),thermalBefore:adb('shell','dumpsys','thermalservice'),clientHashes:{},conditions:{base,epoch:'2026-10-06T01:32:27Z',metric:'Final canvas draw submission cadence; no readback or GPU waits while timing',rate:'10x native playback',grain:0},runs:[]};
const save=()=>writeFile(out+'/results.json',JSON.stringify(results,null,2)+'\n');
let device;
try{
 adb('shell','settings','put','global','stay_on_while_plugged_in','3');
 adb('shell','input','keyevent','224');
 device=await sceneDevice('android',base);
 const {navigate,evaluate}=device;
 const settled=async()=>{
  const end=Date.now()+120000;
  while(Date.now()<end){
   if(await evaluate(`(()=>{const s=document.querySelector('earthlight-explorer');return s?.hasAttribute('data-ready')&&s.dataset.exposure==='settled'&&s.dataset.assetPhase==='settled'&&s.dataset.focus==='sharp'&&['dayTiles','nightTiles','cloudTiles','terrainTiles','galaxyTiles'].every(k=>!s.dataset[k]||JSON.parse(s.dataset[k]).pending===0)})()`))return;
   await sleep(500);
  }
  throw Error('Scene did not settle');
 };
 const inspect=()=>evaluate(`(()=>{const s=document.querySelector('earthlight-explorer'),c=s.querySelector('canvas'),g=c.getContext('webgl2')??c.getContext('webgl');return {data:{...s.dataset},width:c.width,height:c.height,viewport:[innerWidth,innerHeight],dpr:devicePixelRatio,error:g.getError(),assets:performance.getEntriesByType('resource').filter(r=>r.name.includes('/_astro/')&&r.name.endsWith('.js')).map(r=>r.name)};})()`);
 const measure=seconds=>evaluate(`(async()=>{
  const s=document.querySelector('earthlight-explorer'),c=s.querySelector('canvas'),g=c.getContext('webgl2')??c.getContext('webgl'),draw=g.drawArrays,bind=g.bindFramebuffer,b=s.querySelector('.explorer-motion');
  let target=g.getParameter(g.FRAMEBUFFER_BINDING),times=[],intervals=[],lastFrame=null;
  const visibility=[];const visible=()=>visibility.push({time:performance.now(),state:document.visibilityState,focused:document.hasFocus()});visible();document.addEventListener('visibilitychange',visible);
  g.bindFramebuffer=function(k,v){if(k===g.FRAMEBUFFER||k===g.DRAW_FRAMEBUFFER)target=v;return bind.call(this,k,v);};
  g.drawArrays=function(...args){const v=draw.apply(this,args);if(target===null){const now=performance.now();times.push(now);if(lastFrame!==null)intervals.push(now-lastFrame);lastFrame=now;}return v;};
  const samples=[];try{
   if(b.getAttribute('aria-label')==='Play')b.click();
   for(let i=0;i<${seconds/5};i++){times=[];intervals=[];const start=performance.now();await new Promise(r=>setTimeout(r,5000));const elapsed=performance.now()-start;samples.push({seconds:(i+1)*5,elapsed,fps:times.length*1000/elapsed,scale:Number(s.dataset.renderScale),width:c.width,height:c.height,visibility:document.visibilityState,intervals:[...intervals]});}
   return {samples,visibility,error:g.getError(),data:{...s.dataset}};
  }finally{if(b.getAttribute('aria-label')==='Pause')b.click();g.drawArrays=draw;g.bindFramebuffer=bind;document.removeEventListener('visibilitychange',visible);}
 })()`);
 for(const c of [
  {name:'default-day',profile:null,t:3235.65,pitch:0,seconds:30},
  {name:'half-day',profile:'clouds-half',t:3235.65,pitch:0,seconds:30},
  {name:'half-night',profile:'clouds-half',t:610.87,pitch:0,seconds:30},
  {name:'half-clouds',profile:'clouds-half',t:3235.65,pitch:-25,seconds:90},
  {name:'default-clouds',profile:null,t:3235.65,pitch:-25,seconds:90},
 ].filter(c=>!process.env.DEVICE_QUALITY_CASES||process.env.DEVICE_QUALITY_CASES.split(',').includes(c.name))){
  console.log('START',c.name);
  const url=new URL('/',base);
  for(const[k,v]of Object.entries({motion:0,t:c.t,pitch:c.pitch,epoch:results.conditions.epoch,'look-grain':0,...(c.profile?{render:c.profile}:{})}))url.searchParams.set(k,String(v));
  await navigate(url.href);await sleep(500);await settled();
  const before=await inspect();
  for(const asset of before.assets)if(!results.clientHashes[asset]){const response=await fetch(asset);assert.ok(response.ok);results.clientHashes[asset]=createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex');}
  assert.equal(before.data.renderProfile,c.profile??'compact');assert.equal(before.data.renderApi,c.profile?'webgl2':'webgl');
  if(c.profile)assert.equal(before.data.cloudPass,'half','Reject a silent fallback');
  const run={...c,before,...await measure(c.seconds),battery:adb('shell','dumpsys','battery')};
  assert.equal(run.error,0);assert.equal(run.data.assetFailures,'0');
  run.foreground=run.visibility.every(v=>v.state==='visible')&&run.samples.every(v=>v.visibility==='visible');
  results.runs.push(run);await save();
  assert.ok(run.foreground,'Interrupted foreground run: repeat '+c.name);
  console.log('RESULT',c.name,JSON.stringify(run.samples.map(({intervals,...s})=>({...s,over100:intervals.filter(v=>v>100).length}))));
  if(c.name==='default-clouds'){
   await evaluate(`(()=>{const input=document.querySelector('[data-view="pitch"]');input.value='60';input.dispatchEvent(new Event('input'));return true;})()`);
   await settled();
   const recovery={name:'clouds-to-sky-recovery',before:await inspect(),...await measure(150)};
   assert.equal(recovery.error,0);results.runs.push(recovery);await save();
   assert.ok(recovery.visibility.every(v=>v.state==='visible'),'Interrupted recovery run');
   console.log('RECOVERY',JSON.stringify(recovery.samples.map(({intervals,...s})=>s)));
   assert.equal(recovery.samples.at(-1).scale,1,'Resolution must fully recover after the cloud load leaves view');
  }
 }
 // A restored WebGL2 context recreates the mixed RGBA16F/RG16F cloud target.
 await navigate(`${base}/?render=clouds-half&motion=0&t=3235.65&pitch=-25&epoch=${results.conditions.epoch}`);await sleep(500);await settled();
 await evaluate(`(async()=>{const c=document.querySelector('earthlight-explorer canvas'),g=c.getContext('webgl2'),e=g.getExtension('WEBGL_lose_context');const upload=g.texImage2D;window.__qualityAllocations=[];g.texImage2D=function(...a){if(a.length===9)window.__qualityAllocations.push({internal:a[2],width:a[3],height:a[4],format:a[6],type:a[7]});return upload.apply(this,a);};const lost=new Promise(r=>c.addEventListener('webglcontextlost',r,{once:true}));e.loseContext();await lost;g.getError();const restored=new Promise(r=>c.addEventListener('webglcontextrestored',r,{once:true}));setTimeout(()=>e.restoreContext(),300);await restored;return true;})()`);
 await settled();results.restored=await inspect();assert.equal(results.restored.data.cloudPass,'half');assert.equal(results.restored.error,0);
 results.allocations=await evaluate('window.__qualityAllocations');
 assert.ok(results.allocations.some(a=>a.internal===33327&&a.format===33319),'Restoration must allocate actual RG16F/RG metadata');
 results.idle=await evaluate(`(async()=>{const g=document.querySelector('earthlight-explorer canvas').getContext('webgl2'),draw=g.drawArrays;let frames=0;g.drawArrays=function(...a){frames++;return draw.apply(this,a);};try{await new Promise(r=>setTimeout(r,1200));return {frames,error:g.getError()};}finally{g.drawArrays=draw;}})()`);
 assert.equal(results.idle.frames,0,'Paused settled scene must remain idle');
 assert.equal(results.idle.error,0);
}catch(error){results.error=String(error.stack??error);process.exitCode=1;console.error(error);}
finally{
 results.finished=new Date().toISOString();results.batteryAfter=adb('shell','dumpsys','battery');results.thermalAfter=adb('shell','dumpsys','thermalservice');await save();
 try{if(device)await device.close();}finally{adb('shell','settings','put','global','stay_on_while_plugged_in',originalAwake);}
}
