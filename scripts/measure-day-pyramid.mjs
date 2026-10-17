// Lab (docs/lab/day-pyramid-2026-10-17.md): how closely each deep level
// averages back to BMNG. Every level's tile interiors are box-averaged in
// linear light onto the 500 m BMNG grid and compared with the BMNG tile the
// renderer would otherwise show, in 8-bit sRGB steps per channel.
//
//   bun scripts/measure-day-pyramid.mjs <pyramid-dir> <day-tiles-dir>
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const [dir,dayTiles]=process.argv.slice(2);
if(!dir||!dayTiles)throw new Error('Usage: measure-day-pyramid.mjs <pyramid-dir> <day-tiles-dir>');
const manifest=JSON.parse(await readFile(join(dir,'manifest.json'),'utf8'));
const {interior:INTERIOR,gutter:GUTTER}=manifest,CELL=INTERIOR+2*GUTTER;
const linear=new Float32Array(256).map((_,i)=>{const v=i/255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});
const encode=v=>255*(v<=.0031308?12.92*v:1.055*v**(1/2.4)-.055);
const interiorOf=async file=>{
  const pixels=await sharp(await readFile(file)).removeAlpha().raw().toBuffer();
  return {pixels,at:(x,y,c)=>pixels[((y+GUTTER)*CELL+x+GUTTER)*3+c]};
};
const tiles=manifest.tiles.map(key=>key.split('/').map(Number));
const bmng=new Map();
for(let L=1;L<=manifest.depth;L++){
  const level=tiles.filter(t=>t[0]===L);if(!level.length)continue;
  const n=2**L,sums=new Map();
  for(const [,tx,ty] of level){
    const tile=await interiorOf(join(dir,String(L),`${tx}-${ty}.avif`));
    for(let y=0;y<INTERIOR;y++)for(let x=0;x<INTERIOR;x++){
      // Global BMNG texel of this level-L texel.
      const gx=Math.floor((tx*INTERIOR+x)/n),gy=Math.floor((ty*INTERIOR+y)/n),key=gy*86400+gx;
      let s=sums.get(key);if(!s)sums.set(key,s=[0,0,0,0]);
      for(let c=0;c<3;c++)s[c]+=linear[tile.at(x,y,c)];s[3]++;
    }
  }
  const errors=[];
  for(const [key,s] of sums){
    // Texels split between two tiles accumulate both; skip any left partial.
    if(s[3]!==n*n)continue;
    const gx=key%86400,gy=Math.floor(key/86400),id=Math.floor(gy/INTERIOR)*160+Math.floor(gx/INTERIOR);
    if(!bmng.has(id))bmng.set(id,await interiorOf(join(dayTiles,`${id}.avif`)));
    const reference=bmng.get(id);
    for(let c=0;c<3;c++)errors.push(Math.abs(encode(s[c]/s[3])-reference.at(gx%INTERIOR,gy%INTERIOR,c)));
  }
  errors.sort((a,b)=>a-b);
  const mean=errors.reduce((a,b)=>a+b,0)/errors.length;
  console.log(`level ${L}: ${errors.length/3} BMNG texels, mean |Δ| ${mean.toFixed(2)}, median ${errors[errors.length>>1].toFixed(2)}, p99 ${errors[Math.floor(errors.length*.99)].toFixed(2)} (8-bit sRGB)`);
}
