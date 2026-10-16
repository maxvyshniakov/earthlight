// Estimate a 16-byte catalog without changing production data or the loader.
import fs from 'node:fs';
import {gzipSync,brotliCompressSync} from 'node:zlib';
const source=fs.readFileSync(new URL('../public/media/earthlight/stars-hyg.bin',import.meta.url));
const packed=Buffer.alloc(source.length/2),velocityScale=1e-9;
let maxAngularArcsec=0,maxMagnitudeError=0,maxColorError=0;
for(let row=0;row<source.length/32;row++){
  const star=Array.from({length:8},(_,j)=>source.readFloatLE(row*32+j*4)),decoded=[];
  for(let i=0;i<6;i++){
    const scale=i<3?1/32767:velocityScale,q=Math.round(star[i]/scale);
    if(Math.abs(q)>32767)throw new Error('Quantization overflow');
    packed.writeInt16LE(q,row*16+i*2);decoded.push(q*scale);
  }
  for(const [i,offset,range] of [[6,-2,18],[7,-.5,5]]){
    const q=Math.round((star[i]-offset)/range*65535);
    if(q<0||q>65535)throw new Error('Photometry overflow');
    packed.writeUInt16LE(q,row*16+i*2);decoded.push(q/65535*range+offset);
  }
  // Current replay epoch, including proper motion and renormalization.
  const advance=s=>{const v=s.slice(0,3).map((x,i)=>x+s[i+3]*26.77),n=Math.hypot(...v);return v.map(x=>x/n);};
  const a=advance(star),b=advance(decoded),cross=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  maxAngularArcsec=Math.max(maxAngularArcsec,Math.atan2(Math.hypot(...cross),a.reduce((s,x,i)=>s+x*b[i],0))*180/Math.PI*3600);
  maxMagnitudeError=Math.max(maxMagnitudeError,Math.abs(star[6]-decoded[6]));
  maxColorError=Math.max(maxColorError,Math.abs(star[7]-decoded[7]));
}
console.log(JSON.stringify({stars:source.length/32,bytes:packed.length,gzip:gzipSync(packed).length,brotli:brotliCompressSync(packed).length,maxAngularArcsec,maxMagnitudeError,maxColorError,velocityScale},null,2));
