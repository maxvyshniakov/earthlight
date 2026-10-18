import {test} from 'bun:test';
import assert from 'node:assert/strict';
import {tileDimensions,tileManifest,validateTileManifest,tileAddress,tileMipSizes} from '../src/scripts/tile-layout.ts';
import {encodeIndex,decodeIndex} from '../src/scripts/day-pyramid-pack.ts';

test('runtime accepts manifests built from each source geometry and rejects incompatible layouts',()=>{
  for(const layer of ['night','day','cloud','galaxy','terrain']){
    const layout=tileDimensions(layer),manifest=tileManifest(layer,[0,layout.columns*layout.rows-1],layer==='galaxy');
    assert.deepEqual(validateTileManifest(manifest,layer),manifest);
    for(const field of ['interior','gutter','columns','rows'])assert.throws(()=>validateTileManifest({...manifest,[field]:manifest[field]+1},layer));
    assert.throws(()=>validateTileManifest({...manifest,tiles:[layout.columns*layout.rows]},layer));
    assert.throws(()=>validateTileManifest({...manifest,tiles:[.5]},layer));
  }
  assert.equal(validateTileManifest(tileManifest('night',[3],true),'night').mipmaps,'packed');
  assert.throws(()=>validateTileManifest(tileManifest('day',[3],true),'day'));
  assert.throws(()=>validateTileManifest(tileManifest('galaxy',[3]),'galaxy'));
});

test('synthetic tiled source addressing keeps dateline gutters and polar clamps consistent',()=>{
  const layout={columns:4,rows:2,interior:2,gutter:1,cell:4};
  const source=Uint8Array.from([10,11,12,13,20,21,22,23]);
  assert.deepEqual([-1,0,1,2,3,4].map(x=>source[tileAddress(layout,x,0)]),[13,10,11,12,13,10]);
  assert.equal(source[tileAddress(layout,1,-1)],11);assert.equal(source[tileAddress(layout,1,2)],21);
  assert.deepEqual(tileMipSizes(tileDimensions('night').cell),[286,143,72,36]);
  assert.deepEqual(tileMipSizes(tileDimensions('terrainFine').cell),[316,158,79,40]);
});

test('binary pyramid index shares the day geometry contract and rejects a different gutter',()=>{
  const index=encodeIndex([{id:3,mask:new Uint8Array(11),k:[2,2,3]}]),view=new DataView(index.buffer,index.byteOffset,index.byteLength),layout=tileDimensions('day');
  assert.equal(view.getUint16(6,true),layout.interior);assert.equal(view.getUint8(8),layout.gutter);
  assert.ok(decodeIndex(index).has(3));view.setUint8(8,layout.gutter+1);assert.throws(()=>decodeIndex(index));
});
