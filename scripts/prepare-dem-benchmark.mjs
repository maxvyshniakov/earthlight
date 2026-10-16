import {readFile,readdir,writeFile} from 'node:fs/promises';
// Local-only fixture, deliberately in ignored dist, never part of publication.
const manifest=JSON.parse(await readFile('dist/media/earthlight/terrain-packed/v1/manifest.json','utf8'));
const scripts=await readdir('dist/_astro'),worker=prefix=>{
 const found=scripts.filter(name=>name.startsWith(prefix)&&name.endsWith('.js'));
 if(found.length!==1)throw Error('Build first; ambiguous/missing worker '+prefix);
 return '/_astro/'+found[0];
};
const files=manifest.files.filter((_,i)=>i%8===0).slice(0,6);
await writeFile('dist/media/earthlight/terrain-packed/v1/benchmark.json',JSON.stringify({files,workers:{tiff:worker('terrain-detail.worker-'),packed:worker('terrain-packed.worker-')}},null,2)+'\n');
console.log('Prepared',files.length,'matched inputs');

await writeFile('dist/media/earthlight/terrain-packed/v1/benchmark.html','<!doctype html><meta charset="utf-8"><title>DEM decoder benchmark</title>');
