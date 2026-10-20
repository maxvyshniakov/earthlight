// bun scripts/verify-texture-profile.mjs http://127.0.0.1:4347 /tmp/earthlight-textures
// Optional TEXTURE_API=webgl2. Image metrics report trade-offs, not acceptance.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import sharp from 'sharp';

const exec=promisify(execFile);
const [base='http://127.0.0.1:4347',out='/tmp/earthlight-textures']=process.argv.slice(2);
const api=process.env.TEXTURE_API??'webgl';
assert.ok(['webgl','webgl2'].includes(api));
const session=`texture-proof-${process.pid}`;
const run=async(...args)=>(await exec('agent-browser',['--session',session,...args],{
  timeout:120000,maxBuffer:40e6,env:{...process.env,AGENT_BROWSER_DEFAULT_TIMEOUT:'90000'},
})).stdout;
const evaluate=async source=>JSON.parse(await run('eval','--base64',Buffer.from(source).toString('base64')));
const settled=`(()=>{const s=document.querySelector('earthlight-explorer');return s?.hasAttribute('data-ready')&&s.dataset.shaderStartup==='ready'&&s.dataset.focus==='sharp'&&s.dataset.exposure==='settled'&&s.dataset.assetPhase==='settled'&&['dayTiles','nightTiles','cloudTiles','terrainTiles','galaxyTiles'].every(k=>!s.dataset[k]||JSON.parse(s.dataset[k]).pending===0)})()`;
const wait=expected=>run('wait','--fn',`(${expected?`location.href===${JSON.stringify(expected)}`:'true'})&&(${settled})`);
const inspect=()=>evaluate(`(()=>{
 const s=document.querySelector('earthlight-explorer'),c=s.querySelector('canvas'),gl=c.getContext('webgl2')??c.getContext('webgl');
 const resources=performance.getEntriesByType('resource').filter(r=>r.name.includes('/media/earthlight/')).map(r=>({path:new URL(r.name).pathname,encodedBytes:r.encodedBodySize,transferBytes:r.transferSize}));
 return {url:location.href,api:s.dataset.renderApi,profile:s.dataset.renderProfile,textureProfile:s.dataset.textureProfile,galaxyMapWidth:Number(s.dataset.galaxyMapWidth),width:c.width,height:c.height,position:s.dataset.cameraPosition,basis:s.dataset.cameraBasis,failures:s.dataset.assetFailures,galaxyTiles:s.dataset.galaxyTiles?JSON.parse(s.dataset.galaxyTiles):null,error:gl.getError(),resources};
})()`);
const capture=()=>evaluate(`new Promise((resolve,reject)=>{
 const s=document.querySelector('earthlight-explorer'),c=s.querySelector('canvas'),gl=c.getContext('webgl2')??c.getContext('webgl');
 const bind=gl.bindFramebuffer,draw=gl.drawArrays;let target=gl.getParameter(gl.FRAMEBUFFER_BINDING);
 const restore=()=>{gl.bindFramebuffer=bind;gl.drawArrays=draw;};
 const timeout=setTimeout(()=>{restore();reject(Error('Texture capture timeout'));},15000);
 gl.bindFramebuffer=function(k,v){target=v;return bind.call(this,k,v);};
 gl.drawArrays=function(...args){draw.apply(this,args);if(target===null){clearTimeout(timeout);const png=c.toDataURL('image/png');restore();resolve(png);}};
 s.querySelector('.explorer-track input').dispatchEvent(new Event('input'));
})`);
const save=async name=>{
 const png=Buffer.from((await capture()).split(',')[1],'base64');
 await writeFile(`${out}/${name}.png`,png);
 const decoded=await sharp(png).removeAlpha().raw().toBuffer({resolveWithObject:true});
 assert.ok(decoded.data.some(value=>value>30),'Captured frame must contain rendered light');
 return decoded;
};
const measure=(a,b)=>{
 assert.equal(a.length,b.length);let sum=0,max=0,squared=0,overOne=0,overFour=0;
 for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]);sum+=d;squared+=d*d;max=Math.max(max,d);overOne+=d>1;overFour+=d>4;}
 return {mean:sum/a.length,rms:Math.sqrt(squared/a.length),max,fractionOverOne:overOne/a.length,fractionOverFour:overFour/a.length};
};
const scenes=[
 {name:'night',t:610.87,pitch:0,galaxy:1,exposure:0},
 {name:'diffuse-sky',t:610.87,pitch:45,galaxy:2,exposure:2},
 {name:'scattered-ground',t:610.87,pitch:-25,galaxy:2,exposure:0},
];
const results={conditions:{api,viewport:[1440,900],render:'compact',quality:'fixed',epoch:'2026-10-06T01:32:27Z',grain:0,metricUnits:'8-bit RGB channels',acceptanceThresholds:null,launchArgs:process.env.AGENT_BROWSER_ARGS??''},images:[],fallback:null};
const persist=()=>writeFile(`${out}/results.json`,JSON.stringify(results,null,2)+'\n');
await mkdir(out,{recursive:true});
try{
 await run('set','viewport','1440','900');
 for(const scene of scenes){
  const captures=[];
  for(const texture of ['reference','compact']){
   const url=new URL('/',base);
   for(const [key,value] of Object.entries({api,render:'compact',t:scene.t,pitch:scene.pitch,quality:'fixed',motion:0,epoch:results.conditions.epoch,'look-grain':0,'look-galaxy':scene.galaxy,'exposure-mode':'manual','exposure-fixed':scene.exposure}))url.searchParams.set(key,String(value));
   if(texture==='compact')url.searchParams.set('texture','compact');
   console.log('open',scene.name,texture);await run('open',url.href);await wait(url.href);
   const state=await inspect();assert.equal(state.url,url.href);assert.equal(state.api,api);assert.equal(state.profile,'compact');assert.equal(state.textureProfile,texture);assert.equal(state.error,0);assert.equal(state.failures,'0');
   assert.equal(state.galaxyMapWidth,texture==='compact'?2048:4096);
   const requested=state.resources.map(r=>r.path);
   assert.ok(requested.includes(texture==='compact'?'/media/earthlight/mobile/galaxy-2048.avif':'/media/earthlight/milky-way.avif'));
   assert.ok(!requested.includes(texture==='compact'?'/media/earthlight/milky-way.avif':'/media/earthlight/mobile/galaxy-2048.avif'),'Only the requested overview may download');
   const pixels=await save(`${scene.name}-${texture}`);
   captures.push({state:{...await inspect(),requestedURL:url.href},pixels});
  }
  const [a,b]=captures;
  for(const key of ['width','height','position','basis','profile','api'])assert.equal(a.state[key],b.state[key],`Matched ${key}`);
  assert.equal(a.pixels.info.width,b.pixels.info.width);assert.equal(a.pixels.info.height,b.pixels.info.height);
  const metrics=measure(a.pixels.data,b.pixels.data);
  results.images.push({scene:scene.name,settings:scene,reference:a.state,compact:b.state,...metrics});
  console.log(scene.name,metrics);await persist();
 }

 // A failed optional refinement must keep the actual preview width for the
 // irradiance mip calculation. Clone creates a fresh renderer/asset cache.
 console.log('fallback compact overview');
 await evaluate(`(()=>{
  const fetch=window.fetch.bind(window);window.__textureFallback={hits:0};
  window.fetch=(input,options)=>{const url=input instanceof Request?input.url:String(input);if(url.includes('/mobile/galaxy-2048.avif')){window.__textureFallback.hits++;return Promise.resolve(new Response('',{status:503}));}return fetch(input,options);};
  const original=document.querySelector('earthlight-explorer'),copy=original.cloneNode(true);
  for(const key of Object.keys(copy.dataset))if(key!=='composition'&&!key.startsWith('astro'))delete copy.dataset[key];
  original.replaceWith(copy);return true;
 })()`);
 await wait();
 const failed=await inspect(),probe=await evaluate('window.__textureFallback');
 assert.equal(probe.hits,1);assert.equal(failed.textureProfile,'compact');assert.equal(failed.galaxyMapWidth,1024);assert.equal(failed.failures,'1');assert.equal(failed.error,0);
 await save('fallback-preview');
 await evaluate(`(async()=>{
  const c=document.querySelector('earthlight-explorer canvas'),gl=c.getContext('webgl2')??c.getContext('webgl'),ext=gl.getExtension('WEBGL_lose_context');
  if(!ext)throw Error('Context-loss extension unavailable');
  const lost=new Promise(resolve=>c.addEventListener('webglcontextlost',resolve,{once:true}));ext.loseContext();await lost;gl.getError();
  const restored=new Promise(resolve=>c.addEventListener('webglcontextrestored',resolve,{once:true}));setTimeout(()=>ext.restoreContext(),200);await restored;return true;
 })()`);
 await wait();
 const restored=await inspect();assert.equal(restored.galaxyMapWidth,1024);assert.equal(restored.textureProfile,'compact');assert.equal(restored.error,0);
 await save('fallback-preview-restored');
 results.fallback={probe,failed,restored};await persist();
 console.log('Asset identity, matched poses, compact width and retained preview after failure/restore passed. Review saved images before accepting quality.');
}catch(error){
 results.failure={message:error.message,stack:error.stack};await persist();
 try{await writeFile(`${out}/browser-errors.txt`,await run('errors'));await writeFile(`${out}/browser-console.txt`,await run('console'));}catch{}
 throw error;
}finally{await run('close');}
