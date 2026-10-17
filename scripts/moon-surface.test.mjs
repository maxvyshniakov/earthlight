import {test} from 'bun:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Libration, GeoVector, Body } from 'astronomy-engine';
import { lunarAxes, lunarFrame, lunarFluxScale, lunarLambertWeight, lunarShape, lunarTier, lunarResolved, LUNAR_RESOLVED_PX } from '../src/scripts/moon-surface.ts';
import { sceneAssetPlan } from '../src/scripts/scene-assets.ts';
import { equatorialFrame } from '../src/scripts/celestial-sky.ts';

const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const degrees=180/Math.PI;

test('selenographic frame puts the libration sub-Earth point toward Earth',()=>{
 for(const iso of ['2026-01-03T00:00:00Z','2026-04-20T12:00:00Z','2026-07-11T06:00:00Z','2026-10-16T02:20:39Z']){
  const date=new Date(iso),[x,y,z]=lunarAxes(date);
  assert.ok(Math.abs(dot(x,y))<1e-12&&Math.abs(dot(y,z))<1e-12&&Math.abs(dot(x,x)-1)<1e-12);
  const m=GeoVector(Body.Moon,date,true),l=Math.hypot(m.x,m.y,m.z),earth=[-m.x/l,-m.y/l,-m.z/l];
  const lon=Math.atan2(dot(earth,y),dot(earth,x))*degrees,lat=Math.asin(dot(earth,z))*degrees;
  const libration=Libration(date);
  assert.ok(Math.abs(lon-libration.elon)<.1,`${iso}: longitude ${lon} vs ${libration.elon}`);
  assert.ok(Math.abs(lat-libration.elat)<.1,`${iso}: latitude ${lat} vs ${libration.elat}`);
 }
});

test('scene frame matrix is the selenographic axes in Earth-fixed coordinates',()=>{
 const date=new Date('2026-10-16T02:20:39Z'),{starToFixed}=equatorialFrame(date);
 const frame=lunarFrame(date,starToFixed);
 for(let i=0;i<3;i++)assert.ok(Math.abs(Math.hypot(...frame.slice(i*3,i*3+3))-1)<1e-9);
 assert.ok(Math.abs(dot(frame.slice(0,3),frame.slice(6,9)))<1e-9);
});

test('resolved disk keeps the sampled Lambert disk flux at every phase',()=>{
 const frame=[1,0,0,0,1,0,0,0,1],moon=[0,0,1];
 // Uniform albedo and a pure Lambert law need no correction.
 for(const phase of [0,30,90,150]){
  const a=phase/degrees,sun=[Math.sin(a),0,-Math.cos(a)];
  assert.ok(Math.abs(lunarFluxScale(moon,sun,frame,0,null)-1)<1e-9);
 }
 // Full Moon, Lommel-Seeliger: radiance is flat at 2/3 of the Lambert peak.
 assert.ok(Math.abs(lunarFluxScale(moon,[0,0,-1],frame,1,null)-2/3)<.01);
 // A bright hemisphere toward the Sun is compensated, not added.
 // Western hemisphere relative albedo 0.5, eastern 1.5.
 const table={width:64,height:32,scale:2.5,data:Uint8Array.from({length:64*32},(_,i)=>i%64<32?51:153)};
 const scale=lunarFluxScale(moon,[0,1,0],[0,0,-1,0,1,0,1,0,0],0,table);
 assert.ok(Math.abs(scale-1/1.5)<.02,`scale ${scale}`);
 assert.ok(scale>0&&scale<1,'brighter lit hemisphere lowers the scale');
 assert.equal(lunarShape(-.1,.5,.5),0);
 assert.equal(lunarLambertWeight(0),1);
 assert.ok(lunarLambertWeight(90)<.25&&lunarLambertWeight(140)===0);
});

test('the map tier follows the on-screen size and never enters startup',()=>{
 assert.equal(lunarTier(113,16384),1024);
 assert.equal(lunarTier(180,16384),2048,"20x at DPR 2 on an 800 px tall viewport");
 assert.equal(lunarTier(450,16384),4096,"50x at DPR 2 on an 800 px tall viewport");
 assert.equal(lunarTier(700,16384),4096);
 assert.equal(lunarTier(700,2048),2048,'never above MAX_TEXTURE_SIZE');
 assert.equal(lunarResolved(LUNAR_RESOLVED_PX[0]),0);
 assert.equal(lunarResolved(LUNAR_RESOLVED_PX[1]),1);
 assert.ok(lunarResolved(4.5)===0,'a 1x Moon stays on the sampled path');
 for(const desktop of [true,false])for(const save of [true,false])
  assert.ok(sceneAssetPlan(desktop,16384,true,save).every(asset=>!asset.url.includes('moon')));
 const background=readFileSync(new URL('../src/scripts/background.ts',import.meta.url),'utf8');
 assert.ok(!/moon-surface|MoonSurface/.test(background));
});

test('the renderer loads the resolved Moon lazily and at the same radius',()=>{
 const renderer=readFileSync(new URL('../src/scripts/scene-renderer.ts',import.meta.url),'utf8');
 assert.ok(!/^import \{[^}]*MoonSurface[^}]*\} from/m.test(renderer),'only a type import is static');
 assert.ok(renderer.includes("import('./moon-surface')"));
 assert.equal(Number(renderer.match(/LUNAR_RESOLVED_FROM=(\d+(?:\.\d+)?)/)[1]),LUNAR_RESOLVED_PX[0]);
});
