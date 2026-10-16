// Refraction of a source seen through Earth's limb from orbit.
//
// A ray that grazes the limb at tangent height h is bent towards Earth by
// δ(h) = (n₀ − 1)·√(2πR/H)·e^(−h/H) for an exponential atmosphere: 1.13° at
// the surface, twice the 0.57° horizon refraction seen from the ground,
// because the ray crosses the air twice. H is the 8 km density scale height
// of the Rayleigh atmosphere, so bending and scattering share one profile.
//
// The bending raises the image and, because it grows towards the surface,
// squeezes the lower part of the disk: the setting Sun is flattened and its
// light is spread over a larger cone (refractive dilution). Radiance is
// conserved along a ray, so the flux of each part of the disk falls with its
// apparent area. Dispersion (the green rim) is neglected.

const EARTH_RADIUS_KM=6371;
/** Density scale height of the air, in Earth radii (matches the shaders). */
export const AIR_SCALE_HEIGHT=8/EARTH_RADIUS_KM;
/** Sea-level refractivity n₀ − 1 of air in the visible. */
export const AIR_REFRACTIVITY=2.78e-4;
/** Total bending of a ray grazing the surface: about 1.13°. */
export const LIMB_BENDING=AIR_REFRACTIVITY*Math.sqrt(2*Math.PI/AIR_SCALE_HEIGHT);
/** Rows across the true disk. Each is one ray for the lens transmission. */
export const SOLAR_ROWS=16;

export type RefractedSource={
  /** Apparent visible area as a fraction of the unrefracted disk. It is the
   * flux fraction before extinction: occlusion times refractive dilution. */
  visibility:number;
  /** Apparent direction of the centre of the flattened disk. */
  direction:number[];
  /** Apparent vertical extent over true diameter, 1 above the air. */
  compression:number;
  /** True angle of the disk's centre above the solid limb, radians. */
  altitude:number;
  /** Per row: apparent ray xyz and its share of the disk's flux, before
   * extinction. Rows behind the limb have zero weight. */
  rows:Float32Array;
};

const bending=(h:number)=>LIMB_BENDING*Math.exp(-Math.max(0,h)/AIR_SCALE_HEIGHT);

/** Apparent elevation above the solid limb for a true elevation θ above it
 * (radians), seen from distance r (Earth radii). Returns the tangent height
 * of the apparent ray as well; below the limb it is extrapolated linearly
 * with the slope at the surface, and h is negative. */
function apparentElevation(theta:number,r:number){
  const dip=Math.acos(1/r);
  // Elevation above the limb of a straight ray with tangent radius 1 + h.
  const straight=(h:number)=>dip-Math.acos(Math.min(1,(1+h)/r));
  const top=Math.min(r-1,40*AIR_SCALE_HEIGHT);
  if(theta>=straight(top)-bending(top))return {elevation:theta+bending(top),height:top,stretch:1};
  const surfaceStretch=1+LIMB_BENDING/AIR_SCALE_HEIGHT*Math.sqrt(r*r-1);
  if(theta<=-LIMB_BENDING)return {elevation:(theta+LIMB_BENDING)/surfaceStretch,height:-1,stretch:surfaceStretch};
  // θ(h) = straight(h) − δ(h) increases monotonically with h.
  let low=0,high=top;
  for(let i=0;i<40;i++){
    const h=(low+high)/2;
    if(straight(h)-bending(h)<theta)low=h;else high=h;
  }
  const h=(low+high)/2;
  // dθ_true/dθ_apparent: how much the disk is squeezed at this height.
  const stretch=1+bending(h)/AIR_SCALE_HEIGHT*Math.sqrt(Math.max(0,r*r-(1+h)*(1+h)));
  return {elevation:straight(h),height:h,stretch};
}

/** The refracted image of a small distant disk of angular radius `radius`. */
export function refractedSource(camera:number[],direction:number[],radius:number):RefractedSource{
  const r=Math.hypot(...camera);
  const up=camera.map(x=>x/r);
  const sine=up.reduce((sum,x,i)=>sum+x*direction[i],0);
  const level=direction.map((x,i)=>x-sine*up[i]);
  const levelLength=Math.hypot(...level);
  const rows=new Float32Array(SOLAR_ROWS*4);
  if(levelLength<1e-9||r<=1){
    for(let i=0;i<SOLAR_ROWS;i++)rows.set([...direction,1/SOLAR_ROWS],i*4);
    return {visibility:1,direction:[...direction],compression:1,altitude:Math.PI/2,rows};
  }
  const forward=level.map(x=>x/levelLength);
  const dip=Math.acos(1/r);
  const altitude=Math.asin(Math.max(-1,Math.min(1,sine)))+dip;
  const ray=(elevation:number)=>{
    const angle=elevation-dip,c=Math.cos(angle),s=Math.sin(angle);
    return forward.map((x,i)=>x*c+up[i]*s);
  };
  let visibility=0,total=0;
  for(let i=0;i<SOLAR_ROWS;i++){
    const y=(-1+(2*i+1)/SOLAR_ROWS)*radius;
    total+=Math.sqrt(radius*radius-y*y);
  }
  for(let i=0;i<SOLAR_ROWS;i++){
    const y=(-1+(2*i+1)/SOLAR_ROWS)*radius;
    const chord=Math.sqrt(radius*radius-y*y)/total;
    const image=apparentElevation(altitude+y,r);
    const weight=image.height>=0?chord/image.stretch:0;
    visibility+=weight;
    rows.set([...ray(Math.max(image.elevation,0)),weight],i*4);
  }
  const top=apparentElevation(altitude+radius,r).elevation;
  const bottom=apparentElevation(altitude-radius,r).elevation;
  return {visibility,direction:ray((top+bottom)/2),compression:(top-bottom)/(2*radius),altitude,rows};
}
