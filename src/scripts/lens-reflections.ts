/** Area of a small distant disk above the spherical Earth's apparent limb.
 * A straight limb across the source disk is sufficient at the Sun's 0.27° radius.
 * Unlike a point-source test, this fades continuously through sunrise/sunset.
 */
export function visibleSourceDisk(camera: number[], direction: number[], radius: number): number {
  const distance=Math.hypot(...camera);
  const projection=camera.reduce((sum,x,i)=>sum+x*direction[i],0)/distance;
  const altitude=Math.asin(Math.max(-1,Math.min(1,projection)))+Math.acos(1/distance);
  const h=Math.max(-1,Math.min(1,altitude/radius));
  return (Math.acos(-h)+h*Math.sqrt(Math.max(0,1-h*h)))/Math.PI;
}

// A data-driven photographic preset, not a ray trace of a named objective.
// Aperture matches the rounded six-blade pupil used by build-optical-psf.mjs.
// References and deliberate approximations are documented in scene.md.
// Upper bound on integrated reflected luminance at the default slider. The
// coating is illustrative, but ghost area can no longer create source energy.
// A ghost is two reflections; at ~0.5% per multicoated air-glass surface the
// strongest path returns 2.5e-5 of the source, and the seven path weights
// scale from it. The earlier 0.2% total was uncoated-lens territory: a solar
// ghost the size of the disk was tens of times brighter than sunlit cloud.
export const LENS_STRONGEST_PATH=2.5e-5;
/** The seven reflection paths: image conjugate, aperture radius and edge
 * softness (frame heights), rim profile, linear Display-P3 tint and relative
 * strength. The first three also serve point sources. */
export const LENS_PATHS=[
  {conjugate:-.92,radius:.009,softness:.10,ring:0,tint:[.28,.84,.025],strength:.85},
  {conjugate:-.58,radius:.022,softness:.13,ring:0,tint:[.025,.65,.21],strength:.48},
  {conjugate:.21,radius:.013,softness:.12,ring:0,tint:[.92,.24,.015],strength:.60},
  {conjugate:-.26,radius:.034,softness:.20,ring:0,tint:[.48,.035,.78],strength:.22},
  {conjugate:.48,radius:.057,softness:.33,ring:0,tint:[.025,.48,.72],strength:.065},
  {conjugate:-1.16,radius:.081,softness:.08,ring:1,tint:[.42,.68,.02],strength:.095},
  {conjugate:.72,radius:.098,softness:.40,ring:0,tint:[.72,.18,.035],strength:.035},
] as const;
const POINT_PATHS=3;
const pathStrength=Math.max(...LENS_PATHS.map(path=>path.strength));
const pathWeightSum=LENS_PATHS.reduce((sum,path)=>sum+path.strength,0);
export const LENS_REFLECTION_FRACTION=LENS_STRONGEST_PATH*pathWeightSum/pathStrength;
const glsl=(x:number)=>Number.isInteger(x)?`${x}.`:String(x);
const tint=(path:typeof LENS_PATHS[number])=>`vec3(${path.tint.map(glsl).join(',')})`;
const apertureCall=(path:typeof LENS_PATHS[number])=>
  `light+=apertureGhost(p,source,${glsl(path.conjugate)},${glsl(path.radius)},${glsl(path.softness)},${glsl(path.ring)},${tint(path)},${glsl(path.strength)});`;
export const lensReflectionShader=`
float ghostAperture(vec2 q){
  float polygon=max(abs(dot(q,vec2(.963771,.266731))),
    max(abs(dot(q,vec2(.250891,.967015))),abs(dot(q,vec2(-.712880,.701287)))))-.91;
  // Smooth intersection rounds the circle/straight-blade joins.
  float circle=length(q)-1.;
  float h=max(.11-abs(circle-polygon),0.)/.11;
  return mix(max(circle,polygon)+h*h*.0275,circle,cameraOpening*.75);
}
vec3 ghostCoating(vec3 tint,float field,float localRadius,float path){
  // Thin-film-inspired spectral shift, sampled at three wavelengths. Each
  // optical path has its own phase; this is a photographic fit, not measured
  // multilayer coating data. Angle is deterministic, never animated by time.
  float opticalPath=(.72+abs(path)*.48)*sqrt(max(.25,1.-field*field*.65));
  vec3 phase=6.283185307*opticalPath*550./vec3(630.,535.,460.);
  vec3 coating=.48+.52*pow(.5+.5*cos(phase+localRadius*.32),vec3(2.));
  vec3 color=tint*coating;
  // Preserve approximate luminance as hue changes, keeping brightness control
  // independent from this spectral approximation. Coefficients are linear P3.
  return color/max(.0001,dot(color,vec3(.22897,.69174,.07929)));
}
vec3 apertureGhost(vec2 p,vec2 source,float conjugate,float radius,float softness,
                   float ring,vec3 tint,float strength){
  // A deterministic focus response per ghost path, not a prescribed real lens.
  // Different conjugates change at different rates during the same focus pull.
  float focus=focusRadius/6.;
  // Each path's defocus scales with the entrance pupil, f/N: the f-number in
  // cameraPupilScale and the focal length in ghostFocalScale. Source flux
  // grows as focal² while the kernel area grows the same, so zooming in on
  // the Sun keeps reflection surface brightness instead of stacking it.
  float dilation=cameraPupilScale*ghostFocalScale*(1.+focus*(.10+.07*sin(conjugate*7.)));
  radius*=dilation;
  // Approximate convolution with the extended source by matching footprint
  // variance. Preserve integrated energy: stopping down cannot turn the Sun's
  // finite conjugate into an arbitrarily bright point or a hard paper disk.
  float sourceBlur=ghostSourceRadius*abs(conjugate);
  float broadened=sqrt(radius*radius+sourceBlur*sourceBlur);
  radius=broadened;
  softness+=.5*sourceBlur/radius;
  softness+=cameraOpening*.025+focus*(.035+.045*(.5+.5*cos(conjugate*9.)));
  float field=clamp(length(source)/1.25,0.,1.);
  vec2 radial=source/max(length(source),.00001);
  vec2 offset=p-source*conjugate;
  // Smooth radial distortion; no arbitrary time animation or pupil rotation.
  float stretch=1.+field*field*(.24+abs(conjugate)*.22);
  vec2 q=(offset-radial*dot(offset,radial)*(1.-1./stretch))/radius;
  float aa=1.25/(resolution.y*radius);
  float edge=max(softness+field*.055,aa);
  float support=1.+edge*mix(1.,3.,ring);
  if(dot(q,q)>support*support)return vec3(0.);
  float distance=ghostAperture(q);
  float fill=1.-smoothstep(-edge,edge,distance);
  float rim=exp(-pow((distance+.055)/max(.04,edge),2.));
  float illumination=.53+.35*exp(-dot(q-radial*.28,q-radial*.28)*1.8)
    +.16*exp(-pow((distance+.18)/.22,2.));
  float profile=mix(fill*illumination,rim,ring);
  // Lens-barrel clipping gradually makes off-axis ghosts asymmetric.
  float clip=1.-smoothstep(1.05-edge,1.05+edge,length(q+radial*field*.34));
  // Profile <= 1.04 over this finite elliptical support. Dividing by its
  // conservative integral bounds every path's total energy, including pupil
  // changes, finite-source broadening and off-axis stretching.
  float area=1.04*3.141592654*radius*radius*stretch*support*support;
  return ghostCoating(tint,field,dot(q,radial),conjugate)*profile*clip*strength/area;
}
vec3 lensReflections(vec2 p,vec2 source,float aspect,float fullChain){
  float field=length(source)/1.25;
  float screenEdge=max(abs(source.x)/(aspect*.5),abs(source.y)/.5);
  // A source just outside the picture can still illuminate the lens.
  float acceptance=(1.-smoothstep(1.,1.55,screenEdge))
    *(1.-smoothstep(.70,1.05,field));
  if(acceptance<=0.)return vec3(0.);
  vec3 light=vec3(0.);
  // Saturated linear Display-P3 colors; the compositor converts for sRGB.
  ${LENS_PATHS.slice(0,POINT_PATHS).map(apertureCall).join('\n  ')}
  if(fullChain>.5){
  ${LENS_PATHS.slice(POINT_PATHS).map(apertureCall).join('\n  ')}
  }
  // The shorter point-source chain uses less of the same energy budget.
  // Inputs are integrated source flux.
  return light*acceptance*${LENS_REFLECTION_FRACTION/pathWeightSum};
}
`;

/** Reflections of everything the frame shows, read from the glare pyramid.
 * Path i images the scene at p / c_i, convolved with its aperture: the scene
 * level whose spread matches the aperture's (a disk of radius ρ has σ = ρ/2)
 * stands in for the aperture shape, as variance matching does for the Sun.
 * The 1/c² keeps each path's flux at its reflectance times the source flux.
 * Needs lensReflectionShader, cameraPupilScale, ghostFocalScale, resolution,
 * the field uniforms below and FIELD_LEVEL_SPREAD. */
export const fieldReflectionShader=(levelSpread:number,maxLevels:number)=>`
uniform sampler2D reflectionField;
uniform vec4 reflectionLevels[${maxLevels}];
uniform vec2 reflectionFieldSize;
uniform float reflectionLevelCount;
// The field fades over the outer 4% of the picture, so a bright subject at the
// edge leaves no rectangular reflection. Sources there stay analytic.
float fieldWindow(vec2 uv){
  vec2 w=smoothstep(0.,.04,uv)*smoothstep(1.,.96,uv);
  return w.x*w.y;
}
vec3 fieldLevel(vec2 uv,float level){
  vec4 rect=vec4(0.);
  for(int k=0;k<${maxLevels};k++)if(abs(float(k+1)-level)<.5)rect=reflectionLevels[k];
  vec2 edge=.5/reflectionFieldSize;
  return texture2D(reflectionField,rect.xy+clamp(uv*rect.zw,edge,rect.zw-edge)).rgb;
}
vec3 fieldGhost(vec2 p,float aspect,float conjugate,float radius,vec3 tint,float strength){
  vec2 s=p/conjugate;
  vec2 uv=s/vec2(aspect,1.)+.5;
  float window=fieldWindow(uv);
  float field=length(s)/1.25;
  float acceptance=window*(1.-smoothstep(.70,1.05,field));
  if(acceptance<=0.)return vec3(0.);
  float spread=.5*radius*cameraPupilScale*ghostFocalScale/abs(conjugate)*resolution.y;
  float lod=clamp(log2(max(spread,.001)/${levelSpread.toFixed(4)}),1.,reflectionLevelCount);
  float lower=floor(lod);
  vec3 scene=mix(fieldLevel(uv,lower),fieldLevel(uv,min(lower+1.,reflectionLevelCount)),lod-lower);
  return scene*lensToOutputLinear(ghostCoating(tint,field,0.,conjugate))*strength*acceptance/(conjugate*conjugate);
}
vec3 fieldReflections(vec2 p,float aspect){
  if(reflectionLevelCount<1.5)return vec3(0.);
  vec3 light=vec3(0.);
  ${LENS_PATHS.map(path=>`light+=fieldGhost(p,aspect,${glsl(path.conjugate)},${glsl(path.radius)},${tint(path)},${glsl(path.strength)});`).join('\n  ')}
  return light*${LENS_REFLECTION_FRACTION/pathWeightSum};
}
`;
