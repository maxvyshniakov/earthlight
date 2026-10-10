// NOAA ETOPO 2022 ice-surface GeoTIFF + Natural Earth 1:10m land polygons.
// Numeric data, not a photograph: lossless gzip, 8 m elevation quantization,
// explicit mip levels so averaging packed bytes cannot create false mountains.
import sharp from 'sharp';
import {readFileSync,writeFileSync,statSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const [source,landFile]=process.argv.slice(2);
if(!source||!landFile)throw Error('Usage: bun scripts/build-terrain-map.mjs ETOPO.tif ne_10m_land.geojson');
sharp.concurrency(2);
const land=JSON.parse(readFileSync(landFile));
const polygons=land.features.flatMap(f=>f.geometry.type==='MultiPolygon'?f.geometry.coordinates:[f.geometry.coordinates]);
for(const width of [8192,4096]){
 const height=width/2;
 const path=polygons.map(poly=>poly.map(ring=>'M'+ring.map(([x,y])=>`${((x+180)/360*width).toFixed(3)},${((90-y)/180*height).toFixed(3)}`).join('L')+'Z').join('')).join('');
 const mask=await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="black"/><path d="${path}" fill="white" fill-rule="evenodd"/></svg>`),{limitInputPixels:false}).removeAlpha().greyscale().raw().toBuffer();
 const {data,info}=await sharp(source,{limitInputPixels:false}).resize(width,height,{kernel:'linear'}).toColourspace('b-w').raw({depth:'float'}).toBuffer({resolveWithObject:true});
 if(info.channels!==1)throw Error('Expected scalar elevations');
 let heights=new Float32Array(width*height),water=new Float32Array(width*height);
 // Stored south to north for earthUV, west to east. Sea floor is not displaced.
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
   const src=y*width+x,dst=(height-1-y)*width+x;
   heights[dst]=Math.max(0,Math.min(9000,data.readFloatLE(src*4)))*mask[src]/255;
   water[dst]=1-mask[src]/255;
 }
 const levels=[];let w=width,h=height;
 while(true){
   const bytes=Buffer.alloc(w*h*3);
   for(let i=0;i<w*h;i++){
     const q=Math.round(heights[i]/8);bytes[3*i]=q>>>8;bytes[3*i+1]=q&255;bytes[3*i+2]=Math.round(water[i]*255);
   }
   levels.push(bytes);
   if(w===1&&h===1)break;
   const nw=Math.max(1,w/2),nh=Math.max(1,h/2),nextH=new Float32Array(nw*nh),nextW=new Float32Array(nw*nh);
   for(let y=0;y<nh;y++)for(let x=0;x<nw;x++)for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){
     const j=Math.min(h-1,y*2+dy)*w+Math.min(w-1,x*2+dx),i=y*nw+x;
     nextH[i]+=heights[j]*.25;nextW[i]+=water[j]*.25;
   }
   heights=nextH;water=nextW;w=nw;h=nh;
 }
 const header=Buffer.alloc(16);header.write('DEM1');header.writeUInt32LE(width,4);header.writeUInt32LE(height,8);header.writeUInt32LE(levels.length,12);
 const result=gzipSync(Buffer.concat([header,...levels]),{level:9});
 const name=`public/media/orbit/earth-terrain-${width}.dem`;writeFileSync(name,result);
 console.log(name,statSync(name).size);
}
console.log('source SHA256',createHash('sha256').update(readFileSync(source)).digest('hex'));
console.log('land SHA256',createHash('sha256').update(readFileSync(landFile)).digest('hex'));
