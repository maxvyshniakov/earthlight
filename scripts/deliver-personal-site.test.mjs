import {test} from 'bun:test';
import assert from 'node:assert/strict';
import {deliveryPath,validateRevision,deliver} from './deliver-personal-site.mjs';

test('delivery stages only the package, lockfiles and Earthlight archives',()=>{
  for(const path of ['package.json','bun.lock','earthlight.lock.json','vendor/earthlight-0.2.0-abcdef0123456789.tgz'])assert.equal(deliveryPath(path),true);
  for(const path of ['.github/workflows/deploy.yml','wrangler.jsonc','src/pages/index.astro','vendor/other.tgz','vendor/../package.json','vendor/earthlight-x.tgz/secret'])assert.equal(deliveryPath(path),false);
});
test('provenance accepts only full immutable commit IDs',()=>{
  const revision='a'.repeat(40);assert.equal(validateRevision(revision),revision);
  for(const value of ['main','a3abed2','a'.repeat(39),'A'.repeat(40),'a'.repeat(40)+'\n'])assert.throws(()=>validateRevision(value));
});
test('delivery cannot mutate an ordinary local checkout',async()=>{
  const previous=process.env.CI;delete process.env.CI;
  try{await assert.rejects(deliver('/unused'),/only in the Earthlight/);}
  finally{if(previous!==undefined)process.env.CI=previous;}
});
