// Compare API backends at fixed poses; report image differences separately from lifecycle assertions.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import sharp from 'sharp';
const exec=promisify(execFile);
const [base='http://127.0.0.1:4347',out='/tmp/earthlight-webgl2']=process.argv.slice(2);
const session=`webgl2-proof-${process.pid}`;
const run=async(...args)=>(await exec('agent-browser',['--session',session,...args],{maxBuffer:40e6,timeout:120000,env:{...process.env,AGENT_BROWSER_DEFAULT_TIMEOUT:'90000'}})).stdout;
const evaluate=async code=>JSON.parse(await run('eval','--base64',Buffer.from(code).toString('base64')));
const settled=`(()=>{const s=document.querySelector('earthlight-explorer');return s?.hasAttribute('data-ready')&&s.dataset.focus==='sharp'&&s.dataset.exposure==='settled'&&s.dataset.assetPhase==='settled'&&['dayTiles','nightTiles','cloudTiles','terrainTiles','galaxyTiles'].every(k=>!s.dataset[k]||JSON.parse(s.dataset[k]).pending===0)})()`;
const results={launchArgs:process.env.AGENT_BROWSER_ARGS??'',comparisons:[],lifecycle:{}};
const inspect=()=>evaluate(`(()=>{const s=document.querySelector('earthlight-explorer'),c=s.querySelector('canvas'),gl=c.getContext('webgl2')??c.getContext('webgl');return{api:s.dataset.renderApi,version:gl.getParameter(gl.VERSION),error:gl.getError(),width:c.width,height:c.height,profile:s.dataset.renderProfile,cloudPass:s.dataset.cloudPass,cloudBuffer:s.dataset.cloudBuffer,failures:s.dataset.assetFailures,position:s.dataset.cameraPosition,basis:s.dataset.cameraBasis};})()`);
const capture=()=>evaluate(`new Promise((resolve,reject)=>{
 const s=document.querySelector('earthlight-explorer'),c=s.querySelector('canvas'),gl=c.getContext('webgl2')??c.getContext('webgl');
 const bind=gl.bindFramebuffer,draw=gl.drawArrays;let target=gl.getParameter(gl.FRAMEBUFFER_BINDING);
 const restore=()=>{gl.bindFramebuffer=bind;gl.drawArrays=draw;};
 const timeout=setTimeout(()=>{restore();reject(Error('Capture timed out'));},15000);
 gl.bindFramebuffer=function(k,v){target=v;return bind.call(this,k,v);};
 gl.drawArrays=function(...args){draw.apply(this,args);if(target===null){clearTimeout(timeout);const png=c.toDataURL('image/png');restore();resolve(png);}};
 s.querySelector('.explorer-track input').dispatchEvent(new Event('input'));
})`);
await mkdir(out,{recursive:true});
try{
 await run('set','viewport','960','600');
 for(const scene of [{name:'day',t:3235.65,pitch:0,profile:'reference'},
  {name:'night',t:610.87,pitch:0,profile:'reference'},
  {name:'clouds',t:3235.65,pitch:-25,profile:'reference'},
  {name:'compact',t:3235.65,pitch:-25,profile:'compact'},
  {name:'half',t:3235.65,pitch:-25,profile:'clouds-half'}]){
  const captures=[];
  for(const api of ['webgl','webgl2']){
   const url=new URL('/',base);
   for(const [k,v] of Object.entries({api,render:scene.profile,t:scene.t,pitch:scene.pitch,quality:'fixed',motion:0,epoch:'2026-10-06T01:32:27Z','look-grain':0,'exposure-mode':'manual','exposure-fixed':0}))url.searchParams.set(k,String(v));
   console.log('open',scene.name,api);await run('open',url.href);await run('wait','--fn',settled);
   const state=await inspect();assert.equal(state.api,api);assert.equal(state.error,0);assert.equal(state.failures,'0');
   if(scene.profile==='clouds-half')assert.equal(state.cloudPass,'half');
   const png=Buffer.from((await capture()).split(',')[1],'base64');await writeFile(`${out}/${scene.name}-${api}.png`,png);
   captures.push({state,raw:await sharp(png).removeAlpha().raw().toBuffer()});
  }
  for(const k of ['width','height','position','basis','profile'])assert.equal(captures[0].state[k],captures[1].state[k]);
  let sum=0,max=0,overOne=0;const a=captures[0].raw,b=captures[1].raw;assert.equal(a.length,b.length);
  for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]);sum+=d;max=Math.max(max,d);if(d>1)overOne++;}
  const comparison={scene:scene.name,webgl:captures[0].state,webgl2:captures[1].state,mean:sum/a.length,max,fractionOverOne:overOne/a.length};
  results.comparisons.push(comparison);console.log(comparison);await writeFile(`${out}/results.json`,JSON.stringify(results,null,2)+'\n');
 }
 await run('set','viewport','801','601');await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))');await run('wait','--fn',settled);
 results.lifecycle.resize=await inspect();assert.equal(results.lifecycle.resize.cloudBuffer,'401x301');
 await evaluate(`(async()=>{const c=document.querySelector('earthlight-explorer canvas'),gl=c.getContext('webgl2'),ext=gl.getExtension('WEBGL_lose_context');const lost=new Promise(r=>c.addEventListener('webglcontextlost',r,{once:true}));ext.loseContext();await lost;gl.getError();const restored=new Promise(r=>c.addEventListener('webglcontextrestored',r,{once:true}));setTimeout(()=>ext.restoreContext(),200);await restored;return true;})()`);
 await run('wait','--fn',settled);results.lifecycle.restored=await inspect();assert.equal(results.lifecycle.restored.api,'webgl2');assert.equal(results.lifecycle.restored.cloudPass,'half');assert.equal(results.lifecycle.restored.error,0);
 await writeFile(`${out}/results.json`,JSON.stringify(results,null,2)+'\n');
}catch(error){
 await writeFile(`${out}/failure.txt`,String(error.stack??error));
 try{await writeFile(`${out}/failure-state.json`,JSON.stringify(await evaluate(`({url:location.href,state:{...document.querySelector('earthlight-explorer')?.dataset}})`),null,2));}catch{}
 try{await writeFile(`${out}/browser-errors.txt`,await run('errors'));await writeFile(`${out}/browser-console.txt`,await run('console'));}catch{}
 throw error;
}finally{await run('close');}
