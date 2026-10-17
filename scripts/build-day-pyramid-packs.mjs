// Release packs of the day pyramid (docs/lab/day-pyramid-global-2026-10-17.md,
// "Whole packs"):
// repacks the builder's day tile packs (scripts/build-day-pyramid.mjs, one
// per day tile with all three levels) into single-level packs that the media
// host serves whole, without re-reading Sentinel-2 or re-encoding a tile.
//
//   bun scripts/build-day-pyramid-packs.mjs repack <day-tile-packs> <output> [--merge=900000]
//   bun scripts/build-day-pyramid-packs.mjs verify <day-tile-packs> <output>
//
// Layout (src/scripts/day-pyramid-pack.ts): a pack is an aligned block of
// 2^k × 2^k tiles of one level. Blocks start at one day tile for levels 2
// and 3 (16 and 64 tiles) and at 2 × 2 day tiles for level 1 (16 tiles),
// and four sibling blocks merge into one while the merged pack stays within
// --merge bytes, up to 2^5 tiles a side, so sparse land (snow, desert edges,
// coasts) does not spend the host's file budget on small packs. index.bin
// records each day tile's mask and block size per level.
//
// `repack` writes <output>/<level>/<x>-<y>.pack, index.bin, provenance.json
// (the builder's, plus the layout) and sources.json, then runs `verify`:
// every tile of every day tile pack must be in exactly one release pack with
// the same SHA-256, and no release pack may hold anything else.
import { mkdir, readFile, readdir, rm, writeFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { decodeDayPack, decodeIndex, decodePackHeader, DAY_SLOTS, encodeIndex, encodePack, MAX_PACK_K, packOf, slotMask, slotTile, PACK_DEPTH } from '../src/scripts/day-pyramid-pack.ts';

const COLUMNS=160,ROWS=80;
/** Smallest block per level (log2 tiles a side) and the largest merge. */
export const BASE_K=[2,2,3],MAX_K=MAX_PACK_K;
const REGION=1<<MAX_K-1; // day tiles a side under one level-1 root block (16)
const option=(name,fallback)=>process.argv.find(a=>a.startsWith(`--${name}=`))?.split('=')[1]??fallback;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

async function dayPacks(dir){
  return new Set((await readdir(dir)).filter(n=>/^\d+\.pack$/.test(n)).map(n=>Number(n.slice(0,-5))));
}

/** Tiles of the day tile packs under one root region: Map<level, Map<"x,y", bytes>> in global tile coordinates. */
async function regionTiles(dir,ids,rx,ry){
  const tiles=[null,new Map(),new Map(),new Map()],masks=new Map();
  for(let ty=ry*REGION;ty<(ry+1)*REGION;ty++)for(let tx=rx*REGION;tx<(rx+1)*REGION;tx++){
    const id=ty*COLUMNS+tx;if(!ids.has(id))continue;
    const file=new Uint8Array(await readFile(join(dir,`${id}.pack`))),entries=decodeDayPack(file);
    entries.forEach(([offset,length],slot)=>{
      if(!length)return;
      if(offset+length>file.length)throw new Error(`Day tile pack ${id} is truncated`);
      const {level,x,y}=slotTile(slot),side=1<<level;
      tiles[level].set(`${tx*side+x},${ty*side+y}`,file.subarray(offset,offset+length));
    });
    masks.set(id,slotMask(entries));
  }
  return {tiles,masks};
}

/** Blocks of one level inside a root block: split while over `merge` bytes, down to BASE_K. */
function planLevel(level,tiles,rx,ry,merge,visit){
  const bytesIn=(k,bx,by)=>{let sum=0;for(let y=by<<k;y<(by+1)<<k;y++)for(let x=bx<<k;x<(bx+1)<<k;x++)sum+=tiles.get(`${x},${y}`)?.length??0;return sum;};
  const split=(k,bx,by)=>{
    const bytes=bytesIn(k,bx,by);
    if(!bytes)return;
    if(k>BASE_K[level-1]&&bytes>merge){for(let q=0;q<4;q++)split(k-1,bx*2+(q&1),by*2+(q>>1));return;}
    visit(k,bx,by);
  };
  // Root blocks of 2^MAX_K tiles inside this region.
  const roots=REGION<<level>>MAX_K;
  for(let j=0;j<roots;j++)for(let i=0;i<roots;i++)split(MAX_K,rx*roots+i,ry*roots+j);
}

export async function repack(input,output,merge){
  const ids=await dayPacks(input);
  if(!ids.size)throw new Error(`No day tile packs in ${input}`);
  await rm(output,{recursive:true,force:true});
  for(let level=1;level<=PACK_DEPTH;level++)await mkdir(join(output,String(level)),{recursive:true});
  const entries=new Map(),stats={files:[0,0,0,0],bytes:[0,0,0,0],tiles:[0,0,0,0],largest:0};
  for(let ry=0;ry<ROWS/REGION;ry++)for(let rx=0;rx<COLUMNS/REGION;rx++){
    const {tiles,masks}=await regionTiles(input,ids,rx,ry);
    for(const [id,mask] of masks)entries.set(id,{id,mask,k:Uint8Array.from(BASE_K)});
    for(let level=1;level<=PACK_DEPTH;level++){
      const writes=[];
      planLevel(level,tiles[level],rx,ry,merge,(k,bx,by)=>{
        const x0=bx<<k,y0=by<<k,slots=new Map();
        for(let y=y0;y<y0+(1<<k);y++)for(let x=x0;x<x0+(1<<k);x++){const bytes=tiles[level].get(`${x},${y}`);if(bytes)slots.set(((y-y0)<<k)+x-x0,bytes);}
        const pack=encodePack(level,k,x0,y0,slots);
        writes.push(writeFile(join(output,packOf(level,x0,y0,k).path),pack));
        stats.files[level]++;stats.bytes[level]+=pack.length;stats.tiles[level]+=slots.size;stats.largest=Math.max(stats.largest,pack.length);
        // Every day tile under the block records its size.
        const span=Math.max(1,1<<k-level);
        for(let ty=y0>>level;ty<(y0>>level)+span;ty++)for(let tx=x0>>level;tx<(x0>>level)+span;tx++){const entry=entries.get(ty*COLUMNS+tx);if(entry)entry.k[level-1]=k;}
      });
      await Promise.all(writes);
    }
  }
  const list=[...entries.values()].sort((a,b)=>a.id-b.id);
  await writeFile(join(output,'index.bin'),encodeIndex(list));
  const files=stats.files.reduce((a,b)=>a+b,0),bytes=stats.bytes.reduce((a,b)=>a+b,0);
  const check=await verify(input,output);
  const provenance=JSON.parse(await readFile(join(input,'provenance.json'),'utf8'));
  await copyFile(join(input,'sources.json'),join(output,'sources.json'));
  Object.assign(provenance,{
    version:2,format:'AVIF 4:4:4 8-bit, effort 2; packs and index: src/scripts/day-pyramid-pack.ts',
    packs:files,bytes,
    layout:{description:`Single-level packs of 2^k × 2^k tiles, fetched whole. Smallest blocks: level 1 2 × 2 day tiles, levels 2 and 3 one day tile; four siblings merge while the pack stays within ${merge} bytes, up to ${1<<MAX_K} tiles a side. See docs/lab/day-pyramid-global-2026-10-17.md, "Whole packs".`,
      baseK:BASE_K,maxK:MAX_K,mergeBytes:merge,files:{1:stats.files[1],2:stats.files[2],3:stats.files[3]},bytes:{1:stats.bytes[1],2:stats.bytes[2],3:stats.bytes[3]},largest:stats.largest,
      repackedFrom:{dayTilePacks:ids.size,tilesSha256:check.digest}},
  });
  await writeFile(join(output,'provenance.json'),JSON.stringify(provenance,null,1)+'\n');
  console.log(`repack: ${files} packs (${stats.files.slice(1).join(' / ')} at levels 1–3) + index.bin for ${list.length} day tiles, ${stats.tiles.slice(1).join(' / ')} tiles, ${(bytes/2**30).toFixed(3)} GiB, largest ${(stats.largest/2**20).toFixed(2)} MiB`);
}

/** Every tile of the day tile packs, byte-identical in exactly one release pack. */
export async function verify(input,output){
  const ids=await dayPacks(input),index=decodeIndex(new Uint8Array(await readFile(join(output,'index.bin'))));
  // Release side: sha256 per tile, keyed by level and global position.
  const release=new Map();let packs=0;
  for(let level=1;level<=PACK_DEPTH;level++)for(const name of await readdir(join(output,String(level)))){
    const file=new Uint8Array(await readFile(join(output,String(level),name))),header=decodePackHeader(file);
    if(!header||header.level!==level||`${header.x}-${header.y}.pack`!==name||header.bytes!==file.length)throw new Error(`Invalid release pack ${level}/${name}`);
    header.entries.forEach(([offset,length],slot)=>{
      if(!length)return;
      const x=header.x+(slot&(1<<header.k)-1),y=header.y+(slot>>header.k),key=`${level}/${x},${y}`;
      if(release.has(key))throw new Error(`Tile ${key} is in two packs`);
      // The index must point this tile at this pack.
      const entry=index.get((y>>level)*COLUMNS+(x>>level));
      if(!entry||packOf(level,x,y,entry.k[level-1]).path!==`${level}/${name}`)throw new Error(`Index does not lead to ${key}`);
      release.set(key,sha(file.subarray(offset,offset+length)));
    });
    packs++;
  }
  // Source side, in canonical order (day tile id, then day slot).
  const digest=createHash('sha256');let tiles=0;
  for(const id of [...ids].sort((a,b)=>a-b)){
    const file=new Uint8Array(await readFile(join(input,`${id}.pack`))),entries=decodeDayPack(file),tx=id%COLUMNS,ty=Math.floor(id/COLUMNS);
    const mask=index.get(id)?.mask;
    if(!mask||slotMask(entries).some((v,i)=>v!==mask[i]))throw new Error(`Index mask differs for day tile ${id}`);
    for(let slot=0;slot<DAY_SLOTS;slot++){
      const [offset,length]=entries[slot];if(!length)continue;
      const {level,x,y}=slotTile(slot),side=1<<level,key=`${level}/${tx*side+x},${ty*side+y}`,hash=sha(file.subarray(offset,offset+length));
      if(release.get(key)!==hash)throw new Error(`Tile ${key} of day tile ${id} differs in the release`);
      release.delete(key);digest.update(`${key} ${hash}\n`);tiles++;
    }
  }
  if(release.size)throw new Error(`${release.size} release tiles have no source, such as ${release.keys().next().value}`);
  if(index.size!==ids.size)throw new Error('Index and day tile packs list different day tiles');
  const result={tiles,packs,dayTiles:ids.size,digest:digest.digest('hex')};
  console.log(`verify: ${tiles} tiles byte-identical in ${packs} release packs; tiles sha256 ${result.digest}`);
  return result;
}

if(import.meta.main){
  const [command,input,output]=process.argv.slice(2).filter(a=>!a.startsWith('--'));
  if(command==='repack'&&input&&output)await repack(input,output,Number(option('merge',900000)));
  else if(command==='verify'&&input&&output)await verify(input,output);
  else throw new Error('Usage: build-day-pyramid-packs.mjs repack|verify <day-tile-packs> <output> [--merge=bytes]');
}
