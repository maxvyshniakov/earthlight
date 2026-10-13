// Without explicit LOD the hardware selects a level from coordinate
// derivatives. Across atan's branch cut neighbouring pixels appear to span the
// whole map and read its coarsest level: a line at the date line, even with a
// negative bias where drivers clamp it. Shift the far side by one period;
// repeat wrapping reads the same texels. Guarded: several modules embed it.
export const continuousLongitudeShader=`
#ifndef CONTINUOUS_LONGITUDE
#define CONTINUOUS_LONGITUDE 1
vec2 continuousLongitude(vec2 uv){
#ifdef SKY_DERIVATIVES
  if(uv.x>.5&&max(abs(dFdx(uv.x)),abs(dFdy(uv.x)))>.5)uv.x-=1.;
#endif
  return uv;
}
#endif
`;
// Equirectangular albedo: longitude wraps, but its pixel footprint must not.
export const surfaceMapShader=continuousLongitudeShader+`
vec4 surfaceMapSample(sampler2D map,vec2 uv){
#ifdef SKY_EXPLICIT_GRAD
 vec2 dx=dFdx(uv),dy=dFdy(uv);
 dx.x-=floor(dx.x+.5);dy.x-=floor(dy.x+.5);
 return texture2DGradEXT(map,uv,dx,dy);
#else
 // Avoid the spurious coarsest mip at atan's branch cut on older devices.
 // A clamped LOD bias cannot undo the branch cut's derivative jump.
 return texture2D(map,continuousLongitude(uv),-16.);
#endif
}
vec3 surfaceAlbedo(vec2 uv){return surfaceMapSample(surfaceMap,uv).rgb;}
`;
