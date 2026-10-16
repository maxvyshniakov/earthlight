// Compare retained profiles across archived and cleaned builds at identical fixed settings.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {ISS_PERIOD_SECONDS} from '../src/scripts/iss-orbit.ts';

const exec=promisify(execFile);
const [before='http://127.0.0.1:4350',after='http://127.0.0.1:4351',out='/tmp/earthlight-cleanup-images',profiles='reference,compact']=process.argv.slice(2);
const session=`cleanup-images-${process.pid}`;
const run=async(...args)=>(await exec('rtk',['proxy','agent-browser','--session',session,...args],{timeout:90000,maxBuffer:80e6,env:{...process.env,AGENT_BROWSER_DEFAULT_TIMEOUT:'60000'}})).stdout;
const evaluate=async code=>JSON.parse(await run('eval','--base64',Buffer.from(code).toString('base64')));
const settled=`(()=>{const s=document.querySelector('earthlight-explorer');return s?.hasAttribute('data-ready')&&s.dataset.focus==='sharp'&&s.dataset.exposure==='settled'&&s.dataset.assetPhase==='settled'&&['dayTiles','cloudTiles','nightTiles','terrainTiles','galaxyTiles'].every(k=>!s.dataset[k]||JSON.parse(s.dataset[k]).pending===0)})()`;
const capture=async(t,count)=>evaluate(`(async()=>{
 const s=document.querySelector('earthlight-explorer'),c=s.querySelector('canvas'),input=s.querySelector('.explorer-track input');
 const gl=c.getContext('webgl2'),bind=gl.bindFramebuffer,draw=gl.drawArrays,step=input.step;
 let target=gl.getParameter(gl.FRAMEBUFFER_BINDING),onFrame=null;
 const frames=[],poses=[];
 gl.bindFramebuffer=function(k,v){target=v;return bind.call(this,k,v);};
 gl.drawArrays=function(...args){draw.apply(this,args);if(target===null&&onFrame){const done=onFrame;onFrame=null;done(c.toDataURL('image/png'));}};
 // Manual exposure and paused orbit time make samples deterministic without
 // freezing the clock used by scene scheduling and exposure-settle timers.
 input.step='any';
 try{for(let i=0;i<${count};i++){
  const png=await new Promise((resolve,reject)=>{
   const timeout=setTimeout(()=>reject(Error('Cloud capture timeout')),10000);
   onFrame=data=>{clearTimeout(timeout);resolve(data);};
   input.value=String((${t}+i*10/24)/${ISS_PERIOD_SECONDS}*100);input.dispatchEvent(new Event('input'));
  });
  frames.push(png);poses.push(s.dataset.cameraBasis);
 }}finally{gl.bindFramebuffer=bind;gl.drawArrays=draw;input.step=step;}
 return {frames,poses,width:c.width,height:c.height,error:gl.getError()};
})()`);
const decode=async(capture,prefix)=>{
 const pixels=[];
 assert.equal(capture.error,0);
 for(let i=0;i<capture.frames.length;i++){
  const png=Buffer.from(capture.frames[i].split(',')[1],'base64');
  await writeFile(`${out}/${prefix}-${i}.png`,png);
  const raw=await sharp(png).removeAlpha().raw().toBuffer();
  assert.ok(raw.some(value=>value>30),'Captured frame must contain rendered light');pixels.push(raw);
 }
 return pixels;
};
const metrics=(reference,candidate)=>{
 let sum=0,max=0,n=0,temporal=0,temporalN=0,temporalOverFour=0;
 for(let f=0;f<reference.length;f++){
  assert.equal(candidate[f].length,reference[f].length);
  for(let k=0;k<reference[f].length;k++){
   const delta=candidate[f][k]-reference[f][k];sum+=Math.abs(delta);max=Math.max(max,Math.abs(delta));n++;
   if(f){const change=Math.abs(delta-(candidate[f-1][k]-reference[f-1][k]));temporal+=change;temporalN++;if(change>4)temporalOverFour++;}
  }
 }
 return {spatialMean:sum/n,spatialMax:max,temporalMean:temporalN?temporal/temporalN:null,temporalFractionOverFour:temporalN?temporalOverFour/temporalN:null};
};

const results={conditions:{api:'webgl2',viewport:[1440,900],quality:'fixed',aurora:0,grain:0,exposureEV:0,scene:'clouds',launchArgs:process.env.AGENT_BROWSER_ARGS??''},comparisons:[]};
await mkdir(out,{recursive:true});
try{
 await run('set','viewport','1440','900');
 for(const profile of profiles.split(',')){
  assert.ok(['reference','compact'].includes(profile));
  const shots={},states={},pixels={};
  for(const [label,base] of [['before',before],['after',after]]){
   const url=new URL('/',base);for(const [k,v] of Object.entries({api:'webgl2',render:profile,aurora:'0',quality:'fixed',motion:'0',t:'3235.65',pitch:'-25',epoch:'2026-10-06T01:32:27Z','look-grain':'0','exposure-mode':'manual','exposure-fixed':'0'}))url.searchParams.set(k,v);
   console.log(profile,label);await run('open',url.href);await run('wait','--fn',settled);
   states[label]=await evaluate(`(()=>{const s=document.querySelector('earthlight-explorer'),c=s.querySelector('canvas');return {profile:s.dataset.renderProfile,api:s.dataset.renderApi,width:c.width,height:c.height,position:s.dataset.cameraPosition,basis:s.dataset.cameraBasis,failures:s.dataset.assetFailures,client:[...document.scripts].map(s=>s.src).filter(Boolean),error:c.getContext('webgl2').getError()}})()`);
   assert.equal(states[label].profile,profile);assert.equal(states[label].api,'webgl2');assert.equal(states[label].failures,'0');assert.equal(states[label].error,0);
   shots[label]=await capture(3235.65,1);pixels[label]=await decode(shots[label],`${profile}-${label}`);
  }
  for(const k of ['width','height','position','basis'])assert.equal(states.before[k],states.after[k]);
  const difference=metrics(pixels.before,pixels.after);results.comparisons.push({profile,states,difference});console.log(profile,difference);
  assert.ok(difference.spatialMax<=1&&difference.spatialMean<.001,'Retained renderer may differ by at most one byte level in a small fraction of channels; this is not byte identity');
 }
}catch(error){results.failure={message:error.message,stack:error.stack};throw error;}
finally{await writeFile(`${out}/results.json`,JSON.stringify(results,null,2)+'\n');await run('close');}
