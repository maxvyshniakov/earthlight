// Production host boundaries: a passive background and an in-place night switch.
// The background fixture bundles the real element and proxies the same scene assets.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile} from 'node:fs/promises';

const [base='http://127.0.0.1:4321',out='/tmp/earthlight-host-lifecycle']=process.argv.slice(2);
const build=await Bun.build({entrypoints:['background.ts','software-probe.worker.ts'].map(name=>new URL(`../src/scripts/${name}`,import.meta.url).pathname),target:'browser',define:{'import.meta.env.DEV':'false'}});
assert.ok(build.success,build.logs.map(String).join('\n'));
const [module,probeWorker]=await Promise.all(build.outputs.map(output=>output.text()));
const html=`<!doctype html><meta charset="utf-8"><title>Background lifecycle fixture</title>
<style>body{margin:0}section{height:100vh}earthlight-background{display:contents}canvas{position:fixed;inset:0;width:100%;height:100vh;pointer-events:none}</style>
<section><earthlight-background><canvas></canvas></earthlight-background></section>
<script>
window.inputListeners=[];
const add=EventTarget.prototype.addEventListener;
EventTarget.prototype.addEventListener=function(type,...args){
 if(/^(keydown|keyup|wheel|mousedown|mousemove|mouseup|touchstart|touchmove|touchend|touchcancel|pointerdown|pointermove|pointerup|pointercancel)$/.test(type))inputListeners.push(type);
 return add.call(this,type,...args);
};
</script>
<script type="module">import {EarthlightBackground} from '/background.js';customElements.define('earthlight-background',EarthlightBackground);</script>`;
const fixture=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){
 const url=new URL(request.url);
 if(url.pathname==='/')return new Response(html,{headers:{'Content-Type':'text/html'}});
 if(url.pathname==='/background.js')return new Response(module,{headers:{'Content-Type':'text/javascript'}});
 if(url.pathname==='/software-probe.worker.ts')return new Response(probeWorker,{headers:{'Content-Type':'text/javascript'}});
 if(url.pathname.startsWith('/media/earthlight/'))return fetch(new URL(url.pathname+url.search,base),{signal:request.signal});
 return new Response('Not found',{status:404});
}});
const session=`host-lifecycle-${process.pid}`,exec=promisify(execFile);
const run=async(...args)=>(await exec('agent-browser',['--session',session,...args],{maxBuffer:8e6,timeout:90000,env:{...process.env,AGENT_BROWSER_DEFAULT_TIMEOUT:'60000'}})).stdout;
const evaluate=async js=>JSON.parse(await run('eval','--base64',Buffer.from(js).toString('base64')));
const wait=condition=>run('wait','--fn',condition);
const results={};
await mkdir(out,{recursive:true});
try{
 await run('set','viewport','1000','700');
 await run('open',`http://127.0.0.1:${fixture.port}/`);
 await wait("document.querySelector('earthlight-background')?.hasAttribute('data-ready')&&document.querySelector('earthlight-background').dataset.focus==='sharp'");
 results.background=await evaluate(`(()=>{
  const e=document.querySelector('earthlight-background'),c=e.querySelector('canvas'),gl=c.getContext('webgl2')??c.getContext('webgl');
  const wheel=new WheelEvent('wheel',{deltaY:100,bubbles:true,cancelable:true}),key=new KeyboardEvent('keydown',{code:'Space',bubbles:true,cancelable:true});
  c.dispatchEvent(wheel);window.dispatchEvent(key);
  return {listeners:inputListeners,wheel:wheel.defaultPrevented,key:key.defaultPrevented,running:e.dataset.running,frames:Number(e.dataset.frames),error:gl.getError()};
 })()`);
 assert.deepEqual(results.background.listeners,[],'background installs no navigation input handlers');
 assert.equal(results.background.wheel,false);assert.equal(results.background.key,false);
 assert.equal(results.background.running,'true');assert.ok(results.background.frames>0);assert.equal(results.background.error,0);
 results.visibility=await evaluate(`(async()=>{
  const e=document.querySelector('earthlight-background'),descriptor=Object.getOwnPropertyDescriptor(document,'hidden');
  try{
   Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));
   const before=e.dataset.frames;await new Promise(r=>setTimeout(r,250));
   return {before,after:e.dataset.frames,running:e.dataset.running};
  }finally{if(descriptor)Object.defineProperty(document,'hidden',descriptor);else delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));}
 })()`);
 assert.equal(results.visibility.before,results.visibility.after);assert.equal(results.visibility.running,'false');
 await wait("document.querySelector('earthlight-background').dataset.running==='true'");
 await evaluate(`(async()=>{
  const c=document.querySelector('canvas'),gl=c.getContext('webgl2')??c.getContext('webgl'),extension=gl.getExtension('WEBGL_lose_context');
  if(!extension)throw Error('Context loss test requires WEBGL_lose_context');
  const lost=new Promise(resolve=>c.addEventListener('webglcontextlost',resolve,{once:true}));extension.loseContext();await lost;
  window.restoreBackground=()=>extension.restoreContext();return true;
 })()`);
 assert.equal(await evaluate("document.querySelector('earthlight-background').hasAttribute('data-ready')"),false);
 await run('wait','100');await evaluate('restoreBackground();true');
 await wait("document.querySelector('earthlight-background').hasAttribute('data-ready')&&document.querySelector('earthlight-background').dataset.running==='true'");
 results.contextRestored=true;
 results.detach=await evaluate(`(async()=>{
  const e=document.querySelector('earthlight-background'),parent=e.parentElement;e.remove();
  const before=e.dataset.frames;await new Promise(r=>setTimeout(r,250));
  const result={before,after:e.dataset.frames,ready:e.hasAttribute('data-ready')};
  parent.append(e);return result;
 })()`);
 assert.equal(results.detach.before,results.detach.after);assert.equal(results.detach.ready,false);
 await wait("document.querySelector('earthlight-background').hasAttribute('data-ready')");
 results.reconnected=true;
 console.log('Background: passive input, suspension, context restoration, detach and reconnect passed');

 await run('open',`${base}/?t=1200&epoch=2026-10-06T01:32:27Z&motion=0&quality=fixed&aurora=0`);
 await wait("document.querySelector('earthlight-explorer')?.dataset.focus==='sharp'&&document.querySelector('earthlight-explorer').dataset.exposure==='settled'");
 const state=()=>evaluate(`(()=>{const e=document.querySelector('earthlight-explorer');return {position:e.dataset.cameraPosition,basis:e.dataset.cameraBasis,night:e.dataset.nightMode,url:new URL(location.href).searchParams.get('night'),paused:e.hasAttribute('data-paused'),target:e.dataset.nightTarget??null,switch:e.dataset.nightSwitch??null};})()`);
 results.before=await state();
 const night=()=>evaluate("document.querySelector('.explorer-view').focus();document.querySelector('.explorer-view').dispatchEvent(new KeyboardEvent('keydown',{code:'KeyN',bubbles:true}));true");
 await night();
 await wait("document.querySelector('earthlight-explorer').dataset.nightMode==='video'&&!document.querySelector('earthlight-explorer').dataset.nightTarget&&!document.querySelector('earthlight-explorer').dataset.nightSwitch");
 results.night=await state();
 assert.equal(results.night.url,'video');assert.equal(results.night.paused,true);
 assert.equal(results.night.position,results.before.position);assert.equal(results.night.basis,results.before.basis);
 await night();await night();await night();
 await wait("document.querySelector('earthlight-explorer').dataset.nightMode==='current'&&!document.querySelector('earthlight-explorer').dataset.nightTarget&&!document.querySelector('earthlight-explorer').dataset.nightSwitch");
 results.superseded=await state();
 assert.equal(results.superseded.url,null);assert.equal(results.superseded.paused,true);
 assert.equal(results.superseded.position,results.before.position);assert.equal(results.superseded.basis,results.before.basis);
 console.log('Explorer: night handover and superseded requests preserve camera, pause and URL');
}catch(error){results.failure={message:error.message,stack:error.stack};throw error;}
finally{await writeFile(`${out}/results.json`,JSON.stringify(results,null,2)+'\n');await run('close').catch(()=>{});fixture.stop(true);}
