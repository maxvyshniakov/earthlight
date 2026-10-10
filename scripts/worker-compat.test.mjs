import {test} from 'bun:test';
import assert from 'node:assert/strict';
import {terrainResponse} from '../server/terrain-source.mjs';
import {isSelectedPath,sanitizeImportedText} from './extraction-manifest.mjs';

test('terrain proxy refuses redirects without following them in edge runtimes',async()=>{
  for(const status of [301,302,303,307,308]){
    let calls=0,cancelled=false;
    const response=await terrainResponse(new Request('https://earthlight.test/media/orbit/dem90/N41W114.tif'),async(url,options)=>{
      calls++;
      assert.equal(options.redirect,'manual','edge runtimes support manual and follow, but reject error');
      assert.equal(new URL(url).hostname,'copernicus-dem-90m.s3.amazonaws.com');
      return new Response(new ReadableStream({cancel(){cancelled=true;}}),{status,headers:{location:'https://unexpected.example/terrain.tif'}});
    });
    assert.equal(response.status,502);
    assert.equal(await response.text(),'Terrain unavailable');
    assert.equal(calls,1,'redirect destination must never be fetched');
    assert.equal(cancelled,true,'discard the upstream redirect body');
  }
});

test('site sync preserves the edge-compatible redirect policy and its independent proof',()=>{
  assert.equal(isSelectedPath('scripts/worker-compat.test.mjs'),false);
  for(const [path,original,expected] of [
    ['server/terrain-source.mjs',"fetcher(url,{redirect:'error',signal:request.signal})","fetcher(url,{redirect:'manual',signal:request.signal})"],
    ['scripts/terrain-detail.test.mjs',"assert.equal(options.redirect,'error')","assert.equal(options.redirect,'manual')"],
  ]){
    assert.equal(sanitizeImportedText(path,original),expected);
    assert.equal(sanitizeImportedText(path,expected),expected);
  }
});
