import assert from 'node:assert/strict';
import {solarDiskShader,SOLAR_RAY_ANGLE} from '../src/scripts/solar-disk.ts';
import {cameraModelShader} from '../src/scripts/camera-model.ts';

// Integrate the resolved Sun with its analytic rays in a float target: the
// disk keeps its mean radiance, the rays only move flux off it, and they lie
// on the blade normals.
export async function verifySolarDisk(evaluate){
 const size=2048,radius=40;
 const fragment=`#version 300 es
 precision highp float;
 #define texture2D texture
 uniform vec4 camera;
 out vec4 outputColor;
 ${cameraModelShader}
 ${solarDiskShader}
 void main(){
  vec2 delta=gl_FragCoord.xy-vec2(${size/2}.);
  vec3 disk=resolvedSolarDisk(delta,${radius}.,1.e6,camera)*(1.-solarRayShare(camera.w));
  outputColor=vec4(disk.g,solarRays(delta,${radius}.,camera).g,0.,1.);
 }`;
 const result=await evaluate(`(()=>{
  const size=${size},canvas=document.createElement('canvas');canvas.width=canvas.height=size;
  const gl=canvas.getContext('webgl2');
  if(!gl?.getExtension('EXT_color_buffer_float'))throw Error('Float solar integration unavailable');
  const p=gl.createProgram();
  for(const [type,src] of [[gl.VERTEX_SHADER,${JSON.stringify('#version 300 es\nin vec2 p;void main(){gl_Position=vec4(p,0.,1.);}')}],[gl.FRAGMENT_SHADER,${JSON.stringify(fragment)}]]){
   const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));gl.attachShader(p,s);
  }
  gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));gl.useProgram(p);
  const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,size,size,0,gl.RGBA,gl.FLOAT,null);
  const f=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,f);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,t,0);
  gl.viewport(0,0,size,size);
  const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
  const a=gl.getAttribLocation(p,'p');gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,2,gl.FLOAT,false,0,0);
  const results=[];
  // f/4 closed iris, f/9.5 closed iris, f/4 open iris.
  for(const camera of [[4,1,1,0],[9.5,.18,.42,0],[4,1,1,1]]){
   gl.uniform4fv(gl.getUniformLocation(p,'camera'),camera);gl.drawArrays(gl.TRIANGLES,0,3);
   const px=new Float32Array(size*size*4);gl.readPixels(0,0,size,size,gl.RGBA,gl.FLOAT,px);
   let disk=0,rays=0;for(let i=0;i<px.length;i+=4){disk+=px[i];rays+=px[i+1];}
   const at=(angle,r)=>px[(Math.round(size/2+r*Math.sin(angle))*size+Math.round(size/2+r*Math.cos(angle)))*4+1];
   results.push({camera,disk:disk/(Math.PI*${radius}**2),rays:rays/(Math.PI*${radius}**2),onRay:at(${SOLAR_RAY_ANGLE},300),between:at(${SOLAR_RAY_ANGLE}+Math.PI/6,300)});
  }
  const error=gl.getError();gl.getExtension('WEBGL_lose_context').loseContext();return {error,results};
 })()`);
 assert.equal(result.error,0);
 for(const row of result.results){
  // Rays carry 2C/window per line beyond the window; the canvas keeps all but
  // their far tails, so the total stays within 1% of the disk's flux.
  assert.ok(Math.abs(row.disk+row.rays-1)<.01,`disk ${row.disk} + rays ${row.rays}`);
  assert.ok(row.onRay>0&&row.between===0,'rays lie on the blade normals only');
 }
 assert.ok(result.results[1].onRay>result.results[0].onRay*1.5,'stopping down strengthens the rays');
 assert.ok(result.results[2].rays<result.results[0].rays/4,'an open, rounder iris weakens them');
 return result;
}
