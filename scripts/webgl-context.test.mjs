import {test} from 'bun:test';
import assert from 'node:assert/strict';
import {prepareShaderSource,textureImage2D,textureSubImage2D,halfFloatTarget,drawBuffersApi} from '../src/scripts/webgl-context.ts';
import {auroraMode,auroraEnabled} from '../src/scripts/scene-effects.ts';

function context(core=false){
 const calls=[];
 return {calls,FRAGMENT_SHADER:35632,VERTEX_SHADER:35633,LUMINANCE:6409,RED:6403,RGB:6407,RGBA:6408,
  R8:33321,RGB8:32849,RGBA8:32856,RGBA16F:34842,RGBA32F:34836,HALF_FLOAT:5131,FLOAT:5126,UNSIGNED_BYTE:5121,
  ...(core?{texStorage2D(){}}:{}),getExtension(){return null;},
  texImage2D(...args){calls.push(args);},texSubImage2D(...args){calls.push(args);}};
}

test('WebGL1 keeps its source and scalar uploads unchanged',()=>{
 const gl=context(),source='precision highp float;void main(){gl_FragColor=vec4(1.);}';
 assert.equal(prepareShaderSource(gl,gl.FRAGMENT_SHADER,source),source);
 const bytes=new Uint8Array(3);
 textureImage2D(gl,3553,0,gl.LUMINANCE,3,1,0,gl.LUMINANCE,gl.UNSIGNED_BYTE,bytes);
 assert.deepEqual(gl.calls[0],[3553,0,gl.LUMINANCE,3,1,0,gl.LUMINANCE,gl.UNSIGNED_BYTE,bytes]);
});

test('WebGL2 stores scalar bytes as R8 with RED uploads, preserving offsets',()=>{
 const gl=context(true),bytes=new Uint8Array(3),bitmap={width:3,height:1};
 textureImage2D(gl,3553,0,gl.LUMINANCE,3,1,0,gl.LUMINANCE,gl.UNSIGNED_BYTE,bytes);
 textureSubImage2D(gl,3553,0,8,9,3,1,gl.LUMINANCE,gl.UNSIGNED_BYTE,bytes);
 textureImage2D(gl,3553,0,gl.LUMINANCE,gl.LUMINANCE,gl.UNSIGNED_BYTE,bitmap);
 textureSubImage2D(gl,3553,0,8,9,gl.LUMINANCE,gl.UNSIGNED_BYTE,bitmap);
 assert.deepEqual(gl.calls,[[3553,0,gl.R8,3,1,0,gl.RED,gl.UNSIGNED_BYTE,bytes],
  [3553,0,8,9,3,1,gl.RED,gl.UNSIGNED_BYTE,bytes],
  [3553,0,gl.R8,gl.RED,gl.UNSIGNED_BYTE,bitmap],[3553,0,8,9,gl.RED,gl.UNSIGNED_BYTE,bitmap]]);
});

test('WebGL2 half and full float targets use sized internal formats',()=>{
 const gl=context(true);
 for(const type of [gl.HALF_FLOAT,gl.FLOAT])textureImage2D(gl,3553,0,gl.RGBA,4,5,0,gl.RGBA,type,null);
 assert.equal(gl.calls[0][2],gl.RGBA16F);assert.equal(gl.calls[1][2],gl.RGBA32F);
 assert.equal(halfFloatTarget(gl),null,'float rendering is an extension even on WebGL2');
 gl.getExtension=name=>name==='EXT_color_buffer_float'?{}:null;
 assert.equal(halfFloatTarget(gl,true),gl.HALF_FLOAT);
});

test('GLSL300 preserves sample expressions and exposes explicit MRT outputs',()=>{
 const gl=context(true),source='#extension GL_EXT_draw_buffers : require\n#extension GL_EXT_shader_texture_lod : enable\nprecision highp float;varying vec2 uv;void main(){gl_FragData[0]=texture2DLodEXT(map,uv,6.);gl_FragData[1]=texture2D(map,uv);}';
 const result=prepareShaderSource(gl,gl.FRAGMENT_SHADER,source);
 assert.ok(result.startsWith('#version 300 es\n'));
 assert.match(result,/layout\(location=0\) out highp vec4 sceneOutput0;/);
 assert.match(result,/layout\(location=1\) out highp vec4 sceneOutput1;/);
 assert.match(result,/in vec2 uv/);assert.match(result,/textureLod\(map,uv,6\.\)/);
 assert.ok(!result.includes('#extension'));assert.ok(!result.includes('gl_FragData'));
 const vertex=prepareShaderSource(gl,gl.VERTEX_SHADER,'attribute vec2 p;varying vec2 uv;void main(){uv=p;gl_Position=vec4(p,0.,1.);}');
 assert.match(vertex,/in vec2 p;out vec2 uv/);
});

test('MRT adapter uses native drawBuffers on WebGL2',()=>{
 const gl=context(true);let actual;
 Object.assign(gl,{MAX_DRAW_BUFFERS:34852,MAX_COLOR_ATTACHMENTS:36063,COLOR_ATTACHMENT0:36064,COLOR_ATTACHMENT1:36065,drawBuffers:b=>actual=b});
 const api=drawBuffersApi(gl);api.drawBuffersWEBGL([api.COLOR_ATTACHMENT0_WEBGL,api.COLOR_ATTACHMENT1_WEBGL]);
 assert.deepEqual(actual,[36064,36065]);assert.equal(api.MAX_DRAW_BUFFERS_WEBGL,gl.MAX_DRAW_BUFFERS);
});


test('WebGL2 is the default; explicit WebGL1 links and unsupported contexts keep the fallback',async()=>{
 const {sceneContext}=await import('../src/scripts/webgl-context.ts');
 for(const [query,available,expected,calls] of [
  ['',true,'webgl2',['webgl2']],
  ['',false,'webgl',['webgl2','webgl']],
  ['render=clouds-half',true,'webgl2',['webgl2']],
  ['render=clouds-half&api=webgl',true,'webgl',['webgl']],
  ['render=compact&api=webgl2',true,'webgl2',['webgl2']],
  ['aurora=0',true,'webgl2',['webgl2']],
  ['aurora=1&api=webgl',true,'webgl',['webgl']],
 ]){
  const seen=[];const canvas={getContext(api){seen.push(api);return api==='webgl2'&&!available?null:api;}};
  const gl=sceneContext(canvas,new URLSearchParams(query),{});
  assert.equal(typeof gl==='string'?gl:'webgl',expected);
  assert.deepEqual(seen,calls);
 }
});

test('automatic aurora stays off on touch devices independently of API and render profile',()=>{
 for(const query of ['', 'api=webgl2', 'render=clouds-half', 'aurora=auto', 'aurora=unknown']){
  const params=new URLSearchParams(query);
  assert.equal(auroraMode(params),'auto');
  assert.equal(auroraEnabled(params,true),false);
  assert.equal(auroraEnabled(params,false),true);
 }
 for(const [value,wanted] of [['0',false],['off',false],['1',true],['on',true]]){
  for(const touch of [false,true])assert.equal(auroraEnabled(new URLSearchParams({aurora:value}),touch),wanted);
 }
});
