// Read the overviews of ESA WorldCover 2021 v200 for one day-pyramid region
// with HTTP range requests (docs/lab/day-pyramid-global-2026-10-17.md).
//
//   bun scripts/fetch-worldcover.mjs inventory <sources-dir>
//   bun scripts/fetch-worldcover.mjs fetch <sources-dir> <row> [--jobs=16]
//
// `inventory` lists both public buckets once (key, size, ETag). `fetch` reads,
// for every 1° Sentinel-2 RGBNIR file and every 3° land-cover map that one
// row of day tiles needs (2.25° plus gutters), only the compressed tiles of
// one internal overview: the S2RGBNIR's 1500 px overview (2.4″, about 72 m)
// and the map's 2250 px overview (4.8″, about 144 m). Neither file is ever
// downloaded whole. Each overview is stored as its compressed tile bytes plus
// the tile layout; scripts/build-day-pyramid.mjs decodes them and deletes them
// when the rows that need them are built. Every request is logged with its
// key, ETag, byte range and length in <sources-dir>/ledger.jsonl.
//
// Both overviews are nearest-neighbour decimations: sample k of the 1500 px
// overview is full-resolution pixel 8k (checked against the 0.3″ level), so a
// sample sits 1/16 of an overview pixel from the cell's corner, not at the
// overview pixel's centre. The builder places samples accordingly.
import { mkdir, readFile, writeFile, appendFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

export const S2_BUCKET='https://esa-worldcover-s2.s3.eu-central-1.amazonaws.com/';
export const MAP_BUCKET='https://esa-worldcover.s3.eu-central-1.amazonaws.com/';
export const S2_PREFIX='rgbnir/2021/',MAP_PREFIX='v200/2021/map/';
export const S2_OVERVIEW=1500,MAP_OVERVIEW=2250; // pixels per 1° S2 file, per 3° map file
const ROW_DEGREES=2.25,MARGIN=.1; // 16 level-0 gutter texels are 0.067°

const lat=(v)=>(v<0?'S':'N')+String(Math.abs(v)).padStart(2,'0');
const lon=(v)=>(v<0?'W':'E')+String(Math.abs(v)).padStart(3,'0');
export const s2Key=(south,west)=>`${S2_PREFIX}${lat(south)}/ESA_WorldCover_10m_2021_v200_${lat(south)}${lon(west)}_S2RGBNIR.tif`;
export const mapKey=(south,west)=>`${MAP_PREFIX}ESA_WorldCover_10m_2021_v200_${lat(south)}${lon(west)}_Map.tif`;
export const cellName=key=>key.split('/').at(-1).replace(/\.tif$/,'');

/** South-west corners of the 1° S2 files and 3° map files a day-tile row needs. */
export function rowCells(row){
  const north=90-row*ROW_DEGREES+MARGIN,south=90-(row+1)*ROW_DEGREES-MARGIN;
  const s2=[],map=[];
  for(let s=Math.floor(south);s<north;s++)for(let w=-180;w<180;w++)s2.push([s,w]);
  for(let s=Math.floor(south/3)*3;s<north;s+=3)for(let w=-180;w<180;w+=3)map.push([s,w]);
  return {s2,map};
}

async function retry(task,label){
  for(let attempt=0;;attempt++){
    try{return await task();}
    catch(error){if(attempt>=5)throw new Error(`${label}: ${error.message}`);await new Promise(r=>setTimeout(r,1000*2**attempt));}
  }
}
async function range(url,start,end){
  return retry(async()=>{
    const response=await fetch(url,{headers:{Range:`bytes=${start}-${end-1}`},signal:AbortSignal.timeout(120000)});
    if(response.status!==206)throw new Error(`HTTP ${response.status}`);
    const bytes=new Uint8Array(await response.arrayBuffer());
    if(bytes.length!==end-start)throw new Error(`short read ${bytes.length}/${end-start}`);
    return {bytes,etag:response.headers.get('etag')};
  },`${url} ${start}-${end}`);
}

/** Minimal classic-TIFF IFD reader: the tags a tiled COG overview needs. */
export function readIfds(header){
  const view=new DataView(header.buffer,header.byteOffset,header.byteLength);
  if(view.getUint16(0)!==0x4949||view.getUint16(2,true)!==42)throw new Error('Expected a little-endian classic TIFF');
  const ifds=[];
  for(let offset=view.getUint32(4,true);offset;){
    if(offset+2>header.length)throw new Error('IFD beyond header');
    const count=view.getUint16(offset,true),tags={};
    if(offset+2+count*12+4>header.length)throw new Error('IFD beyond header');
    for(let i=0;i<count;i++){
      const e=offset+2+i*12,tag=view.getUint16(e,true),type=view.getUint16(e+2,true),n=view.getUint32(e+4,true);
      const size={1:1,3:2,4:4,16:8}[type]??0,inline=size*n<=4,at=inline?e+8:view.getUint32(e+8,true);
      if(!size)continue;
      if(at+size*n>header.length)throw new Error('Tag beyond header');
      const values=[];
      for(let k=0;k<n;k++)values.push(type===1?view.getUint8(at+k):type===3?view.getUint16(at+2*k,true):type===4?view.getUint32(at+4*k,true):Number(view.getBigUint64(at+8*k,true)));
      tags[tag]=values;
    }
    ifds.push({width:tags[256][0],height:tags[257][0],tileWidth:tags[322]?.[0],tileHeight:tags[323]?.[0],samples:tags[277]?.[0]??1,bits:tags[258]?.[0]??8,compression:tags[259]?.[0]??1,predictor:tags[317]?.[0]??1,planar:tags[284]?.[0]??1,offsets:tags[324],counts:tags[325]});
    offset=view.getUint32(offset+2+count*12,true);
  }
  return ifds;
}

/** The overview of `width` px: its compressed tiles in one contiguous range. */
async function readOverview(url,width,known){
  let header=(await range(url,0,65536)).bytes,ifds;
  for(let size=65536;;size*=4){
    try{ifds=readIfds(header);break;}
    catch(error){if(size>=4194304)throw error;header=(await range(url,0,size*4)).bytes;}
  }
  const ifd=ifds.find(entry=>entry.width===width);
  if(!ifd||!ifd.offsets)throw new Error(`${url}: no ${width} px overview`);
  const start=Math.min(...ifd.offsets),end=Math.max(...ifd.offsets.map((o,i)=>o+ifd.counts[i]));
  const {bytes,etag}=await range(url,start,end);
  if(known&&etag&&etag!==known)throw new Error(`${url}: ETag changed (${etag} ≠ ${known})`);
  const {offsets,counts,...layout}=ifd;
  return {layout:{...layout,offsets:offsets.map(o=>o-start),counts},bytes,read:header.length+bytes.length,etag,range:[start,end]};
}

async function list(bucket,prefix){
  const items=[];let token='';
  do{
    const url=`${bucket}?list-type=2&prefix=${encodeURIComponent(prefix)}${token?`&continuation-token=${encodeURIComponent(token)}`:''}`;
    const xml=await retry(async()=>{const r=await fetch(url);if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.text();},url);
    for(const [,body] of xml.matchAll(/<Contents>(.*?)<\/Contents>/gs)){
      const field=name=>body.match(new RegExp(`<${name}>(.*?)</${name}>`))?.[1];
      items.push({key:field('Key'),bytes:Number(field('Size')),etag:field('ETag').replaceAll('&quot;','"'),lastModified:field('LastModified')});
    }
    token=xml.match(/<NextContinuationToken>(.*?)<\/NextContinuationToken>/)?.[1]??'';
  }while(token);
  return items.filter(item=>item.key.endsWith('.tif'));
}

export async function loadInventory(dir){return JSON.parse(await readFile(join(dir,'inventory.json'),'utf8'));}

async function inventory(dir){
  await mkdir(dir,{recursive:true});
  const [s2,map]=await Promise.all([list(S2_BUCKET,S2_PREFIX),list(MAP_BUCKET,MAP_PREFIX)]);
  const data={accessed:new Date().toISOString(),s2:{bucket:S2_BUCKET,files:s2},map:{bucket:MAP_BUCKET,files:map}};
  await writeFile(join(dir,'inventory.json'),JSON.stringify(data));
  console.log(`${s2.length} S2RGBNIR files (${(s2.reduce((s,f)=>s+f.bytes,0)/2**40).toFixed(2)} TiB), ${map.length} map files`);
}

const exists=path=>stat(path).then(()=>true,()=>false);

async function fetchRow(dir,row,jobs,[west,east]=[-180,180]){
  const inv=await loadInventory(dir);
  const s2=new Map(inv.s2.files.map(f=>[f.key,f])),map=new Map(inv.map.files.map(f=>[f.key,f]));
  const cells=rowCells(row);
  // --lon=west,east limits a trial to some columns (whole cells overlapping it).
  cells.s2=cells.s2.filter(([,w])=>w+1>west&&w<east);cells.map=cells.map.filter(([,w])=>w+3>west&&w<east);
  const wanted=[...cells.s2.map(([s,w])=>[S2_BUCKET,s2.get(s2Key(s,w)),S2_OVERVIEW]),...cells.map.map(([s,w])=>[MAP_BUCKET,map.get(mapKey(s,w)),MAP_OVERVIEW])].filter(([,file])=>file);
  await mkdir(join(dir,'cells'),{recursive:true});
  let done=0,read=0;const started=performance.now();
  const queue=[...wanted];
  async function worker(){
    for(let item;(item=queue.shift());){
      const [bucket,file,width]=item,name=cellName(file.key),path=join(dir,'cells',name+'.ov');
      if(!await exists(path+'.json')){
        const overview=await readOverview(bucket+file.key,width,file.etag);
        await writeFile(path,overview.bytes);
        await writeFile(path+'.json',JSON.stringify({key:file.key,etag:overview.etag,range:overview.range,layout:overview.layout}));
        await appendFile(join(dir,'ledger.jsonl'),JSON.stringify({key:file.key,etag:overview.etag,range:overview.range,read:overview.read,row})+'\n');
        read+=overview.read;
      }
      done++;
    }
  }
  await Promise.all(Array.from({length:jobs},worker));
  const seconds=(performance.now()-started)/1000;
  console.log(`row ${row}: ${done} overviews, ${(read/2**20).toFixed(0)} MiB read in ${seconds.toFixed(0)} s (${(read/2**20/Math.max(1,seconds)).toFixed(1)} MiB/s)`);
}

if(import.meta.main){
  const [command,dir,row]=process.argv.slice(2).filter(a=>!a.startsWith('--'));
  const jobs=Number(process.argv.find(a=>a.startsWith('--jobs='))?.split('=')[1]??16);
  if(command==='inventory'&&dir)await inventory(dir);
  const lons=process.argv.find(a=>a.startsWith('--lon='))?.split('=')[1].split(',').map(Number);
  if(command==='fetch'&&dir&&row!==undefined)await fetchRow(dir,Number(row),jobs,lons);
  else if(command!=='inventory'||!dir)throw new Error('Usage: fetch-worldcover.mjs inventory <dir> | fetch <dir> <row> [--jobs=16]');
}
