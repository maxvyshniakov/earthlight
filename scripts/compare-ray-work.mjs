// Interleave reference/candidate frames on one GPU to control scheduling drift.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {ISS_PERIOD_SECONDS} from '../src/scripts/iss-orbit.ts';
const exec=promisify(execFile);
const options={bake:{cloudBake:'budget'},pool:{terrainDecoder:'pool'},packed:{terrainSource:'packed'},streaming:{cloudBake:'budget',terrainDecoder:'pool',terrainSource:'packed'},cache:{terrainCache:'working'},uploads:{terrainUpload:'tile'},bounded:{terrainWork:'bounded'},pixel:{terrainWork:'bounded',terrainRefinement:'pixel'},clouds:{cloudSteps:'balanced'},coarse:{terrainDetail:'coarse'},combined:{terrainWork:'bounded',terrainRefinement:'pixel',cloudSteps:'balanced'},lean:{shaderWork:'lean'},bound:{terrainBound:'regional'},leanBound:{shaderWork:'lean',terrainBound:'regional'},noise:{noise:'table'},all:{terrainBound:'regional',shaderWork:'lean',noise:'table',terrainFetch:'shared'},terrainFetch:{terrainFetch:'shared'},temporal:{cloudReuse:'temporal'},allTemporal:{terrainBound:'regional',shaderWork:'lean',noise:'table',terrainFetch:'shared',cloudReuse:'temporal'}};
// Candidates measured against the current default work settings.
const currentWork=['uploads','cache','bake','pool','packed','streaming','lean','bound','leanBound','noise','all','terrainFetch','temporal','allTemporal'];
const [base='http://127.0.0.1:4347',out='/tmp/earthlight-pairs',selected='bounded,pixel',views='clouds,day,night',baseline='compact']=process.argv.slice(2);
let sequence=0,session,opened=false;
const run=async(...args)=>(await exec('rtk',['proxy','agent-browser','--session',session,...args],{maxBuffer:80e6,timeout:90000})).stdout;
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
const needsFine=selected.split(',').some(name=>['cache','uploads','pool','packed','streaming','bound','leanBound','all','allTemporal'].includes(name));
// Horizon and ocean views may want no DEM90 tiles; require them only where selected.
const ready=settled+(needsFine?`&&[...document.querySelectorAll('earthlight-explorer')].every(s=>{const t=JSON.parse(s.dataset.terrainTiles??'{}');return t.fineWanted===0||Number(t.fineResident)>0;})`: '');
// Tile streaming can need more than one browser wait window on a cold cache.
const wait=async()=>{for(let attempt=1;;attempt++){try{return await run('wait','--fn',ready);}catch(e){
 if(!String(e.stderr).includes('Wait timed out'))throw e;
 console.error('Still settling:',await run('eval',`JSON.stringify([...document.querySelectorAll('earthlight-explorer')].map(s=>({focus:s.dataset.focus,phase:s.dataset.assetPhase,exposure:s.dataset.exposure,lighting:s.dataset.cloudLightingReady,progress:s.dataset.cloudLightingProgress,tiles:['dayTiles','nightTiles','cloudTiles','galaxyTiles'].map(k=>s.dataset[k]&&JSON.parse(s.dataset[k]).pending),terrain:s.dataset.terrainTiles})))`).catch(error=>String(error)));
 if(attempt>=6)throw e;
}}};
await mkdir(out,{recursive:true});const results=[];
try{
 for(const scene of [{name:'day',t:3235.65,pitch:0},{name:'night',t:610.87,pitch:0},{name:'clouds',t:3235.65,pitch:-25},{name:'ocean',t:3900,pitch:-25},{name:'lowland',t:2650,pitch:-40},{name:'himalaya',t:2780,pitch:-40}].filter(s=>views.split(',').includes(s.name)))for(const candidate of selected.split(',')){
  session=`earthlight-pairs-${process.pid}-${sequence++}`;opened=true;
  assert.ok(options[candidate],`Unknown candidate: ${candidate}`);
  // Candidates are measured against the work before the 2026-10-13 defaults.
  const before={shaderWork:'legacy',terrainBound:'off',noise:'hash',terrainFetch:'separate',cloudReuse:'off'};
  const referenceWork=currentWork.includes(candidate)?{terrainWork:'bounded',terrainRefinement:'pixel',cloudSteps:'balanced',...before}:{terrainWork:'legacy',terrainRefinement:'full',cloudSteps:'full',...before};
  await run('open',`${base}/?api=webgl&render=${encodeURIComponent(baseline)}&motion=0&quality=fixed&${new URLSearchParams(referenceWork)}&terrainUpload=strips&terrainCache=${['uploads','cache'].includes(candidate)?'small':'working'}&terrainDecoder=single&terrainSource=tiff&cloudBake=fixed&t=${scene.t}&pitch=${scene.pitch}&epoch=2026-10-06T01:32:27Z&look-grain=0&exposure-mode=manual&exposure-fixed=0`);
  await run('set','viewport','1248','615');await wait();
  await evaluate(`(()=>{
   const original=document.querySelector('earthlight-explorer'),copy=original.cloneNode(true);
   const url=new URL(location.href);for(const [k,v] of Object.entries(${JSON.stringify(options[candidate])}))url.searchParams.set(k,v);history.replaceState(null,'',url);
   for(const k of Object.keys(copy.dataset))if(k!=='composition'&&!k.startsWith('astro'))delete copy.dataset[k];
   copy.style.cssText='position:fixed;inset:0;width:100%;height:100%;z-index:20;';
   original.parentNode.appendChild(copy);return true;
  })()`);await wait();
  // A look input restarts exposure settling and submits background frames even
  // while paused. Prime an unchanged seek, settle it, then use that to invalidate.
  await evaluate(`(()=>{for(const s of document.querySelectorAll('earthlight-explorer'))s.querySelector('.explorer-track input').dispatchEvent(new Event('input'));return true;})()`);await wait();
  const result=await evaluateTask(`(async()=>{
   const skies=[...document.querySelectorAll('earthlight-explorer')],pairs=[];
   const states=skies.map(s=>({shaderWork:s.dataset.shaderWork,terrainBound:s.dataset.terrainBound,terrainWork:s.dataset.terrainWork,terrainRefinement:s.dataset.terrainRefinement,cloudSteps:s.dataset.cloudSteps,terrain:s.dataset.terrainTiles,cloudBake:s.dataset.cloudLightingBake,profile:s.dataset.renderProfile,cloudPass:s.dataset.cloudPass,cloudBuffer:s.dataset.cloudBuffer,position:s.dataset.cameraPosition,basis:s.dataset.cameraBasis,width:s.querySelector('canvas').width,height:s.querySelector('canvas').height,failures:s.dataset.assetFailures}));
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
   const g=skies[0].querySelector('canvas').getContext('webgl'),debug=g.getExtension('WEBGL_debug_renderer_info');
   return {renderer:debug&&g.getParameter(debug.UNMASKED_RENDERER_WEBGL),states,pairs,frameCounts:monitors.map(m=>m.count()),referenceMs:median(pairs.map(p=>p.reference)),candidateMs:median(pairs.map(p=>p.candidate)),pairedRatio:median(pairs.map(p=>p.ratio))};
  })()`);
  assert.ok(result.renderer&&!/swiftshader|llvmpipe|softpipe/i.test(result.renderer),result.renderer);
  assert.deepEqual(result.states.map(s=>s.profile),[baseline,baseline]);
  for(const [index,expected] of [referenceWork,{...referenceWork,...options[candidate]}].entries())
   for(const key of ['terrainWork','terrainRefinement','cloudSteps'])assert.equal(result.states[index][key],expected[key]);
  for(const [i,state] of result.states.entries()){
   const expected={shaderWork:'legacy',terrainBound:'off',...(i?options[candidate]:{})};
   assert.equal(state.shaderWork,expected.shaderWork);assert.equal(state.terrainBound,expected.terrainBound);
   if(expected.terrainBound==='regional'){const t=JSON.parse(state.terrain);assert.ok(t.boundReady&&t.boundCells>0,JSON.stringify(t));}
  }
  if(candidate==='cache')for(const [i,mode] of ['small','working'].entries()){
   const terrain=JSON.parse(result.states[i].terrain);assert.equal(terrain.cacheMode,mode);assert.ok(terrain.fineResident>0,JSON.stringify(terrain));
  }
  if(candidate==='uploads')for(const [i,mode] of ['strips','tile'].entries()){
   const terrain=JSON.parse(result.states[i].terrain);assert.equal(terrain.uploadMode,mode);assert.ok(terrain.fineResident>0,JSON.stringify(terrain));
  }
  if(['bake','pool','packed','streaming'].includes(candidate))for(const [i,state] of result.states.entries()){
   const t=JSON.parse(state.terrain);assert.equal(t.cacheMode,'working');
   assert.equal(t.decoderMode,i&&['pool','streaming'].includes(candidate)?'pool':'single');
   assert.equal(t.sourceMode,i&&['packed','streaming'].includes(candidate)?'packed':'tiff');
   assert.equal(state.cloudBake,i&&['bake','streaming'].includes(candidate)?'budget':'fixed');
   if(i&&['packed','streaming'].includes(candidate)){assert.ok(t.packedDecodes>0);assert.equal(t.packedFallbacks,0);}
  }
  if(candidate==='clouds-half')assert.equal(result.states[1].cloudPass,'half','Do not benchmark a silent compact fallback as half-resolution clouds');
  assert.deepEqual(result.frameCounts,[40,40],'Only the requested frames may run during paired sampling');
  for(const k of ['position','basis','width','height'])assert.equal(result.states[0][k],result.states[1][k]);
  assert.ok(result.states.every(s=>s.failures==='0'));
  results.push({scene:scene.name,baseline,candidate,launchArgs:process.env.AGENT_BROWSER_ARGS??'',...result});await writeFile(`${out}/results.json`,JSON.stringify(results,null,2)+'\n');
  console.log(`${scene.name}/${candidate}: ${result.referenceMs.toFixed(2)} → ${result.candidateMs.toFixed(2)} ms; paired ratio ${result.pairedRatio.toFixed(3)}`);
  const captured=await evaluateTask(`(async()=>{
   const skies=[...document.querySelectorAll('earthlight-explorer')],all=[];
   const clock=performance.now.bind(performance),fixed=clock();performance.now=()=>fixed;
   try{for(const sky of skies){
    const canvas=sky.querySelector('canvas'),gl=canvas.getContext('webgl'),draw=gl.drawArrays,bind=gl.bindFramebuffer;
    const input=sky.querySelector('.explorer-track input'),step=input.step;input.step='any';
    let target=gl.getParameter(gl.FRAMEBUFFER_BINDING),onFrame=null;const frames=[],poses=[];
    gl.bindFramebuffer=function(k,v){target=v;return bind.call(this,k,v);};
    gl.drawArrays=function(...a){draw.apply(this,a);if(target===null&&onFrame){const cb=onFrame;onFrame=null;cb(canvas.toDataURL('image/png'));}};
    try{for(let i=0;i<8;i++){
     const image=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('capture timeout')),15000);onFrame=data=>{clearTimeout(timeout);resolve(data);};
      input.value=String((${scene.t}+i*10/24)/${ISS_PERIOD_SECONDS}*100);input.dispatchEvent(new Event('input'));
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
