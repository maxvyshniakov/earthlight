import {test} from 'bun:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {NIGHT_MODES,readNightMode} from '../src/scripts/physical-night.ts';
import {sceneShadersFor,vertexSource,fragmentSource,volumeFragment} from '../src/scripts/scene-shader.ts';
import {temporalShadersFor} from '../src/scripts/cloud-temporal.ts';
import {CatalogStars} from '../src/scripts/catalog-stars.ts';
import {CameraFinish} from '../src/scripts/camera-finish.ts';
import {MoonSurface} from '../src/scripts/moon-surface.ts';
import {CloudLightingAtlas} from '../src/scripts/cloud-lighting.ts';
import {OceanField} from '../src/scripts/ocean-prototype.ts';

// Every program a night mode compiles, as the renderer assembles it from the
// mode it was given. The fixture holds the SHA-256 of each source as it was
// built when the mode was read from the address at import (ac56a17).
function sources(mode){
 const all={};
 const batch=prefix=>({add:(name,vertex,fragment)=>{all[`${prefix}${name}:vertex`]=vertex;all[`${prefix}${name}:fragment`]=fragment;return name;}});
 const scene=sceneShadersFor(mode);
 all['scene.vertexSource']=vertexSource;
 for(const key of ['fragmentSource','sourceTransmissionFragment','volumeFragment','halfCloudFragment','halfCloudVolumeFragment'])all[`scene.${key}`]=scene[key];
 const temporal=temporalShadersFor(mode);
 for(const key of ['temporalCloudMain','temporalResolveFragment','temporalCompositeShader'])all[`temporal.${key}`]=temporal[key];
 CatalogStars.prepare(batch(''),mode);
 CameraFinish.prepare(batch(''),mode);
 for(const state of [false,true])for(const lod of [false,true])MoonSurface.prepare(batch(`moon ${state} ${lod} `),state,lod,mode);
 CloudLightingAtlas.prepare(batch(''),'',mode);
 for(const kind of ['field','regions','advected'])OceanField.prepare(batch(`ocean ${kind} `),kind,mode);
 return all;
}
const sha=source=>createHash('sha256').update(source).digest('hex');
const fixture=JSON.parse(readFileSync(new URL('./fixtures/night-mode-sources.json',import.meta.url),'utf8'));

test('every night mode builds the same program sources as when it was read at load',()=>{
 for(const mode of NIGHT_MODES){
  const built=Object.fromEntries(Object.entries(sources(mode)).map(([name,source])=>[name,sha(source)]));
  assert.deepEqual(Object.keys(built).sort(),Object.keys(fixture[mode]).sort(),mode);
  for(const [name,hash] of Object.entries(fixture[mode]))assert.equal(built[name],hash,`${mode} ${name}`);
 }
});

test('the default exports are the default program and the modes share no state',()=>{
 assert.equal(sceneShadersFor('current').fragmentSource,fragmentSource);
 assert.equal(sceneShadersFor('current').volumeFragment,volumeFragment);
 // Building a night program first leaves the default one untouched.
 assert.notEqual(sceneShadersFor('video').fragmentSource,fragmentSource);
 assert.equal(sha(sceneShadersFor('current').fragmentSource),fixture.current['scene.fragmentSource']);
 assert.equal(sceneShadersFor('still'),sceneShadersFor('still'),'built once per mode');
});

test('links choose the mode, and only the night key changes it at runtime',()=>{
 assert.equal(readNightMode(new URLSearchParams('night=still&t=4')),'still');
 assert.equal(readNightMode(new URLSearchParams('night=video')),'video');
 assert.equal(readNightMode(new URLSearchParams('night=1')),'current');
 assert.equal(readNightMode(new URLSearchParams('')),'current');
});

// WebGL2 compiles the same sources as GLSL ES 3.00, where these words are
// keywords or reserved; WebGL1 accepts them as names. Phones that need WebGL2
// (no explicit LOD in WebGL1) failed to compile `float smooth` and `float centroid`.
const RESERVED_ES3=['smooth','flat','centroid','layout','sample','patch','noperspective','invariant','common','partition','active','asm','class','union','enum','typedef','template','this','resource','goto','inline','noinline','public','static','extern','external','interface','long','short','double','half','fixed','unsigned','superp','input','output','filter','sizeof','cast','namespace','using','buffer','shared','coherent','volatile','restrict','readonly','writeonly','subroutine'];
test('no program declares a GLSL ES 3.00 reserved word as a name',()=>{
 const declared=new RegExp(`\\b(?:float|int|uint|bool|vec[234]|ivec[234]|uvec[234]|bvec[234]|mat[234])\\s+(?:${RESERVED_ES3.join('|')})\\b`);
 for(const mode of NIGHT_MODES)for(const [name,source] of Object.entries(sources(mode))){
  const found=source.match(declared);
  assert.equal(found,null,`${mode} ${name}: ${found?.[0]}`);
 }
});
