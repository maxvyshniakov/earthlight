// Lab study `cloudStudy=global`: clouds from measured properties of one day
// (scripts/prepare-cloud-properties.mjs). The cloud map is then an RGBA
// overview: R opacity (plane-parallel albedo of the retrieved optical
// thickness, phase-aware), G cloud-top height / 16 km, B ice fraction,
// A observed. Cloud tiles refine opacity only. Bases and vertical profiles
// are inferred here.
export const CLOUD_PROPERTIES_DATE='2026-09-22';
export const cloudPropertiesPath=(date=CLOUD_PROPERTIES_DATE)=>`cloud-properties/${date}`;

export function cloudPropertiesEnabled(params:URLSearchParams){return params.get('cloudStudy')==='global';}

export type CloudPropertiesView='disc'|'region'|'iss'|'deck';
// Matched comparison views for 22 September 2026: the DSCOVR EPIC frame of
// 11:20 UTC (centroid 5.9 N, 7.3 E, here from 50,000 km with a long lens),
// 2,000 km over the Angola stratocumulus deck and Congo convection, the
// ISS photo ISS075-E-150512 (11:13 UTC, 50 mm, nadir 11.9 N 18.6 E, north),
// and 420 km over the deck looking north, within the cloud lighting atlas.
const views:Record<CloudPropertiesView,{lat:number;lon:number;km:number;elevation:number;lens:number;epoch:string}>={
  disc:{lat:5.9,lon:7.3,km:50000,elevation:-90,lens:2.9,epoch:'2026-09-22T11:20:00Z'},
  region:{lat:-8,lon:12,km:2000,elevation:-90,lens:1,epoch:'2026-09-22T11:20:00Z'},
  iss:{lat:11.9,lon:18.6,km:420,elevation:-27,lens:1.67,epoch:'2026-09-22T11:13:13Z'},
  deck:{lat:-14,lon:8,km:420,elevation:-35,lens:1,epoch:'2026-09-22T11:20:00Z'},
};
export function cloudPropertiesURL(base:string,view:CloudPropertiesView,study:'global'|'off'='global'){
  const url=new URL('/',base),v=views[view],rad=Math.PI/180;
  const lat=v.lat*rad,lon=v.lon*rad,radius=1+v.km/6371;
  const position=[Math.cos(lat)*Math.cos(lon),Math.cos(lat)*Math.sin(lon),Math.sin(lat)].map(x=>x*radius);
  const heading=[-Math.sin(lat)*Math.cos(lon),-Math.sin(lat)*Math.sin(lon),Math.cos(lat)];
  const settings:Record<string,string>={flight:'free',position:position.join(','),heading:heading.join(','),elevation:String(Math.max(-89.9,v.elevation)*rad),t:'0',epoch:v.epoch,motion:'0',lens:String(v.lens)};
  if(study==='global')settings.cloudStudy='global';
  for(const [key,value] of Object.entries(settings))url.searchParams.set(key,value);
  return url;
}

export const cloudPropertiesShader=`
#ifdef CLOUD_PROPERTIES
vec4 cloudProperties(vec2 uv,float lod){
#ifdef CLOUD_EXPLICIT_LOD
  return texture2DLodEXT(cloudMap,uv,lod);
#else
  return texture2D(cloudMap,continuousLongitude(uv),max(0.,lod-1.));
#endif
}
// Column-preserving interval average of a 6z(1-z) layer between base and
// top (the same profile as the MODIS study's layers): thin decks keep their
// optical thickness however coarsely a ray steps through them.
float cloudPropertiesLayer(float base,float top,float height,float halfSpan){
  float z=clamp((height-base)/(top-base),0.,1.);
  if(halfSpan<=.0001)return 6.*z*(1.-z)/(top-base);
  float a=clamp((height-halfSpan-base)/(top-base),0.,1.);
  float b=clamp((height+halfSpan-base)/(top-base),0.,1.);
  return (b*b*(3.-2.*b)-a*a*(3.-2.*a))/(2.*halfSpan);
}
vec4 cloudPropertiesAt(vec3 point,float footprint,bool detailed){
  vec3 n=normalize(point);
  vec2 uv=earthUV(n);
  float texels=footprint*max(1.,cloudMapWidth)/(6.283185307*max(.15,length(n.xy)));
  vec4 field=cloudProperties(uv,max(0.,log2(max(1.,texels))));
  if(detailed)field.r=detailedCloud(uv,texels*16384./max(1.,cloudMapWidth),field.r);
  return field;
}
// Base and thickness from measured top, optical thickness and phase:
// - liquid: adiabatic-like decks, 0.25 km thin to 2.5 km for tau ~ 56;
// - ice: 1.5 km cirrus sheets, deepening to a 1.5 km base when the cloud is
//   both optically thick (tau 6-30) and high (top 6-9 km): deep convection.
// Unknown and uncertain phase mix the two by the ice fraction.
vec2 cloudPropertiesColumn(vec4 field){
  float opacity=min(field.r,.995);
  // Albedo coefficient (1 - g) sqrt(3) / 2: liquid g = 0.85, ice g = 0.75.
  float tau=opacity/(mix(.13,.2165,field.b)*(1.-opacity));
  float top=clamp(field.g*16.,.9,11.8);
  float liquid=clamp(.25+.04*tau,.25,2.5);
  float ice=mix(1.5,max(1.5,top-1.5),smoothstep(6.,30.,tau)*smoothstep(6.,9.,top));
  return vec2(max(.6,top-mix(liquid,ice,field.b)),top);
}
float cloudPropertiesDensity(vec3 point,float footprint,bool detailed,float halfSpan){
  float height=(length(point)-1.)*6371.;
  if(height<.6-halfSpan||height>12.+halfSpan)return 0.;
  vec4 field=cloudPropertiesAt(point,footprint,detailed);
  if(field.r<.002)return 0.;
  vec2 column=cloudPropertiesColumn(field);
  // Column optical depth ln(1 + 0.13 tau): nadir opacity equals the albedo.
  return -log(1.-min(field.r,.995))*cloudPropertiesLayer(column.x,column.y,height,halfSpan);
}
// Sunlight reaching a point inside a measured column. The stored opacity is
// the column's plane-parallel albedo, which already includes its own multiple
// scattering. Self-shadowing that column again along the sun ray, then
// attenuating the view ray by the same depth, caps a thick column near half
// its albedo. Only attenuation beyond what a horizontally uniform layer of
// this column would cause (gaps, towers, other clouds) shades the point.
float cloudPropertiesIllumination(vec3 point,float footprint,float transmission){
  vec4 field=cloudPropertiesAt(point,footprint,true);
  if(field.r<.002)return transmission;
  vec2 column=cloudPropertiesColumn(field);
  float z=clamp(((length(point)-1.)*6371.-column.x)/(column.y-column.x),0.,1.);
  float above=-log(1.-min(field.r,.995))*(1.-z*z*(3.-2.*z));
  float mu=max(.2,dot(normalize(point),sunDirection));
  return min(1.,transmission*exp(above/mu));
}
#ifdef CLOUD_PROPERTIES_QUALITY
// Diagnostic colours: low (top < 3.2 km) green, middle amber, high violet;
// ground that NOAA-20 did not observe in daylight is hatched purple.
vec3 cloudPropertiesTint(vec3 point){
  float top=cloudPropertiesAt(point,.002,false).g*16.;
  float low=1.-smoothstep(2.7,3.7,top),high=smoothstep(6.,7.,top);
  return low*vec3(.35,1.,.6)+(1.-low-high)*vec3(1.,.72,.3)+high*vec3(.78,.6,1.);
}
vec3 cloudPropertiesGround(vec3 point,vec3 color){
  vec3 n=normalize(point);
  float observed=cloudProperties(earthUV(n),0.).a;
  float hatch=step(.5,fract((n.x+n.y+n.z)*900.));
  return mix(color,vec3(.3,.1,.32)*(.6+.4*hatch),(1.-smoothstep(.25,.75,observed))*.8);
}
#endif
#endif
`;
