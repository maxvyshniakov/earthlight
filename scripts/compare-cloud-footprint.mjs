// Paired GPU frame time of the working cloud shader against a git revision.
// bun scripts/compare-cloud-footprint.mjs <base-url> <out-dir> [ref=HEAD] [views=polar,horizon,nadir]
// A cloned explorer compiles the baseline cloud module in place of the
// current one; reference/candidate frames alternate AB/BA on one GPU.
import {execFile,execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile,rm} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {cloudShader,buildCloudShader} from '../src/scripts/earth-clouds.ts';
import {cloudLightingShader} from '../src/scripts/cloud-lighting.ts';
const exec=promisify(execFile);
const [base='http://127.0.0.1:4391',out='/tmp/earthlight-cloud-footprint',ref='HEAD',views='polar,horizon,nadir']=process.argv.slice(2);
const pairCount=Number(process.env.FOOTPRINT_PAIRS??96);
// Stage the baseline outside src, where the dev server's watcher would
// reload the page; its relative imports point back at the working modules.
const staged=pathToFileURL(join(tmpdir(),`earth-clouds.baseline-${process.pid}.ts`));
const modules=new URL('../src/scripts/',import.meta.url).href;
await writeFile(staged,execFileSync('git',['show',`${ref}:src/scripts/earth-clouds.ts`],{encoding:'utf8'}).replaceAll("from './",`from '${modules}`));
let baselineShader;
try{({cloudShader:baselineShader}=await import(staged.href));}finally{await rm(staged);}
if(!process.env.FOOTPRINT_AA)assert.notEqual(baselineShader,cloudShader,'The working cloud shader matches the baseline');
// Frozen-source adapter for revisions predating the explicit cloud builder.
// Only the archived module needs signature matching; current GLSL is composed.
const baselineCachedCloud=source=>{
 const signature='float cloudShadow(vec3 point){';
 assert.ok(source.includes(signature),'Archived cloud shadow signature');
 assert.ok(source.includes('float cloudBaseDensity('),'Archived cloud density signature');
 return source.replace('float cloudBaseDensity(',cloudLightingShader.declarations+'\nfloat cloudBaseDensity(')
  .replace(signature,signature+cloudLightingShader.shadowPrelude);
};
const swaps=[[buildCloudShader('current',{lighting:cloudLightingShader}),baselineCachedCloud(baselineShader)],[cloudShader,baselineShader]];
const iss=(latDeg,lonDeg,headingDeg,altitude,elevation)=>{
 const r=Math.PI/180,lat=latDeg*r,lon=lonDeg*r,h=headingDeg*r;
 const n=[Math.cos(lat)*Math.cos(lon),Math.cos(lat)*Math.sin(lon),Math.sin(lat)];
 const north=[-Math.sin(lat)*Math.cos(lon),-Math.sin(lat)*Math.sin(lon),Math.cos(lat)],east=[-Math.sin(lon),Math.cos(lon),0];
 return `position=${n.map(v=>v*(1+altitude/6371)).join(',')}&heading=${north.map((v,i)=>v*Math.cos(h)+east[i]*Math.sin(h)).join(',')}&elevation=${elevation}&roll=0`;
};
const scenes={
 polar:'t=1823.83&epoch=2026-06-13T08:29:36.170Z&orbit=high&flight=free&position=0.11965373,-0.06507290,2.01408503&orientation=0.0093430278,0.0461255948,-0.5480009724,0.8351527235',
 horizon:'t=0&epoch=2026-06-13T08:29:36.170Z&flight=free&'+iss(8,86,20,420,-.33),
 nadir:'t=0&epoch=2026-06-13T08:29:36.170Z&flight=free&'+iss(8,86,20,420,-Math.PI/2),
};
let session;
const run=async(...args)=>(await exec('rtk',['proxy','agent-browser','--session',session,...args],{maxBuffer:8e6,timeout:120000})).stdout;
const evaluate=async code=>JSON.parse(await run('eval','--base64',Buffer.from(code).toString('base64')));
const evaluateTask=async code=>{
 await evaluate(`(()=>{window.footprintTask={done:false};Promise.resolve(${code}).then(value=>window.footprintTask={done:true,value},error=>window.footprintTask={done:true,error:String(error.stack??error)});return true;})()`);
 const deadline=Date.now()+600000;
 while(Date.now()<deadline){
  const task=await evaluate('window.footprintTask');
  if(!task)throw Error('Page lost the sampling task: '+JSON.stringify(await evaluate(`({href:location.href,explorers:document.querySelectorAll('earthlight-explorer').length,started:performance.timeOrigin})`)));
  if(task.done){if(task.error)throw Error(task.error);return task.value;}
  await new Promise(resolve=>setTimeout(resolve,500));
 }
 throw Error('Paired GPU sampling timed out');
};
const settled=`[...document.querySelectorAll('earthlight-explorer')].every(s=>s.dataset.focus==='sharp'&&s.dataset.assetPhase==='settled'&&s.dataset.exposure==='settled'&&Number(s.dataset.cloudLightingProgress??0)===0&&['dayTiles','nightTiles','cloudTiles','terrainTiles','galaxyTiles'].every(k=>!s.dataset[k]||JSON.parse(s.dataset[k]).pending===0))`;
const wait=async()=>{try{await run('wait','--fn',settled);}catch(e){if(!String(e.stderr).includes('Wait timed out'))throw e;await run('wait','--fn',settled);}};

await mkdir(out,{recursive:true});const results=[];
// A shared machine can close or crash the tab mid-run; retry the view.
for(const name of views.split(','))for(let attempt=1;;attempt++){
 session=`cloud-footprint-${process.pid}-${name}-${attempt}`;
 try{
  await run('set','viewport','1280','800');
  await run('open',`${base}/?${scenes[name]}&motion=0&quality=fixed&look-grain=0&exposure-mode=manual&exposure-fixed=-0.6`);await wait();
  // Both sides are fresh clones of one template, mounted in turn: the
  // reference while the baseline module is swapped in, then the candidate.
  // An A/A run against the page's own explorer showed a 10-17% bias.
  const mount=role=>evaluate(`(()=>{
   const template=window.footprintTemplate??=(()=>{const source=document.querySelector('earthlight-explorer'),copy=source.cloneNode(true);window.footprintParent=source.parentNode;source.remove();return copy;})();
   const copy=template.cloneNode(true);
   for(const k of Object.keys(copy.dataset))if(k!=='composition'&&!k.startsWith('astro'))delete copy.dataset[k];
   copy.dataset.footprintRole='${role}';
   copy.style.cssText='position:fixed;inset:0;width:100%;height:100%;';
   window.footprintParent.appendChild(copy);return true;
  })()`);
  await evaluate(`(()=>{
   const proto=WebGLRenderingContext.prototype,original=proto.shaderSource;
   window.footprintReplacements=0;window.restoreFootprint=()=>{proto.shaderSource=original;};
   proto.shaderSource=function(shader,text){
    for(const [current,baseline] of ${JSON.stringify(swaps)})if(text.includes(current)){text=text.replace(current,()=>baseline);window.footprintReplacements++;break;}
    return original.call(this,shader,text);
   };
   return true;
  })()`);
  await mount('reference');await wait();
  assert.ok(await evaluate('window.restoreFootprint();window.footprintReplacements')>0,'Baseline cloud shader must be compiled');
  await mount('candidate');await wait();
  await evaluate(`(()=>{window.footprintSeek=new WeakMap();for(const s of document.querySelectorAll('earthlight-explorer')){const input=s.querySelector('.explorer-track input');window.footprintSeek.set(s,input.value);input.dispatchEvent(new Event('input'));}return true;})()`);await wait();
  await new Promise(r=>setTimeout(r,1800));
  const result=await evaluateTask(`(async()=>{
   const skies=['reference','candidate'].map(role=>document.querySelector('earthlight-explorer[data-footprint-role='+role+']')),pairs=[];
   const measure=async s=>{
    const gl=s.querySelector('canvas').getContext('webgl'),ext=gl.getExtension('EXT_disjoint_timer_query');
    if(!ext)throw Error('Hardware GPU timer unavailable');
    const bind=gl.bindFramebuffer,draw=gl.drawArrays;let target=gl.getParameter(gl.FRAMEBUFFER_BINDING),query=null,ended=false;
    gl.bindFramebuffer=function(k,v){target=v;return bind.call(this,k,v);};
    gl.drawArrays=function(...a){if(!query){query=ext.createQueryEXT();ext.beginQueryEXT(ext.TIME_ELAPSED_EXT,query);}draw.apply(this,a);if(!ended&&target===null){ext.endQueryEXT(ext.TIME_ELAPSED_EXT);ended=true;}};
    try{
     const input=s.querySelector('.explorer-track input');input.value=window.footprintSeek.get(s);input.dispatchEvent(new Event('input'));
     const deadline=performance.now()+10000;
     while((!ended||!ext.getQueryObjectEXT(query,ext.QUERY_RESULT_AVAILABLE_EXT))&&performance.now()<deadline)await new Promise(r=>setTimeout(r,4));
     if(!ended||!ext.getQueryObjectEXT(query,ext.QUERY_RESULT_AVAILABLE_EXT))throw Error('Frame timer timeout');
     if(gl.getParameter(ext.GPU_DISJOINT_EXT)||gl.getError())throw Error('Invalid GPU measurement');
     return Number(ext.getQueryObjectEXT(query,ext.QUERY_RESULT_EXT))/1e6;
    }finally{gl.bindFramebuffer=bind;gl.drawArrays=draw;if(query){if(!ended)ext.endQueryEXT(ext.TIME_ELAPSED_EXT);ext.deleteQueryEXT(query);}}
   };
   for(let i=0;i<${8+pairCount};i++){
    let a,b;if(i%2){b=await measure(skies[1]);a=await measure(skies[0]);}else{a=await measure(skies[0]);b=await measure(skies[1]);}
    if(i>=8)pairs.push({reference:a,candidate:b,ratio:b/a});
   }
   const quantile=(a,q)=>[...a].sort((x,y)=>x-y)[Math.floor(a.length*q)];
   const ratios=pairs.map(p=>p.ratio);
   // Contention from other GPU clients only adds time; the fastest decile
   // of each side is the least disturbed estimate on a shared machine.
   const fastest=side=>quantile(pairs.map(p=>p[side]),.1);
   return {referenceMs:quantile(pairs.map(p=>p.reference),.5),candidateMs:quantile(pairs.map(p=>p.candidate),.5),pairedRatio:quantile(ratios,.5),ratioQuartiles:[quantile(ratios,.25),quantile(ratios,.75)],fastestRatio:fastest('candidate')/fastest('reference'),pairs};
  })()`);
  results.push({view:name,...result});
  console.log(name,JSON.stringify({referenceMs:+result.referenceMs.toFixed(2),candidateMs:+result.candidateMs.toFixed(2),pairedRatio:+result.pairedRatio.toFixed(3),ratioQuartiles:result.ratioQuartiles.map(v=>+v.toFixed(3)),fastestRatio:+result.fastestRatio.toFixed(3)}));
  break;
 }catch(error){if(attempt>=3)throw error;console.warn(name,'attempt',attempt,'failed:',error.message);}
 finally{try{await run('close');}catch{}}
}
await writeFile(`${out}/cloud-footprint-timing.json`,JSON.stringify({ref,date:new Date().toISOString(),results},null,1));
