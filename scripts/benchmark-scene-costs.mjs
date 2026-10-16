// Diagnostic GPU cost only. Cloud ablation changes the image and atmospheric
// path; its savings are an optimistic ceiling, not a half-resolution prediction.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

const exec=promisify(execFile);
const [base='http://127.0.0.1:4347',out='/tmp/earthlight-costs',mode='all']=process.argv.slice(2);
assert.ok(['all','clouds','scroll'].includes(mode),'Mode must be all, clouds or scroll');
const session=`earthlight-costs-${process.pid}`;
const run=async(...args)=>(await exec('rtk',['proxy','agent-browser','--session',session,...args],{timeout:90000,maxBuffer:8e6})).stdout;
const evaluate=async source=>JSON.parse(await run('eval','--base64',Buffer.from(source).toString('base64')));
const evaluateLong=async source=>{
 await evaluate(`(()=>{window.sceneCostTask={done:false};Promise.resolve(${source}).then(value=>window.sceneCostTask={done:true,value},error=>window.sceneCostTask={done:true,error:String(error.stack||error)});return true;})()`);
 const deadline=Date.now()+180000;
 while(Date.now()<deadline){
  const task=await evaluate('window.sceneCostTask');
  if(task.done){if(task.error)throw Error(task.error);return task.value;}
  await new Promise(resolve=>setTimeout(resolve,500));
 }
 throw Error('GPU diagnostic task timed out');
};
const settled=`(()=>{const skies=[...document.querySelectorAll('earthlight-explorer')];return skies.length>0&&skies.every(s=>s.dataset.focus==='sharp'&&s.dataset.assetPhase==='settled'&&s.dataset.exposure==='settled'&&['dayTiles','nightTiles','cloudTiles','terrainTiles','galaxyTiles'].every(k=>!s.dataset[k]||JSON.parse(s.dataset[k]).pending===0))})()`;
const wait=async stage=>{
 try{
  try{await run('wait','--fn',settled);}catch(error){if(!String(error.stderr).includes('Wait timed out'))throw error;await run('wait','--fn',settled);}
 }catch(error){
  const state=await evaluate(`(()=>({url:location.href,visibility:document.visibilityState,skies:[...document.querySelectorAll('earthlight-explorer')].map(s=>({...s.dataset}))}))()`);
  await writeFile(`${out}/settlement-failure.json`,JSON.stringify({stage,state},null,2)+'\n');
  throw Error('Settlement failed at '+stage+'; see '+out+'/settlement-failure.json',{cause:error});
 }
};
const median=values=>values.toSorted((a,b)=>a-b)[Math.floor(values.length/2)];
const distribution=values=>{const sorted=values.toSorted((a,b)=>a-b);return {min:sorted[0],p25:sorted[Math.floor(sorted.length*.25)],median:median(sorted),p75:sorted[Math.floor(sorted.length*.75)],max:sorted.at(-1)};};
const results={date:new Date().toISOString(),browserArgs:process.env.AGENT_BROWSER_ARGS??'',browserExecutable:process.env.AGENT_BROWSER_EXECUTABLE_PATH??'agent-browser default',method:'EXT_disjoint_timer_query, entire frame, 8 warmup pairs and 32 AB/BA pairs. Unchanged seek trigger, zero idle draws, exactly40 final-canvas draws per renderer. No synchronous completion/readback.',clouds:[],scroll:[]};
await mkdir(out,{recursive:true});
const save=()=>writeFile(`${out}/results.json`,JSON.stringify(results,null,2)+'\n');

// Installed only on the test page. Each measurement awaits the GPU query;
// paused renderers submit no competing animation frames.
const install=`(()=>{
 window.countSceneFrames=sky=>{
  const gl=sky.querySelector('canvas').getContext('webgl'),draw=gl.drawArrays,bind=gl.bindFramebuffer;
  const counter={frames:0};let target=gl.getParameter(gl.FRAMEBUFFER_BINDING);
  gl.bindFramebuffer=function(kind,value){target=value;return bind.call(this,kind,value);};
  gl.drawArrays=function(...args){draw.apply(this,args);if(target===null)counter.frames++;};
  return {counter,restore(){gl.drawArrays=draw;gl.bindFramebuffer=bind;}};
 };
 window.measureSceneFrame=sky=>new Promise((resolve,reject)=>{
  const canvas=sky.querySelector('canvas'),gl=canvas.getContext('webgl'),ext=gl.getExtension('EXT_disjoint_timer_query');
  if(!ext){reject(Error('Hardware GPU timers unavailable'));return;}
  const bind=gl.bindFramebuffer,draw=gl.drawArrays,query=ext.createQueryEXT();
  let target=gl.getParameter(gl.FRAMEBUFFER_BINDING),active=false,ended=false,finished=false;
  const restore=()=>{gl.bindFramebuffer=bind;gl.drawArrays=draw;};
  const clean=()=>{clearTimeout(timeout);clearInterval(poll);restore();if(active&&!ended)ext.endQueryEXT(ext.TIME_ELAPSED_EXT);ext.deleteQueryEXT(query);};
  const fail=error=>{if(finished)return;finished=true;clean();reject(error);};
  const timeout=setTimeout(()=>fail(Error('GPU frame timeout')),10000);
  const poll=setInterval(()=>{
   if(gl.getParameter(ext.GPU_DISJOINT_EXT)){fail(Error('Disjoint GPU query'));return;}
   if(!ended||!ext.getQueryObjectEXT(query,ext.QUERY_RESULT_AVAILABLE_EXT))return;
   const ms=Number(ext.getQueryObjectEXT(query,ext.QUERY_RESULT_EXT))/1e6,error=gl.getError();
   if(error){fail(Error('WebGL '+error));return;}finished=true;clean();resolve(ms);
  },10);
  gl.bindFramebuffer=function(kind,value){target=value;return bind.call(this,kind,value);};
  gl.drawArrays=function(...args){
   if(!active){ext.beginQueryEXT(ext.TIME_ELAPSED_EXT,query);active=true;}
   draw.apply(this,args);
   if(target===null){ext.endQueryEXT(ext.TIME_ELAPSED_EXT);ended=true;restore();}
  };
  sky.querySelector('.explorer-track input').dispatchEvent(new Event('input'));
 });
 window.sceneCostState=sky=>{
  const canvas=sky.querySelector('canvas'),gl=canvas.getContext('webgl'),debug=gl.getExtension('WEBGL_debug_renderer_info');
  return {profile:sky.dataset.renderProfile,volumePass:sky.dataset.volumePass,width:canvas.width,height:canvas.height,scale:sky.dataset.renderScale,position:sky.dataset.cameraPosition,basis:sky.dataset.cameraBasis,failures:sky.dataset.assetFailures,error:gl.getError(),userAgent:navigator.userAgent,renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)};
 };
 return true;
})()`;

try{
 await run('set','viewport','1440','900');
 for(const profile of mode==='scroll'?[]:['reference','compact']){
  const url=new URL('/',base);
  for(const [key,value] of Object.entries({render:profile,quality:'fixed',motion:0,t:3235.65,pitch:-25,epoch:'2026-10-06T01:32:27Z','look-grain':0}))url.searchParams.set(key,String(value));
  await run('open',url.href);await wait(profile+' initial');console.log(profile+': initial settled');
  const mutation=await evaluate(`(()=>{
   const prototype=WebGLRenderingContext.prototype,original=prototype.shaderSource;
   const signature='vec3 cloudVolume(vec3 ray,float groundDistance,vec3 background,out float atmosphereDistance){';
   let replacements=0;
   prototype.shaderSource=function(shader,source){
    const start=source.indexOf(signature);
    if(start>=0){
     let index=start+signature.length,depth=1;
     while(depth&&index<source.length){if(source[index]==='{')depth++;else if(source[index]==='}')depth--;index++;}
     if(depth)throw Error('Unbalanced cloudVolume source');
     source=source.slice(0,start)+signature+'atmosphereDistance=groundDistance;return background;}'+source.slice(index);replacements++;
    }
    return original.call(this,shader,source);
   };
   try{
    const sky=document.querySelector('earthlight-explorer'),copy=sky.cloneNode(true);
    for(const key of Object.keys(copy.dataset))if(key!=='composition'&&!key.startsWith('astro'))delete copy.dataset[key];
    copy.style.cssText='position:fixed;inset:0;z-index:20;';sky.parentNode.append(copy);
   }finally{prototype.shaderSource=original;}
   return {replacements};
  })()`);
  assert.ok(mutation.replacements>0,'Cloud function must be ablated');
  // Prime slider quantization once, then let metering settle. Repeating this
  // unchanged seek invalidates one frame without extending exposure adaptation.
  await evaluate(`(()=>{for(const s of document.querySelectorAll('earthlight-explorer'))s.querySelector('.explorer-track input').dispatchEvent(new Event('input'));return true;})()`);
  await wait(profile+' primed pair');await evaluate(install);console.log(profile+': primed pair settled');
  const result=await evaluateLong(`(async()=>{
   const skies=[...document.querySelectorAll('earthlight-explorer')],pairs=[];
   const counters=skies.map(countSceneFrames);
   try{
    await new Promise(resolve=>setTimeout(resolve,1200));
    if(counters.some(c=>c.counter.frames!==0))throw Error('Unrequested idle frames before sampling');
    for(let i=0;i<40;i++){
     let full,noViewClouds;
     if(i%2){noViewClouds=await measureSceneFrame(skies[1]);full=await measureSceneFrame(skies[0]);}
     else{full=await measureSceneFrame(skies[0]);noViewClouds=await measureSceneFrame(skies[1]);}
     if(i>=8)pairs.push({full,noViewClouds,ratio:noViewClouds/full});
    }
    const frameCounts=counters.map(c=>c.counter.frames);
    if(frameCounts.some(n=>n!==40))throw Error('Incidental frames during sampling: '+frameCounts);
    return {states:skies.map(sceneCostState),pairs,frameCounts,clientAssets:performance.getEntriesByType('resource').filter(x=>x.name.includes('/_astro/')&&x.name.endsWith('.js')).map(x=>x.name)};
   }finally{
    for(const counter of counters)counter.restore();
   }
  })()`);
  assert.equal(result.states.length,2);
  for(const state of result.states){assert.equal(state.profile,profile);assert.equal(state.failures,'0');assert.equal(state.error,0);}
  for(const key of ['width','height','position','basis'])assert.equal(result.states[0][key],result.states[1][key]);
  const row={profile,...mutation,...result,fullMs:median(result.pairs.map(p=>p.full)),noViewCloudsMs:median(result.pairs.map(p=>p.noViewClouds)),remainingRatio:median(result.pairs.map(p=>p.ratio)),ratioDistribution:distribution(result.pairs.map(p=>p.ratio))};
  results.clouds.push(row);await save();console.log({profile,fullMs:row.fullMs,noViewCloudsMs:row.noViewCloudsMs,remainingRatio:row.remainingRatio});
 }
 for(const profile of mode==='clouds'?[]:['reference','compact']){
  await run('open',`${base}/?render=${profile}&quality=fixed&motion=0&t=3235.65&epoch=2026-10-06T01:32:27Z&look-grain=0`);await wait(profile+' homepage');await evaluate(install);
  // Composition reaches its final altitude at .75 small viewport heights.
  // Measure in both directions to expose clock/scheduling drift.
  for(const fraction of [0,.375,.75,1,1,.75,.375,0]){
   const position=await evaluate(`(()=>{scrollTo(0,innerHeight*${fraction});return {requestedFraction:${fraction},scrollY,viewportHeight:innerHeight,maxScroll:document.documentElement.scrollHeight-innerHeight};})()`);
   await evaluate(`(()=>{document.querySelector('.explorer-track input').dispatchEvent(new Event('input'));return true;})()`);
   await wait(profile+' scroll '+fraction);
   const result=await evaluateLong(`(async()=>{
    const sky=document.querySelector('earthlight-explorer'),samples=[],count=countSceneFrames(sky);
    try{
     await new Promise(resolve=>setTimeout(resolve,1200));
     if(count.counter.frames!==0)throw Error('Unrequested idle frames at scroll position '+scrollY);
     for(let i=0;i<42;i++){const ms=await measureSceneFrame(sky);if(i>=6)samples.push(ms);}
     if(count.counter.frames!==42)throw Error('Incidental scroll frames: '+count.counter.frames);
     return {state:sceneCostState(sky),samples,frameCount:count.counter.frames,scrollY};
    }finally{count.restore();}
   })()`);
   assert.equal(result.state.profile,profile);assert.equal(result.state.error,0);assert.equal(result.state.failures,'0');
   const row={profile,...position,...result,medianMs:median(result.samples)};results.scroll.push(row);await save();console.log({profile,scrollY:result.scrollY,medianMs:row.medianMs});
  }
 }
}finally{await run('close');}
