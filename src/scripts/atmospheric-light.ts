// Background aerosol for light that grazes the limb: the direct beam to the
// lens and the aureole it scatters (solar-aureole.ts). Other paths remain
// Rayleigh only. Extinction at 550 nm per km at sea level, scaled to Earth
// radii and to the Rayleigh wavelengths 680/550/440 nm by an Ångström law.
// Two modes, roughly Elterman's clear standard profile: a boundary layer
// with a 2 km scale height, and a thin free-tropospheric and stratospheric
// background that falls like the air (~0.001/km at 10–15 km).
export const AEROSOL_EXTINCTION_KM=.06;
export const AEROSOL_SCALE_HEIGHT_KM=2;
export const AEROSOL_ANGSTROM=1.3;
export const BACKGROUND_AEROSOL_EXTINCTION_KM=.004;
export const BACKGROUND_AEROSOL_ANGSTROM=1;
const spectrum=(perKm:number,angstrom:number)=>[680,550,440].map(nm=>perKm*6371*(nm/550)**-angstrom);
export const AEROSOL_EXTINCTION=spectrum(AEROSOL_EXTINCTION_KM,AEROSOL_ANGSTROM);
export const BACKGROUND_AEROSOL_EXTINCTION=spectrum(BACKGROUND_AEROSOL_EXTINCTION_KM,BACKGROUND_AEROSOL_ANGSTROM);
const vec3=(v:number[])=>`vec3(${v.map(x=>x.toFixed(4)).join(',')})`;

// Clear-air extinction in Earth-radius units. Matches the existing Rayleigh
// view integral; no extra yellow grade or absorption in vacuum.
export const atmosphericLightShader=`
const vec3 airExtinction=vec3(36.9518,86.0085,210.8801);
const float airRadius=1.018835;
float airColumnHalf(vec3 closest,vec3 direction,float distance){
  float column=0.;
  // Quadratic spacing resolves the dense end of an exponential atmosphere.
  // Splitting at closest approach also handles rays grazing the limb.
  for(int i=0;i<12;i++){
    float a=float(i)/12.,b=float(i+1)/12.;
    float start=a*a*distance,end=b*b*distance;
    vec3 p=closest+direction*(start+end)*.5;
    column+=exp(-max(0.,length(p)-1.)*6371./8.)*(end-start);
  }
  return column;
}
float airColumn(vec3 origin,vec3 direction,float maxDistance){
  float b=dot(origin,direction);
  float disc=b*b-dot(origin,origin)+airRadius*airRadius;
  if(disc<=0.)return 0.;
  float start=max(0.,-b-sqrt(disc));
  float end=min(maxDistance,-b+sqrt(disc));
  if(end<=start)return 0.;
  float nearest=clamp(-b,start,end);
  vec3 closest=origin+direction*nearest;
  float column=0.;
  if(nearest>start)column+=airColumnHalf(closest,-direction,nearest-start);
  if(end>nearest)column+=airColumnHalf(closest,direction,end-nearest);
  return column;
}
vec3 sunlightTransmission(vec3 point,vec3 direction){
  float b=dot(point,direction);
  if(b<0. && b*b-dot(point,point)+1.>0.)return vec3(0.);
  return exp(-airExtinction*airColumn(point,direction,10.));
}
// Aerosol, vertical optical depth ${(AEROSOL_EXTINCTION_KM*AEROSOL_SCALE_HEIGHT_KM+BACKGROUND_AEROSOL_EXTINCTION_KM*8).toFixed(2)} at 550 nm: negligible
// looking down, but a ray grazing the limb crosses ~300 km of the boundary
// layer. The background mode shares the air's density profile.
const vec3 aerosolExtinction=${vec3(AEROSOL_EXTINCTION)};
const vec3 backgroundAerosolExtinction=${vec3(BACKGROUND_AEROSOL_EXTINCTION)};
// Rayleigh (x) and aerosol (y) columns along a ray. The same quadratic
// spacing from closest approach resolves the 2 km aerosol layer at the limb.
vec2 limbColumnHalf(vec3 closest,vec3 direction,float distance){
  vec2 column=vec2(0.);
  for(int i=0;i<12;i++){
    float a=float(i)/12.,b=float(i+1)/12.;
    float start=a*a*distance,end=b*b*distance;
    float height=max(0.,length(closest+direction*(start+end)*.5)-1.)*6371.;
    column+=exp(-height/vec2(8.,${AEROSOL_SCALE_HEIGHT_KM.toFixed(1)}))*(end-start);
  }
  return column;
}
vec2 limbColumns(vec3 origin,vec3 direction,float maxDistance){
  float b=dot(origin,direction);
  float disc=b*b-dot(origin,origin)+airRadius*airRadius;
  if(disc<=0.)return vec2(0.);
  float start=max(0.,-b-sqrt(disc));
  float end=min(maxDistance,-b+sqrt(disc));
  if(end<=start)return vec2(0.);
  float nearest=clamp(-b,start,end);
  vec3 closest=origin+direction*nearest;
  vec2 column=vec2(0.);
  if(nearest>start)column+=limbColumnHalf(closest,-direction,nearest-start);
  if(end>nearest)column+=limbColumnHalf(closest,direction,end-nearest);
  return column;
}
vec3 limbExtinction(vec2 column){return (airExtinction+backgroundAerosolExtinction)*column.x+aerosolExtinction*column.y;}
`;
