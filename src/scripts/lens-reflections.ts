import { IRIS_BLADES, cameraIrisShader } from './camera-iris';
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
// Aperture is the camera's rounded nine-blade iris (camera-iris.ts).
// References and deliberate approximations are documented in scene.md.
// Upper bound on integrated reflected luminance at the default slider. The
// coating is illustrative, but ghost area can no longer create source energy.
// A ghost is two reflections; at ~0.5% per multicoated air-glass surface the
// strongest path returns 2.5e-5 of the source, and the path weights
// scale from it. The earlier 0.2% total was uncoated-lens territory: a solar
// ghost the size of the disk was tens of times brighter than sunlit cloud.
export const LENS_STRONGEST_PATH=2.5e-5;
/** Lens presets by the strongest ghost path's return. `iss`, the default, is
 * the multicoated 28-300 mm seen in ISS photographs. `flare` is a flare-prone
 * lens, about 2.7% per surface as with a single-layer coating, 30 times the
 * ghosts at the same core and veil: what the Free Lens Flare Overlay needs
 * (docs/lab/flare-phases-2026-10-17.md). Only the reflections scale; the
 * iris, the scatter and the ghosts' shapes are shared. */
export const LENS_PRESETS={iss:{strongestPath:LENS_STRONGEST_PATH},flare:{strongestPath:7.5e-4}} as const;
export type LensPreset=keyof typeof LENS_PRESETS;
export const readLensPreset=(value:string|null):LensPreset=>value==='flare'?'flare':'iss';
/** A preset's reflection gain against the default lens. */
export const lensReflectance=(preset:LensPreset)=>LENS_PRESETS[preset].strongestPath/LENS_STRONGEST_PATH;
/** The eight aperture reflection paths: image conjugate, radius in frame heights at f/4
 * and 1×, edge softness in aperture radii, ring profile (0 a filled iris
 * image, 1 a caustic ring), linear Display-P3 tint (the colour on axis at
 * nominal coating thickness), relative strength, and the clipping element's
 * radius and walk with field in stop radii. The first three also serve point
 * sources. Radii and strengths follow the 28-300 mm ghosts in ISS067-E-124177
 * and 124188 (docs/lab/ghost-overlay-2026-10-16.md). */
export const LENS_PATHS=[
  {conjugate:-.92,radius:.032,softness:.06,ring:0,tint:[.28,.84,.025],strength:.85,rim:1.03,walk:1.03},
  // A front element's wide rim, walking fast with field: an almost straight cut.
  {conjugate:-.58,radius:.10,softness:.05,ring:0,tint:[.80,.30,.04],strength:.60,rim:2.2,walk:6.0},
  {conjugate:.21,radius:.022,softness:.10,ring:0,tint:[.92,.24,.015],strength:.50,rim:1.03,walk:1.03},
  // Nearly focused on the sensor: a small saturated point.
  {conjugate:-.36,radius:.006,softness:.12,ring:0,tint:[.70,.62,.03],strength:.45,rim:1.03,walk:1.03},
  {conjugate:-.26,radius:.055,softness:.10,ring:0,tint:[.48,.035,.78],strength:.40,rim:1.03,walk:1.03},
  {conjugate:.48,radius:.15,softness:.10,ring:0,tint:[.025,.48,.72],strength:.35,rim:1.03,walk:1.03},
  {conjugate:-1.16,radius:.085,softness:.012,ring:1,tint:[.42,.68,.02],strength:.55,rim:1.03,walk:1.03},
  {conjugate:-.50,radius:.42,softness:.05,ring:.5,tint:[.18,.28,.70],strength:.85,rim:1.03,walk:1.03},
] as const;
/** Barrel reflections. One path's reflected beam is wider than the barrel
 * between two edges, a spacer or retaining ring and the next element's rim,
 * so the barrel vignettes it. Its image is a large soft disk, the defocused
 * pupil at `disk` = [conjugate, radius at f/4 and 1×], and the bore between
 * the edges casts a shadow across it: the inner edge at `conjugate` with
 * radius `radius`, the outer at `conjugate + step` with radius `outer`
 * (frame heights at 1×). Every depth between them is a circle whose centre
 * slides along the source's line with field, so the shadow is the inside of a
 * tube seen at an angle, and the disk, the edges and the tube's two ends move
 * at different rates. Where the beam grazes an edge, the edge's bevel
 * returns a thin glint, sharp on one side and fading into the bore on the
 * other, on the lit side only (`side` −1 away from the source, `lit` =
 * [full, dark] cosines). The edges are fixed apertures; the disk is a pupil
 * image and shrinks as the lens stops down, until the barrel no longer cuts
 * it and the shadow and glints are gone. With `lens` 1 a lens surface down
 * the tube adds a small image split by colour. Fitted to the Free Lens Flare
 * Overlay video at 5.92 s: the Sun at (−0.48, 0.28), edges of 0.18 and 0.27
 * frame heights round c ≈ −0.97, a dark band between them over a green disk
 * that shows again outside, the glint on the far side, a rainbow spot off
 * centre and an arc of radius 1.15 at the frame edge
 * (docs/lab/ghost-overlay-2026-10-16.md). The strength is an estimate: an
 * oblique beam loses much of its flux to the barrel near the field's edge. */
export const LENS_BARRELS=[
  {conjugate:-.97,step:.03,radius:.18,outer:.27,disk:[-1.10,.48],side:-1,lit:[-.2,.6],softness:.03,lens:1,tint:[.20,.85,.08],strength:6.8},
  // The front element's edge: a glint only, one large rainbow arc on the far side.
  {conjugate:.55,step:0,radius:1.15,outer:1.15,disk:[0,0],side:-1,lit:[-.85,-.35],softness:.01,lens:0,tint:[.45,.55,.40],strength:4.8},
] as const;
const POINT_PATHS=3;
const pathStrength=Math.max(...LENS_PATHS.map(path=>path.strength));
const pathWeightSum=[...LENS_PATHS,...LENS_BARRELS].reduce((sum,path)=>sum+path.strength,0);
export const LENS_REFLECTION_FRACTION=LENS_STRONGEST_PATH*pathWeightSum/pathStrength;
const glsl=(x:number)=>Number.isInteger(x)?`${x}.`:String(x);
/** Wavenumbers of the three sampled wavelengths, 630, 535 and 460 nm, in µm⁻¹. */
const WAVENUMBERS=[1/.63,1/.535,1/.46];
/** Period of a coated surface's reflectance in wavenumber, µm⁻¹: a multilayer
 * stack about 0.55 µm thick optically. It puts the three samples about a third
 * of a period apart, so a film scale change turns the hue. */
const COATING_PERIOD=.9;
/** A coated surface's reflectance a + b·cos x + c·sin x, x = 2πσ/P, through
 * the square root of the path's tint: a ghost reflects at two such surfaces,
 * and at their nominal film thickness on axis it has the tint's colour. */
export function coatingSpectrum(tint:readonly number[]){
  const x=WAVENUMBERS.map(sigma=>2*Math.PI*sigma/COATING_PERIOD),y=tint.map(Math.sqrt);
  const rows=x.map(v=>[1,Math.cos(v),Math.sin(v)]);
  const det=(m:number[][])=>m[0][0]*(m[1][1]*m[2][2]-m[1][2]*m[2][1])-m[0][1]*(m[1][0]*m[2][2]-m[1][2]*m[2][0])+m[0][2]*(m[1][0]*m[2][1]-m[1][1]*m[2][0]);
  const d=det(rows);
  return [0,1,2].map(j=>det(rows.map((row,i)=>row.map((v,k)=>k===j?y[i]:v)))/d);
}
const spectrum=(path:{tint:readonly number[]})=>`vec3(${coatingSpectrum(path.tint).map(v=>v.toFixed(6)).join(',')})`;
const apertureCall=(path:typeof LENS_PATHS[number])=>
  `light+=apertureGhost(p,source,${glsl(path.conjugate)},${glsl(path.radius)},${glsl(path.softness)},${glsl(path.ring)},${spectrum(path)},${glsl(path.strength)},vec2(${glsl(path.rim)},${glsl(path.walk)}));`;
const barrelCall=(barrel:typeof LENS_BARRELS[number])=>
  `light+=barrelGhost(p,source,${glsl(barrel.conjugate)},${glsl(barrel.step)},${glsl(barrel.radius)},${glsl(barrel.outer)},vec2(${barrel.disk.map(glsl).join(',')}),${glsl(barrel.side)},vec3(${barrel.lit.map(glsl).join(',')},${Math.min(1,litMean(barrel.lit)+.1).toFixed(4)}),${glsl(barrel.softness)},${glsl(barrel.lens)},${spectrum(barrel)},${glsl(barrel.strength)});`;
/** A caustic ring's radius changes by about 1/V across the visible, V ≈ 40,
 * so its rim splits into a rainbow wherever it is sharper than that. */
const RING_DISPERSION=.012;
/** The thin ring just outside a caustic rim, the clipping element's edge or
 * the barrel wall, in aperture radii beyond the rim, and its strength. */
const RING_OUTER=.13,RING_OUTER_STRENGTH=.45;
/** Interior of a caustic ring against its rim's peak. */
const RING_INTERIOR=.12;
/** Shares of a barrel's strength: the dim vignetted disk, the lit lip, the
 * outer edge's glint and the lens spot. Without a bore (a single edge) the
 * edge's arc takes everything but the spot. */
const BARREL_DISK=.35,BARREL_LIP=.4,BARREL_OUTER=.17,BARREL_SPOT=.08;
/** How far a single edge's arc fades outwards, in edge radii. A thin glint,
 * as at the overlay's frame edge; at 0.08 its tail washed a quarter of the
 * frame grey once the source moved beyond the picture. */
const ARC_FALL=.02;
/** The inner edge's lit lip seen at an angle: a crescent between the edge
 * circle and one LIP_DEPTH larger, whose centre moves away from the source by
 * LIP_PARALLAX times the barrel's depth step, so the lip is thick on the far
 * side and thins towards the source. Beyond it the bore's wall runs to the
 * outer edge in shadow: it passes WALL_TRANSMISSION of the disk, darkest
 * beside the lip and lightening outwards, a little more on the lit side. The
 * same wall dims the Sun's veil by up to VEIL_SHADOW. */
export const LIP_DEPTH=.1,LIP_PARALLAX=.8,WALL_TRANSMISSION=[.15,.5],VEIL_SHADOW=.5;
/** The front barrel: a fixed aperture ahead of the stop that vignettes the
 * whole beam off axis, before any reflection. `radius` is in stop radii and
 * `field` is where the chief ray reaches its edge, as tan of the angle at 1×
 * (image height over 1.25 frame heights). The opening passes the overlap of
 * the two circles, so a source beyond the picture still lights the lens and
 * its ghosts until the barrel closes it off: at f/4 about half at field 1.16,
 * nothing past 2; stopped down the cut sharpens round field 1.3. Fitted to
 * the Free Lens Flare Overlay, whose ghosts glow while the source is still
 * about 49° off axis (docs/lab/flare-phases-2026-10-17.md). */
export const FRONT_BARREL={radius:1.5,field:1.3};
/** A barrel's lit side, `lit` = [full, dark]: fully lit where the cosine of
 * the angle to the source (for side −1) is below `full`, dark above `dark`.
 * The mean round the circle bounds a rim's integral. */
const litMean=([full,dark]:readonly number[])=>{let sum=0;const n=3600;for(let i=0;i<n;i++){const c=Math.cos(2*Math.PI*(i+.5)/n),x=Math.min(1,Math.max(0,(dark-c)/(dark-full)));sum+=x*x*(3-2*x);}return sum/n;};
export const lensReflectionShader=`
${cameraIrisShader}
// Signed distance to the iris opening, negative inside, in aperture radii.
// The blades flatten as the camera stops down, as in the PSF.
float ghostAperture(vec2 q){
  float fNumber=4./cameraPupilScale,rho=irisCurvature(fNumber),distance=length(q)-irisStop(fNumber);
  for(int k=0;k<${IRIS_BLADES};k++){vec3 blade=irisBlade(k,rho);distance=max(distance,length(q-blade.xy)-blade.z);}
  return distance;
}
// One coated surface's reflectance at the three wavelengths. Scaling every
// layer's optical thickness by s samples the nominal spectrum at σ·s: thicker
// film shifts it to the red, steeper incidence to the blue. An illustrative
// fit through the path's tint, not measured multilayer data.
vec3 coatedSurface(vec3 spectrum,float scale){
  vec3 x=vec3(${WAVENUMBERS.map(sigma=>(2*Math.PI*sigma/COATING_PERIOD).toFixed(6)).join(',')})*scale;
  return max(vec3(0.),spectrum.x+spectrum.y*cos(x)+spectrum.z*sin(x));
}
// The path's colour after its two reflections, each with its own film scale.
vec3 ghostCoating(vec3 spectrum,vec2 film){
  vec3 color=coatedSurface(spectrum,film.x)*coatedSurface(spectrum,film.y);
  // Preserve approximate luminance as hue changes, keeping brightness control
  // independent from this spectral approximation. Coefficients are linear P3.
  return color/max(.0001,dot(color,vec3(.22897,.69174,.07929)));
}
// Film scale of one reflecting surface where the ray through pupil point q
// meets it. Fixed by position and field, never animated.
float coatedFilm(vec2 q,vec2 chief,float seed,float tilt,float walk){
  // Incidence: the chief ray's angle plus the pupil ray's, steepest at the
  // rim of a strongly curved element. Optical thickness goes as cos θ in the
  // film; 0.65 sin²θ_t per unit angle as for the field before.
  vec2 angle=chief+q*tilt;
  float incidence=sqrt(max(.25,1.-.65*dot(angle,angle)));
  // Coating thickness on this element: thinner towards its rim, as deposited
  // on a curved surface, with low-order blotches. The pupil maps onto the
  // beam's footprint, which walks across the element with field.
  vec2 e=q*.85+chief*walk;
  float a=6.283185307*seed;
  float blotch=sin(dot(e,vec2(cos(a),sin(a)))*4.2+seed*9.)
    +sin(dot(e,vec2(cos(a+2.1),sin(a+2.1)))*5.+seed*5.)
    +sin(dot(e,vec2(cos(a+4.2),sin(a+4.2)))*3.6+seed*3.);
  return incidence*(1.-.03*dot(e,e)+.04*blotch);
}
vec3 apertureGhost(vec2 p,vec2 source,float conjugate,float radius,float softness,
                   float ring,vec3 spectrum,float strength,vec2 vignette){
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
  // Beyond the picture the front barrel and the element rims below cut the
  // beam; the field itself runs on.
  float field=min(length(source)/1.25,2.5);
  vec2 radial=source/max(length(source),.00001);
  vec2 offset=p-source*conjugate;
  // Smooth radial distortion; no arbitrary time animation or pupil rotation.
  // It saturates past the picture's corner rather than smearing the ghost.
  float stretched=min(field,1.3);
  float stretch=1.+stretched*stretched*(.24+abs(conjugate)*.22);
  vec2 q=(offset-radial*dot(offset,radial)*(1.-1./stretch))/radius;
  float aa=1.25/(resolution.y*radius);
  // Off-axis blur softens a filled image's edge; a caustic stays a caustic.
  float edge=max(softness+field*.055*(1.-ring),aa);
  float support=1.+edge+ring*(${glsl(RING_OUTER)}+2.*edge);
  // Dispersion in the ghost path's glass. Its focus moves by about f/V
  // across the visible, which changes the defocused ghost's radius by a fixed
  // amount, about ±0.25% of the frame height at f/4 and 1×, so nearly
  // focused, small ghosts get the widest fringes for their size. Its conjugate
  // differs by about 1%, so each colour sits slightly further along the
  // radial line. Signs are fixed per path. Red, green, blue; aperture radii.
  // A caustic ring's radius changes by a fixed fraction instead, about 1/V.
  float spread=sin(conjugate*5.3+1.);
  vec3 size=1.+vec3(1.,0.,-1.)*mix(clamp(.0025*dilation*spread/radius,-.15,.15),${glsl(RING_DISPERSION)}*sign(spread),ring);
  vec3 shift=clamp(vec3(1.,0.,-1.)*.012*cos(conjugate*4.1)*length(source)*conjugate/(stretch*radius),-.25,.25);
  float reach=support*max(size.x,size.z)+max(abs(shift.x),abs(shift.z));
  if(dot(q,q)>reach*reach)return vec3(0.);
  // A ring is the caustic at a lens element's round edge, not the iris image.
  float r=length(q);
  float distance=ring>.99?r-1.:ghostAperture(q);
  // First order in the small scale and shift: the outline moves along q.
  vec3 channel=distance-(size-1.)*r-shift*dot(q,radial)/max(r,.0001);
  vec3 fill=1.-smoothstep(-edge,edge,channel);
  vec3 glow=(channel+.18)/.22;
  vec3 illumination=.53+.35*exp(-dot(q-radial*.28,q-radial*.28)*1.8)+.16*exp(-glow*glow);
  // Spherical aberration of the reflected beam piles its rays at the edge:
  // a thin bright rim around a dim interior, as in ISS067-E-124188. Its width
  // is the path's softness and the source's own size, so the Sun at a long
  // focal length still widens it. The element edge or barrel wall beyond it
  // returns a thinner, reddish ring.
  vec3 rimDistance=channel/edge,outerDistance=(channel-${glsl(RING_OUTER)})/edge;
  vec3 caustic=${glsl(RING_INTERIOR)}*fill+exp(-rimDistance*rimDistance)
    +${glsl(RING_OUTER_STRENGTH)}*vec3(1.,.4,.25)*exp(-outerDistance*outerDistance);
  vec3 profile=mix(fill*illumination,caustic,ring);
  // Each colour's support, scaled and shifted with its outline.
  profile*=step(vec3(length(q-radial*shift.x),length(q-radial*shift.y),length(q-radial*shift.z)),support*size);
  // An element rim clips off-axis ghosts near full aperture. It is a fixed
  // circle outside the stop, so like the stop it grows against the opening as
  // the lens stops down. vignette.x is its radius and vignette.y the walk of
  // its centre per unit field, in stop radii; at 1.03 both, the chief ray
  // reaches it at field 1. The cut is on the side away from the source:
  // ISS037-E-28841 (f/4.5) shows the arc there, 28846 (f/8) only grazes and
  // 28847 (f/10) is complete at the same field
  // (docs/lab/ghost-clipping-2026-10-16.md). A wide front-element rim that
  // walks fast cuts almost straight. The rim is imaged through this path's
  // glass, so its size differs by colour: blue reaches past the cut, red
  // and green past the blades on the other side (the shift above).
  float stop=irisStop(4./cameraPupilScale);
  vec3 elementRim=vignette.x*stop*(1.+vec3(-1.,0.,1.)*.025);
  float clipEdge=max(.3*edge,aa);
  vec3 clip=1.-smoothstep(-clipEdge,clipEdge,length(q-radial*field*vignette.y*stop)-elementRim);
  // The two coated surfaces, each with its own pupil tilt, footprint walk and
  // thickness pattern, so their colour patterns do not share a centre.
  vec2 chief=radial*field;
  vec2 film=vec2(coatedFilm(q,chief,fract(conjugate*3.17+.13),.4,.6),
                 coatedFilm(q,chief,fract(conjugate*5.71+.61),.15,-.45));
  // The filled profile is <= 1.04 over its finite elliptical support, per
  // colour scaled by size². The caustic's interior is bounded the same way;
  // each of its rings integrates to at most √π·width·2π·radius, the outline's
  // gradient in q being at least 0.85 and its radius at most a nonagon's
  // corner, 1.07, past the largest colour's scale and shift. Dividing by these
  // conservative integrals bounds every path's total energy, including pupil
  // changes, finite-source broadening, off-axis stretching and dispersion.
  float outline=1.07*(max(size.x,size.z)+max(abs(shift.x),abs(shift.z)));
  float rings=(1.+${glsl(RING_OUTER_STRENGTH)})*1.7725*edge/.85*6.2832*(outline+${glsl(RING_OUTER)}+edge);
  vec3 disk=3.141592654*support*support*size*size;
  vec3 bound=mix(1.04*disk,${glsl(RING_INTERIOR)}*disk+rings,ring);
  return ghostCoating(spectrum,film)*profile*clip*strength/(radius*radius*stretch*bound);
}
// A barrel: the vignetted pupil disk, the bore's shadow across it, the edges'
// glints and a lens spot. Distances in frame heights. The shadow only
// multiplies the disk; every added part is divided by a conservative bound
// on its integral and gets a fixed share, so the barrel returns at most its
// strength.
vec3 barrelGhost(vec2 p,vec2 source,float conjugate,float depthStep,float inner,float outer,vec2 disk,
                 float side,vec3 litShape,float softness,float lens,vec3 spectrum,float strength){
  float field=clamp(length(source)/1.25,0.,1.);
  vec2 radial=source/max(length(source),.00001);
  float spread=sin(conjugate*5.3+1.);
  vec3 size=1.+vec3(1.,0.,-1.)*${glsl(RING_DISPERSION)}*sign(spread);
  float aa=1.25/resolution.y;
  // The pupil image, dilated like an aperture ghost, broadened by the source.
  float hasDisk=step(1e-4,disk.y);
  float rd=sqrt(pow(disk.y*cameraPupilScale*ghostFocalScale,2.)+pow(ghostSourceRadius*abs(disk.x),2.));
  vec2 ad=p-source*disk.x;
  float ld=length(ad),soft=max(.18*rd,aa);
  // The two edges and the bore between them.
  vec2 a=p-source*conjugate,b=source*depthStep;
  vec3 r0=inner*ghostFocalScale*size,r1=outer*ghostFocalScale*size;
  float sourceBlur=ghostSourceRadius*abs(conjugate);
  float width=max(max(.5*sourceBlur,.006*inner*ghostFocalScale),aa);
  float reach=max(max(r1.x,r1.z)+length(b)+.05*r1.y,hasDisk*(rd+2.*soft));
  if(dot(a,a)>reach*reach&&dot(ad,ad)>reach*reach)return vec3(0.);
  float l0=length(a),l1=length(a-b);
  float facing=l0>0.?dot(a,radial)/l0:0.;
  float lobe=smoothstep(0.,.2,field);
  float lit=mix(1.,1.-smoothstep(litShape.x,litShape.y,-facing*side),lobe);
  float dr=r1.y-r0.y,bore=step(1e-4,dr);
  // The lit lip: a crescent between the inner edge and a circle LIP_DEPTH
  // larger whose centre lies further from the source, so it is thick on the
  // far side. Its inner edge is a sharp bevel glint; across the lip the light
  // falls off, as on a rounded rim. Crisp edges, no halo.
  vec2 lipShift=-b*${glsl(LIP_PARALLAX)};
  vec3 rLip=r0*${glsl(1+LIP_DEPTH)};
  float lLip=length(a-lipShift);
  vec3 dIn=l0-r0,dOut=rLip-lLip;
  vec3 inLip=smoothstep(-width,width,dIn)*smoothstep(-width,width,dOut);
  vec3 across=clamp(dIn/max(dIn+dOut,vec3(1e-5)),0.,1.);
  vec3 bevel=exp(-dIn*dIn/(width*width))*vec3(.75,1.,1.15);
  vec3 lip=bore*(inLip*(.4+.6*(1.-across)*(1.-across))+.6*bevel)*lit;
  // Beyond the lip the bore's wall hides the disk out to the outer edge: a
  // dark band with crisp edges and halftones, darkest beside the lip,
  // lighter outwards and where the wall faces the light.
  float wall=bore*smoothstep(-width,width,lLip-rLip.y)*(1.-smoothstep(-width,width,l1-r1.y));
  float depth=clamp((lLip-rLip.y)/max(r1.y-rLip.y,1e-5),0.,1.);
  float shade=mix(${glsl(WALL_TRANSMISSION[0])},${glsl(WALL_TRANSMISSION[1])},depth*depth)*(.75+.25*lit);
  float transmission=1.-wall*(1.-shade);
  // The disk, dim: a soft edge and a gradient, brighter on the far side,
  // cut by the outer edge, which vignettes the beam: beyond it, nothing.
  float illumination=.2+.8*clamp(.5-.5*dot(ad,radial)/max(rd,1e-5),0.,1.);
  float vignette=mix(1.,1.-smoothstep(-width,width,l1-r1.y),bore);
  float diskProfile=hasDisk*(1.-smoothstep(rd-soft,rd+soft,ld))*illumination*transmission*vignette;
  // The outer edge's glint, thin and reddish, sharp outwards; a single edge
  // (no bore) is an arc of the same kind.
  float reaches0=mix(1.,smoothstep(.8*r0.y,1.05*r0.y,rd),hasDisk),reaches1=mix(1.,smoothstep(.8*r1.y,1.05*r1.y,rd),hasDisk);
  vec3 fall0=${glsl(ARC_FALL)}*r0,fall1=.05*r1;
  vec3 d0=l0-r0,d1=l1-r1;
  vec3 g0=mix(exp(-d0*d0/(width*width)),exp(-max(d0,0.)/fall0),step(0.,d0));
  vec3 g1=mix(exp(-d1*d1/(width*width)),exp(min(d1,0.)/fall1),step(d1,vec3(0.)));
  // Towards the picture's corner the front barrel's lip shades the element's
  // edge long before it closes the opening: in the overlay the arc is absent
  // until the source is well inside the frame (field 0.77 at 4.7 s) and
  // full at 0.44, though its ghosts glow from field 1.16.
  float edgeLit=1.-smoothstep(.5,.8,length(source)/1.25);
  vec3 arc=(1.-bore)*g0*reaches0*lit*edgeLit;
  vec3 outerGlint=bore*vec3(1.,.45,.3)*g1*reaches1*lit;
  // A lens surface down the tube: a small soft image away from the source,
  // its colours separated along the source's line; both grow with field
  // from the overlay's 0.44, where they were measured.
  float offAxis=min(1.,field/.44);
  float spot=.21*inner*ghostFocalScale;
  vec2 centre=-radial*.4*offAxis*inner*ghostFocalScale;
  vec3 shift=vec3(-.6,0.,.6)*offAxis*spot;
  vec3 e=vec3(length(a-centre-radial*shift.x),length(a-centre),length(a-centre-radial*shift.z))/spot;
  vec3 spotLight=exp(-e*e*e*e);
  // Bounds on each part's integral: the disk over its support; the lip over
  // the annulus that holds the crescent plus its bevel line; a glint as
  // √π·width/2 plus its fall, round 2π(radius + fall); the lit side's mean
  // plus a margin; the spot over 1.7 spot radii.
  float big0=max(r0.x,r0.z),big1=max(r1.x,r1.z)+length(b),litMean=mix(1.,litShape.z,lobe);
  float diskBound=3.141592654*pow(rd+soft,2.)+1e-9;
  float lipBound=litMean*(3.141592654*(pow(max(rLip.x,rLip.z)+length(lipShift)+width,2.)-pow(max(min(r0.x,r0.z)-width,0.),2.))
    +.6*6.2832*big0*1.0*1.7725*width)+1e-9;
  float arcBound=litMean*6.2832*(big0*1.09)*(.8863*width+${glsl(ARC_FALL)}*big0)+1e-9;
  float outerBound=litMean*6.2832*(big1*1.06)*(.8863*width+.05*big1)+1e-9;
  float spotBound=3.141592654*pow(1.7*spot,2.)+1e-9;
  float shareSpot=lens*${glsl(BARREL_SPOT)},shareDisk=hasDisk*${glsl(BARREL_DISK)};
  float shareLip=bore*${glsl(BARREL_LIP)},shareOuter=bore*${glsl(BARREL_OUTER)};
  float shareArc=(1.-bore)*(1.-shareSpot-shareDisk);
  // The bore is blackened, not coated: the light takes the colour of the
  // coatings it passes, the path's tint at nominal thickness. The spot is
  // white light split by colour. More of the beam grazes the bore off axis.
  vec3 tint=ghostCoating(spectrum,vec2(1.));
  vec3 light=tint*(shareDisk*diskProfile/diskBound+shareLip*lip/lipBound+shareArc*arc/arcBound+shareOuter*outerGlint/outerBound)
    +shareSpot*spotLight/spotBound;
  return light*strength*mix(.15,1.,smoothstep(.05,.6,field));
}
// The first barrel's shadow band on light that crosses its bore from the
// front, the Sun's veil: transmission at p for a source at frame position
// source. An approximation; the veil's paths are not traced.
float barrelVeilShadow(vec2 p,vec2 source){
  float field=clamp(length(source)/1.25,0.,1.);
  vec2 radial=source/max(length(source),.00001);
  vec2 a=p-source*${glsl(LENS_BARRELS[0].conjugate)},b=source*${glsl(LENS_BARRELS[0].step)};
  float r0=${glsl(LENS_BARRELS[0].radius)}*ghostFocalScale,rLip=r0*${glsl(1+LIP_DEPTH)},r1=${glsl(LENS_BARRELS[0].outer)}*ghostFocalScale;
  float width=max(max(.5*ghostSourceRadius*${glsl(Math.abs(LENS_BARRELS[0].conjugate))},.006*r0),1.25/resolution.y);
  float lLip=length(a+b*${glsl(LIP_PARALLAX)});
  float facing=length(a)>0.?dot(a,radial)/length(a):0.;
  float lit=mix(1.,1.-smoothstep(${glsl(LENS_BARRELS[0].lit[0])},${glsl(LENS_BARRELS[0].lit[1])},-facing*${glsl(LENS_BARRELS[0].side)}),smoothstep(0.,.2,field));
  float band=smoothstep(-width,width,lLip-rLip)*(1.-smoothstep(-width,width,length(a-b)-r1));
  float depth=clamp((lLip-rLip)/max(r1-rLip,1e-5),0.,1.);
  return 1.-${glsl(VEIL_SHADOW)}*band*(1.-.6*depth*depth)*(.75+.25*lit)*smoothstep(.05,.6,field);
}
// Share of the unit opening inside a circle of radius rim whose centre is
// distance d away: the area of the two circles' lens over π.
float pupilOverlap(float rim,float d){
  if(d>=rim+1.)return 0.;
  if(d<=rim-1.)return 1.;
  float a=acos(clamp((d*d+1.-rim*rim)/(2.*d),-1.,1.)),b=acos(clamp((d*d+rim*rim-1.)/(2.*d*rim),-1.,1.));
  return (a+rim*rim*b-.5*sqrt(max(0.,(rim+1.-d)*(d+1.-rim)*(d-1.+rim)*(d+1.+rim))))/3.141592654;
}
// The front barrel's vignetting of the whole beam (FRONT_BARREL). A fixed
// aperture, so like the element rims it grows against the opening as the
// lens stops down and its cut sharpens.
float frontBarrel(vec2 source){
  float rim=${glsl(FRONT_BARREL.radius)}*irisStop(4./cameraPupilScale);
  return pupilOverlap(rim,rim*length(source)/${glsl(1.25*FRONT_BARREL.field)});
}
vec3 lensReflections(vec2 p,vec2 source,float aspect,float fullChain){
  // A source beyond the picture still lights the lens through what the
  // front barrel leaves of the opening; the picture's edge plays no part.
  float acceptance=frontBarrel(source);
  if(acceptance<=0.)return vec3(0.);
  vec3 light=vec3(0.);
  // Saturated linear Display-P3 colors; the compositor converts for sRGB.
  ${LENS_PATHS.slice(0,POINT_PATHS).map(apertureCall).join('\n  ')}
  if(fullChain>.5){
  ${LENS_PATHS.slice(POINT_PATHS).map(apertureCall).join('\n  ')}
  ${LENS_BARRELS.map(barrelCall).join('\n  ')}
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
vec3 fieldGhost(vec2 p,float aspect,float conjugate,float radius,vec3 spectrum,float strength){
  vec2 s=p/conjugate;
  vec2 uv=s/vec2(aspect,1.)+.5;
  float window=fieldWindow(uv);
  float field=length(s)/1.25;
  float acceptance=window*frontBarrel(s);
  if(acceptance<=0.)return vec3(0.);
  float spread=.5*radius*cameraPupilScale*ghostFocalScale/abs(conjugate)*resolution.y;
  float lod=clamp(log2(max(spread,.001)/${levelSpread.toFixed(4)}),1.,reflectionLevelCount);
  float lower=floor(lod);
  vec3 scene=mix(fieldLevel(uv,lower),fieldLevel(uv,min(lower+1.,reflectionLevelCount)),lod-lower);
  // Pupil-averaged: the field image is already blurred over the aperture.
  return scene*lensToOutputLinear(ghostCoating(spectrum,vec2(sqrt(max(.25,1.-.65*field*field)))))*strength*acceptance/(conjugate*conjugate);
}
vec3 fieldReflections(vec2 p,float aspect){
  if(reflectionLevelCount<1.5)return vec3(0.);
  vec3 light=vec3(0.);
  ${LENS_PATHS.map(path=>`light+=fieldGhost(p,aspect,${glsl(path.conjugate)},${glsl(path.radius)},${spectrum(path)},${glsl(path.strength)});`).join('\n  ')}
  // A barrel's rings, pupil-averaged, reflect like one broad ghost at their middle.
  ${LENS_BARRELS.map(barrel=>`light+=fieldGhost(p,aspect,${glsl(barrel.conjugate+barrel.step/2)},${glsl(barrel.radius)},${spectrum(barrel)},${glsl(barrel.strength)});`).join('\n  ')}
  return light*${LENS_REFLECTION_FRACTION/pathWeightSum};
}
`;
