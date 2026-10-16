import { PHYSICAL_NIGHT } from './physical-night';
/** Lunar irradiance relative to full Moon at a phase angle in radians. The
 * night lab uses the measured law of Krisciunas & Schaefer (1991), which
 * has the opposition surge: a quarter Moon gives 9%, not a Lambert sphere's 32%. */
export function lunarPhaseIrradiance(angle:number){
  if(!PHYSICAL_NIGHT)return (Math.sin(angle)+(Math.PI-angle)*Math.cos(angle))/Math.PI;
  const degrees=Math.abs(angle)*180/Math.PI;
  return 10**(-.4*(.026*degrees+4e-9*degrees**4));
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
