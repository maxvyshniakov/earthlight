// Full scene A/B/A at fixed camera, light, exposure and pixel budget.
import assert from 'node:assert/strict';
import {modisStudyURL} from '../src/scripts/modis-study-view.ts';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile} from 'node:fs/promises';
import {sceneDevice} from './scene-device-driver.mjs';
const [base='http://127.0.0.1:4322',out='/tmp/modis-patch',device='desktop']=process.argv.slice(2);
await mkdir(out,{recursive:true});
let evaluate,navigate,close;
if(device==='android')({evaluate,navigate,close}=await sceneDevice('android',base));
else{
 const exec=promisify(execFile),session='modis-patch-'+process.pid;
 const run=async(...a)=>(await exec('rtk',['proxy','agent-browser','--session',session,...a],{timeout:120000,maxBuffer:32e6})).stdout;
 evaluate=async code=>JSON.parse(await run('eval','--base64',Buffer.from(code).toString('base64')));
 navigate=url=>run('open',url);close=()=>run('close');await run('set','viewport','1200','800');
}
const results=[];
const wait=async()=>{
 const deadline=Date.now()+120000;
 while(Date.now()<deadline){
  if(await evaluate(`(()=>{const s=document.querySelector('earthlight-explorer');return s?.hasAttribute('data-ready')&&s.dataset.focus==='sharp'&&s.dataset.exposure==='settled'&&s.dataset.assetPhase==='settled'&&['dayTiles','cloudTiles','nightTiles','terrainTiles','galaxyTiles'].every(k=>!s.dataset[k]||JSON.parse(s.dataset[k]).pending===0)})()`))return;
  await new Promise(r=>setTimeout(r,500));
 }throw Error('Scene did not settle');
};
try{
 for(const scene of ['day','low','oblique'].map(name=>({name})).filter(s=>!process.env.CLOUD_CASES||process.env.CLOUD_CASES.split(',').includes(s.name))){
  const frames=[];
  for(const variant of (process.env.CLOUD_VARIANTS?.split(',')??['photo','modis','control'])){
   console.log(scene.name,variant);
   const u=modisStudyURL(base,scene.name,variant==='modis'?'modis':'photo');u.searchParams.set('api','webgl');u.searchParams.set('quality','fixed');
   await navigate(u.href);await wait();
   const frame=await evaluate(`(async()=>{
    const s=document.querySelector('earthlight-explorer'),c=s.querySelector('canvas'),gl=c.getContext('webgl');
    const ext=gl.getExtension('EXT_disjoint_timer_query'),debug=gl.getExtension('WEBGL_debug_renderer_info');
    const bind=gl.bindFramebuffer,draw=gl.drawArrays;let target=gl.getParameter(gl.FRAMEBUFFER_BINDING),pending=null,query=null,started=false;
    gl.bindFramebuffer=function(k,v){target=v;return bind.call(this,k,v);};
    gl.drawArrays=function(...args){
     if(pending&&!started){if(ext)ext.beginQueryEXT(ext.TIME_ELAPSED_EXT,query);started=true;}
     draw.apply(this,args);
     if(pending&&target===null){if(ext)ext.endQueryEXT(ext.TIME_ELAPSED_EXT);const done=pending;pending=null;done(c.toDataURL());}
    };
    const samples=[];let png;
    try{for(let i=0;i<10;i++){
     query=ext?ext.createQueryEXT():null;started=false;
     const start=performance.now();
     png=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Render timeout')),20000);pending=p=>{clearTimeout(timer);resolve(p);};s.querySelector('[data-look="grain"]').dispatchEvent(new Event('input'));});
     const wallMs=performance.now()-start;
     if(ext){const end=performance.now()+10000;while(!ext.getQueryObjectEXT(query,ext.QUERY_RESULT_AVAILABLE_EXT)){if(performance.now()>end)throw Error('GPU timeout');await new Promise(r=>setTimeout(r,10));}if(gl.getParameter(ext.GPU_DISJOINT_EXT))throw Error('Disjoint GPU');}
     const gpuMs=ext?ext.getQueryObjectEXT(query,ext.QUERY_RESULT_EXT)/1e6:null;if(ext)ext.deleteQueryEXT(query);
     if(i>=2)samples.push({gpuMs,wallMs});
    }}finally{gl.bindFramebuffer=bind;gl.drawArrays=draw;}
    return {png,samples,width:c.width,height:c.height,data:{...s.dataset},renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),error:gl.getError()};
   })()`);
   assert.equal(frame.error,0);assert.equal(frame.data.cloudStudy,variant==='modis'?'modis':'photo');assert.equal(frame.data.modisReady,'1');assert.equal(frame.data.assetFailures,'0');
   await writeFile(out+'/'+scene.name+'-'+variant+'.png',Buffer.from(frame.png.split(',')[1],'base64'));delete frame.png;
   const gpu=frame.samples.map(s=>s.gpuMs).filter(x=>x!==null).sort((a,b)=>a-b);frame.medianGpuMs=gpu.length?(gpu[3]+gpu[4])/2:null;
   if(device==='android')frame.cadence=await evaluate(`(async()=>{
    const s=document.querySelector('earthlight-explorer'),c=s.querySelector('canvas'),gl=c.getContext('webgl'),bind=gl.bindFramebuffer,draw=gl.drawArrays;
    let target=gl.getParameter(gl.FRAMEBUFFER_BINDING);const frames=[],start=performance.now();
    gl.bindFramebuffer=function(k,v){target=v;return bind.call(this,k,v);};
    gl.drawArrays=function(...a){draw.apply(this,a);if(target===null&&performance.now()-start>2000)frames.push({t:performance.now(),width:c.width,height:c.height});};
    try{s.querySelector('.explorer-motion').click();await new Promise(r=>setTimeout(r,8000));s.querySelector('.explorer-motion').click();}
    finally{gl.bindFramebuffer=bind;gl.drawArrays=draw;}
    const intervals=frames.slice(1).map((f,i)=>f.t-frames[i].t),sorted=[...intervals].sort((a,b)=>a-b);
    return {fps:intervals.length*1000/intervals.reduce((a,b)=>a+b,0),p90Ms:sorted[Math.floor(sorted.length*.9)],frames:frames.length,sizes:[...new Set(frames.map(f=>f.width+'x'+f.height))],scope:'Animation cadence without readback; fixed quality, two second warmup, six second sample. Not a thermal endurance test.'};
   })()`);
   if(frame.cadence)assert.ok(frame.cadence.frames>2&&Number.isFinite(frame.cadence.fps),'Insufficient animation samples');
   frames.push({variant,url:u.href,...frame});
  }
  for(const f of frames){assert.equal(f.width,frames[0].width);assert.equal(f.height,frames[0].height);assert.equal(f.data.cameraBasis,frames[0].data.cameraBasis);assert.equal(f.data.cameraPosition,frames[0].data.cameraPosition);}
  results.push({scene,device,frames});await writeFile(out+'/results.json',JSON.stringify(results,null,2));
  console.log('RESULT',scene.name,frames.map(f=>({variant:f.variant,ms:f.medianGpuMs,size:[f.width,f.height]})));
 }
}finally{await close();}
