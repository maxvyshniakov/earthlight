// Day pyramid: three levels below the 500 m day tiles, from Sentinel-2,
// opt-in with `dayDetail=sentinel`. See docs/lab/day-pyramid-global-2026-10-17.md.
//
// Level L splits each 2.25° day tile into 2^L × 2^L tiles of the same 540 px
// interior and 16 px gutters: 250, 125 and 62.5 m per texel (7.5″, 3.75″ and
// 1.875″). Tiles come in packs of one level each, fetched whole because the
// media host ignores HTTP ranges, and kept in a byte-bounded LRU cache;
// index.bin says which tiles exist and which pack holds them
// (day-pyramid-pack.ts; docs/lab/day-pyramid-global-2026-10-17.md, "Whole
// packs").
//
// The tiles share the day atlas (unit 6) and its slot allocator: every
// fragment sampler is already taken. Slot 0 of that atlas holds the page
// tables:
//
//   x 0–159,   y 0–159  BMNG slot (R) and fade rows, as before. G of a BMNG
//                        entry is this pyramid's directory index, 0 for none.
//   x 160–255, y 0–39   up to 30 directory blocks of 16 × 8 texels, one per
//                        day tile with resident deep tiles. Each of its 8 × 8
//                        cells (the level-3 tiles) holds two texels: the deepest
//                        resident tile (slot, level, fade) and the tile it
//                        replaced (slot, level), for the fade between them.
//
// A missing child therefore falls back to its nearest resident ancestor, and
// a cell with none falls back to BMNG. Requests follow the same ground-ray
// footprint as the BMNG tiles: nothing deep is wanted until a BMNG texel
// covers more than two pixels, so startup is unchanged.
import { daySlot, decodeIndex, decodePackHeader, packOf, type IndexEntry } from './day-pyramid-pack.ts';

export const PYRAMID_DEPTH=3;
const COLUMNS=160,ROWS=80,CELLS=1<<PYRAMID_DEPTH;
const BLOCK_X=160,BLOCK_COLUMNS=6,BLOCKS=30;
export const PYRAMID_TABLE={x:BLOCK_X,y:0,width:BLOCK_COLUMNS*CELLS*2,height:BLOCKS/BLOCK_COLUMNS*CELLS};

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

export const dayPyramidShader=`
#ifdef DAY_PYRAMID
vec4 dayPyramidTexel(vec2 texel){return texture2D(dayTileAtlas,(texel+.5)/dayTileLayout.x);}
vec3 dayPyramidLevel(vec2 uv,float slot,float level,float footprint){
  float scale=exp2(level);
  vec2 local=fract(vec2(fract(uv.x),clamp(1.-uv.y,0.,.999999))*vec2(${COLUMNS}.,${ROWS}.)*scale);
  // The BMNG tiles' explicit trilinear filtering and footprint bias, and
  // their B-spline once a deep texel spans more than a pixel.
  float texels=footprint*scale;
  float lod=clamp(log2(max(1.,texels*.5)),0.,4.);
  return daySample(local,slot,lod,1.-smoothstep(.5,1.,texels));
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
type Waiter={slot:number;resolve:(blob:Blob)=>void;reject:(error:Error)=>void};

/** The level that gives one to two texels per pixel at this BMNG footprint
 * (BMNG texels per pixel), or 0 while BMNG resolves the pixel itself. */
export function pyramidLevel(footprint:number){
  return footprint>=2?0:Math.max(1,Math.min(PYRAMID_DEPTH,Math.ceil(Math.log2(1/footprint))));
}

/** One pack, fetched whole. Its bytes arrive as a stream and each tile
 * resolves as soon as its own bytes are in, so the first detail does not
 * wait for the rest of the pack. */
class Pack {
  controller=new AbortController();
  header:ReturnType<typeof decodePackHeader>=null;
  bytes:Uint8Array<ArrayBuffer>|null=null;
  received=0;
  error:Error|null=null;
  waiters=new Set<Waiter>();
  constructor(readonly path:string){}

  private ready(slot:number):Blob|Error|null{
    if(this.header){
      const [offset,length]=this.header.entries[slot]??[0,0];
      if(!length)return new Error('Day pyramid tile absent');
      if(this.received>=offset+length)return new Blob([this.bytes!.subarray(offset,offset+length)],{type:'image/avif'});
    }
    return this.error;
  }

  tile(slot:number,signal:AbortSignal){
    const ready=this.ready(slot);
    if(ready)return ready instanceof Blob?Promise.resolve(ready):Promise.reject(ready);
    if(signal.aborted)return Promise.reject(new Error('aborted'));
    return new Promise<Blob>((resolve,reject)=>{
      const abort=()=>{this.waiters.delete(waiter);reject(new Error('aborted'));};
      const waiter:Waiter={slot,resolve:blob=>{signal.removeEventListener('abort',abort);resolve(blob);},reject:error=>{signal.removeEventListener('abort',abort);reject(error);}};
      signal.addEventListener('abort',abort,{once:true});
      this.waiters.add(waiter);
    });
  }

  settle(){
    for(const waiter of this.waiters){
      const ready=this.ready(waiter.slot);if(!ready)continue;
      this.waiters.delete(waiter);
      if(ready instanceof Blob)waiter.resolve(ready);else waiter.reject(ready);
    }
  }
}

export class DayPyramid {
  /** Day tile id → its tile mask and each level's pack block size (index.bin). */
  packs=new Map<number,IndexEntry>();
  directory=new Uint8Array(COLUMNS*ROWS);
  table=new Uint8Array(PYRAMID_TABLE.width*PYRAMID_TABLE.height*4);
  wanted=0;
  /** Packs fetched, bytes received (whole packs and aborted parts), bytes cached. */
  requests=0;
  received=0;
  cached=0;
  /** Completed packs, least recently used first. */
  private cache=new Map<string,Pack>();
  private loading=new Map<string,Pack>();
  private signature='';
  private root:string;

  constructor(baseURL:string,signal:AbortSignal,notify:()=>void,private cacheBytes=48*2**20){
    this.root=baseURL.replace(/\/+$/,'')+'/day-pyramid/';
    signal.addEventListener('abort',()=>{for(const pack of this.loading.values())pack.controller.abort();this.loading.clear();},{once:true});
    fetch(this.root+'index.bin',{signal}).then(response=>{
      if(!response.ok)throw new Error('Day pyramid index unavailable');
      return response.arrayBuffer();
    }).then(bytes=>{this.packs=decodeIndex(new Uint8Array(bytes));notify();})
      .catch(()=>{/* BMNG remains complete without deeper levels. */});
  }

  has(key:number){
    const {id,slot}=pyramidDayTile(key),mask=this.packs.get(id)?.mask;
    return !!mask&&(mask[slot>>3]&(1<<(slot&7)))!==0;
  }

  /** The pack that holds a deep tile, and the tile's slot in it. */
  locate(key:number){
    const {level,x,y}=pyramidTile(key),entry=this.packs.get((y>>level)*COLUMNS+(x>>level));
    return entry?packOf(level,x,y,entry.k[level-1]):null;
  }

  /** Whether a tile costs no further download: its pack is cached or loading. */
  private held(path:string){return this.cache.has(path)||this.loading.has(path);}

  private async stream(pack:Pack,expected:ReturnType<typeof packOf>){
    try{
      const response=await fetch(this.root+pack.path,{signal:pack.controller.signal,priority:'low'} as RequestInit);
      if(!response.ok||!response.body)throw new Error(`Day pyramid pack unavailable (${response.status})`);
      this.requests++;
      const reader=response.body.getReader();
      let head=new Uint8Array(0);
      for(;;){
        const {done,value}=await reader.read();
        if(done)break;
        this.received+=value.length;
        if(pack.bytes){
          if(pack.received+value.length>pack.bytes.length)throw new Error('Day pyramid pack too long');
          pack.bytes.set(value,pack.received);pack.received+=value.length;
        }else{
          const joined=new Uint8Array(head.length+value.length);joined.set(head);joined.set(value,head.length);head=joined;
          const header=decodePackHeader(head);
          if(!header)continue;
          if(header.level!==expected.level||header.k!==expected.k||header.x!==expected.x||header.y!==expected.y)throw new Error('Day pyramid pack mismatch');
          if(head.length>header.bytes)throw new Error('Day pyramid pack too long');
          pack.bytes=new Uint8Array(header.bytes);pack.bytes.set(head);pack.received=head.length;pack.header=header;
        }
        pack.settle();
      }
      if(!pack.bytes||pack.received!==pack.bytes.length)throw new Error('Truncated day pyramid pack');
      if(this.loading.get(pack.path)!==pack)return;
      this.loading.delete(pack.path);
      this.cache.set(pack.path,pack);this.cached+=pack.bytes.length;
      // Least recently used first; the newest pack stays even if it alone is over budget.
      for(const [path,old] of this.cache){
        if(this.cached<=this.cacheBytes||old===pack)break;
        this.cache.delete(path);this.cached-=old.bytes!.length;
      }
    }catch(error){
      pack.error=error instanceof Error?error:new Error(String(error));
      if(this.loading.get(pack.path)===pack)this.loading.delete(pack.path);
    }finally{pack.settle();}
  }

  /** The tile's AVIF bytes, from its pack: cached, loading, or fetched now. */
  load(key:number,signal:AbortSignal){
    const at=this.locate(key);
    if(!at||!this.has(key))return Promise.reject(new Error('Day pyramid tile absent'));
    let pack=this.cache.get(at.path);
    if(pack){this.cache.delete(at.path);this.cache.set(at.path,pack);}
    else if(!(pack=this.loading.get(at.path))){
      pack=new Pack(at.path);this.loading.set(at.path,pack);
      void this.stream(pack,at);
    }
    return pack.tile(at.slot,signal);
  }

  /** Deep tiles under the ground rays: the tiles drawn at each ray's level,
   * centre first, then their coarser parents and a one-tile guard band at
   * the drawn level. Packs come whole, so a parent or guard tile is wanted
   * only when its pack costs nothing more: already cached or loading, or
   * needed by a drawn tile anyway. Loading packs that no wanted tile needs
   * any more are aborted. */
  select(view:View,width:number,height:number,limit:number){
    if(!this.packs.size||limit<1){this.retain([]);return [];}
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
      if(!drawn.has(key)&&(needed.has(path)||this.held(path)))wanted.push(key);
    }
    this.retain(wanted);
    this.wanted=wanted.length;
    return wanted;
  }

  /** Abort loading packs that none of these tiles needs. */
  private retain(keys:number[]){
    const keep=new Set(keys.map(key=>this.locate(key)?.path));
    for(const [path,pack] of this.loading)if(!keep.has(path)){this.loading.delete(path);pack.controller.abort();}
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
