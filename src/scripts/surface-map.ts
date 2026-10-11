// Equirectangular albedo: longitude wraps, but its pixel footprint must not.
export const surfaceMapShader=`
vec4 surfaceMapSample(sampler2D map,vec2 uv){
#ifdef SKY_EXPLICIT_GRAD
 vec2 dx=dFdx(uv),dy=dFdy(uv);
 dx.x-=floor(dx.x+.5);dy.x-=floor(dy.x+.5);
 return texture2DGradEXT(map,uv,dx,dy);
#else
 // Avoid the spurious coarsest mip at atan's branch cut on older devices.
 return texture2D(map,uv,-16.);
#endif
}
vec3 surfaceAlbedo(vec2 uv){return surfaceMapSample(surfaceMap,uv).rgb;}
`;
