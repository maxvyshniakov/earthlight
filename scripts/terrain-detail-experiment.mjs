// Local visual experiment only. No production imports or default asset changes.
// bun scripts/terrain-detail-experiment.mjs <Copernicus N41 W114 COG> <output>
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {build} from 'esbuild';
import sharp from 'sharp';
import path from 'node:path';
const [source,out]=process.argv.slice(2);
if(!source||!out)throw Error('Pass Copernicus N41 W114 COG and output directory');
await mkdir(out,{recursive:true});
const raw=await sharp(source).toColourspace('b-w').raw({depth:'float'}).toBuffer({resolveWithObject:true});
if(raw.info.width!==3600||raw.info.height!==3600||raw.info.channels!==1)throw Error('Expected a 3600 square float DEM');
const original=new Float32Array(raw.data.buffer,raw.data.byteOffset,3600*3600);
const metadata={};
for(const factor of [1,3]){
 const n=3600/factor,size=2**Math.ceil(Math.log2(n));
 let heights=new Float32Array(size*size);
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  let sum=0;
  for(let j=0;j<factor;j++)for(let i=0;i<factor;i++)sum+=original[(Math.min(y,n-1)*factor+j)*3600+Math.min(x,n-1)*factor+i];
  heights[y*size+x]=Math.max(0,sum/(factor*factor));
 }
 const levels=[];
 for(let w=size;w>=1;w/=2){
  const packed=Buffer.alloc(w*w*2);
  for(let i=0;i<w*w;i++){const q=Math.round(heights[i]/8);packed[i*2]=q>>8;packed[i*2+1]=q&255;}
  levels.push(packed);
  if(w===1)break;
  const next=new Float32Array(w*w/4);
  for(let y=0;y<w/2;y++)for(let x=0;x<w/2;x++){const p=y*2*w+x*2;next[y*w/2+x]=(heights[p]+heights[p+1]+heights[p+w]+heights[p+w+1])/4;}
  heights=next;
 }
 const data=Buffer.concat(levels),gz=gzipSync(data),name=factor===1?'30':'90';
 await writeFile(path.join(out,`${name}.bin.gz`),gz);
 // COG samples begin at (-114,42); averaging moves the first sample centre.
 metadata[name]={size,n,factor,firstLon:-114+(factor-1)/7200,firstLat:42-(factor-1)/7200,gpuBytes:data.length,downloadBytes:gz.length};
}
await writeFile(path.join(out,'metadata.json'),JSON.stringify(metadata,null,2));
await writeFile(path.join(out,'ATTRIBUTION.txt'),'Produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved.\n90 m variant is an averaged derivative of GLO-30, not a separate GLO-90 product.\n');
const extraGLSL=`
#ifdef REGIONAL_TERRAIN
uniform sampler2D experimentMap;
uniform vec4 experimentBounds; // first centre lon/lat, sample count, texture size
uniform float experimentWidth;
float regionWeight(vec2 uv){
 vec2 geo=(uv-.5)*vec2(360.,180.);
 return smoothstep(0.,.025,min(min(geo.x+114.,-113.-geo.x),min(geo.y-41.,42.-geo.y)));
}
float localTerrainWidth(vec2 uv){return regionWeight(uv)>.0?experimentWidth:terrainSamplingWidth();}
vec2 regionalHeight(vec2 uv,float lod,vec2 fallback){
 float weight=regionWeight(uv);if(weight<=0.)return fallback;
 vec2 geo=(uv-.5)*vec2(360.,180.);
 vec2 sampleIndex=(geo-experimentBounds.xy)*vec2(1.,-1.)*experimentWidth/360.;
 vec2 texUV=(sampleIndex+.5)/experimentBounds.w;
 vec4 encoded=texture2DLodEXT(experimentMap,texUV,lod);
 return mix(fallback,encoded.ra,weight);
}
#else
float localTerrainWidth(vec2 uv){return terrainSamplingWidth();}
#endif
`;
const entry=`
import {createSceneRenderer} from '${path.resolve('src/scripts/scene-renderer.ts')}';
import {FlightNavigation} from '${path.resolve('src/scripts/flight-navigation.ts')}';
import {calendarFrame,SceneCalendar} from '${path.resolve('src/scripts/scene-calendar.ts')}';
const p=new URLSearchParams(location.search),variant=p.get('dem')||'base';
const pose=new URLSearchParams('epoch=2026-05-02T09%3A40%3A55.317Z&t=59104.68&motion=0&flight=free&position=-0.29689179%2C-0.67869731%2C0.71667283&orientation=0.0791660117%2C0.1166140865%2C0.9644032869%2C0.2237413631');
const nav=new FlightNavigation();nav.restore(pose);
const seconds=Number(pose.get('t')),orbit=calendarFrame(nav.read(seconds,{yaw:0,pitch:0},0),new SceneCalendar(pose,seconds).date(seconds));
const canvas=document.querySelector('canvas');canvas.width=1920;canvas.height=1292;
const gl=canvas.getContext('webgl',{alpha:false,preserveDrawingBuffer:true});
let texture=null,meta=null;
if(variant!=='base'){
 meta=(await(await fetch('metadata.json')).json())[variant];
 const response=await fetch(variant+'.bin.gz');const bytes=new Uint8Array(await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
 texture=gl.createTexture();gl.activeTexture(gl.TEXTURE15);gl.bindTexture(gl.TEXTURE_2D,texture);gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);
 let offset=0;for(let w=meta.size,level=0;w>=1;w/=2,level++){let count=w*w*2;gl.texImage2D(gl.TEXTURE_2D,level,gl.LUMINANCE_ALPHA,w,w,0,gl.LUMINANCE_ALPHA,gl.UNSIGNED_BYTE,bytes.subarray(offset,offset+count));offset+=count;}
 for(const axis of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,axis,gl.CLAMP_TO_EDGE);
 gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.pixelStorei(gl.UNPACK_ALIGNMENT,4);
}
globalThis.bindTerrainExperiment=(gl,program)=>{if(!texture)return;gl.activeTexture(gl.TEXTURE15);gl.bindTexture(gl.TEXTURE_2D,texture);gl.uniform1i(gl.getUniformLocation(program,'experimentMap'),15);gl.uniform4f(gl.getUniformLocation(program,'experimentBounds'),meta.firstLon,meta.firstLat,meta.n,meta.size);gl.uniform1f(gl.getUniformLocation(program,'experimentWidth'),meta.n*360);};
p.set('quality','fixed');if(variant!=='base')p.set('terrainDetail','0');
const renderer=createSceneRenderer(gl,canvas,p,()=>{});renderer.load();
const look={galaxy:.75,grain:0,chromatic:0,ghosts:0,exposure:0,manualExposure:0};
window.proof={variant,date:orbit.date.toISOString(),orbit,meta,ready:false,frames:0};
let settledFrames=0;
function draw(){
 window.last=renderer.render(orbit,1920,1292,1292,seconds,0,look,0,0,true);window.proof.frames++;
 const pending=['day','night','cloud','terrain'].some(k=>window.last[k]?.pending>0);
 if(renderer.assets.settled&&!pending)settledFrames++;else settledFrames=0;
 if(settledFrames>50){window.proof.ready=true;window.proof.error=gl.getError();window.proof.state=window.last.state;return;}
 requestAnimationFrame(draw);
}requestAnimationFrame(draw);
window.benchmark=async()=>{
 const ext=gl.getExtension('EXT_disjoint_timer_query');if(!ext)return {unsupported:true};
 const queries=[];
 for(let i=0;i<20;i++){await new Promise(requestAnimationFrame);const q=ext.createQueryEXT();ext.beginQueryEXT(ext.TIME_ELAPSED_EXT,q);renderer.render(orbit,1920,1292,1292,seconds,0,look,0,0,true);ext.endQueryEXT(ext.TIME_ELAPSED_EXT);queries.push(q);}
 for(let tries=0;tries<500&&!queries.every(q=>ext.getQueryObjectEXT(q,ext.QUERY_RESULT_AVAILABLE_EXT));tries++)await new Promise(r=>setTimeout(r,10));
 const disjoint=gl.getParameter(ext.GPU_DISJOINT_EXT),ready=queries.every(q=>ext.getQueryObjectEXT(q,ext.QUERY_RESULT_AVAILABLE_EXT));
 const ms=ready?queries.map(q=>ext.getQueryObjectEXT(q,ext.QUERY_RESULT_EXT)/1e6).sort((a,b)=>a-b):[];
 queries.forEach(q=>ext.deleteQueryEXT(q));return {disjoint,ready,median:ms[10],p90:ms[18],error:gl.getError()};
};
`;
await build({stdin:{contents:entry,resolveDir:process.cwd(),sourcefile:'experiment.ts',loader:'ts'},bundle:true,format:'esm',outfile:path.join(out,'experiment.js'),plugins:[{name:'local-terrain-experiment',setup(builder){
 builder.onLoad({filter:/earth-terrain\.ts$/},async args=>{
  let s=await readFile(args.path,'utf8');
  s=s.replace('#ifdef TERRAIN_MAP\nuniform sampler2D terrainMap;',extraGLSL+'\n#ifdef TERRAIN_MAP\nuniform sampler2D terrainMap;');
  s=s.replace('lod-log2(terrainSamplingWidth()/terrainWidth)','lod-log2(localTerrainWidth(uv)/terrainWidth)');
  s=s.replace(' return base;','\n#ifdef REGIONAL_TERRAIN\n base.rg=regionalHeight(uv,lod,base.rg);\n#endif\n return base;');
  s=s.replace('horizontal*terrainSamplingWidth()','horizontal*localTerrainWidth(earthUV(radial))').replace('float width=terrainSamplingWidth();','float width=localTerrainWidth(uv);');
  return {contents:s,loader:'ts'};
 });
 builder.onLoad({filter:/scene-renderer\.ts$/},async args=>{
  let s=await readFile(args.path,'utf8');
  s=s.replace('cloudHeader+terrainHeader+',"cloudHeader+(params.get('dem')&&params.get('dem')!=='base'?'#define REGIONAL_TERRAIN 1\\n':'')+terrainHeader+");
  s=s.replace('terrainTiles?.update(orbit,width,height,program);','terrainTiles?.update(orbit,width,height,program);globalThis.bindTerrainExperiment?.(gl,program);');
  s=s.replace("new URL('./terrain-decoder.worker.ts',import.meta.url)","new URL('./worker.js',import.meta.url)");
  return {contents:s,loader:'ts'};
 });
}}]});
await build({entryPoints:['src/scripts/terrain-decoder.worker.ts'],bundle:true,format:'esm',outfile:path.join(out,'worker.js')});
await writeFile(path.join(out,'index.html'),'<!doctype html><meta charset="utf-8"><title>Terrain detail experiment</title><style>html,body{margin:0;background:black}canvas{display:block;width:1920px;height:1292px}</style><canvas></canvas><script type="module" src="experiment.js"></script>');
console.log(metadata);
