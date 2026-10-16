/** Background posters: the background's opening frame, rendered at the loading
 * defocus without the celestial sky, for a grid of subsolar points. The camera
 * opens at a fixed point of the recorded ground track, so its Earth and
 * atmosphere depend only on where the Sun stands overhead. The page shows the
 * nearest poster before the scene script runs; the live defocused scene then
 * replaces it with the same picture and brings in the sky.
 * scripts/render-posters.mjs renders them through /lab/poster. */
export const POSTER_LATITUDES=[-23.44,-11.72,0,11.72,23.44];
// Sunrise and sunset change the frame within a few degrees of longitude.
export const POSTER_LONGITUDE_STEP=5;
export const POSTER_WIDTH=840,POSTER_HEIGHT=360;

/** Grid cell for a UTC time: latitude row, then longitude column. Self-contained,
 * because Background.astro inlines its source to run before any module loads.
 * Low-precision solar coordinates (Astronomical Almanac), within 0.1 degree. */
export function posterCell(time:number,latitudes:number[],step:number){
  const rad=Math.PI/180,n=time/86400000-10957.5; // days since J2000.0
  const g=(357.528+.9856003*n)*rad;
  const lambda=(280.46+.9856474*n+1.915*Math.sin(g)+.02*Math.sin(2*g))*rad,epsilon=(23.439-4e-7*n)*rad;
  const latitude=Math.asin(Math.sin(epsilon)*Math.sin(lambda))/rad;
  const rightAscension=Math.atan2(Math.cos(epsilon)*Math.sin(lambda),Math.cos(lambda))/rad;
  const longitude=rightAscension-(280.46061837+360.98564736629*n);
  const columns=Math.round(360/step),column=((Math.round(longitude/step)%columns)+columns)%columns;
  let row=0;
  for(let i=1;i<latitudes.length;i++)if(Math.abs(latitudes[i]-latitude)<Math.abs(latitudes[row]-latitude))row=i;
  return row*columns+column;
}
