// Global measured cloud properties for one day, from quantized NASA GIBS maps.
// One sensor supplies every cloud: NOAA-20 VIIRS daytime cloud-top height and
// optical thickness (CLDPROP, ~13:30 local solar time). Aqua and Terra MODIS
// supply only the thermodynamic phase. Nothing fills a gap with cloud.
//   bun scripts/prepare-cloud-properties.mjs [cache-directory]
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import sharp from 'sharp';
sharp.concurrency(2);sharp.cache(false);
const date='2026-09-22';
const cache=process.argv[2]||'/tmp/earthlight-cloud-properties-cache';
const out=`public/media/earthlight/cloud-properties/${date}`;
await mkdir(cache,{recursive:true});await mkdir(out+'/tiles',{recursive:true});
// Fine grid 32768 x 16384 (1.22 km at the equator, near the 1 km product),
// fetched as 4 x 4 chunks. Tiles carry opacity at half that resolution; the
// overview carries opacity, height, phase and quality at an eighth.
const CHUNK=8192,GRID=16384,OVERVIEW=4096,COARSE=8192;
const wms='https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi';
const layers={
 tau:'VIIRS_NOAA20_Cloud_Optical_Thickness',
 height:'VIIRS_NOAA20_Cloud_Top_Height_Day',
 footprint:'VIIRS_NOAA20_CorrectedReflectance_TrueColor',
 aquaPhase:'MODIS_Aqua_Cloud_Phase_Optical_Properties',
 terraPhase:'MODIS_Terra_Cloud_Phase_Optical_Properties',
 aquaPartial:'MODIS_Aqua_Cloud_Optical_Thickness_PCL',
};
function mapURL(layer,bbox,width,height){
 const u=new URL(wms);
 u.search=new URLSearchParams({SERVICE:'WMS',VERSION:'1.3.0',REQUEST:'GetMap',LAYERS:layer,STYLES:'',FORMAT:'image/png',TRANSPARENT:'TRUE',CRS:'CRS:84',BBOX:bbox.join(','),WIDTH:String(width),HEIGHT:String(height),TIME:date}).toString();
 return u.href;
}
async function download(url,file){
 try{return await readFile(file);}catch{}
 for(let attempt=0;;attempt++){
  try{const r=await fetch(url);if(!r.ok)throw Error(`${r.status}: ${url}`);const b=Buffer.from(await r.arrayBuffer());await writeFile(file,b);return b;}
  catch(e){if(attempt>=3)throw e;await new Promise(r=>setTimeout(r,2000*(attempt+1)));}
 }
}
async function raster(layer,bbox,width,height,name){
 const data=await download(mapURL(layer,bbox,width,height),`${cache}/${date}-${name}.png`);
 const {data:pixels,info}=await sharp(data,{limitInputPixels:false}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 if(info.width!==width||info.height!==height)throw Error(`Unexpected size for ${name}`);
 return pixels;
}
async function palette(name){
 const xml=String(await download(`https://gibs.earthdata.nasa.gov/colormaps/v1.3/${name}.xml`,`${cache}/${name}.xml`));
 const map=new Map();
 for(const match of xml.matchAll(/<ColorMapEntry\s+([^>]+)\/>/g)){
  const a=Object.fromEntries([...match[1].matchAll(/(\w+)="([^"]*)"/g)].map(m=>[m[1],m[2]]));
  if(a.transparent==='true')continue;
  const values=(a.value??a.sourceValue)?.match(/[-+]?\d+(?:\.\d+)?/g)?.map(Number);if(!values?.length)continue;
  const [r,g,b]=a.rgb.split(',').map(Number);map.set((r<<16)|(g<<8)|b,values.reduce((s,v)=>s+v,0)/values.length);
 }
 return map;
}
const heightMap=await palette('MODIS_VIIRS_Cloud_Top_Height'),tauMap=await palette('MODIS_VIIRS_Cloud_Optical_Thickness'),phaseMap=await palette('MODIS_Cloud_Phase_Optical_Properties');
const decode=(pixels,i,map)=>pixels[i+3]===255?map.get((pixels[i]<<16)|(pixels[i+1]<<8)|pixels[i+2]):undefined;
// Plane-parallel albedo of a conservative cloud with asymmetry g = 0.85 and
// the two-stream diffusivity sqrt(3): R = 0.13 tau / (1 + 0.13 tau). Opacity
// stores R, which averages linearly over area, unlike tau. The renderer's
// column optical depth is -ln(1 - R) = ln(1 + 0.13 tau).
const albedo=tau=>.13*tau/(1+.13*tau);
const latitudeWeight=(row,rows)=>Math.cos(((row+.5)/rows*180-90)*Math.PI/180);

// Clouds that VIIRS detected and placed (top height) without retrieving their
// optical thickness: mostly partly cloudy pixels, and Sun zenith angles beyond
// the retrieval. They take the same day's median MODIS Aqua partly-cloudy
// retrieval (|latitude| < 60 degrees), not a tuned value.
const partial=await raster(layers.aquaPartial,[-180,-90,180,90],COARSE,COARSE/2,'aqua-partial-8192');
const partialValues=[];
for(let y=0;y<COARSE/2;y++){if(Math.abs((y+.5)/(COARSE/2)*180-90)>60)continue;
 for(let x=0;x<COARSE;x+=2){const t=decode(partial,(y*COARSE+x)*4,tauMap);if(t!==undefined)partialValues.push(t);}}
partialValues.sort((a,b)=>a-b);
const partialTau=partialValues[Math.floor(partialValues.length/2)],partialOpacity=albedo(partialTau);

const opacityGrid=new Uint8Array(GRID*GRID/2);
const opacitySum=new Float32Array(OVERVIEW*OVERVIEW/2),heightSum=new Float32Array(OVERVIEW*OVERVIEW/2),heightWeight=new Float32Array(OVERVIEW*OVERVIEW/2);
const area={total:0,measured:0,partial:0,clear:0};
// ISCCP-style types of measured pixels: top below 3.2 / 6.5 km (~680 / 440 hPa)
// and optical thickness below 3.6 / 23.
const types=Array.from({length:3},()=>new Float64Array(3));
const typeOf=(h,t)=>[h<3200?0:h<6500?1:2,t<3.6?0:t<23?1:2];
for(let cy=0;cy<4;cy++)for(let cx=0;cx<4;cx++){
 const bbox=[-180+cx*90,90-(cy+1)*45,-180+(cx+1)*90,90-cy*45],name=`${cx}-${cy}`;
 const tau=await raster(layers.tau,bbox,CHUNK,CHUNK/2,`tau-${name}`),height=await raster(layers.height,bbox,CHUNK,CHUNK/2,`height-${name}`);
 for(let y=0;y<CHUNK/2;y++){
  const row=cy*CHUNK/2+y,weight=latitudeWeight(row,GRID);
  for(let x=0;x<CHUNK;x++){
   const i=(y*CHUNK+x)*4,t=decode(tau,i,tauMap),h=decode(height,i,heightMap),column=cx*CHUNK+x;
   let opacity=0;
   if(t!==undefined){
    opacity=albedo(t);area.measured+=weight;
    if(h!==undefined){const [a,b]=typeOf(h,t);types[a][b]+=weight;}
   }else if(h!==undefined){opacity=partialOpacity;area.partial+=weight;}
   else area.clear+=weight;
   area.total+=weight;
   // Four fine pixels make one tile texel; sum in quarter units.
   const g=(row>>1)*GRID+(column>>1);opacityGrid[g]=Math.min(255,opacityGrid[g]+Math.round(opacity*255/4));
   const o=(row>>3)*OVERVIEW+(column>>3);opacitySum[o]+=opacity/64;
   if(opacity>0&&h!==undefined){heightSum[o]+=opacity*Math.min(16000,h);heightWeight[o]+=opacity;}
  }
 }
 console.log('chunk',name);
}

// Phase and observation footprint at 4.9 km, reduced to the overview.
const footprint=await raster(layers.footprint,[-180,-90,180,90],COARSE,COARSE/2,'footprint-8192');
const coarseHeight=await raster(layers.height,[-180,-90,180,90],COARSE,COARSE/2,'height-8192');
const phases=[await raster(layers.aquaPhase,[-180,-90,180,90],COARSE,COARSE/2,'aqua-phase-8192'),await raster(layers.terraPhase,[-180,-90,180,90],COARSE,COARSE/2,'terra-phase-8192')];
const iceSum=new Float32Array(OVERVIEW*OVERVIEW/2),iceCount=new Uint8Array(OVERVIEW*OVERVIEW/2),known=new Uint8Array(OVERVIEW*OVERVIEW/2);
const phaseSource=[0,0];
for(let y=0;y<COARSE/2;y++)for(let x=0;x<COARSE;x++){
 const i=(y*COARSE+x)*4,o=(y>>1)*OVERVIEW+(x>>1);
 if(footprint[i]+footprint[i+1]+footprint[i+2]>=6||coarseHeight[i+3])known[o]++;
 // MODIS classes: 2 liquid water, 3 ice, 4 uncertain. Aqua first (nearer in
 // time to NOAA-20), Terra only where Aqua has no cloud phase.
 for(const [s,p] of phases.entries()){const c=decode(p,i,phaseMap);if(c===undefined)continue;
  iceSum[o]+=c===3?1:c===4?.5:0;iceCount[o]++;phaseSource[s]++;break;}
}
// Properties extend from the nearest measured texel into clear and unknown
// texels, so filtering at a cloud edge never pulls a top toward the ground.
// Opacity alone decides where cloud exists.
function extend(values,valid){
 const n=values.length,queue=new Int32Array(n),seen=new Uint8Array(n);let head=0,tail=0;
 for(let p=0;p<n;p++)if(valid[p]){seen[p]=1;queue[tail++]=p;}
 while(head<tail){const p=queue[head++],x=p%OVERVIEW,y=(p/OVERVIEW)|0;
  for(const q of [y*OVERVIEW+(x+1)%OVERVIEW,y*OVERVIEW+(x+OVERVIEW-1)%OVERVIEW,y>0?p-OVERVIEW:-1,y<OVERVIEW/2-1?p+OVERVIEW:-1])
   if(q>=0&&!seen[q]){seen[q]=1;values[q]=values[p];queue[tail++]=q;}}
}
const top=new Float32Array(OVERVIEW*OVERVIEW/2),ice=new Float32Array(OVERVIEW*OVERVIEW/2);
for(let p=0;p<top.length;p++){top[p]=heightWeight[p]>0?heightSum[p]/heightWeight[p]:0;ice[p]=iceCount[p]?iceSum[p]/iceCount[p]:.5;}
extend(top,heightWeight.map(w=>w>0?1:0));extend(ice,iceCount);
const overview=Buffer.alloc(OVERVIEW*OVERVIEW/2*4);let unknownArea=0,overviewArea=0;
for(let p=0;p<top.length;p++){
 const w=latitudeWeight((p/OVERVIEW)|0,OVERVIEW/2);overviewArea+=w;unknownArea+=w*(1-known[p]/4);
 overview[p*4]=Math.round(Math.min(1,opacitySum[p])*255);
 overview[p*4+1]=Math.round(Math.min(16000,top[p])/16000*255);
 overview[p*4+2]=Math.round(ice[p]*255);
 overview[p*4+3]=Math.round(known[p]/4*255);
}
// AVIF 4:4:4 at quality 80: 4.2 MB instead of 17 MB lossless. Opacity RMS
// error 6/255 and height 230 m; tiles replace the opacity below ~10 km.
await sharp(overview,{raw:{width:OVERVIEW,height:OVERVIEW/2,channels:4}}).avif({quality:80,effort:5,chromaSubsampling:'4:4:4'}).toFile(out+'/overview.avif');

// Opacity tiles in the cloud atlas layout: 32 x 16 tiles of 512 texels with
// 16-texel neighbour gutters. Tiles without any cloud are left out; the
// overview already resolves them.
const interior=512,gutter=16,cell=544,columns=32,rows=16;
const tileManifest={version:1,width:GRID,height:GRID/2,interior,gutter,columns,rows,quality:65,tiles:[],bytes:0};
for(let ty=0;ty<rows;ty++)for(let tx=0;tx<columns;tx++){
 const id=ty*columns+tx,pixels=Buffer.alloc(cell*cell);let any=0;
 for(let y=0;y<cell;y++)for(let x=0;x<cell;x++){
  const px=(tx*interior+x-gutter+GRID)%GRID,py=Math.max(0,Math.min(GRID/2-1,ty*interior+y-gutter));
  any|=pixels[y*cell+x]=opacityGrid[py*GRID+px];
 }
 if(!any)continue;
 const encoded=await sharp(pixels,{raw:{width:cell,height:cell,channels:1}}).toColourspace('b-w').avif({quality:65,effort:5,chromaSubsampling:'4:4:4'}).toBuffer();
 await writeFile(`${out}/tiles/${id}.avif`,encoded);
 tileManifest.tiles.push(id);tileManifest.bytes+=encoded.length;
}
await writeFile(out+'/tiles/manifest.json',JSON.stringify(tileManifest));
const overviewBytes=(await readFile(out+'/overview.avif')).length;
const fraction=v=>+(v/area.total).toFixed(4);
const manifest={
 date,
 grid:{overview:[OVERVIEW,OVERVIEW/2],tiles:[GRID,GRID/2],fine:[CHUNK*4,CHUNK*2]},
 encoding:{overview:'R: opacity R = 0.13 tau / (1 + 0.13 tau), area mean of 8 x 8 fine pixels; G: cloud-top height / 16 km, opacity-weighted, extended from the nearest cloud; B: ice fraction (MODIS liquid 0, ice 1, uncertain 0.5), extended likewise; A: fraction observed by NOAA-20',tiles:'Luminance: opacity, area mean of 2 x 2 fine pixels'},
 sources:{
  geometry:{satellite:'NOAA-20',sensor:'VIIRS',product:'CLDPROP_L2_VIIRS_NOAA20 (NASA continuity cloud properties)',layers:[layers.tau,layers.height],localTime:'about 13:30 at the equator (ascending, daytime)',example:mapURL(layers.tau,[-180,45,-90,90],CHUNK,CHUNK/2)},
  footprint:{layer:layers.footprint,use:'Observed area: corrected reflectance present or a cloud-top height retrieved'},
  phase:{layers:[layers.aquaPhase,layers.terraPhase],use:'Ice fraction only; Aqua first, Terra where Aqua has no phase',pixels:{aqua:phaseSource[0],terra:phaseSource[1]}},
  partialThickness:{layer:layers.aquaPartial,use:'Median partly-cloudy optical thickness at |latitude| < 60, assigned to VIIRS clouds with a top height but no retrieved thickness',tau:partialTau},
  palettes:['MODIS_VIIRS_Cloud_Top_Height','MODIS_VIIRS_Cloud_Optical_Thickness','MODIS_Cloud_Phase_Optical_Properties'].map(n=>`https://gibs.earthdata.nasa.gov/colormaps/v1.3/${n}.xml`),
  credit:'NASA Earth Science Data and Information System (ESDIS) Global Imagery Browse Services (GIBS); NASA Atmosphere SIPS cloud products from NOAA-20 VIIRS, Aqua and Terra MODIS.',
  licence:'NASA data and imagery, no restriction on use (NASA Earth Science Data and Information Policy); credit NASA GIBS.',
 },
 area:{measured:fraction(area.measured),partial:fraction(area.partial),clear:fraction(area.clear),unknown:+(unknownArea/overviewArea).toFixed(4)},
 types:{rows:'low < 3.2 km, middle < 6.5 km, high',columns:'tau < 3.6, < 23, thicker',fractionOfGlobe:types.map(r=>[...r].map(fraction))},
 bytes:{overview:overviewBytes,tiles:tileManifest.bytes,tileCount:tileManifest.tiles.length},
 limits:'One daytime overpass per place, so the picture is a mosaic of ~13:30 local solar times; the date line joins observations about 24 h apart. Only the highest layer is measured; lower decks under it are not reconstructed. Phase comes from MODIS 1-2 h later or earlier. Night and polar areas beyond the daytime swaths are unknown and render without cloud. Bases and vertical profiles are inferred in the shader from phase, height and thickness.',
};
await writeFile(`${out}/manifest.json`,JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({area:manifest.area,types:manifest.types.fractionOfGlobe,partialTau,bytes:manifest.bytes}));
