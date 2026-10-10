// The visible layer and its downward illumination share one emission model.
// Scene-relative scale, not measured spectral radiance. Gaussian widths are km.
export const airglowLightShader=`
const float airglowStrength=.04;
vec3 airglowAmber=vec3(.048,.023,.006);
vec3 airglowGreen=vec3(.0015,.014,.003);
vec2 airglowActivity(vec3 normal){
  float regional=noise(normal*8.+vec3(0.,0.,time*.00003));
  float waves=sin(dot(normal,vec3(49.,31.,23.))+regional*5.+time*.0004);
  float structure=.67+.23*regional+.10*waves;
  float visibility=mix(1.,.025,smoothstep(-.20,.04,dot(normal,sunDirection)));
  return vec2(1.,.65+.35*waves)*structure*visibility*airglowStrength;
}
vec3 airglowDensity(vec3 point){
  float height=(length(point)-1.)*6371.;
  vec2 activity=airglowActivity(normalize(point));
  return (airglowAmber*activity.x*exp(-.5*pow((height-90.)/8.,2.))
    +airglowGreen*activity.y*exp(-.5*pow((height-98.)/4.,2.)))/600.;
}
vec3 nightSkyTransmission(vec3 point){
  float height=max(0.,(length(point)-1.)*6371.);
  return exp(-vec3(36.9518,86.0085,210.8801)*1.6*8./6371.*exp(-height/8.));
}
vec3 airglowIrradiance(vec3 point){
  float radius=length(point);
  if(radius>=1.+50./6371.)return vec3(0.);
  vec2 activity=airglowActivity(point/radius);
  // Integrate each Gaussian vertically, then over the downward hemisphere.
  // A spherical shell gives 2*pi/(1+sqrt(1-q*q)), q=r/R_layer.
  vec2 q=radius/(vec2(1.)+vec2(90.,98.)/6371.);
  vec2 solidAngle=6.283185307/(vec2(1.)+sqrt(max(vec2(0.),1.-q*q)));
  vec2 column=activity*vec2(8.,4.)*2.506628275/600.*solidAngle;
  // Mean slant clear-air extinction below the emitting shell. The cloud
  // volume and ground shadow apply their own separate extinction.
  vec3 transmission=nightSkyTransmission(point);
  return (airglowAmber*column.x+airglowGreen*column.y)*transmission;
}
`;
