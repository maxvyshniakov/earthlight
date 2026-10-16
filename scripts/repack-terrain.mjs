// Reversible byte-plane + horizontal prediction; elevations/mips stay bit exact.
import {readFileSync,writeFileSync} from 'node:fs';
import {gunzipSync,gzipSync} from 'node:zlib';
for(const width of [4096,8192]){
 const input=gunzipSync(readFileSync(`public/media/earthlight/earth-terrain-${width}.dem`));
 const output=Buffer.alloc(input.length);input.copy(output,0,0,16);output.write('DEM2');
 let w=width,h=width/2,offset=16;
 for(let level=0;level<input.readUInt32LE(12);level++){
  const count=w*h;
  for(let c=0;c<3;c++)for(let y=0;y<h;y++){
   let previous=0;
   for(let x=0;x<w;x++){
    const i=y*w+x,value=input[offset+i*3+c];output[offset+c*count+i]=(value-previous+256)&255;previous=value;
   }
  }
  offset+=count*3;w=Math.max(1,w/2);h=Math.max(1,h/2);
 }
 const packed=gzipSync(output,{level:9});
 writeFileSync(`public/media/earthlight/earth-terrain-${width}-v2.dem`,packed);
 console.log(width,input.length,packed.length);
}
