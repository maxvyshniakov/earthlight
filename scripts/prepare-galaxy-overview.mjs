// Derive the optional 2K overview from the graded 4K plate. No new source
// imagery, decoder or runtime dependency is needed. Average 2x2 texels in the
// displayed radiance, pow(texel, 3.3), like the tile pyramid: resizing encoded
// texels dims resolved detail.
import sharp from 'sharp';
import {stat} from 'node:fs/promises';
const source=new URL('../public/media/orbit/milky-way.avif',import.meta.url);
const output=new URL('../public/media/orbit/mobile/galaxy-2048.avif',import.meta.url);
const {data,info}=await sharp(source.pathname).removeAlpha().raw().toBuffer({resolveWithObject:true});
if(info.width!==4096||info.height!==2048)throw Error('Expected the 4096 by 2048 overview');
const pixels=Buffer.alloc(2048*1024*3),radiance=v=>Math.pow(v/255,3.3);
for(let y=0;y<1024;y++)for(let x=0;x<2048;x++)for(let c=0;c<3;c++){
 const at=(dx,dy)=>radiance(data[((2*y+dy)*4096+2*x+dx)*3+c]);
 pixels[(y*2048+x)*3+c]=Math.round(255*Math.pow((at(0,0)+at(1,0)+at(0,1)+at(1,1))/4,1/3.3));
}
await sharp(pixels,{raw:{width:2048,height:1024,channels:3}})
  .avif({quality:80,effort:4,chromaSubsampling:'4:4:4'}).toFile(output.pathname);
console.log({sourceBytes:(await stat(source)).size,outputBytes:(await stat(output)).size});
