// Lab switch `night=video|still` (docs/lab/physical-night-2026-10-17.md).
// Night emitters at their physical radiance and a camera that reaches the
// exposures of ISS night video and stills. Read once from the page address
// so every shader string, the exposure state encoding and the controls agree.
export type NightMode='current'|'video'|'still';
// A plain match: module sandboxes in the tests have no URLSearchParams.
export function readNightMode(search:string):NightMode{
  const value=/(?:^\?|&)night=([^&]*)/.exec(search)?.[1];
  return value==='video'||value==='still'?value:'current';
}
export const NIGHT_MODE:NightMode=readNightMode(typeof location==='undefined'?'':location.search);
export const PHYSICAL_NIGHT=NIGHT_MODE!=='current';

/** Divisors that bring each night emitter to its physical radiance. The
 * excess of each is measured by the radiance ledger
 * (docs/lab/radiance-ledger-2026-10-16.md) against sourced photometry. */
export const NIGHT_EXCESS={
  /** Black Marble's saturated value at 0.8 cd/m², about 150 nW cm⁻² sr⁻¹
   * in VIIRS DNB: a bright urban core averaged over its 750 m pixels. Set
   * against ISS030-E-10008 (Iberia, EV100 −3.7); tying it to the Las Vegas
   * peak (10–16 cd/m², the world maximum) bloomed every town. */
  city:2e4,
  /** Airglow zenith column at 1.2 × 10⁻⁴ cd/m² (Masana et al. 2021); the
   * limb and the downward light share the same emission model. */
  airglow:1.5e4,
  milkyWay:6e4,
  /** Pogson point sources: stars and planets. */
  stars:8e4,
  /** The constant sky floor under the Milky Way. */
  sky:600,
  aurora:2.4e4,
} as const;
export type NightEmitter=keyof typeof NIGHT_EXCESS;
/** Scale for an emitter in the current mode: 1 unless the lab is on. */
export const nightScale=(emitter:NightEmitter)=>PHYSICAL_NIGHT?1/NIGHT_EXCESS[emitter]:1;
/** The same scale as a GLSL float literal. */
export const nightScaleGlsl=(emitter:NightEmitter)=>nightScale(emitter).toExponential(6).replace(/e\+?/,'e');
