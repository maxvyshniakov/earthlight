import {test} from 'bun:test';
import assert from 'node:assert/strict';
import {LENS_PRESETS,LENS_STRONGEST_PATH,lensReflectance,readLensPreset} from '../src/scripts/lens-reflections.ts';

test('the ISS lens is the default and the flare-prone preset reflects 30 times more',()=>{
  assert.equal(readLensPreset(null),'iss');
  assert.equal(readLensPreset('unknown'),'iss');
  assert.equal(readLensPreset('flare'),'flare');
  assert.equal(LENS_PRESETS.iss.strongestPath,LENS_STRONGEST_PATH);
  assert.equal(lensReflectance('iss'),1);
  assert.ok(Math.abs(lensReflectance('flare')-30)<1e-9);
  // A ghost is two reflections: per surface about 0.5% coated, 2.7% for the
  // flare-prone lens, as with a single-layer coating; below bare glass's 4%.
  const perSurface=preset=>Math.sqrt(LENS_PRESETS[preset].strongestPath);
  assert.ok(perSurface('iss')>.004&&perSurface('iss')<.006);
  assert.ok(perSurface('flare')>.02&&perSurface('flare')<.04);
});
