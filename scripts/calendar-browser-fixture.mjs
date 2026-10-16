import assert from 'node:assert/strict';

export async function verifyCalendar({run,evaluate,wait,base}){
 await run('open',`${base}/?t=1000&motion=0&epoch=2028-02-28T00:00:00Z`);
 await wait("document.querySelector('earthlight-explorer').dataset.focus==='sharp'");
 const read=()=>evaluate(`(()=>{const e=document.querySelector('earthlight-explorer');return {position:e.dataset.cameraPosition,basis:e.dataset.cameraBasis,sun:JSON.parse(e.dataset.sun),date:e.querySelector('time').dateTime,phase:e.dataset.moonPhase,url:location.search};})()`);
 const initial=await read();
 const set=async(id,value)=>{await evaluate(`(()=>{const e=document.querySelector('#explorer-${id}');e.value='${value}';e.dispatchEvent(new Event('input'));return true;})()`);await run('wait','150');};
 await set('time',720);const noon=await read();
 assert.equal(noon.date,'2028-02-28T12:00:00.000Z');
 assert.equal(noon.position,initial.position);assert.equal(noon.basis,initial.basis);
 assert.ok(noon.sun.reduce((s,v,i)=>s+v*initial.sun[i],0)<-.7);
 await set('date',59);const leap=await read();assert.equal(leap.date,'2028-02-29T12:00:00.000Z');
 assert.notEqual(leap.phase,noon.phase);assert.equal(leap.position,initial.position);
 await run('reload');await wait("document.querySelector('earthlight-explorer').dataset.focus==='sharp'");
 const restored=await read();assert.equal(restored.date,leap.date);assert.equal(restored.position,leap.position);
 await evaluate("document.querySelector('.reset-all').click();true");await run('wait','150');
 const reset=await read();assert.ok(Math.abs(Date.parse(reset.date)-Date.now())<30000);
 // A fresh link with no valid calendar starts at real wall time, even with a orbit offset.
 await run('open',`${base}/?t=5928&motion=0&epoch=`);
 await wait("document.querySelector('earthlight-explorer').dataset.focus==='sharp'");
 const fresh=await read();assert.ok(Math.abs(Date.parse(fresh.date)-Date.now())<30000);
 return {date:leap.date,restored:restored.date,default:fresh.date,cameraUnchanged:true};
}
