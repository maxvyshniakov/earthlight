// bun scripts/verify-half-clouds.mjs http://127.0.0.1:4347 /tmp/earthlight-half-clouds
// Image metrics are observations, not an acceptance threshold for this prototype.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {ISS_PERIOD_SECONDS} from '../src/scripts/iss-orbit.ts';

const exec=promisify(execFile);
const [base='http://127.0.0.1:4347',out='/tmp/earthlight-half-clouds']=process.argv.slice(2);
const session=`half-clouds-${process.pid}`;
const run=async(...args)=>(await exec('rtk',['proxy','agent-browser','--session',session,...args],{timeout:90000,maxBuffer:80e6,env:{...process.env,AGENT_BROWSER_DEFAULT_TIMEOUT:'60000'}})).stdout;
const evaluate=async code=>JSON.parse(await run('eval','--base64',Buffer.from(code).toString('base64')));
let expectedProfile='',stage='starting',lastStageAt=Date.now();
const stages=[];
const mark=value=>{
 const now=Date.now();stages.push({stage,elapsedMs:now-lastStageAt});lastStageAt=now;stage=value;
 console.log(`[${new Date(now).toISOString()}] ${value}`);
};
const condition=`(()=>{const s=document.querySelector('earthlight-explorer');return s?.hasAttribute('data-ready')&&s.dataset.focus==='sharp'&&s.dataset.exposure==='settled'&&s.dataset.assetPhase==='settled'&&['dayTiles','cloudTiles','nightTiles','terrainTiles','galaxyTiles'].every(k=>!s.dataset[k]||JSON.parse(s.dataset[k]).pending===0)})()`;
const identity=()=>`location.pathname==='/'&&document.querySelector('earthlight-explorer')?.dataset.renderProfile===${JSON.stringify(expectedProfile)}&&new URL(location.href).searchParams.get('render')===${JSON.stringify(expectedProfile)}&&Date.parse(new URL(location.href).searchParams.get('epoch'))===Date.parse('2026-10-06T01:32:27Z')`;
const wait=()=>run('wait','--fn',`(${identity()})&&(${condition})`);
const state=async()=>{
 const value=await evaluate(`(()=>{const s=document.querySelector('earthlight-explorer');if(!s)throw Error('Missing scene at '+location.href+' title='+document.title);const c=s.querySelector('canvas'),gl=c.getContext('webgl');return {url:location.href,profile:s.dataset.renderProfile,cloudPass:s.dataset.cloudPass,cloudBuffer:s.dataset.cloudBuffer,volumePass:s.dataset.volumePass,width:c.width,height:c.height,position:s.dataset.cameraPosition,basis:s.dataset.cameraBasis,assetFailures:s.dataset.assetFailures,error:gl.getError()};})()`);
 assert.equal(value.profile,expectedProfile);assert.equal(new URL(value.url).searchParams.get('render'),expectedProfile);
 assert.equal(Date.parse(new URL(value.url).searchParams.get('epoch')),Date.parse('2026-10-06T01:32:27Z'));
 return value;
};
const checkHalf=s=>{
 assert.equal(s.profile,'clouds-half');assert.equal(s.cloudPass,'half');assert.equal(s.error,0);
 assert.equal(s.cloudBuffer,`${Math.ceil(s.width/2)}x${Math.ceil(s.height/2)}`);
};
const scenes=[
 {name:'day',t:3235.65,pitch:0},{name:'night',t:610.87,pitch:0},
 {name:'clouds',t:3235.65,pitch:-25},{name:'horizon',t:3235.65,pitch:5},
 // At this epoch the observer crosses dawn near t=1900 (solar dot ≈ -0.003).
 {name:'terminator',t:1900,pitch:-5},
 ...(process.env.HALF_CLOUD_MOON==='1'?[{name:'moon',t:1338.89,pitch:0}]:[]),
];
const open=async(profile,scene)=>{
 expectedProfile=profile;mark(`open ${scene.name}/${profile}`);
 const url=new URL('/',base);
 for(const [key,value] of Object.entries({api:'webgl',render:profile,quality:'fixed',motion:'0',t:scene.t,pitch:scene.pitch,epoch:'2026-10-06T01:32:27Z','look-grain':0,'exposure-mode':'manual','exposure-fixed':0}))url.searchParams.set(key,String(value));
 await run('open',url.href);
 mark(`wait ${scene.name}/${profile}`);await wait();
 assert.equal(await evaluate('location.href'),url.href,'Settled scene must retain the requested initial URL');
};
const capture=async(t,count)=>evaluate(`(async()=>{
 const s=document.querySelector('earthlight-explorer'),c=s.querySelector('canvas'),input=s.querySelector('.explorer-track input');
 const gl=c.getContext('webgl'),bind=gl.bindFramebuffer,draw=gl.drawArrays,step=input.step;
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
const results={conditions:{viewport:[1440,900],exposureEV:0,grain:0,routeRate:10,frameStepSeconds:10/24,quality:'fixed',metricUnits:'8-bit RGB channel values',acceptanceThresholds:null,launchArgs:process.env.AGENT_BROWSER_ARGS??''},stages,images:[],lifecycle:{},fallbacks:{}};
await mkdir(out,{recursive:true});
try{
 await run('set','viewport','1440','900');
 results.conditions.userAgent=await evaluate('navigator.userAgent');
 for(const scene of scenes){
  const captures={},pixels={};
  for(const profile of ['compact','clouds-half']){
   await open(profile,scene);
   const before=await state();assert.equal(before.error,0);assert.equal(before.assetFailures,'0');
   if(profile==='clouds-half')checkHalf(before);
   const count=scene.name==='clouds'?8:1;
   mark(`capture ${scene.name}/${profile} (${count} frames)`);
   captures[profile]=await capture(scene.t,count);
   captures[profile].state=before;
   pixels[profile]=await decode(captures[profile],`${scene.name}-${profile}`);
  }
  const a=captures.compact,b=captures['clouds-half'];
  assert.equal(a.width,b.width);assert.equal(a.height,b.height);assert.deepEqual(a.poses,b.poses);
  if(scene.name==='clouds')assert.equal(new Set(a.poses).size,8,'Motion samples advance the observer');
  const measured=metrics(pixels.compact,pixels['clouds-half']);
  results.images.push({scene:scene.name,frames:a.frames.length,width:a.width,height:a.height,compact:a.state,half:b.state,...measured});
  console.log(scene.name,measured);
  await writeFile(`${out}/results.json`,JSON.stringify(results,null,2)+'\n');
 }

 mark('lifecycle resize');await run('set','viewport','801','601');
 await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');await wait();
 results.lifecycle.resized=await state();checkHalf(results.lifecycle.resized);
 mark('lifecycle context loss/restore');await evaluate(`(async()=>{
  const c=document.querySelector('earthlight-explorer canvas'),gl=c.getContext('webgl'),ext=gl.getExtension('WEBGL_lose_context');
  if(!ext)throw Error('Context-loss test extension unavailable');
  const lost=new Promise(resolve=>c.addEventListener('webglcontextlost',resolve,{once:true}));ext.loseContext();await lost;gl.getError();
  const restored=new Promise(resolve=>c.addEventListener('webglcontextrestored',resolve,{once:true}));setTimeout(()=>ext.restoreContext(),200);await restored;return true;
 })()`);await wait();
 results.lifecycle.restored=await state();checkHalf(results.lifecycle.restored);
 assert.equal(results.lifecycle.restored.width,results.lifecycle.resized.width);
 assert.equal(results.lifecycle.restored.height,results.lifecycle.resized.height);

 for(const mode of ['extension','framebuffer','runtime-framebuffer','shader']){
  await open('clouds-half',scenes[2]);
  mark(`fallback ${mode}`);
  await evaluate(`(()=>{
   const original=document.querySelector('earthlight-explorer'),copy=original.cloneNode(true),getContext=HTMLCanvasElement.prototype.getContext;
   for(const key of Object.keys(copy.dataset))if(key!=='composition'&&!key.startsWith('astro'))delete copy.dataset[key];
   window.__halfCloudProbe={mode:${JSON.stringify(mode)},hits:0};
   HTMLCanvasElement.prototype.getContext=function(...args){
    const gl=getContext.apply(this,args);if(args[0]!=='webgl'||!gl)return gl;
    const getExtension=gl.getExtension.bind(gl);
    if(${JSON.stringify(mode)}==='extension')gl.getExtension=name=>{if(name==='WEBGL_draw_buffers'){window.__halfCloudProbe.hits++;return null;}return getExtension(name);};
    else if(${JSON.stringify(mode)}==='shader'){
     const source=gl.shaderSource.bind(gl);
     gl.shaderSource=(shader,text)=>{
      if(text.includes('#define HALF_CLOUD_PASS 1')&&window.__halfCloudProbe.hits===0){window.__halfCloudProbe.hits++;text+='\\nintentionalHalfCloudCompileFailure\\n';}
      return source(shader,text);
     };
    }else{
     const mrt=getExtension('WEBGL_draw_buffers'),status=gl.checkFramebufferStatus.bind(gl);
     if(!mrt)throw Error('FBO fallback test needs native MRT support');
     const sizes=new WeakMap(),texImage=gl.texImage2D.bind(gl);
     gl.texImage2D=function(...args){
      const texture=gl.getParameter(gl.TEXTURE_BINDING_2D);
      if(texture&&args.length===9)sizes.set(texture,[Number(args[3]),Number(args[4])]);
      return texImage(...args);
     };
     gl.checkFramebufferStatus=target=>{
      const second=gl.getFramebufferAttachmentParameter(target,mrt.COLOR_ATTACHMENT1_WEBGL,gl.FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE);
      if(second!==gl.NONE){
       const texture=gl.getFramebufferAttachmentParameter(target,mrt.COLOR_ATTACHMENT1_WEBGL,gl.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME),size=sizes.get(texture);
       const probeSize=size?.[0]===1&&size?.[1]===1;
       if(probeSize)window.__halfCloudProbe.probePassed=status(target)===gl.FRAMEBUFFER_COMPLETE;
       if(window.__halfCloudProbe.hits===0&&(${JSON.stringify(mode)}==='framebuffer'||size&&!probeSize)){
        window.__halfCloudProbe.hits++;window.__halfCloudProbe.failedSize=size;return gl.FRAMEBUFFER_INCOMPLETE_ATTACHMENT;
       }
      }
      return status(target);
     };
    }
    return gl;
   };
   try{original.replaceWith(copy);}finally{HTMLCanvasElement.prototype.getContext=getContext;}
   return true;
  })()`);await wait();
  const fallback=await state(),probe=await evaluate('window.__halfCloudProbe');
  assert.ok(probe.hits>0,'Fallback injection must execute');assert.equal(fallback.error,0);
  if(mode==='runtime-framebuffer'){
   assert.equal(probe.probePassed,true,'Small MRT probe must succeed before full-size failure');
   assert.ok(probe.failedSize.some(value=>value>1),'Runtime failure must occur after allocating full-sized cloud attachments');
  }
  assert.equal(fallback.profile,'clouds-half');assert.equal(fallback.cloudPass,'compact-fallback');assert.equal(fallback.volumePass,'separate');
  results.fallbacks[mode]={...fallback,probe};
 }
 console.log('Half cloud dimensions, resize, context restore and capability/FBO/shader fallbacks passed. Image metrics require visual review.');
}catch(error){
 const diagnostics=await Promise.allSettled([
  evaluate(`({url:location.href,title:document.title,readyState:document.readyState,html:document.documentElement?.outerHTML.slice(0,300),scene:document.querySelector('earthlight-explorer')?.dataset})`),
  run('errors'),run('console'),
 ]);
 results.failure={stage,message:error.message,stack:error.stack,diagnostics:diagnostics.map((result,i)=>({source:['document','errors','console'][i],...(result.status==='fulfilled'?{value:result.value}:{error:String(result.reason)})}))};
 console.error(JSON.stringify(results.failure,null,2));throw error;
}finally{
 stages.push({stage,elapsedMs:Date.now()-lastStageAt});
 await writeFile(`${out}/results.json`,JSON.stringify(results,null,2)+'\n');
 await run('close');
}
