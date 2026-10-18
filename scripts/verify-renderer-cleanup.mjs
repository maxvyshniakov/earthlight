// Compare retained profiles across archived and cleaned builds at identical fixed settings.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {captureAtlasPlan,installCaptureAtlases} from './scene-capture-atlas.mjs';
import {ISS_PERIOD_SECONDS} from '../src/scripts/iss-orbit.ts';

const exec=promisify(execFile);
const [before='http://127.0.0.1:4350',after='http://127.0.0.1:4351',out='/tmp/earthlight-cleanup-images',profiles='reference,compact']=process.argv.slice(2);
const session=`cleanup-images-${process.pid}`;
const run=async(...args)=>(await exec('rtk',['proxy','agent-browser','--session',session,...args],{timeout:90000,maxBuffer:80e6,env:{...process.env,AGENT_BROWSER_DEFAULT_TIMEOUT:'60000'}})).stdout;
const evaluate=async code=>JSON.parse(await run('eval','--base64',Buffer.from(code).toString('base64')));
const settled=`(()=>{const s=document.querySelector('earthlight-explorer');return s?.hasAttribute('data-ready')&&s.dataset.focus==='sharp'&&s.dataset.exposure==='settled'&&s.dataset.assetPhase==='settled'&&['dayTiles','cloudTiles','nightTiles','terrainTiles','galaxyTiles'].every(k=>!s.dataset[k]||(()=>{const v=JSON.parse(s.dataset[k]);return v.pending===0&&(v.fading??0)===0&&v.resident>=v.wanted})())})()`;
const capture=async(t,count,fixedResidency)=>evaluate(`(async()=>{
 const s=document.querySelector('earthlight-explorer'),c=s.querySelector('canvas'),input=s.querySelector('.explorer-track input');
 const gl=c.getContext('webgl2'),originalDraw=gl.drawArrays,step=input.step;
 const expected=Object.fromEntries(['day','night','cloud','galaxy','terrain'].map(layer=>[layer,JSON.parse(s.dataset[layer+'Tiles']??'{"resident":0}').resident]));
 const atlases=${fixedResidency?`(${installCaptureAtlases.toString()})(gl,${captureAtlasPlan.toString()},expected)`:'null'};
 const draw=gl.drawArrays,frames=[],poses=[],warmup=${fixedResidency}&&s.dataset.cloudReuse==='temporal'?2:0;let onFrame=null,onError=null;
 gl.drawArrays=function(...args){
  try{draw.apply(this,args);if(gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING)===null&&onFrame){const done=onFrame;onFrame=null;done(c.toDataURL('image/png'));}}
  catch(error){onError?.(error);throw error;}
 };
 input.step='any';
 try{for(let i=0;i<${count}+warmup;i++){
  const png=await new Promise((resolve,reject)=>{
   const timeout=setTimeout(()=>reject(Error('Scene capture timeout')),10000);
   onFrame=data=>{clearTimeout(timeout);resolve(data);};onError=error=>{clearTimeout(timeout);reject(error);};
   // Re-render precisely the same scene time. Wall-clock scheduling remains
   // live; no production clock, exposure or streaming path is overridden.
   input.value=String(${t}/${ISS_PERIOD_SECONDS}*100);input.dispatchEvent(new Event('input'));
  });
  frames.push(png);poses.push(s.dataset.cameraBasis);
 }}finally{gl.drawArrays=draw;atlases?.dispose();gl.drawArrays=originalDraw;input.step=step;}
 const resources=atlases?.resources??[];
 if(atlases)for(const [layer,resident] of Object.entries(expected))if(resident>0&&!resources.some(r=>r.layer===layer))throw Error('Resident atlas not captured: '+layer);
 return {frames,poses,resources,warmup,width:c.width,height:c.height,error:gl.getError()};
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

const results={conditions:{api:'webgl2',viewport:[1440,900],quality:'fixed',aurora:0,grain:0,exposureEV:0,scene:'clouds',sceneTime:3235.65,epoch:'2026-10-06T01:32:27Z',pitch:-25,samples:3,sampleMode:'same scene time',temporalWarmup:'two column parities, retained as warmup PNGs',residency:'fixed geographic page order; exact GPU texel verification; raw frames retained',launchArgs:process.env.AGENT_BROWSER_ARGS??''},comparisons:[]};
await mkdir(out,{recursive:true});
try{
 await run('set','viewport','1440','900');
 for(const profile of profiles.split(',')){
  assert.ok(['reference','compact'].includes(profile));
  const shots={},states={},pixels={},rawPixels={},rawDifference={};
  for(const [label,base] of [['before',before],['after',after]]){
   const url=new URL('/',base);for(const [k,v] of Object.entries({api:'webgl2',render:profile,aurora:'0',quality:'fixed',motion:'0',t:'3235.65',pitch:'-25',epoch:'2026-10-06T01:32:27Z','look-grain':'0','exposure-mode':'manual','exposure-fixed':'0'}))url.searchParams.set(k,v);
   console.log(profile,label);await run('open',url.href);await run('wait','--fn',settled);
   states[label]=await evaluate(`(()=>{const s=document.querySelector('earthlight-explorer'),c=s.querySelector('canvas');return {profile:s.dataset.renderProfile,api:s.dataset.renderApi,width:c.width,height:c.height,position:s.dataset.cameraPosition,basis:s.dataset.cameraBasis,failures:s.dataset.assetFailures,client:[...document.scripts].map(s=>s.src).filter(Boolean),error:c.getContext('webgl2').getError()}})()`);
   assert.equal(states[label].profile,profile);assert.equal(states[label].api,'webgl2');assert.equal(states[label].failures,'0');assert.equal(states[label].error,0);
   const raw=await capture(3235.65,3,false);rawPixels[label]=await decode(raw,`${profile}-${label}-raw`);
   shots[label]=await capture(3235.65,3,true);
   // The temporal path owns two alternating fresh-column histories. Fixed
   // placement is a new input: render both parities once and retain these
   // transition images, then require the next three images to be identical.
   if(shots[label].warmup)await decode({...shots[label],frames:shots[label].frames.splice(0,shots[label].warmup)},`${profile}-${label}-warmup`);
   pixels[label]=await decode(shots[label],`${profile}-${label}`);
   rawDifference[label]=metrics(rawPixels[label],pixels[label]);
   await writeFile(`${out}/${profile}-${label}-resources.json`,JSON.stringify(shots[label].resources,null,2)+'\n');
   // Repeated renders must themselves be stable, not merely near a reference.
   for(const samples of [rawPixels[label],pixels[label]])for(const frame of samples.slice(1))assert.ok(frame.equals(samples[0]),'Same-time captures changed within one loaded scene');
  }
  for(const k of ['width','height','position','basis'])assert.equal(states.before[k],states.after[k]);
  const difference=metrics(pixels.before,pixels.after);results.comparisons.push({profile,states,difference,rawDifference:metrics(rawPixels.before,rawPixels.after),placementDifference:rawDifference});console.log(profile,difference);
  assert.ok(difference.spatialMax<=1&&difference.spatialMean<.001,'Retained renderer may differ by at most one byte level in a small fraction of channels; this is not byte identity');
 }
}catch(error){results.failure={message:error.message,stack:error.stack};throw error;}
finally{await writeFile(`${out}/results.json`,JSON.stringify(results,null,2)+'\n');await run('close').catch(()=>{});}
