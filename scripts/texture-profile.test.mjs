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
  const root=new URL('../public/media/earthlight/',import.meta.url);
  const source=new URL('milky-way.avif',root).pathname,compact=new URL('mobile/galaxy-2048.avif',root).pathname;
  const info=await sharp(compact).metadata();assert.equal(info.width,2048);assert.equal(info.height,1024);
  // Compare 64 x 32 block means of displayed radiance, pow(texel, 3.3), which
  // is what diffuse lighting integrates; resizing encoded bytes dims detail.
  const blocks=async path=>{const {data,info}=await sharp(path).removeAlpha().raw().toBuffer({resolveWithObject:true});
    const out=new Float64Array(64*32*3),size=info.width/64;
    for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++)for(let c=0;c<3;c++)out[(Math.floor(y/size)*64+Math.floor(x/size))*3+c]+=(data[(y*info.width+x)*3+c]/255)**3.3/size**2;
    return out;};
  const a=await blocks(source),b=await blocks(compact);
  let max=0;for(let i=0;i<a.length;i++)if(a[i]>1e-3)max=Math.max(max,Math.abs(Math.log(b[i]/a[i])));
  assert.ok(max<=Math.log(1.05),`broad lighting radiance error ${(Math.exp(max)-1)*100}%`);
});

test('comparison menu keeps current profiles and archived links fall back to Compact',()=>{
  assert.deepEqual(comparisonProfileGroups.flatMap(group=>group.names),['reference','compact','clouds-half','split','lighting']);
  for(const name of ['density','atmosphere','combined','optimized','shadows','balanced','eco'])
    assert.equal(sceneProfile(new URLSearchParams({render:name})).name,'compact');
  assert.equal(sceneProfile(new URLSearchParams()).name,'compact');
});
