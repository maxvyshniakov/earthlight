// One co-registered ocean patch, opt-in only. The photograph supplies detail;
// coarse MODIS retrievals control broad vertical/optical differences.
export const modisOrbitShader=`
#ifdef MODIS_PATCH
uniform sampler2D modisPatch;
uniform float modisReady;
vec4 modisSample(vec3 point,float footprint,out float weight){
  vec3 n=normalize(point);
  vec2 degrees=vec2(atan(n.y,n.x),asin(clamp(n.z,-1.,1.)))*57.295779513;
  vec2 uv=(degrees-vec2(-91.,-32.))/12.;
  vec2 edge=min(uv,1.-uv);
  weight=modisReady*smoothstep(0.,.055,min(edge.x,edge.y));
  if(weight<=0.)return vec4(0.);
  float texels=footprint*2048./(.20943951*max(.3,length(n.xy)));
  float lod=max(0.,log2(max(1.,texels)));
#ifdef CLOUD_EXPLICIT_LOD
  vec4 field=texture2DLodEXT(modisPatch,uv,lod);
#else
  vec4 field=texture2D(modisPatch,uv,max(0.,lod-1.));
#endif
  weight*=field.a;
  return field;
}
float modisLayer(float base,float top,float height,float halfSpan){
  float z=clamp((height-base)/(top-base),0.,1.);
  if(halfSpan<=.0001)return 6.*z*(1.-z)/(top-base);
  float a=clamp((height-halfSpan-base)/(top-base),0.,1.);
  float b=clamp((height+halfSpan-base)/(top-base),0.,1.);
  return (b*b*(3.-2.*b)-a*a*(3.-2.*a))/(2.*halfSpan);
}
vec3 modisWeights(vec4 field){
  float top=field.g*16.;
  float low=1.-smoothstep(2.5,4.5,top),high=smoothstep(6.,9.,top);
  return vec3(low,1.-low-high,high);
}
vec2 modisLayerMoment(float base,float top,float height,float halfSpan){
  float a=clamp((height-halfSpan-base)/(top-base),0.,1.);
  float b=clamp((height+halfSpan-base)/(top-base),0.,1.);
  float mass=b*b*(3.-2.*b)-a*a*(3.-2.*a);
  float moment=b*b*b*(2.-1.5*b)-a*a*a*(2.-1.5*a);
  return vec2(mass,base*mass+(top-base)*moment);
}
vec3 modisLightingPoint(vec3 point,vec3 ray,float halfSpan,float footprint){
  float weight;vec4 field=modisSample(point,footprint,weight);
  if(weight<.001||halfSpan<.0001)return point;
  float height=(length(point)-1.)*6371.;vec3 layers=modisWeights(field);
  vec2 m=layers.x*modisLayerMoment(.8,2.8,height,halfSpan)
    +layers.y*modisLayerMoment(3.2,6.2,height,halfSpan)
    +layers.z*modisLayerMoment(8.,10.8,height,halfSpan);
  float vertical=dot(normalize(point),ray);
  if(m.x<.000001||abs(vertical)<.02)return point;
  return point+ray*((m.y/m.x-height)/6371./vertical)*weight;
}
float modisDensity(vec4 field,float height,float halfSpan){
  // Blend occupancy of broad height layers. Do not extrude a continuous sheet
  // between low and high retrievals: that creates artificial cloud cliffs.
  vec3 weights=modisWeights(field);
  vec3 profile=vec3(modisLayer(.8,2.8,height,halfSpan),
    modisLayer(3.2,6.2,height,halfSpan),modisLayer(8.,10.8,height,halfSpan));
  float tau=exp(field.b*5.0172798)-1.;
  float optical=mix(.35,4.5,smoothstep(1.,38.,tau));
  return dot(weights,profile)*pow(field.r,1.35)*optical;
}

#endif
`;
