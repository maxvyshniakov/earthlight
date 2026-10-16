import assert from 'node:assert/strict';
import {solarDiskShader} from '../src/scripts/solar-disk.ts';
import {OPTICAL_PSF_ROWS,optics,opticalPsfSource} from '../src/scripts/optical-psf.ts';

// Integrate the resolved Sun with its rays in a float target, through the
// real PSF atlas: the disk keeps its mean radiance, the rays only move flux
// off it, stopping down sharpens them, and the 18 rays are not alike.
export async function verifySolarDisk(evaluate){
 const size=2048,radius=40;
 const fragment=`#version 300 es
 precision highp float;
 #define texture2D texture
 uniform vec4 camera;
 out vec4 outputColor;
 ${opticalPsfSource}
 ${solarDiskShader}
 void main(){
  vec2 delta=gl_FragCoord.xy-vec2(${size/2}.);
  vec3 disk=resolvedSolarDisk(delta,${radius}.,1.e6,camera)*(1.-solarRayShare(camera));
  outputColor=vec4(disk.g,solarRays(delta,${radius}.,camera).g,0.,1.);
 }`;
 const result=await evaluate(`(async()=>{
  const size=${size},canvas=document.createElement('canvas');canvas.width=canvas.height=size;
  const gl=canvas.getContext('webgl2');
  if(!gl?.getExtension('EXT_color_buffer_float'))throw Error('Float solar integration unavailable');
  const p=gl.createProgram();
  for(const [type,src] of [[gl.VERTEX_SHADER,${JSON.stringify('#version 300 es\nin vec2 p;void main(){gl_Position=vec4(p,0.,1.);}')}],[gl.FRAGMENT_SHADER,${JSON.stringify(fragment)}]]){
   const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));gl.attachShader(p,s);
  }
  gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));gl.useProgram(p);
  const atlas=gl.createTexture();gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,atlas);
  const bytes=new Uint8Array(await (await fetch('/media/earthlight/optical-psf-iris9.bin')).arrayBuffer());
  gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB8,${optics.size},${OPTICAL_PSF_ROWS},0,gl.RGB,gl.UNSIGNED_BYTE,bytes);
  for(const f of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,f,gl.LINEAR);
  for(const f of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,f,gl.CLAMP_TO_EDGE);
  gl.uniform1i(gl.getUniformLocation(p,'opticalPsf'),1);gl.activeTexture(gl.TEXTURE0);
  const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,size,size,0,gl.RGBA,gl.FLOAT,null);
  const f=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,f);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,t,0);
  gl.viewport(0,0,size,size);
  const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
  const a=gl.getAttribLocation(p,'p');gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,2,gl.FLOAT,false,0,0);
  const results=[];
  // f/4, f/9.4 and f/16 on the closing ramp; f/3.2 wide open.
  for(const camera of [[4,1,1,0],[9.36,.18,.42,0],[16,.0625,.25,0],[3.2,1.56,1,1]]){
   gl.uniform4fv(gl.getUniformLocation(p,'camera'),camera);gl.drawArrays(gl.TRIANGLES,0,3);
   const px=new Float32Array(size*size*4);gl.readPixels(0,0,size,size,gl.RGBA,gl.FLOAT,px);
   let disk=0,rays=0;for(let i=0;i<px.length;i+=4){disk+=px[i];rays+=px[i+1];}
   const at=(angle,r)=>px[(Math.round(size/2+r*Math.sin(angle))*size+Math.round(size/2+r*Math.cos(angle)))*4+1];
   const ring=Array.from({length:1440},(_,i)=>at(i*Math.PI/720,600)),mean=ring.reduce((a,b)=>a+b)/ring.length;
   // The brightest point in each 20° sector: one ray each if they were alike.
   const peaks=Array.from({length:18},(_,k)=>Math.max(...ring.slice(k*80,k*80+80))/mean);
   const peakMean=peaks.reduce((a,b)=>a+b)/peaks.length,spread=Math.sqrt(peaks.reduce((s,v)=>s+(v-peakMean)**2,0)/peaks.length)/peakMean;
   results.push({camera,disk:disk/(Math.PI*${radius}**2),rays:rays/(Math.PI*${radius}**2),contrast:Math.max(...ring)/mean,peakSpread:spread});
  }
  const error=gl.getError();gl.getExtension('WEBGL_lose_context').loseContext();return {error,results};
 })()`);
 assert.equal(result.error,0);
 for(const row of result.results){
  // The rays carry 2π·P̄·Γ(3/4)/window of the flux; the canvas keeps all
  // but their far tails, so the total stays within 1% of the disk's flux.
  assert.ok(Math.abs(row.disk+row.rays-1)<.01,`disk ${row.disk} + rays ${row.rays}`);
 }
 const [f4,f9,f16]=result.results;
 assert.ok(f16.contrast>f4.contrast,'stopping down flattens the blade arcs and sharpens the rays');
 // Wavy blade edges make some rays strong and others faint, as in the ISS
 // references. Measured from the FFT far field under this blur, ideal arcs
 // leave a peak spread of 0.05 and the chosen edges about 0.23-0.31.
 assert.ok(f9.peakSpread>.15,`rays differ in strength: ${f9.peakSpread}`);
 return result;
}
