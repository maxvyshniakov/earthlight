import sharp from 'sharp';
import {mkdir} from 'node:fs/promises';
const out='public/media/orbit/preview';await mkdir(out,{recursive:true});
sharp.concurrency(2);
for(const [name,source,width] of [
 ['galaxy','milky-way-8k.avif',1024],['day','earth-day-bmng.avif',512],
 ['night','earth-night-8k.avif',1024],['clouds','earth-clouds-nasa-16384.avif',1024],
]){
 // Previews only. Final maps still come from their original source pipeline.
 await sharp('public/media/orbit/'+source).resize(width,width/2).removeAlpha()
   .webp({quality:75,effort:5}).toFile(`${out}/${name}.webp`);
}
