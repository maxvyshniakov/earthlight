import {test} from 'bun:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {browserModule} from './browser-module.mjs';

test('GPU fixtures load production class dependencies and optical JSON',async()=>{
 for(const [name,key] of [['catalog-stars','CatalogStars'],['camera-exposure','CameraExposure'],['aurora','Aurora'],['camera-finish','CameraFinish']]){
  const exports=runInNewContext(await browserModule(name));
  assert.equal(typeof exports[key],'function',name);
 }
 const {optics,opticalPsfSource}=runInNewContext(await browserModule('optical-psf'));
 assert.ok(optics.integral>0);
 assert.ok(opticalPsfSource.includes('float'));
});

test('aurora convergence reference builds the production integral with more steps',async()=>{
 const {auroraShader,auroraShaderForSteps}=runInNewContext(await browserModule('aurora'));
 assert.ok(auroraShader.includes('(end-start)/128.'));
 const reference=auroraShaderForSteps(384);
 assert.ok(reference.includes('(end-start)/384.'));
 assert.ok(reference.includes('i<384;'));
 assert.ok(!reference.includes('(end-start)/128.'));
});

test('fixture module cannot load files outside src',async()=>{
 await assert.rejects(browserModule('../../package.json'),/escapes src/);
});
