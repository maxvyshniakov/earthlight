import {test} from 'bun:test';
import assert from 'node:assert/strict';
import {cameraProgramFor,EV100_AT_ZERO,BASE_ND_STOPS,exposureCeiling,widestFNumber,focalFromMm,NIGHT_EXPOSURE_MAX_EV} from '../src/scripts/camera-model.ts';
import {readNightMode,NIGHT_MODE,nightScale} from '../src/scripts/physical-night.ts';
import {lunarDiskGain,lunarPhaseLaw,FULL_MOON_IRRADIANCE,lunarLightShader} from '../src/scripts/earth-light.ts';
import {grainSnr,photositesPerPixel} from '../src/scripts/sensor-noise.ts';
import {SCENE_CANDELA} from '../src/scripts/radiometry.ts';

test('the night lab is off unless the address asks for it',()=>{
 assert.equal(NIGHT_MODE,'current');
 assert.equal(nightScale('city'),1);
 assert.equal(readNightMode('?night=video'),'video');
 assert.equal(readNightMode('?night=still'),'still');
 assert.equal(readNightMode('?night=1'),'current');
 assert.equal(readNightMode('?t=4&night=still&lens=2'),'still');
 assert.equal(readNightMode('?daynight=video'),'current');
 assert.equal(lunarDiskGain(.5),18);
});

test('night programs keep the base program below f/3.2 and state calibrated EV100 throughout',()=>{
 // Display linear = scene × 2^ev; ISO 12232 saturation with q = 0.65 ties ev to EV100.
 assert.ok(Math.abs(EV100_AT_ZERO-15.62)<.01);
 assert.ok(Math.abs(BASE_ND_STOPS-7.54)<.01);
 for(const mode of ['video','still'])for(const mm of [15,30,240,400,800,1500]){
  const focal=focalFromMm(mm),ceiling=exposureCeiling(mode,focal);
  let previous=cameraProgramFor(mode,-5.5,focal);
  for(let ev=-5.5;ev<=NIGHT_EXPOSURE_MAX_EV;ev+=.01){
   const camera=cameraProgramFor(mode,ev,focal),base=cameraProgramFor('current',Math.min(ev,1.6));
   const reached=Math.min(ev,ceiling);
   assert.ok(Math.abs(camera.opticalGain*camera.isoGain-2**(reached-.5))<1e-9*2**reached);
   assert.ok(Math.abs(camera.ev100-(EV100_AT_ZERO-reached))<1e-9,`${mode} ${mm} ${ev}`);
   if(ev<=1.6){assert.equal(camera.fNumber,base.fNumber);assert.equal(camera.iso,base.iso);}
   // A real lens: never wider than f/1.4 or focal / 143 mm once at night.
   if(ev>9.2)assert.ok(camera.fNumber>=widestFNumber(focal)-1e-9,`${mode} ${mm} f/${camera.fNumber}`);
   // Continuous in EV: no step in aperture or ISO.
   assert.ok(Math.abs(Math.log2(camera.fNumber/previous.fNumber))<.02&&Math.abs(Math.log2(camera.iso/previous.iso))<.03,`${mode} ${mm} ${ev}`);
   assert.ok(camera.shutterSeconds>=previous.shutterSeconds&&camera.iso>=previous.iso-1e-9);
   previous=camera;
  }
 }
 // ISS references: α7S video at f/1.4, 1/24 s, ISO 409 600 is EV100 −6.4;
 // D3S night stills at f/1.4, 1.3 s, ISO 12 800 is EV100 −6.4.
 const video=cameraProgramFor('video',22.1),still=cameraProgramFor('still',22.1);
 assert.ok(Math.abs(video.fNumber-1.4)<1e-9&&Math.abs(video.shutterSeconds-1/24)<1e-12);
 assert.ok(Math.abs(video.iso-409600)<1e-6,String(video.iso));
 assert.ok(Math.abs(still.fNumber-1.4)<1e-9&&Math.abs(still.shutterSeconds-1.3)<1e-9);
 assert.ok(Math.abs(Math.log2(still.iso/12800))<.1,String(still.iso));
 assert.equal(video.ndStops,0);
 // The same exposure gathers 5 stops more light in a still.
 assert.ok(Math.abs(Math.log2(still.opticalGain/video.opticalGain)-Math.log2(1.3*24))<.01);
});

test('the night lens is f/1.4 to 200 mm and limited by a 143 mm pupil beyond',()=>{
 assert.equal(widestFNumber(focalFromMm(15)),1.4);
 assert.equal(widestFNumber(focalFromMm(50)),1.4);
 assert.ok(Math.abs(widestFNumber(focalFromMm(400))-2.8)<.01);
 assert.ok(Math.abs(widestFNumber(focalFromMm(800))-5.6)<.01);
 assert.ok(Math.abs(widestFNumber(focalFromMm(1500))-10.5)<.02);
 // Dubai, ISS030-E-99324: 400 mm f/2.8 at EV100 +2.0 is within the video's reach.
 const dubai=cameraProgramFor('video',EV100_AT_ZERO-2,focalFromMm(400));
 assert.ok(Math.abs(dubai.fNumber-2.8)<.01&&dubai.iso<409600);
 // The ceiling falls with the lost aperture: 2.37 stops at 400 mm.
 assert.ok(Math.abs(exposureCeiling('video',focalFromMm(30))-exposureCeiling('video',focalFromMm(400))-2*Math.log2(2.8/1.4))<.01);
});

test('the lunar disk carries the flux of moonlight',()=>{
 assert.ok(lunarLightShader.includes(`fullMoonIrradiance=${String(FULL_MOON_IRRADIANCE).replace(/^0/,'')}`));
 // Full disk: radiance gain × mean cos = E / Ω at mean distance, 4 900–5 400 cd/m² (Schmidt 2009).
 const full=lunarDiskGain(0,true)*2/3*SCENE_CANDELA;
 assert.ok(full>4900&&full<5400,String(full));
 // Lit part at 115°: the ledger's ~570 cd/m² (±30%) at the disk centre of light.
 const angle=115*Math.PI/180,flux=lunarDiskGain(angle,true)*2/3*((Math.sin(angle)+(Math.PI-angle)*Math.cos(angle))/Math.PI);
 assert.ok(Math.abs(flux/(lunarDiskGain(0,true)*2/3)-lunarPhaseLaw(angle))<1e-12);
 assert.ok(Math.abs(lunarPhaseLaw(Math.PI/2)-.09)<.01);
});

test('grain bins photosites at night and keeps the day look',()=>{
 assert.ok(Math.abs(photositesPerPixel(800)-12.53)<.01);
 assert.equal(photositesPerPixel(4000),1);
 // Day program, ISO 100–543: the same SNR with and without binning.
 for(const gain of [.25,.75,1,1.36])assert.ok(Math.abs(grainSnr(.055,gain,800,true)/grainSnr(.055,gain,800,false)-1)<.01,String(gain));
 // Night: shot noise falls by √N, and the real full well doubles the default cell.
 const before=grainSnr(.055,1024,800,false),after=grainSnr(.055,1024,800,true);
 assert.ok(after/before>4.5&&after/before<6,`${before} ${after}`);
});
