// Lab switch `night=video|still` (docs/lab/physical-night-2026-10-17.md).
// Night emitters at their physical radiance and a camera that reaches the
// exposures of ISS night video and stills. The mode is a value of the scene
// renderer: every shader source and constant that depends on it is built
// from the mode the renderer was given, so it can switch in place.
export type NightMode='current'|'video'|'still';
export const NIGHT_MODES:readonly NightMode[]=['current','video','still'];
/** The mode a page address asks for: `night=video|still`, otherwise the
 * default program. A plain match: module sandboxes in the tests have no
 * URLSearchParams. */
export function readNightMode(search:string|{get(key:string):string|null}):NightMode{
  const value=typeof search==='string'?/(?:^\?|&)night=([^&]*)/.exec(search)?.[1]:search.get('night');
  return value==='video'||value==='still'?value:'current';
}
/** Whether a mode renders physical night. */
export const physicalNight=(mode:NightMode)=>mode!=='current';
/** One build per mode: shader sources are assembled once for each mode a
 * renderer asks for, and the default program's are the same strings as
 * before night mode became a runtime value. */
export function perNightMode<T>(build:(mode:NightMode)=>T):(mode:NightMode)=>T{
  const built=new Map<NightMode,T>();
  return mode=>{
    if(!built.has(mode))built.set(mode,build(mode));
    return built.get(mode)!;
  };
}

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
  /** Lightning was set by eye against the default program's cities, so it
   * shares their divisor: the flash-to-city ratio of the accepted view
   * stays. Left out, flashes bloomed 2 × 10⁴ times too bright. Not yet
   * calibrated against LIS/GLM optical energies. */
  lightning:2e4,
} as const;
export type NightEmitter=keyof typeof NIGHT_EXCESS;
/** Scale for an emitter in a mode: 1 unless physical night is on. */
export const nightScale=(emitter:NightEmitter,mode:NightMode)=>physicalNight(mode)?1/NIGHT_EXCESS[emitter]:1;
/** The same scale as a GLSL float literal. */
export const nightScaleGlsl=(emitter:NightEmitter,mode:NightMode)=>nightScale(emitter,mode).toExponential(6).replace(/e\+?/,'e');
