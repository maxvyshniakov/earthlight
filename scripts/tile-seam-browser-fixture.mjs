import assert from 'node:assert/strict';
import {cloudTileShader,dayTileShader} from '../src/scripts/surface-tile-shader.ts';

// Constant detail against a darker overview exposes residency seams without
// hiding them under photographic texture. Exercise the production shader.
export async function verifyTileSeams(evaluate,{packed=false}={}){
 const source=`precision highp float;precision highp sampler2D;
#define CLOUD_TILES 1
${cloudTileShader}
uniform vec2 centre;uniform vec2 direction;void main(){vec2 grid=centre+direction*(gl_FragCoord.x/256.-.5)*.08;float v=detailedCloud(vec2(grid.x/32.,1.-grid.y/16.),1.,0.);gl_FragColor=vec4(vec3(v),1.);}`;
 const result=await evaluate(`(()=>{
 const c=document.createElement('canvas');c.width=256;c.height=1;const gl=c.getContext('webgl');gl.disable(gl.DITHER);
 const p=gl.createProgram();for(const [type,text] of [[gl.VERTEX_SHADER,'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}'],[gl.FRAGMENT_SHADER,${JSON.stringify(source)}]]){const s=gl.createShader(type);gl.shaderSource(s,text);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));gl.attachShader(p,s);}gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));gl.useProgram(p);
 const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);const a=gl.getAttribLocation(p,'p');gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,2,gl.FLOAT,false,0,0);
 const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.LUMINANCE,1088,1088,0,gl.LUMINANCE,gl.UNSIGNED_BYTE,new Uint8Array(1088*1088).fill(255));for(const key of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,key,gl.LINEAR);for(const key of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,key,gl.CLAMP_TO_EDGE);gl.uniform2f(gl.getUniformLocation(p,'cloudTileLayout'),1088,2);
 const samples=[];const wrap=x=>(x+32)%32;
 for(const edge of [16,32])for(const fy of [0,.01,.5])for(const amount of [0,.4,1]){
  const pages=new Uint8Array(32*32),fades=new Map();
  // Tile left of the seam is surrounded; right tile lacks its far neighbour.
  for(let y=6;y<=10;y++)for(let x=edge-2;x<=edge;x++)fades.set(y*32+wrap(x),x===edge?amount:1);
  // Asymmetric corner availability catches diagonal discontinuities too.
  fades.delete(7*32+wrap(edge));
  for(const [id,fade] of fades){pages[id]=1;const x=id%32,y=Math.floor(id/32);const neighbor=Math.min(...[[x-1,y],[x+1,y],[x,y-1],[x,y+1]].map(([x,y])=>fades.get(y*32+wrap(x))??0));pages[id+512]=${packed}?(Math.round(fade*15)*16+Math.round(neighbor*15)):Math.round(fade*255);}
  gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,32,32,gl.LUMINANCE,gl.UNSIGNED_BYTE,pages);
  gl.uniform2f(gl.getUniformLocation(p,'centre'),edge,8+fy);gl.uniform2f(gl.getUniformLocation(p,'direction'),1,0);gl.drawArrays(gl.TRIANGLES,0,3);const bytes=new Uint8Array(256*4);gl.readPixels(0,0,256,1,gl.RGBA,gl.UNSIGNED_BYTE,bytes);const values=Array.from(bytes).filter((_,i)=>i%4===0);samples.push({edge,fy,amount,jump:Math.abs(values[128]-values[127]),maxStep:Math.max(...values.slice(1).map((v,i)=>Math.abs(v-values[i])))});
 }
 const error=gl.getError();gl.getExtension('WEBGL_lose_context')?.loseContext();return {error,samples};
 })()`);
 assert.equal(result.error,0);for(const s of result.samples)assert.ok(s.jump<=2&&s.maxStep<=9,JSON.stringify(s));return {...result,photos:{cloud:await verifyPhotoSeams(evaluate),day:await verifyPhotoSeams(evaluate,true)}};
}

// Unlike the residency fixture, adjoining encoded photos deliberately disagree.
// Shared geographic gutters must blend symmetrically at edges AND four corners.
export async function verifyPhotoSeams(evaluate,day=false){
 const cell=day?572:544,columns=day?160:32,rows=columns/2,layer=day?'day':'cloud';
 const source=`precision highp float;precision highp sampler2D;\n#define CLOUD_TILES 1\n${day?dayTileShader:cloudTileShader}\nuniform vec2 centre;uniform vec2 direction;uniform float footprint;void main(){vec2 grid=centre+direction*(gl_FragCoord.x/256.-.5)*.08;float v=${day?'detailedDay':'detailedCloud'}(vec2(grid.x/${columns}.,1.-grid.y/${rows}.),footprint,${day?'vec3(.2)':'.2'})${day?'.r':''};gl_FragColor=vec4(vec3(v),1.);}`;
 const result=await evaluate(`(()=>{
 const c=document.createElement('canvas');c.width=256;c.height=1;const gl=c.getContext('webgl');gl.disable(gl.DITHER);
 const p=gl.createProgram();for(const[type,text]of[[gl.VERTEX_SHADER,'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}'],[gl.FRAGMENT_SHADER,${JSON.stringify(source)}]]){const s=gl.createShader(type);gl.shaderSource(s,text);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));gl.attachShader(p,s)}gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));gl.useProgram(p);
 const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);const a=gl.getAttribLocation(p,'p');gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,2,gl.FLOAT,false,0,0);
 gl.bindTexture(gl.TEXTURE_2D,gl.createTexture());gl.texImage2D(gl.TEXTURE_2D,0,gl.LUMINANCE,${cell*4},${cell*4},0,gl.LUMINANCE,gl.UNSIGNED_BYTE,null);for(const key of[gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,key,gl.LINEAR);for(const key of[gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,key,gl.CLAMP_TO_EDGE);gl.uniform2f(gl.getUniformLocation(p,'${layer}TileLayout'),${cell*4},4);
 const pages=new Uint8Array(${columns*columns}),colors=[48,112,176,240];for(let i=0;i<4;i++){const slot=1+2*i,id=(7+Math.floor(i/2))*${columns}+15+i%2;pages[id]=slot;pages[id+${columns*rows}]=255;for(const target of[slot,slot+1])gl.texSubImage2D(gl.TEXTURE_2D,0,(target%4)*${cell},Math.floor(target/4)*${cell},${cell},${cell},gl.LUMINANCE,gl.UNSIGNED_BYTE,new Uint8Array(${cell}*${cell}).fill(colors[i]));}gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,${columns},${columns},gl.LUMINANCE,gl.UNSIGNED_BYTE,pages);
 const samples=[];for(const footprint of${JSON.stringify(day?[1,2,4,8,16,24]:[1,1.6,2,2.8])})for(const[fy,dx,dy]of[[.25,1,0],[0,1,0],[0,1,1],[0,0,1]]){
 gl.uniform1f(gl.getUniformLocation(p,'footprint'),footprint);gl.uniform2f(gl.getUniformLocation(p,'centre'),16,8+fy);gl.uniform2f(gl.getUniformLocation(p,'direction'),dx,dy);gl.drawArrays(gl.TRIANGLES,0,3);const bytes=new Uint8Array(1024);gl.readPixels(0,0,256,1,gl.RGBA,gl.UNSIGNED_BYTE,bytes);const values=Array.from(bytes).filter((_,i)=>i%4===0);samples.push({footprint,fy,dx,dy,jump:Math.abs(values[128]-values[127]),maxStep:Math.max(...values.slice(1).map((v,i)=>Math.abs(v-values[i]))),centre:(values[127]+values[128])/2});}
 const error=gl.getError();gl.getExtension('WEBGL_lose_context')?.loseContext();return{samples,error};})()`);
 assert.equal(result.error,0);for(const s of result.samples){assert.ok(s.jump<=3&&s.maxStep<=5,JSON.stringify(s));if(s.footprint<=2)assert.ok(Math.abs(s.centre-(s.fy?208:144))<=1,'retain the photographic mixture, not the coarse fallback');}return result;
}
