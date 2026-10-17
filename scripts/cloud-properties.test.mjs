import {test} from 'bun:test';
import assert from 'node:assert/strict';
import {cloudPropertiesEnabled,cloudPropertiesShader,cloudPropertiesURL} from '../src/scripts/cloud-properties.ts';
import {cloudShader} from '../src/scripts/earth-clouds.ts';

test('measured clouds are an opt-in study',()=>{
  assert.equal(cloudPropertiesEnabled(new URLSearchParams('')),false);
  assert.equal(cloudPropertiesEnabled(new URLSearchParams('cloudStudy=modis')),false);
  assert.equal(cloudPropertiesEnabled(new URLSearchParams('cloudStudy=global')),true);
  assert.ok(cloudShader.includes(cloudPropertiesShader));
  assert.match(cloudShader,/#ifdef CLOUD_PROPERTIES\n  return cloudPropertiesDensity\(point,footprint,detailed,halfSpan\);/);
});

// JavaScript mirrors of the shader's column and layer functions.
const layer=(base,top,height,halfSpan)=>{
  const clamp=x=>Math.min(1,Math.max(0,x)),s=x=>x*x*(3-2*x);
  if(halfSpan<=1e-4){const z=clamp((height-base)/(top-base));return 6*z*(1-z)/(top-base);}
  return (s(clamp((height+halfSpan-base)/(top-base)))-s(clamp((height-halfSpan-base)/(top-base))))/(2*halfSpan);
};
const column=(opacity,top,ice)=>{
  const smooth=(a,b,x)=>{const t=Math.min(1,Math.max(0,(x-a)/(b-a)));return t*t*(3-2*t);};
  const tau=Math.min(opacity,.995)/(.13*(1-Math.min(opacity,.995)));top=Math.min(11.8,Math.max(.9,top));
  const liquid=Math.min(2.5,Math.max(.25,.25+.04*tau));
  const glaciated=1.5+(Math.max(1.5,top-1.5)-1.5)*smooth(6,30,tau)*smooth(6,9,top);
  return [Math.max(.6,top-(liquid+(glaciated-liquid)*ice)),top];
};
const albedo=tau=>.13*tau/(1+.13*tau);

test('every ray step preserves the measured column optical depth',()=>{
  assert.match(cloudPropertiesShader,/-log\(1\.-min\(field\.r,\.995\)\)\*cloudPropertiesLayer/);
  for(const [base,top] of [[.6,.9],[1.2,1.6],[9.5,11],[1.5,11.8]])for(const step of [.05,.3,.65,1.4]){
    let sum=0;for(let h=0;h<13;h+=step)sum+=layer(base,top,h+step/2,step/2)*step;
    assert.ok(Math.abs(sum-1)<1e-9,`${base}-${top} km at ${step} km: ${sum}`);
  }
  for(const tau of [1,5,20,80])assert.ok(Math.abs(-Math.log(1-albedo(tau))-Math.log(1+.13*tau))<1e-12);
});

test('cloud types take distinct depths from measured properties',()=>{
  const [scBase,scTop]=column(albedo(10),1.4,0);
  assert.ok(scTop-scBase<.8,'a stratocumulus deck stays shallow');
  const [ciBase,ciTop]=column(albedo(1),10.5,1);
  assert.ok(Math.abs(ciTop-ciBase-1.5)<1e-9,'thin cirrus is a 1.5 km sheet');
  const [cbBase]=column(albedo(60),11.8,1);
  assert.ok(cbBase<=1.6,'deep convection reaches down to the boundary layer');
});

test('comparison views sit at their altitudes and dates',()=>{
  for(const [view,km,epoch] of [['disc',50000,'2026-09-22T11:20:00Z'],['region',2000,'2026-09-22T11:20:00Z'],['iss',420,'2026-09-22T11:13:13Z']]){
    const url=cloudPropertiesURL('http://localhost/',view);
    const position=url.searchParams.get('position').split(',').map(Number);
    assert.ok(Math.abs((Math.hypot(...position)-1)*6371-km)<1e-6);
    assert.equal(url.searchParams.get('epoch'),epoch);
    assert.equal(url.searchParams.get('cloudStudy'),'global');
  }
});
