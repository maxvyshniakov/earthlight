/** Depth metadata stores small residuals so Float16 does not round orbital
 * distances to kilometre steps. For sky rays the residual is opacity weighted. */
export const cloudReconstructionShader = `
uniform sampler2D cloudRadiance;
uniform sampler2D cloudDepth;
uniform vec2 cloudResolution;
float cloudEntry(vec3 ray){
  float b=dot(cameraPosition,ray);
  return max(0.,-b-sqrt(max(0.,b*b-dot(cameraPosition,cameraPosition)+1.0018835*1.0018835)));
}
vec3 reconstructClouds(vec2 uv,vec3 ray,float groundDistance,vec3 background,out float atmosphereDistance){
  vec2 cell=uv*cloudResolution-.5;
  vec2 base=floor(cell);
  // The integral samples full-resolution texel centres. Compute interpolation
  // distances on that actual lattice (also when the framebuffer size is odd).
  vec2 left=(floor((base+.5)/cloudResolution*resolution)+.5)/resolution;
  base-=vec2(uv.x<left.x?1.:0.,uv.y<left.y?1.:0.);
  left=(floor((base+.5)/cloudResolution*resolution)+.5)/resolution;
  vec2 right=(floor((base+1.5)/cloudResolution*resolution)+.5)/resolution;
  vec2 fraction=clamp((uv-left)/(right-left),0.,1.);
  vec4 light=vec4(0.);
  float depth=0.,weightSum=0.;
  float groundResidual=texture2D(worldScene,uv).a;
  for(int y=0;y<2;y++)for(int x=0;x<2;x++){
    vec2 offset=vec2(float(x),float(y));
    vec2 tapUV=(base+offset+.5)/cloudResolution;
    vec4 tapLight=texture2D(cloudRadiance,tapUV);
    vec4 tapDepth=texture2D(cloudDepth,tapUV);
    vec2 axis=mix(1.-fraction,fraction,offset);
    float weight=axis.x*axis.y;
    // Never blend sky with ground. Preserve terrain discontinuities using the
    // compact residual (analytic sphere depth changes smoothly with the ray).
    bool tapGround=tapDepth.y> -1.;
    if(tapGround!=(groundDistance>0.))weight=0.;
    if(tapGround)weight*=exp(-abs(tapDepth.y-groundResidual)*6371./.5);
    // Cloud attributes interpolate continuously. A nearest-sample cloud guide
    // made the weights jump at half-resolution texel boundaries and produced
    // stair-stepped cloud edges. This accepts some cloud softness; only the
    // full-resolution ground depth provides an independent rejection guide.
    light+=tapLight*weight;depth+=tapDepth.x*weight;weightSum+=weight;
  }
  if(weightSum<.0001)return cloudVolume(ray,groundDistance,background,atmosphereDistance);
  light/=weightSum;depth/=weightSum;
  float opacity=1.-light.a;
  atmosphereDistance=groundDistance;
  if(opacity>.001)atmosphereDistance=groundDistance>0.?groundDistance+depth:cloudEntry(ray)+depth/opacity;
  return max(vec3(0.),background*light.a+light.rgb);
}
`;
