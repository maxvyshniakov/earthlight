// Real renderer lifecycle proof for the opt-in ocean texture.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const exec=promisify(execFile);
const [base='http://127.0.0.1:4395',out='/tmp/ocean-lifecycle']=process.argv.slice(2);
const session=`ocean-lifecycle-${process.pid}`;
const run=async(...args)=>(await exec('rtk',['proxy','agent-browser','--session',session,...args],{maxBuffer:8e6,timeout:90000})).stdout;
const evaluate=async code=>JSON.parse(await run('eval','--base64',Buffer.from(code).toString('base64')));
const settled=`(()=>{const s=document.querySelector('orbital-sky');return s?.dataset.shaderStartup==='ready'&&s.dataset.focus==='sharp'&&s.dataset.assetPhase==='settled'&&s.dataset.ocean==='advected'&&['dayTiles','nightTiles','cloudTiles','terrainTiles'].every(k=>!s.dataset[k]||JSON.parse(s.dataset[k]).pending===0)})()`;
const wait=async()=>{try{await run('wait','--fn',settled);}catch{await run('wait','--fn',settled);}};
const inspect=()=>evaluate(`(()=>{const s=document.querySelector('orbital-sky'),c=s.querySelector('canvas'),g=c.getContext('webgl')??c.getContext('webgl2');return {state:{...s.dataset},error:g.getError(),size:[c.width,c.height]}})()`);
const results=[];await mkdir(out,{recursive:true});
try{
 await run('set','viewport','1200','800');
 for(const api of ['webgl','webgl2']){
  await run('open',base+`/?api=${api}&ocean=advected&oceanResolution=1024&render=compact&motion=0&quality=fixed&t=0&epoch=2026-10-06T01%3A32%3A27Z&flight=free&position=-1.05782,0.61073,-0.21538&heading=0,0,1&elevation=-1.57079632679&roll=0&exposure-mode=manual&exposure-fixed=0.5&look-grain=0`);await wait();
  const before=await inspect();assert.equal(before.error,0);assert.equal(before.state.oceanWidth,'1024');assert.equal(before.state.assetFailures,'0');
  await evaluate(`(()=>{const s=document.querySelector('orbital-sky'),g=s.querySelector('canvas').getContext('${api}'),ext=g.getExtension('WEBGL_lose_context');window.oceanRestore=()=>ext.restoreContext();ext.loseContext();return true})()`);
  await new Promise(r=>setTimeout(r,400));await evaluate('window.oceanRestore();true');await wait();
  const restored=await inspect();assert.equal(restored.error,0);assert.equal(restored.state.oceanWidth,'1024');assert.equal(restored.state.cameraPosition,before.state.cameraPosition);assert.equal(restored.state.cameraBasis,before.state.cameraBasis);
  await run('set','viewport','800','600');await wait();const resized=await inspect();assert.deepEqual(resized.size,[800,600]);assert.equal(resized.error,0);
  // Deliberate camera movement on the isolated page, not a user tab.
  await run('mouse','move','400','300');await run('mouse','down');await run('mouse','move','490','335');await run('mouse','up');await wait();
  const moved=await inspect();assert.equal(moved.error,0);assert.notEqual(moved.state.cameraPosition,before.state.cameraPosition);
  await run('screenshot',`${out}/${api}-after-move.png`);
  results.push({api,before,restored,resized,moved});await writeFile(`${out}/results.json`,JSON.stringify(results,null,2));
  await run('set','viewport','1200','800');console.log(`${api}: texture, context recovery, resize and camera movement passed`);
 }
}finally{await run('close');}
