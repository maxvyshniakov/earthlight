// Synchronized frame completion (CPU + rendering + one-pixel readback), NOT
// hardware GPU elapsed time. Both renderers retain resources; alternate AB/BA.
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {sceneDevice} from './scene-device-driver.mjs';
const [browser='safari-mcp',base='http://127.0.0.1:4347',out='/tmp/earthlight-device-pairs',views='day,night,clouds']=process.argv.slice(2);
const device=await sceneDevice(browser,base),{evaluate,navigate}=device;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const wait=async count=>{
 const until=Date.now()+120000;
 while(Date.now()<until){
  const ready=await evaluate(`(()=>{const skies=[...document.querySelectorAll('earthlight-explorer')];return skies.length===${count}&&skies.every(s=>s.dataset.assetPhase==='settled'&&s.dataset.focus==='sharp'&&s.dataset.exposure==='settled'&&['dayTiles','nightTiles','cloudTiles'].every(k=>!s.dataset[k]||JSON.parse(s.dataset[k]).pending===0))})()`);
  if(ready)return;await sleep(250);
 }throw Error('Scene settlement timed out');
};
await mkdir(out,{recursive:true});const results={browser,method:'CPU + GPU + one-pixel synchronous readback; two retained renderers, alternating AB/BA, eight warmup pairs then 32 measured pairs',scenes:[]};
try{
 for(const scene of [{name:'day',t:3235.65,pitch:0},{name:'night',t:610.87,pitch:0},{name:'clouds',t:3235.65,pitch:-25}].filter(s=>views.split(',').includes(s.name))){
  await navigate(`${base}/?render=reference&motion=0&quality=fixed&t=${scene.t}&pitch=${scene.pitch}&epoch=2026-10-06T01:32:27Z&look-grain=0`);await wait(1);
  await evaluate(`(()=>{const s=document.querySelector('earthlight-explorer'),c=s.cloneNode(true);const u=new URL(location.href);u.searchParams.set('render','compact');history.replaceState(null,'',u);for(const k of Object.keys(c.dataset))if(k!=='composition'&&!k.startsWith('astro'))delete c.dataset[k];c.style.cssText='position:fixed;inset:0;z-index:20;';s.parentNode.append(c);return true;})()`);await wait(2);
  const result=await evaluate(`(async()=>{
   const skies=[...document.querySelectorAll('earthlight-explorer')],pairs=[];
   const states=skies.map(s=>{const c=s.querySelector('canvas');return {profile:s.dataset.renderProfile,volume:s.dataset.volumePass,width:c.width,height:c.height,position:s.dataset.cameraPosition,basis:s.dataset.cameraBasis,failures:s.dataset.assetFailures};});
   const measure=s=>new Promise((resolve,reject)=>{
    const gl=s.querySelector('canvas').getContext('webgl'),bind=gl.bindFramebuffer,draw=gl.drawArrays,pixel=new Uint8Array(4);
    let target=gl.getParameter(gl.FRAMEBUFFER_BINDING),start=null;
    const restore=()=>{gl.bindFramebuffer=bind;gl.drawArrays=draw;};
    const timeout=setTimeout(()=>{restore();reject(Error('Frame timeout'));},10000);
    gl.bindFramebuffer=function(k,v){target=v;return bind.call(this,k,v);};
    gl.drawArrays=function(...a){
     if(start===null){gl.finish();start=performance.now();}
     draw.apply(this,a);
     if(target===null){gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);const elapsed=performance.now()-start,error=gl.getError();clearTimeout(timeout);restore();error?reject(Error('WebGL '+error)):resolve(elapsed);}
    };
    s.querySelector('[data-look=grain]').dispatchEvent(new Event('input'));
   });
   for(let i=0;i<40;i++){
    let reference,compact;if(i%2){compact=await measure(skies[1]);reference=await measure(skies[0]);}else{reference=await measure(skies[0]);compact=await measure(skies[1]);}
    if(i>=8)pairs.push({reference,compact,ratio:compact/reference});
   }
   const median=a=>a.sort((a,b)=>a-b)[Math.floor(a.length/2)];
   return {states,pairs,referenceMs:median(pairs.map(p=>p.reference)),compactMs:median(pairs.map(p=>p.compact)),ratio:median(pairs.map(p=>p.ratio))};
  })()`);
  assert.deepEqual(result.states.map(s=>s.profile),['reference','compact']);assert.equal(result.states[1].volume,'separate');
  for(const k of ['width','height','position','basis'])assert.equal(result.states[0][k],result.states[1][k]);assert.ok(result.states.every(s=>s.failures==='0'));
  results.scenes.push({scene:scene.name,...result});await writeFile(`${out}/results.json`,JSON.stringify(results,null,2)+'\n');console.log({scene:scene.name,reference:result.referenceMs,compact:result.compactMs,ratio:result.ratio});
 }
 // Check the selected renderer on its own after the paired measurements.
 await evaluate(`(()=>{document.querySelector('earthlight-explorer').remove();return true;})()`);
 const before=await evaluate(`document.querySelector('earthlight-explorer').dataset.cameraBasis`);
 if(device.touchDrag){
  const {w,h}=await evaluate(`({w:innerWidth,h:innerHeight})`);
  await device.touchDrag(w*.5,h*.5,55,25);await sleep(250);
  results.touchChangedCamera=before!==await evaluate(`document.querySelector('earthlight-explorer').dataset.cameraBasis`);
  assert.equal(results.touchChangedCamera,true);
 }else{
  await evaluate(`(()=>{const i=document.querySelector('[data-view=yaw]');i.value='12';i.dispatchEvent(new Event('input'));return true;})()`);await sleep(250);
  results.controlChangedCamera=before!==await evaluate(`document.querySelector('earthlight-explorer').dataset.cameraBasis`);
  assert.equal(results.controlChangedCamera,true);
 }
 await wait(1);
 const pose=await evaluate(`document.querySelector('earthlight-explorer').dataset.cameraBasis`);
 await evaluate(`(async()=>{const c=document.querySelector('canvas'),g=c.getContext('webgl'),e=g.getExtension('WEBGL_lose_context');const lost=new Promise(r=>c.addEventListener('webglcontextlost',r,{once:true}));e.loseContext();await lost;g.getError();const restored=new Promise(r=>c.addEventListener('webglcontextrestored',r,{once:true}));setTimeout(()=>e.restoreContext(),200);await restored;return true;})()`);await wait(1);
 results.restored=await evaluate(`(()=>{const s=document.querySelector('earthlight-explorer');return {profile:s.dataset.renderProfile,volume:s.dataset.volumePass,failures:s.dataset.assetFailures,basis:s.dataset.cameraBasis,error:s.querySelector('canvas').getContext('webgl').getError()};})()`);
 assert.equal(results.restored.profile,'compact');assert.equal(results.restored.volume,'separate');assert.equal(results.restored.failures,'0');assert.equal(results.restored.error,0);assert.equal(results.restored.basis,pose);
 await writeFile(`${out}/results.json`,JSON.stringify(results,null,2)+'\n');console.log('Input and context restoration passed');
}finally{await device.close();}
