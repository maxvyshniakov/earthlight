// Linear-light D65 transforms (CSS Color 4 sRGB / Display-P3 primaries).
// Column-major for GLSL. Source maps stay sRGB; the scene target uses output
// primaries in linear light when half-float filtering is available.
export const srgbToP3=[.822461969,.033194199,.017082631,.177538031,.966805801,.072397441,0,0,.910519929];
export const p3ToSrgb=[1.224940176,-.042056955,-.019637555,-.224940176,1.042056955,-.078636046,0,0,1.098273601];
const matrix=(values:number[])=>`mat3(${values.map(x=>x.toFixed(9)).join(',')})`;
export const sceneColorShader=`
// RGBE fallback keeps solar HDR until exposure even without float targets.
vec4 packSceneRadiance(vec3 value){
 value=max(value,vec3(0.));
 float peak=max(value.r,max(value.g,value.b));
 float exponent=clamp(ceil(log2(max(peak,0.0000000002328306))),-32.,31.);
 return vec4(value/exp2(exponent),(exponent+32.)/255.);
}
vec3 unpackSceneRadiance(vec4 value){return value.rgb*exp2(floor(value.a*255.+.5)-32.);}

uniform float displayP3;
vec3 displayToLinear(vec3 v){
  return vec3(v.r<=.04045?v.r/12.92:pow((v.r+.055)/1.055,2.4),
              v.g<=.04045?v.g/12.92:pow((v.g+.055)/1.055,2.4),
              v.b<=.04045?v.b/12.92:pow((v.b+.055)/1.055,2.4));
}
vec3 linearToDisplay(vec3 v){
  return vec3(v.r<=.0031308?v.r*12.92:1.055*pow(v.r,1./2.4)-.055,
              v.g<=.0031308?v.g*12.92:1.055*pow(v.g,1./2.4)-.055,
              v.b<=.0031308?v.b*12.92:1.055*pow(v.b,1./2.4)-.055);
}
vec3 lensToOutputLinear(vec3 reflections){
  if(displayP3<.5){
    reflections=${matrix(p3ToSrgb)}*reflections;
    float luminance=dot(reflections,vec3(.2126,.7152,.0722));
    float minimum=min(reflections.r,min(reflections.g,reflections.b));
    if(minimum<0.)reflections=mix(vec3(luminance),reflections,luminance/max(.000001,luminance-minimum));
  }
  return reflections;
}
vec3 fitOutputGamut(vec3 color){
  vec3 weights=displayP3>.5?vec3(.2289746,.6917385,.0792869):vec3(.2126,.7152,.0722);
  float luminance=max(0.,dot(color,weights));
  float minimum=min(color.r,min(color.g,color.b));
  if(minimum<0.)color=mix(vec3(luminance),color,luminance/max(.000001,luminance-minimum));
  return max(color,vec3(0.));
}
vec3 sceneToOutputLinear(vec3 scene){
  // Producers already composite radiance in linear light. Re-encoding with
  // gamma 2.2 and decoding as sRGB here lifts faint emission by up to orders
  // of magnitude and destroys the limb-to-nadir contrast of nightglow.
  // The display transfer belongs exclusively to CameraFinish, after exposure.
  vec3 linear=max(scene,vec3(0.));
  if(displayP3>.5)linear=${matrix(srgbToP3)}*linear;
  return max(vec3(0.),linear);
}
// Add chroma only for atmospheric light, in the actual output primaries. This
// can use colors outside sRGB on P3 without reinterpreting sRGB source maps.
vec3 atmosphericChroma(vec3 emission,float amount){
  vec3 color=sceneToOutputLinear(emission);
  vec3 weights=displayP3>.5?vec3(.2289746,.6917385,.0792869):vec3(.2126,.7152,.0722);
  return (color-vec3(dot(color,weights)))*amount;
}
`;

export function configureSceneColor(gl:WebGLRenderingContext):boolean {
  // Canvas tagging alone would reinterpret the entire existing sky as P3.
  // Enable only together with the explicit shader transform above.
  try {
    if('unpackColorSpace' in gl)gl.unpackColorSpace='srgb';
    if('drawingBufferColorSpace' in gl){
      gl.drawingBufferColorSpace=matchMedia('(color-gamut: p3)').matches?'display-p3':'srgb';
      return gl.drawingBufferColorSpace==='display-p3';
    }
  } catch { /* Unsupported browser: existing sRGB path. */ }
  return false;
}
