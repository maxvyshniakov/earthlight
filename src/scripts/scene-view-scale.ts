// Fragment work follows the pixels whose rays meet the atmosphere; open sky
// costs little. With Earth small in the frame the same budget buys a larger
// buffer, so a distant planet need not be as soft as a close horizon.
export const SHELL=1+120/6371;

/** Fraction of the frame whose camera rays meet the atmosphere shell, or a sphere of `radius`. */
export function shellCoverage(camera:ArrayLike<number>,basis:ArrayLike<number>,focal:number,aspect:number,columns=24,rows=24,radius=SHELL){
 const px=camera[0],py=camera[1],pz=camera[2],c=px*px+py*py+pz*pz-radius*radius;
 if(c<=0)return 1;
 let hits=0;
 for(let j=0;j<rows;j++){
  const v=.5-(j+.5)/rows;
  for(let i=0;i<columns;i++){
   const u=((i+.5)/columns-.5)*aspect;
   const dx=basis[0]*u+basis[3]*v+basis[6]*focal,dy=basis[1]*u+basis[4]*v+basis[7]*focal,dz=basis[2]*u+basis[5]*v+basis[8]*focal;
   const b=(px*dx+py*dy+pz*dz)/Math.hypot(dx,dy,dz);
   if(b<0&&b*b>c)hits++;
  }
 }
 return hits/(columns*rows);
}

/** Linear buffer scale that keeps the frame cost of a fully covered view,
 * where a sky pixel costs `sky` of a planet pixel. */
export function viewScaleFor(coverage:number,sky:number,limit=2){
 return Math.min(limit,1/Math.sqrt(sky+(1-sky)*Math.max(0,Math.min(1,coverage))));
}

/** Resizing reallocates every frame target, so the factor moves in steps.
 * A heavier view shrinks promptly; a lighter one grows only once the view has
 * been quiet for a moment, never mid-gesture. */
export class ViewScale {
 factor=1;
 private lighter:number|null=null;
 private changed=-Infinity;
 update(target:number,now:number,interacting:boolean){
  const next=Math.max(1,Math.round(target*20)/20);
  if(next<this.factor-1e-3){
   this.lighter=null;
   if(now-this.changed<250)return false;
  }else if(next>this.factor+1e-3){
   this.lighter??=now;
   if(interacting||now-this.lighter<600||now-this.changed<250)return false;
  }else{this.lighter=null;return false;}
  this.factor=next;this.changed=now;this.lighter=null;
  return true;
 }
}
