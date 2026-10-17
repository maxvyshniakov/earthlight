// Lab (docs/lab/day-pyramid-2026-10-17.md): read one region of the ESA
// WorldCover 2021 Sentinel-2 RGBNIR median composite and area-average it onto
// the deepest day-pyramid grid (level 5, 2^5 × the 86400-px BMNG grid).
//
// Source: s3://esa-worldcover-s2/rgbnir/2021, CC BY 4.0, 1° Cloud-Optimized
// GeoTIFFs at 0.3″ (EPSG:4326). Only the region's byte ranges are read; the
// result stays outside the repository.
//
//   bun scripts/fetch-sentinel-mosaic.mjs <output-dir> [west south east north]
//
// The default box is the south-east level-1 quadrant of BMNG tile 4253 (Cairo,
// Giza and the Nile, 30.375–31.5° E, 29.25–30.375° N) plus a 1/16° margin for
// the 16-px gutters of every level.
import { fromUrl } from 'geotiff';
import { mkdir, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const output=process.argv[2];
if(!output)throw new Error('Usage: fetch-sentinel-mosaic.mjs <output-dir> [west south east north]');
const [west,south,east,north]=process.argv.length>=7?process.argv.slice(3,7).map(Number):[30.3125,29.1875,31.5625,30.4375];
const SOURCE=12000,TARGET=7680; // pixels per degree: 0.3″ source, level-5 grid
const BLOCK=25,OUT=16;           // 25 source pixels → 16 target pixels, exactly
const sx0=Math.round((west+180)*SOURCE),sy0=Math.round((90-north)*SOURCE);
const width=Math.round((east-west)*SOURCE),height=Math.round((north-south)*SOURCE);
if([sx0,sy0,width,height].some(v=>v%BLOCK))throw new Error('Box must align to 25 source pixels (1/480°)');
const outWidth=width/BLOCK*OUT,outHeight=height/BLOCK*OUT;
const bucket='https://esa-worldcover-s2.s3.eu-central-1.amazonaws.com/';
const keyFor=(lat,lon)=>{
  const la=(lat<0?'S':'N')+String(Math.abs(lat)).padStart(2,'0'),lo=(lon<0?'W':'E')+String(Math.abs(lon)).padStart(3,'0');
  return `rgbnir/2021/${la}/ESA_WorldCover_10m_2021_v200_${la}${lo}_S2RGBNIR.tif`;
};

// Area weights: target pixel o covers source [o·25/16, (o+1)·25/16).
const weights=[];
for(let o=0;o<OUT;o++){
  const a=o*BLOCK/OUT,b=(o+1)*BLOCK/OUT,row=[];
  for(let i=Math.floor(a);i<Math.ceil(b);i++)row.push([i,(Math.min(b,i+1)-Math.max(a,i))*OUT/BLOCK]);
  weights.push(row);
}

await mkdir(output,{recursive:true});
const images=new Map(),sources=[];
async function image(lat,lon){
  const key=keyFor(lat,lon);
  if(!images.has(key)){
    const head=await fetch(bucket+key,{method:'HEAD'});
    if(!head.ok)throw new Error(`${key}: ${head.status}`);
    sources.push({url:bucket+key,bytes:Number(head.headers.get('content-length')),etag:head.headers.get('etag'),lastModified:head.headers.get('last-modified')});
    const tiff=await fromUrl(bucket+key,{cacheSize:256});
    images.set(key,await tiff.getImage(0));
  }
  return images.get(key);
}

// Source rows are read in pieces that never cross an internal 1024-row tile
// boundary, so no compressed block is fetched twice. Rows carry over until a
// whole 25-row group can be averaged.
const file=createWriteStream(join(output,'level5.rgb16'));
const digest=createHash('sha256');
let carry=new Float32Array(0),carryRows=0,zero=0,written=0;
const horizontal=new Float32Array(BLOCK*outWidth*3);
for(let y=sy0;y<sy0+height;){
  const lat=89-Math.floor(y/SOURCE),inTile=y%SOURCE;
  const rows=Math.min(1024-inTile%1024,SOURCE-inTile,sy0+height-y);
  const strip=new Float32Array(rows*width*3);
  for(let x=sx0;x<sx0+width;){
    const lon=Math.floor(x/SOURCE)-180,col=x%SOURCE,cols=Math.min(SOURCE-col,sx0+width-x);
    const raster=await (await image(lat,lon)).readRasters({window:[col,inTile,col+cols,inTile+rows],samples:[0,1,2],interleave:true});
    for(let r=0;r<rows;r++)for(let c=0;c<cols;c++)for(let k=0;k<3;k++){
      const v=raster[(r*cols+c)*3+k];if(!v)zero++;
      strip[(r*width+x-sx0+c)*3+k]=v;
    }
    x+=cols;
  }
  const all=new Float32Array((carryRows+rows)*width*3);all.set(carry);all.set(strip,carry.length);
  const total=carryRows+rows,groups=Math.floor(total/BLOCK);
  for(let g=0;g<groups;g++){
    horizontal.fill(0);
    for(let r=0;r<BLOCK;r++){
      const base=(g*BLOCK+r)*width*3;
      for(let b=0;b<outWidth/OUT;b++)for(let o=0;o<OUT;o++){
        const target=(r*outWidth+b*OUT+o)*3;
        for(const [i,w] of weights[o]){const s=base+(b*BLOCK+i)*3;horizontal[target]+=w*all[s];horizontal[target+1]+=w*all[s+1];horizontal[target+2]+=w*all[s+2];}
      }
    }
    const out=new Uint16Array(OUT*outWidth*3);
    for(let o=0;o<OUT;o++)for(let i=0;i<outWidth*3;i++){
      let v=0;for(const [r,w] of weights[o])v+=w*horizontal[r*outWidth*3+i];
      out[o*outWidth*3+i]=Math.round(v);
    }
    const bytes=Buffer.from(out.buffer);digest.update(bytes);
    if(!file.write(bytes))await new Promise(resolve=>file.once('drain',resolve));
    written+=OUT;
  }
  carryRows=total-groups*BLOCK;carry=all.slice(groups*BLOCK*width*3);
  y+=rows;
  process.stdout.write(`\r${written}/${outHeight} rows`);
}
await new Promise(resolve=>file.end(resolve));
const meta={
  product:'ESA WorldCover 10m 2021 v200, Sentinel-2 median L2A RGBNIR composite',
  license:'CC BY 4.0',
  attribution:'ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium',
  doi:'https://doi.org/10.5281/zenodo.7254221',
  registry:'https://registry.opendata.aws/esa-worldcover-vito-composites',
  accessed:new Date().toLocaleDateString('sv'),
  bands:'B04, B03, B02 (red, green, blue), reflectance × 10000',
  box:{west,south,east,north},grid:{pixelsPerDegree:TARGET,left:Math.round((west+180)*TARGET),top:Math.round((90-north)*TARGET),width:outWidth,height:outHeight},
  resampling:'area average of 25 × 25 source pixels to 16 × 16, linear reflectance',
  zeroSamples:zero,file:'level5.rgb16',sha256:digest.digest('hex'),sources
};
await writeFile(join(output,'level5.json'),JSON.stringify(meta,null,2));
console.log(`\n${outWidth} × ${outHeight}, ${zero} zero samples, ${sources.length} source files`);
