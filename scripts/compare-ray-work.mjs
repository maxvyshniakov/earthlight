// Interleave reference/candidate frames on one GPU to control scheduling drift.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {ORBIT_SECONDS} from '../src/scripts/iss-orbit.ts';
const exec=promisify(execFile);
const options={bounded:{terrainWork:'bounded'},pixel:{terrainWork:'bounded',terrainRefinement:'pixel'},clouds:{cloudSteps:'balanced'},coarse:{terrainDetail:'coarse'},combined:{terrainWork:'bounded',terrainRefinement:'pixel',cloudSteps:'balanced'}};
const [base='http://127.0.0.1:4347',out='/tmp/orbit-pairs',selected='bounded,pixel',views='clouds,day,night',baseline='compact']=process.argv.slice(2);
let sequence=0,session,opened=false;
const run=async(...args)=>(await exec('rtk',['proxy','agent-browser','--session',session,...args],{maxBuffer:80e6,timeout:90000})).stdout;
const evaluate=async code=>JSON.parse(await run('eval','--base64',Buffer.from(code).toString('base64')));
// Keep long GPU sampling outside a single browser-command timeout.
const evaluateTask=async code=>{
 await evaluate(`(()=>{window.orbitPairTask={done:false};Promise.resolve(${code}).then(value=>window.orbitPairTask={done:true,value},error=>window.orbitPairTask={done:true,error:String(error.stack??error)});return true;})()`);
 const deadline=Date.now()+180000;
 while(Date.now()<deadline){
  const task=await evaluate('window.orbitPairTask');
  if(task.done){if(task.error)throw Error(task.error);return task.value;}
  await new Promise(resolve=>setTimeout(resolve,500));
 }
 throw Error('Paired GPU sampling timed out');
};
const settled=`[...document.querySelectorAll('orbital-sky')].every(s=>s.dataset.focus==='sharp'&&s.dataset.assetPhase==='settled'&&s.dataset.exposure==='settled'&&(s.dataset.cloudLighting!=='texture'||s.dataset.cloudLightingReady==='1')&&Number(s.dataset.cloudLightingProgress??0)===0&&['dayTiles','nightTiles','cloudTiles','terrainTiles','galaxyTiles'].every(k=>!s.dataset[k]||JSON.parse(s.dataset[k]).pending===0))`;
const wait=async()=>{try{await run('wait','--fn',settled);}catch(e){if(!String(e.stderr).includes('Wait timed out'))throw e;await run('wait','--fn',settled);}};
await mkdir(out,{recursive:true});const results=[];
try{
 for(const scene of [{name:'day',t:3235.65,pitch:0},{name:'night',t:610.87,pitch:0},{name:'clouds',t:3235.65,pitch:-25}].filter(s=>views.split(',').includes(s.name)))for(const candidate of selected.split(',')){
  session=`orbit-pairs-${process.pid}-${sequence++}`;opened=true;
  assert.ok(options[candidate],`Unknown candidate: ${candidate}`);
  await run('open',`${base}/?api=webgl&render=${encodeURIComponent(baseline)}&motion=0&quality=fixed&terrainWork=legacy&terrainRefinement=full&cloudSteps=full&t=${scene.t}&pitch=${scene.pitch}&epoch=2026-10-06T01:32:27Z&look-grain=0&exposure-mode=manual&exposure-fixed=0`);
  await run('set','viewport','1248','615');await wait();
  await evaluate(`(()=>{
   const original=document.querySelector('orbital-sky'),copy=original.cloneNode(true);
   const url=new URL(location.href);for(const [k,v] of Object.entries(${JSON.stringify(options[candidate])}))url.searchParams.set(k,v);history.replaceState(null,'',url);
   for(const k of Object.keys(copy.dataset))if(k!=='composition'&&!k.startsWith('astro'))delete copy.dataset[k];
   copy.style.cssText='position:fixed;inset:0;width:100%;height:100%;z-index:20;';
   original.parentNode.appendChild(copy);return true;
  })()`);await wait();
  // A look input restarts exposure settling and submits background frames even
  // while paused. Prime an unchanged seek, settle it, then use that to invalidate.
  await evaluate(`(()=>{for(const s of document.querySelectorAll('orbital-sky'))s.querySelector('.sky-track input').dispatchEvent(new Event('input'));return true;})()`);await wait();
  const result=await evaluateTask(`(async()=>{
   const skies=[...document.querySelectorAll('orbital-sky')],pairs=[];
   const states=skies.map(s=>({terrainWork:s.dataset.terrainWork,terrainRefinement:s.dataset.terrainRefinement,cloudSteps:s.dataset.cloudSteps,profile:s.dataset.renderProfile,cloudPass:s.dataset.cloudPass,cloudBuffer:s.dataset.cloudBuffer,position:s.dataset.cameraPosition,basis:s.dataset.cameraBasis,width:s.querySelector('canvas').width,height:s.querySelector('canvas').height,failures:s.dataset.assetFailures}));
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
     s.querySelector('.sky-track input').dispatchEvent(new Event('input'));
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
   const g=skies[0].querySelector('canvas').getContext('webgl'),debug=g.getExtension('WEBGL_debug_renderer_info');
   return {renderer:debug&&g.getParameter(debug.UNMASKED_RENDERER_WEBGL),states,pairs,frameCounts:monitors.map(m=>m.count()),referenceMs:median(pairs.map(p=>p.reference)),candidateMs:median(pairs.map(p=>p.candidate)),pairedRatio:median(pairs.map(p=>p.ratio))};
  })()`);
  assert.ok(result.renderer&&!/swiftshader|llvmpipe|softpipe/i.test(result.renderer),result.renderer);
  assert.deepEqual(result.states.map(s=>s.profile),[baseline,baseline]);
  assert.equal(result.states[1].terrainWork,['clouds','coarse'].includes(candidate)?'legacy':'bounded');
  assert.equal(result.states[1].cloudSteps,['clouds','combined'].includes(candidate)?'balanced':'full');
  assert.equal(result.states[1].terrainRefinement,['pixel','combined'].includes(candidate)?'pixel':'full');
  if(candidate==='clouds-half')assert.equal(result.states[1].cloudPass,'half','Do not benchmark a silent compact fallback as half-resolution clouds');
  assert.deepEqual(result.frameCounts,[40,40],'Only the requested frames may run during paired sampling');
  for(const k of ['position','basis','width','height'])assert.equal(result.states[0][k],result.states[1][k]);
  assert.ok(result.states.every(s=>s.failures==='0'));
  results.push({scene:scene.name,baseline,candidate,launchArgs:process.env.AGENT_BROWSER_ARGS??'',...result});await writeFile(`${out}/results.json`,JSON.stringify(results,null,2)+'\n');
  console.log(`${scene.name}/${candidate}: ${result.referenceMs.toFixed(2)} → ${result.candidateMs.toFixed(2)} ms; paired ratio ${result.pairedRatio.toFixed(3)}`);
  const captured=await evaluateTask(`(async()=>{
   const skies=[...document.querySelectorAll('orbital-sky')],all=[];
   const clock=performance.now.bind(performance),fixed=clock();performance.now=()=>fixed;
   try{for(const sky of skies){
    const canvas=sky.querySelector('canvas'),gl=canvas.getContext('webgl'),draw=gl.drawArrays,bind=gl.bindFramebuffer;
    const input=sky.querySelector('.sky-track input'),step=input.step;input.step='any';
    let target=gl.getParameter(gl.FRAMEBUFFER_BINDING),onFrame=null;const frames=[],poses=[];
    gl.bindFramebuffer=function(k,v){target=v;return bind.call(this,k,v);};
    gl.drawArrays=function(...a){draw.apply(this,a);if(target===null&&onFrame){const cb=onFrame;onFrame=null;cb(canvas.toDataURL('image/png'));}};
    try{for(let i=0;i<8;i++){
     const image=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('capture timeout')),15000);onFrame=data=>{clearTimeout(timeout);resolve(data);};
      input.value=String((${scene.t}+i*10/24)/${ORBIT_SECONDS}*100);input.dispatchEvent(new Event('input'));
     });frames.push(image);poses.push(sky.dataset.cameraBasis);
    }}finally{gl.drawArrays=draw;gl.bindFramebuffer=bind;input.step=step;}
    all.push({frames,poses,error:gl.getError()});
   }}finally{performance.now=clock;}return all;
  })()`);
  assert.deepEqual(captured[0].poses,captured[1].poses);assert.ok(captured.every(x=>x.error===0));
  let total=0,changed=0,max=0,temporal=0,overFour=0,previous;
  for(let i=0;i<8;i++){
   const images=[];
   for(let side=0;side<2;side++){
    const png=Buffer.from(captured[side].frames[i].split(',')[1],'base64');
    await writeFile(`${out}/${scene.name}-${candidate}-${side?'after':'before'}-${i}.png`,png);
    images.push(await sharp(png).removeAlpha().raw().toBuffer());
   }
   const difference=Int16Array.from(images[0],(v,k)=>images[1][k]-v);
   for(let k=0;k<difference.length;k++){const v=Math.abs(difference[k]);total+=v;max=Math.max(max,v);if(v)changed++;
    if(previous){const d=Math.abs(difference[k]-previous[k]);temporal+=d;if(d>4)overFour++;}}
   previous=difference;
  }
  result.visual={meanAbsByte:total/(previous.length*8),maxAbsByte:max,changedChannelFraction:changed/(previous.length*8),temporalMeanAbsByte:temporal/(previous.length*7),temporalOverFour:overFour/(previous.length*7)};
  results.at(-1).visual=result.visual;
  await writeFile(`${out}/results.json`,JSON.stringify(results,null,2)+'\n');console.log(result.visual);
  await run('close');opened=false;
 }
}finally{if(opened)await run('close');}
