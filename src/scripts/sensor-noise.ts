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
