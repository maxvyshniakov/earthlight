// Co-registered regional study: photographic coverage + broad MODIS properties.
// Never turn the palette retrieval's missing pixels into holes in coverage.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import sharp from 'sharp';
const root='public/media/earthlight/modis-demo',date='2025-06-01',size=2048;
const manifest=JSON.parse(await readFile(root+'/manifest.json','utf8'));
const record=manifest.dates.find(d=>d.date===date);
const url=new URL(record.sources.color);url.searchParams.set('WIDTH',String(size));url.searchParams.set('HEIGHT',String(size));
const cache='/tmp/earthlight-modis-cache/'+date+'-color-2048.png';let photo;
try{photo=await readFile(cache);}catch{const r=await fetch(url);if(!r.ok)throw Error(String(r.status));photo=Buffer.from(await r.arrayBuffer());await writeFile(cache,photo);}
const rgb=await sharp(photo).ensureAlpha().raw().toBuffer();
const fields=await Promise.all(['low','middle','high'].map(name=>sharp(`${root}/${date}-${name}.png`).raw().toBuffer()));
// A weighted blur across all valid retrievals supplies broad properties, not
// three mutually exclusive cloud masks. This deliberately sacrifices vertical
// discontinuities the coarse daily product cannot resolve convincingly.
const weighted=Buffer.alloc(1024*1024*3);
for(let p=0;p<1024*1024;p++)for(const field of fields)if(field[p*4+3]){
 weighted[p*3]=field[p*4];weighted[p*3+1]=field[p*4+1];weighted[p*3+2]=255;
}
const blurred=await sharp(weighted,{raw:{width:1024,height:1024,channels:3}}).blur(64).resize(size,size).raw().toBuffer();
const packed=Buffer.alloc(size*size*4);let missing=0;
for(let p=0;p<size*size;p++){
 const i=p*4,j=p*3,confidence=blurred[j+2]/255;
 // Minimum RGB rejects the blue ocean; the remaining intensity is still an
 // illumination-dependent optical mask, not measured cloud fraction.
 const value=Math.min(rgb[i],rgb[i+1],rgb[i+2])/255;
 const cover=Math.max(0,Math.min(1,(value-.055)/.62));
 packed[i]=Math.round(cover*255);
 packed[i+1]=confidence>.01?Math.round(blurred[j]/confidence):40;
 packed[i+2]=confidence>.01?Math.round(blurred[j+1]/confidence):100;
 packed[i+3]=rgb[i+3];if(!rgb[i+3])missing++;
}
await mkdir(root,{recursive:true});
await sharp(packed,{raw:{width:size,height:size,channels:4}}).png().toFile(root+'/orbit-patch.png');
await writeFile(root+'/orbit-patch.json',JSON.stringify({date,bbox:manifest.bbox,size,source:url.href,properties:record.sources,encoding:'R: photo coverage; G: top / 16 km; B: log(1+tau)/log(151); A: photo validity',propertyFilter:'Normalized Gaussian sigma 64 source pixels (~75 km); across valid retrievals, no hard height classes. Unsupported properties fall back to 2.5 km / tau 6.1.',limits:'Coverage inherits photographic illumination. Bases, thickness and fine top relief are illustrative; no recovery of hidden lower clouds. Regional experiment, not a weather reconstruction.',missingPhotoPixels:missing},null,2)+'\n');
console.log({size,missing});
