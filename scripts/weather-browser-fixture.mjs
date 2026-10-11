import assert from 'node:assert/strict';
import {cloudShader} from '../src/scripts/earth-clouds.ts';

// Compare production light integration with a 512-sample independent integral.
// Constant horizontal coverage isolates vertical sampling and shell geometry.
export async function verifyWeather(evaluate,variant='current'){
 const source=`${variant==='texture'?'#define TEXTURE_SHAPED_CLOUDS 1\n':''}precision highp float;
#define FOCAL 1.25
uniform float regional,coverage,sampleNoise,continuity,overview;
const vec3 cameraPosition=vec3(0.,0.,1.06),sunDirection=vec3(0.,0.,1.);
const vec2 resolution=vec2(1200.,800.);
// Vary only the broad regime. Fine noise is its mean in both integrators;
// otherwise footprint filtering changes the field being used as the oracle.
float noise(vec3 p){return length(p)<100.?regional:sampleNoise;}
vec3 cloudCoordinates(vec3 p){return p;}
float cloudCoverage(vec3 p,float footprint,bool detailed){return overview>=0.&&footprint>=.0025?overview:coverage;}
${cloudShader.slice(cloudShader.indexOf('float filteredCloudNoise('),cloudShader.indexOf('// Five source rays'))}
void main(){
 if(continuity>.5){
  float tau=0.;
  for(int i=0;i<128;i++){
   float h=(float(i)+.5)*12./128.;
   tau+=cloudDensity(vec3(0.,0.,1.+h/6371.),.00001,true)*12./128.;
  }
  gl_FragColor=vec4(1.-exp(-tau),0.,0.,1.);return;
 }
 float angle=(gl_FragCoord.x/128.)*1.45;
 vec3 light=vec3(sin(angle),0.,cos(angle));
 vec3 p=vec3(0.,0.,1.+(gl_FragCoord.y<1.?0.:3.5)/6371.);
 float b=dot(p,light),end=-b+sqrt(b*b-dot(p,p)+pow(1.+12./6371.,2.));
 float ds=end/512.,tau=0.;
 for(int i=0;i<512;i++)tau+=cloudDensity(p+light*((float(i)+.5)*ds),.00001,true)*ds*6371.;
 float actual=gl_FragCoord.y<1.?cloudShadowAlong(p,light):cloudLightTransmission(p,light,6.);
 gl_FragColor=vec4(actual,exp(-tau),0.,1.);
}`;
 const result=await evaluate(`(()=>{
 const c=document.createElement('canvas');c.width=128;c.height=2;const gl=c.getContext('webgl');gl.disable(gl.DITHER);
 const p=gl.createProgram();for(const [type,text] of [[gl.VERTEX_SHADER,'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}'],[gl.FRAGMENT_SHADER,${JSON.stringify(source)}]]){const s=gl.createShader(type);gl.shaderSource(s,text);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));gl.attachShader(p,s);}gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));gl.useProgram(p);
 const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);const a=gl.getAttribLocation(p,'p');gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,2,gl.FLOAT,false,0,0);
 const cases=[];
 gl.uniform1f(gl.getUniformLocation(p,'sampleNoise'),.5);
 gl.uniform1f(gl.getUniformLocation(p,'overview'),-1);
 for(const regional of [.25,.5,.75])for(const coverage of [0,.35,1]){
  gl.uniform1f(gl.getUniformLocation(p,'regional'),regional);gl.uniform1f(gl.getUniformLocation(p,'coverage'),coverage);gl.drawArrays(gl.TRIANGLES,0,3);
  const data=new Uint8Array(128*2*4);gl.readPixels(0,0,128,2,gl.RGBA,gl.UNSIGNED_BYTE,data);
  const rows=[0,1].map(row=>{const errors=Array.from({length:128},(_,x)=>Math.abs(data[(row*128+x)*4]-data[(row*128+x)*4+1])/255);return {mean:errors.reduce((a,b)=>a+b,0)/128,max:Math.max(...errors),zenith:data[row*128*4]/255};});cases.push({regional,coverage,rows});
 }
 // Sweep relief independently of coverage. Noise must not punch clear columns
 // into the observed body, even where the photograph is partially transparent.
 const columns=[];gl.uniform1f(gl.getUniformLocation(p,'continuity'),1);
 for(const regional of [.25,.5,.75])for(const coverage of [0,.25,1]){
  const opacity=[];
  gl.uniform1f(gl.getUniformLocation(p,'regional'),regional);gl.uniform1f(gl.getUniformLocation(p,'coverage'),coverage);
  for(const sampleNoise of [.05,.25,.5,.75,.95]){
   gl.uniform1f(gl.getUniformLocation(p,'sampleNoise'),sampleNoise);gl.drawArrays(gl.TRIANGLES,0,3);
   const data=new Uint8Array(4);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,data);opacity.push(data[0]/255);
  }
  columns.push({regional,coverage,opacity});
 }
 // At identical local coverage, a different broad envelope may change height,
 // but it must preserve opacity. Integrate rather than inspecting coefficients.
 const envelopes=[];
 for(const coverage of [.1,.25,.6,1]){
  gl.uniform1f(gl.getUniformLocation(p,'coverage'),coverage);
  const opacity=[];
  for(const overview of [0,.4,.7,1])for(const sampleNoise of [.05,.5,.95]){
   gl.uniform1f(gl.getUniformLocation(p,'overview'),overview);
   gl.uniform1f(gl.getUniformLocation(p,'sampleNoise'),sampleNoise);gl.drawArrays(gl.TRIANGLES,0,3);
   const data=new Uint8Array(4);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,data);opacity.push(data[0]/255);
  }
  envelopes.push({coverage,opacity});
 }
 const error=gl.getError();gl.getExtension('WEBGL_lose_context').loseContext();return {cases,columns,envelopes,error};
 })()`);
 assert.equal(result.error,0);
 for(const c of result.cases)for(const row of c.rows){
  if(c.coverage===0)assert.equal(row.zenith,1,'clear air transmits all incident light');
  assert.ok(row.mean<.07,`mean shadow error ${JSON.stringify(c)}`);
  assert.ok(row.max<.12,`peak shadow error ${JSON.stringify(c)}`);
 }
 for(const c of result.columns){
  if(c.coverage===0)assert.ok(c.opacity.every(x=>x===0),'erosion cannot invent cloud in clear air');
  if(c.coverage===1){
   assert.ok(Math.min(...c.opacity)>.35,`overcast body survives noise minima: ${JSON.stringify(c)}`);
   assert.ok(Math.max(...c.opacity)-Math.min(...c.opacity)<.3,`overcast does not alternate clear/opaque: ${JSON.stringify(c)}`);
  }
  if(c.coverage===.25){
   assert.ok(Math.min(...c.opacity)>.025,'partial coverage survives noise minima');
   assert.ok(Math.max(...c.opacity)-Math.min(...c.opacity)<.1,'relief cannot carve a clear/opaque camouflage pattern');
  }
 }
 for(const envelope of result.envelopes){
  assert.ok(Math.max(...envelope.opacity)-Math.min(...envelope.opacity)<.015,`height cannot repaint observed opacity: ${JSON.stringify(envelope)}`);
 }
 return result;
}
