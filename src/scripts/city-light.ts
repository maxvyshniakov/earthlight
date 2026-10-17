import {continuousLongitudeShader} from './surface-map.ts';
// The source atlas is scalar. Lamp colors below are an illustrative regional
// mixture, not measured spectra or invented lights in unlit geography.
export const cityLightShader=continuousLongitudeShader+`
float cityLightEnergy(float encoded) {
  // Black Marble is a display-graded scalar image, not linear lamp power.
  // A gentle contrast curve retains connecting roads and dim settlements.
  // The previous 1.8 exponent suppressed a 10% source by another 1.7 stops.
  // Keep the previous full-strength detail peak; apply this calibration to
  // overview, detail and scattered light alike, before spatial integration.
  return .65*pow(.55,1.15)*pow(max(encoded,0.),1.3);
}
float cityActivation(vec3 normal){
  float solar=dot(normal,sunDirection);
  if(solar<-.12)return 1.;
  if(solar>.04)return 0.;
  float region=noise(normal*53.+vec3(8.,2.,11.));
  float district=noise(normal*280.+vec3(31.,17.,9.));
  float threshold=-.008-.040*region-.022*district;
  return 1.-smoothstep(threshold-.024,threshold+.024,solar);
}
vec3 cityLampColor(vec3 normal) {
  float district=noise(normal*1050.+vec3(31.,17.,9.));
  // Thresholded value noise reads as axis-aligned boxes once a long lens
  // resolves its 3 km cells. A gentle warp bends their edges and keeps the
  // field's value distribution, so the share of cooler districts is unchanged.
  vec3 cell=normal*2300.;
  vec2 warp=vec2(noise(cell*.37+vec3(3.,41.,7.)),noise(cell*.37+vec3(23.,5.,19.)))-.5;
  float local=noise(cell+vec3(8.,2.,11.)+vec3(warp,warp.x-warp.y)*1.6);
  vec3 lamps=mix(vec3(1.,.70,.42),vec3(1.,.91,.78),smoothstep(.20,.78,district));
  // Occasional cooler districts, without tinting entire regions green/blue.
  return mix(lamps,vec3(.82,.92,1.),smoothstep(.72,.94,local)*.45);
}
float blurredCitySample(vec2 uv,float lod) {
  uv=vec2(fract(uv.x),clamp(uv.y,0.,1.));
#ifdef CLOUD_EXPLICIT_LOD
  return texture2DLodEXT(nightMap,uv,lod).r;
#else
  // Keep the screen footprint on devices without explicit LOD. The spatial
  // kernel below supplies altitude spread; a fixed +2 bias blurred low haze
  // as broadly as high cloud illumination.
  return texture2D(nightMap,continuousLongitude(uv)).r;
#endif
}
float cityUplightEnergy(vec3 point) {
  vec3 n=normalize(point);
  vec2 uv=earthUV(n);
  // An altitude-sized footprint distributes the uplight instead of drawing
  // a copy of the city boundary on a cloud. Longitude compensates latitude.
  float angular=(2.+max(0.,(length(point)-1.)*6371.)*1.8)/6371.;
  vec2 radius=angular/vec2(6.283185307*max(.15,length(n.xy)),3.141592654);
  float lod=max(1.,log2(max(1.,radius.y*nightMapResolution.y)));
  float signal=cityLightEnergy(blurredCitySample(uv,lod))*.28;
  for(int i=0;i<6;i++){
    float angle=(float(i)+.5)*1.047197551;
    signal+=cityLightEnergy(blurredCitySample(uv+vec2(cos(angle),sin(angle))*radius,lod))*.12;
  }
  return signal;
}
vec3 cityUplight(vec3 point){
  float energy=cityUplightEnergy(point);
  // Scattering mixes neighboring lamps. Keep the diffuse tint quieter than
  // individual sources, rather than projecting district color onto clouds.
  vec3 tint=mix(vec3(1.,.80,.60),cityLampColor(normalize(point)),.25);
  return tint*energy*cityActivation(normalize(point));
}
// A diffuse cloud scatters part of the upward incident field toward the view.
vec3 cityCloudLight(vec3 point){return cityUplight(point)*.35;}
// Local lower-atmosphere scattering. The source footprint grows with physical
// altitude, not camera distance or screen pixels. Unlike mesospheric airglow,
// this light needs a city beneath it and decays within a few kilometres.
vec3 cityHaze(vec3 ray,float groundDistance){
  const float outer=1.+8./6371.;
  float b=dot(cameraPosition,ray),c=dot(cameraPosition,cameraPosition);
  float disc=b*b-c+outer*outer;
  if(disc<=0.||b>=0.)return vec3(0.);
  float entry=max(0.,-b-sqrt(disc)),end=-b+sqrt(disc);
  if(groundDistance>0.)end=min(end,groundDistance);
  if(end<=entry)return vec3(0.);
  vec3 midpoint=cameraPosition+ray*(entry+end)*.5;
  if(dot(normalize(midpoint),sunDirection)>.02)return vec3(0.);
  float nearest=clamp(-b,entry,end);
  vec3 light=vec3(0.);
  vec3 tint=mix(vec3(1.,.80,.60),cityLampColor(normalize(midpoint)),.25);
  // An illustrative, stable aerosol field, not observed weather. Clear air
  // contributes very little; denser patches remain local to emitting cities.
  float aerosol=.012*mix(.35,1.,smoothstep(.25,.75,noise(normalize(midpoint)*83.+vec3(4.,19.,7.))));
  // Eight steps on each side of closest approach. Quadratic spacing resolves
  // the dense end even on long grazing paths, without temporal sample noise.
  float extinction=0.;
  for(int side=0;side<2;side++)for(int i=0;i<8;i++){
    float u=float(i)/8.,v=float(i+1)/8.;
    float a=side==0?nearest-(nearest-entry)*(1.-u)*(1.-u):nearest+(end-nearest)*u*u;
    float z=side==0?nearest-(nearest-entry)*(1.-v)*(1.-v):nearest+(end-nearest)*v*v;
    float stepKm=(z-a)*6371.;
    if(stepKm<=0.)continue;
    vec3 point=cameraPosition+ray*(a+z)*.5;
    vec3 n=normalize(point);
    float height=max(0.,(length(point)-1.)*6371.);
    float tau=aerosol*exp(-height/1.2)*stepKm;
    float night=cityActivation(n);
    // Broad scattering lobe for diffuse upward city light; no screen-space
    // halo or emissive shell at high altitude. Bounded opacity at the limb.
    float cosine=dot(n,-ray);
    float phase=.8775/pow(1.1225-.7*cosine,1.5)*.07957747;
    float energy=cityUplightEnergy(point);
    vec3 source=tint*energy;
    light+=exp(-extinction)*(1.-exp(-tau))*source*night*phase;
    extinction+=tau;
  }
  return light;
}
`;
