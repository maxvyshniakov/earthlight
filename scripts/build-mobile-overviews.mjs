// Build 2K candidates from the original NASA plates, without recompressing AVIF.
// bun scripts/build-mobile-overviews.mjs /tmp/orbital-reference
import sharp from 'sharp';
import {mkdir,stat} from 'node:fs/promises';
import {join} from 'node:path';
const root=process.argv[2]||'/tmp/orbital-reference';
const out='public/media/orbit/mobile';await mkdir(out,{recursive:true});
// Rejected night/cloud candidates remain outside the published assets.
const candidates=process.argv[3]||'/tmp/orbit-mobile-candidates';await mkdir(candidates,{recursive:true});
sharp.concurrency(2);sharp.cache(false);
const encode={quality:65,effort:5,chromaSubsampling:'4:4:4',bitdepth:8};
const day=[];
for(let y=0;y<2;y++)for(let x=0;x<4;x++)day.push({
 input:await sharp(join(root,'day',`world.200410.3x21600x21600.${'ABCD'[x]}${y+1}.jpg`),{limitInputPixels:false}).resize(512,512).png().toBuffer(),left:x*512,top:y*512,
});
await sharp({create:{width:2048,height:1024,channels:3,background:'#000'}}).composite(day)
 .avif({...encode,quality:60}).toFile(join(out,'day-2048.avif'));
const clouds=[];
for(const [x,h] of ['W','E'].entries())clouds.push({
 input:await sharp(join(root,'clouds',`cloud.${h}.2001210.21600x21600.png`),{limitInputPixels:false}).resize(1024,1024).png().toBuffer(),left:x*1024,top:0,
});
await sharp({create:{width:2048,height:1024,channels:3,background:'#000'}}).composite(clouds)
 .greyscale().avif(encode).toFile(join(candidates,'clouds-2048.avif'));
// Same emission extraction as build-earth-maps.mjs, before downsampling.
const {data,info}=await sharp(join(root,'black-marble-2016-3km.jpg')).toColourspace('srgb').removeAlpha().raw().toBuffer({resolveWithObject:true});
const smooth=(lo,hi,v)=>{const t=Math.max(0,Math.min(1,(v-lo)/(hi-lo)));return t*t*(3-2*t);};
const emission=Buffer.alloc(info.width*info.height);
for(let i=0;i<emission.length;i++){
 const r=data[i*3]/255,g=data[i*3+1]/255,b=data[i*3+2]/255,peak=Math.max(r,g),l=.2126*r+.7152*g+.0722*b;
 emission[i]=Math.round(255*Math.max(0,l-.025)*Math.max(smooth(.025,.22,(peak-b)/Math.max(peak,.001)),smooth(.30,.65,l)));
}
await sharp(emission,{raw:{width:info.width,height:info.height,channels:1}}).resize(2048,1024)
 .avif(encode).toFile(join(candidates,'night-2048.avif'));
for(const name of ['day','night','clouds'])console.log(name,(await stat(join(name==='day'?out:candidates,`${name}-2048.avif`))).size);
