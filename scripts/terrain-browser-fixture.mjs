import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {decodeTerrain,terrainShader} from '../src/scripts/earth-terrain.ts';

// Real ETOPO Himalayan patch, with deliberately opposing low solar angles.
// Isolates terrain lighting from baked albedo, clouds, haze and auto exposure.
export async function verifyTerrain(evaluate){
 const raw=gunzipSync(readFileSync(new URL('../public/media/orbit/earth-terrain-4096.dem',import.meta.url)));
 const {levels}=decodeTerrain(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength));
 const level=levels[0],x=2980,y=1300,size=128,patch=Buffer.alloc(size*size*3);
 for(let row=0;row<size;row++)patch.set(level.data.subarray(((y+row)*4096+x)*3,((y+row)*4096+x+size)*3),row*size*3);
 const source=`precision highp float;
#define TERRAIN_MAP 1
uniform vec3 sunDirection;
const vec3 cameraPosition=vec3(0.077,0.93,0.50);
const vec2 resolution=vec2(1789.,1006.);
float noise(vec3 p){return .5;}
vec2 earthUV(vec3 n){return vec2(atan(n.y,n.x)/6.283185307+.5,asin(n.z)/3.141592654+.5);}
${terrainShader}
void main(){
 float lon=mix(83.,88.,gl_FragCoord.x/128.)*.01745329252;
 float lat=mix(27.,31.,gl_FragCoord.y/64.)*.01745329252;
 vec3 n=vec3(cos(lat)*cos(lon),cos(lat)*sin(lon),sin(lat));
 vec3 p=n*(1.+terrainHeight(n,0.));
 float lit=max(0.,dot(terrainNormal(p,.07),sunDirection));
 gl_FragColor=vec4(lit,terrainSunVisibility(p),terrainHeight(p,0.)*6371./8.,1.);
}`;
 const result=await evaluate(`(()=>{
 const c=document.createElement('canvas');c.width=128;c.height=64;const gl=c.getContext('webgl');gl.disable(gl.DITHER);
 const p=gl.createProgram();for(const [type,s] of [[gl.VERTEX_SHADER,'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}'],[gl.FRAGMENT_SHADER,${JSON.stringify(source)}]]){const shader=gl.createShader(type);gl.shaderSource(shader,s);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(shader));gl.attachShader(p,shader);}
 gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));gl.useProgram(p);
 const tex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,tex);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,4096,2048,0,gl.RGB,gl.UNSIGNED_BYTE,null);
 gl.texSubImage2D(gl.TEXTURE_2D,0,${x},${y},${size},${size},gl.RGB,gl.UNSIGNED_BYTE,Uint8Array.from(atob('${patch.toString('base64')}'),s=>s.charCodeAt(0)));
 for(const k of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,k,gl.LINEAR);
 gl.uniform1f(gl.getUniformLocation(p,'terrainReady'),1);gl.uniform1f(gl.getUniformLocation(p,'terrainWidth'),4096);
 const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);const a=gl.getAttribLocation(p,'p');gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,2,gl.FLOAT,false,0,0);
 const r=Math.PI/180,n=[Math.cos(29*r)*Math.cos(85.5*r),Math.cos(29*r)*Math.sin(85.5*r),Math.sin(29*r)],east=[-Math.sin(85.5*r),Math.cos(85.5*r),0];
 const run=sign=>{gl.uniform3fv(gl.getUniformLocation(p,'sunDirection'),n.map((v,i)=>v*Math.sin(8*r)+east[i]*sign*Math.cos(8*r)));gl.drawArrays(gl.TRIANGLES,0,3);const bytes=new Uint8Array(128*64*4);gl.readPixels(0,0,128,64,gl.RGBA,gl.UNSIGNED_BYTE,bytes);return bytes;};
 const left=run(-1),right=run(1);let difference=0,shadow=0,maxHeight=0;
 for(let i=0;i<left.length;i+=4){difference+=Math.abs(left[i]-right[i]);if(Math.min(left[i+1],right[i+1])<128)shadow++;maxHeight=Math.max(maxHeight,left[i+2]/255*8);}
 const error=gl.getError();gl.getExtension('WEBGL_lose_context').loseContext();return{meanLightingChange:difference/(128*64),shadowPixels:shadow,maxHeightKm:maxHeight,error};
 })()`);
 assert.equal(result.error,0);assert.ok(result.maxHeightKm>5);
 assert.ok(result.meanLightingChange>5,'real slopes respond to solar direction');
 assert.ok(result.shadowPixels>20,'real ridges cast low-sun shadows');
 return result;
}
