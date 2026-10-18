import {tileDimensions,DAY_PYRAMID_DEPTH} from '../src/scripts/tile-layout.ts';
// Day pyramid: three levels below the 500 m day tiles (250, 125 and 62.5 m),
// over land worldwide, from the ESA WorldCover 2021 v200 Sentinel-2 RGBNIR
// composite. See docs/lab/day-pyramid-global-2026-10-17.md.
//
//   bun scripts/build-day-pyramid.mjs all <sources> <day-tiles> <output> [--rows=3-66] [--jobs=10] [--fetch-jobs=24] [--keep]
//   bun scripts/build-day-pyramid.mjs row <sources> <day-tiles> <output> <row> [--jobs=10] [--lon=w,e]
//   bun scripts/build-day-pyramid.mjs pack <sources> <day-tiles> <output> <row> --tiles=id,id [--debug=dir]
//   bun scripts/build-day-pyramid.mjs provenance <sources> <output>
//
// `all` fetches one row of day tiles at a time with fetch-worldcover.mjs (the
// next row downloads while this one builds), builds it, deletes the overviews
// no later row needs, and pauses while less than 60 GB are free. Outputs are
// day tile packs, <output>/<day tile>.pack with all three levels, and, from
// `provenance`, provenance.json and sources.json. Keep <output> outside the
// release: scripts/build-day-pyramid-packs.mjs repacks it into the release
// packs and index.bin under public/media/earthlight/day-pyramid.
//
// Photometry stays BMNG's (as in docs/lab/day-pyramid-2026-10-17.md), per
// channel in linear light on the day-tile grid:
//
//   tile   = mix(BMNG, S2 · gain + offset, trust)
//   gain   = (low(BMNG) + ε) / (low(S2) + ε),   clamped to [1/8, 8]
//   offset = low(BMNG) − low(S2) · gain
//   low(x) = blur(q · x) / blur(q),  Gaussian σ = 1 texel, ε = 0.005
//
// The offset keeps the low-pass exactly BMNG's where ε and the clamp bend
// the gain (dark water, deep shadow). q is the trust before smoothing, so
// snow, cloud and holes neither show nor bend the gain of their neighbours.
// BMNG under the deep texel is its cubic B-spline, the renderer's own
// magnification, so a texel without trust is the picture the renderer would
// draw without the pyramid. Trust is 0 where (on the 500 m grid):
//   - the land-cover map says "Snow and ice" (class 70) for 2% of the
//     texel or more, ramping to 0 at 12%, dilated by one texel;
//   - fewer than 90% of the composite's samples hold data (0 = no data);
//   - the water is open: no land (any class but 80) within 3 km;
//   - the composite is 2–3 times brighter than BMNG relative to the local
//     ratio (16 km block medians, held within [0.5, 2.5]) and grey (cloud
//     or snow left in the median), or cloud-like samples (bright and flat
//     in visible and near-infrared) fill 12–35% of a texel that BMNG shows
//     dark; built-up land (class 50) is exempt from both;
//   - BMNG is bright and more than twice the composite's local brightness:
//     October 2004 snow over the summer composite.
// Bad texels are dilated by two texels and blurred (σ = 1), so the fallback
// to BMNG is smooth and at least a kilometre wide.
import sharp from 'sharp';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, rm, readdir, stat, statfs, appendFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { loadInventory, rowCells, s2Key, mapKey, cellName, S2_OVERVIEW, MAP_OVERVIEW } from './fetch-worldcover.mjs';
import { encodeDayPack, decodeDayPack, slotMask, daySlot } from '../src/scripts/day-pyramid-pack.ts';

const here=dirname(fileURLToPath(import.meta.url));
const {interior:INTERIOR,gutter:GUTTER,cell:CELL,columns:COLUMNS,rows:ROWS}=tileDimensions('day'),DEPTH=DAY_PYRAMID_DEPTH,P0=240;
const QUALITY=50,EPSILON=.005,SIGMA=1,MIN_FREE=60e9;
const ROW_FIRST=3,ROW_LAST=66; // 83.25° N to 60.75° S: WorldCover's 83° N to 60° S
const option=(name,fallback)=>process.argv.find(a=>a.startsWith(`--${name}=`))?.split('=')[1]??fallback;
const smoothstep=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
const srgbToLinear=v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4;
const DECODE=new Float32Array(256).map((_,i)=>srgbToLinear(i/255));
// sRGB encoding through a 4096-entry table of linear values.
const ENCODE=new Uint8Array(4097).map((_,i)=>{const v=i/4096;return Math.round(255*(v<=.0031308?12.92*v:1.055*v**(1/2.4)-.055));});
const encode=v=>ENCODE[v<=0?0:v>=1?4096:Math.round(v*4096)];

// ---------------------------------------------------------------- sources

function decodeOverview(bytes,layout){
  const {width,height,tileWidth,tileHeight,samples,bits,compression,predictor,offsets,counts}=layout;
  if(compression!==8&&compression!==32946)throw new Error(`Unsupported compression ${compression}`);
  if(bits!==16&&bits!==8)throw new Error(`Unsupported depth ${bits}`);
  const across=Math.ceil(width/tileWidth),out=bits===16?new Uint16Array(width*height*samples):new Uint8Array(width*height*samples);
  for(let t=0;t<offsets.length;t++){
    const raw=inflateSync(bytes.subarray(offsets[t],offsets[t]+counts[t]));
    const tile=bits===16?new Uint16Array(raw.buffer,raw.byteOffset,raw.length/2):new Uint8Array(raw.buffer,raw.byteOffset,raw.length);
    const row=tileWidth*samples;
    if(predictor===2)for(let y=0;y<tileHeight;y++)for(let i=y*row+samples;i<(y+1)*row;i++)tile[i]+=tile[i-samples];
    else if(predictor!==1)throw new Error(`Unsupported predictor ${predictor}`);
    const x0=(t%across)*tileWidth,y0=Math.floor(t/across)*tileHeight;
    const w=Math.min(tileWidth,width-x0),h=Math.min(tileHeight,height-y0);
    for(let y=0;y<h;y++)out.set(tile.subarray(y*row,y*row+w*samples),((y0+y)*width+x0)*samples);
  }
  return out;
}

class Cells {
  constructor(dir){this.dir=dir;this.cache=new Map();}
  async get(key){
    if(this.cache.has(key)){const v=this.cache.get(key);this.cache.delete(key);this.cache.set(key,v);return v;}
    const path=join(this.dir,'cells',cellName(key)+'.ov');
    let value=null;
    try{
      const meta=JSON.parse(await readFile(path+'.json','utf8'));
      value={layout:meta.layout,data:decodeOverview(await readFile(path),meta.layout)};
    }catch(error){if(error.code!=='ENOENT')throw error;}
    this.cache.set(key,value);
    while(this.cache.size>20)this.cache.delete(this.cache.keys().next().value);
    return value;
  }
}

/** Overview samples around a day tile, on a global grid of `perDegree`
 * samples, with longitudes wrapped across the date line. */
async function window(cells,keys,perDegree,cellDegrees,channels,k0,j0,width,height){
  const out=new (channels===4?Uint16Array:Uint8Array)(width*height*channels),side=perDegree*cellDegrees,around=360*perDegree;
  const cellsFor=new Map();
  for(let j=j0;j<j0+height;j+=1){
    const south=90-Math.floor(j/side+1)*cellDegrees;
    if(south<-90||south>=90)continue;
    if(!cellsFor.has(south))cellsFor.set(south,[]);
  }
  for(const south of cellsFor.keys()){
    const rowTop=(90-south-cellDegrees)*perDegree;
    for(let k=k0;k<k0+width;){
      const g=((k%around)+around)%around,west=Math.floor(g/side)*cellDegrees-180,inCell=g%side,span=Math.min(side-inCell,k0+width-k);
      const key=keys.get(`${south},${west}`);
      const cell=key?await cells.get(key):null;
      if(cell){
        for(let j=Math.max(j0,rowTop);j<Math.min(j0+height,rowTop+side);j++){
          const src=((j-rowTop)*side+inCell)*channels;
          out.set(cell.data.subarray(src,src+span*channels),((j-j0)*width+(k-k0))*channels);
        }
      }
      k+=span;
    }
  }
  return out;
}

// ---------------------------------------------------------------- filters

function blur(data,w,h,channels,sigma=SIGMA){
  const radius=Math.ceil(3*sigma),kernel=new Float32Array(2*radius+1);let sum=0;
  for(let i=-radius;i<=radius;i++){kernel[i+radius]=Math.exp(-i*i/(2*sigma*sigma));sum+=kernel[i+radius];}
  for(let i=0;i<kernel.length;i++)kernel[i]/=sum;
  const tmp=new Float32Array(data.length),out=new Float32Array(data.length);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)for(let c=0;c<channels;c++){let v=0;for(let i=-radius;i<=radius;i++)v+=kernel[i+radius]*data[(y*w+Math.max(0,Math.min(w-1,x+i)))*channels+c];tmp[(y*w+x)*channels+c]=v;}
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)for(let c=0;c<channels;c++){let v=0;for(let i=-radius;i<=radius;i++)v+=kernel[i+radius]*tmp[(Math.max(0,Math.min(h-1,y+i))*w+x)*channels+c];out[(y*w+x)*channels+c]=v;}
  return out;
}
function dilate(data,w,h,radius){
  const tmp=new Float32Array(data.length),out=new Float32Array(data.length);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){let v=0;for(let i=-radius;i<=radius;i++)v=Math.max(v,data[y*w+Math.max(0,Math.min(w-1,x+i))]);tmp[y*w+x]=v;}
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){let v=0;for(let i=-radius;i<=radius;i++)v=Math.max(v,tmp[Math.max(0,Math.min(h-1,y+i))*w+x]);out[y*w+x]=v;}
  return out;
}

/** Separable weights mapping output samples to a source axis. `kind` is
 * 'linear' (2 taps) or 'bspline' (4 taps); `at(i)` is the source coordinate
 * in source-sample units (sample centres at integers). */
function axis(count,at,size,kind){
  const taps=kind==='bspline'?4:2,index=new Int32Array(count*taps),weight=new Float32Array(count*taps);
  for(let i=0;i<count;i++){
    const t=at(i),f0=Math.floor(t),f=t-f0;
    const w=kind==='bspline'?[(1-f)**3/6,(4-6*f*f+3*f**3)/6,(1+3*f+3*f*f-3*f**3)/6,f**3/6]:[1-f,f];
    const first=kind==='bspline'?f0-1:f0;
    for(let k=0;k<taps;k++){index[i*taps+k]=Math.max(0,Math.min(size-1,first+k));weight[i*taps+k]=w[k];}
  }
  return {taps,index,weight};
}
function resample(src,w,channels,xs,ys,width,height){
  // Horizontal pass over the source rows the vertical taps reach, then vertical.
  let lo=Infinity,hi=-1;
  for(let i=0;i<ys.index.length;i++)if(ys.weight[i]){lo=Math.min(lo,ys.index[i]);hi=Math.max(hi,ys.index[i]);}
  const out=new Float32Array(width*height*channels),span=width*channels;
  if(hi<0)return out;
  const block=new Float32Array((hi-lo+1)*span),xt=xs.taps,xi=xs.index,xw=xs.weight,yt=ys.taps,yi=ys.index,yw=ys.weight;
  for(let r=lo;r<=hi;r++){
    const from=r*w,o=(r-lo)*span;
    for(let x=0;x<width;x++)for(let k=0;k<xt;k++){
      const wt=xw[x*xt+k];if(!wt)continue;
      const s=(from+xi[x*xt+k])*channels,t=o+x*channels;
      for(let c=0;c<channels;c++)block[t+c]+=wt*src[s+c];
    }
  }
  for(let y=0;y<height;y++)for(let k=0;k<yt;k++){
    const wt=yw[y*yt+k];if(!wt)continue;
    const v=(yi[y*yt+k]-lo)*span,o=y*span;
    for(let i=0;i<span;i++)out[o+i]+=wt*block[v+i];
  }
  return out;
}

// ---------------------------------------------------------------- hot loops
// Small functions: JavaScriptCore optimises them far better than the same
// loops inline in buildPack.

/** Overview samples binned onto the 572² level-0 window. */
function binSamples(s2,nk,k0,j0,X0,Y0,ratio){
  const N=CELL*CELL,sum=new Float32Array(N*3),valid=new Float32Array(N),total=new Float32Array(N),cloudy=new Float32Array(N);
  const bx=new Int32Array(nk),by=new Int32Array(nk);
  for(let k=0;k<nk;k++){bx[k]=Math.floor((k0+k+1/16)/ratio)-X0;by[k]=Math.floor((j0+k+1/16)/ratio)-Y0;}
  for(let j=0;j<nk;j++){
    const y=by[j];if(y<0||y>=CELL)continue;
    for(let k=0;k<nk;k++){
      const x=bx[k];if(x<0||x>=CELL)continue;
      const i=y*CELL+x,s=(j*nk+k)*4;total[i]++;
      const r=s2[s],g=s2[s+1],b=s2[s+2],n=s2[s+3];
      if(!r&&!g&&!b)continue;
      valid[i]++;sum[i*3]+=r;sum[i*3+1]+=g;sum[i*3+2]+=b;
      const hi=r>g?(r>b?r:b):(g>b?g:b),lo=r<g?(r<b?r:b):(g<b?g:b);
      if(b>=1500&&lo>=.8*hi&&n>=.8*hi&&n<=1.3*hi)cloudy[i]++;
    }
  }
  return {sum,valid,total,cloudy};
}

/** Level 3 from the overview: bilinear over the samples that hold data. */
function bilinearLevel(s2,nk,N3,ax,fx,ay,fy){
  const L3=new Float32Array(N3*N3*3),V3=new Float32Array(N3*N3),present=new Float32Array(nk*nk);
  for(let i=0;i<nk*nk;i++)present[i]=s2[i*4]||s2[i*4+1]||s2[i*4+2]?1:0;
  for(let y=0;y<N3;y++){
    const top=ay[y]*nk,wy1=fy[y],wy0=1-wy1;
    for(let x=0;x<N3;x++){
      const a=top+ax[x],b=a+1,c=a+nk,d=c+1,wx1=fx[x],wx0=1-wx1;
      const wa=wx0*wy0*present[a],wb=wx1*wy0*present[b],wc=wx0*wy1*present[c],wd=wx1*wy1*present[d],w=wa+wb+wc+wd;
      const o=y*N3+x;V3[o]=w;
      if(w>0){
        const k=1e-4/w,a4=a*4,b4=b*4,c4=c*4,d4=d*4,o3=o*3;
        L3[o3]=(wa*s2[a4]+wb*s2[b4]+wc*s2[c4]+wd*s2[d4])*k;
        L3[o3+1]=(wa*s2[a4+1]+wb*s2[b4+1]+wc*s2[c4+1]+wd*s2[d4+1])*k;
        L3[o3+2]=(wa*s2[a4+2]+wb*s2[b4+2]+wc*s2[c4+2]+wd*s2[d4+2])*k;
      }
    }
  }
  return {L3,V3};
}

/** Trust × this level's own sample coverage; returns [max, sum] inside. */
function effectiveTrust(w,valid,size,ox,oy){
  let detail=0,sum=0;
  for(let y=0;y<CELL;y++){
    const row=(oy+y)*size+ox,inside=y>=GUTTER&&y<GUTTER+INTERIOR;
    for(let x=0;x<CELL;x++){
      const i=y*CELL+x,v=valid[row+x],t=w[i]*(v>=.5?1:v*v*4*(3-4*v));w[i]=t;
      if(inside&&x>=GUTTER&&x<GUTTER+INTERIOR){if(t>detail)detail=t;sum+=t;}
    }
  }
  return [detail,sum];
}

/** The next coarser level: validity-weighted 2 × 2 means. */
function halve(fine){
  const n=fine.size/2,data=new Float32Array(n*n*3),v=new Float32Array(n*n),fd=fine.data,fv=fine.valid,size=fine.size;
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){
    let w=0,r=0,g=0,b=0;
    for(let t=0;t<4;t++){
      const o=(2*y+(t>>1))*size+2*x+(t&1),ww=fv[o];
      w+=ww;r+=ww*fd[o*3];g+=ww*fd[o*3+1];b+=ww*fd[o*3+2];
    }
    const o=y*n+x;v[o]=w/4;
    if(w>0){data[o*3]=r/w;data[o*3+1]=g/w;data[o*3+2]=b/w;}
  }
  return {origin:[fine.origin[0]/2,fine.origin[1]/2],size:n,data,valid:v};
}

/** mix(BMNG, S2 · gain + offset, trust), sRGB-encoded. */
function composeTile(base,g,shift,w,data,size,ox,oy){
  const pixels=Buffer.alloc(CELL*CELL*3);
  for(let y=0;y<CELL;y++){
    const row=(oy+y)*size+ox;
    for(let x=0;x<CELL;x++){
      const i=y*CELL+x,o=(row+x)*3,t=w[i],p=i*3;
      for(let c=0;c<3;c++){
        const b=base[p+c],v=t>0?b+(data[o+c]*g[p+c]+shift[p+c]-b)*t:b;
        pixels[p+c]=ENCODE[v<=0?0:v>=1?4096:Math.round(v*4096)];
      }
    }
  }
  return pixels;
}

// ---------------------------------------------------------------- one pack

const dayTile=async(dir,id)=>{try{return await readFile(join(dir,`${id}.avif`));}catch{return null;}};

/** BMNG in linear light on the 572² window of day tile (tx, ty): interiors of
 * the tile and its neighbours first, so both sides of a pack edge share one
 * reference; the tile's own gutter only where a neighbour has no file. */
async function bmngWindow(dayTiles,tx,ty){
  const out=new Float32Array(CELL*CELL*3).fill(NaN),sources=[];
  const order=[[0,0],[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]];
  for(const [dx,dy] of order){
    const nx=(tx+dx+COLUMNS)%COLUMNS,ny=ty+dy;if(ny<0||ny>=ROWS)continue;
    const id=ny*COLUMNS+nx,bytes=await dayTile(dayTiles,id);if(!bytes)continue;
    sources.push({tile:id,sha256:createHash('sha256').update(bytes).digest('hex')});
    const pixels=await sharp(bytes).removeAlpha().raw().toBuffer();
    for(let y=GUTTER;y<GUTTER+INTERIOR;y++){
      const gy=y+dy*INTERIOR;if(gy<0||gy>=CELL)continue;
      for(let x=GUTTER;x<GUTTER+INTERIOR;x++){
        const gx=x+dx*INTERIOR;if(gx<0||gx>=CELL)continue;
        const o=(gy*CELL+gx)*3;if(!Number.isNaN(out[o]))continue;
        for(let c=0;c<3;c++)out[o+c]=DECODE[pixels[(y*CELL+x)*3+c]];
      }
    }
    if(dx===0&&dy===0)for(let y=0;y<CELL;y++)for(let x=0;x<CELL;x++){
      const o=(y*CELL+x)*3;if(!Number.isNaN(out[o]))continue;
      for(let c=0;c<3;c++)out[o+c]=DECODE[pixels[(y*CELL+x)*3+c]];
    }
  }
  return {bmng:out,sources};
}

async function buildPack(ctx,id,debug){
  const tx=id%COLUMNS,ty=Math.floor(id/COLUMNS);
  const own=await dayTile(ctx.dayTiles,id);if(!own)return null;
  const X0=tx*INTERIOR-GUTTER,Y0=ty*INTERIOR-GUTTER;
  // Sentinel-2 overview samples (1500/°) covering the 572² level-0 window.
  const s2Ratio=S2_OVERVIEW/P0,k0=Math.floor(X0*s2Ratio)-3,j0=Math.floor(Y0*s2Ratio)-3,nk=Math.ceil(CELL*s2Ratio)+7;
  // Stage times (ms) for the row log: sources, BMNG, statistics, level 3, tiles, encoding.
  const clock=[performance.now()];const mark=()=>clock.push(performance.now());
  const s2=await window(ctx.cells,ctx.s2Keys,S2_OVERVIEW,1,4,k0,j0,nk,nk);
  let anyValid=false;for(let i=0;i<s2.length;i+=4)if(s2[i]){anyValid=true;break;}
  if(!anyValid)return null;
  const mapRatio=MAP_OVERVIEW/3/P0,m0=Math.floor(X0*mapRatio)-2,n0=Math.floor(Y0*mapRatio)-2,nm=Math.ceil(CELL*mapRatio)+5;
  const map=await window(ctx.cells,ctx.mapKeys,MAP_OVERVIEW/3,3,1,m0,n0,nm,nm);
  mark();const {bmng,sources}=await bmngWindow(ctx.dayTiles,tx,ty);mark();

  // Level-0 statistics. Overview sample k sits at (k + 1/16)/1500° from the
  // cell edge (full-resolution pixel 8k); map sample m at (m + 1/32)/750°.
  const N=CELL*CELL,{sum,valid,total,cloudy}=binSamples(s2,nk,k0,j0,X0,Y0,s2Ratio);
  const snow=new Float32Array(N),built=new Float32Array(N),mapped=new Float32Array(N),land=new Float32Array(N),samples=new Float32Array(N);
  for(let j=0;j<nm;j++){
    const y=Math.floor((n0+j+1/32)/mapRatio)-Y0;if(y<0||y>=CELL)continue;
    for(let k=0;k<nm;k++){
      const x=Math.floor((m0+k+1/32)/mapRatio)-X0;if(x<0||x>=CELL)continue;
      const v=map[j*nm+k],i=y*CELL+x;samples[i]++;if(!v)continue;
      mapped[i]++;if(v===70)snow[i]++;else if(v===50)built[i]++;
      if(v!==80)land[i]++;
    }
  }
  // Open water: more than 3 km from land (class 80 or outside the map). The
  // composite's sea has holes and processing seams and nothing to resolve;
  // coasts, rivers and lakes near their shores keep Sentinel-2.
  const nearLand=dilate(new Float32Array(N).map((_,i)=>samples[i]?smoothstep(.02,.1,land[i]/samples[i]):0),CELL,CELL,6);
  const s2Mean=new Float32Array(N*3),ratio=new Float32Array(N).fill(NaN);
  const lum=(a,o)=>.2126*a[o]+.7152*a[o+1]+.0722*a[o+2];
  for(let i=0;i<N;i++){
    if(mapped[i]){snow[i]/=mapped[i];built[i]/=mapped[i];}
    if(!valid[i])continue;
    for(let c=0;c<3;c++)s2Mean[i*3+c]=sum[i*3+c]/valid[i]*1e-4;
    ratio[i]=(lum(s2Mean,i*3)+.01)/(lum(bmng,i*3)+.01);
  }
  // The local Sentinel-2/BMNG luminance ratio: medians of clean, complete
  // texels in 32 × 32-texel blocks (16 km), interpolated, and held within
  // [0.5, 2.5], the range of snow-free tiles. A tile where BMNG's October
  // 2004 snow covers the summer composite thus reads as too dark, not normal.
  const BLOCK=32,blocks=Math.ceil(CELL/BLOCK),medians=new Float32Array(blocks*blocks);
  const clean=[];for(let i=0;i<N;i++)if(total[i]&&valid[i]>=.95*total[i]&&snow[i]<.01)clean.push(ratio[i]);
  clean.sort((a,b)=>a-b);
  const typical=clean.length>=500?clean[clean.length>>1]:1.5;
  for(let by=0;by<blocks;by++)for(let bx=0;bx<blocks;bx++){
    const values=[];
    for(let y=by*BLOCK;y<Math.min(CELL,(by+1)*BLOCK);y++)for(let x=bx*BLOCK;x<Math.min(CELL,(bx+1)*BLOCK);x++){
      const i=y*CELL+x;if(total[i]&&valid[i]>=.95*total[i]&&snow[i]<.01)values.push(ratio[i]);
    }
    values.sort((a,b)=>a-b);
    medians[by*blocks+bx]=Math.max(.5,Math.min(2.5,values.length>=64?values[values.length>>1]:typical));
  }
  const local=resample(medians,blocks,1,axis(CELL,i=>(i+.5)/BLOCK-.5,blocks,'linear'),axis(CELL,i=>(i+.5)/BLOCK-.5,blocks,'linear'),CELL,CELL);
  const snowBad=dilate(new Float32Array(N).map((_,i)=>smoothstep(.02,.12,snow[i])),CELL,CELL,1);
  const urban=dilate(new Float32Array(N).map((_,i)=>smoothstep(.02,.1,built[i])),CELL,CELL,1);
  const bad=new Float32Array(N),reason={land:0,snow:0,empty:0,cloud:0,season:0,water:0};
  for(let i=0;i<N;i++){
    if(!total[i]){bad[i]=1;continue;}
    const empty=1-smoothstep(.6,.9,valid[i]/total[i]);
    let cloud=0,season=0;
    if(valid[i]){
      const o=i*3,hi=Math.max(s2Mean[o],s2Mean[o+1],s2Mean[o+2]),lo=Math.min(s2Mean[o],s2Mean[o+1],s2Mean[o+2]);
      const relative=ratio[i]/local[i];
      // Cloud or snow left in the median: much brighter than usual here, and
      // grey; or cloud-like samples in a texel that BMNG shows dark. Built-up
      // land is exempt: roofs are bright and grey too.
      const bright=smoothstep(2,3,relative)*smoothstep(.65,.85,lo/Math.max(1e-4,hi));
      const speckled=smoothstep(.12,.35,cloudy[i]/valid[i])*(1-smoothstep(.12,.3,lum(bmng,o)));
      cloud=Math.max(bright,speckled)*(1-urban[i]);
      // BMNG much brighter than the composite: October 2004 snow (or the
      // composite's shadowed failures); BMNG's colour cannot carry this detail.
      season=(1-smoothstep(.4,.6,relative))*smoothstep(.12,.25,lum(bmng,o));
    }
    bad[i]=Math.max(empty,snowBad[i],cloud,season,1-nearLand[i]);
    const x=i%CELL,y=Math.floor(i/CELL);
    if(x>=GUTTER&&y>=GUTTER&&x<GUTTER+INTERIOR&&y<GUTTER+INTERIOR&&valid[i]){
      reason.land++;
      if(bad[i]>=.5){if(nearLand[i]<=.5)reason.water++;else if(snowBad[i]>=.5)reason.snow++;else if(empty>=.5)reason.empty++;else if(season>=.5)reason.season++;else reason.cloud++;}
    }
  }
  const q=dilate(bad,CELL,CELL,1).map(v=>1-v);
  const trust0=blur(dilate(bad,CELL,CELL,2),CELL,CELL,1).map(v=>Math.max(0,1-v));
  // Gain from trusted texels only (normalised convolution).
  const qB=new Float32Array(N*3),qS=new Float32Array(N*3);
  for(let i=0;i<N;i++)for(let c=0;c<3;c++){qB[i*3+c]=q[i]*bmng[i*3+c];qS[i*3+c]=q[i]*s2Mean[i*3+c];}
  const bB=blur(qB,CELL,CELL,3),bS=blur(qS,CELL,CELL,3),bq=blur(q,CELL,CELL,1);
  // gain·S2 + offset keeps the low-pass exactly BMNG's even where ε and the
  // clamp bend the gain (dark water, deep shadow): offset = blur(B) − blur(S)·gain.
  const gain=new Float32Array(N*3).fill(1),offset=new Float32Array(N*3);let clamped=0,gains=0;
  for(let i=0;i<N;i++){
    if(bq[i]<1e-3)continue;
    for(let c=0;c<3;c++){
      const lowB=bB[i*3+c]/bq[i],lowS=bS[i*3+c]/bq[i];
      const g=(lowB+EPSILON)/(lowS+EPSILON),limited=Math.max(1/8,Math.min(8,g));
      gain[i*3+c]=limited;offset[i*3+c]=lowB-lowS*limited;gains++;if(limited!==g)clamped++;
    }
  }

  mark();
  // Level 3 from the overview (normalised bilinear over valid samples), then
  // levels 2 and 1 as validity-weighted 2 × 2 means.
  const levels=[];
  const X3=tx*INTERIOR*8-64,Y3=ty*INTERIOR*8-64,N3=INTERIOR*8+128;
  const per3=P0*8,step=S2_OVERVIEW/per3;
  const ax=new Int32Array(N3),fx=new Float32Array(N3),ay=new Int32Array(N3),fy=new Float32Array(N3);
  for(let i=0;i<N3;i++){
    const kx=(X3+i+.5)*step-1/16-k0,ky=(Y3+i+.5)*step-1/16-j0;
    ax[i]=Math.floor(kx);fx[i]=kx-ax[i];ay[i]=Math.floor(ky);fy[i]=ky-ay[i];
  }
  const {L3,V3}=bilinearLevel(s2,nk,N3,ax,fx,ay,fy);
  levels[3]={origin:[X3,Y3],size:N3,data:L3,valid:V3};
  for(let L=2;L>=1;L--)levels[L]=halve(levels[L+1]);

  mark();
  // Tiles: BMNG's B-spline, the gain and the trust at each deep texel.
  const tiles=new Map(),stats={tiles:[0,0,0,0],bytes:[0,0,0,0],trust:0};
  const jobs=[];
  for(let L=1;L<=DEPTH;L++){
    const level=levels[L],s=2**L,side=1<<L;
    for(let cy=0;cy<side;cy++)for(let cx=0;cx<side;cx++){
      const gx0=(tx*side+cx)*INTERIOR-GUTTER,gy0=(ty*side+cy)*INTERIOR-GUTTER;
      const ox=gx0-level.origin[0],oy=gy0-level.origin[1];
      const at=(o0,g0)=>i=>(g0+i+.5)/s-.5-o0;
      const bx=axis(CELL,at(X0,gx0),CELL,'bspline'),by=axis(CELL,at(Y0,gy0),CELL,'bspline');
      const lx=axis(CELL,at(X0,gx0),CELL,'linear'),ly=axis(CELL,at(Y0,gy0),CELL,'linear');
      // Effective trust: the 500 m trust and this level's own sample coverage.
      const w=resample(trust0,CELL,1,lx,ly,CELL,CELL),[detail,sum]=effectiveTrust(w,level.valid,level.size,ox,oy);
      if(L===DEPTH)stats.trust+=sum;
      if(detail<.02)continue;
      const base=resample(bmng,CELL,3,bx,by,CELL,CELL),g=resample(gain,CELL,3,lx,ly,CELL,CELL),shift=resample(offset,CELL,3,lx,ly,CELL,CELL);
      const pixels=composeTile(base,g,shift,w,level.data,level.size,ox,oy);
      const slot=daySlot(L,cx,cy);
      jobs.push(sharp(pixels,{raw:{width:CELL,height:CELL,channels:3}}).avif({quality:QUALITY,effort:2,chromaSubsampling:'4:4:4',bitdepth:8}).toBuffer().then(bytes=>{
        tiles.set(slot,new Uint8Array(bytes));stats.tiles[L]++;stats.bytes[L]+=bytes.length;
      }));
      if(debug&&L===1)await sharp(pixels,{raw:{width:CELL,height:CELL,channels:3}}).png().toFile(join(debug,`${id}-L1-${cx}${cy}.png`));
    }
  }
  mark();await Promise.all(jobs);mark();
  if(debug){
    const png=(data,name)=>sharp(Buffer.from(data.map(v=>Math.round(255*Math.max(0,Math.min(1,v))))),{raw:{width:CELL,height:CELL,channels:1}}).png().toFile(join(debug,`${id}-${name}.png`));
    await png(trust0,'trust');await png(snow,'snow');await png(new Float32Array(N).map((_,i)=>total[i]?valid[i]/total[i]:0),'valid');
    await png(new Float32Array(N).map((_,i)=>valid[i]?smoothstep(.08,.3,cloudy[i]/valid[i]):0),'cloudy');
    await png(new Float32Array(N).map((_,i)=>Number.isNaN(ratio[i])?0:ratio[i]/local[i]/4),"ratio");
    const rgb=a=>Buffer.from(Array.from(a,v=>encode(v)));
    await sharp(rgb(bmng),{raw:{width:CELL,height:CELL,channels:3}}).png().toFile(join(debug,`${id}-bmng.png`));
    await sharp(rgb(s2Mean),{raw:{width:CELL,height:CELL,channels:3}}).png().toFile(join(debug,`${id}-s2.png`));
  }
  if(!tiles.size)return {id,empty:true,reason,typical};
  const pack=encodeDayPack(tiles);
  await writeFile(join(ctx.output,`${id}.pack`),pack);
  return {id,ms:clock.slice(1).map((t,i)=>Math.round(t-clock[i])),tiles:stats.tiles,bytes:pack.length,levelBytes:stats.bytes,trust:stats.trust/(INTERIOR*8)**2,reason,typical,gainClamped:clamped/Math.max(1,gains),sources};
}

// ---------------------------------------------------------------- drivers

async function context(sources,dayTiles,output){
  const inv=await loadInventory(sources),s2Keys=new Map(),mapKeys=new Map();
  for(const f of inv.s2.files){const m=f.key.match(/_([NS])(\d\d)([EW])(\d{3})_S2RGBNIR/);s2Keys.set(`${(m[1]==='N'?1:-1)*+m[2]},${(m[3]==='E'?1:-1)*+m[4]}`,f.key);}
  for(const f of inv.map.files){const m=f.key.match(/_([NS])(\d\d)([EW])(\d{3})_Map/);mapKeys.set(`${(m[1]==='N'?1:-1)*+m[2]},${(m[3]==='E'?1:-1)*+m[4]}`,f.key);}
  return {cells:new Cells(sources),s2Keys,mapKeys,dayTiles,output};
}

/** Day tiles of a row that exist and touch at least one Sentinel-2 file. */
async function rowTiles(ctx,row,[west,east]=[-180,180]){
  const ids=[];
  for(let tx=0;tx<COLUMNS;tx++){
    const id=row*COLUMNS+tx,w=-180+tx*2.25,e=w+2.25;
    if(e<=west||w>=east)continue;
    let touches=false;
    for(let lon=Math.floor(w-.1);lon<e+.1&&!touches;lon++)for(let lat=Math.floor(90-(row+1)*2.25-.1);lat<90-row*2.25+.1;lat++){
      const wrapped=((lon+180)%360+360)%360-180;
      if(ctx.s2Keys.has(`${lat},${wrapped}`)){touches=true;break;}
    }
    if(touches&&await stat(join(ctx.dayTiles,`${id}.avif`)).then(()=>true,()=>false))ids.push(id);
  }
  return ids;
}

function run(args,label){
  return new Promise((ok,fail)=>{
    const child=spawn(process.execPath,args,{stdio:['ignore','pipe','inherit']});
    let out='';child.stdout.on('data',d=>{out+=d;});
    child.on('exit',code=>code===0?ok(out):fail(new Error(`${label} exited with ${code}`)));
  });
}

async function buildRow(sources,dayTiles,output,row,jobs,lon){
  const ctx=await context(sources,dayTiles,output);
  const ids=await rowTiles(ctx,row,lon);
  await mkdir(output,{recursive:true});
  const started=performance.now(),chunks=Array.from({length:Math.min(jobs,ids.length)},(_,i)=>ids.slice(Math.floor(i*ids.length/Math.min(jobs,ids.length)),Math.floor((i+1)*ids.length/Math.min(jobs,ids.length))));
  const results=(await Promise.all(chunks.map((chunk,i)=>run([fileURLToPath(import.meta.url),'pack',sources,dayTiles,output,String(row),`--tiles=${chunk.join(',')}`],`row ${row} part ${i}`)))).flatMap(out=>out.trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)));
  const seconds=(performance.now()-started)/1000;
  const summary={row,seconds,packs:results.filter(r=>!r.empty).length,tiles:results.reduce((s,r)=>s+(r.tiles?r.tiles.reduce((a,b)=>a+b,0):0),0),bytes:results.reduce((s,r)=>s+(r.bytes??0),0),results};
  await mkdir(join(sources,'rows'),{recursive:true});
  await writeFile(join(sources,'rows',`${row}.json`),JSON.stringify(summary));
  console.log(`row ${row}: ${summary.packs} packs, ${summary.tiles} tiles, ${(summary.bytes/2**20).toFixed(1)} MiB in ${seconds.toFixed(0)} s`);
  return summary;
}

async function free(path){const s=await statfs(path);return s.bavail*s.bsize;}

async function buildAll(sources,dayTiles,output,[first,last],jobs,fetchJobs,keep){
  const fetchRow=row=>run([join(here,'fetch-worldcover.mjs'),'fetch',sources,String(row),`--jobs=${fetchJobs}`],`fetch ${row}`).then(out=>{process.stdout.write(out);});
  const log=join(sources,'build.jsonl');
  let next=fetchRow(first);
  for(let row=first;row<=last;row++){
    await next;
    while(await free(sources)<MIN_FREE){console.log(`under 60 GB free (${(await free(sources)/1e9).toFixed(0)} GB); waiting`);await new Promise(r=>setTimeout(r,60000));}
    next=row<last?fetchRow(row+1):Promise.resolve();
    const summary=await buildRow(sources,dayTiles,output,row,jobs);
    await appendFile(log,JSON.stringify({row,seconds:summary.seconds,packs:summary.packs,tiles:summary.tiles,bytes:summary.bytes,free:await free(sources),at:new Date().toISOString()})+'\n');
    if(!keep){
      // Overviews no later row needs: their cells lie wholly north of the next row.
      const needed=new Set();
      if(row<last){const cells=rowCells(row+1);for(const [s,w] of cells.s2)needed.add(cellName(s2Key(s,w)));for(const [s,w] of cells.map)needed.add(cellName(mapKey(s,w)));}
      for(const name of await readdir(join(sources,'cells')).catch(()=>[])){
        const base=name.replace(/\.ov(\.json)?$/,'');
        if(!needed.has(base))await rm(join(sources,'cells',name),{force:true});
      }
    }
    console.log(`  free ${(await free(sources)/1e9).toFixed(0)} GB`);
  }
  await next;
}

async function writeProvenance(sources,output){
  const packs=[];let bytes=0,tiles=0;const levels=[0,0,0,0];
  // Only packs the row builds reported; anything else (a trial) is removed.
  const built=new Set();
  for(const name of await readdir(join(sources,'rows')))for(const result of JSON.parse(await readFile(join(sources,'rows',name),'utf8')).results)if(!result.empty)built.add(result.id);
  for(const name of (await readdir(output)).filter(n=>/^\d+\.pack$/.test(n)&&!built.has(Number(n.slice(0,-5)))))await rm(join(output,name));
  for(const name of (await readdir(output)).filter(n=>/^\d+\.pack$/.test(n))){
    const file=await readFile(join(output,name)),entries=decodeDayPack(file);
    packs.push({id:Number(name.slice(0,-5)),mask:slotMask(entries)});bytes+=file.length;
    entries.forEach(([,length],i)=>{if(length){tiles++;levels[i<4?1:i<20?2:3]++;}});
  }
  packs.sort((a,b)=>a.id-b.id);
  const ledger=(await readFile(join(sources,'ledger.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
  const seen=new Map();for(const entry of ledger)seen.set(entry.key,entry);
  const inv=await loadInventory(sources);
  const rows=(await readFile(join(sources,'build.jsonl'),'utf8').catch(()=>'')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
  const provenance={
    version:1,depth:DEPTH,interior:INTERIOR,gutter:GUTTER,quality:QUALITY,format:'AVIF 4:4:4 8-bit, effort 2; day tile packs: src/scripts/day-pyramid-pack.ts',
    texels:{1:'7.5″ (231 m north–south)',2:'3.75″ (116 m)',3:'1.875″ (58 m)'},
    packs:packs.length,tiles,levels:{1:levels[1],2:levels[2],3:levels[3]},bytes,
    method:'Sentinel-2 × smooth per-channel gain plus offset to BMNG in linear light, so the 500 m low-pass is BMNG\'s; BMNG kept, with a smooth blend, under snow and ice (land-cover class 70), empty composite, open water more than 3 km from land, cloud or snow left in the median, and BMNG\'s October 2004 snow over the summer composite. See docs/lab/day-pyramid-global-2026-10-17.md.',
    sentinel:{product:'ESA WorldCover 10m 2021 v200, Sentinel-2 median L2A RGBNIR composite (overview 1500 px per 1° file, 2.4″)',
      license:'CC BY 4.0',attribution:'ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium',
      doi:'https://doi.org/10.5281/zenodo.7254221',registry:'https://registry.opendata.aws/esa-worldcover-vito-composites',bucket:inv.s2.bucket},
    landCover:{product:'ESA WorldCover 10m 2021 v200 map (overview 2250 px per 3° file, 4.8″), class 70 "Snow and ice"',
      license:'CC BY 4.0',attribution:'© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium',
      doi:'https://doi.org/10.5281/zenodo.7254221',bucket:inv.map.bucket},
    bmng:'NASA Blue Marble Next Generation, October 2004: the release\'s day-tiles/, decoded as published',
    changes:'Overviews resampled to the day-pyramid grid, colour matched to BMNG, blended with BMNG, AVIF-encoded.',
    accessed:inv.accessed.slice(0,10),
    read:{requests:ledger.length,bytes:ledger.reduce((s,e)=>s+e.read,0),s2Files:[...seen.keys()].filter(k=>k.includes('S2RGBNIR')).length,mapFiles:[...seen.keys()].filter(k=>k.endsWith('_Map.tif')).length},
    // The last build of each row; rows rebuilt after a method change count once.
    build:{seconds:[...new Map(rows.map(r=>[r.row,r])).values()].reduce((s,r)=>s+r.seconds,0),rows:new Set(rows.map(r=>r.row)).size,secondsIncludingRebuilds:rows.reduce((s,r)=>s+r.seconds,0)},
    sourcesFile:'sources.json'
  };
  // Every object read, with the ETag it had: [key, ETag, first byte, end byte].
  const list=[...seen.values()].sort((a,b)=>a.key<b.key?-1:1).map(e=>[e.key,e.etag,e.range[0],e.range[1]]);
  await writeFile(join(output,'sources.json'),JSON.stringify({buckets:{s2:inv.s2.bucket,map:inv.map.bucket},files:list})+'\n');
  provenance.sourcesSha256=createHash('sha256').update(await readFile(join(output,'sources.json'))).digest('hex');
  await writeFile(join(output,'provenance.json'),JSON.stringify(provenance,null,1)+'\n');
  console.log(`provenance: ${packs.length} day tile packs, ${tiles} tiles (${levels.slice(1).join(' / ')}), ${(bytes/2**30).toFixed(2)} GiB`);
}

if(import.meta.main){
  const [command,...rest]=process.argv.slice(2).filter(a=>!a.startsWith('--'));
  const jobs=Number(option('jobs',10)),lon=option('lon')?.split(',').map(Number);
  if(command==='pack'){
    const [sources,dayTiles,output]=rest,ids=option('tiles','').split(',').filter(Boolean).map(Number),debug=option('debug');
    const ctx=await context(sources,dayTiles,output);await mkdir(output,{recursive:true});if(debug)await mkdir(debug,{recursive:true});
    sharp.concurrency(2);sharp.cache(false);
    for(const id of ids){const result=await buildPack(ctx,id,debug);if(result)process.stdout.write(JSON.stringify(result)+'\n');}
  }else if(command==='row')await buildRow(rest[0],rest[1],rest[2],Number(rest[3]),jobs,lon);
  else if(command==='all'){
    const [a,b]=option('rows',`${ROW_FIRST}-${ROW_LAST}`).split('-').map(Number);
    await buildAll(rest[0],rest[1],rest[2],[a,b??a],jobs,Number(option('fetch-jobs',24)),process.argv.includes('--keep'));
  }else if(command==='provenance')await writeProvenance(rest[0],rest[1]);
  else throw new Error('Usage: build-day-pyramid.mjs all|row|pack|provenance … (see the header)');
}
