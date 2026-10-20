// Native Android Chrome cadence comparison. Requires ADB reverse of base port
// and localhost:9223 forwarded to chrome_devtools_remote; leave phone unlocked.
import {sceneDevice} from './scene-device-driver.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const [base='http://127.0.0.1:4350',out='/tmp/earthlight-device-api']=process.argv.slice(2);
const adb=(...args)=>execFileSync('adb',[...args],{encoding:'utf8',timeout:15000}).trim();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const originalAwake=adb('shell','settings','get','global','stay_on_while_plugged_in');
const names=['compact-webgl','compact-webgl2','clouds-half-webgl2'];
const cases=[...names,...[...names].reverse()].map((name,i)=>({name:`fixed-${i+1}-${name}`,variant:name,quality:'fixed',aurora:0,seconds:30}));
cases.push(...names.map(name=>({name:`adaptive-${name}`,variant:name,quality:'adaptive',aurora:0,seconds:60})));
cases.push(...['compact-webgl2','clouds-half-webgl2'].map(name=>({name:`aurora-${name}`,variant:name,quality:'fixed',aurora:1,seconds:30})));
const duration=process.env.DEVICE_API_SECONDS?Number(process.env.DEVICE_API_SECONDS):null;
assert.ok(duration===null||(Number.isInteger(duration)&&duration>=15&&duration<=180&&duration%5===0),'DEVICE_API_SECONDS must be 15–180 in 5-second steps');
const selected=cases.filter(c=>!process.env.DEVICE_API_CASES||process.env.DEVICE_API_CASES.split(',').includes(c.name)).map(c=>duration===null?c:{...c,seconds:duration});
assert.ok(selected.length,'No matching cases');
const results={started:new Date().toISOString(),conditions:{base,scene:{t:3235.65,pitch:-25,epoch:'2026-10-06T01:32:27Z'},rate:'10x native playback',canvasCss:[412,832],metric:'Final canvas draw submission cadence, capped by renderer at 24 fps. No GPU timings, readback, finish, or query waits in timing loop.',order:'Fixed cases forward then reverse, adaptive once in listed order, aurora separately. Not thermally normalized.',steadySummary:'Exclude first 10 seconds of each run; keep all samples in evidence.'},capabilities:null,clientHashes:{},runs:[],batteryBefore:adb('shell','dumpsys','battery')};
await mkdir(out,{recursive:true});const save=()=>writeFile(out+'/results.json',JSON.stringify(results,null,2)+'\n');
let device;
try{
 adb('shell','settings','put','global','stay_on_while_plugged_in','3');adb('shell','input','keyevent','224');
 assert.match(adb('shell','dumpsys','window','policy'),/showing=false/,'Unlock phone first');
 adb('shell','am','start','-n','com.android.chrome/com.google.android.apps.chrome.Main');
 device=await sceneDevice('android',base);results.capabilities=device.capabilities;
 const {evaluate,navigate}=device;
 const settled=async()=>{const deadline=Date.now()+120000;while(Date.now()<deadline){if(await evaluate(`(()=>{const s=document.querySelector('earthlight-explorer');return s?.hasAttribute('data-ready')&&s.dataset.exposure==='settled'&&s.dataset.assetPhase==='settled'&&s.dataset.focus==='sharp'&&['dayTiles','nightTiles','cloudTiles','terrainTiles','galaxyTiles'].every(k=>!s.dataset[k]||JSON.parse(s.dataset[k]).pending===0)})()`))return;await sleep(500);}throw Error('Scene failed to settle');};
 for(const c of selected){
  console.log('START',c.name);
  const api=c.variant.endsWith('webgl2')?'webgl2':'webgl',profile=c.variant.startsWith('clouds-half')?'clouds-half':'compact';
  const url=new URL('/',base);for(const[k,v]of Object.entries({...results.conditions.scene,motion:0,render:profile,api,aurora:c.aurora,quality:c.quality,'look-grain':0,'exposure-mode':'manual','exposure-fixed':0}))url.searchParams.set(k,String(v));
  await navigate(url.href);await sleep(500);await settled();
  // Android's address bar changes lvh when navigating/restoring. Fix CSS size
  // identically for every case so a toolbar change cannot alter GPU workload.
  await evaluate(`(()=>{const c=document.querySelector('earthlight-explorer canvas'),v=document.querySelector('.explorer-viewport');c.style.width='412px';c.style.height='832px';if(v)v.style.height='832px';dispatchEvent(new Event('resize'));return true;})()`);await sleep(500);await settled();
  const before=await evaluate(`(()=>{const s=document.querySelector('earthlight-explorer'),c=s.querySelector('canvas'),g=c.getContext('webgl2')??c.getContext('webgl'),e=g.getExtension('WEBGL_debug_renderer_info');return {data:{...s.dataset},width:c.width,height:c.height,dpr:devicePixelRatio,renderer:e?g.getParameter(e.UNMASKED_RENDERER_WEBGL):g.getParameter(g.RENDERER),timer:!!g.getExtension('EXT_disjoint_timer_query_webgl2')||!!g.getExtension('EXT_disjoint_timer_query'),assets:performance.getEntriesByType('resource').filter(r=>r.name.includes('/_astro/')&&r.name.endsWith('.js')).map(r=>r.name)};})()`);
  assert.equal(before.data.renderApi,api);assert.equal(before.data.renderProfile,profile);assert.equal(before.data.aurora,c.aurora?'volume':'off');if(profile==='clouds-half')assert.equal(before.data.cloudPass,'half');
  for(const asset of before.assets)if(!results.clientHashes[asset]){const response=await fetch(asset);assert.ok(response.ok);results.clientHashes[asset]=createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex');}
  const measurement=await evaluate(`(async()=>{const s=document.querySelector('earthlight-explorer'),c=s.querySelector('canvas'),g=c.getContext('webgl2')??c.getContext('webgl'),draw=g.drawArrays,bind=g.bindFramebuffer,button=s.querySelector('.explorer-motion');let target=g.getParameter(g.FRAMEBUFFER_BINDING),count=0,intervals=[],last=null;const visibility=[];const visible=()=>visibility.push({time:performance.now(),state:document.visibilityState,focused:document.hasFocus()});visible();document.addEventListener('visibilitychange',visible);g.bindFramebuffer=function(k,v){if(k===g.FRAMEBUFFER||k===g.DRAW_FRAMEBUFFER)target=v;return bind.call(this,k,v);};g.drawArrays=function(...args){const r=draw.apply(this,args);if(target===null){const now=performance.now();count++;if(last!==null)intervals.push(now-last);last=now;}return r;};const samples=[];try{if(button.getAttribute('aria-label')==='Play')button.click();for(let i=0;i<${c.seconds/5};i++){count=0;intervals=[];const start=performance.now();await new Promise(r=>setTimeout(r,5000));const elapsed=performance.now()-start;samples.push({seconds:(i+1)*5,elapsed,fps:count*1000/elapsed,scale:Number(s.dataset.renderScale),width:c.width,height:c.height,visibility:document.visibilityState,intervals:[...intervals]});}return {samples,visibility,error:g.getError(),data:{...s.dataset}};}finally{if(button.getAttribute('aria-label')==='Pause')button.click();g.drawArrays=draw;g.bindFramebuffer=bind;document.removeEventListener('visibilitychange',visible);}})()`);
  const stable=measurement.samples.filter(s=>s.seconds>10),intervals=stable.flatMap(s=>s.intervals).sort((a,b)=>a-b);
  const run={...c,url:url.href,before,...measurement,summary:{fps:stable.reduce((n,s)=>n+s.fps*s.elapsed,0)/stable.reduce((n,s)=>n+s.elapsed,0),scaleMin:Math.min(...stable.map(s=>s.scale)),scaleMax:Math.max(...stable.map(s=>s.scale)),p95:intervals[Math.floor(intervals.length*.95)],p99:intervals[Math.floor(intervals.length*.99)],max:intervals.at(-1),over100:intervals.filter(x=>x>100).length},battery:adb('shell','dumpsys','battery'),thermal:adb('shell','dumpsys','thermalservice')};
  run.foreground=run.visibility.every(v=>v.state==='visible'&&v.focused)&&run.samples.every(s=>s.visibility==='visible');results.runs.push(run);await save();
  assert.ok(run.foreground,'Foreground interrupted; exclude and repeat');assert.equal(run.error,0);assert.equal(run.data.assetFailures,'0');if(c.quality==='fixed')assert.ok(run.samples.every(s=>s.scale===1&&s.width===before.width&&s.height===before.height),'Fixed buffer changed');console.log('RESULT',c.name,JSON.stringify(run.summary));
  await sleep(1000);
 }
}catch(error){results.error=String(error.stack??error);process.exitCode=1;console.error(error);}
finally{results.finished=new Date().toISOString();results.batteryAfter=adb('shell','dumpsys','battery');await save();try{if(device)await device.close();}finally{adb('shell','settings','put','global','stay_on_while_plugged_in',originalAwake);}}
