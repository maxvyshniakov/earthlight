import {readdir,readFile,writeFile,mkdir,cp,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const source=join(root,'public/media/orbit');
const background=['preview/poster.webp','preview/day.webp','preview/night.webp','preview/clouds.webp','preview/galaxy.webp','mobile/day-2048.avif','mobile/galaxy-2048.avif','earth-night.avif','earth-clouds-nasa-4096.avif','stars-hyg.bin','optical-psf.bin'];
const excluded=new Set(['earth-day.avif','earth-day-8k.avif','earth-clouds.avif','earth-clouds-8k.avif','.DS_Store']);
async function walk(dir,prefix=''){
 const files=[];
 for(const entry of await readdir(dir,{withFileTypes:true})){
  const name=prefix+entry.name;
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
for(const path of background)if(!files.some(file=>file.path===path))throw Error(`Missing background asset: ${path}. Run bun run assets first.`);
const version=createHash('sha256').update(JSON.stringify(files)).digest('hex').slice(0,16);
await writeFile(join(root,'assets-manifest.json'),JSON.stringify({schema:1,version,files,background},null,2)+'\n');
const destination=join(root,'assets/background');
await rm(destination,{recursive:true,force:true});await mkdir(destination,{recursive:true});
for(const path of [...background,...files.filter(file=>/\.(md|txt)$/.test(file.path)).map(file=>file.path)]){
 if(!files.some(file=>file.path===path))continue;
 await mkdir(dirname(join(destination,path)),{recursive:true});await cp(join(source,path),join(destination,path));
}
console.log(`Assets ${version}: ${files.length} files; background ${background.reduce((sum,path)=>sum+files.find(file=>file.path===path).bytes,0)} bytes.`);
