import {readdir,readFile,writeFile,mkdir,cp,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const source=join(root,'public/media/earthlight');
// preview/poster.webp, the explorer's static fallback, stays in the package
// for consumers that serve it.
const backgroundFiles=['preview/poster.webp','preview/day.webp','preview/night.webp','preview/clouds.webp','preview/clouds-512.avif','preview/galaxy.webp','mobile/day-2048.avif','mobile/galaxy-2048.avif','earth-night.avif','earth-clouds-nasa-4096.avif','stars-hyg-v2.bin','stars-hyg-m5-v2.bin','optical-psf-v3.bin'];
const excluded=new Set(['earth-day.avif','earth-day-8k.avif','earth-clouds.avif','earth-clouds-8k.avif','.DS_Store']);
async function walk(dir,prefix=''){
 const files=[];
 for(const entry of await readdir(dir,{withFileTypes:true})){
  const name=prefix+entry.name;
  // Regional prepared DEM fixtures are opt-in experiments, not release assets.
  // Publish a complete versioned dataset separately before including them.
  // Measured cloud properties (cloudStudy=global) are a one-day lab dataset,
  // and regional night tiles (nightDetail=vnp46) are lab data too. The day
  // pyramid (dayDetail=sentinel) ships as one pack per day tile plus its
  // index and provenance, never as loose tiles.
  if(name==='terrain-packed'||name==='cloud-properties'||name==='night-vnp46-tiles')continue;
  if(prefix==='day-pyramid/'&&!/^(\d+\.pack|index\.bin|provenance\.json|sources\.json)$/.test(entry.name))continue;
  if(entry.isDirectory())files.push(...await walk(join(dir,entry.name),name+'/'));
  else if(entry.isFile()&&!excluded.has(name)&&!name.split('/').some(part=>part.startsWith('.')))files.push(name);
 }
 return files.sort();
}
const files=[];
for(const path of await walk(source)){
 const bytes=await readFile(join(source,path));
 files.push({path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
}
// Background posters (scripts/render-posters.mjs) are numbered files under posters/.
const posters=files.filter(file=>/^posters\/\d+\.webp$/.test(file.path)).map(file=>file.path);
if(!posters.length)throw Error('Missing background posters. Run scripts/render-posters.mjs first.');
const background=[...backgroundFiles,...posters];
for(const path of background)if(!files.some(file=>file.path===path))throw Error(`Missing background asset: ${path}. Run bun run assets first.`);
const total=files.reduce((sum,file)=>sum+file.bytes,0);
if(total>=10e9)throw Error(`Release is ${(total/1e9).toFixed(2)} GB; it must stay under 10 GB.`);
// A partial day pyramid would ship tiles its index does not list, or the reverse.
const packs=files.filter(file=>/^day-pyramid\/\d+\.pack$/.test(file.path));
if(packs.length&&!files.some(file=>file.path==='day-pyramid/index.bin'))throw Error('Day pyramid packs without index.bin. Run scripts/build-day-pyramid.mjs index first.');
const version=createHash('sha256').update(JSON.stringify(files)).digest('hex').slice(0,16);
await writeFile(join(root,'assets-manifest.json'),JSON.stringify({schema:1,version,files,background},null,2)+'\n');
const destination=join(root,'assets/background');
await rm(destination,{recursive:true,force:true});await mkdir(destination,{recursive:true});
for(const path of [...background,...files.filter(file=>/\.(md|txt)$/.test(file.path)).map(file=>file.path)]){
 if(!files.some(file=>file.path===path))continue;
 await mkdir(dirname(join(destination,path)),{recursive:true});await cp(join(source,path),join(destination,path));
}
console.log(`Assets ${version}: ${files.length} files, ${(total/2**30).toFixed(2)} GiB (day pyramid ${packs.length} packs); background ${background.reduce((sum,path)=>sum+files.find(file=>file.path===path).bytes,0)} bytes.`);
