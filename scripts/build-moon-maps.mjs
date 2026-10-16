// Build the lazily loaded lunar surface maps from NASA SVS's CGI Moon Kit.
// bun scripts/build-moon-maps.mjs lroc_color_16bit_srgb_4k.tif ldem_16_uint.tif
// Source, coordinate convention, encoding and credit: public/media/earthlight/README.md.
//
// Each tier is one equirectangular WebP, longitude -180..180 east-positive left
// to right, latitude +90 at the top, 0 degrees at the mean sub-Earth point.
// RGB: LROC WAC colour (gamma 2.2, lossy). Alpha: LOLA height, 8-bit, lossless.
// moon.json carries the height range, the mean linear colour and a 128 x 64
// linear-luminance table for the renderer's flux normalization.
import { readFileSync, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

const [colorPath,demPath]=process.argv.slice(2);
if(!colorPath||!demPath)throw Error('Pass lroc_color_16bit_srgb_4k.tif and ldem_16_uint.tif');
sharp.concurrency(2);
const output=new URL('../public/media/earthlight/moon/',import.meta.url);
await mkdir(output,{recursive:true});

// The SVS colour map is graded "for aesthetics". Its blue maria are stronger
// than the Moon looks to the eye or a camera; keep 40% of the chroma.
const CHROMA=.4;
const TIERS=[1024,2048,4096];
const decode=v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4;
// Stored with a pure 2.2 gamma: the renderer decodes pow(x, 2.2) exactly.
const encode=v=>v**(1/2.2);

const color=await sharp(colorPath,{limitInputPixels:false}).toColourspace('rgb16').raw({depth:'ushort'}).toBuffer({resolveWithObject:true});
if(color.info.width!==4096||color.info.height!==2048||color.info.channels!==3)throw Error('Expected the 4096 x 2048 16-bit sRGB LROC colour map');
const width=color.info.width,height=color.info.height,count=width*height;
const source=new Uint16Array(color.data.buffer,color.data.byteOffset,count*3);
// Linear float RGB, chroma reduced around Rec. 709 luminance.
const linear=new Float32Array(count*3);
for(let i=0;i<count;i++){
 const r=decode(source[i*3]/65535),g=decode(source[i*3+1]/65535),b=decode(source[i*3+2]/65535);
 const y=.2126*r+.7152*g+.0722*b;
 linear[i*3]=y+(r-y)*CHROMA;linear[i*3+1]=y+(g-y)*CHROMA;linear[i*3+2]=y+(b-y)*CHROMA;
}

// LOLA heights: unsigned half-metres with a +10 km offset (SVS encoding).
const demImage=await sharp(demPath,{limitInputPixels:false}).toColourspace('grey16').raw({depth:'ushort'}).toBuffer({resolveWithObject:true});
if(demImage.info.channels!==1)throw Error('Expected a single-channel LOLA DEM');
const dem=new Uint16Array(demImage.data.buffer,demImage.data.byteOffset,demImage.info.width*demImage.info.height);
const demKm=new Float32Array(dem.length);
let low=Infinity,high=-Infinity;
for(let i=0;i<dem.length;i++){const km=(dem[i]-20000)/2000;demKm[i]=km;low=Math.min(low,km);high=Math.max(high,km);}
// A fixed, slightly padded range keeps every tier on the same encoding.
const range=[Math.floor(low*2)/2,Math.ceil(high*2)/2];

// Exact area-weighted resampling of float rasters (linear light or km), one
// separable pass per axis. Longitude wraps; latitude is clamped at the poles.
const axisWeights=(from,to,wrap)=>{
 const scale=from/to,taps=[];
 for(let o=0;o<to;o++){
  const start=o*scale,end=start+Math.max(scale,1),list=[];
  const lo=Math.floor(start),hi=Math.ceil(end);
  for(let i=lo;i<hi;i++){
   const w=Math.min(end,i+1)-Math.max(start,i);
   if(w>0)list.push([wrap?(i%from+from)%from:Math.min(from-1,Math.max(0,i)),w/(end-start)]);
  }
  taps.push(list);
 }
 return taps;
};
const resample=async(data,w,h,channels,tw,th)=>{
 const xs=axisWeights(w,tw,true),ys=axisWeights(h,th,false);
 const rows=new Float32Array(tw*h*channels),out=new Float32Array(tw*th*channels);
 for(let y=0;y<h;y++)for(let x=0;x<tw;x++)for(const [i,wt] of xs[x])for(let c=0;c<channels;c++)
  rows[(y*tw+x)*channels+c]+=data[(y*w+i)*channels+c]*wt;
 for(let y=0;y<th;y++)for(const [j,wt] of ys[y])for(let x=0;x<tw;x++)for(let c=0;c<channels;c++)
  out[(y*tw+x)*channels+c]+=rows[(j*tw+x)*channels+c]*wt;
 return out;
};

const tiers=[];
for(const tierWidth of TIERS){
 const tierHeight=tierWidth/2,pixels=tierWidth*tierHeight;
 const rgb=await resample(linear,width,height,3,tierWidth,tierHeight);
 const heights=await resample(demKm,demImage.info.width,demImage.info.height,1,tierWidth,tierHeight);
 const rgba=Buffer.alloc(pixels*4);
 for(let i=0;i<pixels;i++){
  for(let c=0;c<3;c++)rgba[i*4+c]=Math.round(255*encode(Math.max(0,Math.min(1,rgb[i*3+c]))));
  rgba[i*4+3]=Math.round(255*Math.max(0,Math.min(1,(heights[i]-range[0])/(range[1]-range[0]))));
 }
 const name=`moon-${tierWidth}.webp`,file=new URL(name,output);
 // alphaQuality 100 stores the height channel with WebP's lossless coder.
 await sharp(rgba,{raw:{width:tierWidth,height:tierHeight,channels:4}})
  .webp({quality:86,alphaQuality:100,effort:6,smartSubsample:true}).toFile(file.pathname);
 const check=await sharp(file.pathname).ensureAlpha().raw().toBuffer();
 for(let i=0;i<pixels;i++)if(check[i*4+3]!==rgba[i*4+3])throw Error(`${name}: height channel is not lossless`);
 tiers.push({width:tierWidth,height:tierHeight,url:name,bytes:statSync(file).size});
}

// Disk-normalization table: linear luminance relative to the global mean.
const table=await resample(linear,width,height,3,128,64);
let weight=0;const mean=[0,0,0];
for(let y=0;y<height;y++){
 const area=Math.cos(((y+.5)/height-.5)*Math.PI);
 for(let x=0;x<width;x++)for(let c=0;c<3;c++)mean[c]+=linear[(y*width+x)*3+c]*area;
 weight+=area*width;
}
for(let c=0;c<3;c++)mean[c]/=weight;
const meanLuminance=.2126*mean[0]+.7152*mean[1]+.0722*mean[2];
const luminance=Buffer.alloc(128*64);
// Stored as relative luminance / 2.5 in 8 bits (relative albedo spans ~0.4..2.2).
for(let i=0;i<128*64;i++)luminance[i]=Math.round(255*Math.min(1,(.2126*table[i*3]+.7152*table[i*3+1]+.0722*table[i*3+2])/meanLuminance/2.5));

const sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const manifest={
 version:1,
 projection:'equirectangular; longitude -180..180 east-positive, left to right; latitude +90 at the top; IAU mean-Earth selenographic frame',
 color:{encoding:'gamma 2.2, 8-bit, RGB channels',chroma:CHROMA,meanLinear:mean.map(v=>+v.toFixed(6))},
 height:{encoding:'alpha channel, 8-bit linear, lossless',km:range,referenceRadiusKm:1737.4},
 luminance:{width:128,height:64,scale:2.5,data:luminance.toString('base64')},
 tiers,
 sources:[
  {file:'lroc_color_16bit_srgb_4k.tif',sha256:sha(colorPath)},
  {file:'ldem_16_uint.tif',sha256:sha(demPath)},
 ],
};
await writeFile(new URL('moon.json',output),JSON.stringify(manifest,null,1)+'\n');
console.log(JSON.stringify({tiers,heightKm:range,meanLinear:manifest.color.meanLinear},null,1));
