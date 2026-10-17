import {test} from 'bun:test';
import assert from 'node:assert/strict';
import {cameraProgramFor,EV100_AT_ZERO,BASE_ND_STOPS} from '../src/scripts/camera-model.ts';
import {readNightMode,NIGHT_MODE,nightScale} from '../src/scripts/physical-night.ts';

test('the night lab is off unless the address asks for it',()=>{
 assert.equal(NIGHT_MODE,'current');
 assert.equal(nightScale('city'),1);
 assert.equal(readNightMode('?night=video'),'video');
 assert.equal(readNightMode('?night=still'),'still');
 assert.equal(readNightMode('?night=1'),'current');
 assert.equal(readNightMode('?t=4&night=still&lens=2'),'still');
 assert.equal(readNightMode('?daynight=video'),'current');
});

test('night programs keep the base program below f/3.2 and state calibrated EV100 throughout',()=>{
 // Display linear = scene × 2^ev; ISO 12232 saturation with q = 0.65 ties ev to EV100.
 assert.ok(Math.abs(EV100_AT_ZERO-15.62)<.01);
 assert.ok(Math.abs(BASE_ND_STOPS-7.54)<.01);
 for(const mode of ['video','still']){
  let previous=cameraProgramFor(mode,-5.5);
  for(let ev=-5.5;ev<=22.1;ev+=.01){
   const camera=cameraProgramFor(mode,ev),base=cameraProgramFor('current',Math.min(ev,1.6));
   assert.ok(Math.abs(camera.opticalGain*camera.isoGain-2**(ev-.5))<1e-9*2**ev);
   assert.ok(Math.abs(camera.ev100-(EV100_AT_ZERO-ev))<1e-9,`${mode} ${ev}`);
   if(ev<=1.6){assert.equal(camera.fNumber,base.fNumber);assert.equal(camera.iso,base.iso);}
   assert.ok(camera.fNumber<=previous.fNumber+1e-12&&camera.iso>=previous.iso-1e-9&&camera.shutterSeconds>=previous.shutterSeconds);
   previous=camera;
  }
 }
 // ISS references: α7S video at f/1.4, 1/24 s, ISO 409 600 is EV100 −6.4;
 // D3S night stills at f/1.4, 1.3 s, ISO 12 800 is EV100 −6.4.
 const video=cameraProgramFor('video',22.1),still=cameraProgramFor('still',22.1);
 assert.ok(Math.abs(video.fNumber-1.4)<1e-9&&Math.abs(video.shutterSeconds-1/24)<1e-12);
 assert.ok(Math.abs(Math.log2(video.iso/409600))<.05,String(video.iso));
 assert.ok(Math.abs(still.fNumber-1.4)<1e-9&&Math.abs(still.shutterSeconds-1.3)<1e-9);
 assert.ok(Math.abs(Math.log2(still.iso/12800))<.1,String(still.iso));
 assert.equal(video.ndStops,0);
 // The same exposure gathers 5 stops more light in a still.
 assert.ok(Math.abs(Math.log2(still.opticalGain/video.opticalGain)-Math.log2(1.3*24))<.01);
});
