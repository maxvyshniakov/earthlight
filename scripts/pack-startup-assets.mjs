// Smaller transfer copies of the startup star catalog and PSF. All are
// gzipped and unpacked through DecompressionStream:
// - stars-hyg-v2.bin: STR1 columns, see src/scripts/star-pack.ts;
// - stars-hyg-m5-v2.bin: the same, stars to magnitude 5, for the first light;
// - optical-psf-v3.bin: optical-psf-iris9.bin (the nine-blade PSF), gzipped.
import {readFileSync,writeFileSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
import {packStars} from '../src/scripts/star-pack.ts';
const media=new URL('../public/media/earthlight/',import.meta.url);
const stars=readFileSync(new URL('stars-hyg.bin',media));
const packedStars=gzipSync(packStars(new Float32Array(stars.buffer,stars.byteOffset,stars.byteLength/4)),{level:9});
writeFileSync(new URL('stars-hyg-v2.bin',media),packedStars);
const all=new Float32Array(stars.buffer,stars.byteOffset,stars.byteLength/4),bright=[];
for(let i=0;i<all.length;i+=8)if(all[i+6]<=5)bright.push(...all.subarray(i,i+8));
const packedBright=gzipSync(packStars(new Float32Array(bright)),{level:9});
writeFileSync(new URL('stars-hyg-m5-v2.bin',media),packedBright);
const psf=readFileSync(new URL('optical-psf-iris9.bin',media)),packedPsf=gzipSync(psf,{level:9});
writeFileSync(new URL('optical-psf-v3.bin',media),packedPsf);
console.log({stars:[stars.length,packedStars.length],bright:[bright.length/8,packedBright.length],psf:[psf.length,packedPsf.length]});
