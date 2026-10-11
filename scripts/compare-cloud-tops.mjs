// Compare cloud morphology with a saved baseline earth-clouds.ts.
// Inject only the old density function into an isolated reference renderer.
// Interleave reference/candidate frames on one GPU to control scheduling drift.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const exec=promisify(execFile);
const [base='http://127.0.0.1:4347',out='/tmp/orbit-pairs',baselineFile,views='north,south',baseline='compact']=process.argv.slice(2);
assert.ok(baselineFile,'Pass the saved baseline earth-clouds.ts as the third argument');
const oldSource=await readFile(baselineFile,'utf8');
const end=oldSource.indexOf('float cloudIntegratedDensity(');
const density=oldSource.slice(oldSource.indexOf('float cloudBaseDensity('),end<0?oldSource.length:end);
assert.ok(density.startsWith('float cloudBaseDensity(')&&density.includes('return '),'Invalid baseline density source');
const scenes=[
 {name:'cells',url:'/?t=1325.63&epoch=2026-10-11T08%3A39%3A37.223Z&flight=free&position=0.94892184,-0.32164559,-0.36790869&orientation=0.1578191193,0.6216539640,-0.5794193255,0.5029042850'},
 {name:'north',lat:43.2,lon:133.3,hdg:220,alt:2616,elevation:-54,epoch:'2026-10-11T08:23:03Z'},
 {name:'south',lat:-75.8,lon:47.3,hdg:70,alt:2616,elevation:-54,epoch:'2026-10-11T08:16:36Z'},
 {name:'nadir',lat:43.2,lon:133.3,hdg:220,alt:2616,elevation:-90,epoch:'2026-10-11T08:23:03Z'},
 {name:'low',lat:5,lon:-76.9,hdg:142,alt:150,elevation:-14,epoch:'2026-10-10T18:57:59Z'},
 {name:'sunset',lat:5,lon:-76.9,hdg:142,alt:150,elevation:-14,epoch:'2026-10-10T22:35:00Z'},
];
function sceneURL(scene){
 if(scene.url){const u=new URL(scene.url,base);for(const [k,v] of Object.entries({api:'webgl',render:'compact',cloudShape:process.env.CLOUD_TOPS_SHAPE??'current',motion:0,quality:'fixed','exposure-mode':'manual','exposure-fixed':-.5,'look-grain':0}))u.searchParams.set(k,String(v));return u.href;}
 const r=Math.PI/180,lat=scene.lat*r,lon=scene.lon*r,h=scene.hdg*r;
 const n=[Math.cos(lat)*Math.cos(lon),Math.cos(lat)*Math.sin(lon),Math.sin(lat)];
 const north=[-Math.sin(lat)*Math.cos(lon),-Math.sin(lat)*Math.sin(lon),Math.cos(lat)],east=[-Math.sin(lon),Math.cos(lon),0];
 const u=new URL('/',base);
 for(const [k,v] of Object.entries({api:'webgl',render:'compact',cloudShape:process.env.CLOUD_TOPS_SHAPE??'current',motion:0,quality:'fixed',t:0,epoch:scene.epoch,flight:'free',position:n.map(v=>v*(1+scene.alt/6371)).join(','),heading:north.map((v,i)=>v*Math.cos(h)+east[i]*Math.sin(h)).join(','),elevation:scene.elevation*r,roll:0,'exposure-mode':'manual','exposure-fixed':-.5,'look-grain':0}))u.searchParams.set(k,String(v));
 return u.href;
}
let sequence=0,session,opened=false;
const run=async(...args)=>(await exec('rtk',['proxy','agent-browser','--session',session,...args],{maxBuffer:8e6,timeout:90000})).stdout;
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
const settled=`[...document.querySelectorAll('orbital-sky')].every(s=>s.dataset.focus==='sharp'&&s.dataset.assetPhase==='settled'&&s.dataset.exposure==='settled'&&(s.dataset.cloudLighting!=='texture'||Number(s.dataset.cameraAltitude)>1529||Math.abs(Number(JSON.parse('['+s.dataset.cameraPosition+']')[2]))/Math.hypot(...JSON.parse('['+s.dataset.cameraPosition+']'))>Math.sin(75*Math.PI/180)||s.dataset.cloudLightingReady==='1')&&Number(s.dataset.cloudLightingProgress??0)===0&&['dayTiles','nightTiles','cloudTiles','terrainTiles','galaxyTiles'].every(k=>!s.dataset[k]||JSON.parse(s.dataset[k]).pending===0))`;
const wait=async()=>{try{await run('wait','--fn',settled);}catch(e){if(!String(e.stderr).includes('Wait timed out'))throw e;await run('wait','--fn',settled);}};

async function capture(name){
 await evaluate(`(()=>{const style=document.createElement('style');style.id='prototype-capture';style.textContent='orbital-sky > :not(canvas){visibility:hidden!important}';document.head.append(style);return true})()`);
 await run('screenshot',out+'/'+name+'.png');
 await evaluate(`document.querySelector('#prototype-capture').remove()`);
}

await mkdir(out,{recursive:true});const results=[];
try{
 for(const scene of scenes.filter(s=>views.split(',').includes(s.name))){
  const candidate='tops';
  session=`cloud-tops-${process.pid}-${sequence++}`;opened=true;
  await run('set','viewport','1440','954');
  await run('open',sceneURL(scene));await wait();await capture(scene.name+'-after');
  await evaluate(`(()=>{
   const proto=WebGLRenderingContext.prototype,originalSource=proto.shaderSource;
   window.cloudTopReplacements=0;
   window.restoreCloudShader=()=>{proto.shaderSource=originalSource;};
   proto.shaderSource=function(shader,text){
    const start=text.indexOf('float cloudBaseDensity('),end=text.indexOf('float cloudIntegratedDensity(');
    if(start>=0&&end>start){text=text.slice(0,start)+${JSON.stringify(density)}+text.slice(end);window.cloudTopReplacements++;}
    return originalSource.call(this,shader,text);
   };
   const original=document.querySelector('orbital-sky'),copy=original.cloneNode(true);
   for(const k of Object.keys(copy.dataset))if(k!=='composition'&&!k.startsWith('astro'))delete copy.dataset[k];
   copy.style.cssText='position:fixed;inset:0;width:100%;height:100%;z-index:20;';
   original.parentNode.appendChild(copy);return true;
  })()`);await wait();assert.ok(await evaluate('window.restoreCloudShader();window.cloudTopReplacements')>0,'Baseline density must be compiled');
  await capture(scene.name+'-before');
  if(process.env.CLOUD_TOPS_CAPTURE_ONLY==='1'){await run('close');opened=false;continue;}
  // A look input restarts exposure settling and submits background frames even
  // while paused. Prime an unchanged seek, settle it, then use that to invalidate.
  await evaluate(`(()=>{window.cloudPairSeek=new WeakMap();for(const s of document.querySelectorAll('orbital-sky')){const input=s.querySelector('.sky-track input');window.cloudPairSeek.set(s,input.value);input.dispatchEvent(new Event('input'));}return true;})()`);await wait();
  await new Promise(r=>setTimeout(r,1800));
  const result=await evaluateTask(`(async()=>{
   const skies=[...document.querySelectorAll('orbital-sky')].reverse(),pairs=[];
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
     // Status paints the range back from floating-point scene time. Reusing
     // that value can drift time and restart exposure settling on every seek.
     const input=s.querySelector('.sky-track input');input.value=window.cloudPairSeek.get(s);input.dispatchEvent(new Event('input'));
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
  assert.equal(result.states[1].lighting,result.states[0].lighting);

  assert.deepEqual(result.frameCounts,[40,40],'Only the requested frames may run during paired sampling');
  for(const k of ['position','basis','width','height'])assert.equal(result.states[0][k],result.states[1][k]);
  assert.ok(result.states.every(s=>s.failures==='0'));
  results.push({scene:scene.name,baseline,candidate,launchArgs:process.env.AGENT_BROWSER_ARGS??'',...result});await writeFile(`${out}/results.json`,JSON.stringify(results,null,2)+'\n');
  console.log(`${scene.name}/${candidate}: ${result.referenceMs.toFixed(2)} → ${result.candidateMs.toFixed(2)} ms; paired ratio ${result.pairedRatio.toFixed(3)}`);
  await run('close');opened=false;
 }
}finally{if(opened)await run('close');}
