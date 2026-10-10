import test from 'node:test';
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

test('independent aurora reference changes only its requested module',async()=>{
 const {auroraShader}=runInNewContext(await browserModule('aurora',{transform:(source,id)=>id==='scripts/aurora.ts'?source.replace('(end-start)/128.','(end-start)/384.'):source}));
 assert.ok(auroraShader.includes('(end-start)/384.'));
 assert.ok(!auroraShader.includes('(end-start)/128.'));
});

test('fixture module cannot load files outside src',async()=>{
 await assert.rejects(browserModule('../../package.json'),/escapes src/);
});
