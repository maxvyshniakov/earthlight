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
// References and deliberate approximations are documented in orbital-sky.md.
// Upper bound on integrated reflected luminance at the default slider. The
// coating is illustrative, but ghost area can no longer create source energy.
// A ghost is two reflections; at ~0.5% per multicoated air-glass surface the
// strongest path returns 2.5e-5 of the source, and the seven path weights
// scale from it. The earlier 0.2% total was uncoated-lens territory: a solar
// ghost the size of the disk was tens of times brighter than sunlit cloud.
export const LENS_STRONGEST_PATH=2.5e-5;
export const LENS_REFLECTION_FRACTION=LENS_STRONGEST_PATH*2.345/.85;
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
  light+=apertureGhost(p,source,-.92,.009,.10,0.,vec3(.28,.84,.025),.85);
  light+=apertureGhost(p,source,-.58,.022,.13,0.,vec3(.025,.65,.21),.48);
  light+=apertureGhost(p,source, .21,.013,.12,0.,vec3(.92,.24,.015),.60);
  if(fullChain>.5){
  light+=apertureGhost(p,source,-.26,.034,.20,0.,vec3(.48,.035,.78),.22);
  light+=apertureGhost(p,source, .48,.057,.33,0.,vec3(.025,.48,.72),.065);
  light+=apertureGhost(p,source,-1.16,.081,.08,1.,vec3(.42,.68,.02),.095);
  light+=apertureGhost(p,source, .72,.098,.40,0.,vec3(.72,.18,.035),.035);
  }
  // All seven path weights sum to 2.345; the shorter point-source chain uses
  // less of the same energy budget. Inputs are integrated source flux.
  return light*acceptance*${LENS_REFLECTION_FRACTION}/2.345;
}
`;
