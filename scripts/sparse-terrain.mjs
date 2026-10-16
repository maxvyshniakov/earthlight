// Derive DEM3 from the published DEM2 files: identical coastline mask and mip
// chain, empty level-0 heights. decodeTerrain repeats them from level 1;
// streamed terrain tiles replace global heights wherever level 0 resolves.
import {readFileSync,writeFileSync} from 'node:fs';
import {gunzipSync,gzipSync} from 'node:zlib';
for(const width of [4096,8192]){
 const data=gunzipSync(readFileSync(`public/media/earthlight/earth-terrain-${width}-v2.dem`));
 if(data.toString('latin1',0,4)!=='DEM2'||data.readUInt32LE(4)!==width)throw Error(`Expected DEM2 ${width}`);
 // Level 0 planes are r, g, b in order; r and g carry the packed height.
 data.write('DEM3');data.fill(0,16,16+2*width*(width/2));
 const packed=gzipSync(data,{level:9});
 writeFileSync(`public/media/earthlight/earth-terrain-${width}-v3.dem`,packed);
 console.log(width,packed.length);
}
