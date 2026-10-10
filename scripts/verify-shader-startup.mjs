// bun scripts/verify-shader-startup.mjs http://127.0.0.1:4347 /tmp/shader-startup [webgl1|webgl2]
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

const exec=promisify(execFile);
const [base='http://127.0.0.1:4347',out='/tmp/shader-startup',api='webgl1']=process.argv.slice(2);
const session=`shader-startup-${process.pid}`;
const run=async(...args)=>(await exec('rtk',['proxy','agent-browser','--session',session,...args],{timeout:90000,maxBuffer:8e6,env:{...process.env,AGENT_BROWSER_DEFAULT_TIMEOUT:'60000'}})).stdout;
const evaluate=async code=>JSON.parse(await run('eval','--base64',Buffer.from(code).toString('base64')));
const wait=condition=>run('wait','--fn',condition);
const settled="document.querySelector('orbital-sky')?.dataset.shaderStartup==='ready'&&document.querySelector('orbital-sky').dataset.focus==='sharp'&&document.querySelector('orbital-sky').dataset.assetPhase==='settled'";
const url=new URL('/?motion=0&t=3235.65&epoch=2026-10-06T01:32:27Z',base);url.searchParams.set('api',api);
const open=async()=>{await run('open',url.href);await wait(settled);};
const read=()=>evaluate(`(()=>{const s=document.querySelector('orbital-sky'),c=s?.querySelector('canvas'),gl=window.__startupGL;return {state:s?{...s.dataset}:null,ready:s?.hasAttribute('data-ready'),canvasOpacity:c?getComputedStyle(c).opacity:null,fallbackOpacity:s?getComputedStyle(s.querySelector('.sky-fallback')).opacity:null,error:gl?.getError(),probe:window.__startupProbe};})()`);
const clone=mode=>evaluate(`(()=>{
 const previous=document.querySelector('orbital-sky'),copy=previous.cloneNode(true),getContext=HTMLCanvasElement.prototype.getContext;
 for(const key of Object.keys(copy.dataset))if(key!=='composition'&&!key.startsWith('astro'))delete copy.dataset[key];
 const probe=window.__startupProbe={mode:${JSON.stringify(mode)},gate:${JSON.stringify(mode)}!=='hold',events:[],polls:0,blockingQueries:0,shaderQueries:0,premature:[],injected:0,fetches:0};
 const fetch=window.fetch.bind(window);window.fetch=(...args)=>{probe.fetches++;return fetch(...args);};
 HTMLCanvasElement.prototype.getContext=function(...args){
  const gl=getContext.apply(this,args);if(!['webgl','webgl2'].includes(args[0])||!gl)return gl;
  window.__startupGL=gl;
  const getExtension=gl.getExtension.bind(gl),extension=getExtension('KHR_parallel_shader_compile');
  if(!extension&&probe.mode==='hold')throw Error('KHR_parallel_shader_compile is unavailable on this browser');
  const getProgram=gl.getProgramParameter.bind(gl),getShader=gl.getShaderParameter.bind(gl),link=gl.linkProgram.bind(gl),compile=gl.compileShader.bind(gl),shaderSource=gl.shaderSource.bind(gl),createShader=gl.createShader.bind(gl);
  const shaderTypes=new WeakMap();
  gl.createShader=type=>{const shader=createShader(type);if(shader)shaderTypes.set(shader,type);return shader;};
  gl.getExtension=name=>name==='KHR_parallel_shader_compile'&&probe.mode==='no-extension'?null:getExtension(name);
  gl.compileShader=shader=>{probe.events.push('compile');return compile(shader);};
  gl.linkProgram=program=>{probe.events.push('link');return link(program);};
  gl.shaderSource=(shader,text)=>{
   if(probe.mode==='failure'&&!probe.injected&&shaderTypes.get(shader)===gl.FRAGMENT_SHADER){probe.injected++;text+='\\nintentionalStartupCompileFailure\\n';}
   return shaderSource(shader,text);
  };
  gl.getProgramParameter=(program,kind)=>{
   if(extension&&kind===extension.COMPLETION_STATUS_KHR){probe.polls++;if(!probe.gate)return false;}
   if(kind===gl.LINK_STATUS){probe.blockingQueries++;if(!probe.gate)probe.premature.push('LINK_STATUS');}
   return getProgram(program,kind);
  };
  gl.getShaderParameter=(shader,kind)=>{if(kind===gl.COMPILE_STATUS){probe.shaderQueries++;if(!probe.gate)probe.premature.push('COMPILE_STATUS');}return getShader(shader,kind);};
  for(const method of ['getUniformLocation','getAttribLocation','useProgram']){
   const original=gl[method].bind(gl);gl[method]=(...values)=>{if(!probe.gate)probe.premature.push(method);return original(...values);};
  }
  return gl;
 };
 try{previous.replaceWith(copy);}finally{HTMLCanvasElement.prototype.getContext=getContext;}
 return true;
})()`);
const checkBatch=probe=>{
 const firstLink=probe.events.indexOf('link'),lastCompile=probe.events.lastIndexOf('compile');
 assert.ok(firstLink>lastCompile,'Every shader is submitted before the first link');
 assert.ok(firstLink>=5&&probe.events.filter(event=>event==='link').length>=5,'Scene and helper programs share the batch');
 assert.deepEqual(probe.premature,[]);
};
const results={api,launchArgs:process.env.AGENT_BROWSER_ARGS??''};
await mkdir(out,{recursive:true});
try{
 console.log(`${api}: initial load`);
 await run('set','viewport','960','640');await open();
 results.userAgent=await evaluate('navigator.userAgent');
 console.log(`${api}: held completion and poster`);await clone('hold');await wait('window.__startupProbe.polls>0');
 const frames=await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(2))))');
 results.pending=await read();checkBatch(results.pending.probe);
 assert.equal(results.pending.state.renderApi,api==='webgl2'?'webgl2':'webgl');
 assert.equal(frames,2);assert.equal(results.pending.state.shaderStartup,'compiling');
 assert.equal(results.pending.ready,false);assert.equal(results.pending.canvasOpacity,'0');assert.equal(results.pending.fallbackOpacity,'1');
 assert.equal(results.pending.probe.blockingQueries,0);assert.equal(results.pending.probe.shaderQueries,0);assert.equal(results.pending.probe.fetches,0);
 await run('screenshot',`${out}/pending-poster.png`);
 await evaluate('window.__startupProbe.gate=true');await wait(settled);
 results.parallel=await read();assert.equal(results.parallel.error,0);assert.equal(results.parallel.state.shaderMode,'parallel');
 assert.equal(results.parallel.probe.shaderQueries,0);assert.ok(Number(results.parallel.state.shaderCompileMs)>0);checkBatch(results.parallel.probe);

 console.log(`${api}: extension fallback`);await open();await clone('no-extension');await wait(settled);
 results.synchronous=await read();assert.equal(results.synchronous.state.shaderMode,'synchronous');assert.equal(results.synchronous.error,0);
 assert.equal(results.synchronous.probe.polls,0);checkBatch(results.synchronous.probe);

 console.log(`${api}: loss during first compilation`);await open();await clone('hold');await wait('window.__startupProbe.polls>0');
 await evaluate(`(async()=>{const gl=window.__startupGL,c=gl.canvas,ext=gl.getExtension('WEBGL_lose_context');if(!ext)throw Error('Context loss extension missing');window.__startupLossExtension=ext;const lost=new Promise(resolve=>c.addEventListener('webglcontextlost',resolve,{once:true}));ext.loseContext();await lost;gl.getError();return true;})()`);
 const lost=await read();assert.equal(lost.ready,false);assert.deepEqual(lost.probe.premature,[]);
 const before=lost.probe.polls;
 await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
 assert.equal((await read()).probe.polls,before,'Lost startup must stop polling');
 await evaluate(`(async()=>{window.__startupProbe.gate=true;const gl=window.__startupGL,c=gl.canvas,ext=window.__startupLossExtension;const restored=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Context restore timeout')),10000);c.addEventListener('webglcontextrestored',()=>{clearTimeout(timer);resolve(true);},{once:true});});setTimeout(()=>ext.restoreContext(),200);await restored;return true;})()`);await wait(settled);
 results.restored=await read();assert.equal(results.restored.ready,true);assert.equal(results.restored.error,0);assert.deepEqual(results.restored.probe.premature,[]);
 assert.ok(results.restored.probe.fetches>0,'Loss during first compilation must still start the initial asset plan after restore');

 // Failure after a previously ready context must replace its old "ready"
 // diagnostics while the controller still suppresses rendering during restore.
 console.log(`${api}: failed restore diagnostics`);const restoringStatus=await evaluate(`(async()=>{
  const gl=window.__startupGL,c=gl.canvas,ext=gl.getExtension('WEBGL_lose_context');
  const lost=new Promise(resolve=>c.addEventListener('webglcontextlost',resolve,{once:true}));ext.loseContext();await lost;gl.getError();
  window.__startupProbe.mode='failure';window.__startupProbe.injected=0;
  const restored=new Promise(resolve=>c.addEventListener('webglcontextrestored',()=>resolve(document.querySelector('orbital-sky').dataset.shaderStartup),{once:true}));
  setTimeout(()=>ext.restoreContext(),200);return await restored;
 })()`);
 assert.equal(restoringStatus,'compiling');
 await wait("document.querySelector('orbital-sky')?.dataset.shaderStartup==='failed'&&getComputedStyle(document.querySelector('orbital-sky canvas')).opacity==='0'");
 results.restoreFailed=await read();assert.equal(results.restoreFailed.ready,false);assert.equal(results.restoreFailed.fallbackOpacity,'1');assert.equal(results.restoreFailed.error,0);

 console.log(`${api}: dispose during compilation`);await open();await clone('hold');await wait('window.__startupProbe.polls>0');
 const removed=await evaluate(`(()=>{document.querySelector('orbital-sky').remove();return window.__startupProbe.polls;})()`);
 await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
 results.disposed=await read();assert.equal(results.disposed.probe.polls,removed);assert.deepEqual(results.disposed.probe.premature,[]);

 console.log(`${api}: compile failure poster`);await open();await clone('failure');await wait("document.querySelector('orbital-sky')?.dataset.shaderStartup==='failed'");
 results.failed=await read();assert.equal(results.failed.ready,false);assert.equal(results.failed.canvasOpacity,'0');assert.equal(results.failed.fallbackOpacity,'1');
 assert.equal(results.failed.probe.injected,1);assert.ok(results.failed.probe.shaderQueries>0);assert.equal(results.failed.error,0);
 console.log('Shader batches, pending poster, extension fallback, cancellation, restore and failure fallback passed.');
}catch(error){
 const diagnostics=await Promise.allSettled([read(),run('errors'),run('console')]);
 results.failure={message:error.message,diagnostics:diagnostics.map(result=>result.status==='fulfilled'?result.value:String(result.reason))};throw error;
}finally{
 await writeFile(`${out}/results.json`,JSON.stringify(results,null,2)+'\n');await run('close');
}
