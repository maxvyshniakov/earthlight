/** Scene sampling in linear radiance, including manual RGBE interpolation. */
export const sceneImageShader=`
vec3 imageAt(vec2 uv){
  vec2 edge=.5/resolution;
  uv=clamp(uv,edge,1.-edge);
  if(sceneLinear>.5)return texture2D(scene,uv).rgb;
  // RGBE fallback: decode exponent/radiance before bilinear interpolation.
  // Encoded RGBE values must never be filtered together.
  vec2 pixel=uv*resolution-.5,base=(floor(pixel)+.5)/resolution;
  vec2 f=fract(pixel),texel=1./resolution;
  vec3 a=unpackSceneRadiance(texture2D(scene,base));
  vec3 b=unpackSceneRadiance(texture2D(scene,base+vec2(texel.x,0.)));
  vec3 c=unpackSceneRadiance(texture2D(scene,base+vec2(0.,texel.y)));
  vec3 d=unpackSceneRadiance(texture2D(scene,base+texel));
  return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);
}
`;
