// Research preview ONLY: inverse palette lookup of quantized GIBS maps.
// Use raw Level-2 data and QA for runtime assets; this does not recover hidden layers.
import sharp from 'sharp';
import {readFile,writeFile} from 'node:fs/promises';
const [out]=process.argv.slice(2);if(!out)throw Error('Supply cloud-data directory');
async function palette(name){
 const url='https://gibs.earthdata.nasa.gov/colormaps/v1.3/'+name+'.xml';const response=await fetch(url);if(!response.ok)throw Error(response.status);
 const xml=await response.text();await writeFile(out+'/'+name+'.xml',xml);const map=new Map();
 for(const match of xml.matchAll(/<ColorMapEntry\s+([^>]+)\/>/g)){
  const a=Object.fromEntries([...match[1].matchAll(/(\w+)="([^"]*)"/g)].map(m=>[m[1],m[2]]));
  if(a.transparent==='true'||!a.value)continue;
  const range=a.value.match(/[-+]?\d+(?:\.\d+)?/g)?.map(Number);if(!range?.length)continue;
  const rgb=a.rgb.split(',').map(Number);map.set((rgb[0]<<16)|(rgb[1]<<8)|rgb[2],range.reduce((a,b)=>a+b,0)/range.length);
 }return map;
}
const heights=await palette('MODIS_VIIRS_Cloud_Top_Height'),thickness=await palette('MODIS_VIIRS_Cloud_Optical_Thickness');
const results=[];
for(const suffix of ['', '-later']){
 const h=await sharp(await readFile(out+'/height'+suffix+'.png')).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 const t=await sharp(await readFile(out+'/thickness'+suffix+'.png')).ensureAlpha().raw().toBuffer();
 const rgba=Buffer.alloc(h.info.width*h.info.height*4);let valid=0;
 for(let i=0;i<rgba.length;i+=4){
  if(h.data[i+3]!==255||t[i+3]!==255)continue;
  const height=heights.get((h.data[i]<<16)|(h.data[i+1]<<8)|h.data[i+2]),tau=thickness.get((t[i]<<16)|(t[i+1]<<8)|t[i+2]);
  if(height===undefined||tau===undefined)continue;
  const layer=height<3500?0:height<7000?1:2;
  rgba[i+layer]=Math.round(Math.log1p(tau)/Math.log(151)*255);rgba[i+3]=255;valid++;
 }
 await sharp(rgba,{raw:{width:h.info.width,height:h.info.height,channels:4}}).png().toFile(out+'/layers'+suffix+'.png');
 for(const [channel,name] of ['low','middle','high'].entries()){
  const gray=Buffer.alloc(h.info.width*h.info.height*4);
  for(let i=0;i<rgba.length;i+=4){gray[i]=gray[i+1]=gray[i+2]=rgba[i+channel];gray[i+3]=rgba[i+3];}
  await sharp(gray,{raw:{width:h.info.width,height:h.info.height,channels:4}}).png().toFile(out+'/'+name+suffix+'.png');
 }
 results.push({date:suffix?'2025-06-04':'2025-06-01',validPixels:valid,totalPixels:rgba.length/4,encoding:'RGB = low (<3.5 km), middle (<7 km), high cloud TOP; log1p(tau)/log(151). Alpha marks matched height AND optical thickness; missing is not clear sky.',limitation:'Quantized color-map preview; unmatched interpolated colors omitted; does not reconstruct overlapping layers or cloud genera. Not used by Orbit.'});
}
await writeFile(out+'/layer-preview.json',JSON.stringify(results,null,2));console.log(results);
