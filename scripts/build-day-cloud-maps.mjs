// NASA BMNG October 2004 and the Blue Marble cloud composite (day 210, 2001).
// Originals are external build inputs; no enlarged detail or generated imagery.
import sharp from 'sharp';
import {join} from 'node:path';
const root=process.argv[2]||'/tmp/orbital-reference';
sharp.concurrency(2);sharp.cache(false);
const output='public/media/orbit';
// A 4K overview covers the whole globe; 500 m detail streams separately.
const plates=[];
for(let y=0;y<2;y++)for(let x=0;x<4;x++)plates.push({
 input:await sharp(join(root,'day',`world.200410.3x21600x21600.${'ABCD'[x]}${y+1}.jpg`),{limitInputPixels:false}).resize(1024,1024).png().toBuffer(),left:x*1024,top:y*1024,
});
await sharp({create:{width:4096,height:2048,channels:3,background:'#000'}}).composite(plates).avif({quality:60,effort:4,chromaSubsampling:'4:4:4'}).toFile(join(output,'earth-day-bmng.avif'));
for(const width of [4096,8192,16384]){
 const half=width/2;
 const parts=[];
 for(const [x,h] of ['W','E'].entries())parts.push({input:await sharp(join(root,'clouds',`cloud.${h}.2001210.21600x21600.png`),{limitInputPixels:false}).resize(half,half).png().toBuffer(),left:x*half,top:0});
 const path=join(output,`earth-clouds-nasa-${width}.avif`);
 await sharp({create:{width,height:half,channels:3,background:'#000'}}).composite(parts).greyscale().avif({quality:55,effort:4,chromaSubsampling:'4:4:4'}).toFile(path);
 console.log(path);
}
