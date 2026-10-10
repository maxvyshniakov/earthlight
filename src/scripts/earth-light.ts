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
