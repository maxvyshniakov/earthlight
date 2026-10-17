import { PHYSICAL_NIGHT } from './physical-night';
/** Lunar irradiance relative to full Moon at a phase angle in radians. The
 * night lab uses the measured law of Krisciunas & Schaefer (1991), which
 * has the opposition surge: a quarter Moon gives 9%, not a Lambert sphere's 32%. */
export function lunarPhaseIrradiance(angle:number){
  if(!PHYSICAL_NIGHT)return lambertPhase(angle);
  return lunarPhaseLaw(angle);
}
/** Krisciunas & Schaefer (1991): m(α) = −12.73 + 0.026|α| + 4 × 10⁻⁹ α⁴, relative to full. */
export function lunarPhaseLaw(angle:number){
  const degrees=Math.abs(angle)*180/Math.PI;
  return 10**(-.4*(.026*degrees+4e-9*degrees**4));
}
const lambertPhase=(angle:number)=>(Math.sin(angle)+(Math.PI-angle)*Math.cos(angle))/Math.PI;
/** Full-Moon irradiance at mean distance in scene units: 2.5 × 10⁻⁶ of the
 * Sun, 0.33 lx. The same value as fullMoonIrradiance in lunarLightShader. */
export const FULL_MOON_IRRADIANCE=.0000055;
const MEAN_LUNAR_RADIUS=1737.4/384400;
/** Gain on the lunar disk, whose radiance is gain × cos(incidence): 18 in the
 * default program. The night lab ties it to moonlight: the disk's flux is
 * FULL_MOON_IRRADIANCE × lunarPhaseIrradiance, so a full disk has
 * E/(π r²) ≈ 0.086 scene units, 5 200 cd/m² (Schmidt 2009: 4 900–5 400). A
 * Lambert disk's mean cos(incidence) is 2/3 of the Lambert phase function. */
export function lunarDiskGain(angle:number,physical=PHYSICAL_NIGHT){
  if(!physical)return 18;
  return FULL_MOON_IRRADIANCE*lunarPhaseLaw(angle)/(Math.PI*MEAN_LUNAR_RADIUS**2*2/3*Math.max(lambertPhase(angle),1e-6));
}
// Scene-relative light, shared by terrain, water and cloud scattering.
// A full Moon supplies a few millionths of the Sun's irradiance; the existing
// camera/sky grade remains illustrative rather than an absolute lux calibration.
export const lunarLightShader=`
uniform float lunarIrradiance;
const float fullMoonIrradiance=.0000055;
vec3 moonDirectionAt(vec3 point){
  vec3 position=cameraPosition+moon.xyz*(1737.4/6371./max(.0001,moon.w));
  return normalize(position-point);
}
vec3 moonlightAt(vec3 point){
  if(lunarIrradiance<=0.)return vec3(0.);
  vec3 direction=moonDirectionAt(point);
  return sunlightTransmission(point,direction)*vec3(.88,.93,1.)
    *fullMoonIrradiance*lunarIrradiance;
}
`;
