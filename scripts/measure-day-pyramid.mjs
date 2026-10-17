// Day pyramid photometry and seams (docs/lab/day-pyramid-global-2026-10-17.md),
// in 8-bit sRGB steps per channel, from the packs as published:
//
//   bmng      each level box-averaged in linear light onto the 500 m grid,
//             against the day tile the renderer would otherwise show;
//   levels    each level against its children averaged 2 × 2;
//   packs     a level-3 tile's 16 px gutter against the neighbouring pack's
//             interior over the same ground (packs are built independently);
//   dateline  the same across 180°;
//   bmngEdge  a level-1 gutter, averaged to 500 m, against the BMNG interior
//             of a neighbouring day tile that has no pack.
//
//   bun scripts/measure-day-pyramid.mjs <pyramid-dir> <day-tiles-dir> [--packs=id,id|--sample=200]
import sharp from 'sharp';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { decodePackHeader, packSlot, PACK_HEADER } from '../src/scripts/day-pyramid-pack.ts';

const [dir,dayTiles]=process.argv.slice(2).filter(a=>!a.startsWith('--'));
if(!dir||!dayTiles)throw new Error('Usage: measure-day-pyramid.mjs <pyramid-dir> <day-tiles-dir> [--packs=…|--sample=N]');
const option=name=>process.argv.find(a=>a.startsWith(`--${name}=`))?.split('=')[1];
const INTERIOR=540,GUTTER=16,CELL=572,COLUMNS=160;
const linear=new Float32Array(256).map((_,i)=>{const v=i/255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});
const encode=v=>255*(v<=.0031308?12.92*v:1.055*v**(1/2.4)-.055);

const all=(await readdir(dir)).filter(n=>/^\d+\.pack$/.test(n)).map(n=>Number(n.slice(0,-5))).sort((a,b)=>a-b);
const present=new Set(all);
let chosen=option('packs')?.split(',').map(Number)??all;
if(option('sample')){const n=Number(option('sample')),step=Math.max(1,Math.floor(all.length/n));chosen=all.filter((_,i)=>i%step===0).slice(0,n);}

const packCache=new Map();
async function pack(id){
  if(!packCache.has(id)){
    const bytes=await readFile(join(dir,`${id}.pack`));
    packCache.set(id,{bytes,entries:decodePackHeader(bytes.subarray(0,PACK_HEADER)),tiles:new Map()});
    while(packCache.size>24)packCache.delete(packCache.keys().next().value);
  }
  return packCache.get(id);
}
async function tile(id,level,x,y){
  if(!present.has(id))return null;
  const p=await pack(id),slot=packSlot(level,x,y),[offset,length]=p.entries[slot];
  if(!length)return null;
  if(!p.tiles.has(slot))p.tiles.set(slot,await sharp(p.bytes.subarray(offset,offset+length)).removeAlpha().raw().toBuffer());
  return p.tiles.get(slot);
}
const bmngCache=new Map();
async function bmng(id){
  if(!bmngCache.has(id)){
    let pixels=null;try{pixels=await sharp(await readFile(join(dayTiles,`${id}.avif`))).removeAlpha().raw().toBuffer();}catch{}
    bmngCache.set(id,pixels);while(bmngCache.size>24)bmngCache.delete(bmngCache.keys().next().value);
  }
  return bmngCache.get(id);
}
const at=(pixels,x,y,c)=>pixels[(y*CELL+x)*3+c];

const errors={bmng:[[],[],[],[]],levels:[[],[],[],[]],packs:[],dateline:[],bmngEdge:[]};
const summary=list=>{
  if(!list.length)return null;
  const sorted=Float32Array.from(list).sort();
  return {samples:sorted.length,mean:+(sorted.reduce((a,b)=>a+b,0)/sorted.length).toFixed(2),median:+sorted[sorted.length>>1].toFixed(2),p99:+sorted[Math.floor(sorted.length*.99)].toFixed(2)};
};
// Subsample texels so a pack costs about the same at every level.
const STRIDE=4;

for(const id of chosen){
  const tx=id%COLUMNS,ty=Math.floor(id/COLUMNS),reference=await bmng(id);if(!reference)continue;
  for(let L=1;L<=3;L++){
    const side=1<<L,n=side;
    for(let cy=0;cy<side;cy++)for(let cx=0;cx<side;cx++){
      const pixels=await tile(id,L,cx,cy);if(!pixels)continue;
      // BMNG texels (gx, gy) of this day tile wholly inside this tile: a
      // level-3 tile spans 67.5 of them.
      const x0=Math.ceil(cx*INTERIOR/n),x1=Math.floor((cx+1)*INTERIOR/n),y0=Math.ceil(cy*INTERIOR/n),y1=Math.floor((cy+1)*INTERIOR/n);
      for(let gy=y0;gy<y1;gy+=STRIDE)for(let gx=x0;gx<x1;gx+=STRIDE){
        const lx=gx*n-cx*INTERIOR,ly=gy*n-cy*INTERIOR;
        for(let c=0;c<3;c++){
          let s=0;for(let j=0;j<n;j++)for(let i=0;i<n;i++)s+=linear[at(pixels,GUTTER+lx+i,GUTTER+ly+j,c)];
          errors.bmng[L].push(Math.abs(encode(s/(n*n))-at(reference,GUTTER+gx,GUTTER+gy,c)));
        }
      }
      if(L<3){
        // Against the four children averaged.
        for(let q=0;q<4;q++){
          const child=await tile(id,L+1,cx*2+(q&1),cy*2+(q>>1));if(!child)continue;
          for(let y=0;y<INTERIOR/2;y+=STRIDE)for(let x=0;x<INTERIOR/2;x+=STRIDE)for(let c=0;c<3;c++){
            let s=0;for(let j=0;j<2;j++)for(let i=0;i<2;i++)s+=linear[at(child,GUTTER+2*x+i,GUTTER+2*y+j,c)];
            const px=GUTTER+(q&1)*INTERIOR/2+x,py=GUTTER+(q>>1)*INTERIOR/2+y;
            errors.levels[L].push(Math.abs(encode(s/4)-at(pixels,px,py,c)));
          }
        }
      }
    }
  }
  // East neighbour: pack seams at level 3, or a BMNG-only edge at level 1.
  const east=ty*COLUMNS+(tx+1)%COLUMNS,dateline=tx===COLUMNS-1;
  if(present.has(east)){
    for(let cy=0;cy<8;cy++){
      const a=await tile(id,3,7,cy),b=await tile(east,3,0,cy);if(!a||!b)continue;
      for(let y=GUTTER;y<GUTTER+INTERIOR;y+=2)for(let k=0;k<GUTTER;k++)for(let c=0;c<3;c++)
        (dateline?errors.dateline:errors.packs).push(Math.abs(at(a,GUTTER+INTERIOR+k,y,c)-at(b,GUTTER+k,y,c)));
    }
  }else{
    const neighbour=await bmng(east);
    if(neighbour)for(let cy=0;cy<2;cy++){
      const a=await tile(id,1,1,cy);if(!a)continue;
      for(let by=0;by<INTERIOR/2;by+=2)for(let k=0;k<GUTTER/2;k++)for(let c=0;c<3;c++){
        let s=0;for(let j=0;j<2;j++)for(let i=0;i<2;i++)s+=linear[at(a,GUTTER+INTERIOR+2*k+i,GUTTER+2*by+j,c)];
        errors.bmngEdge.push(Math.abs(encode(s/4)-at(neighbour,GUTTER+k,GUTTER+cy*INTERIOR/2+by,c)));
      }
    }
  }
}
const result={packs:chosen.length,bmng:{1:summary(errors.bmng[1]),2:summary(errors.bmng[2]),3:summary(errors.bmng[3])},levels:{'1-2':summary(errors.levels[1]),'2-3':summary(errors.levels[2])},packs_:summary(errors.packs),dateline:summary(errors.dateline),bmngEdge:summary(errors.bmngEdge)};
console.log(JSON.stringify(result,null,1).replace('"packs_"','"packSeams"'));
