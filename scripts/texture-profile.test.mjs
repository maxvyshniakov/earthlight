import {test} from 'bun:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {textureProfile,galaxyIrradianceLod} from '../src/scripts/texture-profile.ts';
import {sceneAssetPlan} from '../src/scripts/scene-assets.ts';
import {comparisonProfileGroups,sceneProfile} from '../src/scripts/scene-profile.ts';

test('compact textures change only the opt-in galaxy refinement',()=>{
  for(const value of ['','texture=unknown','texture=__proto__'])assert.equal(textureProfile(new URLSearchParams(value)),'reference');
  assert.equal(textureProfile(new URLSearchParams('texture=compact')),'compact');
  const reference=sceneAssetPlan(true,8192,true,false,false);
  const compact=sceneAssetPlan(true,8192,true,false,false,true);
  assert.deepEqual(reference.filter(x=>x.key!=='galaxy'),compact.filter(x=>x.key!=='galaxy'));
  assert.deepEqual(reference.filter(x=>x.preview),compact.filter(x=>x.preview));
  assert.ok(compact.some(x=>x.url.endsWith('/mobile/galaxy-2048.avif')));
  assert.deepEqual(sceneAssetPlan(false,4096,true,true,false,true),sceneAssetPlan(false,4096,true,true,false,false));
});

test('irradiance lookup keeps the original angular footprint across overviews',()=>{
  for(const width of [1024,2048,4096])assert.equal(width/(2**galaxyIrradianceLod(width)),64);
  assert.equal(galaxyIrradianceLod(1),0);
});

test('compact galaxy asset has the requested storage size and close broad lighting',async()=>{
  const root=new URL('../public/media/orbit/',import.meta.url);
  const source=new URL('milky-way.avif',root).pathname,compact=new URL('mobile/galaxy-2048.avif',root).pathname;
  const info=await sharp(compact).metadata();assert.equal(info.width,2048);assert.equal(info.height,1024);
  const pixels=path=>sharp(path).removeAlpha().resize(64,32,{kernel:'lanczos3'}).raw().toBuffer();
  const a=await pixels(source),b=await pixels(compact);
  let max=0;for(let i=0;i<a.length;i++)max=Math.max(max,Math.abs(a[i]-b[i]));
  assert.ok(max<=2,`broad lighting footprint byte error ${max}`);
});

test('comparison menu keeps current profiles and archived links fall back to Compact',()=>{
  assert.deepEqual(comparisonProfileGroups.flatMap(group=>group.names),['reference','compact','clouds-half','split','lighting']);
  for(const name of ['density','atmosphere','combined','optimized','shadows','balanced','eco'])
    assert.equal(sceneProfile(new URLSearchParams({render:name})).name,'compact');
  assert.equal(sceneProfile(new URLSearchParams()).name,'compact');
});
