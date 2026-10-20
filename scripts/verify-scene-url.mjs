// Run against a built preview: bun scripts/verify-scene-url.mjs http://127.0.0.1:4322
// Uses an isolated browser session and does not attach to a user's tab.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const exec=promisify(execFile);
const base=process.argv[2]??'http://127.0.0.1:4322';
const session=`scene-url-${process.pid}`;
const run=async(...args)=>(await exec('agent-browser',['--session',session,...args],{maxBuffer:2e6,timeout:90000})).stdout;
const evaluate=async js=>JSON.parse(await run('eval','--base64',Buffer.from(js).toString('base64')));
const ready=async()=>{
 await run('wait','--fn',"!!document.querySelector('earthlight-explorer[data-ready]')");
 // URL writes are batched into requestAnimationFrame; allow any pending write to run.
 await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
};
const read=()=>evaluate(`(()=>{
 const scene=document.querySelector('earthlight-explorer');
 return {url:location.href,date:scene.querySelector('time').dateTime,exposure:scene.querySelector('[data-look="exposure"]').value};
})()`);
const change=async(selector,value,event='input')=>{
 await evaluate(`(()=>{const input=document.querySelector(${JSON.stringify(selector)});input.value=${JSON.stringify(value)};input.dispatchEvent(new Event(${JSON.stringify(event)}));return true;})()`);
 await ready();
};

try{
 for(const path of ['/?motion=0','/?t=1000&motion=0']){
  const url=new URL(path,base).href;
  await run('open',url);await ready();
  const fresh=await read();
  assert.equal(fresh.url,url,'initial control setup must preserve a fresh URL');
  assert.ok(Math.abs(Date.parse(fresh.date)-Date.now())<30000,'fresh calendar starts at wall time');
 }

 // An actual user change still records the calendar and survives a reload.
 await change('[data-look="exposure"]','0.5');
 const changed=await read(),changedParams=new URL(changed.url).searchParams;
 assert.ok(Number.isFinite(Date.parse(changedParams.get('epoch'))),'user change writes a replay epoch');
 assert.equal(changedParams.get('look-exposure'),'0.5');
 await run('reload');await ready();
 const reloaded=await read();
 assert.equal(reloaded.url,changed.url);
 assert.equal(reloaded.date,changed.date);
 assert.equal(reloaded.exposure,'0.5');

 const replay=new URL('/?t=1000&motion=0&epoch=2028-02-28T00:00:00Z&exposure-mode=manual&exposure-fixed=-1',base).href;
 await run('open',replay);await ready();
 const restored=await read();
 assert.equal(restored.url,replay,'initial setup must preserve an explicit replay URL');
 assert.equal(restored.date,'2028-02-28T00:16:40.000Z');
 const manual=await evaluate(`(()=>{const scene=document.querySelector('earthlight-explorer');return {mode:scene.querySelector('#explorer-exposure-mode').value,value:scene.querySelector('#explorer-fixed-exposure').value,hidden:scene.querySelector('[data-manual-setting]').hidden};})()`);
 assert.deepEqual(manual,{mode:'manual',value:'-1',hidden:false});

 await change('#explorer-time','720');
 const noon=await read();
 assert.equal(noon.date,'2028-02-28T12:00:00.000Z');
 assert.notEqual(new URL(noon.url).searchParams.get('epoch'),'2028-02-28T00:00:00Z');
 await run('reload');await ready();
 assert.equal((await read()).date,noon.date,'calendar edits remain replayable');

 console.log(JSON.stringify({freshURLsUnchanged:true,userExposureReplay:true,explicitReplay:true,calendarEditReplay:true}));
}finally{
 await run('close');
}
