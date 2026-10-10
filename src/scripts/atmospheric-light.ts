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
`;
