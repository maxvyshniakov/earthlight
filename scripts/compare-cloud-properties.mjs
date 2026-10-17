// Measured cloud properties (cloudStudy=global) against the photographic
// plates at matched views of 22 September 2026, at a fixed pixel budget.
//   bun scripts/compare-cloud-properties.mjs http://127.0.0.1:4411 /tmp/cloud-properties
// CLOUD_VIEWS=disc,region,iss,deck and
// CLOUD_VARIANTS=global,atlas,calibrated,balanced,quality narrow the run.
// `atlas` lights the measured clouds from the cached self-shadow atlas
// (no-drift mode) instead of raymarching; the atlas covers views below about
// 1,500 km, so only the ISS and deck views use it. Frames are for viewing;
// do not commit them.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile} from 'node:fs/promises';
import {cloudPropertiesURL} from '../src/scripts/cloud-properties.ts';
const [base='http://127.0.0.1:4411',out='/tmp/cloud-properties']=process.argv.slice(2);
await mkdir(out,{recursive:true});
const exec=promisify(execFile),session='cloud-properties-'+process.pid;
const run=async(...a)=>(await exec('rtk',['proxy','agent-browser','--session',session,...a],{timeout:180000,maxBuffer:64e6})).stdout;
const evaluate=async code=>JSON.parse(await run('eval','--base64',Buffer.from(code).toString('base64')));
await run('set','viewport','1200','800');
const wait=async()=>{
 const deadline=Date.now()+180000;
 while(Date.now()<deadline){
  if(await evaluate(`(()=>{const s=document.querySelector('earthlight-explorer');return s?.hasAttribute('data-ready')&&s.dataset.focus==='sharp'&&s.dataset.exposure==='settled'&&s.dataset.assetPhase==='settled'&&(s.dataset.cloudLighting!=='texture'||s.dataset.cloudLightingReady==='1'||Math.hypot(...(new URL(location.href).searchParams.get('position')??'0').split(',').map(Number))>1.24)&&['dayTiles','cloudTiles','nightTiles','terrainTiles','galaxyTiles'].every(k=>!s.dataset[k]||JSON.parse(s.dataset[k]).pending===0)})()`))return;
  await new Promise(r=>setTimeout(r,500));
 }
 throw Error('Scene did not settle: '+JSON.stringify(await evaluate(`(()=>{const s=document.querySelector('earthlight-explorer');return {ready:s?.hasAttribute('data-ready'),focus:s?.dataset.focus,exposure:s?.dataset.exposure,assets:s?.dataset.assetPhase,startup:s?.dataset.shaderStartup}})()`)));
};
const variants={
 global:url=>url,
 atlas:url=>url,
 quality:url=>{url.searchParams.set('cloudStudyView','quality');return url;},
 calibrated:url=>{url.searchParams.delete('cloudStudy');url.searchParams.set('clouds','calibrated');return url;},
 balanced:url=>{url.searchParams.delete('cloudStudy');return url;},
};
const results=[];
try{
 for(const view of process.env.CLOUD_VIEWS?.split(',')??['disc','region','iss']){
  for(const variant of process.env.CLOUD_VARIANTS?.split(',')??['global','calibrated','balanced']){
   console.log(view,variant);
   // Every variant but `atlas` raymarches self-shadows, so plates and measured
   // clouds are lit the same way.
   const url=variants[variant](cloudPropertiesURL(base,view));
   for(const [key,value] of Object.entries({api:'webgl',quality:'fixed',cloudLighting:'raymarch','exposure-mode':'manual','exposure-fixed':'0','look-grain':'0',aurora:'0'}))url.searchParams.set(key,value);
   if(variant==='atlas')url.searchParams.delete('cloudLighting');
   await run('open',url.href);await wait();
   const frame=await evaluate(`(async()=>{
    const s=document.querySelector('earthlight-explorer'),c=s.querySelector('canvas'),gl=c.getContext('webgl');
    const ext=gl.getExtension('EXT_disjoint_timer_query');
    const bind=gl.bindFramebuffer,draw=gl.drawArrays;let target=gl.getParameter(gl.FRAMEBUFFER_BINDING),pending=null,query=null,started=false;
    gl.bindFramebuffer=function(k,v){target=v;return bind.call(this,k,v);};
    gl.drawArrays=function(...args){
     if(pending&&!started){if(ext)ext.beginQueryEXT(ext.TIME_ELAPSED_EXT,query);started=true;}
     draw.apply(this,args);
     if(pending&&target===null){if(ext)ext.endQueryEXT(ext.TIME_ELAPSED_EXT);const done=pending;pending=null;done(c.toDataURL());}
    };
    const samples=[];let png;
    try{for(let i=0;i<8;i++){
     query=ext?ext.createQueryEXT():null;started=false;
     png=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Render timeout')),30000);pending=p=>{clearTimeout(timer);resolve(p);};s.querySelector('[data-look="grain"]').dispatchEvent(new Event('input'));});
     if(ext){const end=performance.now()+10000;while(!ext.getQueryObjectEXT(query,ext.QUERY_RESULT_AVAILABLE_EXT)){if(performance.now()>end)throw Error('GPU timeout');await new Promise(r=>setTimeout(r,10));}}
     const gpuMs=ext&&!gl.getParameter(ext.GPU_DISJOINT_EXT)?ext.getQueryObjectEXT(query,ext.QUERY_RESULT_EXT)/1e6:null;if(ext)ext.deleteQueryEXT(query);
     if(i>=2)samples.push(gpuMs);
    }}finally{gl.bindFramebuffer=bind;gl.drawArrays=draw;}
    return {png,samples,width:c.width,height:c.height,cloudStudy:s.dataset.cloudStudy,cloudDate:s.dataset.cloudDate,cloudDateSource:s.dataset.cloudDateSource,clouds:s.dataset.clouds,cloudLighting:s.dataset.cloudLighting,cloudLightingReady:s.dataset.cloudLightingReady,cloudTiles:s.dataset.cloudTiles,assetBytes:s.dataset.assetBytes,assetFailures:s.dataset.assetFailures,error:gl.getError()};
   })()`);
   assert.equal(frame.error,0);assert.equal(frame.assetFailures,'0');
   assert.equal(frame.cloudStudy,['global','atlas','quality'].includes(variant)?'global':'off');
   if(frame.cloudStudy==='global')assert.deepEqual([frame.cloudDate,frame.cloudDateSource],['2026-09-22','epoch']);
   await writeFile(`${out}/${view}-${variant}.png`,Buffer.from(frame.png.split(',')[1],'base64'));delete frame.png;
   const gpu=frame.samples.filter(x=>x!==null).sort((a,b)=>a-b);frame.medianGpuMs=gpu.length?gpu[gpu.length>>1]:null;
   results.push({view,variant,...frame});console.log(JSON.stringify(results.at(-1)));
   await writeFile(out+'/results.json',JSON.stringify(results,null,2)+'\n');
  }
 }
}finally{await run('close').catch(()=>{});}
await writeFile(out+'/results.json',JSON.stringify(results,null,2)+'\n');
