import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const exec=promisify(execFile);
const [base='http://127.0.0.1:4347',out='/tmp/earthlight-profile-checks']=process.argv.slice(2);
await mkdir(out,{recursive:true});
const session=`profile-checks-${process.pid}`;
const run=async(...args)=>(await exec('rtk',['proxy','agent-browser','--session',session,...args],{timeout:90000,maxBuffer:8e6})).stdout;
const evaluate=async source=>JSON.parse(await run('eval','--base64',Buffer.from(source).toString('base64')));
const wait=()=>run('wait','--fn',`document.querySelector('earthlight-explorer')?.dataset.focus==='sharp'&&document.querySelector('earthlight-explorer').dataset.exposure==='settled'`);
const state=()=>evaluate(`(()=>{const s=document.querySelector('earthlight-explorer'),c=s.querySelector('canvas');return {profile:s.dataset.renderProfile,volume:s.dataset.volumePass,position:s.dataset.cameraPosition,basis:s.dataset.cameraBasis,scale:s.dataset.renderScale,grain:s.querySelector('[data-look=grain]').value,rate:s.querySelector('.explorer-speed input').value,motion:s.querySelector('.explorer-motion').getAttribute('aria-label'),width:c.width,height:c.height,api:s.dataset.renderApi,error:(c.getContext('webgl2')??c.getContext('webgl')).getError()}})()`);
const results={};
try{
  await run('set','viewport','1440','900');
  await run('open',`${base}/?t=3235.65&epoch=2026-10-06T01:32:27Z&motion=0&compare=1&quality=fixed&pitch=-25`);
  await wait();
  assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('#scene-profile optgroup[label="Candidates"] option'),o=>o.value)`),['compact','clouds-half']);
  assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('#scene-profile optgroup[label="Controls"] option'),o=>o.value)`),['split','lighting']);
  assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('#scene-profile option'),o=>o.value)`),['reference','compact','clouds-half','split','lighting']);
  const before=await state();assert.equal(before.profile,'compact');
  await evaluate(`(()=>{const s=document.querySelector('earthlight-explorer');for(const [selector,value] of [['[data-look=grain]','.5'],['.explorer-speed input','0']]){const i=s.querySelector(selector);i.value=value;i.dispatchEvent(new Event('input'));}return true;})()`);
  for(const profile of ['split','lighting','clouds-half','reference','compact']){
    await run('select','#scene-profile',profile);await wait();
    const after=await state();
    assert.equal(after.profile,profile);assert.equal(after.api,profile==='clouds-half'?'webgl2':'webgl');assert.equal(after.error,0);assert.equal(after.position,before.position);assert.equal(after.basis,before.basis);
    assert.equal(after.grain,'0.5');assert.equal(after.rate,'0');assert.equal(after.motion,'Play');
    results[profile]=after;console.log(profile,{volume:after.volume,error:after.error});
    if(profile==='split'||profile==='compact')assert.equal(after.volume,'separate');

  }
  // Count complete camera passes, not RAF callbacks or individual GPU draws.
  results.motion=await evaluate(`(async()=>{
    const s=document.querySelector('earthlight-explorer'),gl=s.querySelector('canvas').getContext('webgl');
    const draw=gl.drawArrays,bind=gl.bindFramebuffer;let target=gl.getParameter(gl.FRAMEBUFFER_BINDING),frames=0;
    gl.bindFramebuffer=function(k,v){target=v;return bind.call(this,k,v);};
    gl.drawArrays=function(...a){if(target===null)frames++;return draw.apply(this,a);};
    try{
      const button=s.querySelector('.explorer-motion');button.click();const start=performance.now();
      await new Promise(r=>setTimeout(r,5000));button.click();
      const fps=frames*1000/(performance.now()-start),pausedAt=performance.now(),diagnostics=[];
      const snapshot=()=>({elapsedMs:Math.round(performance.now()-pausedAt),focus:s.dataset.focus,exposure:s.dataset.exposure,assetPhase:s.dataset.assetPhase,
        tiles:Object.fromEntries(['dayTiles','nightTiles','cloudTiles','galaxyTiles','terrainTiles'].map(k=>[k,s.dataset[k]?JSON.parse(s.dataset[k]):null]))});
      const settled=v=>v.focus==='sharp'&&v.exposure==='settled'&&v.assetPhase==='settled'&&Object.values(v.tiles).every(t=>!t||t.pending===0);
      // Paused streamed uploads still draw and restart exposure adaptation.
      // Idle begins only after all tile queues and exposure have actually settled.
      let current=snapshot();diagnostics.push(current);
      while(!settled(current)&&performance.now()-pausedAt<60000){
        await new Promise(r=>setTimeout(r,1000));current=snapshot();diagnostics.push(current);
      }
      if(!settled(current))return {fps,idleFrames:null,error:gl.getError(),settleTimeout:true,diagnostics};
      frames=0;await new Promise(r=>setTimeout(r,1200));
      return {fps,idleFrames:frames,error:gl.getError(),settleTimeout:false,settledAfterMs:current.elapsedMs,diagnostics,final:snapshot()};
    }finally{gl.drawArrays=draw;gl.bindFramebuffer=bind;}
  })()`);
  await writeFile(`${out}/results.json`,JSON.stringify(results,null,2)+'\n');
  assert.equal(results.motion.settleTimeout,false,JSON.stringify(results.motion));
  assert.ok(results.motion.fps>20&&results.motion.fps<25.5,JSON.stringify(results.motion));assert.equal(results.motion.error,0);assert.equal(results.motion.idleFrames,0);
  console.log('Switching preserves camera, pause, image settings and speed; 24 fps cadence and idle passed',{fps:results.motion.fps,idleFrames:results.motion.idleFrames,settledAfterMs:results.motion.settledAfterMs});
  await evaluate(`(async()=>{const c=document.querySelector('canvas'),gl=c.getContext('webgl'),e=gl.getExtension('WEBGL_lose_context');const lost=new Promise(r=>c.addEventListener('webglcontextlost',r,{once:true}));e.loseContext();await lost;gl.getError();const restored=new Promise(r=>c.addEventListener('webglcontextrestored',r,{once:true}));setTimeout(()=>e.restoreContext(),200);await restored;return true;})()`);
  await run('wait','--fn',`document.querySelector('earthlight-explorer').hasAttribute('data-ready')&&document.querySelector('earthlight-explorer').dataset.assetPhase==='settled'`);
  await wait();results.restored=await state();assert.equal(results.restored.profile,'compact');assert.equal(results.restored.scale,'1.00');assert.equal(results.restored.error,0);
  await run('set','viewport','390','844');await wait();
  results.mobile=await evaluate(`(()=>{const box=document.querySelector('.scene-comparison').getBoundingClientRect();return {left:box.left,right:box.right,width:innerWidth,scrollWidth:document.documentElement.scrollWidth,profile:document.querySelector('#scene-profile').value};})()`);
  assert.ok(results.mobile.left>=0&&results.mobile.right<=results.mobile.width);assert.equal(results.mobile.scrollWidth,results.mobile.width);
  await run('screenshot',`${out}/mobile.png`);
  await run('open',`${base}/?render=compact&compare=1&motion=0&t=3235.65&epoch=2026-10-06T01:32:27Z`);await wait();
  results.homeLink=await evaluate(`document.querySelector('.explorer-link').href`);
  assert.equal(new URL(results.homeLink).searchParams.get('render'),'compact');
  await run('open',`${base}/?motion=0`);await wait();
  assert.equal(await evaluate(`document.querySelector('.scene-comparison').hidden`),true);
  assert.equal((await state()).profile,'compact');
  // Archived URLs resolve to the current default; reproduce old profiles at the archive tag.
  await run('open',`${base}/?render=atmosphere&compare=1&motion=0&t=3235.65`);await wait();
  results.archivedFallback=await state();assert.equal(results.archivedFallback.profile,'compact');
  assert.equal(await evaluate(`document.querySelector('#scene-profile').value`),'compact');
  assert.equal(results.archivedFallback.volume,'separate');assert.equal(results.archivedFallback.error,0);
  console.log('Context restoration, mobile layout, homepage link, default and archived profile fallback passed');
  await writeFile(`${out}/results.json`,JSON.stringify(results,null,2)+'\n');
}finally{await run('close');}
