// The Sun as a resolved, limb-darkened disk seen through the shared lens,
// with the iris's diffraction rays. Needs opticalPsfSource for the rays'
// angular profile. See docs/lab/solar-disk-2026-10-16.md and
// docs/lab/aperture-rays-2026-10-16.md.

/** Radius in CSS px where the analytic disk replaces the 24 PSF samples. */
export const SOLAR_RESOLVED_PX=[5,9] as const;
/** Linear limb-darkening coefficients near 650, 550 and 450 nm (approximate
 * fits to the measured solar centre-to-limb profile). The mean radiance over
 * the disk is preserved: I(μ) = (1 − u(1 − μ)) / (1 − u/3). */
export const SOLAR_LIMB_DARKENING=[.56,.63,.76] as const;
/** Radius (CSS px at f/4) of the window that ends the LUT's own far field;
 * the analytic rays carry the light beyond it. */
export const SOLAR_RAY_WINDOW=10.24;
/** Γ(3/4) = ∫(1 − e^(−x⁴))/x² dx: the window's reach, so the far field
 * carries 2π·P̄·Γ(3/4)/window of the flux, P̄ the mean of r³·I. */
const WINDOW_REACH=1.2254167;

const vec3=(v:readonly number[])=>`vec3(${v.map(x=>x.toFixed(4)).join(',')})`;
export const solarDiskShader=`
vec4 solarCameraState(){
  float ev=.5;
#ifdef CAMERA_PUPIL_STATE
  ev=decodeCameraEV(texture2D(cameraState,vec2(.5)).rg);
#endif
  return cameraProgram(ev);
}
// Share of the PSF centred d CSS px outside a straight edge that falls on the
// source side: the measured diffraction edge (a β=2 Moffat, a = 0.62 spread,
// windowed beyond ~8 spreads) plus the PSF's 4% scatter wing. Odd about the
// edge, so it moves light without adding any.
float solarEdge(float d,float spread){
  float a=.62*spread,x=abs(d);
  float core=(.5-.5*x/sqrt(x*x+a*a))*exp(-x*x/(64.*spread*spread));
  float wing=.5-.5*x/sqrt(x*x+4.*spread*spread);
  float outside=.96*core+.04*wing;
  return d>0.?outside:1.-outside;
}
// The analytic far field falls as q(r) = r (r³ + c³)^(-4/3): 1/r³ beyond
// the LUT window, zero at the source, c = window/Γ(3/4). solarRayReach is
// ∫ q(x) x dx from rho outwards, the light past rho along one direction.
float solarRayFalloff(float r,float c){return r*pow(r*r*r+c*c*c,-4./3.);}
float solarRayReach(float rho,float c){return pow(rho*rho*rho+c*c*c,-1./3.);}
// Flux the analytic rays carry beyond the window. It is taken from the disk,
// so the rays add no light.
vec3 solarRayShare(vec4 camera){
  return apertureRayMean(opticalPsfState(camera.x))*${(2*Math.PI*WINDOW_REACH/SOLAR_RAY_WINDOW).toFixed(6)};
}
// ∫ q over a disk of radius R seen from distance r of its centre, in polar
// coordinates around the pixel: each direction crosses the disk between two
// distances and contributes reach(near) − reach(far). Far away it is the disk
// area times q, with the leading correction for the disk's extent.
float solarRayField(float r,float R,float c){
  if(r>4.*R)return 3.141592654*R*R*solarRayFalloff(r,c)*(1.+1.125*R*R/(r*r));
  float sum=0.;
  if(r<R){
    for(int i=0;i<16;i++){
      float phi=(float(i)+.5)*.39269908,sine=sin(phi);
      sum+=solarRayReach(0.,c)-solarRayReach(-r*cos(phi)+sqrt(max(0.,R*R-r*r*sine*sine)),c);
    }
    return sum*.39269908;
  }
  float spread=asin(min(1.,R/r));
  for(int i=0;i<16;i++){
    float phi=((float(i)+.5)/8.-1.)*spread,sine=sin(phi),across=sqrt(max(0.,R*R-r*r*sine*sine)),along=r*cos(phi);
    sum+=solarRayReach(along-across,c)-solarRayReach(along+across,c);
  }
  return sum*spread/8.;
}
// Diffraction rays of the whole disk, relative to its mean radiance. The
// angular profile is the iris's measured far field (apertureRays): every
// blade's slightly wavy edge throws its own fan of needles. Near the core an
// edge still acts as a straight one of half-length 0.36 apothems, so the rays
// merge into a needle about one diffraction width across, 1/(k·0.36) in
// angle, falling as 1/r²; farther out they separate and fall as 1/r³. Seen
// from the pixel, the disk smears them over its angular half-width. k is the
// spatial frequency in apothem units: 2.756 per CSS px at f/4.
vec3 solarRays(vec2 delta,float radius,vec4 camera){
  float spread=camera.x/4.,c=${(SOLAR_RAY_WINDOW/WINDOW_REACH).toFixed(5)}*spread;
  float r=length(delta),k=2.756*max(r,1.)/spread;
  float disk=asin(min(1.,radius/max(r,.0001))),edge=1./(k*.364);
  vec3 profile=apertureRays(atan(delta.y,delta.x),opticalPsfState(camera.x),sqrt(disk*disk+edge*edge));
  return spread*profile*solarRayField(r,radius,c);
}
// The resolved disk relative to its mean radiance: limb darkening, the lens
// edge, and Earth's limb as a second edge (above it is positive).
vec3 resolvedSolarDisk(vec2 delta,float radius,float limbPixels,vec4 camera){
  float spread=camera.x/4.,r=length(delta);
  float mu=sqrt(max(0.,1.-min(1.,r/radius)*min(1.,r/radius)));
  vec3 u=${vec3(SOLAR_LIMB_DARKENING)};
  vec3 profile=(1.-u*(1.-mu))/(1.-u/3.);
  return profile*solarEdge(r-radius,spread)*solarEdge(-limbPixels,spread);
}
`;
