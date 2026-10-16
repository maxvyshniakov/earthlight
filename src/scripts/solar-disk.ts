// The Sun as a resolved, limb-darkened disk seen through the shared lens.
// Coefficients come from the pupil FFT behind optical-psf.bin
// (scripts/build-optical-psf.mjs), measured before its focal-plane window;
// see docs/lab/solar-disk-2026-10-16.md.

/** Radius in CSS px where the analytic disk replaces the 24 PSF samples. */
export const SOLAR_RESOLVED_PX=[5,9] as const;
/** Linear limb-darkening coefficients near 650, 550 and 450 nm (approximate
 * fits to the measured solar centre-to-limb profile). The mean radiance over
 * the disk is preserved: I(μ) = (1 − u(1 − μ)) / (1 − u/3). */
export const SOLAR_LIMB_DARKENING=[.56,.63,.76] as const;
/** Diffraction ray line density C/r² (C in CSS px at f/4), per iris state
 * (closed, half, open) and RGB channel. Rays lie along the blade normals. */
export const SOLAR_RAY_COEFFICIENTS=[[.0291,.0261,.0225],[.0155,.0140,.0122],[.0032,.0032,.0033]] as const;
export const SOLAR_RAY_ANGLE=.2705;
/** Radius (CSS px at f/4) of the window that ends the LUT's own rays; the
 * analytic rays carry the light beyond it. */
export const SOLAR_RAY_WINDOW=10.24;
/** Share of a source's flux in the analytic rays, three full lines. */
export const solarRayShare=(c:number)=>3*2*c/SOLAR_RAY_WINDOW;

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
vec3 solarRayCoefficient(float opening){
  float position=clamp(opening,0.,1.)*2.;
  return position<1.?mix(${vec3(SOLAR_RAY_COEFFICIENTS[0])},${vec3(SOLAR_RAY_COEFFICIENTS[1])},position)
    :mix(${vec3(SOLAR_RAY_COEFFICIENTS[1])},${vec3(SOLAR_RAY_COEFFICIENTS[2])},position-1.);
}
// Flux the analytic rays carry beyond the window: 2C/window per line, three
// lines. It is taken from the disk, so the rays add no light.
vec3 solarRayShare(float opening){return solarRayCoefficient(opening)*${(6/SOLAR_RAY_WINDOW).toFixed(6)};}
// Each blade pair diffracts a line of density C/r². Convolved with a disk of
// radius R, a line becomes a band: ∫ ds/(u−s)² over the chord at offset v,
// counting only source points farther than the LUT window from the pixel.
float solarRayBand(vec2 delta,float radius,float window,float angle){
  vec2 along=vec2(cos(angle),sin(angle));
  float u=abs(dot(delta,along)),v=dot(delta,vec2(-along.y,along.x));
  float chord=sqrt(max(0.,radius*radius-v*v));
  if(chord<=0.)return 0.;
  float behind=min(chord,u-window),ahead=max(-chord,u+window);
  float sum=behind>-chord?1./(u-behind)-1./(u+chord):0.;
  if(ahead<chord)sum+=1./(ahead-u)-1./(chord-u);
  return sum;
}
// Diffraction rays of the whole disk, relative to its mean radiance.
vec3 solarRays(vec2 delta,float radius,vec4 camera){
  float spread=camera.x/4.,window=${SOLAR_RAY_WINDOW.toFixed(2)}*spread;
  float bands=0.;
  for(int k=0;k<3;k++)bands+=solarRayBand(delta,radius,window,${SOLAR_RAY_ANGLE.toFixed(4)}+float(k)*1.0471976);
  return solarRayCoefficient(camera.w)*spread*bands;
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
