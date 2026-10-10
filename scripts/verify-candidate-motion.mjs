// Compare actual moving-cloud frames and their temporal differences.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {ORBIT_SECONDS} from '../src/scripts/iss-orbit.ts';
const exec=promisify(execFile),[base='http://127.0.0.1:4347',out='/tmp/orbit-candidate-motion']=process.argv.slice(2);
const session=`candidate-motion-${process.pid}`;
const run=async(...args)=>(await exec('rtk',['proxy','agent-browser','--session',session,...args],{timeout:90000,maxBuffer:80e6})).stdout;
const evaluate=async code=>JSON.parse(await run('eval','--base64',Buffer.from(code).toString('base64')));
await mkdir(out,{recursive:true});const images={},results=[];
try{
 await run('set','viewport','1440','900');
 for(const profile of ['reference','lighting','split','compact']){
  await run('open',`${base}/?render=${profile}&quality=fixed&motion=0&t=3235.65&pitch=-25&epoch=2026-10-06T01:32:27Z&look-grain=0`);
  await run('wait','--fn',`(()=>{const s=document.querySelector('orbital-sky');return s?.dataset.exposure==='settled'&&s.dataset.assetPhase==='settled'&&['dayTiles','cloudTiles','nightTiles'].every(k=>!s.dataset[k]||JSON.parse(s.dataset[k]).pending===0)})()`);
  const capture=await evaluate(`(async()=>{
   const s=document.querySelector('orbital-sky'),c=s.querySelector('canvas'),input=s.querySelector('.sky-track input');
   const now=performance.now.bind(performance),fixed=now(),frames=[],poses=[],step=input.step;
   input.step='any';
   // Hold metering time fixed after it settles: compare rendering, not different
   // wall-clock exposure adaptation while screenshots are encoded.
   const gl=c.getContext('webgl'),bind=gl.bindFramebuffer,draw=gl.drawArrays;
   let target=gl.getParameter(gl.FRAMEBUFFER_BINDING),onFrame=null;
   gl.bindFramebuffer=function(k,v){target=v;return bind.call(this,k,v);};
   gl.drawArrays=function(...args){draw.apply(this,args);if(target===null&&onFrame){const done=onFrame;onFrame=null;done(c.toDataURL('image/png'));}};
   performance.now=()=>fixed;
   try{for(let i=0;i<8;i++){
    const png=await new Promise((resolve,reject)=>{
     const timeout=setTimeout(()=>reject(Error('Frame capture timeout')),3000);
     onFrame=data=>{clearTimeout(timeout);resolve(data);};
     input.value=String((3235.65+i*10/24)/${ORBIT_SECONDS}*100);input.dispatchEvent(new Event('input'));
    });
    frames.push(png);poses.push(s.dataset.cameraBasis);
   }}finally{performance.now=now;gl.bindFramebuffer=bind;gl.drawArrays=draw;input.step=step;}
   return {frames,poses,error:c.getContext('webgl').getError(),width:c.width,height:c.height};
  })()`);
  assert.equal(capture.error,0);images[profile]=[];
  for(let i=0;i<capture.frames.length;i++){
   const png=Buffer.from(capture.frames[i].split(',')[1],'base64');await writeFile(`${out}/${profile}-${i}.png`,png);
   const pixels=await sharp(png).removeAlpha().raw().toBuffer();
   assert.ok(pixels.some(value=>value>30),'Captured frame must contain rendered light');
   images[profile].push(pixels);
  }
  assert.equal(new Set(capture.poses).size,8,'Every captured frame must advance the camera');
  if(profile==='reference'){results.push({profile,poses:capture.poses});continue;}
  assert.deepEqual(capture.poses,results[0].poses);
  let spatial=0,temporal=0,count=0,temporalCount=0,max=0,overFour=0;
  for(let i=0;i<8;i++)for(let k=0;k<images[profile][i].length;k++){
   const difference=images[profile][i][k]-images.reference[i][k];spatial+=Math.abs(difference);max=Math.max(max,Math.abs(difference));count++;
   if(i){const delta=difference-(images[profile][i-1][k]-images.reference[i-1][k]);temporal+=Math.abs(delta);temporalCount++;if(Math.abs(delta)>4)overFour++;}
  }
  const result={profile,spatialMean:spatial/count,spatialMax:max,temporalMean:temporal/temporalCount,temporalOverFour:overFour/temporalCount};
  assert.ok(result.temporalMean<.25&&result.temporalOverFour<.001,JSON.stringify(result));results.push(result);console.log(result);
 }
 await writeFile(`${out}/results.json`,JSON.stringify(results,null,2)+'\n');
}finally{await run('close');}
