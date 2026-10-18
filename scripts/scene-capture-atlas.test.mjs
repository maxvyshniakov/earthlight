import {test} from 'bun:test';
import assert from 'node:assert/strict';
import {captureAtlasPlan,installCaptureAtlases} from './scene-capture-atlas.mjs';

const table=()=>new Uint8Array(32*16*2*4);
const tile=(pages,key,slot)=>{pages[key*4]=slot;pages[(key+32*16)*4]=255;};
test('fixed placement preserves actual page mappings and every non-slot byte',()=>{
 const pages=table();tile(pages,3,7);tile(pages,12,1);pages[3*4+2]=127;
 const original=pages.slice(),result=captureAtlasPlan('cloud',8,pages);
 assert.deepEqual(result.entries,[{key:3,from:7,to:1},{key:12,from:1,to:3}]);
 assert.deepEqual(pages,original,'planning must not mutate the production page table');
 for(let i=0;i<pages.length;i++)if(i!==3*4&&i!==12*4)assert.equal(result.pages[i],pages[i]);
});
test('malformed, aliased, fading and unsupported layouts fail instead of being repaired',()=>{
 const cases=[
  p=>{tile(p,1,1);tile(p,2,1);},
  p=>tile(p,1,2),
  p=>tile(p,1,65),
  p=>{tile(p,1,1);p[(1+32*16)*4]=254;},
 ];
 for(const change of cases){const p=table();change(p);assert.throws(()=>captureAtlasPlan('cloud',8,p));}
 assert.throws(()=>captureAtlasPlan('unknown',8,table()),/Unsupported/);
 assert.throws(()=>captureAtlasPlan('cloud',1,table()),/Unsupported/);
 assert.throws(()=>captureAtlasPlan('cloud',17,table()),/Unsupported/);
 const deep=new Uint8Array(160*80*2*4);deep[1]=2;assert.throws(()=>captureAtlasPlan('day',8,deep),/unsupported/);
 assert.throws(()=>captureAtlasPlan('cloud',8,new Uint8Array(4)),/page table/);
});
test('terrain preserves fade and neighbour metadata and reserves its header row',()=>{
 const pages=new Uint8Array(800*360*4);pages.set([10,255,0x4f,0xa3],3952*4);pages.set([6,255,0x12,0x56],70198*4);
 const result=captureAtlasPlan('terrain',6,pages);
 assert.deepEqual(result.entries,[{key:3952,from:10,to:6},{key:70198,from:6,to:8}]);
 assert.deepEqual([...result.pages.slice(3952*4,3952*4+4)],[6,255,0x4f,0xa3]);
 assert.deepEqual([...result.pages.slice(70198*4,70198*4+4)],[8,255,0x12,0x56]);
});

function fakeGL(){
 /** @type {Record<string,any>} */
 const gl={};const keys=['ACTIVE_TEXTURE','TEXTURE_BINDING_2D','READ_FRAMEBUFFER_BINDING','DRAW_FRAMEBUFFER_BINDING','PIXEL_PACK_BUFFER_BINDING','PIXEL_UNPACK_BUFFER_BINDING','PACK_ALIGNMENT','PACK_ROW_LENGTH','PACK_SKIP_PIXELS','PACK_SKIP_ROWS','UNPACK_ALIGNMENT','UNPACK_ROW_LENGTH','UNPACK_SKIP_PIXELS','UNPACK_SKIP_ROWS','UNPACK_IMAGE_HEIGHT','UNPACK_SKIP_IMAGES','UNPACK_FLIP_Y_WEBGL','UNPACK_PREMULTIPLY_ALPHA_WEBGL','UNPACK_COLORSPACE_CONVERSION_WEBGL','FRAMEBUFFER','READ_FRAMEBUFFER','DRAW_FRAMEBUFFER','COLOR_ATTACHMENT0','TEXTURE_2D','FRAMEBUFFER_COMPLETE','PIXEL_PACK_BUFFER','PIXEL_UNPACK_BUFFER','CURRENT_PROGRAM','TEXTURE_WRAP_S','TEXTURE_WRAP_T','TEXTURE_MIN_FILTER','TEXTURE_MAG_FILTER','CLAMP_TO_EDGE','LINEAR','RGBA','UNSIGNED_BYTE'];
 for(const key of keys)gl[key]=key;gl.TEXTURE0=1000;
 const state=new Map(keys.map((key,i)=>[key,i+10])),bindings=new Map([[1000,{original:true}],[1003,{other:true}]]),textures=new Set(),framebuffers=new Set(),draws=[];
 state.set(gl.ACTIVE_TEXTURE,1003);const pages=table();let attachment=null;
 gl.getParameter=key=>key===gl.TEXTURE_BINDING_2D?bindings.get(state.get(gl.ACTIVE_TEXTURE)):state.get(key);
 gl.activeTexture=value=>state.set(gl.ACTIVE_TEXTURE,value);
 gl.bindTexture=(_target,value)=>bindings.set(state.get(gl.ACTIVE_TEXTURE),value);
 gl.bindFramebuffer=(target,value)=>{if(target!==gl.DRAW_FRAMEBUFFER)state.set(gl.READ_FRAMEBUFFER_BINDING,value);if(target!==gl.READ_FRAMEBUFFER)state.set(gl.DRAW_FRAMEBUFFER_BINDING,value);};
 gl.bindBuffer=(target,value)=>state.set(target===gl.PIXEL_PACK_BUFFER?gl.PIXEL_PACK_BUFFER_BINDING:gl.PIXEL_UNPACK_BUFFER_BINDING,value);
 gl.pixelStorei=(key,value)=>state.set(key,value);
 gl.createFramebuffer=()=>{const value={};framebuffers.add(value);return value;};gl.deleteFramebuffer=value=>framebuffers.delete(value);
 gl.createTexture=()=>{const value={};textures.add(value);return value;};gl.deleteTexture=value=>textures.delete(value);
 gl.framebufferTexture2D=(_target,_at,_type,texture)=>{attachment=texture;};gl.checkFramebufferStatus=()=>gl.FRAMEBUFFER_COMPLETE;
 gl.readPixels=(_x,_y,width,height,_format,_type,data)=>{if(width===32&&height===32)data.set(pages);if(gl.corruptCopy&&textures.has(attachment))data[0]^=1;};
 gl.texImage2D=()=>{if(gl.allocationFails)throw Error('Allocation failed');};gl.texSubImage2D=()=>{};gl.texParameteri=()=>{};
 gl.getTexParameter=(_target,key)=>key===gl.TEXTURE_WRAP_S||key===gl.TEXTURE_WRAP_T?gl.CLAMP_TO_EDGE:gl.LINEAR;
 gl.getUniformLocation=(_program,name)=>name.startsWith('cloudTile')?name:null;
 gl.getUniform=(_program,name)=>name.endsWith('Layout')?[4352,8]:0;
 gl.getError=()=>0;gl.drawArrays=()=>draws.push(bindings.get(1000));
 const snapshot=()=>({state:[...state],bindings:[...bindings]});
 return {gl,snapshot,textures,framebuffers,draws,pages};
}
test('capture restores bindings, pixel-transfer state, framebuffer state and method after success',()=>{
 const f=fakeGL(),before=f.snapshot(),draw=f.gl.drawArrays,seam=installCaptureAtlases(f.gl,captureAtlasPlan,{cloud:0});
 f.gl.drawArrays();assert.deepEqual(f.snapshot(),before);assert.equal(f.framebuffers.size,0);assert.equal(f.textures.size,1);
 assert.notEqual(f.draws[0],before.bindings[0][1]);assert.ok(seam.resources[0].verifiedBytes>0);
 seam.dispose();seam.dispose();assert.equal(f.textures.size,0);assert.equal(f.gl.drawArrays,draw);
});
test('allocation, malformed table and altered texels all fail with state and temporary resources cleaned up',()=>{
 for(const setup of [f=>{f.gl.allocationFails=true;},f=>{tile(f.pages,1,1);tile(f.pages,2,1);},f=>{f.gl.corruptCopy=true;}]){
  const f=fakeGL();setup(f);const before=f.snapshot(),draw=f.gl.drawArrays,seam=installCaptureAtlases(f.gl,captureAtlasPlan,{cloud:0});
  assert.throws(()=>f.gl.drawArrays());assert.deepEqual(f.snapshot(),before);assert.equal(f.textures.size,0);assert.equal(f.framebuffers.size,0);
  seam.dispose();assert.equal(f.gl.drawArrays,draw);assert.equal(f.draws.length,0);
 }
});
test('residency count mismatch and a table changing after snapshot are explicit failures',()=>{
 const f=fakeGL(),seam=installCaptureAtlases(f.gl,captureAtlasPlan,{cloud:1});assert.throws(()=>f.gl.drawArrays(),/page count/);seam.dispose();
 const fixed=installCaptureAtlases(f.gl,captureAtlasPlan,{cloud:0});f.gl.drawArrays();tile(f.pages,1,1);
 assert.throws(()=>f.gl.drawArrays(),/changed during/);fixed.dispose();assert.equal(f.textures.size,0);
});
