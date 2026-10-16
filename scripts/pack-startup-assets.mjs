// Smaller transfer copies of the two assets every scene loads at preview
// priority. Both are gzipped and unpacked through DecompressionStream:
// - stars-hyg-v2.bin: STR1 columns, see src/scripts/star-pack.ts;
// - optical-psf-v2.bin: the same PSF bytes, gzipped.
import {readFileSync,writeFileSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
import {packStars} from '../src/scripts/star-pack.ts';
const media=new URL('../public/media/earthlight/',import.meta.url);
const stars=readFileSync(new URL('stars-hyg.bin',media));
const packedStars=gzipSync(packStars(new Float32Array(stars.buffer,stars.byteOffset,stars.byteLength/4)),{level:9});
writeFileSync(new URL('stars-hyg-v2.bin',media),packedStars);
const psf=readFileSync(new URL('optical-psf.bin',media)),packedPsf=gzipSync(psf,{level:9});
writeFileSync(new URL('optical-psf-v2.bin',media),packedPsf);
console.log({stars:[stars.length,packedStars.length],psf:[psf.length,packedPsf.length]});
