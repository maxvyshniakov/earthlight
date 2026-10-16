import assert from 'node:assert/strict';
import {moonVertexSource,moonFragmentSource,lunarFluxScale,lunarLambertWeight} from '../src/scripts/moon-surface.ts';

// Integrate the actual resolved-disk shader in a float target and compare it
// with the uniform Lambert disk that the sampled path convolves (18 * cos i).
export async function verifyMoonSurface(evaluate){
 const size=512,radius=100,angular=.0045;
 const focal=radius/(angular*size);
 // Synthetic albedo: smooth longitude/latitude variation, flat heights.
 const mapWidth=256,mapHeight=128,table=new Uint8Array(128*64);
 const albedo=(lon,lat)=>.35+.25*Math.sin(3*lon)*Math.cos(lat)+.1*Math.sin(2*lat);
 let mean=0,weight=0;
 for(let y=0;y<mapHeight;y++){const lat=(.5-(y+.5)/mapHeight)*Math.PI;for(let x=0;x<mapWidth;x++){const lon=((x+.5)/mapWidth-.5)*2*Math.PI;mean+=albedo(lon,lat)*Math.cos(lat);weight+=Math.cos(lat);}}
 mean/=weight;
 for(let y=0;y<64;y++)for(let x=0;x<128;x++){const lat=(.5-(y+.5)/64)*Math.PI,lon=((x+.5)/128-.5)*2*Math.PI;table[y*128+x]=Math.round(255*albedo(lon,lat)/mean/2.5);}
 const pixels=[];
 for(let y=0;y<mapHeight;y++){const lat=(.5-(y+.5)/mapHeight)*Math.PI;for(let x=0;x<mapWidth;x++){const lon=((x+.5)/mapWidth-.5)*2*Math.PI;const v=Math.round(255*albedo(lon,lat)**(1/2.2));pixels.push(v,v,v,128);}}
 // Selenographic axes: near side (lon 0) toward the camera at the origin.
 const frame=[0,0,-1, -1,0,0, 0,1,0];
 const cases=[];
 for(const phase of [0,60,120])for(const mapped of [0,1]){
  const a=phase*Math.PI/180,sun=[Math.sin(a),0,-Math.cos(a)],w=lunarLambertWeight(phase);
  const lambert=(Math.sin(a)+(Math.PI-a)*Math.cos(a))/Math.PI*2/3;
  cases.push({phase,mapped,sun,weight:w,scale:lunarFluxScale([0,0,1],sun,frame,w,mapped?{width:128,height:64,scale:2.5,data:table}:null),expected:18*Math.PI*radius*radius*lambert});
 }
 const result=await evaluate(`(()=>{
 const c=document.createElement('canvas');c.width=c.height=${size};const gl=c.getContext('webgl2');
 if(!gl?.getExtension('EXT_color_buffer_float'))throw Error('Float integration unavailable');
 const p=gl.createProgram();
 for(const [type,source] of [[gl.VERTEX_SHADER,${JSON.stringify(moonVertexSource)}],[gl.FRAGMENT_SHADER,${JSON.stringify(moonFragmentSource)}]]){
  const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));gl.attachShader(p,s);
 }
 gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));gl.useProgram(p);
 const u=name=>gl.getUniformLocation(p,name);
 const map=gl.createTexture();gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,map);
 gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,${mapWidth},${mapHeight},0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array(${JSON.stringify(pixels)}));
 gl.generateMipmap(gl.TEXTURE_2D);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);
 const t=gl.createTexture();gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,t);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,${size},${size},0,gl.RGBA,gl.FLOAT,null);
 const f=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,f);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,t,0);
 const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
 const a=gl.getAttribLocation(p,'position');gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,2,gl.FLOAT,false,0,0);
 gl.uniform2f(u('resolution'),${size},${size});gl.uniform1f(u('zoomExcess'),${focal/1.25-1});gl.uniform1f(u('pixelRatio'),1);
 gl.uniform3f(u('cameraPosition'),0,0,5);gl.uniformMatrix3fv(u('cameraBasis'),false,[1,0,0,0,1,0,0,0,1]);
 gl.uniform4f(u('moon'),0,0,1,${angular});gl.uniformMatrix3fv(u('lunarFrame'),false,${JSON.stringify(frame)});
 gl.uniform3f(u('lunarMean'),${mean},${mean},${mean});gl.uniform4f(u('lunarMapInfo'),${mapWidth},${mapHeight},-9,20);gl.uniform1i(u('lunarMap'),0);
 const results=[];
 for(const row of ${JSON.stringify(cases)}){
  gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
  gl.uniform3fv(u('lunarLight'),row.sun);gl.uniform4f(u('lunarShape'),18*row.scale,row.weight,1,row.mapped);
  gl.drawArrays(gl.TRIANGLES,0,3);
  const data=new Float32Array(${size*size*4});gl.readPixels(0,0,${size},${size},gl.RGBA,gl.FLOAT,data);
  let sum=0;for(let i=0;i<data.length;i+=4)sum+=.2126*data[i]+.7152*data[i+1]+.0722*data[i+2];
  results.push({phase:row.phase,mapped:row.mapped,ratio:sum/row.expected});
 }
 const error=gl.getError();gl.getExtension('WEBGL_lose_context').loseContext();return {error,results};
 })()`);
 assert.equal(result.error,0);
 // 512 normalization samples and an 8-bit albedo table bound the agreement.
 for(const row of result.results)assert.ok(Math.abs(row.ratio-1)<.03,JSON.stringify(row));
 return result;
}
