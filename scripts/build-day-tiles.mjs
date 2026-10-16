// NASA Blue Marble Next Generation, October 2004, 500 m. Originals live outside the repository.
// bun scripts/build-day-tiles.mjs /tmp/earthlight-reference/day
import sharp from 'sharp';
import { mkdir, readFile, writeFile, stat, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

sharp.concurrency(2);
sharp.cache(false);
const sourceDir=process.argv[2] || '/tmp/earthlight-reference/day';
const output=process.argv[3] || 'public/media/earthlight/day-tiles';
const size=21600, interior=540, gutter=16, cell=572;
await mkdir(output,{recursive:true});
const path=(x,y)=>join(sourceDir,`world.200410.3x21600x21600.${'ABCD'[(x+4)%4]}${y+1}.jpg`);
const manifest={version:1,width:86400,height:43200,interior,gutter,columns:160,rows:80,quality:50,tiles:[],bytes:0,sources:[]};
for(let sy=0;sy<2;sy++)for(let sx=0;sx<4;sx++){
  const source=path(sx,sy);
  const input=await readFile(source);
  manifest.sources.push({file:source.split('/').at(-1),sha256:createHash('sha256').update(input).digest('hex')});
  const raw=await sharp(input,{limitInputPixels:false}).toColourspace('srgb').removeAlpha().raw().toBuffer();
  const extract=async(x,y,left,top,width,height)=>sharp(path(x,y),{limitInputPixels:false}).extract({left,top,width,height}).toColourspace('srgb').removeAlpha().raw().toBuffer();
  const left=await extract(sx-1,sy,size-gutter,0,gutter,size);
  const right=await extract(sx+1,sy,0,0,gutter,size);
  const top=sy?await extract(sx,0,0,size-gutter,size,gutter):null;
  const bottom=!sy?await extract(sx,1,0,0,size,gutter):null;
  // Corners connect four source plates; the poles clamp to their final row.
  const corners={};
  for(const dx of [-1,1])for(const dy of [-1,1]){
    const yy=sy+dy;
    if(yy>=0&&yy<2)corners[`${dx},${dy}`]=await extract(sx+dx,yy,dx<0?size-gutter:0,dy<0?size-gutter:0,gutter,gutter);
  }
  function sample(x,y,c){
    if((y<0&&!top)||(y>=size&&!bottom))y=Math.max(0,Math.min(size-1,y));
    const dx=x<0?-1:x>=size?1:0,dy=y<0?-1:y>=size?1:0;
    const xx=x<0?x+gutter:x-size,yy=y<0?y+gutter:y-size;
    if(dx&&dy)return corners[`${dx},${dy}`][(yy*gutter+xx)*3+c];
    if(dx)return (dx<0?left:right)[(y*gutter+xx)*3+c];
    if(dy)return (dy<0?top:bottom)[(yy*size+x)*3+c];
    return raw[(y*size+x)*3+c];
  }
  let count=0;
  for(let ty=0;ty<40;ty++)for(let tx=0;tx<40;tx++){
    const x0=tx*interior,y0=ty*interior;
    const pixels=Buffer.alloc(cell*cell*3);
    let nonzero=false;
    for(let y=0;y<cell;y++){
      const yy=y0+y-gutter;
      if(yy>=0&&yy<size&&x0>=gutter&&x0+interior+gutter<=size){
        raw.copy(pixels,y*cell*3,(yy*size+x0-gutter)*3,(yy*size+x0+interior+gutter)*3);
      }else for(let x=0;x<cell;x++)for(let c=0;c<3;c++)pixels[(y*cell+x)*3+c]=sample(x0+x-gutter,yy,c);
    }
    // Include gutters in the detail test so coastline boundaries survive.
    let min=255,max=0;
    for(let i=0;i<pixels.length;i+=3){const l=(pixels[i]+pixels[i+1]+pixels[i+2])/3;min=Math.min(min,l);max=Math.max(max,l);}
    // Uniform ocean / polar fill has no spatial detail beyond the global map.
    nonzero=max-min>8;
    if(!nonzero)continue;
    const id=(sy*40+ty)*160+sx*40+tx;
    const target=join(output,`${id}.avif`);
    let bytes;
    try{
      // Only reuse partial output when explicitly resuming the SAME inputs.
      if(!process.argv.includes('--resume'))throw new Error('Rebuild');
      bytes=(await stat(target)).size;
    }catch{
      const encoded=await sharp(pixels,{raw:{width:cell,height:cell,channels:3}}).toColourspace('srgb').removeAlpha().avif({quality:50,effort:2,chromaSubsampling:'4:4:4',bitdepth:8}).toBuffer();
      await writeFile(target,encoded);bytes=encoded.length;
    }
    manifest.tiles.push(id);manifest.bytes+=bytes;count++;
  }
  console.log(`${'ABCD'[sx]}${sy+1}: ${count} nonempty tiles; total ${(manifest.bytes/1048576).toFixed(2)} MiB`);
}
manifest.tiles.sort((a,b)=>a-b);
const emitted=new Set(manifest.tiles.map(id=>`${id}.avif`));
for(const file of await readdir(output))if(/^\d+\.avif$/.test(file)&&!emitted.has(file))await unlink(join(output,file));
await writeFile(join(output,'manifest.json'),JSON.stringify(manifest));
console.log(`Done: ${manifest.tiles.length}/12800 tiles, ${(manifest.bytes/1048576).toFixed(2)} MiB`);
