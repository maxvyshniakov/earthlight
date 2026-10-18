import {daySlot,packOf,type IndexEntry} from './day-pyramid-pack.ts';
import {tileDimensions,DAY_PYRAMID_DEPTH} from './tile-layout.ts';

export const PYRAMID_DEPTH=DAY_PYRAMID_DEPTH;
const {columns:COLUMNS,rows:ROWS}=tileDimensions('day');
/** Keys share SurfaceTiles' map with BMNG ids (< 12,800). */
export const pyramidKey=(level:number,x:number,y:number)=>level*1e8+y*COLUMNS*2**level+x;
export function pyramidTile(key:number){
  const level=Math.floor(key/1e8),rest=key-level*1e8,columns=COLUMNS*2**level;
  return {level,x:rest%columns,y:Math.floor(rest/columns)};
}
/** The day tile (BMNG id) above a deep tile, and the tile's slot in its index mask. */
export function pyramidDayTile(key:number){
  const {level,x,y}=pyramidTile(key);
  return {id:(y>>level)*COLUMNS+(x>>level),slot:daySlot(level,x&(1<<level)-1,y&(1<<level)-1)};
}

type View={camera:ArrayLike<number>;cameraBasis:ArrayLike<number>;sun:ArrayLike<number>;focal?:number};
/** The level that gives one to two texels per pixel at this BMNG footprint
 * (BMNG texels per pixel), or 0 while BMNG resolves the pixel itself. */
export function pyramidLevel(footprint:number){
  return footprint>=2?0:Math.max(1,Math.min(PYRAMID_DEPTH,Math.ceil(Math.log2(1/footprint))));
}

/** Selection over a decoded index; pack residency is supplied by its owner. */
export class DayPyramidSelection {
  constructor(public index:ReadonlyMap<number,IndexEntry>=new Map()){}
  has(key:number){
    const {id,slot}=pyramidDayTile(key),mask=this.index.get(id)?.mask;
    return !!mask&&(mask[slot>>3]&(1<<(slot&7)))!==0;
  }

  /** The pack that holds a deep tile, and the tile's slot in it. */
  locate(key:number){
    const {level,x,y}=pyramidTile(key),entry=this.index.get((y>>level)*COLUMNS+(x>>level));
    return entry?packOf(level,x,y,entry.k[level-1]):null;
  }

  /** Deep tiles under the ground rays: the tiles drawn at each ray's level,
   * centre first, then their coarser parents and a one-tile guard band at
   * the drawn level. Packs come whole, so a parent or guard tile is wanted
   * only when its pack costs nothing more: already cached or loading, or
   * needed by a drawn tile anyway. The stream owner cancels unneeded packs. */
  select(view:View,width:number,height:number,limit:number,held:(path:string)=>boolean=()=>false){
    if(!this.index.size||limit<1)return [];
    const c=view.camera,m=view.cameraBasis,sun=view.sun,focal=view.focal??1.25;
    const camera2=c[0]*c[0]+c[1]*c[1]+c[2]*c[2];
    const scores=new Map<number,number>(),drawn=new Set<number>();
    const consider=(key:number,score:number)=>{if(this.has(key))scores.set(key,Math.min(scores.get(key)??Infinity,score));};
    for(let iy=0;iy<28;iy++)for(let ix=0;ix<64;ix++){
      const vx=((ix+.5)/64-.5)*width/height,vy=.5-(iy+.5)/28,vz=focal;
      let x=m[0]*vx+m[3]*vy+m[6]*vz,y=m[1]*vx+m[4]*vy+m[7]*vz,z=m[2]*vx+m[5]*vy+m[8]*vz;
      const length=Math.hypot(x,y,z);x/=length;y/=length;z/=length;
      const b=c[0]*x+c[1]*y+c[2]*z,disc=b*b-camera2+1;
      if(b>=0||disc<=0)continue;
      const distance=-b-Math.sqrt(disc);
      const gx=c[0]+x*distance,gy=c[1]+y*distance,gz=c[2]+z*distance;
      if(gx*sun[0]+gy*sun[1]+gz*sun[2]<-.12)continue;
      // Same footprint as the scene shader: BMNG texels per pixel.
      const footprint=distance*(86400/(2*Math.PI))/(height*focal*Math.max(.02,-gx*x-gy*y-gz*z)*Math.max(.02,Math.hypot(gx,gy)));
      let level=pyramidLevel(footprint);
      if(!level)continue;
      const u=Math.atan2(gy,gx)/(2*Math.PI)+.5,v=(.5-Math.asin(Math.max(-1,Math.min(1,gz)))/Math.PI);
      const centre=((ix+.5)/64-.5)**2+((iy+.5)/28-.5)**2;
      // The deepest available level here, stepping up through missing children.
      let tx=0,ty=0;
      for(;level>0;level--){
        tx=Math.min((COLUMNS<<level)-1,Math.floor(u*(COLUMNS<<level)));ty=Math.min((ROWS<<level)-1,Math.floor(v*(ROWS<<level)));
        if(this.has(pyramidKey(level,tx,ty)))break;
      }
      if(!level)continue;
      const key=pyramidKey(level,tx,ty);
      drawn.add(key);
      if(level>1)consider(pyramidKey(level-1,tx>>1,ty>>1),2+centre);
      consider(key,centre);
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if((dx||dy)&&ty+dy>=0&&ty+dy<ROWS<<level)consider(pyramidKey(level,(tx+dx+(COLUMNS<<level))%(COLUMNS<<level),ty+dy),3+centre+Math.hypot(dx,dy));
    }
    const ranked=[...scores].sort((a,b)=>a[1]-b[1]).map(([key])=>key);
    const wanted=ranked.filter(key=>drawn.has(key)).slice(0,limit);
    const needed=new Set(wanted.map(key=>this.locate(key)!.path));
    for(const key of ranked){
      if(wanted.length>=limit)break;
      const path=this.locate(key)!.path;
      if(!drawn.has(key)&&(needed.has(path)||held(path)))wanted.push(key);
    }
    return wanted;
  }

}
