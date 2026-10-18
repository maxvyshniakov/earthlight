import {continuousLongitudeShader} from './surface-map.ts';
import {galaxyOverviewShader} from './texture-profile.ts';
import {galaxyTileShader} from './surface-tile-shader.ts';
import {nightScaleGlsl,perNightMode} from './physical-night.ts';
// Shared diffuse sky radiance for the camera and reflected night illumination.
export const galacticLightShaderFor=perNightMode(mode=>continuousLongitudeShader+`
#ifndef FOCAL
#define FOCAL 1.25
#endif
${galaxyOverviewShader}
#ifdef GALAXY_TILES
${galaxyTileShader}
#endif
vec3 galacticRadiance(vec3 color){return pow(color,vec3(3.3))*.006*${nightScaleGlsl('milkyWay',mode)};}
vec3 milkyWay(vec3 direction) {
  vec3 g=vec3(dot(direction,galacticBasis[0]),dot(direction,galacticBasis[1]),dot(direction,galacticBasis[2]));
  // NASA SVS plate carree: Galactic center at u=.5, longitude increases left.
  // ImageBitmap uploads are flipped vertically, so north is v=1.
  vec2 uv=vec2(.5-atan(g.y,g.x)/6.283185307,.5+asin(clamp(g.z,-1.,1.))/3.141592654);
  // Decode gamma (2.2), then apply modest contrast (1.5) and exposure in
  // linear light. Diffuse sky must sit well below the resolved point sources.
  #ifdef SKY_EXPLICIT_GRAD
  // atan wraps at the longitude seam. A nearly full-width jump is NOT a
  // pixel footprint: wrap only its derivative before choosing the mip level.
  vec2 dx=dFdx(uv),dy=dFdy(uv);
  dx.x-=floor(dx.x+.5);dy.x-=floor(dy.x+.5);
  vec3 sampleColor=texture2DGradEXT(milkyWayMap,uv,dx,dy).rgb;
  #else
  // Without explicit gradients use the base level, avoiding a false coarse
  // mip stripe at the seam. This diffuse plate has no resolved point stars.
  vec3 sampleColor=texture2D(milkyWayMap,continuousLongitude(uv),-16.).rgb;
  #endif
  #ifdef GALAXY_TILES
    #ifdef SKY_EXPLICIT_GRAD
    float footprint=max(length(dx*vec2(16384.,8192.)),length(dy*vec2(16384.,8192.)));
    #else
    float footprint=16384./(6.283185307*resolution.y*FOCAL*max(.1,length(g.xy)));
    #endif
    sampleColor=detailedGalaxy(uv,footprint,sampleColor);
  #endif
  return galacticRadiance(sampleColor);
}

vec3 galacticIrradiance(vec3 normal){
  if(galaxyAmount<=0.)return vec3(0.);
  vec3 east=normalize(cross(normal,abs(normal.z)<.9?vec3(0.,0.,1.):vec3(0.,1.,0.)));
  vec3 north=cross(normal,east),light=vec3(0.);
  // Cosine-weighted hemisphere quadrature of the same diffuse sky map.
  // A coarse mip represents broad incoming light, not individual star points.
  for(int i=0;i<8;i++){
    float r=sqrt((float(i)+.5)/8.),angle=float(i)*2.39996323;
    vec3 ray=normal*sqrt(1.-r*r)+r*(east*cos(angle)+north*sin(angle));
    vec3 g=vec3(dot(ray,galacticBasis[0]),dot(ray,galacticBasis[1]),dot(ray,galacticBasis[2]));
    vec2 uv=vec2(.5-atan(g.y,g.x)/6.283185307,.5+asin(clamp(g.z,-1.,1.))/3.141592654);
    #ifdef SKY_EXPLICIT_GRAD
    vec3 sampleColor=texture2DLodEXT(milkyWayMap,uv,galaxyIrradianceLod()).rgb;
    #else
    vec3 sampleColor=texture2D(milkyWayMap,uv,galaxyIrradianceLod()).rgb;
    #endif
    light+=galacticRadiance(sampleColor);
  }
  return light*(3.141592654/8.)*galaxyAmount;
}
`);
/** The default program's Milky Way. */
export const galacticLightShader=galacticLightShaderFor('current');
