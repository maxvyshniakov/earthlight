// Global measured cloud properties for one day, from quantized NASA GIBS maps.
// One sensor supplies every cloud: NOAA-20 VIIRS daytime cloud-top height and
// optical thickness (CLDPROP, ~13:30 local solar time), and for partly cloudy
// pixels the reflectance of the same overpass. Aqua and Terra MODIS supply
// only the thermodynamic phase. Nothing fills a gap with cloud. The water
// mask of the local terrain map (earth-terrain-8192-v2.dem) bounds the sun-glint
// screen. The day's sea-ice concentration (GHRSST MUR) rides along for the
// surface under the clouds.
//   bun scripts/prepare-cloud-properties.mjs [cache-directory] [YYYY-MM-DD]
// The day defaults to 2026-09-22. A new day renders only once it is listed in
// CLOUD_PROPERTIES_DATES (src/scripts/cloud-properties.ts).
// CLOUD_PROPERTIES_GRID=<file> also writes the raw 2.4 km opacity grid
// (uint8, 16384 x 8192) for encoding experiments.
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import sharp from 'sharp';
import {decodeTerrain} from '../src/scripts/earth-terrain.ts';
sharp.concurrency(2);sharp.cache(false);
const cache=process.argv[2]||'/tmp/earthlight-cloud-properties-cache';
const date=process.argv[3]||'2026-09-22';
if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)throw Error(`Not a UTC day: ${date}`);
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
 seaIce:'GHRSST_L4_MUR_Sea_Ice_Concentration',
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
// Requests that end at the antimeridian come back with damaged outer columns:
// a dark JPEG edge, and PNG layers missing pixels in polar requests. Columns
// within 0.03 degrees of 180 copy the nearest intact column on their own side;
// across the date line lies another day's pass.
const EDGE=.03;
async function raster(layer,bbox,width,height,name,format='image/png'){
 const data=await download(mapURL(layer,bbox,width,height,format),`${cache}/${date}-${name}.${format==='image/png'?'png':'jpg'}`);
 const {data:pixels,info}=await sharp(data,{limitInputPixels:false}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 if(info.width!==width||info.height!==height)throw Error(`Unexpected size for ${name}`);
 const edge=Math.ceil(EDGE/((bbox[2]-bbox[0])/width));
 for(const [from,to] of [...(bbox[0]===-180?Array.from({length:edge},(_,x)=>[edge,x]):[]),...(bbox[2]===180?Array.from({length:edge},(_,x)=>[width-1-edge,width-1-x]):[])])
  for(let y=0;y<height;y++)pixels.copyWithin((y*width+to)*4,(y*width+from)*4,(y*width+from)*4+4);
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
const heightMap=await palette('MODIS_VIIRS_Cloud_Top_Height'),tauMap=await palette('MODIS_VIIRS_Cloud_Optical_Thickness'),phaseMap=await palette('MODIS_Cloud_Phase_Optical_Properties'),seaIceMap=await palette('GHRSST_Sea_Ice_Concentration');
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
// inverted albedo against the mean stored albedo, over dark surfaces
// (s <= 0.15) within 60 degrees of the equator, where it can be checked.
// Deserts, snow, sea ice and the low Sun near the poles keep the median. The
// two blend. Large overcast areas have no clear block, and the extension
// copies the nearest clear block into them: where dark and bright sources meet
// there, s jumps along a staircase of blocks, and a switch at s = 0.15 drew
// median veils with stepped edges. The weight of the inversion is a ramp over
// s 0.12 to 0.2 per block, blurred over about one block (binomial, 5 taps) and
// interpolated, times a ramp over latitude 57 to 63 degrees.
const stretch=[[0,0],[30,110],[60,160],[120,210],[190,240],[255,255]];
const reflectanceOf=Float32Array.from({length:256},(_,b)=>{for(let k=1;k<stretch.length;k++)if(b<=stretch[k][1]){const [x0,y0]=stretch[k-1],[x1,y1]=stretch[k];return (x0+(b-y0)/(y1-y0)*(x1-x0))*1.1/255;}return 1.1;});
const BLOCK=32,blockColumns=COARSE/BLOCK,blockRows=COARSE/2/BLOCK,clearSky=new Float32Array(blockColumns*blockRows),clearValid=new Uint8Array(clearSky.length),darkest=new Float32Array(clearSky.length).fill(Infinity);
for(let by=0;by<blockRows;by++)for(let bx=0;bx<blockColumns;bx++){
 const values=[],observed=[];
 for(let y=by*BLOCK;y<(by+1)*BLOCK;y++)for(let x=bx*BLOCK;x<(bx+1)*BLOCK;x++){const i=(y*COARSE+x)*4;if(footprint[i]+footprint[i+1]+footprint[i+2]<6)continue;observed.push(reflectanceOf[footprint[i]]);if(!coarseHeight[i+3])values.push(reflectanceOf[footprint[i]]);}
 if(values.length>=40){values.sort((a,b)=>a-b);clearSky[by*blockColumns+bx]=values[values.length>>1];clearValid[by*blockColumns+bx]=1;}
 if(observed.length>=40){observed.sort((a,b)=>a-b);darkest[by*blockColumns+bx]=observed[Math.floor(observed.length*.05)];}
}
extend(clearSky,clearValid,blockColumns);
// A cloud only brightens its surface (s + A (1 - s)^2 / (1 - A s) >= s), so a
// block without clear pixels is no brighter than the 5th percentile of its own
// observed pixels. Without this bound the extension carried the clear sky of
// the sea-ice edge some 600 km north over open ocean (22 September 2026,
// Southern Ocean, 16 W to 6 E), and its partly cloudy pixels took the median.
for(let b=0;b<clearSky.length;b++)if(!clearValid[b])clearSky[b]=Math.min(clearSky[b],darkest[b]);
function blockField(field,row,column){
 const u=(column+.5)/(CHUNK*4)*blockColumns-.5,v=Math.min(blockRows-1,Math.max(0,(row+.5)/(CHUNK*2)*blockRows-.5));
 const x0=Math.floor(u),y0=Math.floor(v),y1=Math.min(blockRows-1,y0+1),fx=u-x0,fy=v-y0,a=(x0+blockColumns)%blockColumns,b=(x0+1)%blockColumns;
 return (field[y0*blockColumns+a]*(1-fx)+field[y0*blockColumns+b]*fx)*(1-fy)+(field[y1*blockColumns+a]*(1-fx)+field[y1*blockColumns+b]*fx)*fy;
}
const surfaceReflectance=(row,column)=>blockField(clearSky,row,column);
const inverted=(byte,surface)=>{const d=Math.max(0,reflectanceOf[byte]-surface);return Math.min(1,d/((1-surface)*(1-surface)+d*surface));};
const latitudeOf=row=>90-(row+.5)/(CHUNK*2)*180;
const usable=(row,surface)=>Math.abs(latitudeOf(row))<=60&&surface<=.15;
const ramp=(x,a,b)=>{const t=Math.min(1,Math.max(0,(x-a)/(b-a)));return t*t*(3-2*t);};
const darkSurface=clearSky.map(s=>ramp(s,.2,.12));
for(const [step,count,wrap] of [[1,blockColumns,true],[blockColumns,blockRows,false]]){
 const source=darkSurface.slice();
 for(let p=0;p<darkSurface.length;p++){const k=step===1?p%blockColumns:(p/blockColumns)|0;let v=0;
  for(let d=-2;d<=2;d++){const q=wrap?(k+d+count)%count:Math.min(count-1,Math.max(0,k+d));v+=[1,4,6,4,1][d+2]/16*source[p+(q-k)*step];}
  darkSurface[p]=v;}
}
const trusted=(row,column,glint)=>ramp(Math.abs(latitudeOf(row)),63,57)*Math.max(blockField(darkSurface,row,column),glint);
const iceAt=(row,column)=>ice[(row>>3)*OVERVIEW+(column>>3)];
const tauBin=t=>Math.min(9,Math.max(0,Math.floor(Math.log2(Math.max(1,t))*1.5)));

// Sun glint. The VIIRS cloud mask flags part of the glint over calm sea as
// partly cloudy, with a top height and no optical thickness: on 22 September
// 2026 about half of the observed water within 15 degrees of the specular
// direction, against a fifth beyond 25 degrees. Such pixels are only 0.03 to
// 0.04 brighter than the clear glint beside them, while the 157 km clear sky,
// short of clear pixels there, comes from darker blocks; the inversion turned
// glint into a deck. The view geometry comes from a circular sun-synchronous
// orbit for NOAA-20 (824 km, 98.74 degrees, 101.44 min, ascending node 13:25
// local mean time). Its one free parameter, the time of the day's first
// ascending node, is fitted to the day's own glint: the phase at which clear
// water within 15 degrees of the specular direction is brightest against the
// rest. Each pixel takes the latest ascending pass of its local day whose
// 3,040 km swath covers it, as the composite draws later passes over earlier.
// In the brightest glint VIIRS also retrieved an optical thickness, up to
// tau ~10, under a top below 400 m: a fifth of the water within 5 degrees of
// the specular direction on the two swaths at the date line, 1.6% on other
// tropical swaths, against 0.01 to 0.03% of tropical water outside the glint.
// Within the glint (full weight below 15 degrees, none beyond 30) over water,
// such pixels count as partly cloudy. Partly cloudy pixels there are inverted
// against the glint itself: the mean of the 20 km cell's observed water that
// is clear, flagged with a top below 1 km (where the flags in excess of the
// rest of the swath lie) or retrieved glint, wherever it is brighter than the
// clear sky. Higher flagged tops stay out of it, so cloud edges in the glint
// do not raise their own reference. The dark-surface test does not apply
// there, and the calibration leaves out retrieved glint.
const terrain=gunzipSync(await readFile(new URL('../public/media/earthlight/earth-terrain-8192-v2.dem',import.meta.url)));
const waterMask=decodeTerrain(terrain.buffer.slice(terrain.byteOffset,terrain.byteOffset+terrain.byteLength)).levels[0].data;
// Natural Earth 1:10m ocean mask of the terrain map at 4.9 km, rows south to north.
const water=(y,x)=>waterMask[((COARSE/2-1-y)*COARSE+x)*3+2]>=128;
const GLINT_TOP=400,REFERENCE_TOP=1000,ORBIT={altitude:824,inclination:98.74,period:101.44,node:13+25/60,swath:3040};
function glintGeometry(phase){
 const rad=Math.PI/180,R=6371,I=ORBIT.inclination*rad,P=ORBIT.period,half=ORBIT.swath/2/R;
 const day=Date.parse(date+'T00:00:00Z')/864e5-10957.5,meanSun=t=>280.46+.9856474*(day+t/1440);
 const sidereal=t=>(280.46061837+360.98564736629*(day+t/1440))*rad;
 const sun=t=>{const n=day+t/1440,g=(357.528+.9856003*n)*rad,l=(meanSun(t)+1.915*Math.sin(g)+.02*Math.sin(2*g))*rad,e=(23.439-4e-7*n)*rad;
  const d=Math.asin(Math.sin(e)*Math.sin(l)),o=Math.atan2(Math.cos(e)*Math.sin(l),Math.cos(l))-sidereal(t);return [Math.cos(d)*Math.cos(o),Math.cos(d)*Math.sin(o),Math.sin(d)];};
 const satellite=t=>{const u=2*Math.PI*(t-phase)/P,O=(meanSun(t)+15*(ORBIT.node-12))*rad,s=sidereal(t);
  const x=Math.cos(O)*Math.cos(u)-Math.sin(O)*Math.sin(u)*Math.cos(I),y=Math.sin(O)*Math.cos(u)+Math.cos(O)*Math.sin(u)*Math.cos(I),z=Math.sin(u)*Math.sin(I);
  return [x*Math.cos(s)+y*Math.sin(s),-x*Math.sin(s)+y*Math.cos(s),z];};
 const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
 // Glint angle in degrees at a point (time t in minutes from 00:00 UTC); NaN where no pass covers it.
 return (latitude,longitude)=>{
  const a=latitude*rad,o=longitude*rad,p=[Math.cos(a)*Math.cos(o),Math.cos(a)*Math.sin(o),Math.sin(a)],u0=Math.asin(Math.max(-1,Math.min(1,Math.sin(a)/Math.sin(I))));
  let angle=NaN,latest=-Infinity;
  for(let k=-2;k<18;k++){
   let t=phase+(k+u0/(2*Math.PI))*P;const g=satellite(t);if(Math.abs(((Math.atan2(g[1],g[0])-o)/rad+540)%360-180)>25)continue;
   // Closest approach: where the point is square to the ground track.
   for(let n=0;n<4;n++){const s0=satellite(t-.02),s1=satellite(t),s2=satellite(t+.02);t-=(dot(p,s2)-dot(p,s0))/.04/((dot(p,s2)-2*dot(p,s1)+dot(p,s0))/4e-4);}
   const s=satellite(t);if(Math.acos(Math.min(1,dot(p,s)))>half||t/60+longitude/15<0||t/60+longitude/15>=24||t<=latest)continue;
   latest=t;const l=sun(t),c=dot(p,l);if(c<=0){angle=NaN;continue;}
   const v=s.map((x,j)=>x*(R+ORBIT.altitude)-p[j]*R);angle=Math.acos(Math.min(1,dot(p.map((x,j)=>2*c*x-l[j]),v)/Math.hypot(...v)))/rad;
  }
  return angle;
 };
}
const glintSamples=[];
for(let y=Math.round(COARSE/2/3);y<COARSE/3;y+=12)for(let x=0;x<COARSE;x+=24){const i=(y*COARSE+x)*4;
 if(!coarseHeight[i+3]&&footprint[i]+footprint[i+1]+footprint[i+2]>=6&&water(y,x))glintSamples.push([90-(y+.5)/(COARSE/2)*180,(x+.5)/COARSE*360-180,reflectanceOf[footprint[i]]]);}
const glintContrast=phase=>{const g=glintGeometry(phase),sum=[0,0],count=[0,0];
 for(const [latitude,longitude,r] of glintSamples){const a=g(latitude,longitude);if(!(a>=0))continue;const k=a<15?0:1;sum[k]+=r;count[k]++;}
 return sum[0]/count[0]/(sum[1]/count[1]);};
let glintPhase=0,glintBest=0;
for(let phase=0;phase<ORBIT.period;phase+=1){const c=glintContrast(phase);if(c>glintBest){glintBest=c;glintPhase=phase;}}
for(let phase=glintPhase-1;phase<=glintPhase+1;phase+=.1){const c=glintContrast(phase);if(c>glintBest){glintBest=c;glintPhase=phase;}}
if(glintBest<2)throw Error(`No glint fit (contrast ${glintBest.toFixed(2)})`);
console.log('glint',glintPhase.toFixed(1),'min, contrast',glintBest.toFixed(2));
// Glint angles on 20 km cells (90 degrees where unknown or beyond 62 degrees).
const GLINT=2048,glintAngle=new Float32Array(GLINT*GLINT/2).fill(90);
{const g=glintGeometry(glintPhase);
 for(let y=0;y<GLINT/2;y++){const latitude=90-(y+.5)/(GLINT/2)*180;if(Math.abs(latitude)>62)continue;
  for(let x=0;x<GLINT;x++){const a=g(latitude,(x+.5)/GLINT*360-180);if(a>=0)glintAngle[y*GLINT+x]=a;}}}
function cellField(field,row,column){
 const u=(column+.5)/16-.5,v=Math.min(GLINT/2-1,Math.max(0,(row+.5)/16-.5));
 const x0=Math.floor(u),y0=Math.floor(v),y1=Math.min(GLINT/2-1,y0+1),fx=u-x0,fy=v-y0,a=(x0+GLINT)%GLINT,b=(x0+1)%GLINT;
 return (field[y0*GLINT+a]*(1-fx)+field[y0*GLINT+b]*fx)*(1-fy)+(field[y1*GLINT+a]*(1-fx)+field[y1*GLINT+b]*fx)*fy;
}
const glintWeight=(row,column)=>water(row>>2,column>>2)?ramp(cellField(glintAngle,row,column),30,15):0;
const glintSum=new Float32Array(GLINT*GLINT/2),glintCount=new Uint16Array(GLINT*GLINT/2);

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
   const i=(y*CHUNK+x)*4,column=cx*CHUNK+x,t=decode(tau,i,tauMap),h=decode(height,i,heightMap),low=h<GLINT_TOP;
   if((t===undefined?!(h>=REFERENCE_TOP):low)&&reflectance[i]+reflectance[i+1]+reflectance[i+2]>=6&&water(row>>2,column>>2)){const c=(row>>4)*GLINT+(column>>4);glintSum[c]+=reflectanceOf[reflectance[i]];glintCount[c]++;}
   if(t===undefined||h===undefined||low&&glintWeight(row,column)>0)continue;
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
const glintSky=new Float32Array(GLINT*GLINT/2),glintValid=new Uint8Array(GLINT*GLINT/2);
for(let c=0;c<glintSky.length;c++)if(glintCount[c]>=32){glintSky[c]=glintSum[c]/glintCount[c];glintValid[c]=1;}
extend(glintSky,glintValid,GLINT);

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
   const glint=h!==undefined?glintWeight(row,column):0,retrievedGlint=t!==undefined&&h<GLINT_TOP?glint:0;
   let opacity=0;
   if(t!==undefined){
    const measured=albedo(t,iceAt(row,column)),share=weight*(1-retrievedGlint);
    opacity=(1-retrievedGlint)*measured;area.measured+=share;
    measuredOpacity.phase+=share*measured;measuredOpacity.liquid+=share*albedo(t,0);
    if(h!==undefined){const [a,b]=typeOf(h,t);types[a][b]+=share;}
   }
   if(t===undefined&&h!==undefined||retrievedGlint>0){
    const share=t===undefined?1:retrievedGlint,surface=surfaceReflectance(row,column),median=albedo(partialTau,iceAt(row,column));
    const trust=trusted(row,column,glint);let partial=median;
    if(trust>0){
     const a=calibrated(inverted(reflectance[i],surface+glint*Math.max(0,cellField(glintSky,row,column)-surface)));
     partial=trust*a+(1-trust)*median;area.partialReflectance+=weight*share*trust;partialOpacity.reflectance+=weight*share*trust*a;
    }
    opacity+=share*partial;area.partial+=weight*share;partialOpacity.median+=weight*share*(1-trust)*median;
   }else if(t===undefined)area.clear+=weight;
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

// Sea ice. The day map (Blue Marble, October 2004) has none: under the
// measured clouds the renderer drew open sea where the overpass saw pack ice.
// Over that ice VIIRS retrieves no optical thickness for two fifths of the
// observed pixels (22 September 2026, 50 to 75 S, concentration above 80%),
// and their red reflectance (0.76) is below that of clear ice (0.82): nothing
// in them separates thin cloud from ice, so they keep the median thickness,
// and the surface beneath them is the ice itself. GHRSST MUR L4 sea-ice
// concentration (passive microwave, all weather) of the same day, mean of
// the water pixels of each overview texel; open water is transparent.
const seaIcePixels=await raster(layers.seaIce,[-180,-90,180,90],COARSE,COARSE/2,'sea-ice-8192');
const seaIce=new Float32Array(OVERVIEW*OVERVIEW/2);
for(let y=0;y<COARSE/2;y++)for(let x=0;x<COARSE;x++){
 if(!water(y,x))continue;const c=decode(seaIcePixels,(y*COARSE+x)*4,seaIceMap);
 if(c!==undefined)seaIce[(y>>1)*OVERVIEW+(x>>1)]+=Math.min(100,c)/400;
}
const top=new Float32Array(OVERVIEW*OVERVIEW/2);
for(let p=0;p<top.length;p++)top[p]=heightWeight[p]>0?heightSum[p]/heightWeight[p]:0;
extend(top,heightWeight.map(w=>w>0?1:0));
const overview=Buffer.alloc(OVERVIEW*OVERVIEW/2*4);let unknownArea=0,overviewArea=0,seaIceArea=0;
for(let p=0;p<top.length;p++){
 const w=latitudeWeight((p/OVERVIEW)|0,OVERVIEW/2);overviewArea+=w;unknownArea+=w*(1-known[p]/4);
 overview[p*4]=Math.round(Math.min(1,opacitySum[p])*255);
 overview[p*4+1]=Math.round(Math.min(16000,top[p])/16000*255);
 overview[p*4+2]=Math.round(ice[p]*255);
 // Observed (at least half the texel): 0.3 + 0.7 c; unobserved: 0.15 c. The
 // gap keeps AVIF error from flipping the branch (cloud-properties.ts).
 overview[p*4+3]=Math.round((known[p]>=2?.3+.7*seaIce[p]:.15*seaIce[p])*255);seaIceArea+=w*seaIce[p];
}
// AVIF 4:4:4 at quality 80: 4.2 MB instead of 17 MB lossless. Opacity RMS
// error 6/255 and height 230 m; tiles replace the opacity below ~10 km.
await sharp(overview,{raw:{width:OVERVIEW,height:OVERVIEW/2,channels:4}}).avif({quality:80,effort:5,chromaSubsampling:'4:4:4'}).toFile(out+'/overview-v2.avif');

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
const overviewBytes=(await readFile(out+'/overview-v2.avif')).length;
const fraction=v=>+(v/area.total).toFixed(4);
const manifest={
 date,
 grid:{overview:[OVERVIEW,OVERVIEW/2],tiles:[GRID,GRID/2],fine:[CHUNK*4,CHUNK*2]},
 encoding:{overview:'R: opacity R = c tau / (1 + c tau), c = 0.13 liquid to 0.2165 ice by the ice fraction, area mean of 8 x 8 fine pixels; G: cloud-top height / 16 km, opacity-weighted, extended from the nearest cloud; B: ice fraction (MODIS liquid 0, ice 1, uncertain 0.5), extended likewise; A: sea-ice concentration c, 0.3 + 0.7 c where NOAA-20 observed at least half the texel, 0.15 c elsewhere',tiles:`Luminance: opacity, area mean of 2 x 2 fine pixels, AVIF quality ${TILE_QUALITY}`},
 sources:{
  geometry:{satellite:'NOAA-20',sensor:'VIIRS',product:'CLDPROP_L2_VIIRS_NOAA20 (NASA continuity cloud properties)',layers:[layers.tau,layers.height],localTime:'about 13:30 at the equator (ascending, daytime)',example:mapURL(layers.tau,[-180,45,-90,90],CHUNK,CHUNK/2)},
  footprint:{layer:layers.footprint,use:'Observed area: corrected reflectance present or a cloud-top height retrieved'},
  phase:{layers:[layers.aquaPhase,layers.terraPhase],use:'Ice fraction only; Aqua first, Terra where Aqua has no phase',pixels:{aqua:phaseSource[0],terra:phaseSource[1]}},
  partial:{
   use:'VIIRS clouds with a top height but no retrieved thickness. Over dark surfaces (clear-sky red reflectance <= 0.15) within 60 degrees of the equator: albedo inverted from the same overpass red reflectance against the local clear sky, calibrated by optical thickness bin against measured pixels. Elsewhere: the median MODIS Aqua partly cloudy thickness. The two blend: a ramp over block clear-sky reflectance 0.12 to 0.2, blurred over one block, times a ramp over latitude 57 to 63 degrees. In sun glint over water the inversion applies at any clear-sky reflectance, against the glint reference.',
   reflectance:{layer:layers.reflectance,format:'image/jpeg',stretch,clearSky:'median red reflectance of observed cloud-free 4.9 km pixels in 157 km blocks, extended into blocks without clear pixels (at most their 5th-percentile observed reflectance) and interpolated',calibration:calibrationTable.map(r=>r.map(v=>+v.toFixed(4)))},
   glint:{use:`Over water within 30 degrees of the specular direction (full weight within 15), retrieved clouds with a top below ${GLINT_TOP} m count as partly cloudy, and partly cloudy pixels are inverted against the mean red reflectance of observed water in 20 km cells that is clear, partly cloudy with a top below ${REFERENCE_TOP} m or retrieved glint, where it exceeds the clear sky`,orbit:{...ORBIT,model:'circular sun-synchronous; latest ascending pass of the local day covering the pixel',firstAscendingNodeMinutes:+glintPhase.toFixed(1),fit:'brightest clear water within 15 degrees of the specular direction against the rest, 30 S to 30 N',contrast:+glintBest.toFixed(3)},water:'earth-terrain-8192-v2.dem water channel (Natural Earth 1:10m land, public domain)'},
   edges:`Columns within ${EDGE} degrees of the antimeridian copy the nearest intact column on their side of the date line`,
   median:{layer:layers.aquaPartial,tau:partialTau},
   seaIce:'Over sea ice the partly cloudy pixels keep the median: their reflectance is no brighter than clear ice, so it cannot separate cloud from ice',
   meanOpacity:{reflectance:+(partialOpacity.reflectance/Math.max(1e-9,area.partialReflectance)).toFixed(4),median:+(partialOpacity.median/Math.max(1e-9,area.partial-area.partialReflectance)).toFixed(4)},
  },
  seaIce:{layer:layers.seaIce,product:'GHRSST Level 4 MUR global foundation SST analysis (NASA JPL, PO.DAAC), its passive-microwave sea-ice fraction',palette:'https://gibs.earthdata.nasa.gov/colormaps/v1.3/GHRSST_Sea_Ice_Concentration.xml',use:'Surface under the clouds: mean concentration of the water pixels (earth-terrain-8192-v2.dem) of each overview texel; open water is transparent in the layer',example:mapURL(layers.seaIce,[-180,-90,180,90],COARSE,COARSE/2)},
  albedo:'R = c tau / (1 + c tau), c = (1 - g) sqrt(3) / 2: liquid g 0.85 (c 0.13), Collection 6 ice g 0.75 (c 0.2165), mixed by ice fraction',
  palettes:['MODIS_VIIRS_Cloud_Top_Height','MODIS_VIIRS_Cloud_Optical_Thickness','MODIS_Cloud_Phase_Optical_Properties','GHRSST_Sea_Ice_Concentration'].map(n=>`https://gibs.earthdata.nasa.gov/colormaps/v1.3/${n}.xml`),
  credit:'NASA Earth Science Data and Information System (ESDIS) Global Imagery Browse Services (GIBS); NASA Atmosphere SIPS cloud products from NOAA-20 VIIRS, Aqua and Terra MODIS; sea-ice fraction of the GHRSST Level 4 MUR analysis (NASA JPL, PO.DAAC).',
  licence:'NASA data and imagery, no restriction on use (NASA Earth Science Data and Information Policy); credit NASA GIBS.',
 },
 // Contributions to the global mean nadir opacity (area-weighted, fine grid).
 budget:{measured:fraction(measuredOpacity.phase),measuredWithLiquidRelation:fraction(measuredOpacity.liquid),partialFromReflectance:fraction(partialOpacity.reflectance),partialFromMedian:fraction(partialOpacity.median)},
 area:{measured:fraction(area.measured),partial:fraction(area.partial),partialFromReflectance:fraction(area.partialReflectance),clear:fraction(area.clear),unknown:+(unknownArea/overviewArea).toFixed(4),seaIce:+(seaIceArea/overviewArea).toFixed(4)},
 types:{rows:'low < 3.2 km, middle < 6.5 km, high',columns:'tau < 3.6, < 23, thicker',fractionOfGlobe:types.map(r=>[...r].map(fraction))},
 bytes:{overview:overviewBytes,tiles:tileManifest.bytes,tileCount:tileManifest.tiles.length},
 limits:'One daytime overpass per place, so the picture is a mosaic of ~13:30 local solar times; the date line joins observations about 24 h apart. Only the highest layer is measured; lower decks under it are not reconstructed. Phase comes from MODIS 1-2 h later or earlier. Night and polar areas beyond the daytime swaths are unknown and render without cloud. Bases and vertical profiles are inferred in the shader from phase, height and thickness.',
};
await writeFile(`${out}/manifest.json`,JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({area:manifest.area,budget:manifest.budget,types:manifest.types.fractionOfGlobe,partial:manifest.sources.partial.meanOpacity,partialTau,bytes:manifest.bytes}));
