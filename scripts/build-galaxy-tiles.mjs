// Stream NASA 16K Galactic EXR through disk-backed float planes; originals stay external.
import {spawnSync} from 'node:child_process';
import {open,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
const source=process.argv[2];
if(!source)throw Error('Pass milkyway_2020_16k_gal.exr');
const width=16384,height=8192,interior=512,gutter=16,halo=112;
const probe=spawnSync('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=width,height','-of','json',source]);
const info=JSON.parse(probe.stdout).streams[0];
if(info.width!==width||info.height!==height)throw Error('Expected NASA 16384 by 8192 Galactic EXR');
const rawPath=join(tmpdir(),`galaxy-${process.pid}.f32`),root=new URL('../public/media/orbit/galaxy-tiles/',import.meta.url);
const decode=spawnSync('ffmpeg',['-y','-v','error','-i',source,'-pix_fmt','gbrpf32le','-f','rawvideo',rawPath],{stdio:'inherit'});
if(decode.status!==0)throw Error('EXR decoding failed');
await mkdir(root,{recursive:true});sharp.concurrency(2);
const input=await open(rawPath,'r'),tiles=[];let bytes=0;
// Keep the established overview's broad brightness and colour. Applying a
// nonlinear shadow mask to increasingly resolved catalog points otherwise
// changes the low-frequency mean. Add only the 16K high-frequency residual.
const overview=await sharp(new URL('../public/media/orbit/milky-way.avif',import.meta.url).pathname).removeAlpha().raw().toBuffer();
async function lowPass(data,rows){
 const wrapped=Buffer.alloc((width+2*halo)*rows*3);
 for(let y=0;y<rows;y++){
  const row=y*width*3,dest=y*(width+2*halo)*3;
  data.copy(wrapped,dest,row+(width-halo)*3,row+width*3);
  data.copy(wrapped,dest+halo*3,row,row+width*3);
  data.copy(wrapped,dest+(halo+width)*3,row,row+halo*3);
 }
 return sharp(wrapped,{raw:{width:width+2*halo,height:rows,channels:3}}).blur(32).extract({left:halo,top:0,width,height:rows}).raw().toBuffer();
}
try{
 for(let ty=0;ty<16;ty++){
  const first=Math.max(0,ty*interior-halo),last=Math.min(height,(ty+1)*interior+halo),rows=last-first,count=width*rows;
  const planes=[];
  for(let c=0;c<3;c++){const data=Buffer.alloc(count*4);let done=0;while(done<data.length){const r=await input.read(data,done,data.length-done,(c*width*height+first*width)*4+done);if(!r.bytesRead)throw Error('Truncated EXR');done+=r.bytesRead;}planes.push(data);}
  const guide=Buffer.alloc(count);
  for(let i=0;i<count;i++){const l=(.2126*planes[2].readFloatLE(i*4)+.7152*planes[0].readFloatLE(i*4)+.0722*planes[1].readFloatLE(i*4))*16;guide[i]=Math.round(255*Math.sqrt(Math.max(0,Math.min(1,l))));}
  // Real neighboring rows and wrapped longitude support the same 0.7 degree
  // mask as the overview, without seams at tile boundaries.
  const wrapped=Buffer.alloc((width+2*halo)*rows);
  for(let y=0;y<rows;y++){const row=y*width,dest=y*(width+2*halo);guide.copy(wrapped,dest,row+width-halo,row+width);guide.copy(wrapped,dest+halo,row,row+width);guide.copy(wrapped,dest+halo+width,row,row+halo);}
  const smooth=await sharp(wrapped,{raw:{width:width+2*halo,height:rows,channels:1}}).blur(width/360*.7).extract({left:halo,top:0,width,height:rows}).raw().toBuffer({resolveWithObject:true});
  const pixels=Buffer.alloc(count*3),black=.0015,toe=.012,pivot=.12,shift=pivot-black,normal=pivot*(shift+toe)/(shift*shift);
  for(let i=0;i<count;i++){
   const rgb=[planes[2].readFloatLE(i*4)*16,planes[0].readFloatLE(i*4)*16,planes[1].readFloatLE(i*4)*16].map(x=>Math.max(0,x));
   const l=.2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2],shadow=Math.max(0,l-black),graded=normal*shadow*shadow/(shadow+toe);
   const local=(smooth.data[i*smooth.info.channels]/255)**2,support=Math.max(0,Math.min(1,(local-.004)/.016)),mask=support*support*(3-2*support),gain=graded/Math.max(l,1e-12)*Math.pow(5*mask,2/3);
   for(let c=0;c<3;c++){const v=(l+(rgb[c]-l)*1.2)*gain,shoulder=v<=.65?v:.65+.35*(1-Math.exp(-(v-.65)/.35));pixels[i*3+c]=Math.round(255*Math.pow(Math.max(0,Math.min(1,shoulder)),1/2.2));}
  }
  const reference=await sharp(overview,{raw:{width:4096,height:2048,channels:3}})
   .extract({left:0,top:first/4,width:4096,height:rows/4}).resize(width,rows,{kernel:'cubic'}).raw().toBuffer();
  const broad=await lowPass(pixels,rows),target=await lowPass(reference,rows);
  for(let i=0;i<pixels.length;i++)pixels[i]=Math.max(0,Math.min(255,pixels[i]-broad[i]+target[i]));
  for(let tx=0;tx<32;tx++){
   const cell=interior+2*gutter,tile=Buffer.alloc(cell*cell*3);let maximum=0;
   for(let y=0;y<cell;y++)for(let x=0;x<cell;x++){
    const sx=(tx*interior+x-gutter+width)%width,sy=Math.max(0,Math.min(height-1,ty*interior+y-gutter))-first;
    const start=(sy*width+sx)*3,dest=(y*cell+x)*3;
    for(let c=0;c<3;c++){tile[dest+c]=pixels[start+c];maximum=Math.max(maximum,tile[dest+c]);}
   }
   if(maximum<8)continue;
   const id=ty*32+tx,file=new URL(`${id}.avif`,root);
   const out=await sharp(tile,{raw:{width:cell,height:cell,channels:3}}).avif({quality:65,effort:2,chromaSubsampling:'4:4:4'}).toBuffer();await writeFile(file,out);tiles.push(id);bytes+=out.length;
  }
  console.log({row:ty,tiles:tiles.length,bytes});
 }
 await writeFile(new URL('manifest.json',root),JSON.stringify({version:1,columns:32,rows:16,interior,gutter,source:'NASA SVS Deep Star Maps 2020, milkyway_2020_16k_gal.exr',tiles})+'\n');
}finally{await input.close();await rm(rawPath,{force:true});}
