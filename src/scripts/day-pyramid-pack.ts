// Day pyramid packs and their index (docs/lab/day-pyramid-global-2026-10-17.md,
// "Whole packs").
//
// The media host ignores HTTP ranges, so a pack is fetched whole. Each pack
// holds one level only, an aligned block of 2^k × 2^k tiles of that level
// (8 × 8 in the release: one day tile at level 3, 2 × 2 day tiles at level 2
// and 4 × 4 at level 1), so a view fetches only the levels it draws.
// `day-pyramid/<level>/<x>-<y>.pack`, where (x, y) is the block's first tile:
//
//   0   "ELDP"   u8 version (2)   u8 level   u8 k   u8 reserved
//   8   u16 x   u16 y
//   12  4^k × (u32 offset, u32 length), row-major from (x, y), from the start
//       of the pack; 0 = absent. The tiles follow in that order.
//
// index.bin has one entry per day tile with deep tiles: which of its tiles
// exist, and the pack block size k of each level there, so the renderer
// knows where detail is and which pack holds it without reading a pack:
//
//   0   "ELDI"   u8 version (2)   u8 depth (3)   u16 interior (540)
//   8   u8 gutter (16)   u8 reserved   u16 reserved   u32 entries
//   16  entries × 16 bytes: u16 day tile id, u8[11] tile mask (bit i = day
//       slot i), u8[3] k of levels 1–3
//
// Day slots number a day tile's 84 deep tiles: 4 at level 1, 16 at level 2
// and 64 at level 3, row-major within a level. The builder's day tile packs
// (one per day tile, all three levels) use the same order:
//
//   0   "ELDP"   u8 version (1)   u8 depth (3)   u16 count (84)
//   8   u32 reserved
//   12  count × (u32 offset, u32 length); 684 u32 reserved; tiles from 688
//
// Integers are little-endian. scripts/build-day-pyramid.mjs writes day tile
// packs; scripts/build-day-pyramid-packs.mjs repacks them into release packs.
export const PACK_DEPTH=3;
export const DAY_SLOTS=4+16+64;
export const DAY_PACK_HEADER=688;
export const INDEX_HEADER=16,INDEX_ENTRY=16;
/** Largest block: 32 × 32 tiles. */
export const MAX_PACK_K=5;
const COLUMNS=160,ROWS=80;

/** Day slot of tile (level, x, y) within its day tile, and back. */
export function daySlot(level:number,x:number,y:number){return (level===1?0:level===2?4:20)+y*(1<<level)+x;}
export function slotTile(i:number){
  const level=i<4?1:i<20?2:3,local=i-(level===1?0:level===2?4:20),side=1<<level;
  return {level,x:local%side,y:Math.floor(local/side)};
}

function concat(header:Uint8Array,parts:Uint8Array[]){
  const out=new Uint8Array(header.length+parts.reduce((sum,part)=>sum+part.length,0));
  out.set(header,0);let at=header.length;
  for(const part of parts){out.set(part,at);at+=part.length;}
  return out;
}
function readEntries(view:DataView,at:number,count:number){
  const entries:[number,number][]=[];
  for(let i=0;i<count;i++)entries.push([view.getUint32(at+i*8,true),view.getUint32(at+i*8+4,true)]);
  return entries;
}

/** A day tile pack (builder output) from encoded tiles keyed by day slot. */
export function encodeDayPack(tiles:Map<number,Uint8Array>){
  const header=new Uint8Array(DAY_PACK_HEADER),view=new DataView(header.buffer),parts:Uint8Array[]=[];
  header.set([69,76,68,80],0);view.setUint8(4,1);view.setUint8(5,PACK_DEPTH);view.setUint16(6,DAY_SLOTS,true);
  let offset=DAY_PACK_HEADER;
  for(let i=0;i<DAY_SLOTS;i++){
    const bytes=tiles.get(i);if(!bytes?.length)continue;
    view.setUint32(12+i*8,offset,true);view.setUint32(16+i*8,bytes.length,true);
    parts.push(bytes);offset+=bytes.length;
  }
  return concat(header,parts);
}

/** [offset, length] per day slot of a day tile pack; length 0 where absent. */
export function decodeDayPack(bytes:Uint8Array){
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(bytes.length<DAY_PACK_HEADER||view.getUint32(0,true)!==0x50444c45||view.getUint8(4)!==1||view.getUint8(5)!==PACK_DEPTH||view.getUint16(6,true)!==DAY_SLOTS)throw new Error('Invalid day tile pack');
  return readEntries(view,12,DAY_SLOTS);
}

export function slotMask(entries:[number,number][]){
  const mask=new Uint8Array(11);
  entries.forEach(([,length],i)=>{if(length)mask[i>>3]|=1<<(i&7);});
  return mask;
}

/** Header bytes of a release pack with block size k. */
export const packHeaderLength=(k:number)=>12+8*(1<<2*k);

/** The release pack that holds tile (level, x, y) when that level's blocks are 2^k tiles wide. */
export function packOf(level:number,x:number,y:number,k:number){
  const x0=x>>k<<k,y0=y>>k<<k;
  return {path:`${level}/${x0}-${y0}.pack`,level,k,x:x0,y:y0,slot:((y-y0)<<k)+x-x0};
}

/** A release pack from encoded tiles keyed by slot (row-major in the block). */
export function encodePack(level:number,k:number,x:number,y:number,tiles:Map<number,Uint8Array>){
  const count=1<<2*k,header=new Uint8Array(packHeaderLength(k)),view=new DataView(header.buffer),parts:Uint8Array[]=[];
  if(x%(1<<k)||y%(1<<k)||x>=COLUMNS<<level||y>=ROWS<<level)throw new Error('Pack block is not aligned');
  header.set([69,76,68,80],0);view.setUint8(4,2);view.setUint8(5,level);view.setUint8(6,k);view.setUint16(8,x,true);view.setUint16(10,y,true);
  let offset=header.length;
  for(let i=0;i<count;i++){
    const bytes=tiles.get(i);if(!bytes?.length)continue;
    view.setUint32(12+i*8,offset,true);view.setUint32(16+i*8,bytes.length,true);
    parts.push(bytes);offset+=bytes.length;
  }
  return concat(header,parts);
}

/** A release pack's header, from at least its first packHeaderLength(k) bytes;
 * null while fewer bytes have arrived. `bytes` is the pack's total length. */
export function decodePackHeader(bytes:Uint8Array){
  if(bytes.length<12)return null;
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),k=view.getUint8(6),level=view.getUint8(5);
  if(view.getUint32(0,true)!==0x50444c45||view.getUint8(4)!==2||level<1||level>PACK_DEPTH||k>MAX_PACK_K)throw new Error('Invalid day pyramid pack');
  if(bytes.length<packHeaderLength(k))return null;
  const entries=readEntries(view,12,1<<2*k);
  return {level,k,x:view.getUint16(8,true),y:view.getUint16(10,true),entries,bytes:entries.reduce((end,[offset,length])=>length?Math.max(end,offset+length):end,packHeaderLength(k))};
}

export type IndexEntry={mask:Uint8Array;k:Uint8Array};

export function encodeIndex(entries:{id:number;mask:Uint8Array;k:ArrayLike<number>}[]){
  const out=new Uint8Array(INDEX_HEADER+entries.length*INDEX_ENTRY),view=new DataView(out.buffer);
  out.set([69,76,68,73],0);view.setUint8(4,2);view.setUint8(5,PACK_DEPTH);view.setUint16(6,540,true);view.setUint8(8,16);
  view.setUint32(12,entries.length,true);
  entries.forEach((entry,i)=>{const at=INDEX_HEADER+i*INDEX_ENTRY;view.setUint16(at,entry.id,true);out.set(entry.mask,at+2);out.set(Array.from(entry.k),at+13);});
  return out;
}

/** Map<day tile id, {tile mask, k per level}> from index.bin. */
export function decodeIndex(bytes:Uint8Array){
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(bytes.length<INDEX_HEADER||view.getUint32(0,true)!==0x49444c45||view.getUint8(4)!==2||view.getUint8(5)!==PACK_DEPTH||view.getUint16(6,true)!==540||view.getUint8(8)!==16)throw new Error('Invalid day pyramid index');
  const count=view.getUint32(12,true);
  if(bytes.length!==INDEX_HEADER+count*INDEX_ENTRY)throw new Error('Truncated day pyramid index');
  const entries=new Map<number,IndexEntry>();
  for(let i=0;i<count;i++){
    const at=INDEX_HEADER+i*INDEX_ENTRY,id=view.getUint16(at,true),k=bytes.slice(at+13,at+16);
    if(id>=COLUMNS*ROWS||k.some(v=>v>MAX_PACK_K))throw new Error('Invalid day tile in index');
    entries.set(id,{mask:bytes.slice(at+2,at+13),k});
  }
  return entries;
}
