// The selected lighting path must finish in paused views and survive relighting,
// context loss and normal playback. Uses an isolated browser, not the user's tab.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const exec=promisify(execFile);
const [base='http://127.0.0.1:4339',out='/tmp/cloud-lighting-lifecycle']=process.argv.slice(2);
const session=`cloud-lighting-${process.pid}`;
const run=async(...args)=>(await exec('rtk',['proxy','agent-browser','--session',session,...args],{maxBuffer:8e6,timeout:90000})).stdout;
const evaluate=async code=>JSON.parse(await run('eval','--base64',Buffer.from(code).toString('base64')));
const wait=async condition=>{
  for(let i=0;i<4;i++)try{return await run('wait','--fn',condition);}catch(error){if(i===3||!String(error.stderr).includes('Wait timed out'))throw error;}
};
const settled="(()=>{const s=document.querySelector('earthlight-explorer');return s.hasAttribute('data-ready')&&s.dataset.focus==='sharp'&&s.dataset.assetPhase==='settled'&&s.dataset.exposure==='settled'&&s.dataset.cloudLightingReady==='1'&&s.dataset.cloudLightingProgress==='0'})()";
const state=()=>evaluate("(()=>{const s=document.querySelector('earthlight-explorer'),c=s.querySelector('canvas'),gl=c.getContext('webgl2')||c.getContext('webgl');return {api:s.dataset.renderApi,lighting:s.dataset.cloudLighting,ready:s.dataset.cloudLightingReady,generation:Number(s.dataset.cloudLightingGeneration),progress:Number(s.dataset.cloudLightingProgress),bytes:Number(s.dataset.cloudLightingBytes),failures:s.dataset.assetFailures,position:s.dataset.cameraPosition,basis:s.dataset.cameraBasis,patch:s.dataset.cloudLightingPatch,scale:s.dataset.renderScale,glError:gl.getError()}})()");
const results=[];
await mkdir(out,{recursive:true});
try{
 for(const api of ['webgl','webgl2']){
  await run('open',`${base}/?api=${api}&motion=0&quality=fixed&t=0&epoch=2026-10-10T18:57:59Z&flight=free&position=0.23110484469368825,-0.9931139034621291,0.08920775364267444&heading=0.6152058162520828,0.07264813758210914,-0.7850121347822973&elevation=-0.24434609527920614&roll=0&exposure-mode=manual&exposure-fixed=-0.5&look-grain=0`);
  await run('set','viewport','1280','860');await wait(settled);
  const initial=await state();assert.equal(initial.lighting,'texture');assert.equal(initial.bytes,16777216);assert.equal(initial.glError,0);assert.equal(initial.failures,'0');
  await run('screenshot',`${out}/${api}-initial.png`);
  await evaluate(`(()=>{
   const c=document.querySelector('canvas'),gl=c.getContext('webgl2')||c.getContext('webgl');
   const viewport=gl.viewport,draw=gl.drawArrays,ext=gl.getExtension('EXT_disjoint_timer_query');let baking=false;
   window.cloudBakeQueries=[];window.cloudDrawCount=0;window.cloudBakeExt=ext;window.cloudGL=gl;
   gl.viewport=function(x,y,w,h){baking=w===2048&&h===1024;return viewport.call(this,x,y,w,h);};
   gl.drawArrays=function(...args){
    window.cloudDrawCount++;
    if(!baking||!ext)return draw.apply(this,args);
    const query=ext.createQueryEXT();ext.beginQueryEXT(ext.TIME_ELAPSED_EXT,query);draw.apply(this,args);ext.endQueryEXT(ext.TIME_ELAPSED_EXT);window.cloudBakeQueries.push(query);
   };
   window.restoreCloudProbe=()=>{gl.viewport=viewport;gl.drawArrays=draw;};
   const input=document.querySelector('#explorer-time');input.value='1355';input.dispatchEvent(new Event('input'));return true;
  })()`);
  await wait(`Number(document.querySelector('earthlight-explorer').dataset.cloudLightingGeneration)>${initial.generation}&&${settled}`);
  const relit=await state();assert.equal(relit.position,initial.position);assert.equal(relit.basis,initial.basis);assert.equal(relit.glError,0);
  await run('screenshot',`${out}/${api}-relit.png`);
  const costs=await evaluate(`(()=>{
   const ext=window.cloudBakeExt,gl=window.cloudGL;window.restoreCloudProbe();
   if(!ext)return null;
   if(gl.getParameter(ext.GPU_DISJOINT_EXT))throw Error('Disjoint bake query');
   const samples=window.cloudBakeQueries.map(q=>{if(!ext.getQueryObjectEXT(q,ext.QUERY_RESULT_AVAILABLE_EXT))throw Error('Pending bake query');const value=Number(ext.getQueryObjectEXT(q,ext.QUERY_RESULT_EXT))/1e6;ext.deleteQueryEXT(q);return value;});
   return {count:samples.length,medianMs:[...samples].sort((a,b)=>a-b)[Math.floor(samples.length/2)],maxMs:Math.max(...samples),samples};
  })()`);
  if(costs)assert.equal(costs.count,64);
  await evaluate(`(()=>{const gl=window.cloudGL,draw=gl.drawArrays;window.idleDraws=0;gl.drawArrays=function(...args){window.idleDraws++;return draw.apply(this,args);};window.stopIdle=()=>{gl.drawArrays=draw;};return true})()`);
  await run('wait','1200');const idleDraws=await evaluate('window.idleDraws');await evaluate('window.stopIdle();true');assert.equal(idleDraws,0);
  await evaluate("(()=>{window.cloudLost=window.cloudGL.getExtension('WEBGL_lose_context');window.cloudLost.loseContext();return true})()");
  await wait("!document.querySelector('earthlight-explorer').hasAttribute('data-ready')");await evaluate('window.cloudLost.restoreContext();true');await wait(settled);
  const restored=await state();assert.equal(restored.glError,0);assert.equal(restored.ready,'1');
  await evaluate("document.querySelector('.explorer-motion').click();true");
  const moving=[];for(let i=0;i<30;i++){await run('wait','1000');moving.push(await state());if(moving.at(-1).generation>restored.generation)break;}
  await evaluate("document.querySelector('.explorer-motion').click();true");await wait(settled);
  await writeFile(`${out}/${api}-playback.json`,JSON.stringify(moving,null,2)+'\n');
  assert.ok(moving.every(s=>s.glError===0&&s.failures==='0'));
  assert.ok(moving.some(s=>s.generation>restored.generation),'playback refreshes the lighting cache');
  results.push({api,initial,relit,restored,costs,idleDraws,moving});
  await writeFile(`${out}/results.json`,JSON.stringify(results,null,2)+'\n');
  console.log(`${api}: relighting, 64-stripe bake, paused idle, context restore and playback passed${costs?`; stripe median ${costs.medianMs.toFixed(2)} ms / max ${costs.maxMs.toFixed(2)} ms`:''}`);
 }
}finally{await run('close');}
