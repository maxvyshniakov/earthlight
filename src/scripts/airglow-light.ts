// The visible layer and its downward illumination share one emission model.
// Scene-relative scale, not measured spectral radiance. Gaussian widths are km.
import {nightScaleGlsl,PHYSICAL_NIGHT} from './physical-night.ts';
// Night lab (docs/lab/night-camera-2026-10-17.md): the layers of the nightglow
// as photographed from the ISS, with the same zenith column luminance. OI
// 557.7 nm at 97 km (FWHM ~10 km) gives the green edge and most of the visible
// light; Na 589 nm and the OH bands below it at ~90 km the yellow-orange.
// The default palette put 86% of the light into a 19 km amber layer, which
// read as a thick orange band against the thin yellow-green one of
// ISS030-E-7397 and ISS030-E-10008. Shares here: green 60%, amber 40%.
const layers=PHYSICAL_NIGHT
  ?{amber:'vec3(.0346,.01658,.00433)',green:'vec3(.00802,.0749,.01605)',amberHeight:'90.',amberWidth:'5.',greenHeight:'97.',greenWidth:'4.'}
  :{amber:'vec3(.048,.023,.006)',green:'vec3(.0015,.014,.003)',amberHeight:'90.',amberWidth:'8.',greenHeight:'98.',greenWidth:'4.'};
export const airglowLightShader=`
const float airglowStrength=.04*${nightScaleGlsl('airglow')};
vec3 airglowAmber=${layers.amber};
vec3 airglowGreen=${layers.green};
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
  return (airglowAmber*activity.x*exp(-.5*pow((height-${layers.amberHeight})/${layers.amberWidth},2.))
    +airglowGreen*activity.y*exp(-.5*pow((height-${layers.greenHeight})/${layers.greenWidth},2.)))/600.;
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
  vec2 q=radius/(vec2(1.)+vec2(${layers.amberHeight},${layers.greenHeight})/6371.);
  vec2 solidAngle=6.283185307/(vec2(1.)+sqrt(max(vec2(0.),1.-q*q)));
  vec2 column=activity*vec2(${layers.amberWidth},${layers.greenWidth})*2.506628275/600.*solidAngle;
  // Mean slant clear-air extinction below the emitting shell. The cloud
  // volume and ground shadow apply their own separate extinction.
  vec3 transmission=nightSkyTransmission(point);
  return (airglowAmber*column.x+airglowGreen*column.y)*transmission;
}
`;
