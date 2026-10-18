import assert from 'node:assert/strict';
import {sceneColorShader} from '../src/scripts/scene-color.ts';
import {citySignalShaderFor} from '../src/scripts/city-light.ts';

// Atlas samples enter the shared source calibration in their raw 0..1 range.
// The former detail-only 0.55 multiplier is already inside cityLightSignal.
const source=`precision highp float;
${sceneColorShader}
${citySignalShaderFor('current')}
void main(){
 if(gl_FragCoord.y<1.){
   float scale=exp2(floor(gl_FragCoord.x)/8.-20.);
   vec3 value=gl_FragCoord.x<1.?vec3(0.):vec3(.37,.61,1.)*scale;
   gl_FragColor=vec4(unpackSceneRadiance(floor(packSceneRadiance(value)*255.+.5)/255.)/scale,1.);
 }else gl_FragColor=vec4(vec3(cityLightSignal(floor(gl_FragCoord.x)/255.)*2.),1.);
}`;

export async function verifyCityRadiance(evaluate){
 const result=await evaluate(`(()=>{
  const c=document.createElement('canvas');c.width=256;c.height=2;const gl=c.getContext('webgl');gl.disable(gl.DITHER);
  const compile=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
  const p=gl.createProgram();gl.attachShader(p,compile(gl.VERTEX_SHADER,'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}'));gl.attachShader(p,compile(gl.FRAGMENT_SHADER,${JSON.stringify(source)}));gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));gl.useProgram(p);
  const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);const a=gl.getAttribLocation(p,'p');gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,2,gl.FLOAT,false,0,0);
  gl.drawArrays(gl.TRIANGLES,0,3);const v=new Uint8Array(256*2*4);gl.readPixels(0,0,256,2,gl.RGBA,gl.UNSIGNED_BYTE,v);
  const error=gl.getError();gl.getExtension('WEBGL_lose_context')?.loseContext();return {hdr:Array.from(v.slice(0,1024)),city:Array.from({length:256},(_,i)=>v[1024+i*4]/510),error};
 })()`);
 assert.equal(result.error,0);assert.deepEqual(result.hdr.slice(0,3),[0,0,0]);
 for(let i=1;i<256;i++)for(let c=0;c<3;c++)assert.ok(Math.abs(result.hdr[i*4+c]-[.37,.61,1][c]*255)<2,'RGBE must preserve chroma and HDR energy');
 assert.equal(result.city[0],0);assert.ok(result.city.every((v,i,a)=>i===0||v>=a[i-1]));
 const core=result.city[255],road=result.city[26],midtone=result.city[128];
 // The documented 1.3 contrast preserves about 5% of peak for a 10% source
 // and about 41% for a half-strength source. Normalize contrast to the peak,
 // then independently constrain absolute energy so changing gain cannot pass.
 assert.ok(road/core>.045&&road/core<.06,'faint native networks retain their calibrated share of peak energy');
 assert.ok(midtone/core>.38&&midtone/core<.45,'city midtones retain the accepted source contrast');
 assert.ok(core>.30&&core<.35,'bright sources retain the shared overview/detail calibration');
 assert.ok(core>result.city[204],'cores retain highlight headroom and gradation');
 return {black:result.city[0],road,roadToCore:road/core,midtone,midtoneToCore:midtone/core,core,error:result.error};
}
