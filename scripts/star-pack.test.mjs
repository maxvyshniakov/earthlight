import {test} from 'bun:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {packStars,unpackStars} from '../src/scripts/star-pack.ts';

test('packed star catalog keeps positions, motion and photometry within rendering tolerance',()=>{
 const source=readFileSync(new URL('../public/media/earthlight/stars-hyg.bin',import.meta.url));
 const original=new Float32Array(source.buffer,source.byteOffset,source.byteLength/4);
 const shipped=unpackStars(new Uint8Array(gunzipSync(readFileSync(new URL('../public/media/earthlight/stars-hyg-v2.bin',import.meta.url)))));
 assert.deepEqual(unpackStars(packStars(original)),shipped,'shipped file matches the packer');
 assert.equal(shipped.length,original.length);
 let direction=0,drift=0,photometry=0;
 for(let i=0;i<original.length;i+=8){
  const a=original.subarray(i,i+8),b=shipped.subarray(i,i+8),l=Math.hypot(a[0],a[1],a[2]);
  direction=Math.max(direction,Math.hypot(a[0]/l-b[0],a[1]/l-b[1],a[2]/l-b[2]));
  // Displacement error after 50 years of space motion.
  drift=Math.max(drift,50*Math.hypot(a[3]-b[3],a[4]-b[4],a[5]-b[5]));
  photometry=Math.max(photometry,Math.abs(a[6]-b[6]),Math.abs(a[7]-b[7]));
 }
 const arcsec=180/Math.PI*3600;
 // Lens 20x on a 2160-pixel-high screen samples about 3.8 arcsec per pixel.
 assert.ok(direction*arcsec<.1,`direction error ${direction*arcsec} arcsec`);
 assert.ok(drift*arcsec<.2,`50-year drift error ${drift*arcsec} arcsec`);
 assert.ok(photometry<=.0006,`photometry error ${photometry}`);
});

test('packed star catalog rejects foreign or truncated data',()=>{
 const packed=packStars(new Float32Array([1,0,0,1e-6,-2e-7,0,1.5,.65]));
 assert.throws(()=>unpackStars(packed.subarray(0,packed.length-1)));
 const foreign=packed.slice();foreign[0]^=1;assert.throws(()=>unpackStars(foreign));
});
