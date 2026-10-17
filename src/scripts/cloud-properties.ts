// Lab study `cloudStudy=global`: clouds from measured properties of one day
// (scripts/prepare-cloud-properties.mjs). The cloud map is then an RGBA
// overview: R opacity (plane-parallel albedo of the retrieved optical
// thickness, phase-aware), G cloud-top height / 16 km, B ice fraction,
// A observed and the day's sea-ice concentration c (0.3 + 0.7 c where
// observed, 0.15 c where not). Cloud tiles refine opacity only. Bases and
// vertical profiles are inferred here. The surface takes the sea ice, which
// the Blue Marble day map lacks.
import {initialSceneSeconds} from './iss-orbit';
import {SceneCalendar} from './scene-calendar';

export const CLOUD_PROPERTIES_DATE='2026-09-22';
// UTC days that have been built and published, each a GIBS daily composite of
// NOAA-20's daytime passes. Add a day here only with its asset directory.
export const CLOUD_PROPERTIES_DATES:readonly string[]=[CLOUD_PROPERTIES_DATE];
export const cloudPropertiesPath=(date=CLOUD_PROPERTIES_DATE)=>`cloud-properties/${date}`;
/** v2 carries sea ice in alpha; v1 (observed fraction only) would read as ice everywhere. */
export const CLOUD_PROPERTIES_OVERVIEW='overview-v2.avif';
/** The cloud map's texel before the overview arrives (or if it fails): no
 * cloud, and alpha 0, unobserved ground without sea ice. The plates' opaque
 * black placeholder read as alpha 1, sea ice on every sea. */
export const CLOUD_PROPERTIES_PENDING:readonly number[]=[0,0,0,0];

export function cloudPropertiesEnabled(params:URLSearchParams){return params.get('cloudStudy')==='global';}

/** The measured day for the scene's date: its UTC day when that day was
 * built, otherwise the default day, never a neighbour (weather a day away is
 * another sky). `measured` is false when the scene's date has no data. */
export function cloudPropertiesDay(date:Date){
  const day=Number.isFinite(date.getTime())?date.toISOString().slice(0,10):'';
  const measured=CLOUD_PROPERTIES_DATES.includes(day);
  return {date:measured?day:CLOUD_PROPERTIES_DATE,measured};
}
/** The measured day for a scene URL: `epoch` at the scene time `t`. */
export function cloudPropertiesDate(params:URLSearchParams,now=Date.now()){
  const seconds=initialSceneSeconds(params);
  return cloudPropertiesDay(new SceneCalendar(params,seconds,now).date(seconds));
}

// Swath edges. GIBS draws a day's later NOAA-20 pass over the earlier one, so
// where they overlap the earlier swath ends on a straight line: the later
// swath's eastern edge, a cut between two observations 101 minutes apart.
// The geometry is the build's circular sun-synchronous orbit with its one
// free parameter, the day's first ascending node, fitted to the day's glint
// (manifest: sources.partial.glint.orbit). The drawn edges lie east of that
// model's 1,520 km half-swath, by 63 km at 56 S, 38 km at the equator and
// 28 km north of 30 N: the edge offset, fitted to the day's own opacity steps
// (scripts/fit-cloud-swath-edges.mjs) as a quadratic in sin(latitude). Add
// each built day's fits here.
export const CLOUD_PROPERTIES_ORBIT={inclination:98.74,period:101.44,node:13+25/60,swath:3040};
export const CLOUD_PROPERTIES_SWATHS:Readonly<Record<string,{firstNode:number;edgeOffset:readonly [number,number,number]}>>={
  '2026-09-22':{firstNode:83.0,edgeOffset:[35.8,-19.8,14.3]},
};
/** Half-width (km) of the band across a swath edge where opacity is averaged
 * with its mirror image: two and a half tile texels, so the cut softens to
 * the data's own resolution and no value travels farther than 12 km. */
export const CLOUD_PROPERTIES_SWATH_BLEND=6;
const EARTH_KM=6371,RATE=Math.PI/720;// Earth's turn against the precessing orbit, radians per minute
export type CloudPropertiesSwathDay={longitude:number;minutes:number;edgeOffset:readonly [number,number,number]};
/** The day's first ascending node, its longitude (radians) and time (minutes
 * after 00:00 UTC), and the edge offset; null for a day without a fit. */
export function cloudPropertiesSwathDay(date:string):CloudPropertiesSwathDay|null{
  const fit=CLOUD_PROPERTIES_SWATHS[date];
  if(!fit)return null;
  // The build's mean Sun and sidereal angle (prepare-cloud-properties.mjs).
  const day=Date.parse(date+'T00:00:00Z')/864e5-10957.5+fit.firstNode/1440;
  const degrees=280.46+.9856474*day+15*(CLOUD_PROPERTIES_ORBIT.node-12)-(280.46061837+360.98564736629*day);
  return {longitude:((degrees%360+540)%360-180)*Math.PI/180,minutes:fit.firstNode,edgeOffset:fit.edgeOffset};
}
/** The swath edge nearest a point (unit vector, Earth-fixed): signed distance
 * in km, positive east of the edge (on the earlier pass), the unit direction
 * across it, eastwards, and the later pass's time there in minutes after
 * 00:00 UTC. `valid` is false where the two sides are not consecutive passes
 * of one local day (the date line) and beyond 70 degrees, where the passes
 * crowd and turn. The shader's cloudPropertiesSwathEdge mirrors this. */
export function cloudPropertiesSwathEdge(n:readonly number[],day:CloudPropertiesSwathDay){
  const I=CLOUD_PROPERTIES_ORBIT.inclination*Math.PI/180,P=CLOUD_PROPERTIES_ORBIT.period,half=CLOUD_PROPERTIES_ORBIT.swath/2/EARTH_KM;
  const sinI=Math.sin(I),cosI=Math.cos(I),z=Math.max(-1,Math.min(1,n[2])),cl=Math.sqrt(1-z*z),lon=Math.atan2(n[1],n[0]);
  if(Math.abs(z)>Math.sin(70*Math.PI/180))return {distance:Infinity,across:[0,0,0],minutes:NaN,valid:false};
  // An ascending pass's east edge in its orbit frame: longitude from the node.
  const edge=Math.asin(Math.max(-1,Math.min(1,(Math.sin(half)+z*cosI)/(cl*sinI))));
  // Argument of latitude where the track crosses this latitude; Earth turns
  // by `turn` per radian of the pass.
  const u0=Math.asin(Math.max(-1,Math.min(1,z/sinI))),turn=RATE*P/(2*Math.PI),step=RATE*P;
  // The day holds 14.2 passes, not a whole number per turn: count from the
  // pass nearest 13:25 local time here, then step to the nearest edge.
  const near=Math.round(((CLOUD_PROPERTIES_ORBIT.node-lon*12/Math.PI)*60-day.minutes)/P);
  const from=lon-day.longitude+near*step,wrapped=from-2*Math.PI*Math.floor(from/(2*Math.PI)+.5);
  const k=near+Math.round((edge-wrapped-turn*u0)/step);
  // Orbit-frame longitude at closest approach, where the point is square to the track.
  const offset=wrapped+(k-near)*step;
  let u=u0,L=offset+turn*u;
  for(let i=0;i<2;i++){u=Math.atan2(cl*Math.sin(L)*cosI+z*sinI,cl*Math.cos(L));L=offset+turn*u;}
  const c=Math.asin(Math.max(-1,Math.min(1,-cl*Math.sin(L)*sinI+z*cosI)));
  const minutes=day.minutes+(k+u/(2*Math.PI))*P;
  // The composite keeps one local solar day: both passes must lie in it.
  const local=minutes/60+lon*12/Math.PI;
  const valid=local>=0&&local<24&&local-P/60>=0;
  // Orbit normal in Earth-fixed axes; east across the edge is against it.
  const a=lon-L,normal=[sinI*Math.sin(a),-sinI*Math.cos(a),cosI],d=normal[0]*n[0]+normal[1]*n[1]+normal[2]*n[2];
  const across=normal.map((x,i)=>-(x-n[i]*d)),length=Math.hypot(...across);
  const [e0,e1,e2]=day.edgeOffset;
  return {distance:(-c-half)*EARTH_KM-(e0+e1*z+e2*z*z),across:across.map(x=>x/length),minutes,valid};
}
/** Compile-time constants for the shader: the day's swath fit, or nothing. */
export function cloudPropertiesSwathHeader(date:string){
  const day=cloudPropertiesSwathDay(date);
  if(!day)return '';
  const f=(x:number)=>x.toFixed(8);
  return `#define CLOUD_PROPERTIES_SWATHS vec2(${f(day.longitude)},${f(day.minutes)})\n#define CLOUD_PROPERTIES_EDGE_OFFSET vec3(${day.edgeOffset.map(f).join(',')})\n#define CLOUD_PROPERTIES_SWATH_BLEND ${CLOUD_PROPERTIES_SWATH_BLEND.toFixed(1)}\n`;
}

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
#ifdef CLOUD_PROPERTIES_SWATHS
// Mirror of cloudPropertiesSwathEdge (TypeScript): x the signed distance in km
// east of the nearest swath edge, yzw the unit direction across it, east;
// x is 1e4 where no edge joins consecutive passes of one local day.
vec4 cloudPropertiesSwathEdge(vec3 n){
  const float sinI=${Math.sin(CLOUD_PROPERTIES_ORBIT.inclination*Math.PI/180).toFixed(8)},cosI=${Math.cos(CLOUD_PROPERTIES_ORBIT.inclination*Math.PI/180).toFixed(8)};
  const float halfSwath=${(CLOUD_PROPERTIES_ORBIT.swath/2/EARTH_KM).toFixed(8)},period=${CLOUD_PROPERTIES_ORBIT.period.toFixed(4)};
  const float spacing=${(RATE*CLOUD_PROPERTIES_ORBIT.period).toFixed(8)},turn=${(RATE*CLOUD_PROPERTIES_ORBIT.period/(2*Math.PI)).toFixed(8)};
  float z=clamp(n.z,-1.,1.);
  if(abs(z)>${Math.sin(70*Math.PI/180).toFixed(8)})return vec4(1e4,0.,0.,0.);
  float cl=sqrt(1.-z*z),lon=atan(n.y,n.x);
  float edge=asin(clamp((sin(halfSwath)+z*cosI)/(cl*sinI),-1.,1.));
  float u0=asin(clamp(z/sinI,-1.,1.));
  float near=floor(((${CLOUD_PROPERTIES_ORBIT.node.toFixed(8)}-lon*3.819718634)*60.-CLOUD_PROPERTIES_SWATHS.y)/period+.5);
  float from=lon-CLOUD_PROPERTIES_SWATHS.x+near*spacing;
  float wrapped=from-6.283185307*floor(from/6.283185307+.5);
  float k=near+floor((edge-wrapped-turn*u0)/spacing+.5);
  float offset=wrapped+(k-near)*spacing,u=u0,L=offset+turn*u;
  for(int i=0;i<2;i++){u=atan(cl*sin(L)*cosI+z*sinI,cl*cos(L));L=offset+turn*u;}
  float c=asin(clamp(-cl*sin(L)*sinI+z*cosI,-1.,1.));
  float local=(CLOUD_PROPERTIES_SWATHS.y+(k+u/6.283185307)*period)/60.+lon*3.819718634;
  if(local<period/60.||local>=24.)return vec4(1e4,0.,0.,0.);
  float a=lon-L;
  vec3 normal=vec3(sinI*sin(a),-sinI*cos(a),cosI);
  vec3 offsetFit=CLOUD_PROPERTIES_EDGE_OFFSET;
  return vec4((-c-halfSwath)*6371.-(offsetFit.x+z*(offsetFit.y+z*offsetFit.z)),normalize(n*dot(normal,n)-normal));
}
// Across a swath edge both sides are measured, 101 minutes apart. A wide
// cross-fade superimposes two skies, and a wider filter turns broken cloud
// into a flat veil that marks the edge more than the cut did. Within
// CLOUD_PROPERTIES_SWATH_BLEND km, where both sides were observed, the
// opacity is averaged with its mirror image across the edge: half and half
// at the edge, none at the band's border. The cut, sharper than any single
// pass draws a cloud field, softens to the data's resolution; the step in
// cloud amount between the passes stays.
vec4 cloudPropertiesSwathMirror(vec3 n){
  vec4 edge=cloudPropertiesSwathEdge(n);
  float weight=.5*(1.-smoothstep(0.,CLOUD_PROPERTIES_SWATH_BLEND,abs(edge.x)));
  if(weight<=0.)return vec4(0.);
  vec3 across=edge.yzw*(CLOUD_PROPERTIES_SWATH_BLEND/6371.);
  weight*=smoothstep(.2,.25,min(cloudProperties(earthUV(normalize(n-across)),0.).a,cloudProperties(earthUV(normalize(n+across)),0.).a));
  vec3 mirror=normalize(n-edge.yzw*(2.*edge.x/6371.));
  // Never across the date line: the other side is another local day.
  if(n.x<0.&&n.y*mirror.y<0.)return vec4(0.);
  return vec4(mirror,weight);
}
#endif
vec4 cloudPropertiesSample(vec3 n,float footprint,bool detailed){
  vec2 uv=earthUV(n);
  float texels=footprint*max(1.,cloudMapWidth)/(6.283185307*max(.15,length(n.xy)));
  vec4 field=cloudProperties(uv,max(0.,log2(max(1.,texels))));
  // Tiles refine the overview's opacity only; before it arrives (width 1)
  // they would draw cloud without its measured height.
  if(detailed&&cloudMapWidth>1.)field.r=detailedCloud(uv,texels*16384./cloudMapWidth,field.r);
  return field;
}
vec4 cloudPropertiesAt(vec3 point,float footprint,bool detailed){
  vec3 n=normalize(point);
  vec4 field=cloudPropertiesSample(n,footprint,detailed);
#ifdef CLOUD_PROPERTIES_SWATHS
  // A footprint as wide as the band already averages across the cut; the
  // distant, undetailed reads of shadows skip the orbit arithmetic.
  if(detailed&&footprint*6371.<2.*CLOUD_PROPERTIES_SWATH_BLEND){
    vec4 mirror=cloudPropertiesSwathMirror(n);
    if(mirror.w>0.)field.r=mix(field.r,cloudPropertiesSample(mirror.xyz,footprint,detailed).r,mirror.w);
  }
#endif
  return field;
}
// Alpha: observed at or above 0.3, sea ice c as 0.3 + 0.7 c there and as
// 0.15 c where unobserved. The gap keeps AVIF error (~6/255) from flipping
// the branch.
float cloudPropertiesObserved(float a){return step(.225,a);}
float cloudPropertiesSeaIce(vec2 uv,float lod){
  float a=cloudProperties(uv,lod).a;
  return clamp(a<.225?a/.15:(a-.3)/.7,0.,1.);
}
// Linear albedo of the day's sea ice, from the same overpass: clear pixels
// over 90-100% ice (red, green, blue 0.85, 0.86, 0.86 Rayleigh-corrected)
// against the clear Antarctic plateau (1.0), scaled to the plateau of the
// Blue Marble day map, so ice and continent keep the overpass's contrast.
const vec3 CLOUD_PROPERTIES_SEA_ICE=vec3(.68,.73,.78);
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
// A view-ray step through a measured column. The step's interval average is
// exact in height, but the column was read at the step's centre, which lies
// up to half a step (about 0.5 km at balanced steps) beside where the ray
// actually crosses the layer. At oblique views the ground distance, and with
// it the step grid, shifts by a step every pixel or two, so a centre read
// drew that grid's phase as rippled contours wherever the column changes:
// broken cloud, whose deck thickness follows its opacity, and tops ramping
// between low and high cloud. The column, geometry and opacity, is read again
// at the height centroid of its 6z(1-z) layer inside the interval, moved
// along the ray (stride: the whole step, pointing up), and the point moves
// there for lighting. Reading only the opacity there left the ripples; the
// geometry is what aliased. The step then treats the deck as level, which a
// steeply sloping deck pays for in depth (docs/lab/cloud-properties-ripples-
// 2026-10-17.md). Top height is extended to clear sky, so the first read
// places thin edges as well.
float cloudPropertiesStep(inout vec3 point,vec3 stride,float footprint,float halfSpan){
  float height=(length(point)-1.)*6371.;
  if(height<.6-halfSpan||height>12.+halfSpan)return 0.;
  vec4 field=cloudPropertiesAt(point,footprint,true);
  vec2 column=cloudPropertiesColumn(field);
  float span=column.y-column.x;
  if(halfSpan>.0001){
    float a=clamp((height-halfSpan-column.x)/span,0.,1.),b=clamp((height+halfSpan-column.x)/span,0.,1.);
    float mass=b*b*(3.-2.*b)-a*a*(3.-2.*a);
    float moment=b*b*b*(2.-1.5*b)-a*a*a*(2.-1.5*a);
    if(mass>1e-6){
      float layerCentre=column.x+span*moment/mass;
      point+=stride*((layerCentre-height)/(2.*halfSpan));
      field=cloudPropertiesAt(point,footprint,true);
      column=cloudPropertiesColumn(field);
    }
  }
  if(field.r<.002)return 0.;
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
// How measured columns follow the Sun. The shared cloud light falls as
// .48+.38 cos θ0, only to 0.80 of its overhead value at cos θ0 = 0.5, while
// a lit surface falls as cos θ0: at low Sun the clouds outshone sea ice and
// snow 2 to 3 times against VIIRS and EPIC. A plane-parallel cloud that
// multiple scattering makes bright falls as cos θ0^1.19 (Monte Carlo of
// Henyey-Greenstein slabs, τ 32 to 64; 12% brighter at τ 16). EPIC shows
// thin and mid columns dimming the same way, so one law serves all. It is 1
// overhead, where the EPIC comparison was made. Below cos θ0 = 0.1 the tops'
// relief, not their plane, faces the Sun.
float cloudPropertiesSolarLaw(float mu){
  float m=clamp(mu,.1,1.);
  return .86*pow(m,1.19)/(.48+.38*m);
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
  float observed=cloudPropertiesObserved(cloudProperties(earthUV(n),0.).a);
  float hatch=step(.5,fract((n.x+n.y+n.z)*900.));
#ifdef CLOUD_PROPERTIES_SWATHS
  // Swath edges in cyan, as wide as the band averaged with its mirror.
  color=mix(color,vec3(.2,.8,1.),(1.-smoothstep(0.,CLOUD_PROPERTIES_SWATH_BLEND,abs(cloudPropertiesSwathEdge(n).x)))*.5);
#endif
  return mix(color,vec3(.3,.1,.32)*(.6+.4*hatch),(1.-observed)*.8);
}
#endif
#endif
`;
