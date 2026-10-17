// Day pyramid packs and their index (docs/lab/day-pyramid-global-2026-10-17.md).
//
// One pack per day tile (BMNG, 2.25°) holds that tile's deep tiles: 4 at
// level 1, 16 at level 2 and 64 at level 3, in that order and row-major
// within a level. A pack starts with a fixed 688-byte header, so a reader
// needs one range request for the header and one per tile:
//
//   0   "ELDP"   u8 version (1)   u8 depth (3)   u16 count (84)
//   8   u32 reserved
//   12  count × (u32 offset, u32 length), from the start of the pack; 0 = absent
//   684 u32 reserved; tiles start at 688
//
// index.bin lists every pack and which of its tiles exist, so the renderer
// knows where detail is without reading a pack:
//
//   0   "ELDI"   u8 version (1)   u8 depth (3)   u16 interior (540)
//   8   u8 gutter (16)   u8 reserved   u16 reserved   u32 packs
//   16  packs × 16 bytes: u16 day tile id, u8[11] tile mask (bit i = tile i), u8[3] zero
//
// Integers are little-endian. scripts/build-day-pyramid.mjs writes both.
export const PACK_DEPTH=3;
export const PACK_TILES=4+16+64;
export const PACK_HEADER=688;
export const INDEX_HEADER=16,INDEX_ENTRY=16;

/** Tile i of a pack ↔ (level, x, y) within its day tile. */
export function packSlot(level:number,x:number,y:number){return (level===1?0:level===2?4:20)+y*(1<<level)+x;}
export function packTile(i:number){
  const level=i<4?1:i<20?2:3,local=i-(level===1?0:level===2?4:20),side=1<<level;
  return {level,x:local%side,y:Math.floor(local/side)};
}

/** A pack from encoded tiles keyed by slot. */
export function encodePack(tiles:Map<number,Uint8Array>){
  const header=new Uint8Array(PACK_HEADER),view=new DataView(header.buffer);
  header.set([69,76,68,80],0);view.setUint8(4,1);view.setUint8(5,PACK_DEPTH);view.setUint16(6,PACK_TILES,true);
  const parts:Uint8Array[]=[header];let offset=PACK_HEADER;
  for(let i=0;i<PACK_TILES;i++){
    const bytes=tiles.get(i);if(!bytes?.length)continue;
    view.setUint32(12+i*8,offset,true);view.setUint32(16+i*8,bytes.length,true);
    parts.push(bytes);offset+=bytes.length;
  }
  const out=new Uint8Array(offset);let at=0;
  for(const part of parts){out.set(part,at);at+=part.length;}
  return out;
}

/** [offset, length] per tile slot; length 0 where the pack has no tile. */
export function decodePackHeader(bytes:Uint8Array){
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(bytes.length<12+PACK_TILES*8||view.getUint32(0,true)!==0x50444c45||view.getUint8(4)!==1||view.getUint8(5)!==PACK_DEPTH||view.getUint16(6,true)!==PACK_TILES)throw new Error('Invalid day pyramid pack');
  const entries:[number,number][]=[];
  for(let i=0;i<PACK_TILES;i++)entries.push([view.getUint32(12+i*8,true),view.getUint32(16+i*8,true)]);
  return entries;
}

export function packMask(entries:[number,number][]){
  const mask=new Uint8Array(11);
  entries.forEach(([,length],i)=>{if(length)mask[i>>3]|=1<<(i&7);});
  return mask;
}

export function encodeIndex(packs:{id:number;mask:Uint8Array}[]){
  const out=new Uint8Array(INDEX_HEADER+packs.length*INDEX_ENTRY),view=new DataView(out.buffer);
  out.set([69,76,68,73],0);view.setUint8(4,1);view.setUint8(5,PACK_DEPTH);view.setUint16(6,540,true);view.setUint8(8,16);
  view.setUint32(12,packs.length,true);
  packs.forEach((pack,i)=>{view.setUint16(INDEX_HEADER+i*INDEX_ENTRY,pack.id,true);out.set(pack.mask,INDEX_HEADER+i*INDEX_ENTRY+2);});
  return out;
}

/** Map<day tile id, tile mask> from index.bin. */
export function decodeIndex(bytes:Uint8Array){
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(bytes.length<INDEX_HEADER||view.getUint32(0,true)!==0x49444c45||view.getUint8(4)!==1||view.getUint8(5)!==PACK_DEPTH||view.getUint16(6,true)!==540||view.getUint8(8)!==16)throw new Error('Invalid day pyramid index');
  const count=view.getUint32(12,true);
  if(bytes.length!==INDEX_HEADER+count*INDEX_ENTRY)throw new Error('Truncated day pyramid index');
  const packs=new Map<number,Uint8Array>();
  for(let i=0;i<count;i++){
    const at=INDEX_HEADER+i*INDEX_ENTRY,id=view.getUint16(at,true);
    if(id>=12800)throw new Error('Invalid day tile in index');
    packs.set(id,bytes.slice(at+2,at+13));
  }
  return packs;
}
