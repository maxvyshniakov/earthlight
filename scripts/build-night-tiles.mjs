// NASA Black Marble 2016, 500 m. Originals live outside the repository.
// node scripts/build-night-tiles.mjs /tmp/orbital-reference
import sharp from 'sharp';
import { mkdir, readFile, writeFile, stat, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

sharp.concurrency(2);
sharp.cache(false);
const sourceDir=process.argv[2] || '/tmp/orbital-reference';
const output=process.argv[3] || 'public/media/orbit/night-tiles';
const size=21600, interior=540, gutter=16, cell=572;
await mkdir(output,{recursive:true});
const path=(x,y)=>join(sourceDir,`BlackMarble_2016_${'ABCD'[(x+4)%4]}${y+1}_gray.jpg`);
const manifest={version:1,width:86400,height:43200,interior,gutter,columns:160,rows:80,quality:80,tiles:[],bytes:0,sources:[]};
for(let sy=0;sy<2;sy++)for(let sx=0;sx<4;sx++){
  const source=path(sx,sy);
  const input=await readFile(source);
  manifest.sources.push({file:source.split('/').at(-1),sha256:createHash('sha256').update(input).digest('hex')});
  const raw=await sharp(input,{limitInputPixels:false}).toColourspace('b-w').raw().toBuffer();
  const extract=async(x,y,left,top,width,height)=>sharp(path(x,y),{limitInputPixels:false}).extract({left,top,width,height}).toColourspace('b-w').raw().toBuffer();
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
  function sample(x,y){
    if((y<0&&!top)||(y>=size&&!bottom))y=Math.max(0,Math.min(size-1,y));
    const dx=x<0?-1:x>=size?1:0,dy=y<0?-1:y>=size?1:0;
    const xx=x<0?x+gutter:x-size,yy=y<0?y+gutter:y-size;
    if(dx&&dy)return corners[`${dx},${dy}`][yy*gutter+xx];
    if(dx)return (dx<0?left:right)[y*gutter+xx];
    if(dy)return (dy<0?top:bottom)[yy*size+x];
    return raw[y*size+x];
  }
  let count=0;
  for(let ty=0;ty<40;ty++)for(let tx=0;tx<40;tx++){
    const x0=tx*interior,y0=ty*interior;
    const pixels=Buffer.alloc(cell*cell);
    let nonzero=false;
    for(let y=0;y<cell;y++){
      const yy=y0+y-gutter;
      if(yy>=0&&yy<size&&x0>=gutter&&x0+interior+gutter<=size){
        raw.copy(pixels,y*cell,yy*size+x0-gutter,yy*size+x0+interior+gutter);
      }else for(let x=0;x<cell;x++)pixels[y*cell+x]=sample(x0+x-gutter,yy);
    }
    // Include light in the gutter too: a neighbor's boundary must interpolate.
    nonzero=pixels.some(v=>v!==0);
    if(!nonzero)continue;
    const id=(sy*40+ty)*160+sx*40+tx;
    const target=join(output,`${id}.avif`);
    let bytes;
    try{
      // Only reuse partial output when explicitly resuming the SAME inputs.
      if(!process.argv.includes('--resume'))throw new Error('Rebuild');
      bytes=(await stat(target)).size;
    }catch{
      const encoded=await sharp(pixels,{raw:{width:cell,height:cell,channels:1}}).toColourspace('b-w').avif({quality:80,effort:4,chromaSubsampling:'4:4:4',bitdepth:8}).toBuffer();
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
