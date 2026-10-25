import {test} from 'bun:test';
import assert from 'node:assert/strict';
import {cloudMode} from '../src/scripts/scene-effects.ts';
import {cloudShader} from '../src/scripts/earth-clouds.ts';

test('cloud presets parse, and calibrated is the default',()=>{
  const mode=query=>cloudMode(new URLSearchParams(query));
  assert.equal(mode(''),'calibrated');
  assert.equal(mode('clouds=calibrated'),'calibrated');
  assert.equal(mode('clouds=balanced'),'balanced');
  assert.equal(mode('clouds=original'),'original');
  assert.equal(mode('clouds=off'),'off');
  assert.equal(mode('clouds=broken'),'calibrated');
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

test('photographic empty-space bounds preserve the complete feathered envelope',()=>{
 const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
 for(const coverage of [0,.01,.1,.15,.32,.78,.95,1])for(const neighbor of [0,.01,.15,.32,.78,.95,1]){
  const connected=smooth(.32,.78,Math.min(coverage,neighbor)),amplitude=.65+(.12-.65)*connected;
  const base=.8+.3*neighbor,nominal=2+5.5*smooth(.15,.95,neighbor)+smooth(.1,1,coverage);
  const upper=nominal+.5*amplitude+.45;
  for(const noise of [0,.25,.5,.75,1]){
   const top=nominal+(noise-.5)*amplitude,thickness=top-base;
   const bottomFeather=Math.min(.7,thickness*.35),topFeather=Math.min(.9,thickness*.45);
   for(const height of [.6,.8,base,upper,upper+.001,9.275,12]){
    if(height>.8&&height<9.275&&height>base&&height<upper)continue;
    const profile=smooth(base,base+bottomFeather,height)*(1-smooth(top-topFeather,top+topFeather*.5,height));
    assert.equal(profile,0,JSON.stringify({coverage,neighbor,noise,height}));
   }
  }
 }
});
