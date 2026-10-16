import assert from 'node:assert/strict';
import {browserModule} from './browser-module.mjs';
import {lensReflectionShader,fieldReflectionShader,LENS_REFLECTION_FRACTION,LENS_PATHS} from '../src/scripts/lens-reflections.ts';
import {sceneColorShader} from '../src/scripts/scene-color.ts';
import {FIELD_LEVEL_SPREAD,GLARE_MAX_LEVELS} from '../src/scripts/camera-glare.ts';

// Reflect a small disk through the production pyramid and field shader. The
// integral must be the reflection fraction of the disk's flux, and the
// brightest image lies at the conjugate of the most concentrated path: its
// strength over the area of the larger of its half-aperture blur and the
// disk's image at that conjugate.
const DISK=[.10,.06],DISK_RADIUS=6/512;
const concentrated=LENS_PATHS.reduce((best,path)=>{
 const spot=Math.max(.5*path.radius,Math.abs(path.conjugate)*DISK_RADIUS),score=path.strength/spot**2;
 return score>best.score?{score,conjugate:path.conjugate}:best;
},{score:0,conjugate:0}).conjugate;
export async function verifyFieldReflections(evaluate){
 const glareModule=await browserModule('camera-glare');
 const fragment=`#version 300 es
 precision highp float;
 #define texture2D texture
 uniform vec2 resolution;
 uniform float cameraPupilScale;
 uniform float ghostFocalScale;
 const float cameraOpening=.5;
 const float focusRadius=0.;
 float ghostSourceRadius=0.;
 out vec4 outputColor;
 ${sceneColorShader}
 ${lensReflectionShader}
 ${fieldReflectionShader(FIELD_LEVEL_SPREAD,GLARE_MAX_LEVELS)}
 void main(){outputColor=vec4(fieldReflections(gl_FragCoord.xy/resolution-.5,1.),1.);}`;
 const result=await evaluate(`(()=>{
  const exports=${glareModule};
  const size=512,canvas=document.createElement('canvas');canvas.width=canvas.height=size;
  const gl=canvas.getContext('webgl2');
  if(!gl?.getExtension('EXT_color_buffer_float'))throw Error('Float reflection integration unavailable');
  const scene=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,scene);
  for(const f of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,f,gl.LINEAR);
  for(const a of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,a,gl.CLAMP_TO_EDGE);
  // A white disk of radius 6 px at (0.10, 0.06) frame heights from centre.
  const source=${JSON.stringify(DISK)},data=new Float32Array(size*size*4);let flux=0;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
   if(Math.hypot(x+.5-size*(.5+source[0]),y+.5-size*(.5+source[1]))<${DISK_RADIUS}*size){data.set([100,100,100,1],(y*size+x)*4);flux+=100/(size*size);}
  }
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA16F,size,size,0,gl.RGBA,gl.FLOAT,data);
  const glare=new exports.CameraGlare(gl,gl.HALF_FLOAT);
  glare.render(scene,size,size,[0,0,0,0],1.25);
  const field=glare.field;
  const p=gl.createProgram();
  for(const [type,src] of [[gl.VERTEX_SHADER,${JSON.stringify('#version 300 es\nin vec2 p;void main(){gl_Position=vec4(p,0.,1.);}')}],[gl.FRAGMENT_SHADER,${JSON.stringify(fragment)}]]){
   const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));gl.attachShader(p,s);
  }
  gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));gl.useProgram(p);
  const target=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,target);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,size,size,0,gl.RGBA,gl.FLOAT,null);
  const fb=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,target,0);
  gl.viewport(0,0,size,size);
  const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
  const a=gl.getAttribLocation(p,'p');gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,2,gl.FLOAT,false,0,0);
  const u=name=>gl.getUniformLocation(p,name);
  gl.uniform2f(u('resolution'),size,size);gl.uniform1f(u('cameraPupilScale'),1);gl.uniform1f(u('ghostFocalScale'),1);
  gl.uniform1f(u('displayP3'),1);
  gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_2D,field.texture);gl.uniform1i(u('reflectionField'),3);
  gl.uniform4fv(u('reflectionLevels[0]'),field.rects);gl.uniform2f(u('reflectionFieldSize'),field.width,field.height);
  gl.uniform1f(u('reflectionLevelCount'),field.levels);
  gl.drawArrays(gl.TRIANGLES,0,3);
  const pixels=new Float32Array(size*size*4);gl.readPixels(0,0,size,size,gl.RGBA,gl.FLOAT,pixels);
  let energy=0,peak=0,at=[0,0];
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
   const i=(y*size+x)*4,l=.22897*pixels[i]+.69174*pixels[i+1]+.07929*pixels[i+2];
   energy+=l/(size*size);if(l>peak){peak=l;at=[(x+.5)/size-.5,(y+.5)/size-.5];}
  }
  const error=gl.getError();glare.dispose();gl.getExtension('WEBGL_lose_context').loseContext();
  return {error,ratio:energy/flux,peakAt:at,expectedPeak:[source[0]*${concentrated},source[1]*${concentrated}]};
 })()`);
 assert.equal(result.error,0);
 assert.ok(Math.abs(result.ratio/LENS_REFLECTION_FRACTION-1)<.05,`field reflections return ${result.ratio} of the flux`);
 assert.ok(Math.hypot(result.peakAt[0]-result.expectedPeak[0],result.peakAt[1]-result.expectedPeak[1])<.006,`the brightest reflection sits at the c=${concentrated} conjugate`);
 return result;
}
