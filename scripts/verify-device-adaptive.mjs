import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {sceneDevice} from './scene-device-driver.mjs';
const [browser='android',base='http://127.0.0.1:4347',out='/tmp/earthlight-adaptive',profile='compact']=process.argv.slice(2);
assert.ok(['reference','compact'].includes(profile));
const device=await sceneDevice(browser,base),{evaluate,navigate}=device;
await mkdir(out,{recursive:true});
try{
 await navigate(`${base}/?render=${profile}&motion=0&t=3235.65&pitch=-25&epoch=2026-10-06T01:32:27Z&look-grain=0`);
 const until=Date.now()+120000;let ready=false;
 while(Date.now()<until){
  ready=await evaluate(`(()=>{const s=document.querySelector('earthlight-explorer');return s?.dataset.exposure==='settled'&&s.dataset.assetPhase==='settled'&&s.dataset.focus==='sharp'&&['dayTiles','cloudTiles','nightTiles'].every(k=>!s.dataset[k]||JSON.parse(s.dataset[k]).pending===0)})()`);
  if(ready)break;await new Promise(r=>setTimeout(r,250));
 }
 assert.ok(ready,'Adaptive scene did not settle');
 await evaluate(`(()=>{
  window.__sceneAdaptive={done:false};
  (async()=>{
  const s=document.querySelector('earthlight-explorer'),c=s.querySelector('canvas'),g=c.getContext('webgl'),draw=g.drawArrays,bind=g.bindFramebuffer,button=s.querySelector('.explorer-motion');
  let target=g.getParameter(g.FRAMEBUFFER_BINDING),frames=0;const samples=[];
  g.bindFramebuffer=function(k,v){target=v;return bind.call(this,k,v);};g.drawArrays=function(...a){draw.apply(this,a);if(target===null)frames++;};
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  try{
   button.click();
   for(let i=0;i<6;i++){frames=0;const start=performance.now();await wait(5000);samples.push({seconds:(i+1)*5,fps:frames*1000/(performance.now()-start),scale:s.dataset.renderScale,width:c.width,height:c.height});}
   button.click();await wait(8500);frames=0;await wait(1200);
   return {samples,idleFrames:frames,error:g.getError(),profile:s.dataset.renderProfile,volume:s.dataset.volumePass,failures:s.dataset.assetFailures};
  }finally{if(button.getAttribute('aria-label')==='Pause')button.click();g.drawArrays=draw;g.bindFramebuffer=bind;}
 })().then(value=>window.__sceneAdaptive={done:true,value},error=>window.__sceneAdaptive={done:true,error:String(error)});return true;})()`);
 const completedBy=Date.now()+120000;let task;
 while(Date.now()<completedBy){task=await evaluate('window.__sceneAdaptive');if(task?.done)break;await new Promise(r=>setTimeout(r,500));}
 assert.ok(task?.done,'Adaptive measurement timed out');if(task.error)throw Error(task.error);const result=task.value;
 assert.equal(result.profile,profile);assert.equal(result.volume,profile==='compact'?'separate':'inline');assert.equal(result.error,0);assert.equal(result.failures,'0');assert.equal(result.idleFrames,0);
 await writeFile(`${out}/results.json`,JSON.stringify({browser,...result},null,2)+'\n');console.log(result);
}finally{await device.close();}
