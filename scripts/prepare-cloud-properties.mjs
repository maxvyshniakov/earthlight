// Global measured cloud properties for one day, from quantized NASA GIBS maps.
// One sensor supplies every cloud: NOAA-20 VIIRS daytime cloud-top height and
// optical thickness (CLDPROP, ~13:30 local solar time), and for partly cloudy
// pixels the reflectance of the same overpass. Aqua and Terra MODIS supply
// only the thermodynamic phase. Nothing fills a gap with cloud.
//   bun scripts/prepare-cloud-properties.mjs [cache-directory]
// CLOUD_PROPERTIES_GRID=<file> also writes the raw 2.4 km opacity grid
// (uint8, 16384 x 8192) for encoding experiments.
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
 reflectance:'VIIRS_NOAA20_CorrectedReflectance_TrueColor',
 height:'VIIRS_NOAA20_Cloud_Top_Height_Day',
 footprint:'VIIRS_NOAA20_CorrectedReflectance_TrueColor',
 aquaPhase:'MODIS_Aqua_Cloud_Phase_Optical_Properties',
 terraPhase:'MODIS_Terra_Cloud_Phase_Optical_Properties',
 aquaPartial:'MODIS_Aqua_Cloud_Optical_Thickness_PCL',
};
function mapURL(layer,bbox,width,height,format='image/png'){
 const u=new URL(wms);
 u.search=new URLSearchParams({SERVICE:'WMS',VERSION:'1.3.0',REQUEST:'GetMap',LAYERS:layer,STYLES:'',FORMAT:format,...(format==='image/png'?{TRANSPARENT:'TRUE'}:{}),CRS:'CRS:84',BBOX:bbox.join(','),WIDTH:String(width),HEIGHT:String(height),TIME:date}).toString();
 return u.href;
}
async function download(url,file){
 try{return await readFile(file);}catch{}
 for(let attempt=0;;attempt++){
  try{const r=await fetch(url);if(!r.ok)throw Error(`${r.status}: ${url}`);const b=Buffer.from(await r.arrayBuffer());await writeFile(file,b);return b;}
  catch(e){if(attempt>=3)throw e;await new Promise(r=>setTimeout(r,2000*(attempt+1)));}
 }
}
async function raster(layer,bbox,width,height,name,format='image/png'){
 const data=await download(mapURL(layer,bbox,width,height,format),`${cache}/${date}-${name}.${format==='image/png'?'png':'jpg'}`);
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
// Plane-parallel albedo of a conservative cloud with the two-stream
// diffusivity sqrt(3): R = c tau / (1 + c tau), c = (1 - g) sqrt(3) / 2.
// The retrievals use liquid droplets (g = 0.85, c = 0.13) and the Collection 6
// rough ice aggregate (g = 0.75, c = 0.2165); the same tau of ice reflects
// more. Uncertain phase mixes c by the MODIS ice fraction. Opacity stores R,
// which averages linearly over area, unlike tau. The renderer's column optical
// depth is -ln(1 - R) = ln(1 + c tau).
const LIQUID=.13,ICE=.2165;
const albedo=(tau,ice)=>{const c=LIQUID+(ICE-LIQUID)*ice;return c*tau/(1+c*tau);};
const latitudeWeight=(row,rows)=>Math.cos(((row+.5)/rows*180-90)*Math.PI/180);

// Clouds that VIIRS detected and placed (top height) without retrieving their
// optical thickness: partly cloudy pixels, and Sun zenith angles or surfaces
// beyond the retrieval. Over dark surfaces their opacity comes from the
// overpass's own reflectance (below). Elsewhere they take the same day's
// median MODIS Aqua partly-cloudy retrieval (|latitude| < 60 degrees).
const partial=await raster(layers.aquaPartial,[-180,-90,180,90],COARSE,COARSE/2,'aqua-partial-8192');
const partialValues=[];
for(let y=0;y<COARSE/2;y++){if(Math.abs((y+.5)/(COARSE/2)*180-90)>60)continue;
 for(let x=0;x<COARSE;x+=2){const t=decode(partial,(y*COARSE+x)*4,tauMap);if(t!==undefined)partialValues.push(t);}}
partialValues.sort((a,b)=>a-b);
const partialTau=partialValues[Math.floor(partialValues.length/2)];

// Phase, observation footprint and clear-sky reflectance at 4.9 km.
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
function extend(values,valid,width=OVERVIEW){
 const n=values.length,queue=new Int32Array(n),seen=new Uint8Array(n);let head=0,tail=0;
 for(let p=0;p<n;p++)if(valid[p]){seen[p]=1;queue[tail++]=p;}
 while(head<tail){const p=queue[head++],x=p%width,y=(p/width)|0;
  for(const q of [y*width+(x+1)%width,y*width+(x+width-1)%width,y>0?p-width:-1,y<n/width-1?p+width:-1])
   if(q>=0&&!seen[q]){seen[q]=1;values[q]=values[p];queue[tail++]=q;}}
}
const ice=new Float32Array(OVERVIEW*OVERVIEW/2);
for(let p=0;p<ice.length;p++)ice[p]=iceCount[p]?iceSum[p]/iceCount[p]:.5;
extend(ice,iceCount);

// Partly cloudy opacity from the overpass's own reflectance. The Corrected
// Reflectance true colour is a published enhancement of Rayleigh-corrected
// reflectance (0-1.1 in, bytes out, piecewise linear through these knots);
// its red band (VIIRS I1, 0.64 um) is undone to reflectance. A cloud of albedo
// A over a surface of reflectance s reflects s + A (1 - s)^2 / (1 - A s), so
// A = d / ((1 - s)^2 + d s) with d the excess over s. The clear-sky s is the
// median red reflectance of observed, cloud-free 4.9 km pixels in 157 km
// blocks, extended into overcast blocks and interpolated. Measured pixels of
// the same day then calibrate the inversion: by optical thickness bin, the mean
// inverted albedo against the mean stored albedo. It is used only where it can
// be checked, over dark surfaces (s <= 0.15) within 60 degrees of the equator;
// deserts, snow, sea ice and the low Sun near the poles keep the median.
const stretch=[[0,0],[30,110],[60,160],[120,210],[190,240],[255,255]];
const reflectanceOf=Float32Array.from({length:256},(_,b)=>{for(let k=1;k<stretch.length;k++)if(b<=stretch[k][1]){const [x0,y0]=stretch[k-1],[x1,y1]=stretch[k];return (x0+(b-y0)/(y1-y0)*(x1-x0))*1.1/255;}return 1.1;});
const BLOCK=32,blockColumns=COARSE/BLOCK,blockRows=COARSE/2/BLOCK,clearSky=new Float32Array(blockColumns*blockRows),clearValid=new Uint8Array(clearSky.length);
for(let by=0;by<blockRows;by++)for(let bx=0;bx<blockColumns;bx++){
 const values=[];
 for(let y=by*BLOCK;y<(by+1)*BLOCK;y++)for(let x=bx*BLOCK;x<(bx+1)*BLOCK;x++){const i=(y*COARSE+x)*4;if(!coarseHeight[i+3]&&footprint[i]+footprint[i+1]+footprint[i+2]>=6)values.push(reflectanceOf[footprint[i]]);}
 if(values.length>=40){values.sort((a,b)=>a-b);clearSky[by*blockColumns+bx]=values[values.length>>1];clearValid[by*blockColumns+bx]=1;}
}
extend(clearSky,clearValid,blockColumns);
function surfaceReflectance(row,column){
 const u=(column+.5)/(CHUNK*4)*blockColumns-.5,v=Math.min(blockRows-1,Math.max(0,(row+.5)/(CHUNK*2)*blockRows-.5));
 const x0=Math.floor(u),y0=Math.floor(v),y1=Math.min(blockRows-1,y0+1),fx=u-x0,fy=v-y0,a=(x0+blockColumns)%blockColumns,b=(x0+1)%blockColumns;
 return (clearSky[y0*blockColumns+a]*(1-fx)+clearSky[y0*blockColumns+b]*fx)*(1-fy)+(clearSky[y1*blockColumns+a]*(1-fx)+clearSky[y1*blockColumns+b]*fx)*fy;
}
const inverted=(byte,surface)=>{const d=Math.max(0,reflectanceOf[byte]-surface);return Math.min(1,d/((1-surface)*(1-surface)+d*surface));};
const latitudeOf=row=>90-(row+.5)/(CHUNK*2)*180;
const usable=(row,surface)=>Math.abs(latitudeOf(row))<=60&&surface<=.15;
const iceAt=(row,column)=>ice[(row>>3)*OVERVIEW+(column>>3)];
const tauBin=t=>Math.min(9,Math.max(0,Math.floor(Math.log2(Math.max(1,t))*1.5)));

async function chunk(cx,cy){
 const bbox=[-180+cx*90,90-(cy+1)*45,-180+(cx+1)*90,90-cy*45],name=`${cx}-${cy}`;
 return {
  tau:await raster(layers.tau,bbox,CHUNK,CHUNK/2,`tau-${name}`),
  height:await raster(layers.height,bbox,CHUNK,CHUNK/2,`height-${name}`),
  reflectance:await raster(layers.reflectance,bbox,CHUNK,CHUNK/2,`reflectance-${name}`,'image/jpeg'),
 };
}
// Pass 1: calibration of the inversion against measured pixels.
const calibration=Array.from({length:10},()=>({weight:0,inverted:0,stored:0}));
for(let cy=0;cy<4;cy++)for(let cx=0;cx<4;cx++){
 const {tau,height,reflectance}=await chunk(cx,cy);
 for(let y=0;y<CHUNK/2;y++){
  const row=cy*CHUNK/2+y,weight=latitudeWeight(row,GRID);
  for(let x=0;x<CHUNK;x++){
   const i=(y*CHUNK+x)*4,column=cx*CHUNK+x,t=decode(tau,i,tauMap);
   if(t===undefined||decode(height,i,heightMap)===undefined)continue;
   const surface=surfaceReflectance(row,column);if(!usable(row,surface))continue;
   const bin=calibration[tauBin(t)];
   bin.weight+=weight;bin.inverted+=weight*inverted(reflectance[(y*CHUNK+x)*4],surface);bin.stored+=weight*albedo(t,iceAt(row,column));
  }
 }
}
const calibrationTable=[[0,0],...calibration.filter(b=>b.weight>0).map(b=>[b.inverted/b.weight,b.stored/b.weight]),[1,1]];
for(let k=1;k<calibrationTable.length;k++)for(let j=0;j<2;j++)calibrationTable[k][j]=Math.max(calibrationTable[k][j],calibrationTable[k-1][j]+1e-6);
const calibrated=a=>{for(let k=1;k<calibrationTable.length;k++){const [x0,y0]=calibrationTable[k-1],[x1,y1]=calibrationTable[k];if(a<=x1)return y0+(a-x0)/(x1-x0)*(y1-y0);}return 1;};
console.log('calibration',JSON.stringify(calibrationTable.map(r=>r.map(v=>+v.toFixed(3)))));

const opacityGrid=new Uint8Array(GRID*GRID/2);
const opacitySum=new Float32Array(OVERVIEW*OVERVIEW/2),heightSum=new Float32Array(OVERVIEW*OVERVIEW/2),heightWeight=new Float32Array(OVERVIEW*OVERVIEW/2);
const area={total:0,measured:0,partial:0,partialReflectance:0,clear:0};
const partialOpacity={reflectance:0,median:0},measuredOpacity={phase:0,liquid:0};
// ISCCP-style types of measured pixels: top below 3.2 / 6.5 km (~680 / 440 hPa)
// and optical thickness below 3.6 / 23.
const types=Array.from({length:3},()=>new Float64Array(3));
const typeOf=(h,t)=>[h<3200?0:h<6500?1:2,t<3.6?0:t<23?1:2];
// Pass 2: opacity, height and types.
for(let cy=0;cy<4;cy++)for(let cx=0;cx<4;cx++){
 const {tau,height,reflectance}=await chunk(cx,cy);
 for(let y=0;y<CHUNK/2;y++){
  const row=cy*CHUNK/2+y,weight=latitudeWeight(row,GRID);
  for(let x=0;x<CHUNK;x++){
   const i=(y*CHUNK+x)*4,t=decode(tau,i,tauMap),h=decode(height,i,heightMap),column=cx*CHUNK+x;
   let opacity=0;
   if(t!==undefined){
    opacity=albedo(t,iceAt(row,column));area.measured+=weight;
    measuredOpacity.phase+=weight*opacity;measuredOpacity.liquid+=weight*albedo(t,0);
    if(h!==undefined){const [a,b]=typeOf(h,t);types[a][b]+=weight;}
   }else if(h!==undefined){
    const surface=surfaceReflectance(row,column);area.partial+=weight;
    if(usable(row,surface)){opacity=calibrated(inverted(reflectance[i],surface));area.partialReflectance+=weight;partialOpacity.reflectance+=weight*opacity;}
    else{opacity=albedo(partialTau,iceAt(row,column));partialOpacity.median+=weight*opacity;}
   }else area.clear+=weight;
   area.total+=weight;
   // Four fine pixels make one tile texel; sum in quarter units.
   const g=(row>>1)*GRID+(column>>1);opacityGrid[g]=Math.min(255,opacityGrid[g]+Math.round(opacity*255/4));
   const o=(row>>3)*OVERVIEW+(column>>3);opacitySum[o]+=opacity/64;
   if(opacity>0&&h!==undefined){heightSum[o]+=opacity*Math.min(16000,h);heightWeight[o]+=opacity;}
  }
 }
 console.log('chunk',cx,cy);
}
if(process.env.CLOUD_PROPERTIES_GRID)await writeFile(process.env.CLOUD_PROPERTIES_GRID,opacityGrid);

const top=new Float32Array(OVERVIEW*OVERVIEW/2);
for(let p=0;p<top.length;p++)top[p]=heightWeight[p]>0?heightSum[p]/heightWeight[p]:0;
extend(top,heightWeight.map(w=>w>0?1:0));
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
// overview already resolves them. Measured opacity is noisier than the
// plates: AVIF quality 48 keeps all tiles near 15 MB (65: 25 MB) at an
// opacity RMS error of about 7.5/255; effort 7 saves little and 9 is too slow.
const interior=512,gutter=16,cell=544,columns=32,rows=16,TILE_QUALITY=48;
const tileManifest={version:1,width:GRID,height:GRID/2,interior,gutter,columns,rows,quality:TILE_QUALITY,tiles:[],bytes:0};
for(let ty=0;ty<rows;ty++)for(let tx=0;tx<columns;tx++){
 const id=ty*columns+tx,pixels=Buffer.alloc(cell*cell);let any=0;
 for(let y=0;y<cell;y++)for(let x=0;x<cell;x++){
  const px=(tx*interior+x-gutter+GRID)%GRID,py=Math.max(0,Math.min(GRID/2-1,ty*interior+y-gutter));
  any|=pixels[y*cell+x]=opacityGrid[py*GRID+px];
 }
 if(!any)continue;
 const encoded=await sharp(pixels,{raw:{width:cell,height:cell,channels:1}}).toColourspace('b-w').avif({quality:TILE_QUALITY,effort:5,chromaSubsampling:'4:4:4'}).toBuffer();
 await writeFile(`${out}/tiles/${id}.avif`,encoded);
 tileManifest.tiles.push(id);tileManifest.bytes+=encoded.length;
}
await writeFile(out+'/tiles/manifest.json',JSON.stringify(tileManifest));
const overviewBytes=(await readFile(out+'/overview.avif')).length;
const fraction=v=>+(v/area.total).toFixed(4);
const manifest={
 date,
 grid:{overview:[OVERVIEW,OVERVIEW/2],tiles:[GRID,GRID/2],fine:[CHUNK*4,CHUNK*2]},
 encoding:{overview:'R: opacity R = c tau / (1 + c tau), c = 0.13 liquid to 0.2165 ice by the ice fraction, area mean of 8 x 8 fine pixels; G: cloud-top height / 16 km, opacity-weighted, extended from the nearest cloud; B: ice fraction (MODIS liquid 0, ice 1, uncertain 0.5), extended likewise; A: fraction observed by NOAA-20',tiles:`Luminance: opacity, area mean of 2 x 2 fine pixels, AVIF quality ${TILE_QUALITY}`},
 sources:{
  geometry:{satellite:'NOAA-20',sensor:'VIIRS',product:'CLDPROP_L2_VIIRS_NOAA20 (NASA continuity cloud properties)',layers:[layers.tau,layers.height],localTime:'about 13:30 at the equator (ascending, daytime)',example:mapURL(layers.tau,[-180,45,-90,90],CHUNK,CHUNK/2)},
  footprint:{layer:layers.footprint,use:'Observed area: corrected reflectance present or a cloud-top height retrieved'},
  phase:{layers:[layers.aquaPhase,layers.terraPhase],use:'Ice fraction only; Aqua first, Terra where Aqua has no phase',pixels:{aqua:phaseSource[0],terra:phaseSource[1]}},
  partial:{
   use:'VIIRS clouds with a top height but no retrieved thickness. Over dark surfaces (clear-sky red reflectance <= 0.15) within 60 degrees of the equator: albedo inverted from the same overpass red reflectance against the local clear sky, calibrated by optical thickness bin against measured pixels. Elsewhere: the median MODIS Aqua partly cloudy thickness.',
   reflectance:{layer:layers.reflectance,format:'image/jpeg',stretch,clearSky:'median red reflectance of observed cloud-free 4.9 km pixels in 157 km blocks, extended and interpolated',calibration:calibrationTable.map(r=>r.map(v=>+v.toFixed(4)))},
   median:{layer:layers.aquaPartial,tau:partialTau},
   meanOpacity:{reflectance:+(partialOpacity.reflectance/Math.max(1e-9,area.partialReflectance)).toFixed(4),median:+(partialOpacity.median/Math.max(1e-9,area.partial-area.partialReflectance)).toFixed(4)},
  },
  albedo:'R = c tau / (1 + c tau), c = (1 - g) sqrt(3) / 2: liquid g 0.85 (c 0.13), Collection 6 ice g 0.75 (c 0.2165), mixed by ice fraction',
  palettes:['MODIS_VIIRS_Cloud_Top_Height','MODIS_VIIRS_Cloud_Optical_Thickness','MODIS_Cloud_Phase_Optical_Properties'].map(n=>`https://gibs.earthdata.nasa.gov/colormaps/v1.3/${n}.xml`),
  credit:'NASA Earth Science Data and Information System (ESDIS) Global Imagery Browse Services (GIBS); NASA Atmosphere SIPS cloud products from NOAA-20 VIIRS, Aqua and Terra MODIS.',
  licence:'NASA data and imagery, no restriction on use (NASA Earth Science Data and Information Policy); credit NASA GIBS.',
 },
 // Contributions to the global mean nadir opacity (area-weighted, fine grid).
 budget:{measured:fraction(measuredOpacity.phase),measuredWithLiquidRelation:fraction(measuredOpacity.liquid),partialFromReflectance:fraction(partialOpacity.reflectance),partialFromMedian:fraction(partialOpacity.median)},
 area:{measured:fraction(area.measured),partial:fraction(area.partial),partialFromReflectance:fraction(area.partialReflectance),clear:fraction(area.clear),unknown:+(unknownArea/overviewArea).toFixed(4)},
 types:{rows:'low < 3.2 km, middle < 6.5 km, high',columns:'tau < 3.6, < 23, thicker',fractionOfGlobe:types.map(r=>[...r].map(fraction))},
 bytes:{overview:overviewBytes,tiles:tileManifest.bytes,tileCount:tileManifest.tiles.length},
 limits:'One daytime overpass per place, so the picture is a mosaic of ~13:30 local solar times; the date line joins observations about 24 h apart. Only the highest layer is measured; lower decks under it are not reconstructed. Phase comes from MODIS 1-2 h later or earlier. Night and polar areas beyond the daytime swaths are unknown and render without cloud. Bases and vertical profiles are inferred in the shader from phase, height and thickness.',
};
await writeFile(`${out}/manifest.json`,JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({area:manifest.area,budget:manifest.budget,types:manifest.types.fractionOfGlobe,partial:manifest.sources.partial.meanOpacity,partialTau,bytes:manifest.bytes}));
