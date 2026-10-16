import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {browserModule} from './browser-module.mjs';
import {sceneColorShader} from '../src/scripts/scene-color.ts';

// Exercise the production catalog pass, including rasterization and the real
// optical atlas. A tighter core must not flicker as it crosses a sensor pixel.
export async function verifyCatalog(evaluate){
 const optics=JSON.parse(await readFile(new URL('../src/data/optical-psf.json',import.meta.url),'utf8'));
 const catalogModule=await browserModule('catalog-stars');
 const result=await evaluate(`(async()=>{
 const catalog=${catalogModule};
 const c=document.createElement('canvas');c.width=64;c.height=64;const gl=c.getContext('webgl');gl.disable(gl.DITHER);
 const atlas=gl.createTexture();gl.activeTexture(gl.TEXTURE4);gl.bindTexture(gl.TEXTURE_2D,atlas);
 const bytes=new Uint8Array(await (await fetch('/media/earthlight/optical-psf.bin')).arrayBuffer());
 gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,256,768,0,gl.RGB,gl.UNSIGNED_BYTE,bytes);
 for(const f of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,f,gl.LINEAR);
 for(const f of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,f,gl.CLAMP_TO_EDGE);
 const state=gl.createTexture();gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,state);
 gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([255,255,0,255]));
 for(const f of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,f,gl.NEAREST);
 const stars=new catalog.CatalogStars(gl),p=gl.createProgram();
 const fragment='precision highp float;uniform sampler2D image;'+${JSON.stringify(sceneColorShader)}+'void main(){gl_FragColor=packSceneRadiance(texture2D(image,gl_FragCoord.xy/64.).rgb);}';
 for(const [type,source] of [[gl.VERTEX_SHADER,'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}'],[gl.FRAGMENT_SHADER,fragment]]){const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));gl.attachShader(p,s);}
 gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));
 const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
 const identity=[1,0,0,0,1,0,0,0,1],samples=[];
 for(const ratio of [1,.6])for(const shift of [0,.25,.5,.75]){
  stars.upload(new Float32Array([shift/80.,0,1,0,0,0,3,.45]));stars.render(64,64,ratio,identity,identity,0,state);
  gl.useProgram(p);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,stars.texture);gl.uniform1i(gl.getUniformLocation(p,'image'),0);
  gl.bindBuffer(gl.ARRAY_BUFFER,b);const a=gl.getAttribLocation(p,'p');gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,2,gl.FLOAT,false,0,0);gl.drawArrays(gl.TRIANGLES,0,3);
  const pixels=new Uint8Array(64*64*4);gl.readPixels(0,0,64,64,gl.RGBA,gl.UNSIGNED_BYTE,pixels);let sum=0,core=0,wing=0;
  for(let y=0;y<64;y++)for(let x=0;x<64;x++){const i=(y*64+x)*4,r=Math.hypot(x+.5-32-shift,y+.5-32)/ratio;
   const value=pixels[i+1]/255*2**(pixels[i+3]-32);sum+=value;if(r<1.5)core+=value;if(r>3)wing+=value;}
  samples.push({ratio,shift,flux:sum/(ratio*ratio),core:core/sum,wing:wing/sum});
 }
 const error=gl.getError();stars.dispose();gl.getExtension('WEBGL_lose_context').loseContext();return{error,samples};
 })()`);
 assert.equal(result.error,0);
 const expected=.018*10**.8*optics.integral;
 for(const sample of result.samples){
  assert.ok(Math.abs(sample.flux/expected-1)<.04,`subpixel star flux: ${JSON.stringify(sample)}`);
  assert.ok(sample.core>.85,'faint stars retain a compact core');
  assert.ok(sample.wing<.025,'broad optical wings stay faint');
 }
 return result;
}
