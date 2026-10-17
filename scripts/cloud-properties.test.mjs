import {test} from 'bun:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CLOUD_PROPERTIES_DATE,CLOUD_PROPERTIES_OVERVIEW,CLOUD_PROPERTIES_PENDING,cloudPropertiesDate,cloudPropertiesDay,cloudPropertiesEnabled,cloudPropertiesShader,cloudPropertiesURL} from '../src/scripts/cloud-properties.ts';
import {cloudShader} from '../src/scripts/earth-clouds.ts';
import {fragmentSource} from '../src/scripts/scene-shader.ts';

test('measured clouds are an opt-in study',()=>{
  assert.equal(cloudPropertiesEnabled(new URLSearchParams('')),false);
  assert.equal(cloudPropertiesEnabled(new URLSearchParams('cloudStudy=modis')),false);
  assert.equal(cloudPropertiesEnabled(new URLSearchParams('cloudStudy=global')),true);
  assert.ok(cloudShader.includes(cloudPropertiesShader));
  // Every density entry point, including the view ray's ellipse-filtered one,
  // returns the measured column: the plates' column must never draw them.
  const entries=[...cloudShader.matchAll(/float cloudIntegratedDensity\([^)]*\)\{([\s\S]*?)\n\}/g)];
  assert.ok(entries.length>=2);
  for(const [,body] of entries)assert.match(body,/#ifdef CLOUD_PROPERTIES\n  return cloudPropertiesDensity\(point,footprint,detailed,halfSpan\);/);
});

// JavaScript mirrors of the shader's column and layer functions.
const layer=(base,top,height,halfSpan)=>{
  const clamp=x=>Math.min(1,Math.max(0,x)),s=x=>x*x*(3-2*x);
  if(halfSpan<=1e-4){const z=clamp((height-base)/(top-base));return 6*z*(1-z)/(top-base);}
  return (s(clamp((height+halfSpan-base)/(top-base)))-s(clamp((height-halfSpan-base)/(top-base))))/(2*halfSpan);
};
const column=(opacity,top,ice)=>{
  const smooth=(a,b,x)=>{const t=Math.min(1,Math.max(0,(x-a)/(b-a)));return t*t*(3-2*t);};
  const tau=Math.min(opacity,.995)/((.13+(.2165-.13)*ice)*(1-Math.min(opacity,.995)));top=Math.min(11.8,Math.max(.9,top));
  const liquid=Math.min(2.5,Math.max(.25,.25+.04*tau));
  const glaciated=1.5+(Math.max(1.5,top-1.5)-1.5)*smooth(6,30,tau)*smooth(6,9,top);
  return [Math.max(.6,top-(liquid+(glaciated-liquid)*ice)),top];
};
const albedo=(tau,ice=0)=>{const c=.13+(.2165-.13)*ice;return c*tau/(1+c*tau);};

test('every ray step preserves the measured column optical depth',()=>{
  assert.match(cloudPropertiesShader,/-log\(1\.-min\(field\.r,\.995\)\)\*cloudPropertiesLayer/);
  for(const [base,top] of [[.6,.9],[1.2,1.6],[9.5,11],[1.5,11.8]])for(const step of [.05,.3,.65,1.4]){
    let sum=0;for(let h=0;h<13;h+=step)sum+=layer(base,top,h+step/2,step/2)*step;
    assert.ok(Math.abs(sum-1)<1e-9,`${base}-${top} km at ${step} km: ${sum}`);
  }
  for(const tau of [1,5,20,80])for(const [ice,c] of [[0,.13],[1,.2165]])assert.ok(Math.abs(-Math.log(1-albedo(tau,ice))-Math.log(1+c*tau))<1e-12);
});

test('cloud types take distinct depths from measured properties',()=>{
  const [scBase,scTop]=column(albedo(10),1.4,0);
  assert.ok(scTop-scBase<.8,'a stratocumulus deck stays shallow');
  const [ciBase,ciTop]=column(albedo(1,1),10.5,1);
  assert.ok(Math.abs(ciTop-ciBase-1.5)<1e-9,'thin cirrus is a 1.5 km sheet');
  const [cbBase]=column(albedo(60,1),11.8,1);
  assert.ok(cbBase<=1.6,'deep convection reaches down to the boundary layer');
});

test('measured columns are lit by what lies beyond their own layer',()=>{
  // A uniform layer's own sun-path depth is compensated; anything more shades.
  assert.match(cloudPropertiesShader,/float above=-log\(1\.-min\(field\.r,\.995\)\)\*\(1\.-z\*z\*\(3\.-2\.\*z\)\);/);
  assert.match(cloudPropertiesShader,/return min\(1\.,transmission\*exp\(above\/mu\)\);/);
  assert.match(cloudShader,/#ifdef CLOUD_PROPERTIES\n      if\(sunVisible>\.5\)shadow=cloudPropertiesIllumination\(point,footprint,shadow\);/);
  const ice=albedo(10,1),liquid=albedo(10,0);
  assert.ok(ice>liquid,'the same retrieved tau of ice reflects more');
});

test('measured columns dim with the Sun like plane-parallel clouds',()=>{
  // Mirror of cloudPropertiesSolarLaw on the shared .48+.38 cos θ0 term.
  const law=mu=>{const m=Math.min(1,Math.max(.1,mu));return .86*m**1.19/(.48+.38*m);};
  const radiance=mu=>law(mu)*(.48+.38*mu)/.86;
  assert.match(cloudPropertiesShader,/return \.86\*pow\(m,1\.19\)\/\(\.48\+\.38\*m\);/);
  assert.match(cloudShader,/solarLaw=cloudPropertiesSolarLaw\(mu\);\n#endif/);
  assert.match(cloudShader,/sunColor\*sunVisible\*solarLaw\*\(\.20\+\.80\*shadow\)\*\(\.48\+\.38\*max\(0\.,mu\)\)/);
  // Overhead light is unchanged; below, the law only dims and falls steadily.
  assert.ok(Math.abs(law(1)-1)<1e-12);
  for(let mu=.1;mu<1;mu+=.05)assert.ok(law(mu)<1&&law(mu)<law(mu+.05));
  // Nadir radiance relative to an overhead Sun, μ0 R(μ0)/R(1), of Henyey-
  // Greenstein slabs of τ 32 and 64 over a black sea (g 0.85 liquid, 0.75
  // ice), from docs/lab/cloud-properties-sun-zenith-2026-10-17.md.
  for(const [mu,target] of [[.8,.791],[.5,.452],[.5,.436],[.3,.239],[.3,.226],[.5,.444],[.3,.232],[.5,.435],[.3,.228]])
    assert.ok(Math.abs(Math.log(radiance(mu)/target))<.07,`${mu}: ${radiance(mu)} vs ${target}`);
  // The default renderer has no solar law.
  assert.match(cloudShader,/float solarLaw=1\.;\n#ifdef CLOUD_PROPERTIES\n/);
});

test('the overview alpha carries observed and sea ice without crossing branches',()=>{
  // Mirrors of prepare-cloud-properties.mjs and cloudPropertiesSeaIce.
  const encode=(observed,ice)=>Math.round((observed?.3+.7*ice:.15*ice)*255);
  const decode=byte=>{const a=byte/255;return {observed:a>=.225,ice:Math.min(1,Math.max(0,a<.225?a/.15:(a-.3)/.7))};};
  assert.match(cloudPropertiesShader,/float cloudPropertiesObserved\(float a\)\{return step\(\.225,a\);\}/);
  assert.match(cloudPropertiesShader,/return clamp\(a<\.225\?a\/\.15:\(a-\.3\)\/\.7,0\.,1\.\);/);
  // AVIF quality 80 leaves an RMS error near 6/255; three times that never flips the branch.
  for(const observed of [true,false])for(let k=0;k<=20;k++)for(const error of [-18,0,18]){
    const ice=k/20,read=decode(Math.min(255,Math.max(0,encode(observed,ice)+error)));
    assert.equal(read.observed,observed);
    if(!error)assert.ok(Math.abs(read.ice-ice)<.02);
  }
  // A version-1 overview (observed fraction) would read as ice on every sea.
  assert.equal(CLOUD_PROPERTIES_OVERVIEW,'overview-v2.avif');
  // Only the measured study lays sea ice on the water, and the glint leaves with it.
  assert.match(fragmentSource,/#ifdef CLOUD_PROPERTIES\n[^#]*float seaIce=water\*cloudPropertiesSeaIce\(mapUV,[^\n]*\n[^#]*water-=seaIce;\n#endif/);
});

test('comparison views sit at their altitudes and dates',()=>{
  for(const [view,km,epoch] of [['disc',50000,'2026-09-22T11:20:00Z'],['region',2000,'2026-09-22T11:20:00Z'],['iss',420,'2026-09-22T11:13:13Z'],['deck',420,'2026-09-22T11:20:00Z']]){
    const url=cloudPropertiesURL('http://localhost/',view);
    const position=url.searchParams.get('position').split(',').map(Number);
    assert.ok(Math.abs((Math.hypot(...position)-1)*6371-km)<1e-6);
    assert.equal(url.searchParams.get('epoch'),epoch);
    assert.equal(url.searchParams.get('cloudStudy'),'global');
  }
});

test('the measured day follows the scene epoch and falls back to the default day',()=>{
  assert.deepEqual(cloudPropertiesDay(new Date('2026-09-22T00:00:00Z')),{date:'2026-09-22',measured:true});
  assert.deepEqual(cloudPropertiesDay(new Date('2026-09-22T23:59:59Z')),{date:'2026-09-22',measured:true});
  // A neighbouring day is another sky: no nearest-day substitution.
  for(const date of ['2026-09-21T23:59:59Z','2026-09-23T00:00:00Z','2027-03-05T12:00:00Z',NaN])
    assert.deepEqual(cloudPropertiesDay(new Date(date)),{date:CLOUD_PROPERTIES_DATE,measured:false});
  // The scene's date is epoch plus the scene time t, in UTC.
  assert.deepEqual(cloudPropertiesDate(new URLSearchParams('epoch=2026-09-22T23:00:00Z&t=0')),{date:'2026-09-22',measured:true});
  assert.deepEqual(cloudPropertiesDate(new URLSearchParams('epoch=2026-09-22T23:00:00Z&t=7200')),{date:CLOUD_PROPERTIES_DATE,measured:false});
  assert.deepEqual(cloudPropertiesDate(new URLSearchParams('epoch=2026-09-21T23:00:00Z&t=7200')),{date:'2026-09-22',measured:true});
  // Without an epoch the scene runs at the present: the default day stands in.
  assert.deepEqual(cloudPropertiesDate(new URLSearchParams('t=0'),Date.parse('2026-10-17T09:00:00Z')),{date:CLOUD_PROPERTIES_DATE,measured:false});
  for(const view of ['disc','region','iss','deck'])assert.equal(cloudPropertiesDate(cloudPropertiesURL('http://localhost/',view).searchParams).measured,true);
});

test('measured clouds load clear, never as sea ice',()=>{
  // Mirrors of cloudPropertiesObserved and cloudPropertiesSeaIce on the placeholder texel.
  const [r,,,a]=CLOUD_PROPERTIES_PENDING.map(x=>x/255),ice=x=>Math.min(1,Math.max(0,x<.225?x/.15:(x-.3)/.7));
  assert.equal(r,0);
  assert.ok(a<.225,'unobserved');
  assert.equal(ice(a),0,'no sea ice');
  assert.equal(ice(1),1,'the plates\' opaque placeholder read as ice on every sea');
  const renderer=readFileSync(new URL('../src/scripts/scene-renderer.ts',import.meta.url),'utf8');
  assert.match(renderer,/new Uint8Array\(cloudProperties&&name==='cloudMap'\?CLOUD_PROPERTIES_PENDING:\[0,0,0,255\]\)/);
  // Tiles wait for the overview, which carries the measured heights.
  assert.match(cloudPropertiesShader,/if\(detailed&&cloudMapWidth>1\.\)field\.r=detailedCloud/);
});
