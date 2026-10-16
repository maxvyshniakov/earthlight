import { IRIS_BLADES } from './camera-iris';
// Contamination on the lens: what makes heavy flare look like a real, used
// objective rather than a clean one (docs/lab/lens-dirt-2026-10-16.md).
//
// Veil pattern. Wide-angle scatter from smudges and fine dust on surfaces
// near the pupil depends only on the angle from the source, so its irregular
// shape is fixed to the lens and travels with the Sun. Angular harmonics with
// a slight twist in log radius make the round Moffat veil uneven; each has
// zero mean around every circle. Larger smudges send part of the scatter into
// soft lobes off to one side: a lopsided haze that grows with the Sun's
// overexposure. Cleaning leaves circular micro-scratches around the
// element's centre that diffract like a grating: a ring centred on the Sun,
// its radius proportional to wavelength, so red is always outside and blue
// inside. Near the stop the beam covers almost the whole element and so
// scratches of every direction: the ring is round. As the Sun moves off axis
// the beam's spot shifts, favouring scratches of one direction, and the ring
// grows brighter on two opposite sides that turn with the Sun, at most 2.6
// times its dimmest. Everything is normalized, so the scattered share stays
// exactly SOLAR_SCATTER_FRACTION.
//
// Dust. Particles on the filter stack shade the sensor: a disc as wide as
// their height over the f-number, as dark as (particle / disc)². They only
// remove light, so they show against a bright veil and never on a dark frame,
// and they sharpen and darken as the camera stops down: about 5% deep at
// f/9.4, 15% at f/16; zoom does not move them. Dust on the window 12-25 cm
// in front of the lens is lit from behind by the Sun and forward-scatters a
// little of it into the lens. Each speck is far out of focus: a disc in the
// shape of the iris, entrance pupil over distance across in angle, so it
// grows as focal length squared when zooming in (pupil and image scale both
// grow), shrinks as 1/N when stopping down, and stays fixed in direction:
// zooming pushes it out of the frame. It lights up only while the Sun is
// within the ~20° forward-scatter lobe of its direction, and only heavy
// overexposure shows it.

/** Veil lobes: angular order, amplitude, phase (radians), twist per e-fold
 * of radius. One lopsided first order and a weak second, so the haze is an
 * irregular blob rather than an ellipse or petals. Amplitudes sum to 0.85,
 * so the kernel never turns negative. */
export const VEIL_LOBES=[[1,.38,.6,.7],[2,.1,2.1,-1.1],[3,.18,4,1.4],[4,.11,5.5,-.9],[5,.08,1.3,-1.9]] as const;
/** Radius (radians) that sets the twist's reference; the inner veil scale. */
export const VEIL_PATTERN_SCALE=.015;
/** Most of the Sun's veil that smudges can send into offset lobes, taken
 * from the round veil kernels in proportion. */
export const VEIL_LOBE_SHARE=.12;
/** Cleaning swirl on the same element: centre and extent (footprint radii),
 * ring radius at 540 nm and ring width (radians), and the most of the Sun's
 * veil its scratches diffract. 0.1 rad is a scratch period of about 5 µm. */
export const CLEANING_SWIRL={place:[0,.4],extent:2.5,ring:.1,width:.02,share:.08} as const;
/** Smudges lie on an element away from the stop, so the Sun's beam crosses
 * it at a spot that moves with the Sun's direction: this many radians of
 * source angle move the spot by its own radius. */
export const SMUDGE_FOOTPRINT=.3;
/** Offset lobes: share of VEIL_LOBE_SHARE, centre offset from the source and
 * semi-axes (radians, sensor x right and y up), orientation (radians), and
 * the smudge's place on its element (footprint radii) and radius there. A lobe
 * lights only while the beam's spot overlaps its smudge. */
export const VEIL_OFFSET_LOBES=[
  [.5,[-.07,-.04],[.12,.1],.5,[-1.3,1.2],.9],
  [.3,[.055,.08],[.07,.06],-.8,[1.5,1.3],.9],
  [.2,[.14,-.02],[.18,.15],1.9,[.2,-1.1],1],
  [.4,[-.035,.1],[.09,.075],2.6,[-.3,.2],.8],
] as const;
/** Sensor dust: centre (frame heights from the centre, x right, y up),
 * height above the sensor (frame heights) and particle diameter (frame heights). */
export const SENSOR_DUST=[
  [-.52,.31,.075,.0018],[.37,.22,.11,.0026],[.12,-.33,.06,.0014],[-.18,-.12,.14,.0034],
  [.61,-.27,.09,.0021],[-.66,-.36,.12,.0022],[.05,.41,.07,.0016],
] as const;
/** Window dust: direction from the camera (radians, x right, y up),
 * distance in front of the lens (mm) and the share of the solar flux entering
 * the lens that it forward-scatters back into it with the Sun right behind. */
export const WINDOW_DUST=[
  [.32,.21,180,4e-6],[-.22,-.17,120,3e-6],[.45,-.06,250,2.5e-6],
  [-.41,.13,160,3e-6],[.13,-.29,140,3.5e-6],[-.05,.36,220,2.5e-6],
] as const;
/** Frame height in mm: FOCAL 1.25 (1×) is a 30 mm lens. */
export const FRAME_HEIGHT_MM=24;
/** Half-width (radians) of the forward-scatter lobe that lights the dust. */
export const DUST_LOBE=.35;

const f=(x:number)=>x.toFixed(6);
/** Needs FOCAL and SOLAR_IRRADIANCE-scaled callers; pure functions otherwise. */
export const lensDirtShader=`
// Relative veil kernel weight (mean 1 around every circle) for one channel,
// delta in radians from the source, wavelength scale relative to green.
float veilPattern(vec2 delta,float wavelength){
  float r=max(length(delta)/wavelength,1e-5),a=atan(delta.y,delta.x),t=log(r/${f(VEIL_PATTERN_SCALE)}),m=1.;
  ${VEIL_LOBES.map(([order,amp,phase,twist])=>`m+=${f(amp)}*cos(${f(order)}*a+${f(phase)}+${f(twist)}*t);`).join('\n  ')}
  return m;
}
vec3 veilPatternRGB(vec2 delta){
  return vec3(veilPattern(delta,${f(610/540)}),veilPattern(delta,1.),veilPattern(delta,${f(460/540)}));
}
// How much of each smudge the Sun's beam covers, for a source at angle
// sunAngle (radians): its spot on the element moves with the source.
float smudgeCover(vec2 sunAngle,vec2 place,float radius){
  return 1.-smoothstep(.4,1.,length(sunAngle/${f(SMUDGE_FOOTPRINT)}-place)/(1.+radius));
}
// Share of VEIL_LOBE_SHARE the lit smudges take, the rest staying in the
// round kernels, so the veil's integral never changes.
float veilLobeCover(vec2 sunAngle){
  return ${VEIL_OFFSET_LOBES.map(([share,,,,[px,py],radius])=>`${f(share/VEIL_OFFSET_LOBES.reduce((t,l)=>t+l[0],0))}*smudgeCover(sunAngle,vec2(${f(px)},${f(py)}),${f(radius)})`).join('+')};
}
// Offset lobes per steradian for unit flux: normalized elliptical β=2 Moffats,
// each weighted by how much of its smudge the beam covers.
float veilLobes(vec2 delta,vec2 sunAngle){
  float sum=0.;
  ${VEIL_OFFSET_LOBES.map(([share,[x,y],[a,b],angle,[px,py],radius])=>`{vec2 d=delta-vec2(${f(x)},${f(y)});vec2 q=vec2(dot(d,vec2(${f(Math.cos(angle))},${f(Math.sin(angle))})),dot(d,vec2(${f(-Math.sin(angle))},${f(Math.cos(angle))})))/vec2(${f(a)},${f(b)});
   sum+=${f(share/VEIL_OFFSET_LOBES.reduce((t,l)=>t+l[0],0))}*smudgeCover(sunAngle,vec2(${f(px)},${f(py)}),${f(radius)})/(3.14159265*${f(a*b)})*pow(1.+dot(q,q),-2.);}`).join('\n  ')}
  return sum;
}
// How much of the swirl's scratched area the beam's spot covers.
float swirlCover(vec2 sunAngle){
  return 1.-smoothstep(.6,1.,length(sunAngle/${f(SMUDGE_FOOTPRINT)}-vec2(${f(CLEANING_SWIRL.place[0])},${f(CLEANING_SWIRL.place[1])}))/${f(CLEANING_SWIRL.extent+1)});
}
// The swirl's diffraction per steradian for unit flux, one channel: a round
// ring, brighter along the spot's offset from the swirl centre and opposite
// it by 1 + m·cos 2φ, m growing with the offset to at most 0.45. The cosine
// has zero mean, so the ring integrates to 1 at every Sun position.
float swirlRing(vec2 delta,vec2 sunAngle,float wavelength){
  vec2 v=sunAngle/${f(SMUDGE_FOOTPRINT)}-vec2(${f(CLEANING_SWIRL.place[0])},${f(CLEANING_SWIRL.place[1])});
  float offset=length(v),m=.45*offset/(offset+1.5);
  float r=max(length(delta),.0005),a=atan(delta.y,delta.x)-atan(v.y,v.x+1e-6);
  float azimuth=1.+m*cos(2.*a);
  float radius=${f(CLEANING_SWIRL.ring)}*wavelength;
  return azimuth*exp(-.5*pow((r-radius)/${f(CLEANING_SWIRL.width)},2.))/(6.2831853*r*${f(CLEANING_SWIRL.width*Math.sqrt(2*Math.PI))});
}
// Share of the Sun's veil the smudges and the swirl take from the round
// kernels for a Sun at sunAngle, and what they scatter, per steradian.
float smudgeShare(vec2 sunAngle){
  return ${f(VEIL_LOBE_SHARE)}*veilLobeCover(sunAngle)+${f(CLEANING_SWIRL.share)}*swirlCover(sunAngle);
}
vec3 smudgeVeilRGB(vec2 delta,vec2 sunAngle){
  vec3 rings=vec3(swirlRing(delta,sunAngle,${f(610/540)}),swirlRing(delta,sunAngle,1.),swirlRing(delta,sunAngle,${f(460/540)}));
  return vec3(${f(VEIL_LOBE_SHARE)}*veilLobes(delta,sunAngle))+${f(CLEANING_SWIRL.share)}*swirlCover(sunAngle)*rings;
}
// Transmission of the dust on the filter stack at sensor position p (frame
// heights). The shadow of a particle of diameter d at height z is a disc of
// diameter z/N; its depth is (d·N/z)², capped, with a faint bright Fresnel rim.
vec3 dustShadow(vec2 p,float fNumber){
  vec3 t=vec3(1.);
  ${SENSOR_DUST.map(([x,y,z,d])=>`{float R=${f(z)}/(2.*fNumber),depth=min(.35,pow(${f(d)}*fNumber/${f(z)},2.));float q=length(p-vec2(${f(x)},${f(y)}))/R;
   t*=vec3(1.-depth*(1.-smoothstep(.75,1.05,q)))+depth*.35*vec3(.9,1.,1.1)*exp(-pow((q-1.05)/.12,2.));}`).join('\n  ')}
  return t;
}
// Window dust lit from behind by the source at frame position sun (frame
// heights), per unit of source flux entering the lens. Needs FOCAL and the
// iris (camera-iris.ts): each speck is an out-of-focus image of the opening.
float dustGlints(vec2 p,vec2 sun,float fNumber){
  float sum=0.,rho=irisCurvature(fNumber),stop=irisStop(fNumber);
  vec2 sunAngle=atan(sun/FOCAL);
  ${WINDOW_DUST.map(([x,y,z,share])=>`{vec2 dir=vec2(${f(x)},${f(y)}),c=FOCAL*tan(dir);float r=FOCAL*FOCAL*${f(FRAME_HEIGHT_MM/(2*z))}/fNumber;
   if(length(p-c)<1.3*r){vec2 u=(p-c)/r;float d=length(u)-stop;for(int k=0;k<${IRIS_BLADES};k++){vec3 b=irisBlade(k,rho);d=max(d,length(u-b.xy)-b.z);}
    float theta=length(sunAngle-dir),lobe=pow(1.+theta*theta/${f(DUST_LOBE*DUST_LOBE)},-2.);
    sum+=${share.toExponential(3)}*lobe/(3.14159265*r*r)*(1.-smoothstep(-.06,.06,d))*(.85+.3*smoothstep(-.35,-.04,d));}}`).join('\n  ')}
  return sum;
}
`;
