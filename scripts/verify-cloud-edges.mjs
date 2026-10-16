// Requires codex/cloud-edge-refinement-experiment; main intentionally has no cloudEdges mode.
// See docs/lab/orbital-cloud-edges-2026-10-10.md for the archived decision and reproduction.
// Fixed WebGL2 images, deterministic motion and paired whole-frame GPU timing.
// Native timer queries measure cost; unthrottled headless RAF does not establish display cadence.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {ISS_PERIOD_SECONDS} from '../src/scripts/iss-orbit.ts';

const exec=promisify(execFile);
const [base='http://127.0.0.1:4351',out='/tmp/earthlight-cloud-edges']=process.argv.slice(2);
const session=`cloud-edges-${process.pid}`;
const run=async(...args)=>(await exec('rtk',['proxy','agent-browser','--session',session,...args],{timeout:90000,maxBuffer:80e6,env:{...process.env,AGENT_BROWSER_DEFAULT_TIMEOUT:'60000'}})).stdout;
const evaluate=async code=>JSON.parse(await run('eval','--base64',Buffer.from(code).toString('base64')));

const condition=`(()=>{const s=document.querySelector('earthlight-explorer');return s?.hasAttribute('data-ready')&&s.dataset.focus==='sharp'&&s.dataset.exposure==='settled'&&s.dataset.assetPhase==='settled'&&['dayTiles','cloudTiles','nightTiles','terrainTiles','galaxyTiles'].every(k=>!s.dataset[k]||JSON.parse(s.dataset[k]).pending===0)})()`;
const wait=()=>run('wait','--fn',condition);
const scenes=[{name:'clouds',t:3235.65,pitch:-25},{name:'horizon',t:3235.65,pitch:5}];
const frameCount=Number(process.env.EDGE_FRAMES??8);
assert.ok(Number.isInteger(frameCount)&&frameCount>=8&&frameCount<=64);
const variants=[{name:'compact',render:'compact'},{name:'half',render:'clouds-half'},{name:'edges',render:'clouds-half',cloudEdges:'1'}];
const urlFor=(variant,scene)=>{
 const url=new URL('/',base);
 for(const [key,value] of Object.entries({api:'webgl2',render:variant.render,...(variant.cloudEdges?{cloudEdges:variant.cloudEdges}:{}),aurora:'0',quality:'fixed',motion:'0',t:scene.t,pitch:scene.pitch,epoch:'2026-10-06T01:32:27Z','look-grain':0,'exposure-mode':'manual','exposure-fixed':0}))url.searchParams.set(key,String(value));
 return url.href;
};
const open=async(variant,scene)=>{console.log('open',scene.name,variant.name);await run('open',urlFor(variant,scene));await wait();};
const state=()=>evaluate(`(()=>{const s=document.querySelector('earthlight-explorer'),c=s.querySelector('canvas'),gl=c.getContext('webgl2');return {url:location.href,profile:s.dataset.renderProfile,api:s.dataset.renderApi,cloudPass:s.dataset.cloudPass,cloudEdges:s.dataset.cloudEdges,width:c.width,height:c.height,position:s.dataset.cameraPosition,basis:s.dataset.cameraBasis,failures:s.dataset.assetFailures,error:gl.getError(),client:[...document.scripts].map(s=>s.src).filter(Boolean)}})()`);
const capture=async(t,count)=>evaluate(`(async()=>{
 const s=document.querySelector('earthlight-explorer'),c=s.querySelector('canvas'),input=s.querySelector('.explorer-track input');
 const gl=c.getContext('webgl2'),bind=gl.bindFramebuffer,draw=gl.drawArrays,step=input.step;
 let target=gl.getParameter(gl.FRAMEBUFFER_BINDING),onFrame=null;
 const frames=[],poses=[];
 gl.bindFramebuffer=function(k,v){target=v;return bind.call(this,k,v);};
 gl.drawArrays=function(...args){draw.apply(this,args);if(target===null&&onFrame){const done=onFrame;onFrame=null;done(c.toDataURL('image/png'));}};
 // Manual exposure and paused orbit time make samples deterministic without
 // freezing the clock used by scene scheduling and exposure-settle timers.
 input.step='any';
 try{for(let i=0;i<${count};i++){
  const png=await new Promise((resolve,reject)=>{
   const timeout=setTimeout(()=>reject(Error('Cloud capture timeout')),10000);
   onFrame=data=>{clearTimeout(timeout);resolve(data);};
   input.value=String((${t}+i*10/24)/${ISS_PERIOD_SECONDS}*100);input.dispatchEvent(new Event('input'));
  });
  frames.push(png);poses.push(s.dataset.cameraBasis);
 }}finally{gl.bindFramebuffer=bind;gl.drawArrays=draw;input.step=step;}
 return {frames,poses,width:c.width,height:c.height,error:gl.getError()};
})()`);
const decode=async(capture,prefix)=>{
 const pixels=[];
 assert.equal(capture.error,0);
 for(let i=0;i<capture.frames.length;i++){
  const png=Buffer.from(capture.frames[i].split(',')[1],'base64');
  await writeFile(`${out}/${prefix}-${i}.png`,png);
  const raw=await sharp(png).removeAlpha().raw().toBuffer();
  assert.ok(raw.some(value=>value>30),'Captured frame must contain rendered light');pixels.push(raw);
 }
 return pixels;
};
const metrics=(reference,candidate)=>{
 let sum=0,max=0,n=0,temporal=0,temporalN=0,temporalOverFour=0;
 for(let f=0;f<reference.length;f++){
  assert.equal(candidate[f].length,reference[f].length);
  for(let k=0;k<reference[f].length;k++){
   const delta=candidate[f][k]-reference[f][k];sum+=Math.abs(delta);max=Math.max(max,Math.abs(delta));n++;
   if(f){const change=Math.abs(delta-(candidate[f-1][k]-reference[f-1][k]));temporal+=change;temporalN++;if(change>4)temporalOverFour++;}
  }
 }
 return {spatialMean:sum/n,spatialMax:max,temporalMean:temporalN?temporal/temporalN:null,temporalFractionOverFour:temporalN?temporalOverFour/temporalN:null};
};

const evaluateTask=async code=>{
 await evaluate(`(()=>{window.edgeTask={done:false};Promise.resolve(${code}).then(value=>window.edgeTask={done:true,value},error=>window.edgeTask={done:true,error:String(error.stack??error)});return true;})()`);
 const deadline=Date.now()+180000;
 while(Date.now()<deadline){const task=await evaluate('window.edgeTask');if(task.done){if(task.error)throw Error(task.error);return task.value;}await new Promise(r=>setTimeout(r,500));}
 throw Error('Edge task timed out');
};
const rawMask=()=>evaluate(`(async()=>{
 const s=document.querySelector('earthlight-explorer'),c=s.querySelector('canvas'),gl=c.getContext('webgl2');
 const draw=gl.drawArrays;let data=null;
 gl.drawArrays=function(...args){
  draw.apply(this,args);
  const program=gl.getParameter(gl.CURRENT_PROGRAM),target=gl.getParameter(gl.FRAMEBUFFER_BINDING);
  if(!data&&target&&gl.getUniformLocation(program,'cloudRadiance')!==null){
   const pixels=new Float32Array(c.width*c.height*4);gl.readPixels(0,0,c.width,c.height,gl.RGBA,gl.FLOAT,pixels);
   const error=gl.getError();if(error){data={error};return;}
   let refined=0,weight=0,maxWeight=0;
   for(let i=0;i<pixels.length;i+=4){if(pixels[i]>.5)refined++;weight+=pixels[i+1];maxWeight=Math.max(maxWeight,pixels[i+1]);}
   data={error:0,method:'Float32 readback of volume attachment before camera finish',pixels:c.width*c.height,refinedFraction:refined/(c.width*c.height),meanBlendWeight:weight/(c.width*c.height),maxBlendWeight:maxWeight};
  }
 };
 try{s.querySelector('.explorer-track input').dispatchEvent(new Event('input'));const deadline=performance.now()+10000;while(!data&&performance.now()<deadline)await new Promise(r=>setTimeout(r,10));if(!data)throw Error('No volume draw captured');return data;}
 finally{gl.drawArrays=draw;}
})()`);
const paired=async(scene,candidate)=>{
 await open(variants[1],scene);
 await evaluate(`(()=>{const original=document.querySelector('earthlight-explorer'),copy=original.cloneNode(true);history.replaceState(null,'',${JSON.stringify(urlFor(candidate,scene))});for(const k of Object.keys(copy.dataset))if(k!=='composition'&&!k.startsWith('astro'))delete copy.dataset[k];copy.style.cssText='position:fixed;inset:0;width:100%;height:100%;z-index:20';original.parentNode.appendChild(copy);return true;})()`);
 await run('wait','--fn',`[...document.querySelectorAll('earthlight-explorer')].length===2&&[...document.querySelectorAll('earthlight-explorer')].every(s=>s.dataset.focus==='sharp'&&s.dataset.assetPhase==='settled'&&s.dataset.exposure==='settled'&&['dayTiles','nightTiles','cloudTiles','terrainTiles','galaxyTiles'].every(k=>!s.dataset[k]||JSON.parse(s.dataset[k]).pending===0))`);
 await evaluate(`(()=>{for(const s of document.querySelectorAll('earthlight-explorer'))s.querySelector('.explorer-track input').dispatchEvent(new Event('input'));return true;})()`);
 await run('wait','--fn',`[...document.querySelectorAll('earthlight-explorer')].every(s=>s.dataset.exposure==='settled')`);
 return evaluateTask(`(async()=>{
  const skies=[...document.querySelectorAll('earthlight-explorer')],pairs=[],states=skies.map(s=>({profile:s.dataset.renderProfile,edges:s.dataset.cloudEdges,cloudPass:s.dataset.cloudPass,position:s.dataset.cameraPosition,basis:s.dataset.cameraBasis,width:s.querySelector('canvas').width,height:s.querySelector('canvas').height,failures:s.dataset.assetFailures}));
  const monitors=skies.map(s=>{const gl=s.querySelector('canvas').getContext('webgl2'),bind=gl.bindFramebuffer,draw=gl.drawArrays;let target=gl.getParameter(gl.FRAMEBUFFER_BINDING),count=0;gl.bindFramebuffer=function(k,v){target=v;return bind.call(this,k,v);};gl.drawArrays=function(...a){draw.apply(this,a);if(target===null)count++;};return {count:()=>count,restore:()=>{gl.bindFramebuffer=bind;gl.drawArrays=draw;}};});
  const measure=async s=>{
   const gl=s.querySelector('canvas').getContext('webgl2'),ext=gl.getExtension('EXT_disjoint_timer_query_webgl2');if(!ext)throw Error('Hardware GPU timer unavailable');
   const bind=gl.bindFramebuffer,draw=gl.drawArrays;let target=gl.getParameter(gl.FRAMEBUFFER_BINDING),query=null,ended=false;
   gl.bindFramebuffer=function(k,v){target=v;return bind.call(this,k,v);};
   gl.drawArrays=function(...a){if(!query){query=gl.createQuery();gl.beginQuery(ext.TIME_ELAPSED_EXT,query);}draw.apply(this,a);if(!ended&&target===null){gl.endQuery(ext.TIME_ELAPSED_EXT);ended=true;}};
   try{s.querySelector('.explorer-track input').dispatchEvent(new Event('input'));const deadline=performance.now()+10000;while((!ended||!gl.getQueryParameter(query,gl.QUERY_RESULT_AVAILABLE))&&performance.now()<deadline)await new Promise(r=>setTimeout(r,4));if(!ended||!gl.getQueryParameter(query,gl.QUERY_RESULT_AVAILABLE))throw Error('GPU query timed out');if(gl.getParameter(ext.GPU_DISJOINT_EXT)||gl.getError())throw Error('Invalid GPU measurement');return Number(gl.getQueryParameter(query,gl.QUERY_RESULT))/1e6;}
   finally{gl.bindFramebuffer=bind;gl.drawArrays=draw;if(query){if(!ended)gl.endQuery(ext.TIME_ELAPSED_EXT);gl.deleteQuery(query);}}
  };
  try{for(let i=0;i<40;i++){let a,b;if(i%2){b=await measure(skies[1]);a=await measure(skies[0]);}else{a=await measure(skies[0]);b=await measure(skies[1]);}if(i>=8)pairs.push({half:a,candidate:b,ratio:b/a});}}
  finally{monitors.forEach(m=>m.restore());}
  const median=a=>[...a].sort((x,y)=>x-y)[Math.floor(a.length/2)];return {states,pairs,frameCounts:monitors.map(m=>m.count()),halfMs:median(pairs.map(p=>p.half)),candidateMs:median(pairs.map(p=>p.candidate)),pairedRatio:median(pairs.map(p=>p.ratio))};
 })()`);
};
const results={conditions:{viewport:[1440,900],api:'webgl2',aurora:0,exposureEV:0,grain:0,frameStepSeconds:10/24,quality:'fixed',metricUnits:'8-bit RGB channel values',launchArgs:process.env.AGENT_BROWSER_ARGS??'',timing:'32 hardware GPU pairs after 8 warmup pairs; AB/BA; two resident renderers; whole frame'},images:[],timings:[]};
await mkdir(out,{recursive:true});
try{
 await run('set','viewport','1440','900');
 results.conditions.userAgent=await evaluate('navigator.userAgent');
 for(const scene of scenes){
  const captures={},pixels={},states={};
  for(const variant of variants){
   await open(variant,scene);const before=await state();assert.equal(before.api,'webgl2');assert.equal(before.failures,'0');assert.equal(before.error,0);assert.equal(before.cloudEdges,variant.cloudEdges??'off');if(variant.render==='clouds-half')assert.equal(before.cloudPass,'half');
   const frames={frames:[],poses:[],width:before.width,height:before.height,error:0};
   for(let offset=0;offset<frameCount;offset+=8){const batch=await capture(scene.t+offset*10/24,Math.min(8,frameCount-offset));assert.equal(batch.error,0);assert.equal(batch.width,before.width);assert.equal(batch.height,before.height);frames.frames.push(...batch.frames);frames.poses.push(...batch.poses);}
   captures[variant.name]=frames;states[variant.name]=before;pixels[variant.name]=await decode(frames,`${scene.name}-${variant.name}`);
  }
  for(const name of ['half','edges']){assert.equal(captures[name].width,captures.compact.width);assert.equal(captures[name].height,captures.compact.height);assert.deepEqual(captures[name].poses,captures.compact.poses);}
  assert.equal(new Set(captures.compact.poses).size,frameCount);
  const entry={scene:scene.name,frames:frameCount,states,half:metrics(pixels.compact,pixels.half),edges:metrics(pixels.compact,pixels.edges),edgeVsHalf:metrics(pixels.half,pixels.edges)};
  await open({name:'mask',render:'clouds-half',cloudEdges:'mask'},scene);await evaluate(`(()=>{document.querySelector('.explorer-track input').dispatchEvent(new Event('input'));return true;})()`);await wait();entry.mask=await rawMask();assert.equal(entry.mask.error,0);await run('screenshot',`${out}/${scene.name}-mask.png`);
  results.images.push(entry);console.log(scene.name,JSON.stringify(entry));await writeFile(`${out}/results.json`,JSON.stringify(results,null,2)+'\n');
 }
 for(const scene of scenes.filter(s=>(process.env.EDGE_GPU_VIEWS??'clouds,horizon').split(',').includes(s.name)))for(const candidate of [variants[0],variants[2]]){
  const timing=await paired(scene,candidate);assert.deepEqual(timing.frameCounts,[40,40]);assert.equal(timing.states[0].profile,'clouds-half');assert.equal(timing.states[0].edges,'off');assert.equal(timing.states[1].profile,candidate.render);assert.equal(timing.states[1].edges,candidate.cloudEdges??'off');for(const key of ['position','basis','width','height'])assert.equal(timing.states[0][key],timing.states[1][key]);assert.ok(timing.states.every(s=>s.failures==='0'));results.timings.push({scene:scene.name,candidate:candidate.name,...timing});console.log('paired',scene.name,candidate.name,timing.halfMs,timing.candidateMs,timing.pairedRatio);await writeFile(`${out}/results.json`,JSON.stringify(results,null,2)+'\n');
 }
}catch(error){results.failure={message:error.message,stack:error.stack,errors:await run('errors').catch(String),console:await run('console').catch(String)};throw error;}
finally{await writeFile(`${out}/results.json`,JSON.stringify(results,null,2)+'\n');await run('close');}
