import { sceneLook } from './scene-defaults';
export const POISSON_COLUMNS=1024;
export const POISSON_ROWS=1024;
/** Quantiles of Poisson(lambda), lambda 0..16. A quadratic mean axis preserves
 * the very dark sky. The sensor's read noise and brighter Gaussian path remain
 * unchanged; this replaces up to 48 divergent iterations per RGB channel.
 */
export function poissonQuantiles(){
 const pixels=new Uint8Array(POISSON_COLUMNS*POISSON_ROWS);
 for(let y=0;y<POISSON_ROWS;y++){
  const mean=16*(y/(POISSON_ROWS-1))**2;
  let k=0,probability=Math.exp(-mean),cumulative=probability;
  for(let x=0;x<POISSON_COLUMNS;x++){
   const sample=(x+.5)/POISSON_COLUMNS;
   while(sample>cumulative&&k<64){k++;probability*=mean/k;cumulative+=probability;}
   pixels[y*POISSON_COLUMNS+x]=k;
  }
 }
 return pixels;
}

// The camera finish's sensor (camera-finish.ts). By default one grain cell, a
// CSS pixel, collects LOOK_ELECTRONS/g² electrons at sensor white at ISO 400
// (g = look.grain × 1.3): a photographic grain sized like one photosite.
export const LOOK_ELECTRONS=36000;
export const GRAIN_AMOUNT=sceneLook.grain*1.3;
/** With `night=video|still` (docs/lab/night-camera-2026-10-17.md) a CSS pixel
 * bins the photosites of a 12 MP α7S/D3S-class sensor, 2 832 rows of 8.4 µm:
 * about 12.5 at 800 CSS pixels high. At the default grain each photosite
 * holds 36 000 e⁻ at white at ISO 400, the α7S's ~1.5 × 10⁵ e⁻ full well at
 * ISO 100. Shot and read noise therefore fall by √N. The default program's
 * grain stays as a look: up to ISO 543, the top of the day program, it makes
 * up the variance the binned sensor no longer has, so daylight grain is as
 * before; above it the look stays at its ISO 543 level and the sensor's own
 * noise takes over. */
export const SENSOR_ROWS=2832;
export const SENSOR_ELECTRONS=36000;
export const LOOK_ISO_GAIN_MAX=2**(1.1*.4);
export const READ_NOISE=(isoGain:number)=>Math.sqrt(.9*.9+(.8/isoGain)**2);
export const photositesPerPixel=(cssHeight:number)=>Math.max(1,(SENSOR_ROWS/cssHeight)**2);
/** SNR of a grain cell at display level `level` (linear, metered mid-grey
 * 0.055) for a camera state, as camera-finish.ts draws it. */
export function grainSnr(level:number,isoGain:number,cssHeight:number,binned:boolean,grain=GRAIN_AMOUNT){
  const look=LOOK_ELECTRONS/(grain*grain),read=READ_NOISE(isoGain);
  if(!binned){const e=level/isoGain*look;return e/Math.sqrt(e+read*read);}
  const n=photositesPerPixel(cssHeight),white=n*SENSOR_ELECTRONS*(GRAIN_AMOUNT/grain)**2,e=level/isoGain*white;
  const relative=(e+n*read*read)/(e*e)+Math.min(isoGain,LOOK_ISO_GAIN_MAX)*(1/look-1/white)/level;
  return 1/Math.sqrt(relative);
}
