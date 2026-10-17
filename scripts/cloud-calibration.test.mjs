import {test} from 'bun:test';
import assert from 'node:assert/strict';
import {cloudMode} from '../src/scripts/scene-effects.ts';
import {cloudShader} from '../src/scripts/earth-clouds.ts';

test('cloud presets parse, and calibrated is opt-in',()=>{
  const mode=query=>cloudMode(new URLSearchParams(query));
  assert.equal(mode(''),'balanced');
  assert.equal(mode('clouds=calibrated'),'calibrated');
  assert.equal(mode('clouds=original'),'original');
  assert.equal(mode('clouds=off'),'off');
  assert.equal(mode('clouds=broken'),'balanced');
});

test('calibrated column opacity follows NASA composite alpha over dark ocean',()=>{
  // land_ocean_ice_cloud mixes white over the surface in display space with
  // alpha 1-(1-v)^2.6; over dark ocean the linear opacity is that alpha decoded.
  assert.match(cloudShader,/-log\(1\.-\.998\*pow\(coverage,\.7\)\)/);
  const decode=x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4;
  const coverage=v=>{const t=Math.min(1,Math.max(0,(v-.025)/(.94-.025)));return t*t*(3-2*t);};
  for(let v=.1;v<=.9;v+=.05){
    const target=decode(1-(1-v)**2.6),opacity=.998*coverage(v)**.7;
    assert.ok(Math.abs(opacity-target)<.05,`v=${v.toFixed(2)}: ${opacity.toFixed(3)} vs ${target.toFixed(3)}`);
  }
});
