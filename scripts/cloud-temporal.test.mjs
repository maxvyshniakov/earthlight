import {test} from 'bun:test';
import assert from 'node:assert/strict';
import {volumeFragment,fragmentSource} from '../src/scripts/orbital-shader.ts';
import {temporalCloudMain,temporalResolveFragment,temporalCompositeShader} from '../src/scripts/cloud-temporal.ts';

test('temporal composite replaces the inline cloud integral at stable anchors',()=>{
 for(const anchor of ['uniform sampler2D worldScene;','color=cloudVolume(earthRay,groundDistance,color,atmosphereDistance)'])
  assert.equal(volumeFragment.split(anchor).length,2,`volume pass anchor: ${anchor}`);
 assert.ok(temporalCompositeShader.includes('vec3 temporalClouds('));
 assert.ok(fragmentSource.includes('void main()'),'cloud pass reuses the scene prefix');
 assert.ok(temporalCloudMain.includes('cloudIntegral(ray,groundDistance,transmission,atmosphereDistance)'));
});
test('resolve declares every input the renderer binds and keeps MRT first',()=>{
 assert.ok(temporalResolveFragment.startsWith('#extension GL_EXT_draw_buffers : require'));
 for(const name of ['freshRadiance','freshDepth','historyRadiance','historyDepth','previousResolved','worldScene'])
  assert.ok(new RegExp(`uniform sampler2D[^;]*\\b${name}\\b`).test(temporalResolveFragment),name);
 // History comes from last frame's computed columns, never its reconstruction.
 assert.ok(temporalResolveFragment.includes('(1.-cloudParity)'));
});
