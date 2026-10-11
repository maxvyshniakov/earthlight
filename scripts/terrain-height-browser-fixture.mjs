import assert from 'node:assert/strict';
import sharp from 'sharp';
import {terrainShader} from '../src/scripts/earth-terrain.ts';

// Surveyed summit heights are references, not values to force into a coarse DEM.
export const summitChecks=[
 {name:'Everest',lon:86.925,lat:27.9881,survey:8848.86,sourceMetres:8054.848251},
 {name:'K2',lon:76.5133,lat:35.8808,survey:8611,sourceMetres:7416.705848},
];
export async function verifyTerrainHeights(evaluate){
 const results=[];
 for(const summit of summitChecks){
  const x=(summit.lon+180)*60-.5,y=(90-summit.lat)*60-.5;
  const tx=Math.floor((x+.5)/540),ty=Math.floor((y+.5)/540),id=ty*40+tx;
  const {data,info}=await sharp(new URL(`../public/media/orbit/terrain-tiles/${id}.png`,import.meta.url).pathname).raw().toBuffer({resolveWithObject:true});
  const at=(x,y)=>{const i=((y-ty*540+16)*1144+x-tx*540+16)*info.channels;return (data[i]*256+data[i+1])*8;};
  const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;
  const expected=(at(ix,iy)*(1-fx)+at(ix+1,iy)*fx)*(1-fy)+(at(ix,iy+1)*(1-fx)+at(ix+1,iy+1)*fx)*fy;
  assert.ok(Math.abs(expected-summit.sourceMetres)<=4,`${summit.name}: tile preserves audited ETOPO sample within 8 m quantization`);
  const source=`precision highp float;
#define TERRAIN_MAP 1
#define TERRAIN_TILES 1
uniform vec3 cameraPosition;
uniform vec2 coordinate;
uniform float intersectMode;
const vec2 resolution=vec2(1440.,1000.);
const vec3 sunDirection=vec3(1.,0.,0.);
float noise(vec3 p){return .5;}
vec2 earthUV(vec3 n){return vec2(atan(n.y,n.x)/6.283185307+.5,asin(n.z)/3.141592654+.5);}
${terrainShader}
void main(){
 vec2 a=coordinate*.01745329252;
 vec3 n=vec3(cos(a.y)*cos(a.x),cos(a.y)*sin(a.x),sin(a.y));
 float h=terrainHeight(n,0.)*6371000.;
 if(intersectMode>.5){
  float t=terrainIntersection(-n,length(cameraPosition)-1.);
  h=(length(cameraPosition-n*t)-1.)*6371000.;
 }
 h=floor(h+.5);
 gl_FragColor=vec4(floor(h/256.)/255.,mod(h,256.)/255.,0.,1.);
}`;
  const result=await evaluate(`(async()=>{
 const gl=document.createElement('canvas').getContext('webgl');gl.disable(gl.DITHER);gl.viewport(0,0,1,1);
 const p=gl.createProgram();
 for(const [type,source]of [[gl.VERTEX_SHADER,'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}'],[gl.FRAGMENT_SHADER,${JSON.stringify(source)}]]){
  const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));gl.attachShader(p,s);
 }
 gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));gl.useProgram(p);
 const texture=(unit,size)=>{gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,gl.createTexture());gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,size,size,0,gl.RGBA,gl.UNSIGNED_BYTE,null);for(const f of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,f,gl.LINEAR);for(const f of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,f,gl.CLAMP_TO_EDGE);};
 texture(1,1);gl.uniform1i(gl.getUniformLocation(p,'terrainMap'),1);
 texture(0,1716);const image=await createImageBitmap(await (await fetch('/media/orbit/terrain-tiles/${id}.png')).blob(),{colorSpaceConversion:'none',premultiplyAlpha:'none'});
 gl.texSubImage2D(gl.TEXTURE_2D,0,572,0,gl.RGBA,gl.UNSIGNED_BYTE,image);image.close();
 gl.texSubImage2D(gl.TEXTURE_2D,0,${tx},${ty},1,1,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([1,0,0,255]));
 // This summit fixture samples fully resident terrain, including at tile edges.
 // Fades are now stored separately per tile rather than packing neighbour readiness.
 for(let y=${ty-1};y<=${ty+1};y++)for(let x=${tx-1};x<=${tx+1};x++)gl.texSubImage2D(gl.TEXTURE_2D,0,(x+40)%40,Math.max(0,Math.min(19,y))+20,1,1,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([255,0,0,255]));
 gl.uniform2f(gl.getUniformLocation(p,'terrainTileLayout'),1716,3);gl.uniform1f(gl.getUniformLocation(p,'terrainReady'),1);gl.uniform1f(gl.getUniformLocation(p,'terrainWidth'),8192);
 gl.uniform2f(gl.getUniformLocation(p,'coordinate'),${summit.lon},${summit.lat});
 const r=Math.PI/180,lon=${summit.lon}*r,lat=${summit.lat}*r,d=1+150/6371;
 gl.uniform3fv(gl.getUniformLocation(p,'cameraPosition'),[d*Math.cos(lat)*Math.cos(lon),d*Math.cos(lat)*Math.sin(lon),d*Math.sin(lat)]);
 gl.bindBuffer(gl.ARRAY_BUFFER,gl.createBuffer());gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);const a=gl.getAttribLocation(p,'p');gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,2,gl.FLOAT,false,0,0);
 const run=mode=>{gl.uniform1f(gl.getUniformLocation(p,'intersectMode'),mode);gl.drawArrays(gl.TRIANGLES,0,3);const b=new Uint8Array(4);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,b);return b[0]*256+b[1];};
 const sampled=run(0),intersection=run(1),error=gl.getError();gl.getExtension('WEBGL_lose_context')?.loseContext();return{sampled,intersection,error};
 })()`);
  assert.equal(result.error,0);
  assert.ok(Math.abs(result.sampled-expected)<8,`${summit.name}: atlas/shader ${result.sampled} vs ${expected} metres`);
  assert.ok(Math.abs(result.intersection-expected)<8,`${summit.name}: radial intersection must match the heightfield`);
  results.push({...summit,tile:id,tileHeight:expected,...result});
 }
 return results;
}
