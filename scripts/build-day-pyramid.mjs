// Lab (docs/lab/day-pyramid-2026-10-17.md): deep day-surface tiles below the
// 500 m BMNG tiles, from the level-5 Sentinel-2 mosaic that
// fetch-sentinel-mosaic.mjs writes. BMNG stays the photometric reference:
//
//   tile = S2 · gain,  gain = blur(BMNG) / blur(S2 averaged to the BMNG grid)
//
// per channel in linear light, where the gain is smooth across BMNG texels
// and bilinearly interpolated to each deep texel. A deep texel block that
// covers one BMNG texel averages back to that texel's BMNG colour up to the
// blur; finer detail is Sentinel-2's own. Tiles use the BMNG tile layout
// (540 px interior, 16 px gutters, AVIF Q50 4:4:4) on a quadtree per level.
//
//   bun scripts/build-day-pyramid.mjs <mosaic-dir> <day-tiles-dir> [output] [--sigma=1] [--quality=50] [--raw]
//
// --raw skips the gain (plain Sentinel-2 reflectance as sRGB), as a baseline.
import sharp from 'sharp';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const args=process.argv.slice(2).filter(a=>!a.startsWith('--'));
const option=(name,fallback)=>Number(process.argv.find(a=>a.startsWith(`--${name}=`))?.split('=')[1]??fallback);
const [mosaicDir,dayTiles,output='public/media/earthlight/day-pyramid']=args;
if(!mosaicDir||!dayTiles)throw new Error('Usage: build-day-pyramid.mjs <mosaic-dir> <day-tiles-dir> [output] [--sigma=1] [--quality=50]');
const sigma=option('sigma',1),quality=option('quality',50),plain=process.argv.includes('--raw');
const DEPTH=5,INTERIOR=540,GUTTER=16,CELL=572,EPSILON=.005;
sharp.concurrency(4);sharp.cache(false);

const meta=JSON.parse(await readFile(join(mosaicDir,'level5.json'),'utf8'));
const {left,top,width,height}=meta.grid;
const raw=await readFile(join(mosaicDir,meta.file));
if(createHash('sha256').update(raw).digest('hex')!==meta.sha256)throw new Error('Mosaic checksum mismatch');
const level5=new Uint16Array(raw.buffer,raw.byteOffset,width*height*3);
if(left%32||top%32||width%32||height%32)throw new Error('Mosaic must align to the BMNG grid');

// Box pyramid in linear reflectance: levels[L] at 2^L × the BMNG grid.
const levels=[];
// Level 5 stays in its integer reflectance (× 10⁴) to halve peak memory.
levels[DEPTH]={left,top,width,height,data:level5,scale:1e-4};
for(let L=DEPTH-1;L>=0;L--){
  const fine=levels[L+1],w=fine.width/2,h=fine.height/2,data=new Float32Array(w*h*3);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)for(let c=0;c<3;c++){
    const i=((2*y)*fine.width+2*x)*3+c;
    data[(y*w+x)*3+c]=(fine.data[i]+fine.data[i+3]+fine.data[i+fine.width*3]+fine.data[i+fine.width*3+3])*fine.scale/4;
  }
  levels[L]={left:fine.left/2,top:fine.top/2,width:w,height:h,data,scale:1};
}
const base=levels[0];

// BMNG on the same level-0 window, decoded from the tiles the renderer uses.
const srgbToLinear=v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4;
const linearToSrgb=v=>v<=.0031308?12.92*v:1.055*v**(1/2.4)-.055;
const decode=new Float32Array(256).map((_,i)=>srgbToLinear(i/255));
const bmng=new Float32Array(base.width*base.height*3).fill(NaN);
const sources=[];
for(let ty=Math.floor(base.top/INTERIOR);ty<=Math.floor((base.top+base.height-1)/INTERIOR);ty++)
  for(let tx=Math.floor(base.left/INTERIOR);tx<=Math.floor((base.left+base.width-1)/INTERIOR);tx++){
    const id=ty*160+tx,file=join(dayTiles,`${id}.avif`),bytes=await readFile(file);
    sources.push({tile:id,sha256:createHash('sha256').update(bytes).digest('hex')});
    const pixels=await sharp(bytes).removeAlpha().raw().toBuffer();
    for(let y=0;y<CELL;y++)for(let x=0;x<CELL;x++){
      const gx=tx*INTERIOR-GUTTER+x-base.left,gy=ty*INTERIOR-GUTTER+y-base.top;
      if(gx<0||gy<0||gx>=base.width||gy>=base.height)continue;
      // Interiors win over neighbouring gutters.
      const interior=x>=GUTTER&&y>=GUTTER&&x<GUTTER+INTERIOR&&y<GUTTER+INTERIOR;
      const o=(gy*base.width+gx)*3;
      if(!interior&&!Number.isNaN(bmng[o]))continue;
      for(let c=0;c<3;c++)bmng[o+c]=decode[pixels[(y*CELL+x)*3+c]];
    }
  }
if(bmng.some(Number.isNaN))throw new Error('BMNG tiles do not cover the mosaic');

// Separable Gaussian blur (clamped edges) of both images on the BMNG grid.
function blur(data,w,h){
  if(!sigma)return data;
  const radius=Math.ceil(3*sigma),kernel=[];let sum=0;
  for(let i=-radius;i<=radius;i++){kernel.push(Math.exp(-i*i/(2*sigma*sigma)));sum+=kernel.at(-1);}
  const k=kernel.map(v=>v/sum),tmp=new Float32Array(data.length),out=new Float32Array(data.length);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)for(let c=0;c<3;c++){let v=0;for(let i=-radius;i<=radius;i++)v+=k[i+radius]*data[(y*w+Math.max(0,Math.min(w-1,x+i)))*3+c];tmp[(y*w+x)*3+c]=v;}
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)for(let c=0;c<3;c++){let v=0;for(let i=-radius;i<=radius;i++)v+=k[i+radius]*tmp[(Math.max(0,Math.min(h-1,y+i))*w+x)*3+c];out[(y*w+x)*3+c]=v;}
  return out;
}
const smoothB=blur(bmng,base.width,base.height),smoothS=blur(base.data,base.width,base.height);
const gain=new Float32Array(bmng.length);let clamped=0;
for(let i=0;i<gain.length;i++){
  const g=(smoothB[i]+EPSILON)/(smoothS[i]+EPSILON),limited=Math.max(1/8,Math.min(8,g));
  gain[i]=plain?1:limited;if(!plain&&limited!==g)clamped++;
}
// Bilinear gain at a level-L texel centre.
function gainAt(L,px,py,c){
  const s=2**L,x=(px+.5)/s-.5-base.left,y=(py+.5)/s-.5-base.top;
  const x0=Math.max(0,Math.min(base.width-2,Math.floor(x))),y0=Math.max(0,Math.min(base.height-2,Math.floor(y)));
  const fx=Math.max(0,Math.min(1,x-x0)),fy=Math.max(0,Math.min(1,y-y0));
  const g=(xx,yy)=>gain[(yy*base.width+xx)*3+c];
  return (g(x0,y0)*(1-fx)+g(x0+1,y0)*fx)*(1-fy)+(g(x0,y0+1)*(1-fx)+g(x0+1,y0+1)*fx)*fy;
}

await rm(output,{recursive:true,force:true});
const manifest={version:1,interior:INTERIOR,gutter:GUTTER,depth:DEPTH,quality,sigma,tiles:[],bytes:0,levels:{},
  method:'Sentinel-2 × smooth per-channel gain to BMNG (linear light), see docs/lab/day-pyramid-2026-10-17.md',
  sentinel:{product:meta.product,license:meta.license,attribution:meta.attribution,doi:meta.doi,accessed:meta.accessed,sha256:meta.sha256,sources:meta.sources},
  bmng:sources,gainClamped:clamped/gain.length};
let clipped=0,texels=0;
for(let L=1;L<=DEPTH;L++){
  const level=levels[L],stats={tiles:0,bytes:0};
  const x0=Math.ceil((level.left+GUTTER)/INTERIOR),x1=Math.floor((level.left+level.width-INTERIOR-GUTTER)/INTERIOR);
  const y0=Math.ceil((level.top+GUTTER)/INTERIOR),y1=Math.floor((level.top+level.height-INTERIOR-GUTTER)/INTERIOR);
  await mkdir(join(output,String(L)),{recursive:true});
  const jobs=[];
  for(let ty=y0;ty<=y1;ty++)for(let tx=x0;tx<=x1;tx++){
    const pixels=Buffer.alloc(CELL*CELL*3);
    for(let y=0;y<CELL;y++)for(let x=0;x<CELL;x++){
      const px=tx*INTERIOR-GUTTER+x,py=ty*INTERIOR-GUTTER+y,i=((py-level.top)*level.width+px-level.left)*3;
      for(let c=0;c<3;c++){
        const v=level.data[i+c]*level.scale*gainAt(L,px,py,c);
        if(v>1)clipped++;texels++;
        pixels[(y*CELL+x)*3+c]=Math.round(255*linearToSrgb(Math.max(0,Math.min(1,v))));
      }
    }
    jobs.push(sharp(pixels,{raw:{width:CELL,height:CELL,channels:3}}).avif({quality,effort:2,chromaSubsampling:'4:4:4',bitdepth:8}).toBuffer().then(async encoded=>{
      await writeFile(join(output,String(L),`${tx}-${ty}.avif`),encoded);
      manifest.tiles.push(`${L}/${tx}/${ty}`);stats.tiles++;stats.bytes+=encoded.length;manifest.bytes+=encoded.length;
    }));
    if(jobs.length>=8)await Promise.all(jobs.splice(0));
  }
  await Promise.all(jobs);
  manifest.levels[L]=stats;
  console.log(`level ${L}: ${stats.tiles} tiles, ${(stats.bytes/1048576).toFixed(2)} MiB, ${(stats.bytes/Math.max(1,stats.tiles)/1024).toFixed(1)} KiB/tile`);
}
manifest.tiles.sort();
manifest.clipped=clipped/texels;
await writeFile(join(output,'manifest.json'),JSON.stringify(manifest,null,1));
console.log(`gain clamped ${(manifest.gainClamped*100).toFixed(3)}%, clipped ${(manifest.clipped*100).toFixed(3)}%, total ${(manifest.bytes/1048576).toFixed(2)} MiB`);
