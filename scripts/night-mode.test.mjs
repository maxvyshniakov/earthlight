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
