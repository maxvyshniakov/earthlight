/** Compact transfer format for the HYG star catalog. The renderer still uploads
 * eight float32 values per star (direction, velocity per year, magnitude,
 * colour index); only the download is smaller.
 * - direction: 24-bit longitude and latitude, under 0.08 arcsec;
 * - velocity: half floats of value * 2^20 (positive values keep 11 bits);
 * - magnitude and B-V colour index: int16 thousandths.
 * Columns are stored separately so gzip finds their regularity; the file is
 * gzipped and unpacked through DecompressionStream. */
const MAGIC=0x31525453; // 'STR1'
const VELOCITY_SCALE=2**20,ANGLE=2**24;
const columns=[3,3,2,2,2,2,2]; // bytes per star: lon, lat, vx, vy, vz, mag, ci

function toHalf(value:number){
 const f=new Float32Array([value]),u=new Uint32Array(f.buffer)[0];
 const sign=(u>>>16)&0x8000,exponent=((u>>>23)&255)-127+15;let mantissa=u&0x7fffff;
 if(exponent<=0){ // subnormal half: round the 24-bit significand
  if(exponent<-10)return sign;
  mantissa|=0x800000;const shift=14-exponent,half=Math.round(mantissa/2**shift);return sign|half;
 }
 if(exponent>=31)throw Error('Velocity outside half-float range');
 const rounded=Math.round(mantissa/8192);
 return rounded===1024?sign|((exponent+1)<<10):sign|(exponent<<10)|rounded;
}
function fromHalf(bits:number){
 const sign=bits&0x8000?-1:1,exponent=(bits>>10)&31,mantissa=bits&1023;
 return sign*(exponent?2**(exponent-15)*(1+mantissa/1024):2**-14*(mantissa/1024));
}

/** Pack eight floats per star (the stars-hyg.bin layout) into STR1. */
export function packStars(data:Float32Array){
 const count=data.length/8,stride=columns.reduce((a,b)=>a+b,0);
 if(!Number.isInteger(count))throw Error('Expected eight values per star');
 const out=new Uint8Array(8+count*stride),view=new DataView(out.buffer);
 view.setUint32(0,MAGIC,true);view.setUint32(4,count,true);
 const offsets=columns.reduce<number[]>((list,size,i)=>[...list,i?list[i-1]+columns[i-1]*count:8],[]);
 const write=(column:number,star:number,value:number)=>{const size=columns[column],at=offsets[column]+star*size;for(let b=0;b<size;b++)out[at+b]=(value>>>(8*b))&255;};
 for(let i=0;i<count;i++){
  const x=data[i*8],y=data[i*8+1],z=data[i*8+2],length=Math.hypot(x,y,z);
  const longitude=(Math.atan2(y,x)/(2*Math.PI)+1)%1,latitude=Math.asin(Math.max(-1,Math.min(1,z/length)))/Math.PI+.5;
  write(0,i,Math.round(longitude*ANGLE)%ANGLE);write(1,i,Math.min(ANGLE-1,Math.round(latitude*(ANGLE-1))));
  for(let k=0;k<3;k++)write(2+k,i,toHalf(data[i*8+3+k]*VELOCITY_SCALE));
  for(const [column,value] of [[5,data[i*8+6]],[6,data[i*8+7]]]){const v=Math.round(value*1000);if(v<-32768||v>32767)throw Error('Photometry outside int16');write(column,i,v&0xffff);}
 }
 return out;
}

/** Unpack STR1 bytes into the eight-float layout uploaded by the renderer. */
export function unpackStars(bytes:Uint8Array){
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 if(bytes.byteLength<8||view.getUint32(0,true)!==MAGIC)throw Error('Invalid star catalog');
 const count=view.getUint32(4,true),stride=columns.reduce((a,b)=>a+b,0);
 if(!count||bytes.byteLength!==8+count*stride)throw Error('Invalid star catalog size');
 const offsets=columns.reduce<number[]>((list,size,i)=>[...list,i?list[i-1]+columns[i-1]*count:8],[]);
 const read=(column:number,star:number)=>{const size=columns[column],at=offsets[column]+star*size;let v=0;for(let b=0;b<size;b++)v|=bytes[at+b]<<(8*b);return v>>>0;};
 const out=new Float32Array(count*8);
 for(let i=0;i<count;i++){
  const longitude=read(0,i)/ANGLE*2*Math.PI,latitude=(read(1,i)/(ANGLE-1)-.5)*Math.PI,c=Math.cos(latitude);
  out[i*8]=c*Math.cos(longitude);out[i*8+1]=c*Math.sin(longitude);out[i*8+2]=Math.sin(latitude);
  for(let k=0;k<3;k++)out[i*8+3+k]=fromHalf(read(2+k,i))/VELOCITY_SCALE;
  out[i*8+6]=(read(5,i)<<16>>16)/1000;out[i*8+7]=(read(6,i)<<16>>16)/1000;
 }
 return out;
}

/** Gzipped STR1 (stars-hyg-v2.bin) to the renderer's float layout. */
export async function decodeStarCatalog(blob:Blob){
 const bytes=new Uint8Array(await new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
 return unpackStars(bytes);
}
