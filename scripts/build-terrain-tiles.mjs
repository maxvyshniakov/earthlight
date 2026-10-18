import {tileDimensions,tileManifest,tileAddress} from '../src/scripts/tile-layout.ts';
// Lossless, sparse ETOPO 60 arcsecond tiles. Numeric mips must be generated
// before packing height bytes; image resizing would corrupt byte carries.
import sharp from 'sharp';
import {mkdir,writeFile} from 'node:fs/promises';
const source=process.argv[2];
if(!source)throw Error('Pass ETOPO_2022_v1_60s_N90W180_surface.tif');
const {interior,gutter,cell,columns,rows}=tileDimensions('terrain'),width=columns*interior,height=rows*interior;
const meta=await sharp(source,{limitInputPixels:false}).metadata();
if(meta.width!==width||meta.height!==height)throw Error('Expected 21600 x 10800 ETOPO');
const root=new URL('../public/media/earthlight/terrain-tiles/',import.meta.url);
await mkdir(root,{recursive:true});sharp.concurrency(2);
const tiles=[];let bytes=0;
for(let ty=0;ty<20;ty++){
 const first=Math.max(0,ty*interior-gutter),last=Math.min(height,(ty+1)*interior+gutter);
 const band=await sharp(source,{limitInputPixels:false}).extract({left:0,top:first,width,height:last-first}).toColourspace('b-w').raw({depth:'float'}).toBuffer();
 for(let tx=0;tx<40;tx++){
  let values=new Float32Array(cell*cell),maximum=0;
  for(let y=0;y<cell;y++)for(let x=0;x<cell;x++){
   const sx=(tx*interior+x-gutter+width)%width,sy=Math.max(0,Math.min(height-1,ty*interior+y-gutter))-first;
   const h=Math.max(0,Math.min(9000,band.readFloatLE((sy*width+sx)*4)));
   values[y*cell+x]=h;maximum=Math.max(maximum,h);
  }
  if(maximum<64)continue;
  // Left square is the full tile; the right square packs four isolated mips.
  const packed=Buffer.alloc(cell*cell*2*3);let size=cell,offset=0;
  for(let level=0;level<=4;level++){
   for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const q=Math.round(values[y*size+x]/8),p=(y*cell*2+(level?cell+offset:0)+x)*3;
    packed[p]=q>>8;packed[p+1]=q&255;
   }
   if(level)offset+=size;
   if(level===4)break;
   const nextSize=Math.ceil(size/2),next=new Float32Array(nextSize*nextSize);
   // Area resampling also handles the odd 143/71.5 mip transition.
   for(let y=0;y<nextSize;y++)for(let x=0;x<nextSize;x++){
    const x0=x*size/nextSize,x1=(x+1)*size/nextSize,y0=y*size/nextSize,y1=(y+1)*size/nextSize;
    let sum=0;
    for(let sy=Math.floor(y0);sy<Math.ceil(y1);sy++)for(let sx=Math.floor(x0);sx<Math.ceil(x1);sx++)
     sum+=values[sy*size+sx]*(Math.min(x1,sx+1)-Math.max(x0,sx))*(Math.min(y1,sy+1)-Math.max(y0,sy));
    next[y*nextSize+x]=sum/((x1-x0)*(y1-y0));
   }
   values=next;size=nextSize;
  }
  const id=tileAddress(tileDimensions('terrain'),tx,ty),out=await sharp(packed,{raw:{width:cell*2,height:cell,channels:3}}).png({compressionLevel:9}).toBuffer();
  await writeFile(new URL(`${id}.png`,root),out);tiles.push(id);bytes+=out.length;
 }
 console.log({row:ty,tiles:tiles.length,bytes});
}
await writeFile(new URL('manifest.json',root),JSON.stringify({...tileManifest('terrain',tiles),source:'NOAA ETOPO 2022 ice surface, 60 arcseconds',tiles})+'\n');
