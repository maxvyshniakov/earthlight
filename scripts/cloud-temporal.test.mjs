import {test} from 'bun:test';
import assert from 'node:assert/strict';
import {sceneShadersFor} from '../src/scripts/scene-shader.ts';
import {temporalCloudMain,temporalResolveFragment,temporalCompositeShader} from '../src/scripts/cloud-temporal.ts';

test('temporal composite assembles its cloud integral through the volume builder',()=>{
 const scene=sceneShadersFor('current');
 const composite=scene.buildVolumeFragment({declarations:temporalCompositeShader,
  expression:'temporalClouds(uv,earthRay,groundDistance,color,atmosphereDistance)'});
 assert.ok(composite.startsWith(scene.scenePrelude));
 assert.ok(composite.includes(temporalCompositeShader));
 assert.ok(composite.includes('color=temporalClouds(uv,earthRay,groundDistance,color,atmosphereDistance)'));
 assert.ok(!composite.includes('color=cloudVolume(earthRay,groundDistance,color,atmosphereDistance)'));
 assert.ok(temporalCloudMain.includes('cloudIntegral(ray,groundDistance,transmission,atmosphereDistance)'));
});
test('resolve declares every input the renderer binds and keeps MRT first',()=>{
 assert.ok(temporalResolveFragment.startsWith('#extension GL_EXT_draw_buffers : require'));
 for(const name of ['freshRadiance','freshDepth','historyRadiance','historyDepth','previousResolved','worldScene'])
  assert.ok(new RegExp(`uniform sampler2D[^;]*\\b${name}\\b`).test(temporalResolveFragment),name);
 // History comes from last frame's computed columns, never its reconstruction.
 assert.ok(temporalResolveFragment.includes('(1.-cloudParity)'));
});
