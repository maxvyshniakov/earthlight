// Matched images and actual control/context lifecycle for cloud coverage presets.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const exec=promisify(execFile),[base='http://127.0.0.1:4395',out='/tmp/earthlight-cloud-openings/presets']=process.argv.slice(2);
const session=`cloud-presets-${process.pid}`;
const run=async(...a)=>(await exec('rtk',['proxy','agent-browser','--session',session,...a],{encoding:'utf8',timeout:90000,maxBuffer:8e6})).stdout;
const ev=async code=>JSON.parse(await run('eval','--base64',Buffer.from(code).toString('base64')));
const settled=`(()=>{const s=document.querySelector('earthlight-explorer');return s?.dataset.shaderStartup==='ready'&&s.dataset.focus==='sharp'&&s.dataset.assetPhase==='settled'&&['dayTiles','nightTiles','cloudTiles','terrainTiles'].every(k=>!s.dataset[k]||JSON.parse(s.dataset[k]).pending===0)})()`;
const wait=async()=>{try{await run('wait','--fn',settled);}catch{await run('wait','--fn',settled);}};
const inspect=()=>ev(`(()=>{const s=document.querySelector('earthlight-explorer'),g=s.querySelector('canvas').getContext(s.dataset.renderApi);return {url:location.href,state:{...s.dataset},selected:s.querySelector('#explorer-clouds').value,error:g.getError()}})()`);
const checked=async mode=>{const v=await inspect();assert.equal(v.state.clouds,mode);assert.equal(v.selected,mode);assert.equal(v.state.assetFailures,'0');assert.equal(v.error,0);return v;};
const common={api:'webgl2',render:'compact',ocean:'advected',motion:0,quality:'fixed',t:0,epoch:'2026-10-06T01:32:27Z','exposure-mode':'manual','exposure-fixed':.5,'look-grain':0,galaxyDetail:0};
const r=Math.PI/180,lat=30.6*r,lon=-162.3*r;
const globe={flight:'free',position:[Math.cos(lat)*Math.cos(lon),Math.cos(lat)*Math.sin(lon),Math.sin(lat)].map(v=>v*(1+25955/6371)).join(','),heading:[-Math.sin(lat)*Math.cos(lon),-Math.sin(lat)*Math.sin(lon),Math.cos(lat)].join(','),elevation:-90*r,roll:Math.PI/2,aurora:0};
const poses={globe,india:{flight:'free',position:'1.60538840,1.48615111,0.68520306',orientation:'-0.1652200365,0.5528026362,0.1063902614,0.8098102847'},wide:{flight:'free',position:'-1.05782,0.61073,-0.21538',heading:'0,0,1',elevation:-Math.PI/2,roll:0},night:{t:0}};
const results=[];await mkdir(out,{recursive:true});
try{
 for(const [scene,pose] of Object.entries(poses)){
  await run('set','viewport',...(['india','globe'].includes(scene)?['412','797']:['1200','800']));
  for(const mode of ['original','balanced','off']){
   const url=new URL(base);for(const [k,v] of Object.entries({...common,...pose,clouds:mode}))url.searchParams.set(k,String(v));
   await run('open',url.href);await wait();const value=await checked(mode);
   await ev(`(()=>{const s=document.createElement('style');s.textContent='earthlight-explorer > :not(canvas){visibility:hidden!important}';document.head.append(s);return true})()`);
   await run('screenshot',`${out}/${scene}-${mode}.png`);results.push({scene,mode,...value});
   await writeFile(`${out}/captures.json`,JSON.stringify(results,null,2));console.log(scene,mode);
  }
 }
 for(const api of ['webgl','webgl2']){
  const url=new URL(base);for(const [k,v] of Object.entries({...common,...poses.india,api,clouds:'original'}))url.searchParams.set(k,String(v));
  await run('set','viewport','390','844');await run('open',url.href);await wait();const before=await checked('original');
  for(const mode of ['off','balanced','original']){
   await ev(`(()=>{const s=document.querySelector('#explorer-clouds');s.value='${mode}';s.dispatchEvent(new Event('change'));return true})()`);await wait();
   const after=await checked(mode);assert.equal(after.state.cameraPosition,before.state.cameraPosition);assert.equal(after.state.cameraBasis,before.state.cameraBasis);assert.equal(new URL(after.url).searchParams.get('motion'),'0');
   assert.equal(new URL(after.url).searchParams.get('ocean'),'advected');
   if(mode==='off'){assert.equal(after.state.cloudTiles,undefined);assert.notEqual(after.state.cloudLighting,'texture');}
  }
  await ev(`(()=>{const s=document.querySelector('#explorer-clouds');s.value='balanced';s.dispatchEvent(new Event('change'));return true})()`);await wait();
  await ev(`(()=>{const g=document.querySelector('canvas').getContext('${api}'),ext=g.getExtension('WEBGL_lose_context');window.restoreClouds=()=>ext.restoreContext();ext.loseContext();return true})()`);
  await new Promise(r=>setTimeout(r,400));await ev('window.restoreClouds();true');await wait();await checked('balanced');
  await ev(`document.querySelector('#explorer-settings').showPopover();true`);
  assert.equal(await ev('document.documentElement.scrollWidth>innerWidth'),false);
  await run('screenshot',`${out}/${api}-settings.png`);
  await ev(`(()=>{const s=document.querySelector('#explorer-clouds');s.value='off';s.dispatchEvent(new Event('change'));return true})()`);await wait();await checked('off');
  await ev(`document.querySelector('.reset-all').click();true`);await wait();await checked('balanced');
  assert.equal(new URL((await inspect()).url).searchParams.has('clouds'),false);
  console.log(api,'control, camera preservation, context recovery, settings and reset passed');
 }
}finally{await run('close');}
