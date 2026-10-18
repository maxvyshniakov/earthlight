import {verifyLighting} from './lighting-browser-fixture.mjs';
import {verifyNightLight} from './night-light-browser-fixture.mjs';
import {verifyCityRadiance} from './city-radiance-browser-fixture.mjs';
import {verifyAurora} from './aurora-browser-fixture.mjs';
import {citySignalShaderFor,cityActivationShader} from '../src/scripts/city-light.ts';
import {cloudLightingShader} from '../src/scripts/cloud-lighting.ts';
import {buildTerrainShader} from '../src/scripts/earth-terrain.ts';
import {oceanFieldShader} from '../src/scripts/ocean-prototype.ts';
import {test} from 'bun:test';
import assert from 'node:assert/strict';
import {NIGHT_MODES} from '../src/scripts/physical-night.ts';
import {sceneShadersFor,buildSceneShaders,solarImageShader,sceneNoiseShader,airglowRayShader,cityEmissionShader} from '../src/scripts/scene-shader.ts';
import {cameraSensorShader,cameraHighlightsShader,CameraFinish} from '../src/scripts/camera-finish.ts';
import {cloudShaderFor,buildCloudShader,photographicCloudDensityShader,cloudMapShader,cloudCoverageShader,cloudDensityShader,cloudShadowShader} from '../src/scripts/earth-clouds.ts';

test('GPU fixture fragments are the production shader routines in every night mode',()=>{
 for(const mode of NIGHT_MODES){
  const scene=sceneShadersFor(mode);
  for(const fragment of [sceneNoiseShader,airglowRayShader,cityEmissionShader,cloudMapShader,cloudCoverageShader,cloudDensityShader,cloudShadowShader]){
   assert.ok(fragment.length>0);assert.ok(scene.scenePrelude.includes(fragment),mode);
   assert.ok(!fragment.includes('void main('),'a fixture routine must not include a production entry point');
  }
  assert.equal(scene.fragmentSource,scene.scenePrelude+scene.sceneMain);
  assert.ok(scene.sceneMain.startsWith('void main()'));
  assert.ok(scene.sceneMain.includes(solarImageShader()));
  assert.ok(scene.buildVolumeMain().includes(solarImageShader()));
  for(const block of [citySignalShaderFor(mode),cityActivationShader,photographicCloudDensityShader])assert.ok(scene.scenePrelude.includes(block));
  for(const name of ['sourceTransmissionFragment','volumeFragment','halfCloudFragment'])assert.ok(scene[name].startsWith(scene.scenePrelude),`${mode} ${name}`);
  assert.ok(cloudShaderFor(mode).startsWith(cloudCoverageShader));
  const programs=new Map(),batch={add:(name,_vertex,source)=>{programs.set(name,source);return name;}};
  CameraFinish.prepare(batch,mode);
  for(const fragment of [cameraSensorShader,cameraHighlightsShader])assert.ok(programs.get('Camera finish').includes(fragment),mode);
 }
});

test('cached cloud lighting and baked ocean statistics compose at their production boundaries',()=>{
 for(const mode of NIGHT_MODES){
  const defaults=sceneShadersFor(mode);
  const cached=buildSceneShaders(mode,{clouds:buildCloudShader(mode,{lighting:cloudLightingShader})});
  assert.ok(cached.scenePrelude.includes(cloudLightingShader.declarations));
  assert.ok(cached.scenePrelude.includes('float cloudShadow(vec3 point){'+cloudLightingShader.shadowPrelude));
  assert.ok(cached.scenePrelude.includes(photographicCloudDensityShader));
  assert.equal(cached.sceneMain,defaults.sceneMain,'cache changes only direct cloud transmission');
  assert.equal(cached.buildVolumeMain(),defaults.buildVolumeMain());
  const ocean=buildSceneShaders(mode,{terrain:buildTerrainShader(oceanFieldShader)});
  assert.ok(ocean.scenePrelude.includes(oceanFieldShader.declarations));
  assert.ok(ocean.scenePrelude.includes(oceanFieldShader.surface));
  assert.equal(ocean.sceneMain,defaults.sceneMain,'sea-state source leaves surface composition intact');
 }
});

test('shader fixtures generate complete browser programs before GPU execution',async()=>{
 const parsed=Symbol('parsed');
 for(const verify of [verifyLighting,verifyNightLight,verifyCityRadiance,verifyAurora]){
  await assert.rejects(verify(async source=>{new Function('return '+source);throw parsed;}),error=>error===parsed,verify.name);
 }
});
