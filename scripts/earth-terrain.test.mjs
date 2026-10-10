import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {decodeTerrain} from '../src/scripts/earth-terrain.ts';
import sharp from 'sharp';
const raw=gunzipSync(readFileSync(new URL('../public/media/orbit/earth-terrain-4096.dem',import.meta.url)));
const buffer=raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength);
const terrain=decodeTerrain(buffer);
test('detail heights have seamless gutters and numeric, carry-safe mipmaps',async()=>{
 const decode=async id=>(await sharp(new URL(`../public/media/orbit/terrain-tiles/${id}.png`,import.meta.url).pathname).raw().toBuffer({resolveWithObject:true}));
 const a=await decode(598),b=await decode(599);
 assert.equal(a.info.width,1144);assert.equal(a.info.height,572);
 const h=(image,x,y)=>{const i=(y*1144+x)*image.info.channels;return (image.data[i]*256+image.data[i+1])*8;};
 let peak=0;
 for(let y=0;y<572;y++)for(let x=0;x<32;x++)assert.equal(h(a,540+x,y),h(b,x,y),'overlapping source gutters agree exactly');
 for(let y=0;y<286;y++)for(let x=0;x<286;x++){
  const mean=(h(a,x*2,y*2)+h(a,x*2+1,y*2)+h(a,x*2,y*2+1)+h(a,x*2+1,y*2+1))/4;
  assert.ok(Math.abs(h(a,572+x,y)-mean)<=8,'averaging is performed in metres');
  peak=Math.max(peak,h(a,x*2,y*2));
 }
 assert.ok(peak>2000,'Southern Alps retain mountainous heights');
});
function at(lon,lat,level=0){const {data,width,height}=terrain.levels[level];const i=(Math.floor((lat+90)/180*height)*width+Math.floor((lon+180)/360*width))*3;return {height:(data[i]*256+data[i+1])*8,water:data[i+2]/255};}
test('ETOPO map orientation, real heights and independent coast mask',()=>{
 assert.ok(at(88,32).height>4000&&at(88,32).height<5500); // Tibet
 assert.ok(at(-70,-32).height>3000); // Andes
 assert.ok(at(2.35,48.85).height<200); // Paris
 assert.equal(at(-130,0).height,0);assert.equal(at(-130,0).water,1);
 assert.equal(at(35.5,31.5).water,0); // Below-sea-level terrain is not inferred to be ocean.
 assert.equal(at(88,32).water,0);
});
test('packed height mipmaps preserve metre values across byte carries',()=>{
 for(let level=1;level<terrain.levels.length;level++){
   const prev=terrain.levels[level-1],next=terrain.levels[level];
   for(let y=0;y<next.height;y+=Math.max(1,Math.floor(next.height/17)))for(let x=0;x<next.width;x+=Math.max(1,Math.floor(next.width/31))){
     let average=0;
     for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){
       const i=(Math.min(prev.height-1,y*2+dy)*prev.width+Math.min(prev.width-1,x*2+dx))*3;
       average+=(prev.data[i]*256+prev.data[i+1])*2;
     }
     const j=(y*next.width+x)*3,height=(next.data[j]*256+next.data[j+1])*8;
     assert.ok(Math.abs(height-average)<=8,`level ${level}, ${x},${y}: ${height} vs ${average}`);
   }
 }
});
test('terrain decoder rejects bad headers, dimensions and incomplete payloads',()=>{
 assert.throws(()=>decodeTerrain(new ArrayBuffer(8)),/header/);
 const bad=buffer.slice(0);new DataView(bad).setUint32(4,16384,true);
 assert.throws(()=>decodeTerrain(bad),/dimensions/);
 assert.throws(()=>decodeTerrain(buffer.slice(0,-3)),/Truncated/);
});
