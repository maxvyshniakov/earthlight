import { expect, test } from 'bun:test';
import { refractedSource, LIMB_BENDING, SOLAR_ROWS } from '../src/scripts/limb-refraction.ts';
import { visibleSourceDisk } from '../src/scripts/lens-reflections.ts';

const radius=.00465,camera=[0,0,1+428/6371];
// A source at true altitude a (radians) above the solid limb, towards +x.
const at=a=>{const elevation=a-Math.acos(1/camera[2]);return [Math.cos(elevation),0,Math.sin(elevation)];};
const weights=image=>Array.from({length:SOLAR_ROWS},(_,i)=>image.rows[i*4+3]);

test('grazing bending matches twice the horizon refraction',()=>{
  expect(LIMB_BENDING*180/Math.PI).toBeGreaterThan(1.05);
  expect(LIMB_BENDING*180/Math.PI).toBeLessThan(1.2);
});

test('high above the air the image is the unrefracted disk',()=>{
  const image=refractedSource(camera,at(.1),radius);
  expect(image.visibility).toBeCloseTo(1,3);
  expect(image.compression).toBeCloseTo(1,3);
  expect(image.direction[0]*at(.1)[0]+image.direction[2]*at(.1)[2]).toBeCloseTo(1,8);
});

test('refraction lifts, flattens and dims the Sun at the limb',()=>{
  const image=refractedSource(camera,at(0),radius);
  // Half the true disk is below the limb, but refraction lifts all of it.
  expect(visibleSourceDisk(camera,at(0),radius)).toBeCloseTo(.5,2);
  expect(weights(image).every(w=>w>0)).toBe(true);
  // Dilution: the apparent area is smaller than the true one.
  expect(image.visibility).toBeLessThan(.5);
  expect(image.compression).toBeLessThan(.5);
  // The image's centre is above the true centre.
  expect(image.direction[2]).toBeGreaterThan(at(0)[2]);
});

test('the image fades continuously and vanishes behind the limb',()=>{
  let previous=0;
  for(let a=-.03;a<=.02;a+=.0005){
    const v=refractedSource(camera,at(a),radius).visibility;
    expect(v).toBeGreaterThanOrEqual(previous-1e-9);
    expect(v-previous).toBeLessThan(.06);
    previous=v;
  }
  expect(refractedSource(camera,at(-LIMB_BENDING-radius*1.01),radius).visibility).toBe(0);
});

test('rows behind the limb carry no weight and lit rows point above it',()=>{
  const image=refractedSource(camera,at(-LIMB_BENDING),radius);
  const w=weights(image);
  expect(w.slice(0,SOLAR_ROWS/2).every(x=>x===0)).toBe(true);
  expect(w.slice(SOLAR_ROWS/2).every(x=>x>0)).toBe(true);
  const dip=Math.acos(1/camera[2]);
  for(let i=SOLAR_ROWS/2;i<SOLAR_ROWS;i++)expect(Math.asin(image.rows[i*4+2])).toBeGreaterThanOrEqual(-dip-1e-9);
});
