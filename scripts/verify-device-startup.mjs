// Ordinary autoplay navigation, instrumented before page scripts run. This is
// draw submission and focus readiness, not compositor presentation or cold 4G.
import {sceneDevice} from './scene-device-driver.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const [base='http://127.0.0.1:4356',out='/tmp/earthlight-device-startup']=process.argv.slice(2);
assert.ok(process.env.ANDROID_SERIAL,'Set ANDROID_SERIAL to scope ADB');
const adb=(...args)=>execFileSync('adb',[...args],{encoding:'utf8',timeout:15000}).trim();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const startupProfile=process.env.STARTUP_PROFILE??'compact';assert.ok(['compact','clouds-half'].includes(startupProfile));
const originalAwake=adb('shell','settings','get','global','stay_on_while_plugged_in');
const results={started:new Date().toISOString(),conditions:{base,startupProfile,metric:'Default framebuffer draw submission timestamps; not compositor paint. Normal autoplay, native CSS viewport, existing browser cache, no prewarm, no network throttling; actual homepage. Two repetitions may have different warm-cache state.'},runs:[],clientHashes:{}};
await mkdir(out,{recursive:true});let device;
try{
 adb('shell','settings','put','global','stay_on_while_plugged_in','3');adb('shell','input','keyevent','224');assert.match(adb('shell','dumpsys','window','policy'),/showing=false/,'Unlock phone first');adb('shell','am','start','-n','com.android.chrome/com.google.android.apps.chrome.Main');
 device=await sceneDevice('android',base,{initialPath:'/__device_blank__?startup='+Date.now()});assert.ok(device.installInitScript); await sleep(300); assert.equal(await device.evaluate("Boolean(document.querySelector('earthlight-explorer'))"),false,'Initial blank must not prewarm scene');
 await device.installInitScript(`(()=>{
  const log=window.__sceneStartup={frames:[],visibility:[],focus:[]},wrapped=new WeakSet(),get=HTMLCanvasElement.prototype.getContext;
  const visible=()=>log.visibility.push({time:performance.now(),state:document.visibilityState,focused:document.hasFocus()});document.addEventListener('visibilitychange',visible);window.addEventListener('focus',visible);window.addEventListener('blur',visible);visible();
  HTMLCanvasElement.prototype.getContext=function(...args){const g=get.apply(this,args);if(!g||!['webgl','webgl2','experimental-webgl'].includes(args[0])||wrapped.has(g))return g;wrapped.add(g);const canvas=this,s=canvas.closest('earthlight-explorer');if(!s)return g;
   const draw=g.drawArrays,bind=g.bindFramebuffer;let target=null;
   new MutationObserver(()=>{const phase=s.dataset.focus;if(log.focus.at(-1)?.phase!==phase)log.focus.push({time:performance.now(),phase});}).observe(s,{attributes:true,attributeFilter:['data-focus']});
   g.bindFramebuffer=function(k,v){if(k===g.FRAMEBUFFER||k===g.DRAW_FRAMEBUFFER)target=v;return bind.call(this,k,v);};
   g.drawArrays=function(...a){const r=draw.apply(this,a);if(target===null){const time=performance.now(),sharp=s.dataset.focus==='sharp';if(sharp&&log.sharp===undefined)log.sharp=time;log.frames.push({time,sharp,visible:document.visibilityState,focused:document.hasFocus(),scale:Number(s.dataset.renderScale),width:canvas.width,height:canvas.height});}return r;};return g;
  };
 })()`);
 for(const c of [{name:'homepage-autoplay-1',query:{}},{name:'homepage-autoplay-2',query:{}}].slice(0,process.env.STARTUP_SINGLE==='1'?1:2)){
  console.log('START',c.name);const url=new URL('/',base);if(startupProfile!=='compact')url.searchParams.set('render',startupProfile);for(const[k,v]of Object.entries(c.query))url.searchParams.set(k,String(v));const previousOrigin=await device.evaluate("performance.timeOrigin");await device.navigate(url.href);
  const deadline=Date.now()+120000;let done=false;
  while(Date.now()<deadline){await sleep(500);done=await device.evaluate(`Boolean(performance.timeOrigin!==${previousOrigin}&&window.__sceneStartup?.sharp!==undefined&&performance.now()-window.__sceneStartup.sharp>=20000)`);if(done)break;}
  assert.ok(done,'No 20-second sharp autoplay interval');
  const run=await device.evaluate(`(()=>{const s=document.querySelector('earthlight-explorer'),c=s.querySelector('canvas'),g=c.getContext('webgl2')??c.getContext('webgl');const r={...window.__sceneStartup,timeOrigin:performance.timeOrigin,data:{...s.dataset},width:c.width,height:c.height,dpr:devicePixelRatio,viewport:[innerWidth,innerHeight],error:g.getError(),assets:performance.getEntriesByType('resource').filter(r=>r.name.includes('/_astro/')&&r.name.endsWith('.js')).map(r=>r.name)};const b=s.querySelector('.explorer-motion');if(b.getAttribute('aria-label')==='Pause')b.click();return r;})()`);
  for(const asset of run.assets)if(!results.clientHashes[asset]){const response=await fetch(asset);assert.ok(response.ok);results.clientHashes[asset]=createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex');if(asset.includes('EarthlightExplorer.'))assert.equal(results.clientHashes[asset],process.env.SCENE_EXPECTED_CLIENT_SHA256??'ab8961f8a4ad0d9818e209967e04803ad909d0da481cf0573a5c89c6063be679','Expected scene client SHA-256');}
  const intervals=run.frames.slice(1).map((f,i)=>({time:f.time,ms:f.time-run.frames[i].time})).filter(f=>f.time>=run.sharp&&f.time<run.sharp+20000);const sorted=intervals.map(f=>f.ms).sort((a,b)=>a-b);const cadence={meanMs:sorted.reduce((a,b)=>a+b,0)/sorted.length,p95Ms:sorted[Math.floor(sorted.length*.95)],maxMs:sorted.at(-1),over100:sorted.filter(x=>x>100).length};
  const samples=Array.from({length:4},(_,i)=>{const frames=run.frames.filter(f=>f.time>=run.sharp+i*5000&&f.time<run.sharp+(i+1)*5000);return {afterSharpSeconds:(i+1)*5,fps:frames.length/5,scaleMin:Math.min(...frames.map(f=>f.scale)),scaleMax:Math.max(...frames.map(f=>f.scale)),lastScale:frames.at(-1)?.scale};});
  const recorded={...c,url:url.href,...run,firstDraw:run.frames[0]?.time,samples,cadence,battery:adb('shell','dumpsys','battery')};results.runs.push(recorded);await writeFile(out+'/results.json',JSON.stringify(results,null,2)+'\n');assert.equal(run.error,0);assert.equal(run.data.assetFailures,'0');assert.equal(run.data.renderProfile,startupProfile);if(startupProfile==='clouds-half')assert.equal(run.data.cloudPass,'half');assert.ok(['webgl','webgl2'].includes(run.data.renderApi));assert.ok(run.visibility.filter(v=>v.time>=recorded.firstDraw).every(v=>v.state==='visible'&&v.focused)&&run.frames.every(f=>f.visible==='visible'&&f.focused),'Autoplay hidden/unfocused from first draw onward');console.log('RESULT',c.name,JSON.stringify({firstDraw:recorded.firstDraw,sharp:run.sharp,samples}));
 }
}catch(error){if(device)try{results.partial=await device.evaluate('JSON.parse(JSON.stringify(window.__sceneStartup??null))');}catch{}results.error=String(error.stack??error);process.exitCode=1;console.error(error);}
finally{results.finished=new Date().toISOString();await writeFile(out+'/results.json',JSON.stringify(results,null,2)+'\n');try{if(device)await device.close();}finally{adb('shell','settings','put','global','stay_on_while_plugged_in',originalAwake);}}
