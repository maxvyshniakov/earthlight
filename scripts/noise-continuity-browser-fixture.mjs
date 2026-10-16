import assert from 'node:assert/strict';
import {fragmentSource} from '../src/scripts/scene-shader.ts';

// Exercise the production interpolation on the actual GPU. CPU evaluation and
// desktop-only screenshots missed the shared-corner jumps on Pixel/Mali.
export function noiseContinuityFixture(source=fragmentSource,api='webgl'){
 const noise=source.slice(source.indexOf('float hash(vec2 p)'),source.indexOf('mat2 rotate'));
 const fragment=`precision highp float;
${noise}
void main(){
 float x=floor(gl_FragCoord.x),row=floor(gl_FragCoord.y);
 float axis=mod(row,3.),group=floor(row/3.);
 float base=group<1.?0.:group<2.?24.:group<3.?-65.:group<4.?1200.:group<5.?-3600.:3600.;
 float boundary=floor(x/2.)-64.+base,offset=mod(x,2.)>.5?.0001:-.0001;
 vec3 p=vec3(28.37,49.61,84.23)+base;
 if(axis<1.)p.x=boundary+offset;else if(axis<2.)p.y=boundary+offset;else p.z=boundary+offset;
 float value=noise(p);
 float encoded=floor(clamp(value,0.,1.)*65535.+.5);
 gl_FragColor=vec4(floor(encoded/256.)/255.,mod(encoded,256.)/255.,0.,1.);
}`;
 return `(()=>{
 const c=document.createElement('canvas');c.width=512;c.height=18;
 const api=${JSON.stringify(api)},gl=c.getContext(api,{antialias:false});if(!gl)throw Error(api+' unavailable');
 try{
 const compile=(type,source)=>{const shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(shader));return shader;};
 let vertex='attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}',fragment=${JSON.stringify(fragment)};
 if(api==='webgl2'){vertex='#version 300 es\\n'+vertex.replace('attribute','in');fragment='#version 300 es\\n'+fragment.replace('precision highp float;','precision highp float;out vec4 outputColor;').replaceAll('gl_FragColor','outputColor');}
 const program=gl.createProgram();gl.attachShader(program,compile(gl.VERTEX_SHADER,vertex));gl.attachShader(program,compile(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));gl.useProgram(program);
 const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);const attribute=gl.getAttribLocation(program,'p');gl.enableVertexAttribArray(attribute);gl.vertexAttribPointer(attribute,2,gl.FLOAT,false,0,0);
 gl.viewport(0,0,c.width,c.height);gl.disable(gl.DITHER);gl.drawArrays(gl.TRIANGLES,0,3);
 const bytes=new Uint8Array(c.width*c.height*4);gl.readPixels(0,0,c.width,c.height,gl.RGBA,gl.UNSIGNED_BYTE,bytes);
 let maxJump=0,min=1,max=0,sum=0,worst=null;
 for(let row=0;row<c.height;row++)for(let pair=0;pair<c.width/2;pair++){
  const index=(row*c.width+pair*2)*4,left=(bytes[index]*256+bytes[index+1])/65535,right=(bytes[index+4]*256+bytes[index+5])/65535,jump=Math.abs(left-right);
  if(jump>maxJump){maxJump=jump;worst={row,pair,left,right};}min=Math.min(min,left,right);max=Math.max(max,left,right);sum+=left+right;
 }
 return {api,pairs:c.width*c.height/2,maxJump,worst,min,max,mean:sum/(c.width*c.height),error:gl.getError()};
 }finally{gl.getExtension('WEBGL_lose_context')?.loseContext();}
 })()`;
}

export async function verifyNoiseContinuity(evaluate){
 const results=[];
 for(const api of ['webgl','webgl2']){
  const result=await evaluate(noiseContinuityFixture(fragmentSource,api));
  assert.equal(result.error,0);
  assert.ok(result.maxJump<.002,`${api}: discontinuous lattice noise: ${JSON.stringify(result.worst)}`);
  assert.ok(result.max-result.min>.4,'Noise must retain spatial variation');
  assert.ok(result.mean>.3&&result.mean<.7,'Noise must retain a balanced mean');
  results.push(result);
 }
 return results;
}
