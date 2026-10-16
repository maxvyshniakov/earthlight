import { AEROSOL_SCALE_HEIGHT_KM } from './atmospheric-light';

// The solar aureole: sunlight scattered forwards by aerosol along lines of
// sight through the limb. It is scene light, not lens flare: it exists only
// where the view crosses the low atmosphere, reddens with the beam that feeds
// it and shrinks as the Sun sets. The scattering coefficient is the aerosol
// extinction that dims the direct beam (atmospheric-light.ts) times the
// single-scattering albedo, so the aureole carries light the beam has lost.
// The phase function is truncated beyond AUREOLE_REACH_DEGREES, which only
// removes light; the wide-angle remainder is not drawn.

/** Fraction of aerosol extinction that is scattering, not absorption. */
export const AEROSOL_ALBEDO=.95;
/** Aerosol phase function: two Henyey–Greenstein lobes. The narrow one
 * stands for the diffraction peak of coarse particles, which makes the
 * measured aureole fall roughly as θ⁻² from 1° to 10°; one lobe of g ≈ 0.7
 * would spread the same light over tens of degrees. */
export const AEROSOL_PHASE=[{weight:.4,asymmetry:.95},{weight:.6,asymmetry:.7}];
/** Angle from the Sun where the drawn aureole ends. */
export const AUREOLE_REACH_DEGREES=25;
/** Below this true altitude under the limb no air in view is sunlit. */
export const AUREOLE_SUN_DEPTH=.14;

const cosine=(degrees:number)=>Math.cos(degrees*Math.PI/180).toFixed(6);

// Needs limbColumns, limbExtinction, aerosolExtinction (atmospheric-light.ts),
// solarIrradiance and the solarImage uniform (scene-shader.ts).
export const solarAureoleShader=`
float henyeyGreenstein(float cosine,float g){return .0795775*(1.-g*g)/pow(1.+g*g-2.*g*cosine,1.5);}
float aerosolPhase(float cosine){
  return ${AEROSOL_PHASE.map(({weight,asymmetry})=>`${weight.toFixed(3)}*henyeyGreenstein(cosine,${asymmetry.toFixed(3)})`).join('+')};
}
// Single scattering inside the aerosol layers (below 30 km), sampled densely
// around the ray's closest approach to Earth. Sunlight arrives along the
// refracted image's direction, so the glow follows the Sun the camera sees.
vec3 solarAureole(vec3 ray,float groundDistance){
  if(solarImage.w<=0.)return vec3(0.);
  vec3 sun=solarImage.xyz;
  float cosine=dot(ray,sun);
  float window=smoothstep(${cosine(AUREOLE_REACH_DEGREES)},${cosine(AUREOLE_REACH_DEGREES*.6)},cosine);
  if(window<=0.)return vec3(0.);
  const float shell=1.+30./6371.;
  float b=dot(cameraPosition,ray),c=dot(cameraPosition,cameraPosition);
  float disc=b*b-c+shell*shell;
  if(disc<=0.||b>=0.)return vec3(0.);
  float entry=max(0.,-b-sqrt(disc)),exit=-b+sqrt(disc);
  if(groundDistance>0.)exit=min(exit,groundDistance);
  if(exit<=entry)return vec3(0.);
  float nearest=clamp(-b,entry,exit);
  vec3 viewDepth=limbExtinction(limbColumns(cameraPosition,ray,entry));
  vec3 light=vec3(0.);
  for(int i=0;i<16;i++){
    // Eight segments on each side of closest approach, narrowest there.
    float k=float(i<8?i:i-8)/8.,l=float(i<8?i+1:i-7)/8.;
    float start=i<8?nearest-(nearest-entry)*(1.-k)*(1.-k):nearest+(exit-nearest)*k*k;
    float end=i<8?nearest-(nearest-entry)*(1.-l)*(1.-l):nearest+(exit-nearest)*l*l;
    float stepLength=end-start;
    if(stepLength<=0.)continue;
    vec3 point=cameraPosition+ray*(start+end)*.5;
    float height=max(0.,length(point)-1.)*6371.;
    vec2 density=exp(-height/vec2(8.,${AEROSOL_SCALE_HEIGHT_KM.toFixed(1)}));
    vec3 local=limbExtinction(density)*stepLength;
    float sb=dot(point,sun);
    if(sb>=0.||sb*sb-dot(point,point)+1.<0.){
      vec3 sunDepth=limbExtinction(limbColumns(point,sun,10.));
      light+=exp(-viewDepth-.5*local-sunDepth)*(backgroundAerosolExtinction*density.x+aerosolExtinction*density.y)*stepLength;
    }
    viewDepth+=local;
  }
  return light*${AEROSOL_ALBEDO.toFixed(3)}*aerosolPhase(cosine)*window*solarIrradiance;
}
`;
