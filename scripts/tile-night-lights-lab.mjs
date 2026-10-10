// Split the experimental native regional overlay into sparse 512px tiles.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {issFrame,dot,normalize} from '../src/scripts/iss-orbit.ts';
const out=path.resolve(process.argv[2]||'/tmp/night-lights-lab');
sharp.concurrency(2);sharp.cache(false);
const results=JSON.parse(fs.readFileSync(path.join(out,'results.json')));
const size=512,width=8192,tiles=[];
const raw=await sharp(path.join(out,'native-webp-lossless.webp')).toColourspace('b-w').raw().toBuffer();
for(const format of ['webp','avif'])fs.mkdirSync(path.join(out,'tiles-'+format),{recursive:true});
for(let y=0;y<16;y++)for(let x=0;x<16;x++){
 const tile=Buffer.alloc(size*size);let peak=0;
 for(let row=0;row<size;row++){
  const start=(y*size+row)*width+x*size;raw.copy(tile,row*size,start,start+size);
 }
 for(const v of tile)peak=Math.max(peak,v);
 if(!peak)continue;
 const entry={x,y,peak};
 for(const [format,options]of [['webp',{nearLossless:true,quality:80,effort:6}],['avif',{quality:80,effort:4,chromaSubsampling:'4:4:4'}]]){
  const file=path.join(out,'tiles-'+format,x+'-'+y+'.'+format);
  await sharp(tile,{raw:{width:size,height:size,channels:1}}).toColourspace('b-w')[format](options).toFile(file);
  entry[format]=fs.statSync(file).size;
 }
 tiles.push(entry);
}
const e=results.extent,views=[];
for(const t of [0,60,120,180,300]){
 const f=issFrame(t,.22),seen=new Set();
 // Coarse viewport samples plus a one-tile guard band. This is a request-budget
 // estimate, not a production visibility selector or proof of complete coverage.
 for(let y=0;y<=90;y++)for(let x=0;x<=140;x++){
  const v=normalize([(x/140-.5)*(1400/900),.5-y/90,1.25]);
  const d=[0,1,2].map(i=>f.cameraBasis[i]*v[0]+f.cameraBasis[i+3]*v[1]+f.cameraBasis[i+6]*v[2]);
  const b=dot(f.camera,d),disc=b*b-dot(f.camera,f.camera)+1;if(b>=0||disc<0)continue;
  const dist=-b-Math.sqrt(disc),p=normalize(f.camera.map((c,i)=>c+dist*d[i]));
  const lon=Math.atan2(p[1],p[0])*180/Math.PI,lat=Math.asin(p[2])*180/Math.PI;
  const tx=Math.floor((lon-e.west)/(e.east-e.west)*16),ty=Math.floor((e.north-lat)/(e.north-e.south)*16);
  if(tx<0||ty<0||tx>15||ty>15)continue;
  for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++)seen.add((tx+i)+','+(ty+j));
 }
 const selected=tiles.filter(tile=>seen.has(tile.x+','+tile.y));
 views.push({seconds:t,tiles:selected.length,webpBytes:selected.reduce((s,r)=>s+r.webp,0),avifBytes:selected.reduce((s,r)=>s+r.avif,0)});
}
results.tiling={tileSize:size,slots:256,nonempty:tiles.length,webpBytes:tiles.reduce((s,r)=>s+r.webp,0),avifBytes:tiles.reduce((s,r)=>s+r.avif,0),views,tiles};
fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2));
console.log(JSON.stringify({...results.tiling,tiles:undefined},null,2));
