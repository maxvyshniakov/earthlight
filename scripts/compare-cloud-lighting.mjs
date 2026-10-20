// Interleave reference/candidate frames on one GPU to control scheduling drift.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const exec=promisify(execFile);
const [base='http://127.0.0.1:4347',out='/tmp/earthlight-pairs',selected='texture',views='low,nadir,sunset',baseline='compact']=process.argv.slice(2);
let sequence=0,session,opened=false;
const run=async(...args)=>(await exec('agent-browser',['--session',session,...args],{maxBuffer:8e6,timeout:90000})).stdout;
const evaluate=async code=>JSON.parse(await run('eval','--base64',Buffer.from(code).toString('base64')));
// Keep long GPU sampling outside a single browser-command timeout.
const evaluateTask=async code=>{
 await evaluate(`(()=>{window.scenePairTask={done:false};Promise.resolve(${code}).then(value=>window.scenePairTask={done:true,value},error=>window.scenePairTask={done:true,error:String(error.stack??error)});return true;})()`);
 const deadline=Date.now()+180000;
 while(Date.now()<deadline){
  const task=await evaluate('window.scenePairTask');
  if(task.done){if(task.error)throw Error(task.error);return task.value;}
  await new Promise(resolve=>setTimeout(resolve,500));
 }
 throw Error('Paired GPU sampling timed out');
};
const settled=`[...document.querySelectorAll('earthlight-explorer')].every(s=>s.dataset.focus==='sharp'&&s.dataset.assetPhase==='settled'&&s.dataset.exposure==='settled'&&(s.dataset.cloudLighting!=='texture'||s.dataset.cloudLightingReady==='1')&&Number(s.dataset.cloudLightingProgress??0)===0&&['dayTiles','nightTiles','cloudTiles','terrainTiles','galaxyTiles'].every(k=>!s.dataset[k]||JSON.parse(s.dataset[k]).pending===0))`;
const wait=async()=>{try{await run('wait','--fn',settled);}catch(e){if(!String(e.stderr).includes('Wait timed out'))throw e;await run('wait','--fn',settled);}};

async function capture(name){
 await evaluate(`(()=>{const style=document.createElement('style');style.id='prototype-capture';style.textContent='earthlight-explorer > :not(canvas){visibility:hidden!important}';document.head.append(style);return true})()`);
 await run('screenshot',out+'/'+name+'.png');
 await evaluate(`document.querySelector('#prototype-capture').remove()`);
}

await mkdir(out,{recursive:true});const results=[];
try{
 for(const scene of [{name:'low',elevation:-14,epoch:'2026-10-10T18:57:59Z'},{name:'nadir',elevation:-70,epoch:'2026-10-10T18:57:59Z'},{name:'sunset',elevation:-14,epoch:'2026-10-10T22:35:00Z'}].filter(s=>views.split(',').includes(s.name)))for(const candidate of selected.split(',')){
  session=`earthlight-pairs-${process.pid}-${sequence++}`;opened=true;
  await run('open',`${base}/?api=webgl&render=compact&cloudLighting=raymarch&motion=0&quality=fixed&t=0&epoch=${scene.epoch}&flight=free&position=0.23110484469368825,-0.9931139034621291,0.08920775364267444&heading=0.6152058162520828,0.07264813758210914,-0.7850121347822973&elevation=${scene.elevation*Math.PI/180}&roll=0&exposure-mode=manual&exposure-fixed=-0.5&look-grain=0`);
  await run('set','viewport','1600','1076');await wait();await capture(scene.name+'-original');
  await evaluate(`(()=>{
   const original=document.querySelector('earthlight-explorer'),copy=original.cloneNode(true);
   const url=new URL(location.href);url.searchParams.set('cloudLighting',${JSON.stringify(candidate)});history.replaceState(null,'',url);
   for(const k of Object.keys(copy.dataset))if(k!=='composition'&&!k.startsWith('astro'))delete copy.dataset[k];
   copy.style.cssText='position:fixed;inset:0;width:100%;height:100%;z-index:20;';
   original.parentNode.appendChild(copy);return true;
  })()`);await wait();
  // A look input restarts exposure settling and submits background frames even
  // while paused. Prime an unchanged seek, settle it, then use that to invalidate.
  await evaluate(`(()=>{for(const s of document.querySelectorAll('earthlight-explorer'))s.querySelector('.explorer-track input').dispatchEvent(new Event('input'));return true;})()`);await wait();
  await new Promise(r=>setTimeout(r,1800));
  const result=await evaluateTask(`(async()=>{
   const skies=[...document.querySelectorAll('earthlight-explorer')],pairs=[];
   const states=skies.map(s=>({lighting:s.dataset.cloudLighting??'raymarch',generation:s.dataset.cloudLightingGeneration,atlasBytes:s.dataset.cloudLightingBytes,patch:s.dataset.cloudLightingPatch,profile:s.dataset.renderProfile,cloudPass:s.dataset.cloudPass,cloudBuffer:s.dataset.cloudBuffer,position:s.dataset.cameraPosition,basis:s.dataset.cameraBasis,width:s.querySelector('canvas').width,height:s.querySelector('canvas').height,failures:s.dataset.assetFailures}));
   const monitors=skies.map(s=>{
    const gl=s.querySelector('canvas').getContext('webgl'),bind=gl.bindFramebuffer,draw=gl.drawArrays;
    let target=gl.getParameter(gl.FRAMEBUFFER_BINDING),frames=0;
    gl.bindFramebuffer=function(k,v){target=v;return bind.call(this,k,v);};
    gl.drawArrays=function(...args){draw.apply(this,args);if(target===null)frames++;};
    return {count:()=>frames,restore:()=>{gl.bindFramebuffer=bind;gl.drawArrays=draw;}};
   });
   const measure=async s=>{
    const gl=s.querySelector('canvas').getContext('webgl'),ext=gl.getExtension('EXT_disjoint_timer_query');
    if(!ext)throw Error('Hardware GPU timer unavailable');
    const bind=gl.bindFramebuffer,draw=gl.drawArrays;let target=gl.getParameter(gl.FRAMEBUFFER_BINDING),query=null,ended=false;
    gl.bindFramebuffer=function(k,v){target=v;return bind.call(this,k,v);};
    gl.drawArrays=function(...a){if(!query){query=ext.createQueryEXT();ext.beginQueryEXT(ext.TIME_ELAPSED_EXT,query);}draw.apply(this,a);if(!ended&&target===null){ext.endQueryEXT(ext.TIME_ELAPSED_EXT);ended=true;}};
    try{
     s.querySelector('.explorer-track input').dispatchEvent(new Event('input'));
     const deadline=performance.now()+10000;
     while((!ended||!ext.getQueryObjectEXT(query,ext.QUERY_RESULT_AVAILABLE_EXT))&&performance.now()<deadline)await new Promise(r=>setTimeout(r,4));
     if(!ended||!ext.getQueryObjectEXT(query,ext.QUERY_RESULT_AVAILABLE_EXT))throw Error('Frame timer timeout');
     if(gl.getParameter(ext.GPU_DISJOINT_EXT)||gl.getError())throw Error('Invalid GPU measurement');
     return Number(ext.getQueryObjectEXT(query,ext.QUERY_RESULT_EXT))/1e6;
    }finally{gl.bindFramebuffer=bind;gl.drawArrays=draw;if(query){if(!ended)ext.endQueryEXT(ext.TIME_ELAPSED_EXT);ext.deleteQueryEXT(query);}}
   };
   // Alternate AB/BA order; discard the first eight pairs, not just one side.
   try{for(let i=0;i<40;i++){
    let a,b;if(i%2){b=await measure(skies[1]);a=await measure(skies[0]);}else{a=await measure(skies[0]);b=await measure(skies[1]);}
    if(i>=8)pairs.push({reference:a,candidate:b,ratio:b/a});
   }}finally{monitors.forEach(m=>m.restore());}
   const median=a=>[...a].sort((x,y)=>x-y)[Math.floor(a.length/2)];
   return {states,pairs,frameCounts:monitors.map(m=>m.count()),referenceMs:median(pairs.map(p=>p.reference)),candidateMs:median(pairs.map(p=>p.candidate)),pairedRatio:median(pairs.map(p=>p.ratio))};
  })()`);
  assert.deepEqual(result.states.map(s=>s.profile),[baseline,baseline]);
  assert.equal(result.states[1].lighting,candidate);

  assert.deepEqual(result.frameCounts,[40,40],'Only the requested frames may run during paired sampling');
  for(const k of ['position','basis','width','height'])assert.equal(result.states[0][k],result.states[1][k]);
  assert.ok(result.states.every(s=>s.failures==='0'));
  results.push({scene:scene.name,baseline,candidate,launchArgs:process.env.AGENT_BROWSER_ARGS??'',...result});await writeFile(`${out}/results.json`,JSON.stringify(results,null,2)+'\n');
  console.log(`${scene.name}/${candidate}: ${result.referenceMs.toFixed(2)} → ${result.candidateMs.toFixed(2)} ms; paired ratio ${result.pairedRatio.toFixed(3)}`);
  await capture(scene.name+'-'+candidate);await run('close');opened=false;
 }
}finally{if(opened)await run('close');}
