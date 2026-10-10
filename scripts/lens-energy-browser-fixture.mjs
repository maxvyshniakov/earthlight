import assert from 'node:assert/strict';
import {lensReflectionShader,LENS_REFLECTION_FRACTION} from '../src/scripts/lens-reflections.ts';

// Integrate the actual GPU kernel, including its colored coating and clipping.
export async function verifyLensEnergy(evaluate){
 const fragment=`#version 300 es
 precision highp float;
 uniform float cameraPupilScale;
 uniform float ghostSourceRadius;
 uniform float chain;
 const float cameraOpening=.5;
 const float focusRadius=0.;
 const vec2 resolution=vec2(512.);
 out vec4 outputColor;
 ${lensReflectionShader}
 void main(){outputColor=vec4(lensReflections(gl_FragCoord.xy/resolution-.5,vec2(.35,.10),1.,chain),1.);}`;
 const result=await evaluate(`(()=>{
 const c=document.createElement('canvas');c.width=c.height=512;const gl=c.getContext('webgl2');
 if(!gl?.getExtension('EXT_color_buffer_float'))throw Error('Float integration unavailable');
 const p=gl.createProgram();
 for(const [type,source] of [[gl.VERTEX_SHADER,${JSON.stringify('#version 300 es\nin vec2 p;void main(){gl_Position=vec4(p,0.,1.);}')}],[gl.FRAGMENT_SHADER,${JSON.stringify(fragment)}]]){
  const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));gl.attachShader(p,s);
 }
 gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));gl.useProgram(p);
 const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,512,512,0,gl.RGBA,gl.FLOAT,null);
 const f=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,f);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,t,0);
 const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
 const a=gl.getAttribLocation(p,'p');gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,2,gl.FLOAT,false,0,0);
 const results=[];
 for(const pupil of [.6,1,2])for(const radius of [0,.006])for(const chain of [0,1]){
  gl.uniform1f(gl.getUniformLocation(p,'cameraPupilScale'),pupil);gl.uniform1f(gl.getUniformLocation(p,'ghostSourceRadius'),radius);gl.uniform1f(gl.getUniformLocation(p,'chain'),chain);
  gl.drawArrays(gl.TRIANGLES,0,3);const pixels=new Float32Array(512*512*4);gl.readPixels(0,0,512,512,gl.RGBA,gl.FLOAT,pixels);
  let sum=0,peak=0;for(let i=0;i<pixels.length;i+=4){const l=.22897*pixels[i]+.69174*pixels[i+1]+.07929*pixels[i+2];sum+=l;peak=Math.max(peak,l);}
  results.push({pupil,radius,chain,energy:sum/(512*512),peak});
 }
 const error=gl.getError();gl.getExtension('WEBGL_lose_context').loseContext();return {error,results};
 })()`);
 assert.equal(result.error,0);
 for(const row of result.results)assert.ok(row.energy>0&&row.energy<=LENS_REFLECTION_FRACTION*1.01,JSON.stringify(row));
 const point=result.results.filter(r=>r.radius===0&&r.chain===0);
 assert.ok(point[2].peak<point[0].peak/5,'larger ghosts distribute rather than multiply energy');
 return result;
}
