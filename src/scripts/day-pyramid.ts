// Lab: deeper day-surface levels below the 500 m BMNG tiles, opt-in with
// `dayDetail=sentinel`. See docs/lab/day-pyramid-2026-10-17.md.
//
// Level L splits each 2.25° BMNG tile into 2^L × 2^L tiles of the same 540 px
// interior and 16 px gutters, so level 5 is about 14.5 m per texel. The tiles
// share the day atlas (unit 6) and its slot allocator: every fragment sampler
// is already taken. Slot 0 of that atlas holds the page tables:
//
//   x 0–159,   y 0–159  BMNG slot (R) and fade rows, as before. G of a BMNG
//                        entry is this pyramid's directory index, 0 for none.
//   x 160–543, y 0–159  up to 30 directory blocks of 64 × 32 texels, one per
//                        BMNG tile with resident deep tiles. Each of its 32 × 32
//                        cells (the level-5 tiles) holds two texels: the deepest
//                        resident tile (slot, level, fade) and the tile it
//                        replaced (slot, level), for the fade between them.
//
// A missing child therefore falls back to its nearest resident ancestor, and
// a cell with none falls back to BMNG. Requests follow the same ground-ray
// footprint as the BMNG tiles: nothing deep is wanted until a BMNG texel
// covers more than two pixels, so startup is unchanged.
export const PYRAMID_DEPTH=5;
const COLUMNS=160,ROWS=80,CELLS=1<<PYRAMID_DEPTH;
const BLOCK_X=160,BLOCK_COLUMNS=6,BLOCKS=30;
export const PYRAMID_TABLE={x:BLOCK_X,y:0,width:BLOCK_COLUMNS*CELLS*2,height:BLOCKS/BLOCK_COLUMNS*CELLS};

/** Keys share SurfaceTiles' map with BMNG ids (< 12,800). */
export const pyramidKey=(level:number,x:number,y:number)=>level*1e8+y*COLUMNS*2**level+x;
export function pyramidTile(key:number){
  const level=Math.floor(key/1e8),rest=key-level*1e8,columns=COLUMNS*2**level;
  return {level,x:rest%columns,y:Math.floor(rest/columns)};
}

export const dayPyramidShader=`
#ifdef DAY_PYRAMID
vec4 dayPyramidTexel(vec2 texel){return texture2D(dayTileAtlas,(texel+.5)/dayTileLayout.x);}
vec3 dayPyramidLevel(vec2 uv,float slot,float level,float footprint){
  float scale=exp2(level);
  vec2 local=fract(vec2(fract(uv.x),clamp(1.-uv.y,0.,.999999))*vec2(${COLUMNS}.,${ROWS}.)*scale);
  // The same explicit trilinear filtering and footprint bias as the BMNG tiles.
  float lod=clamp(log2(max(1.,footprint*scale*.5)),0.,4.);
  vec3 light=dayLevel(local,slot,floor(lod));
  if(fract(lod)>0.)light=mix(light,dayLevel(local,slot,min(4.,floor(lod)+1.)),fract(lod));
  return light;
}
// Deep levels carry BMNG's own low frequencies, so they blend in over the
// last octave before BMNG runs out (two pixels per texel to one).
vec3 pyramidDay(vec2 uv,float footprint,vec3 base){
  if(dayTileLayout.x<1.||footprint>=2.)return base;
  vec2 grid=vec2(fract(uv.x),clamp(1.-uv.y,0.,.999999))*vec2(${COLUMNS}.,${ROWS}.);
  float region=floor(dayPyramidTexel(floor(grid)).g*255.+.5);
  if(region<.5)return base;
  vec2 cell=floor(fract(grid)*${CELLS}.);
  vec2 block=vec2(${BLOCK_X}.+mod(region-1.,${BLOCK_COLUMNS}.)*${CELLS*2}.,floor((region-1.)/${BLOCK_COLUMNS}.)*${CELLS}.);
  vec4 entry=dayPyramidTexel(block+vec2(cell.x*2.,cell.y));
  float level=floor(entry.g*255.+.5);
  if(level<.5)return base;
  vec3 detail=dayPyramidLevel(uv,floor(entry.r*255.+.5),level,footprint);
  if(entry.b<1.){
    vec4 previous=dayPyramidTexel(block+vec2(cell.x*2.+1.,cell.y));
    float before=floor(previous.g*255.+.5);
    detail=mix(before>.5?dayPyramidLevel(uv,floor(previous.r*255.+.5),before,footprint):base,detail,entry.b);
  }
  return mix(base,detail,1.-smoothstep(1.,2.,footprint));
}
#else
vec3 pyramidDay(vec2 uv,float footprint,vec3 base){return base;}
#endif
`;

type View={camera:ArrayLike<number>;cameraBasis:ArrayLike<number>;sun:ArrayLike<number>;focal?:number};
type Resident={slot:number;loaded:number};

/** The level that gives one to two texels per pixel at this BMNG footprint
 * (BMNG texels per pixel), or 0 while BMNG resolves the pixel itself. */
export function pyramidLevel(footprint:number){
  return footprint>=2?0:Math.max(1,Math.min(PYRAMID_DEPTH,Math.ceil(Math.log2(1/footprint))));
}

export class DayPyramid {
  available=new Set<number>();
  directory=new Uint8Array(COLUMNS*ROWS);
  table=new Uint8Array(PYRAMID_TABLE.width*PYRAMID_TABLE.height*4);
  wanted=0;
  private signature='';

  constructor(private baseURL:string,signal:AbortSignal,notify:()=>void){
    fetch(baseURL.replace(/\/+$/,'')+'/day-pyramid/manifest.json',{signal}).then(response=>{
      if(!response.ok)throw new Error('Day pyramid manifest unavailable');
      return response.json();
    }).then(data=>{
      if(data.version!==1||data.interior!==540||data.gutter!==16||data.depth!==PYRAMID_DEPTH||!Array.isArray(data.tiles))throw new Error('Invalid day pyramid manifest');
      for(const tile of data.tiles){
        const [level,x,y]=String(tile).split('/').map(Number);
        if(level>=1&&level<=PYRAMID_DEPTH&&x>=0&&x<COLUMNS<<level&&y>=0&&y<ROWS<<level)this.available.add(pyramidKey(level,x,y));
      }
      notify();
    }).catch(()=>{/* BMNG remains complete without deeper levels. */});
  }

  url(key:number){const {level,x,y}=pyramidTile(key);return `${this.baseURL.replace(/\/+$/,'')}/day-pyramid/${level}/${x}-${y}.avif`;}

  /** Deep tiles under the ground rays, coarse parents first, then the visible
   * level, then a one-tile guard band at that level. */
  select(view:View,width:number,height:number,limit:number){
    if(!this.available.size||limit<1)return [];
    const c=view.camera,m=view.cameraBasis,sun=view.sun,focal=view.focal??1.25;
    const camera2=c[0]*c[0]+c[1]*c[1]+c[2]*c[2];
    const scores=new Map<number,number>();
    const consider=(key:number,score:number)=>{if(this.available.has(key))scores.set(key,Math.min(scores.get(key)??Infinity,score));};
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
        if(this.available.has(pyramidKey(level,tx,ty)))break;
      }
      if(!level)continue;
      if(level>1)consider(pyramidKey(level-1,tx>>1,ty>>1),centre);
      consider(pyramidKey(level,tx,ty),1+centre);
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(dx||dy)consider(pyramidKey(level,(tx+dx+(COLUMNS<<level))%(COLUMNS<<level),ty+dy),2+centre+Math.hypot(dx,dy));
    }
    const wanted=[...scores].sort((a,b)=>a[1]-b[1]).slice(0,limit).map(([key])=>key);
    this.wanted=wanted.length;
    return wanted;
  }

  /** Rebuild the directory and cell blocks; returns whether a texel changed.
   * Skipped while the resident deep tiles are unchanged and fully faded. */
  write(resident:Map<number,Resident>,now:number){
    const deep=[...resident].filter(([key,entry])=>key>=1e8&&Number.isFinite(entry.loaded));
    const fading=deep.some(([,entry])=>now-entry.loaded<650);
    const signature=deep.map(([key,entry])=>`${key}:${entry.slot}`).join()+(fading?'~':'');
    if(signature===this.signature&&!fading)return false;
    this.signature=signature;
    const before=this.table.slice(),directory=new Uint8Array(this.directory.length);
    this.table.fill(0);
    const tiles=deep.map(([key,entry])=>({...pyramidTile(key),...entry})).sort((a,b)=>a.level-b.level);
    let blocks=0;
    for(const tile of tiles){
      const shift=tile.level,id=(tile.y>>shift)*COLUMNS+(tile.x>>shift);
      if(!directory[id]){if(blocks>=BLOCKS)continue;directory[id]=++blocks;}
      const block=directory[id]-1,bx=(block%BLOCK_COLUMNS)*CELLS*2,by=Math.floor(block/BLOCK_COLUMNS)*CELLS;
      const span=CELLS>>tile.level,cx=(tile.x-((tile.x>>shift)<<shift))*span,cy=(tile.y-((tile.y>>shift)<<shift))*span;
      const fade=Math.round(Math.max(0,Math.min(1,(now-tile.loaded)/650))*255);
      for(let y=cy;y<cy+span;y++)for(let x=cx;x<cx+span;x++){
        const i=((by+y)*PYRAMID_TABLE.width+bx+x*2)*4;
        if(this.table[i+1]>=tile.level)continue;
        this.table[i+4]=this.table[i];this.table[i+5]=this.table[i+1];
        this.table[i]=tile.slot;this.table[i+1]=tile.level;this.table[i+2]=fade;
      }
    }
    let changed=directory.some((v,i)=>v!==this.directory[i]);
    this.directory=directory;
    changed ||= this.table.some((v,i)=>v!==before[i]);
    return changed;
  }
}
