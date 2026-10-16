// Reproducible research assets from quantized NASA GIBS maps, not raw Level-2.
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import sharp from 'sharp';
const out='public/media/earthlight/modis-demo',cache='/tmp/earthlight-modis-cache';
await mkdir(out,{recursive:true});await mkdir(cache,{recursive:true});
const bbox=[-91,-32,-79,-20],size=1024,dates=['2025-06-01','2025-06-02','2025-06-03'];
async function download(url,file){try{return await readFile(file);}catch{}
 const r=await fetch(url);if(!r.ok)throw Error(`${r.status}: ${url}`);const b=Buffer.from(await r.arrayBuffer());await writeFile(file,b);return b;}
async function palette(name){
 const xml=String(await download(`https://gibs.earthdata.nasa.gov/colormaps/v1.3/${name}.xml`,cache+'/'+name+'.xml'));
 const map=new Map();for(const match of xml.matchAll(/<ColorMapEntry\s+([^>]+)\/>/g)){
  const a=Object.fromEntries([...match[1].matchAll(/(\w+)="([^"]*)"/g)].map(m=>[m[1],m[2]]));
  if(a.transparent==='true'||!a.value)continue;
  const values=a.value.match(/[-+]?\d+(?:\.\d+)?/g)?.map(Number);if(!values?.length)continue;
  map.set(a.rgb.split(',').map(Number).join(','),values.reduce((a,b)=>a+b,0)/values.length);
 }return map;
}
const heightMap=await palette('MODIS_VIIRS_Cloud_Top_Height'),tauMap=await palette('MODIS_VIIRS_Cloud_Optical_Thickness'),fractionMap=await palette('MODIS_Cloud_Fraction');
const layers={color:'CorrectedReflectance_TrueColor',height:'Cloud_Top_Height_Day',tau:'Cloud_Optical_Thickness',phase:'Cloud_Phase_Optical_Properties',fraction:'Cloud_Fraction_Day'};
const manifest={source:'NASA GIBS / Aqua MODIS',bbox,size,extentKm:[12*111.195*Math.cos(26*Math.PI/180),12*111.195],encoding:'R: top/16km; G: log(1+tau)/log(151); B: ice=1; A: known=1. Separate quality R: measured cloud=255, confirmed clear=128, unknown=0. Quantized GIBS palette inversions; no gap filling.',dates:[]};
manifest.maskReconstruction='Optional reconstructed maps: ocean mask from minimum visible RGB, smoothstep(0.07,0.42); optical contrast relative to 4px local mean. Missing properties from nearest cloudy measurement within 24 Manhattan pixels, never missing visible imagery; visible mask may override conflicting coarse clear flags. Premultiplied numerical channels; illumination-dependent approximation, not retrieved data.';
manifest.reconstruction='Cloud top: normalized Gaussian sigma 4 pixels per height group over valid clouds, plus inferred tau-correlated relief capped at +/- 3 height bytes (~188 m), min 4 bytes (~251 m). Vertical extent and base are inferred in the shader. Unknown phase uses water-like vertical profile. No hidden lower layers reconstructed.';
for(const date of dates){
 const images={},sources={};
 for(const [name,layer] of Object.entries(layers)){
  const u=new URL('https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi');
  u.search=new URLSearchParams({SERVICE:'WMS',VERSION:'1.3.0',REQUEST:'GetMap',LAYERS:'MODIS_Aqua_'+layer,STYLES:'',FORMAT:'image/png',TRANSPARENT:'TRUE',CRS:'CRS:84',BBOX:bbox.join(','),WIDTH:String(size),HEIGHT:String(size),TIME:date}).toString();
  const data=await download(u.href,`${cache}/${date}-${name}.png`);sources[name]=u.href;
  images[name]=await sharp(data).ensureAlpha().raw().toBuffer();
  if(name==='color')await sharp(data).webp({quality:90}).toFile(`${out}/${date}-reference.webp`);
 }
 const result=Buffer.alloc(size*size*4),quality=Buffer.alloc(size*size*4);let cloud=0,clear=0,unknown=0;
 const sample=(image,map,i)=>image[i+3]===255?map.get(`${image[i]},${image[i+1]},${image[i+2]}`):undefined;
 for(let i=0;i<result.length;i+=4){
  const height=sample(images.height,heightMap,i),tau=sample(images.tau,tauMap,i),fraction=sample(images.fraction,fractionMap,i);
  quality[i+3]=255;
  if(height!==undefined&&tau!==undefined){
   result[i]=Math.round(Math.min(16000,height)/16000*255);result[i+1]=Math.round(Math.log1p(Math.min(150,tau))/Math.log(151)*255);
   result[i+2]=images.phase[i]===188&&images.phase[i+1]===210?255:0;result[i+3]=255;quality[i]=255;cloud++;
  }else if(fraction!==undefined&&fraction===0){result[i+3]=255;quality[i]=128;clear++;}
  else unknown++;
 }
 // Split BEFORE filtering: interpolating low and high cloud heights together
 // creates invented vertical walls where high cloud crosses a low deck.
 const rawFields=[];
 for(const [layer,name] of ['low','middle','high'].entries()){
  const field=Buffer.alloc(result.length),weighted=Buffer.alloc(size*size*3);
  for(let i=0,j=0;i<result.length;i+=4,j+=3){const h=result[i]/255*16,group=h<3.5?0:h<7?1:2;
   if(quality[i]===255&&group===layer){result.copy(field,i,i,i+4);weighted[j]=result[i];weighted[j+1]=255;weighted[j+2]=result[i+1];}}
  const smooth=await sharp(weighted,{raw:{width:size,height:size,channels:3}}).blur(4).raw().toBuffer();
  for(let i=0,j=0;i<field.length;i+=4,j+=3)if(field[i+3]&&smooth[j+1]>0){
   const envelope=smooth[j]*255/smooth[j+1],meanTau=smooth[j+2]*255/smooth[j+1];
   const relief=Math.max(-3,Math.min(3,(field[i+1]-meanTau)*.12));
   field[i]=Math.max(4,Math.min(255,Math.round(envelope+relief)));
  }
  await sharp(field,{raw:{width:size,height:size,channels:4}}).png().toFile(`${out}/${date}-${name}.png`);
  rawFields.push(field);
 }
 // Optional visual reconstruction over this ocean-only patch. The visible
 // image supplies coverage detail, never RGB shading. Its brightness is still
 // illumination-dependent, so this is explicitly an inferred mask.
 const nearest=new Int32Array(size*size).fill(-1),distance=new Uint8Array(size*size).fill(255),queue=new Int32Array(size*size);let head=0,tail=0;
 for(let p=0;p<size*size;p++)if(quality[p*4]===255){nearest[p]=p;distance[p]=0;queue[tail++]=p;}
 while(head<tail){const p=queue[head++];if(distance[p]>=24)continue;const x=p%size,y=Math.floor(p/size);
  for(const n of [x>0?p-1:-1,x<size-1?p+1:-1,y>0?p-size:-1,y<size-1?p+size:-1])if(n>=0&&distance[n]===255){nearest[n]=nearest[p];distance[n]=distance[p]+1;queue[tail++]=n;}}
 const gray=Buffer.alloc(size*size);for(let p=0;p<gray.length;p++)gray[p]=Math.min(images.color[p*4],images.color[p*4+1],images.color[p*4+2]);
 const mean=await sharp(gray,{raw:{width:size,height:size,channels:1}}).blur(4).greyscale().raw().toBuffer();
 const reconstructed=['low','middle','high'].map(()=>Buffer.alloc(result.length));let inferred=0;
 for(let p=0;p<size*size;p++){
  const i=p*4,n=nearest[p];if(n<0||images.color[i+3]<255)continue;
  const g=gray[p]/255;let coverage=Math.max(0,Math.min(1,(g-.07)/.35));coverage=coverage*coverage*(3-2*coverage);if(coverage<.005)continue;
  const ni=n*4,h=result[ni]/255*16,layer=h<3.5?0:h<7?1:2,source=rawFields[layer],dst=reconstructed[layer];
  const measuredTau=Math.expm1(result[ni+1]/255*Math.log(151));
  const contrast=Math.max(.2,Math.min(2.2,(g-.04)/Math.max(.04,mean[p]/255-.04)));
  const tau=Math.min(150,measuredTau*contrast);
  dst[i]=Math.round(source[ni]*coverage);dst[i+1]=Math.round(Math.log1p(tau)/Math.log(151)*255*coverage);dst[i+2]=Math.round(source[ni+2]*coverage);dst[i+3]=Math.round(255*coverage);
  if(quality[i]!==255)inferred++;
 }
 for(const [layer,name] of ['low','middle','high'].entries())await sharp(reconstructed[layer],{raw:{width:size,height:size,channels:4}}).png().toFile(`${out}/${date}-${name}-reconstructed.png`);
 await sharp(quality,{raw:{width:size,height:size,channels:4}}).png().toFile(`${out}/${date}-quality.png`);
 const record={date,cloudPixels:cloud,clearPixels:clear,unknownPixels:unknown,inferredPixels:inferred,sources};manifest.dates.push(record);console.log(date,{cloud,clear,unknown,inferred});
}
await writeFile(out+'/manifest.json',JSON.stringify(manifest,null,2)+'\n');
