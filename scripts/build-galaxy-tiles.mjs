// Build the whole Milky Way pyramid from NASA's 16K Galactic EXR: the 8K and
// 4K overviews and 512-pixel tiles with prepacked mipmaps. Every level is a
// box average of ONE radiance field, in the space the shader displays:
// pow(texel, 3.3). Averaging encoded texels instead (Laplacian residuals,
// runtime image resizing) brightened resolved detail by up to 2.6x, so tiles
// glowed against the overview at high exposure.
// Originals stay external; decoding uses a temporary disk-backed float image.
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {open,mkdir,writeFile,rm,rename,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
const source=process.argv[2];
if(!source)throw Error('Pass milkyway_2020_16k_gal.exr');
const width=16384,height=8192,interior=512,gutter=16,cell=interior+2*gutter,columns=32,rows=16;
const W4=4096,H4=2048,W8=8192,H8=4096;
const probe=spawnSync('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=width,height','-of','json',source]);
const info=JSON.parse(probe.stdout).streams[0];
if(info.width!==width||info.height!==height)throw Error('Expected NASA 16384 by 8192 Galactic EXR');
const media=new URL('../public/media/orbit/',import.meta.url);
const staging=new URL('galaxy-tiles.next/',media),target=new URL('galaxy-tiles/',media);
const rawPath=join(process.env.GALAXY_TMPDIR||tmpdir(),`galaxy-${process.pid}.f32`);
const decode=spawnSync('ffmpeg',['-y','-v','error','-i',source,'-pix_fmt','gbrpf32le','-f','rawvideo',rawPath],{stdio:'inherit'});
if(decode.status!==0)throw Error('EXR decoding failed');
sharp.concurrency(4);
const input=await open(rawPath,'r');
const encode=r=>Math.round(255*Math.pow(Math.max(0,Math.min(1,r)),1/3.3));

// Lossy AVIF smooths encoded texels, and pow(texel, 3.3) turns that into lost
// radiance: q50 dims 10% of 16-texel blocks by half. Re-encode a few times,
// scaling the input by the locally lost radiance, and keep the closest result.
function smooth(src,w,h){
 const out=Float32Array.from(src),line=new Float32Array(Math.max(w,h)),r=2,n=2*r+1;
 for(let pass=0;pass<3;pass++)for(let c=0;c<3;c++){
  for(let y=0;y<h;y++){const at=x=>out[(y*w+Math.max(0,Math.min(w-1,x)))*3+c];let sum=0;for(let k=-r;k<=r;k++)sum+=at(k);
   for(let x=0;x<w;x++){line[x]=sum/n;sum+=at(x+r+1)-at(x-r);}for(let x=0;x<w;x++)out[(y*w+x)*3+c]=line[x];}
  for(let x=0;x<w;x++){const at=y=>out[(Math.max(0,Math.min(h-1,y))*w+x)*3+c];let sum=0;for(let k=-r;k<=r;k++)sum+=at(k);
   for(let y=0;y<h;y++){line[y]=sum/n;sum+=at(y+r+1)-at(y-r);}for(let y=0;y<h;y++)out[(y*w+x)*3+c]=line[y];}
 }
 return out;
}
const blockMeans=(radiance,w,h)=>{const bw=Math.ceil(w/8),out=new Float64Array(bw*Math.ceil(h/8));
 for(let y=0;y<h;y++)for(let x=0;x<w;x++)out[(y>>3)*bw+(x>>3)]+=radiance[(y*w+x)*3]+radiance[(y*w+x)*3+1]+radiance[(y*w+x)*3+2];return out;};
async function encodeRadiance(field,w,h,avif){
 const target=smooth(field,w,h),reference=blockMeans(field,w,h),input=Float32Array.from(field),pixels=Buffer.alloc(field.length);
 let best=null;
 for(let pass=0;pass<4;pass++){
  for(let i=0;i<pixels.length;i++)pixels[i]=encode(input[i]);
  const out=await sharp(pixels,{raw:{width:w,height:h,channels:3}}).avif(avif).toBuffer();
  const decoded=await sharp(out).removeAlpha().raw().toBuffer(),radiance=new Float32Array(decoded.length);
  for(let i=0;i<decoded.length;i++)radiance[i]=Math.pow(decoded[i]/255,3.3);
  const got=blockMeans(radiance,w,h);let error=0,count=0;
  for(let k=0;k<got.length;k++)if(reference[k]>1e-3){error+=Math.abs(Math.log((got[k]+1e-7)/(reference[k]+1e-7)));count++;}
  error/=Math.max(1,count);
  if(!best||error<best.error)best={out,error,pass};
  if(pass===3)break;
  const have=smooth(radiance,w,h);
  for(let i=0;i<input.length;i++)input[i]*=Math.pow(Math.max(.5,Math.min(4,(target[i]+1e-7)/(have[i]+1e-7))),.6);
 }
 return best;
}

// Linear RGB flux for source rows, scaled 16x to the 4K pixel area (gbrp order).
async function readRows(first,last){
 const count=width*(last-first),planes=[];
 for(let c=0;c<3;c++){
  const data=new Float32Array(count),bytes=Buffer.from(data.buffer);let done=0;
  while(done<bytes.length){const r=await input.read(bytes,done,bytes.length-done,(c*width*height+first*width)*4+done);if(!r.bytesRead)throw Error('Truncated EXR');done+=r.bytesRead;}
  for(let i=0;i<count;i++)data[i]*=16;
  planes.push(data);
 }
 return [planes[2],planes[0],planes[1]];
}

// Pass 1: mean 4K flux, then the established photographic grade of the 4K
// plate (scripts/build-milky-way.mjs) on it. Grading is applied where its
// black point, toe and sky mask were tuned. Applied per 16K pixel instead,
// the toe erases faint unresolved light that the 4K plate keeps.
const flux4=new Float32Array(W4*H4*3);
for(let ty=0;ty<rows;ty++){
 const rgb=await readRows(ty*interior,(ty+1)*interior);
 for(let y=0;y<interior;y++)for(let x=0;x<width;x++){
  const i=y*width+x,o=(((ty*interior+y)>>2)*W4+(x>>2))*3;
  for(let c=0;c<3;c++)flux4[o+c]+=rgb[c][i]/16;
 }
}
const black=.0015,toe=.012,pivot=.12,shift=pivot-black,normal=pivot*(shift+toe)/(shift*shift);
const channel=v=>{const shoulder=v<=.65?v:.65+.35*(1-Math.exp(-(v-.65)/.35)),s=Math.max(0,Math.min(1,shoulder));return s*Math.sqrt(s);};
const gain4=new Float32Array(W4*H4*3);{
 const guide=Buffer.alloc(W4*H4);
 for(let i=0;i<W4*H4;i++){const l=.2126*flux4[i*3]+.7152*flux4[i*3+1]+.0722*flux4[i*3+2];guide[i]=Math.round(255*Math.sqrt(Math.max(0,Math.min(1,l))));}
 const {data:smooth,info}=await sharp(guide,{raw:{width:W4,height:H4,channels:1}}).blur(W4/360*.7).raw().toBuffer({resolveWithObject:true});
 for(let i=0;i<W4*H4;i++){
  const r=flux4[i*3],g=flux4[i*3+1],b=flux4[i*3+2],l=.2126*r+.7152*g+.0722*b,shadow=Math.max(0,l-black),graded=normal*shadow*shadow/(shadow+toe);
  const support=Math.max(0,Math.min(1,((smooth[i*info.channels]/255)**2-.004)/.016)),mask=support*support*(3-2*support);
  const gain=graded/Math.max(l,1e-12)*Math.pow(5*mask,2/3);
  // Displayed radiance s^1.5 (gamma 1/2.2 storage, shader power 3.3) per unit flux.
  [r,g,b].forEach((v,c)=>{gain4[i*3+c]=channel((l+(v-l)*1.2)*gain)/Math.max(v,1e-9);});
 }
}
// The graded 4K radiance as a local linear gain on 16K flux: resolved
// detail keeps its true contrast and each 4x4 block keeps the 4K brightness.
const gainAt=(x,y,c)=>{
 const u=(x+.5)/4-.5,v=Math.max(0,Math.min(H4-1,(y+.5)/4-.5)),x0=Math.floor(u),y0=Math.floor(v),fx=u-x0,fy=v-y0;
 const at=(xx,yy)=>gain4[(Math.min(H4-1,yy)*W4+((xx%W4)+W4)%W4)*3+c];
 return (at(x0,y0)*(1-fx)+at(x0+1,y0)*fx)*(1-fy)+(at(x0,y0+1)*(1-fx)+at(x0+1,y0+1)*fx)*fy;
};

// Pass 2: tiles with prepacked box mipmaps and both overviews. Tile layout
// matches the atlas: level 0 in the left cell; the right cell holds 272, 136,
// 68 and 34 pixel levels side by side at its top. Cell origins (512n - 16)
// are multiples of 16, so mip level 2 is exactly the 4K overview texel.
await rm(staging,{recursive:true,force:true});await mkdir(staging,{recursive:true});
const overview4=new Float32Array(W4*H4*3),overview8=new Float32Array(W8*H8*3),tiles=[],tileErrors=[];let bytes=0;
const box=(data,size)=>{const half=size/2,out=new Float32Array(half*half*3);
 for(let y=0;y<half;y++)for(let x=0;x<half;x++)for(let c=0;c<3;c++)
  out[(y*half+x)*3+c]=(data[((2*y)*size+2*x)*3+c]+data[((2*y)*size+2*x+1)*3+c]+data[((2*y+1)*size+2*x)*3+c]+data[((2*y+1)*size+2*x+1)*3+c])/4;
 return out;};
for(let ty=0;ty<rows;ty++){
 const first=Math.max(0,ty*interior-gutter),last=Math.min(height,(ty+1)*interior+gutter),rgb=await readRows(first,last);
 const count=interior+2*gutter,field=new Float32Array(width*count*3);
 for(let y=0;y<count;y++){
  const gy=Math.max(0,Math.min(height-1,ty*interior-gutter+y)),sy=gy-first;
  for(let x=0;x<width;x++)for(let c=0;c<3;c++)field[(y*width+x)*3+c]=Math.min(1,rgb[c][sy*width+x]*gainAt(x,gy,c));
 }
 for(let y=gutter;y<gutter+interior;y++)for(let x=0;x<width;x++){
  const i=(y*width+x)*3,gy=ty*interior+y-gutter,o4=((gy>>2)*W4+(x>>2))*3,o8=((gy>>1)*W8+(x>>1))*3;
  for(let c=0;c<3;c++){overview4[o4+c]+=field[i+c]/16;overview8[o8+c]+=field[i+c]/4;}
 }
 const writes=[];
 for(let tx=0;tx<columns;tx++){
  const level=new Float32Array(cell*cell*3);let maximum=0;
  for(let y=0;y<cell;y++)for(let x=0;x<cell;x++){
   const sx=(tx*interior+x-gutter+width)%width,s=(y*width+sx)*3,d=(y*cell+x)*3;
   for(let c=0;c<3;c++){level[d+c]=field[s+c];maximum=Math.max(maximum,field[s+c]);}
  }
  // Skip only black tiles: the overview is the same field, so it is black there too.
  if(encode(maximum)===0)continue;
  const image=new Float32Array(2*cell*cell*3);
  for(let y=0;y<cell;y++)for(let x=0;x<cell;x++)for(let c=0;c<3;c++)image[(y*2*cell+x)*3+c]=level[(y*cell+x)*3+c];
  let mip=level,size=cell,offset=0;
  for(let k=0;k<4;k++){
   mip=box(mip,size);size/=2;
   for(let y=0;y<size;y++)for(let x=0;x<size;x++)for(let c=0;c<3;c++)image[(y*2*cell+cell+offset+x)*3+c]=mip[(y*size+x)*3+c];
   offset+=size;
  }
  const id=ty*columns+tx;tiles.push(id);
  writes.push(encodeRadiance(image,2*cell,cell,{quality:65,effort:2,chromaSubsampling:'4:4:4'})
   .then(({out,error})=>{bytes+=out.length;tileErrors.push(error);return writeFile(new URL(`${id}.avif`,staging),out);}));
 }
 await Promise.all(writes);
 console.log(`row ${ty}: ${tiles.length} tiles, ${bytes} bytes`);
}
await input.close();await rm(rawPath,{force:true});
tiles.sort((a,b)=>a-b);
await writeFile(new URL('manifest.json',staging),JSON.stringify({version:2,columns,rows,interior,gutter,mipmaps:'packed',source:'NASA SVS Deep Star Maps 2020, milkyway_2020_16k_gal.exr',tiles})+'\n');
await rm(target,{recursive:true,force:true});await rename(staging,target);
const write=async(data,w,h,name)=>{
 const {out,error}=await encodeRadiance(data,w,h,{quality:50,effort:4,chromaSubsampling:'4:4:4',bitdepth:8});
 await writeFile(new URL(name,media),out);return {bytes:out.length,meanLogError:+error.toFixed(4)};
};
const overviews={'milky-way.avif':await write(overview4,W4,H4,'milky-way.avif'),'milky-way-8k.avif':await write(overview8,W8,H8,'milky-way-8k.avif')};
tileErrors.sort((a,b)=>a-b);
console.log(JSON.stringify({sourceSha256:createHash('sha256').update(await readFile(source)).digest('hex'),tiles:tiles.length,tileBytes:bytes,tileMeanLogError:+tileErrors[tileErrors.length>>1].toFixed(4),overviews}));
