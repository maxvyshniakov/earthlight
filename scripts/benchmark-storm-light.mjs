// Compare the published implementation against the current implementation.
// Different storm models; compare CPU cost, not image equivalence.
// No timing assertion: this is a local CPU microbenchmark, not frame/power data.
import {execFileSync} from 'node:child_process';
import {stripTypeScriptTypes} from 'node:module';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {stormLights} from '../src/scripts/storm-light.ts';
import {issFrame} from '../src/scripts/iss-orbit.ts';
const baseline='815ede7';
const source=execFileSync('git',['show',`${baseline}:src/scripts/storm-light.ts`],{encoding:'utf8'});
const reference=await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString('base64')}`);
const states=[];
for(const t of [0,17.9,18,71,610.87,1122.38,1645.72,3235.65,5400,-100])
for(const yaw of [0,90,180])for(const pitch of [0,-45])for(const rate of [.25,10,120,-10]){
  const frame=issFrame(t,.138,{yaw,pitch});
  states.push([t,rate,frame.camera,frame.cameraBasis,1.6]);
}
const hash=createHash('sha256');
let differingStates=0;
for(const args of states){
  const after=stormLights(...args);
  assert.ok([...after].every(Number.isFinite));
  assert.deepEqual(stormLights(...args),after);hash.update(new Uint8Array(after.buffer));
}
const measure=fn=>{const start=performance.now();for(const args of states)fn(...args);return performance.now()-start;};
measure(reference.stormLights);measure(stormLights);
const before=[],after=[];
for(let i=0;i<5;i++){before.push(measure(reference.stormLights));after.push(measure(stormLights));}
const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
console.log(JSON.stringify({baseline,states:states.length,fps:24,sha256:hash.digest('hex'),referenceMs:median(before),optimizedMs:median(after),equivalent:differingStates===0,differingStates,speedup:differingStates?null:median(before)/median(after),batches:{reference:before,optimized:after}},null,2));
