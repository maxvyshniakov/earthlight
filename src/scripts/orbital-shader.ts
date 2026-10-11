import { cloudReconstructionShader } from './cloud-reconstruction';
import { pointBrightnessShader } from './point-photometry';
import { galacticLightShader } from './galactic-light';
import { surfaceMapShader } from './surface-map';
import { airglowLightShader } from './airglow-light';
import { lunarLightShader } from './earth-light';
import { cityLightShader } from './city-light';
import { AURORA_RADIANCE_RANGE } from './aurora';
import { SOLAR_IRRADIANCE, SOLAR_RADIUS, SOLAR_RADIANCE, SOLAR_SCATTER_FRACTION } from './solar-light';
import { LUNAR_SAMPLE_COUNT } from './celestial-sky';
import { optics, opticalPsfSource } from './optical-psf';
import { nightTileShader, dayTileShader, cloudTileShader } from './night-tiles';
import { cloudShader } from './earth-clouds';
import { terrainShader } from './earth-terrain';
import { sceneColorShader } from './scene-color';
import { atmosphericLightShader } from './atmospheric-light';

// ISS trajectory and sunlight, graded like a photograph taken from orbit.
// All distant lights share a camera rotation. Earth's limb stays stationary;
// surface coordinates rotate on a sphere underneath it. No individual star drift.
export const vertexSource = `
attribute vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }
`;

export const fragmentSource = `
precision highp float;
precision highp sampler2D;
uniform vec2 resolution;
uniform float time;
// Lens focal length in viewport heights. The wide end is 1.25; an unset
// uniform therefore renders the wide lens rather than nothing.
uniform float zoomExcess;
#define FOCAL (1.25*(1.+zoomExcess))
uniform vec4 pointGhosts[3];
uniform float galaxyAmount;
uniform sampler2D surfaceMap;
uniform sampler2D nightMap;
uniform vec2 nightMapResolution;
uniform sampler2D cloudMap;
uniform float mapsReady;
uniform float surfaceEnabled;
uniform vec3 cameraPosition;
uniform mat3 cameraBasis;
uniform sampler2D starMap;
uniform vec4 moon;
uniform vec4 planets[5];
uniform vec3 sunDirection;
uniform float solarVisibility;
#ifdef SOLAR_TRANSMISSION
uniform sampler2D solarTransmission;
#endif
uniform float pixelRatio;
uniform float starsLinear;
uniform float sceneLinear;
uniform mat3 galacticBasis;
uniform sampler2D milkyWayMap;
#ifdef AURORA
uniform sampler2D auroraMap;
#endif
uniform vec4 moonSamples[${LUNAR_SAMPLE_COUNT}];
${opticalPsfSource}
${nightTileShader}
${dayTileShader}
${cloudTileShader}
${sceneColorShader}

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * .1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}


float noise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  vec2 q = i.xy + vec2(37.0, 17.0) * i.z;
  float a = mix(mix(hash(q), hash(q + vec2(1,0)), f.x),
                mix(hash(q + vec2(0,1)), hash(q + vec2(1,1)), f.x), f.y);
  q += vec2(37,17);
  float b = mix(mix(hash(q), hash(q + vec2(1,0)), f.x),
                mix(hash(q + vec2(0,1)), hash(q + vec2(1,1)), f.x), f.y);
  return mix(a,b,f.z);
}
mat2 rotate(float a) { float c = cos(a), s = sin(a); return mat2(c,-s,s,c); }

vec2 earthUV(vec3 n) {
  return vec2(atan(n.y,n.x)/6.283185307+.5,asin(clamp(n.z,-1.,1.))/3.141592654+.5);
}

${terrainShader}
${pointBrightnessShader}
${surfaceMapShader}
${atmosphericLightShader}
${lunarLightShader}
${airglowLightShader}
${galacticLightShader}
${cityLightShader}
${cloudShader}

// Shared exposure-normalized sunlight for diffuse ground and clear air.
// E / pi gives the ground's Lambertian response; E also feeds scattering.
// 2.2 preserves the previous .85 encoded ground gain (pi * .85^2.2).
const float solarIrradiance=${SOLAR_IRRADIANCE};

// Single Rayleigh scattering through an exponential atmosphere. Integrate both
// view and sunlight optical depth; Earth blocks the sunlight on the night side.
vec3 atmosphere(vec3 ray,float groundDistance,vec3 background,out vec3 scatter) {
  scatter=vec3(0.);
  const float outer=1.018835;
  const vec3 beta=airExtinction;
  float b=dot(cameraPosition,ray);
  float disc=b*b-dot(cameraPosition,cameraPosition)+outer*outer;
  if(disc<=0.)return background;
  float entry=max(0.,-b-sqrt(disc)),exitDistance=-b+sqrt(disc);
  if(groundDistance>0.)exitDistance=min(exitDistance,groundDistance);
  if(exitDistance<=entry)return background;
  float stepLength=(exitDistance-entry)/12.;
  float opticalDepth=0.;
  float cosine=dot(ray,sunDirection);
  float phase=.0596831*(1.+cosine*cosine);
  for(int i=0;i<12;i++) {
    vec3 point=cameraPosition+ray*(entry+(float(i)+.5)*stepLength);
    float density=exp(-max(0.,length(point)-1.)*6371./8.);
    opticalDepth+=density*stepLength*.5;
    float sb=dot(point,sunDirection);
    float groundDisc=sb*sb-dot(point,point)+1.;
    if(sb>=0. || groundDisc<0.) {
      float sunLength=-sb+sqrt(max(0.,sb*sb-dot(point,point)+outer*outer));
      float sunDepth=0.;
      for(int j=0;j<6;j++) {
        vec3 sunPoint=point+sunDirection*sunLength*(float(j)+.5)/6.;
        sunDepth+=exp(-max(0.,length(sunPoint)-1.)*6371./8.)*sunLength/6.;
      }
      scatter+=exp(-beta*(opticalDepth+sunDepth))*beta*density*stepLength*phase*solarIrradiance;
    }
    opticalDepth+=density*stepLength*.5;
  }
  return max(vec3(0.),background*exp(-beta*opticalDepth)+scatter);
}
// Fixed mesospheric emission profiles, integrated along the visible ray.
// Split at the empty inner sphere so a ground-facing ray cannot skip the thin
// layer. Midpoint samples are deterministic: no temporal shimmer or shell mix.
vec3 airglowSegment(vec3 ray,float start,float end){
  if(end<=start)return vec3(0.);
  float stepLength=(end-start)/16.;
  vec3 emission=vec3(0.);
  for(int i=0;i<16;i++) {
    vec3 point=cameraPosition+ray*(start+(float(i)+.5)*stepLength);
    emission+=airglowDensity(point)*stepLength*6371.;
  }
  return emission;
}
vec3 airglowEmission(vec3 ray,float groundDistance){
  float b=dot(cameraPosition,ray),c=dot(cameraPosition,cameraPosition);
  const float outer=1.+130./6371.,inner=1.+50./6371.;
  float d=b*b-c+outer*outer;
  if(d<=0. || b>=0.)return vec3(0.);
  float start=max(0.,-b-sqrt(d)),end=-b+sqrt(d);
  if(groundDistance>0.)end=min(end,groundDistance);
  float hole=b*b-c+inner*inner;
  float halfGap=sqrt(max(0.,hole));
  vec3 nearLight=airglowSegment(ray,start,min(end,-b-halfGap));
  vec3 farLight=airglowSegment(ray,max(start,-b+halfGap),end);
  // The far half is seen through the lower atmosphere. Its grazing optical
  // column (exponential atmosphere, 8 km scale height) prevents an abrupt
  // doubling of emission just above the solid limb. The near half is in front.
  float tangentRadius=sqrt(max(0.,c-b*b));
  float tangentHeight=(tangentRadius-1.)*6371.;
  float opticalColumn=exp(-max(0.,tangentHeight)/8.)
    *sqrt(6.283185307*max(tangentRadius,1.)*8./6371.);
  vec3 transmission=exp(-vec3(36.9518,86.0085,210.8801)*opticalColumn);
  return nearLight+farLight*transmission;
}
float cityEmission(vec2 uv) {
  // Terrain was removed at source resolution. Thresholding filtered samples
  // here erased distant cities as their signal averaged into dark neighbors.
  // Share the albedo's wrapped longitude derivatives. At the date line,
  // implicit LOD otherwise averages distant cities into a bright ocean stripe.
  return surfaceMapSample(nightMap,uv).r;
}

vec2 screenPosition(vec3 direction) {
  vec3 v=vec3(dot(direction,cameraBasis[0]),dot(direction,cameraBasis[1]),dot(direction,cameraBasis[2]));
  return FOCAL*v.xy/max(.001,v.z);
}

void main() {
  vec2 uv = gl_FragCoord.xy/resolution;
  float aspect = resolution.x/resolution.y;
  vec2 p = (uv-.5)*vec2(aspect,1.0);
  vec3 viewRay=normalize(vec3(p,FOCAL));
  vec3 earthRay=normalize(cameraBasis*viewRay);
  float b=dot(cameraPosition,earthRay);
  float discriminant=b*b-dot(cameraPosition,cameraPosition)+1.;
  float groundDistance=discriminant>=0. && b<0. ? -b-sqrt(discriminant) : -1.;
  float seaDistance=groundDistance;
  groundDistance=terrainIntersection(earthRay,groundDistance);
  vec3 tangentPoint=cameraPosition+earthRay*max(0.,-b);
  float tangentHeight=(length(tangentPoint)-1.)*6371.;
  float pixelHeight=length(cameraPosition)*6371./resolution.y*.6;
  float skyMask=b>=0.?1.:smoothstep(-pixelHeight,pixelHeight,tangentHeight);
  if(terrainReady>.5 && groundDistance>0. && seaDistance<0.)skyMask=0.;
#ifdef TERRAIN_VIEW
  // Same intersection, normals, streamed heights and shadow rays as the scene.
  // Fixed display response isolates terrain from haze, clouds and auto exposure.
  vec3 diagnostic=vec3(.012);
  if(groundDistance>0.){
    vec3 point=cameraPosition+earthRay*groundDistance,geo=normalize(point);
    vec3 normal=terrainNormal(point,groundDistance);
    vec3 light=sunDirection;
#ifdef TERRAIN_SUN
    vec3 up=normalize(cameraPosition);
    vec3 east=normalize(cross(abs(up.z)<.99?vec3(0.,0.,1.):vec3(0.,1.,0.),up));
    vec3 north=cross(up,east);
    vec2 angles=TERRAIN_SUN*.01745329252;
    light=up*sin(angles.y)+(north*cos(angles.x)+east*sin(angles.x))*cos(angles.y);
#endif
    vec2 mapUV=earthUV(geo);
    float footprint=groundDistance*13751./(resolution.y*FOCAL*max(.02,-dot(geo,earthRay))*max(.02,length(geo.xy)));
    vec3 material=vec3(.55);
#if TERRAIN_VIEW != 1
    material=detailedDay(mapUV,footprint,surfaceAlbedo(mapUV));
#endif
#if TERRAIN_VIEW != 3
    float direct=max(0.,dot(normal,light))*smoothstep(-.005,.005,dot(geo,light));
    float visibility=direct>0.?terrainLightVisibility(point,light):1.;
    // Deliberate small uniform fill for this diagnostic only; no exposure meter.
    material=pow(pow(material,vec3(2.2))*(.03+direct*visibility),vec3(1./2.2));
#endif
    diagnostic=material;
  }
  gl_FragColor=vec4(diagnostic,1.);
  return;
#endif
  float altitude=tangentHeight/1800.-.052;
  float solidLimb=-.052;
  // The panorama's derivatives must be evaluated before the visibility branch.
  // Its seam filtering is shared with the reference path.
  vec3 galacticLight=milkyWay(earthRay)*galaxyAmount;
  vec3 color=vec3(0.);
  float cssHeight=resolution.y/pixelRatio;
  // The same LVLH camera projects the ground, Sun and inertial sky.
  vec3 stars=texture2D(starMap,uv).rgb;
  vec3 catalogLight=mix(pow(stars,vec3(2.2)),stars,starsLinear);
  // Add emitted light; the galactic image has no opacity or extinction mask
  // for foreground stars. Camera exposure handles both daytime and nighttime.
  color=pow(vec3(.0015,.002,.0035),vec3(2.2))+galacticLight+catalogLight;
  for(int i=0;i<5;i++) {
    vec3 body=planets[i].xyz;
    float brightness=pointBrightness(planets[i].w);
    vec2 sourcePosition=screenPosition(body);
    vec2 delta=(p-sourcePosition)*resolution.y/pixelRatio;
    if(dot(body,cameraBasis[2])>0.)color+=lensPsf(delta,sourcePosition)*brightness;
  }
  float moonDistance=length(earthRay-moon.xyz);
  float pixel=1./(resolution.y*FOCAL);
  float lunarRadius=moon.w;
  float disk=1.-smoothstep(lunarRadius-pixel,lunarRadius+pixel,moonDistance);
  color*=1.-disk;
  vec2 lunarCenter=screenPosition(moon.xyz);
  float radiusPixels=lunarRadius*cssHeight*FOCAL;
  float lunarField=clamp(length(lunarCenter)/1.25,0.,1.);
  float lunarSupport=46.+43.*lunarField*lunarField;
  // Convolve a resolved illuminated lunar disk with the SAME lens PSF as stars.
  // Its brightness is accumulated in linear light before sensor clipping.
  if(dot(moon.xyz,cameraBasis[2])>0. && length((p-lunarCenter)*cssHeight)<radiusPixels+lunarSupport) {
    vec3 lunarLight=vec3(0.);
    for(int i=0;i<${LUNAR_SAMPLE_COUNT};i++) {
      vec2 delta=(p-screenPosition(moonSamples[i].xyz))*cssHeight;
      lunarLight+=lensPsf(delta,lunarCenter)*moonSamples[i].w;
    }
    float area=3.141592654*radiusPixels*radiusPixels;
    color+=lunarLight*area/${optics.integral.toFixed(8)}*18.;
  }
  // Legacy composition encoding, decoded before the linear HDR output.
  color=pow(max(color,vec3(0.)),vec3(1./2.2));
  color*=skyMask;
  vec2 solarCenter=screenPosition(sunDirection);
  float solarPixels=${SOLAR_RADIUS}*cssHeight*FOCAL;
  vec2 solarDelta=(p-solarCenter)*cssHeight;
  vec3 solarDisk=vec3(0.);
  if(solarVisibility>0. && dot(sunDirection,cameraBasis[2])>0. && length(solarDelta)<solarPixels+130.){
    float weightSum=0.;
    // Uniform area samples of the finite disk, convolved with the same optical
    // response as other sources. Peak clipping belongs to the sensor later.
    for(int i=0;i<24;i++){
      float angle=float(i)*2.39996323;
      vec2 offset=vec2(cos(angle),sin(angle))*sqrt((float(i)+.5)/24.)*solarPixels;
      // Occlude each piece of the source BEFORE spreading its light through
      // the lens. A small footprint makes partial eclipses continuous.
      vec3 sourceRay=normalize(cameraBasis*vec3(solarCenter+offset/cssHeight,FOCAL));
      float earthAngle=asin(clamp(dot(normalize(cameraPosition),sourceRay),-1.,1.))
        +acos(1./length(cameraPosition));
      float sampleRadius=${SOLAR_RADIUS}/sqrt(24.);
      float visible=smoothstep(-sampleRadius,sampleRadius,earthAngle);
      solarDisk+=lensPsf(solarDelta-offset,solarCenter)*visible;
      weightSum+=visible;
    }
    // Match the analytic visible area; sampling only determines the shape.
    #ifdef SOLAR_TRANSMISSION
    solarDisk*=texture2D(solarTransmission,vec2(.3,.5)).rgb;
    #endif
    solarDisk*=solarVisibility/max(.000001,weightSum)
      *(1.-smoothstep(solarPixels+95.,solarPixels+130.,length(solarDelta)))
      *3.14159265*solarPixels*solarPixels/${optics.integral.toFixed(8)}
      *${(SOLAR_RADIANCE*(1-SOLAR_SCATTER_FRACTION)).toFixed(5)};
  }

  if (skyMask < 1.) {
    float distance=groundDistance>0.?groundDistance:max(0.,-b-sqrt(max(0.,discriminant)));
    vec3 surfacePoint=cameraPosition+earthRay*distance;
    vec3 geo=normalize(surfacePoint);
    vec3 normal=terrainNormal(surfacePoint,distance);
    float solar=dot(geo,sunDirection);
    float direct=max(0.,dot(normal,sunDirection))*smoothstep(-.005,.005,solar);
    float night=cityActivation(geo);
    float twilight=smoothstep(-.12,.0,solar)*(1.-smoothstep(.0,.12,solar));
    float ground=1.-skyMask;
    vec3 original=vec3(0.);
    vec2 mapUV=earthUV(geo);
    // Equirectangular texels narrow with latitude. Without this factor the
    // polar cap selects unresolved tile detail in wedges meeting at the pole.
    float footprint=distance*13751./(resolution.y*FOCAL*max(.02,-dot(geo,earthRay))*max(.02,length(geo.xy)));
    vec3 albedo=detailedDay(mapUV,footprint,surfaceAlbedo(mapUV));
    vec3 surface=vec3(0.);
    float lamp=detailedNight(mapUV,footprint,cityEmission(mapUV));
    float groundShadow=direct>0.?cloudShadowAlong(surfacePoint+sunDirection*.00003,sunDirection)*terrainSunVisibility(surfacePoint):1.;
    vec3 surfaceSunTransmission=sunlightTransmission(surfacePoint,sunDirection);
    vec3 incidentSun=surfaceSunTransmission*vec3(1.,.97,.92);
    // Direct sunlight loses blue to the air. Return the downward portion as
    // diffuse skylight rather than tinting every snowfield with direct Sun alone.
    // This bounded single-scattering estimate vanishes at night and in vacuum.
    float sunHeight=max(0.,solar);
    vec3 skyIrradiance=(vec3(1.)-surfaceSunTransmission)
      *sunHeight*.5*max(0.,dot(normal,geo));
    vec3 dayIrradiance=incidentSun*direct*groundShadow+skyIrradiance;
    surface+=albedo*pow(dayIrradiance*solarIrradiance/3.141592654,vec3(1./2.2));
    surface+=vec3(.024,.026,.036)*twilight;
    vec3 moonDirection=moonDirectionAt(surfacePoint);
    vec3 incidentMoon=solar<.08?moonlightAt(surfacePoint):vec3(0.);
    float lunarDirect=max(0.,dot(normal,moonDirection))*smoothstep(-.005,.005,dot(geo,moonDirection));
    float lunarShadow=solar<.08&&lunarDirect*lunarIrradiance>.0001?cloudShadowAlong(surfacePoint,moonDirection):1.;
    vec3 lunarDiffuse=pow(albedo,vec3(2.2))*incidentMoon*lunarDirect*lunarShadow/3.141592654;
    float water=terrainReady>.5?terrainData(mapUV,0.).b:1.-smoothstep(.01,.065,albedo.g-albedo.b*.65);
    // Diffuse downwelling light belongs to the emitting atmosphere, not the
    // observer. The same point receives it from every camera altitude.
    bool skyDiffuseNeeded=solar<.08;
    vec3 nightSky=skyDiffuseNeeded?airglowIrradiance(surfacePoint)+galacticIrradiance(geo)*nightSkyTransmission(surfacePoint):vec3(0.);
    float skyShadow=skyDiffuseNeeded?cloudShadowAlong(surfacePoint,geo):1.;
    vec3 skyDiffuse=pow(albedo,vec3(2.2))*nightSky*skyShadow/3.141592654
      *max(0.,dot(normal,geo))*(1.-water);
    vec3 reflected=vec3(0.);
    if(water>.001){
      float sunGlint=oceanReflection(geo,-earthRay,sunDirection,distance/(resolution.y*FOCAL*max(.05,-dot(geo,earthRay))))*groundShadow;
      // Incoming sunlight crosses the air before reflection. The existing
      // view integral applies the separate water-to-camera path exactly once.
      reflected+=incidentSun*sunGlint*solarIrradiance;
      // Parallax from the orbital camera to the reflecting water patch.
      float moonGlint=oceanReflection(geo,-earthRay,moonDirection,distance/(resolution.y*FOCAL*max(.05,-dot(geo,earthRay))));
      if(moonGlint>.0001)reflected+=incidentMoon*moonGlint*lunarShadow;
    }
    surface=pow(pow(max(surface,vec3(0.)),vec3(2.2))+lunarDiffuse+skyDiffuse+reflected*water,vec3(1./2.2));
    // Emission preserves lamp color and contrast. The camera's highlight
    // shoulder, after cloud/air extinction, owns saturation toward white.
    vec3 cityRadiance=vec3(0.);
    float cityEnergy=cityLightEnergy(lamp);
    vec3 cityColor=cityLampColor(geo);
    cityRadiance=cityColor*cityEnergy;
    surface=pow(pow(max(surface,vec3(0.)),vec3(2.2))+cityRadiance*night,vec3(1./2.2));
    color+=ground*mix(original,surface,mapsReady*surfaceEnabled);
  }

  // Material/exposure grades above retain the accepted photographic response.
  // All subsequent cloud, air and emission compositing stays in linear light.
  color=pow(max(color,vec3(0.)),vec3(2.2));
#ifdef SEPARATE_WORLD_PASS
#ifdef COMPACT_WORLD_PASS
  // Store the terrain correction, not the full orbital distance. Its small
  // magnitude retains ground precision even when the camera is far away.
  float baseDistance=-b-sqrt(max(0.,discriminant));
  gl_FragColor=vec4(color,groundDistance>0.?groundDistance-baseDistance:-2.);
#else
  gl_FragColor=vec4(color,groundDistance);
#endif
#else
  float atmosphereDistance=groundDistance;
  if(mapsReady*surfaceEnabled>.5)color=cloudVolume(earthRay,groundDistance,color,atmosphereDistance);
  // Rayleigh scattering lies below the separate mesospheric emission layer.
  vec3 scattering;
  color=atmosphere(earthRay,atmosphereDistance,color,scattering);
  // Dense cloud tops occlude the air below them; their own uplight is already
  // integrated in cloudVolume. Clear rays continue down to the actual ground.
  color+=cityHaze(earthRay,atmosphereDistance);
  vec3 airglow=airglowEmission(earthRay,groundDistance);
  color+=airglow;
  vec3 auroralLight=vec3(0.);
  #ifdef AURORA
  auroralLight=pow(texture2D(auroraMap,uv).rgb,vec3(2.))*${AURORA_RADIANCE_RANGE.toFixed(1)};
  color+=auroralLight;
  #endif

  // CameraFinish owns defocus, internal lens reflections and sensor response.
  // Optical spread is in the camera, after world-space occlusion and air.
  // It may overlap the silhouette only when some photosphere is visible.
  color+=solarDisk*vec3(1.,.97,.92);
  color=sceneToOutputLinear(color);
  color+=atmosphericChroma(scattering,.25)+atmosphericChroma(airglow,.40)+atmosphericChroma(auroralLight,.18);
  color=fitOutputGamut(color);
  gl_FragColor=sceneLinear>.5?vec4(clamp(color,0.,65000.),1.):packSceneRadiance(color);
#endif

}
`;

// A separate five-pixel program keeps source-ray integration out of the
// screen-sized shader's control flow/register allocation. Unused scene helpers
// are removed by the compiler; shared density functions stay identical.
export const sourceTransmissionFragment=fragmentSource.slice(0,fragmentSource.indexOf('void main()'))+`
void main(){
  float source=floor(gl_FragCoord.x);
  vec3 ray=moon.xyz;
  if(source>.5)ray=sunDirection;
  if(source>1.5)for(int i=0;i<3;i++)if(abs(source-float(i+2))<.5)ray=normalize(cameraBasis*vec3(pointGhosts[i].xy,FOCAL));
  gl_FragColor=vec4(lensTransmission(ray),1.);
}
`;

// Compile the same volume/optics code independently from terrain and surface
// shading. The intermediate buffer carries linear radiance and exact distance.
export const volumeFragment=fragmentSource.slice(0,fragmentSource.indexOf('void main()'))+`
uniform sampler2D worldScene;
void main(){
  vec2 uv=gl_FragCoord.xy/resolution;
  vec2 p=(uv-.5)*vec2(resolution.x/resolution.y,1.);
  vec3 earthRay=normalize(cameraBasis*normalize(vec3(p,FOCAL)));
  vec4 world=texture2D(worldScene,uv);
  vec3 color=world.rgb;
  float groundDistance=world.a;
#ifdef COMPACT_WORLD_PASS
  float b=dot(cameraPosition,earthRay);
  float disc=b*b-dot(cameraPosition,cameraPosition)+1.;
  groundDistance=world.a< -1.?-1.:-b-sqrt(max(0.,disc))+world.a;
#endif
  float cssHeight=resolution.y/pixelRatio;
`+fragmentSource.slice(fragmentSource.indexOf('  vec2 solarCenter='),fragmentSource.indexOf('  if (skyMask < 1.) {'))
 +fragmentSource.slice(fragmentSource.indexOf('  float atmosphereDistance=groundDistance;'),fragmentSource.lastIndexOf('#endif'))+`
}`;

// One MRT cloud integral per half-resolution pixel. Snap to the sampled world
// texel so terrain depth and the ray agree, including odd framebuffer sizes.
export const halfCloudFragment=fragmentSource.slice(0,fragmentSource.indexOf('void main()'))+`
uniform sampler2D worldScene;
uniform vec2 cloudResolution;
void main(){
  vec2 uv=(floor(gl_FragCoord.xy/cloudResolution*resolution)+.5)/resolution;
  vec2 p=(uv-.5)*vec2(resolution.x/resolution.y,1.);
  vec3 ray=normalize(cameraBasis*normalize(vec3(p,FOCAL)));
  vec4 world=texture2D(worldScene,uv);
  float b=dot(cameraPosition,ray),c=dot(cameraPosition,cameraPosition);
  float groundDistance=world.a< -1.?-1.:-b-sqrt(max(0.,b*b-c+1.))+world.a;
  float transmission=1.,atmosphereDistance=groundDistance;
  vec3 scattered=vec3(0.);
  if(mapsReady*surfaceEnabled>.5)scattered=cloudIntegral(ray,groundDistance,transmission,atmosphereDistance);
  float entry=max(0.,-b-sqrt(max(0.,b*b-c+1.0018835*1.0018835)));
  float depth=groundDistance>0.?atmosphereDistance-groundDistance:
    (transmission<.999?(atmosphereDistance-entry)*(1.-transmission):0.);
  gl_FragData[0]=vec4(scattered,transmission);
  gl_FragData[1]=vec4(depth,world.a,0.,1.);
}
`;
export const halfCloudVolumeFragment=volumeFragment
  .replace('uniform sampler2D worldScene;', 'uniform sampler2D worldScene;\n'+cloudReconstructionShader)
  .replace('color=cloudVolume(earthRay,groundDistance,color,atmosphereDistance)',
    'color=reconstructClouds(uv,earthRay,groundDistance,color,atmosphereDistance)')
;
