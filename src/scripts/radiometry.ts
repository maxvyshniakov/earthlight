import { SOLAR_IRRADIANCE } from './solar-light';

// The scene is in relative radiance: sunlight at 1 AU has irradiance
// SOLAR_IRRADIANCE. This ledger ties that scale to photometry so every
// emitter can be compared with what a camera in orbit would record.
// scripts/radiance-ledger.mjs measures the scene against it.

/** Luminous solar constant: illuminance of sunlight at 1 AU above the
 * atmosphere (Darula, Kittler & Gueymard 2005, Solar Energy 79, 559). */
export const SOLAR_ILLUMINANCE_LUX=133300;
/** Luminance in cd/m² of one unit of scene radiance (~6.1 × 10⁴). */
export const SCENE_CANDELA=SOLAR_ILLUMINANCE_LUX/SOLAR_IRRADIANCE;

type Measured=Record<string,Record<string,number>>;
export type LedgerEntry={
  id:string;
  label:string;
  /** Physical range: luminance in cd/m², or a flux ratio to the Sun. */
  physical:[number,number];
  unit:'cd/m2'|'ratioToSun';
  /** Where the range comes from; docs/lab/radiance-ledger-2026-10-16.md
   * has the derivations and links. */
  source:string;
  /** Scene value from the ledger measurement: scene radiance, or a flux
   * ratio to the Sun. */
  measure:(m:Measured)=>number;
};

// Ranges are the physical values for the measured views, not universal
// limits. Moon: phase angle 115° in its view, lit part 29% of the disk.
export const RADIANCE_LEDGER:LedgerEntry[]=[
  {id:'sunDisk',label:'Solar disk, mean',physical:[1.85e9,2.05e9],unit:'cd/m2',
    source:'E/Ω with E = 128–133 klx and the IAU 2015 solar radius; ±3% over the year',measure:m=>m.sunDisk.radiance},
  {id:'cloud',label:'Sunlit cloud tops (p99, Sun overhead)',physical:[2.5e4,4e4],unit:'cd/m2',
    source:'Lambertian a·E/π with visible albedo 0.6–0.93 (Wood 2012, MWR 140, 2373)',measure:m=>m.earthDay.p99},
  {id:'ground',label:'Sunlit Earth, typical (p50)',physical:[2e3,1.3e4],unit:'cd/m2',
    source:'ocean albedo ~0.05 to land 0.14–0.3 (NASA; Jin et al. 2004), broadband',measure:m=>m.earthDay.p50},
  {id:'moon',label:'Lunar surface, lit part (p50)',physical:[400,750],unit:'cd/m2',
    source:'full-Moon disk 4 900 cd/m² (Schmidt 2009) with the Krisciunas & Schaefer 1991 phase law at 115°, over the 29% lit; ±30%',measure:m=>m.moon.p50},
  {id:'city',label:'City lights, bright core (p99)',physical:[.5,16],unit:'cd/m2',
    source:'VIIRS DNB: Las Vegas peak 2 800 nW cm⁻² sr⁻¹ (Elvidge 2017) ≈ 10–16 cd/m², the world maximum; lower bound ~100 nW is an estimate',measure:m=>m.cityNight.p99},
  {id:'aurora',label:'Aurora, bright (p99)',physical:[.019,.19],unit:'cd/m2',
    source:'IBC III–IV, 100–1000 kR at 557.7 nm, 1.93 × 10⁻⁴ cd/m² per kR; oblique enhancement unsourced',measure:m=>m.aurora.p99},
  {id:'airglow',label:'Airglow at the limb (p99)',physical:[3e-3,7e-3],unit:'cd/m2',
    source:'V-band airglow 1.2 × 10⁻⁴ cd/m² at zenith (Masana et al. 2021) × 35–56 edge-on (Koomen et al. 1971; layer geometry)',measure:m=>m.airglowLimb.p99},
  {id:'milkyWay',label:'Milky Way, bright (p90)',physical:[1e-3,2e-3],unit:'cd/m2',
    source:'19.6 mag/arcsec² ≈ 1.5 × 10⁻³ cd/m² (NPS night-sky metrics)',measure:m=>m.milkyWay.p90},
  {id:'sky',label:'Dark sky above the airglow (p50)',physical:[5e-5,3e-4],unit:'cd/m2',
    source:'zodiacal light, starlight and galactic light, 1.4 × 10⁻⁴ cd/m² mid-latitude (Masana et al. 2021; Leinert et al. 1998)',measure:m=>m.emptySky.p50},
  {id:'star',label:'Magnitude-0 star, flux / Sun',physical:[1.85e-11,2e-11],unit:'ratioToSun',
    source:'2.54 × 10⁻⁶ lx (Allen) over 128–133 klx',measure:m=>m.stars.ratioToSun},
];

/** The physical range in scene units (or as a flux ratio). */
export function expectedSceneRadiance(entry:LedgerEntry):[number,number]{
  return entry.unit==='cd/m2'?[entry.physical[0]/SCENE_CANDELA,entry.physical[1]/SCENE_CANDELA]:entry.physical;
}
