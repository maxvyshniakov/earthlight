import sharp from 'sharp';
import {mkdir} from 'node:fs/promises';
const out='public/media/earthlight/preview';await mkdir(out,{recursive:true});
sharp.concurrency(2);
for(const [name,source,width] of [
 ['galaxy','milky-way-8k.avif',1024],['day','earth-day-bmng.avif',512],
 ['night','earth-night-8k.avif',1024],['clouds','earth-clouds-nasa-16384.avif',1024],
]){
 // Previews only. Final maps still come from their original source pipeline.
 await sharp('public/media/earthlight/'+source).resize(width,width/2).removeAlpha()
   .webp({quality:75,effort:5}).toFile(`${out}/${name}.webp`);
}
// The first light's cloud layer: under the loading defocus a 512-wide map is
// indistinguishable from the 1024 preview, at a fifth of its bytes.
await sharp('public/media/earthlight/earth-clouds-nasa-16384.avif').resize(512,256).removeAlpha().greyscale()
  .avif({quality:55,effort:9}).toFile(`${out}/clouds-512.avif`);
