import {test} from 'bun:test';
import assert from 'node:assert/strict';
import {noiseTableData,latticeValue,NOISE_TABLE_SIZE as N} from '../src/scripts/noise-table.ts';

// Float mirror of the shader's latticeHash (orbital-shader.ts).
const permute=x=>{const v=(34*x+1)*x;return v-289*Math.floor(v/289);};
const latticeHash=(x,y)=>{const qx=x-289*Math.floor(x/289),qy=y-289*Math.floor(y/289);return permute(permute(qx)+qy)/289;};

test('table corners match the shader lattice hash within 8-bit rounding',()=>{
 const data=noiseTableData();
 assert.equal(data.length,N*N*4);
 let worst=0;
 for(let y=0;y<N;y++)for(let x=0;x<N;x++){
  const i=(y*N+x)*4;
  for(const [c,dx,dy] of [[0,0,0],[1,1,0],[2,0,1],[3,1,1]]){
   const error=Math.abs(data[i+c]/255-latticeHash(x+dx,y+dy));worst=Math.max(worst,error);
  }
  assert.equal(latticeValue(x,y),latticeHash(x,y));
 }
 assert.ok(worst<=.5/255+1e-9,`worst ${worst}`);
});

test('neighbouring cells read identical shared corners',()=>{
 const data=noiseTableData(),at=(x,y,c)=>data[(((y+N)%N)*N+(x+N)%N)*4+c];
 for(let y=0;y<N;y++)for(let x=0;x<N;x++){
  assert.equal(at(x,y,1),at(x+1,y,0));assert.equal(at(x,y,2),at(x,y+1,0));assert.equal(at(x,y,3),at(x+1,y+1,0));
 }
});
