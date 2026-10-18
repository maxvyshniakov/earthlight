import {tileDimensions as dimensions,tileAddress,type SurfaceLayer as Layer,TILE_COLUMNS,TILE_ROWS} from './tile-layout.ts';

export type SurfaceView={camera:ArrayLike<number>;cameraBasis:ArrayLike<number>;sun:ArrayLike<number>;galacticBasis?:ArrayLike<number>;focal?:number};
export function tileAt(longitude:number,latitude:number){
  const x=Math.floor(((longitude+180)%360+360)%360/360*TILE_COLUMNS);
  const y=Math.min(TILE_ROWS-1,Math.max(0,Math.floor((90-latitude)/180*TILE_ROWS)));
  return tileAddress(dimensions('night'),x,y);
}

// Sample ground rays, prioritize the nearest night-side detail, and guard one
// tile around each hit so movement doesn't continually expose unloaded edges.
export function visibleSurfaceTiles(view:SurfaceView,width:number,height:number,available:Set<number>,limit:number,layer:Layer='night'){
  if(layer==='galaxy')return visibleGalaxyTiles(view,width,height,available,limit);
  const {columns,rows,interior}=dimensions(layer);
  const radius=layer==='cloud'?1.0018835:1;
  const scores=new Map<number,number>(),visible=new Set<number>();
  const c=view.camera,m=view.cameraBasis,sun=view.sun,focal=view.focal??1.25;
  const camera2=c[0]*c[0]+c[1]*c[1]+c[2]*c[2];
  for(let iy=0;iy<28;iy++)for(let ix=0;ix<64;ix++){
    const vx=((ix+.5)/64-.5)*width/height,vy=.5-(iy+.5)/28,vz=focal;
    let x=m[0]*vx+m[3]*vy+m[6]*vz,y=m[1]*vx+m[4]*vy+m[7]*vz,z=m[2]*vx+m[5]*vy+m[8]*vz;
    const length=Math.hypot(x,y,z);x/=length;y/=length;z/=length;
    const b=c[0]*x+c[1]*y+c[2]*z,disc=b*b-camera2+radius*radius;
    if(b>=0||disc<=0)continue;
    const distance=-b-Math.sqrt(disc);
    const gx=c[0]+x*distance,gy=c[1]+y*distance,gz=c[2]+z*distance;
    const solar=gx*sun[0]+gy*sun[1]+gz*sun[2];
    if(layer!=='cloud'&&layer!=='terrain'&&layer!=='terrainFine'&&(layer==='night'?solar>.08:solar<-.12))continue;
    // Match the day/night shader's longitude footprint before fetching tiles
    // that it would immediately replace with the filtered overview at a pole.
    const longitudeScale=layer==='day'||layer==='night'?Math.max(.02,Math.hypot(gx,gy)/radius):1;
    const footprint=distance*(columns*interior/(2*Math.PI))/(height*focal*Math.max(.02,-gx*x-gy*y-gz*z)*longitudeScale);
    if(footprint>=32)continue;
    const kx=Math.min(columns-1,Math.floor((Math.atan2(gy,gx)/(2*Math.PI)+.5)*columns));
    const ky=Math.min(rows-1,Math.max(0,Math.floor((.5-Math.asin(Math.max(-1,Math.min(1,gz/radius)))/Math.PI)*rows)));
    visible.add(ky*columns+kx);
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      if(ky+dy<0||ky+dy>=rows)continue;
      const id=(ky+dy)*columns+(kx+dx+columns)%columns;
      if(!available.has(id))continue;
      const focus=layer==='terrainFine'?1+12*(((ix+.5)/64-.5)**2+((iy+.5)/28-.5)**2):1;
      const score=footprint*focus+Math.hypot(dx,dy)*2;
      scores.set(id,Math.min(scores.get(id)??Infinity,score));
    }
  }
  // On-screen detail precedes the speculative guard band. Otherwise a close
  // off-screen neighbor can evict a city that is already visible farther away.
  return [...scores].sort((a,b)=>Number(visible.has(b[0]))-Number(visible.has(a[0]))||a[1]-b[1]).slice(0,limit).map(([id])=>id);
}

/** Select only visible, unoccluded sky, with centre detail before neighbours.
 * The catalog basis columns match dot(direction, galacticBasis[i]) in GLSL. */
export function visibleGalaxyTiles(view:SurfaceView,width:number,height:number,available:Set<number>,limit:number){
  const g=view.galacticBasis;if(!g||height<=0)return [];
  const m=view.cameraBasis,c=view.camera,camera2=c[0]**2+c[1]**2+c[2]**2,scores=new Map<number,number>(),focal=view.focal??1.25;
  for(let iy=0;iy<24;iy++)for(let ix=0;ix<40;ix++){
    const px=((ix+.5)/40-.5)*width/height,py=.5-(iy+.5)/24;
    let x=m[0]*px+m[3]*py+m[6]*focal,y=m[1]*px+m[4]*py+m[7]*focal,z=m[2]*px+m[5]*py+m[8]*focal;
    const norm=Math.hypot(x,y,z);x/=norm;y/=norm;z/=norm;
    const b=c[0]*x+c[1]*y+c[2]*z;if(b<0&&b*b>=camera2-1)continue;
    const gx=x*g[0]+y*g[1]+z*g[2],gy=x*g[3]+y*g[4]+z*g[5],gz=x*g[6]+y*g[7]+z*g[8];
    const kx=Math.floor(((.5-Math.atan2(gy,gx)/(2*Math.PI))+1)%1*32),ky=Math.min(15,Math.floor((.5-Math.asin(Math.max(-1,Math.min(1,gz)))/Math.PI)*16));
    const footprint=16384/(2*Math.PI*height*focal*Math.max(.1,Math.hypot(gx,gy)));
    if(footprint>=4)continue;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      if(ky+dy<0||ky+dy>=16)continue;
      const id=(ky+dy)*32+(kx+dx+32)%32;if(!available.has(id))continue;
      const score=px*px+py*py+(dx*dx+dy*dy)*4;
      scores.set(id,Math.min(scores.get(id)??Infinity,score));
    }
  }
  return [...scores].sort((a,b)=>a[1]-b[1]||a[0]-b[0]).slice(0,limit).map(([id])=>id);
}
