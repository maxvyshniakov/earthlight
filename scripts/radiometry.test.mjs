import {test,expect} from 'bun:test';
import {RADIANCE_LEDGER,SCENE_CANDELA,expectedSceneRadiance} from '../src/scripts/radiometry.ts';
import {SOLAR_IRRADIANCE,SOLAR_RADIANCE} from '../src/scripts/solar-light.ts';

const entry=id=>RADIANCE_LEDGER.find(e=>e.id===id);
const within=(value,[lo,hi])=>value>=lo&&value<=hi;

test('every ledger entry names its source and a positive range',()=>{
 for(const e of RADIANCE_LEDGER){
  expect(e.source.length).toBeGreaterThan(20);
  expect(e.physical[0]).toBeGreaterThan(0);
  expect(e.physical[1]).toBeGreaterThan(e.physical[0]);
 }
});

test('the scene scale anchors the Sun and sunlit cloud to photometry',()=>{
 // Solar disk radiance follows from the scene irradiance and disk size.
 expect(within(SOLAR_RADIANCE,expectedSceneRadiance(entry('sunDisk')))).toBe(true);
 // A Lambertian cloud of visible albedo 0.8 under the overhead Sun.
 expect(within(.8*SOLAR_IRRADIANCE/Math.PI,expectedSceneRadiance(entry('cloud')))).toBe(true);
 expect(SCENE_CANDELA).toBeGreaterThan(5.8e4);
 expect(SCENE_CANDELA).toBeLessThan(6.2e4);
});
