// Lossless references reconstructed from the NASA source plates, not AVIFs.
// bun scripts/benchmark-scene-maps.mjs [/tmp/orbital-reference] [/tmp/orbit-optimization]
import sharp from 'sharp';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const [root='/tmp/orbital-reference',out='/tmp/orbit-optimization']=process.argv.slice(2);
sharp.concurrency(2);sharp.cache(false);await mkdir(out,{recursive:true});
const rows=[];
const metrics=(a,b,w,ch)=>{
 let squared=0,edge=0,count=0;
 for(let i=0;i<a.length;i++){squared+=(a[i]-b[i])**2;if(i>=w*ch){edge+=Math.abs((a[i]-a[i-w*ch])-(b[i]-b[i-w*ch]));count++;}}
 return {psnr:10*Math.log10(255**2/(squared/a.length)),edgeError:edge/count};
};
for(const [kind,source,width] of [
 ['clouds',join(root,'clouds/cloud.E.2001210.21600x21600.png'),8192],
 ['land',join(root,'day/world.200410.3x21600x21600.C1.jpg'),1024],
]){
 const reference=await sharp(source,{limitInputPixels:false}).resize(width,width).removeAlpha().png().toBuffer();
 if(kind==='clouds')await writeFile(join(out,'cloud-east-reference.png'),reference);
 for(const [index,left,top] of [[0,0,0],[1,Math.floor((width-768)*.55),Math.floor((width-768)*.65)],[2,width-768,width-768]]){
  const crop=await sharp(reference).extract({left,top,width:768,height:768}).png().toBuffer();
  const raw=await sharp(crop).removeAlpha().raw().toBuffer({resolveWithObject:true});
  for(const [format,q] of [['avif',45],['avif',50],['avif',55],['avif',60],['avif',65],['webp',85],['webp',95],['png',0]]){
   let pipeline=sharp(crop).removeAlpha();
   if(kind==='clouds')pipeline=pipeline.greyscale();
   const encoded=await pipeline[format](format==='avif'?{quality:q,effort:6,chromaSubsampling:'4:4:4'}:format==='webp'?{quality:q,effort:5}:{compressionLevel:9}).toBuffer();
   const decoded=await sharp(encoded).toColourspace('srgb').removeAlpha().raw().toBuffer();
   rows.push({kind,index,format,q,bytes:encoded.length,...metrics(raw.data,decoded,768,3)});
  }
 }
}
await writeFile(join(out,'map-codecs.json'),JSON.stringify(rows,null,2));
console.log(JSON.stringify(rows,null,2));
