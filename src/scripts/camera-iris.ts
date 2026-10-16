// The camera's iris: nine rounded blades inside a circular stop, as on the
// 9-blade Nikkor zooms most ISS Sun photographs were taken with
// (docs/lab/aperture-rays-2026-10-16.md). A blade edge is a circular arc of
// fixed physical radius and the stop a fixed circle. Stopping down shrinks
// the opening, so relative to it the arcs flatten and the stop recedes: round
// wide open at f/3.2, a nonagon with slightly bulging sides by f/16. The PSF
// table and the Sun's rays (scripts/build-optical-psf.mjs) come from this
// shape; lens ghosts and defocus draw its outline.

export const IRIS_BLADES=9;
/** Normal of blade 0, radians from +x in sensor coordinates. */
export const IRIS_ROTATION=.2;
/** The f-number at which the blade arcs alone would close into a circle.
 * iss066e152099 (f/18) bounds it: its rays are no wider than the solar disk,
 * so each arc's fan is at most about 3° (round at f/1.3 or below). The
 * tapering rays of the Horizons sunrise video are narrower still; f/1.0
 * gives fans of about 2° at f/18 and 4° at f/9.4. */
export const IRIS_ROUND_F_NUMBER=1;
/** The widest f-number: the opening is the circular stop, just outside the
 * blades' apothems so every blade still bounds it. */
export const IRIS_OPEN_F_NUMBER=3.2;
const STOP_MARGIN=1.02;
/** Fixed manufacturing differences per blade, in units of the tolerances
 * below: normal angle, apothem and arc radius. Deterministic, never animated. */
export const IRIS_BLADE_ERRORS=[[.31,-.42,.18],[-.12,.27,-.35],[.44,.05,.29],[-.38,-.21,-.08],[.07,.46,.41],[-.27,-.33,-.44],[.21,.12,-.19],[-.45,.38,.33],[.15,-.07,-.26]] as const;
/** Tolerances: ±0.34° of normal angle, ±1.5% apothem, and ±25% in how far
 * each arc departs from the round opening (its radius minus the apothem). */
export const IRIS_TOLERANCE=[.012,.03,.5] as const;
/** Waviness along each blade edge, apothem units: ten octaves of wavelength
 * 0.025-0.57 apothem, amplitude 0.0008·(wavelength/0.1) with a random factor
 * of 0.5-1.5, and a roughness per blade of e^±1. On a ~1.5 mm blade that is
 * about a micron. It sets the look of the rays: a perfect arc throws an even
 * fan, while a wavy edge has curvature that changes along it, so its fan
 * breaks into needles of different strength, some sharp and some soft. 0.0003
 * still reads as petals and 0.002 dissolves the rays into a glow; this value
 * matched the Horizons sunrise frames best (docs/lab/aperture-rays-2026-10-16.md). */
export const IRIS_EDGE_WAVINESS={amplitude:.0008,slope:1,roughness:1,seed:11} as const;

/** Arc radius relative to the opening's apothem. */
export const irisCurvature=(fNumber:number)=>Math.max(1.05,fNumber/IRIS_ROUND_F_NUMBER);
/** Stop radius relative to the opening's apothem. */
export const irisStop=(fNumber:number)=>STOP_MARGIN*Math.max(1,fNumber/IRIS_OPEN_F_NUMBER);

type Circle=[number,number,number];
/** Blade k is a disk whose edge crosses its apothem along its normal; the
 * opening is the intersection of the nine disks and the stop. Apothem units. */
export function irisBlades(fNumber:number):Circle[]{
  const rho=irisCurvature(fNumber);
  return IRIS_BLADE_ERRORS.map(([angle,apothem,radius],k)=>{
    const normal=2*Math.PI*k/IRIS_BLADES+IRIS_ROTATION+angle*IRIS_TOLERANCE[0];
    const a=1+apothem*IRIS_TOLERANCE[1],e=(rho-1)*(1+radius*IRIS_TOLERANCE[2]);
    return [-Math.cos(normal)*e,-Math.sin(normal)*e,a+e];
  });
}
/** Per blade: [spatial frequency, amplitude, phase] of each waviness term,
 * from a fixed seed, so the same lens is built every time. */
export function irisEdgeWaviness(){
  const {amplitude,slope,roughness}=IRIS_EDGE_WAVINESS;
  let seed:number=IRIS_EDGE_WAVINESS.seed;
  const random=()=>(seed=(seed*1664525+1013904223)>>>0)/2**32;
  return Array.from({length:IRIS_BLADES},()=>{
    const blade=Math.exp((random()-.5)*2*roughness);
    return Array.from({length:10},(_,j)=>{
      const wavelength=.025*2**(j*.5);
      return [2*Math.PI/wavelength,blade*amplitude*(wavelength/.1)**slope*(.5+random()),random()*2*Math.PI];
    });
  });
}
/** Signed distance inside the opening (positive is open), apothem units,
 * with each blade's edge displaced by its waviness along its arc length. */
export function irisDistance(fNumber:number){
  const blades=irisBlades(fNumber),stop=irisStop(fNumber),waviness=irisEdgeWaviness();
  return (u:number,v:number)=>{
    let inside=stop-Math.hypot(u,v);
    blades.forEach(([x,y,r],k)=>{
      const along=Math.atan2(v-y,u-x)*r;let edge=r;
      for(const [frequency,amplitude,phase] of waviness[k])edge+=amplitude*Math.sin(frequency*along+phase);
      inside=Math.min(inside,edge-Math.hypot(u-x,v-y));
    });
    return inside;
  };
}

const f=(x:number)=>x.toFixed(6);
const blade=(k:number,[angle,apothem,radius]:readonly number[])=>{
  const normal=2*Math.PI*k/IRIS_BLADES+IRIS_ROTATION+angle*IRIS_TOLERANCE[0];
  return `if(k==${k}){float e=(rho-1.)*${f(1+radius*IRIS_TOLERANCE[2])};return vec3(-vec2(${f(Math.cos(normal))},${f(Math.sin(normal))})*e,${f(1+apothem*IRIS_TOLERANCE[1])}+e);}`;
};
/** GLSL outline of the opening without edge waviness: irisBlade(k, rho) is
 * blade k's disk (centre, radius in apothems), irisStop the stop's radius. */
export const cameraIrisShader=`
float irisCurvature(float fNumber){return max(1.05,fNumber/${IRIS_ROUND_F_NUMBER.toFixed(2)});}
float irisStop(float fNumber){return ${STOP_MARGIN.toFixed(2)}*max(1.,fNumber/${IRIS_OPEN_F_NUMBER.toFixed(2)});}
vec3 irisBlade(int k,float rho){
  ${IRIS_BLADE_ERRORS.map((errors,k)=>blade(k,errors)).join('\n  ')}
  return vec3(0.,0.,1.);
}
`;
