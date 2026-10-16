// Generate only an explicitly selected region. Never download the world implicitly.
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {parseArgs} from 'node:util';
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {fromArrayBuffer} from 'geotiff';
import {packTerrainPatch,terrainSourceName} from '../src/scripts/terrain-detail.ts';
import {packTerrainParent,DEM_PACKED_VERSION} from '../src/scripts/terrain-packed.ts';
import {terrainSource} from '../server/terrain-source.mjs';
const {values}=parseArgs({options:{'ids-file':{type:'string'},output:{type:'string',default:'public/media/earthlight/terrain-packed/v1'},cache:{type:'string',default:'.media/dem90'}}});
if(!values['ids-file'])throw Error('Pass --ids-file with an explicit JSON array of Copernicus parent IDs (0..64799)');
const ids=JSON.parse(await readFile(values['ids-file'],'utf8'));
if(!Array.isArray(ids)||!ids.length||ids.some(id=>!Number.isInteger(id)||id<0||id>=64800))throw Error('Invalid parent IDs');
const output=resolve(values.output),cache=resolve(values.cache),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
await mkdir(output,{recursive:true});await mkdir(cache,{recursive:true});
let previous;try{previous=JSON.parse(await readFile(join(output,'manifest.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
if(previous&&previous.version!==DEM_PACKED_VERSION)throw Error('Incompatible packed terrain manifest');
const entries=new Map((previous?.files??[]).map(file=>[file.id,file]));
const atomic=async(path,bytes)=>{const temp=path+'.'+process.pid+'.tmp';await writeFile(temp,bytes);await rename(temp,path);};
for(const id of [...new Set(ids)].sort((a,b)=>a-b)){
 const name=terrainSourceName(id),source=terrainSource('/media/earthlight/dem90/'+name+'.tif'),cached=join(cache,name+'.tif');
 let bytes;try{bytes=await readFile(cached);}catch(error){
  if(error.code!=='ENOENT')throw error;
  const response=await fetch(source,{signal:AbortSignal.timeout(60000)});if(!response.ok)throw Error(`DEM ${name}: HTTP ${response.status}`);
  bytes=Buffer.from(await response.arrayBuffer());if(!bytes.length||bytes.length>16*1024*1024)throw Error('Invalid TIFF size');await atomic(cached,bytes);
 }
 const started=performance.now(),image=await(await fromArrayBuffer(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength))).getImage();
 const width=image.getWidth(),height=image.getHeight();if(width<2||width>1200||height!==1200||image.getSamplesPerPixel()!==1)throw Error('Invalid GLO-90 dimensions');
 const raster=await image.readRasters({interleave:true}),patches=[];
 for(let y=0;y<2;y++)for(let x=0;x<2;x++)patches.push(packTerrainPatch(raster,width,height,x,y));
 const packed=packTerrainParent(id,patches),compressed=gzipSync(packed,{level:9});
 if(!Buffer.from(packed).equals(gunzipSync(compressed)))throw Error('Lossless verification failed');
 await atomic(join(output,name+'.dem'),compressed);
 entries.set(id,{id,name,source,sourceBytes:bytes.length,sourceSha256:hash(bytes),bytes:compressed.length,sha256:hash(compressed),decodedSha256:hash(packed)});
 console.log(`${name}: ${bytes.length} → ${compressed.length} bytes, ${Math.round(performance.now()-started)} ms; exact round trip`);
 const files=[...entries.values()].sort((a,b)=>a.id-b.id);
 await atomic(join(output,'manifest.json'),JSON.stringify({version:DEM_PACKED_VERSION,format:'gzip of ELDEM001 header and four unchanged RGBA atlas patches',provenance:'Copernicus DEM GLO-90 / WorldDEM-90; see ../../README.md and the repository asset provenance',files},null,2)+'\n');
}
