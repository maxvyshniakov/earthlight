import {verifyTileSeams} from './tile-seam-browser-fixture.mjs';
import {verifyCanvasResize} from './canvas-resize-browser-fixture.mjs';
import {verifyTextureBitmap} from './texture-bitmap-browser-fixture.mjs';
import { galacticLightShader } from '../src/scripts/galactic-light.ts';
import { surfaceMapShader } from '../src/scripts/surface-map.ts';
import { airglowLightShader } from '../src/scripts/airglow-light.ts';
// Uses an isolated agent-browser session; never attaches to the user's tab.
// bun run verify:scene http://127.0.0.1:4322 /tmp/orbit-browser-proof
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {verifyLighting} from './lighting-browser-fixture.mjs';
import {verifyNightLight} from './night-light-browser-fixture.mjs';
import {verifyCityRadiance} from './city-radiance-browser-fixture.mjs';
import {verifyExposure} from './exposure-browser-fixture.mjs';
import {verifyAurora} from './aurora-browser-fixture.mjs';
import {verifyTerrain} from './terrain-browser-fixture.mjs';
import {verifyWeather} from './weather-browser-fixture.mjs';
import {verifyTerrainHeights} from './terrain-height-browser-fixture.mjs';
import {verifyLensEnergy} from './lens-energy-browser-fixture.mjs';
import {verifyCatalog} from './catalog-browser-fixture.mjs';
import {verifyFlight} from './flight-browser-fixture.mjs';
import {verifyTouch} from './touch-browser-fixture.mjs';
import {verifyCalendar} from './calendar-browser-fixture.mjs';
import {START_DATE} from '../src/scripts/iss-orbit.ts';
import {atmosphericLightShader} from '../src/scripts/atmospheric-light.ts';
import {cloudShader} from '../src/scripts/earth-clouds.ts';
const exec=promisify(execFile);
const [base='http://127.0.0.1:4322',out='/tmp/orbit-browser-proof']=process.argv.slice(2);
await mkdir(out,{recursive:true});
const session=`scene-proof-${process.pid}`;
const run=async(...args)=>{
 // Visual regression scenes use a fixed calendar; production defaults to now.
 if(args[0]==='open'&&args[1]?.startsWith(base)){
  const url=new URL(args[1]);if(!url.searchParams.has('epoch'))url.searchParams.set('epoch',START_DATE.toISOString());if(process.env.SCENE_PROFILE)url.searchParams.set('render',process.env.SCENE_PROFILE);if(process.env.SCENE_TERRAIN_UPLOAD)url.searchParams.set('terrainUpload',process.env.SCENE_TERRAIN_UPLOAD);if(process.env.SCENE_TERRAIN_CACHE)url.searchParams.set('terrainCache',process.env.SCENE_TERRAIN_CACHE);for(const [key,name] of [['terrainDecoder','SCENE_TERRAIN_DECODER'],['terrainSource','SCENE_TERRAIN_SOURCE'],['cloudBake','SCENE_CLOUD_BAKE']])if(process.env[name])url.searchParams.set(key,process.env[name]);args[1]=url.href;
 }
 return (await exec('rtk',['proxy','agent-browser','--session',session,...args],{maxBuffer:8e6,timeout:90000})).stdout;
};
const evaluate=async js=>JSON.parse(await run('eval','--base64',Buffer.from(js).toString('base64')));
const wait=condition=>run('wait','--fn',condition);
const settled="document.querySelector('orbital-sky').dataset.assetPhase==='settled'&&document.querySelector('orbital-sky').dataset.focus==='sharp'";
const results=[];
const cameraFinishSource=await readFile(new URL('../src/scripts/camera-finish.ts',import.meta.url),'utf8');
const sensorFixture='precision highp float;uniform float grainAmount;uniform sampler2D poisson;uniform float signal;uniform float iso;'
 +cameraFinishSource.slice(cameraFinishSource.indexOf('float hash(vec2 p)'),cameraFinishSource.indexOf('void main()'))
  .replaceAll('${POISSON_ROWS-1}','1023').replaceAll('${POISSON_ROWS}','1024')
 +'void main(){float v=sensorChannel(signal,iso,gl_FragCoord.xy)*5.;gl_FragColor=vec4(v,v,v,1.);}';
const sceneShader=await readFile(new URL('../src/scripts/orbital-shader.ts',import.meta.url),'utf8');
const highlightFixture=`precision highp float;
${cameraFinishSource.slice(cameraFinishSource.indexOf('vec3 cameraHighlights('),cameraFinishSource.indexOf('void main()'))}
void main(){
 float energy=floor(gl_FragCoord.x)/255.*3.;
 vec3 tint=gl_FragCoord.y<1.?vec3(1.,.6,.32):vec3(1.);
 gl_FragColor=vec4(cameraHighlights(tint*energy),1.);
}`;
const skySeamFixture=`precision highp float;
uniform sampler2D milkyWayMap;
const mat3 galacticBasis=mat3(1.);
const float galaxyAmount=1.;
${galacticLightShader}
void main(){
 vec3 ray=normalize(vec3(-1.,(gl_FragCoord.x-31.)*.0001,(gl_FragCoord.y-2.)*.0001));
 gl_FragColor=vec4(milkyWay(ray)/.006,1.);
}`;
const surfaceSeamFixture=`precision highp float;
uniform sampler2D surfaceMap;
${surfaceMapShader}
void main(){
 vec3 n=normalize(vec3(-.3,(gl_FragCoord.x-31.+gl_FragCoord.y*.3)*.0001,-.95));
 vec2 uv=vec2(atan(n.y,n.x)/6.283185307+.5,asin(n.z)/3.141592654+.5);
 gl_FragColor=vec4(surfaceAlbedo(uv),1.);
}`;
const sunlightFixture=`precision highp float;
${atmosphericLightShader}
void main(){
 float angle=(floor(gl_FragCoord.x)*.5)*.01745329252;
 vec3 point=vec3(0.,0.,1.+(gl_FragCoord.y<1.?0.:425./6371.));
 vec3 direction=vec3(cos(angle),0.,sin(angle));
 gl_FragColor=vec4(sunlightTransmission(point,direction),1.);
}`;
// Exercise the production vertical density function independently of the map:
// Shallow decks, deep convection and translucent flanks have distinct profiles.
const cloudFixture=`precision highp float;
uniform float regional;
float coverage;
float noise(vec3 p){return regional;}
vec3 cloudCoordinates(vec3 p){return p;}
float cloudCoverage(vec3 p,float footprint,bool detailed){return coverage;}
${cloudShader.slice(cloudShader.indexOf('float filteredCloudNoise('),cloudShader.indexOf('float cloudLightTransmission('))}
void main(){
 coverage=gl_FragCoord.y<1.? .25:gl_FragCoord.y<2.? .6:1.;
 float height=gl_FragCoord.x/512.*12.;
 float density=cloudDensity(vec3(0.,0.,1.+height/6371.),.00001,true);
 gl_FragColor=vec4(vec3(density),1.);
}`;
const cloudSeamFixture=`precision highp float;
uniform sampler2D cloudMap;
const float time=0.;
mat2 rotate(float a){return mat2(1.);}
vec2 earthUV(vec3 n){return vec2(atan(n.y,n.x)/6.283185307+.5,asin(n.z)/3.141592654+.5);}
float detailedCloud(vec2 uv,float footprint,float fallback){return fallback;}
${cloudShader.slice(0,cloudShader.indexOf('// Once an octave'))}
void main(){
 float longitude=(gl_FragCoord.x/256.-.5)*.032*6.283185307;
 vec3 n=vec3(cos(longitude)*.5,sin(longitude)*.5,-.866025404);
 gl_FragColor=vec4(vec3(cloudCoverage(n,.00001,true)),1.);
}`;
const airglowFixture=`precision highp float;
const float time=0.;
uniform float daylight;
uniform float gain;
uniform vec3 sunDirection;
const vec3 cameraPosition=vec3(0.,0.,1.+425./6371.);
${sceneShader.slice(sceneShader.indexOf('float hash('),sceneShader.indexOf('mat2 rotate('))}
${airglowLightShader}
${sceneShader.slice(sceneShader.indexOf('vec3 airglowSegment('),sceneShader.indexOf('float cityEmission('))}
void main(){
  float height=-10.+gl_FragCoord.x/512.*150.;
  float q=(1.+height/6371.)/cameraPosition.z;
  vec3 ray=vec3(q,0.,-sqrt(1.-q*q));
  float b=dot(cameraPosition,ray);
  float d=b*b-dot(cameraPosition,cameraPosition)+1.;
  float ground=d>=0.?-b-sqrt(d):-1.;
  gl_FragColor=vec4(airglowEmission(ray,ground)*gain+daylight*1e-12,1.);
}`;
try{
 await run('set','viewport','1440','966');
 await run('open',`${base}/?t=1645.72&motion=0`);await wait(settled);
 const tileSeams=await verifyTileSeams(evaluate);results.push({tileSeams});console.log('tile seams: partial residency, fade, corners and dateline',tileSeams);
 const lighting=await verifyLighting(evaluate);results.push({lighting});console.log('lighting: eclipses and source-dependent moonlight',lighting);
 const weather=await verifyWeather(evaluate);results.push({weather});console.log('cloud shadows: comparison with 512-sample integral',weather);
 const nightLight=await verifyNightLight(evaluate);results.push({nightLight});console.log('night light: linear radiance and local city scattering',nightLight);
 const aurora=await verifyAurora(evaluate);results.push({aurora});console.log('aurora',aurora);
 const summitHeights=await verifyTerrainHeights(evaluate);results.push({summitHeights});console.log('summit heights: packed atlas and actual ray intersections',summitHeights);
 const terrain=await verifyTerrain(evaluate);results.push({terrain});console.log('terrain: real slopes and mountain shadows respond to sunlight',terrain);
 const lensEnergy=await verifyLensEnergy(evaluate);results.push({lensEnergy});console.log('lens: integrated reflection energy remains bounded',lensEnergy);
 const catalog=await verifyCatalog(evaluate);results.push({catalog});console.log('catalog: compact cores retain flux during subpixel movement',catalog);
 const optical=await evaluate(`(()=>{
  function render(source,w,h,ev){
   const c=document.createElement('canvas');c.width=w;c.height=h;const gl=c.getContext('webgl');gl.disable(gl.DITHER);
   gl.getExtension('EXT_shader_texture_lod');gl.getExtension('OES_standard_derivatives');
   const compile=(type,code)=>{const s=gl.createShader(type);gl.shaderSource(s,code);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
   const p=gl.createProgram();gl.attachShader(p,compile(gl.VERTEX_SHADER,'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}'));gl.attachShader(p,compile(gl.FRAGMENT_SHADER,source));gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));gl.useProgram(p);gl.uniform1f(gl.getUniformLocation(p,'ev'),ev);
   const tex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,tex);
   const cloudSeam=source.includes('cloudMapSample');gl.uniform1f(gl.getUniformLocation(p,'cloudMapWidth'),128);
   const plate=new Uint8Array(128*64*4);for(let y=0;y<64;y++)for(let x=0;x<128;x++){const i=(y*128+x)*4;plate[i]=plate[i+1]=plate[i+2]=(cloudSeam?x<64:(x<16||x>=112))?255:0;plate[i+3]=255;}
   gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,128,64,0,gl.RGBA,gl.UNSIGNED_BYTE,plate);gl.generateMipmap(gl.TEXTURE_2D);
   if(cloudSeam){gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);}
   const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);const a=gl.getAttribLocation(p,'p');gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,2,gl.FLOAT,false,0,0);gl.drawArrays(gl.TRIANGLES,0,3);
   const v=new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,v);if(gl.getError())throw Error('optical fixture GL error');gl.getExtension('WEBGL_lose_context')?.loseContext();return v;
  }
  const sunlight=Array.from(render(${JSON.stringify(sunlightFixture)},181,2,0));
  const seamClouds=Array.from(render(${JSON.stringify(cloudSeamFixture)},256,1,0)).filter((_,i)=>i%4===0);
  if(seamClouds[0]<250||seamClouds.at(-1)>5||Math.max(...seamClouds.slice(1).map((v,i)=>Math.abs(v-seamClouds[i])))>5)throw Error('cloud plate seam is discontinuous');
  const highlights=Array.from(render(${JSON.stringify(highlightFixture)},256,2,0));
  const seam=[false,true].map(explicit=>{const header=explicit?'#extension GL_EXT_shader_texture_lod : enable\\n#extension GL_OES_standard_derivatives : enable\\n#define SKY_EXPLICIT_GRAD 1\\n':'';return Math.min(...render(header+${JSON.stringify(skySeamFixture)},64,4,0));});
  const surfaceSeam=[false,true].map(explicit=>{const header=explicit?'#extension GL_EXT_shader_texture_lod : enable\\n#extension GL_OES_standard_derivatives : enable\\n#define SKY_EXPLICIT_GRAD 1\\n':'';return Math.min(...render(header+${JSON.stringify(surfaceSeamFixture)},64,4,0));});
  return {sunlight,highlights,seam,surfaceSeam};
 })()`);
 for(const minimum of optical.surfaceSeam)assert.equal(minimum,255,'Earth longitude seam must not select a dark coarse mip');
 for(const minimum of optical.seam)assert.equal(minimum,255,'panorama seam must not select a dark coarse mip');
 for(let i=0;i<256;i++){
  const warm=optical.highlights.slice(i*4,i*4+3),neutral=optical.highlights.slice((256+i)*4,(256+i)*4+3);
  assert.equal(neutral[0],neutral[1]);assert.equal(neutral[1],neutral[2]);
  if(i<68)for(let c=0;c<3;c++)assert.ok(Math.abs(warm[c]-i*3*[1,.6,.32][c])<=1,'midtones keep color and energy');
  if(i>=170)assert.deepEqual(warm,[255,255,255],'overexposed cores approach white');
  if(i>0)for(let c=0;c<3;c++)assert.ok(warm[c]>=optical.highlights[(i-1)*4+c],'highlight channels remain monotonic');
 }
 results.push({highlights:{warmMid:optical.highlights.slice(40*4,40*4+3),whiteCore:optical.highlights.slice(180*4,180*4+3)},skySeam:optical.seam,surfaceSeam:optical.surfaceSeam});
 // Compare GPU extinction against a high-resolution independent midpoint integral.
 for(let i=0;i<=180;i++){
  const angle=i*.5*Math.PI/180,b=Math.sin(angle),distance=-b+Math.sqrt(b*b+1.018835**2-1);
  let column=0;const steps=4096;
  for(let j=0;j<steps;j++){const t=(j+.5)*distance/steps;column+=Math.exp(-(Math.sqrt(1+2*b*t+t*t)-1)*6371/8)*distance/steps;}
  for(let c=0;c<3;c++)assert.ok(Math.abs(optical.sunlight[i*4+c]/255-Math.exp(-[36.9518,86.0085,210.8801][c]*column))<.012,'solar transmission agrees with independent integral');
  assert.deepEqual(optical.sunlight.slice((181+i)*4,(181+i)*4+3),[255,255,255],'outward sunlight in vacuum stays white');
 }
 assert.ok(optical.sunlight[0]>optical.sunlight[1]&&optical.sunlight[1]>optical.sunlight[2],'grazing sunlight warms naturally');
 results.push({solarOptics:{horizon:optical.sunlight.slice(0,3),zenith:optical.sunlight.slice(720,723)}});
 const radiance=await verifyCityRadiance(evaluate);results.push({radiance});
 console.log('radiance: RGBE preserves HDR/chroma, city curve retains black, faint networks and core gradation');
 const cloudProfiles=await evaluate(`(()=>{
  const c=document.createElement('canvas');c.width=512;c.height=3;const gl=c.getContext('webgl');gl.disable(gl.DITHER);
  const compile=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
  const p=gl.createProgram();gl.attachShader(p,compile(gl.VERTEX_SHADER,'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}'));gl.attachShader(p,compile(gl.FRAGMENT_SHADER,${JSON.stringify(cloudFixture)}));gl.linkProgram(p);gl.useProgram(p);
  const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);const a=gl.getAttribLocation(p,'p');gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,2,gl.FLOAT,false,0,0);
  const sample=regional=>{gl.uniform1f(gl.getUniformLocation(p,'regional'),regional);gl.drawArrays(gl.TRIANGLES,0,3);const bytes=new Uint8Array(512*3*4);gl.readPixels(0,0,512,3,gl.RGBA,gl.UNSIGNED_BYTE,bytes);return Array.from({length:3},(_,row)=>{const profile=Array.from({length:512},(_,x)=>bytes[(row*512+x)*4]);const lower=profile.findIndex(v=>v>1)*12/512,upper=profile.findLastIndex(v=>v>1)*12/512;return {lower,upper,tau:profile.reduce((sum,v)=>sum+v/255*12/512,0),thickness:upper-lower,maxStep:Math.max(...profile.slice(1).map((v,i)=>Math.abs(v-profile[i])))};});};
  const low=sample(.25),high=sample(.75),error=gl.getError();gl.getExtension('WEBGL_lose_context')?.loseContext();return {low,high,error};
 })()`);
 assert.equal(cloudProfiles.error,0);
 for(const group of [cloudProfiles.low,cloudProfiles.high]){
  for(const profile of group){assert.ok(profile.thickness>.4);assert.ok(profile.maxStep<12,'no abrupt density shelf');}
 }
 console.log('cloud density profiles',cloudProfiles);
 assert.ok(cloudProfiles.low[2].upper<4,'low decks stay below the middle cloud layer');
 assert.ok(cloudProfiles.high[2].upper>9,'selected convection reaches the upper cloud layer');
 assert.ok(cloudProfiles.high[2].tau>cloudProfiles.low[2].tau,'active regions retain greater optical depth');
 for(const group of [cloudProfiles.low,cloudProfiles.high]){
  assert.ok(group[2].tau>.15&&group[2].tau<8.,'bounded cloud optical depth');
  assert.ok(1-Math.exp(-group[2].tau*12)>.9,'long grazing paths accumulate opacity');
  assert.ok(group[0].tau<group[2].tau*.25,'thin edges remain translucent');
 }
 assert.ok(cloudProfiles.high[2].lower>cloudProfiles.low[2].lower+.15,'regional cloud bases must not share one sphere');
 results.push({cloudProfiles});
 const sensor=await evaluate(`(()=>{
  const c=document.createElement('canvas');c.width=c.height=256;const gl=c.getContext('webgl');gl.disable(gl.DITHER);
  const compile=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
  const p=gl.createProgram();gl.attachShader(p,compile(gl.VERTEX_SHADER,'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}'));gl.attachShader(p,compile(gl.FRAGMENT_SHADER,${JSON.stringify(sensorFixture)}));gl.linkProgram(p);gl.useProgram(p);
  const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);const a=gl.getAttribLocation(p,'p');gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,2,gl.FLOAT,false,0,0);
  const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array(4));gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
  const sample=(signal,iso,grain)=>{gl.uniform1f(gl.getUniformLocation(p,'signal'),signal);gl.uniform1f(gl.getUniformLocation(p,'iso'),iso);gl.uniform1f(gl.getUniformLocation(p,'grainAmount'),grain);gl.drawArrays(gl.TRIANGLES,0,3);const v=new Uint8Array(256*256*4);gl.readPixels(0,0,256,256,gl.RGBA,gl.UNSIGNED_BYTE,v);let sum=0,square=0;for(let i=0;i<v.length;i+=4){sum+=v[i];square+=v[i]*v[i];}const mean=sum/65536;return {mean,variance:square/65536-mean*mean};};
  const base=sample(.02,1,1),samePhotons=sample(.02,2,1),sameBrightness=sample(.01,2,1),off=sample(.02,1,0),error=gl.getError();gl.getExtension('WEBGL_lose_context')?.loseContext();return {base,samePhotons,sameBrightness,off,error};
 })()`);
 assert.equal(sensor.error,0);assert.equal(sensor.off.variance,0);
 assert.ok(Math.abs(sensor.samePhotons.mean/sensor.base.mean-2)<.02);
 assert.ok(sensor.samePhotons.variance/sensor.base.variance>3.5&&sensor.samePhotons.variance/sensor.base.variance<4.5);
 assert.ok(Math.abs(sensor.sameBrightness.mean/sensor.base.mean-1)<.02);
 assert.ok(sensor.sameBrightness.variance/sensor.base.variance>1.7&&sensor.sameBrightness.variance/sensor.base.variance<2.3);
 results.push({sensor});console.log('sensor: ISO amplifies signal and noise, fewer photons worsen SNR, zero grain is clean');
 const exposure=await verifyExposure(evaluate);results.push({exposure});console.log('auto exposure: histogram, shared bounds, manual mode and flash rejection',exposure);
 // Isolate the actual airglow GLSL on the GPU. Observer daylight must not
 // morph its altitude profile, while local sunlight must still dim emission.
 const airglow=await evaluate(`(()=>{
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=1;
  const gl=canvas.getContext('webgl');
  const compile=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
  const p=gl.createProgram();
  gl.attachShader(p,compile(gl.VERTEX_SHADER,'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}'));
  gl.attachShader(p,compile(gl.FRAGMENT_SHADER,${JSON.stringify(airglowFixture)}));
  gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));gl.useProgram(p);
  const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
  const a=gl.getAttribLocation(p,'p');gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,2,gl.FLOAT,false,0,0);gl.disable(gl.DITHER);
  const render=(day,sun,gain)=>{gl.uniform1f(gl.getUniformLocation(p,'daylight'),day);gl.uniform1f(gl.getUniformLocation(p,'gain'),gain);gl.uniform3f(gl.getUniformLocation(p,'sunDirection'),0,0,sun);gl.drawArrays(gl.TRIANGLES,0,3);const bytes=new Uint8Array(512*4);gl.readPixels(0,0,512,1,gl.RGBA,gl.UNSIGNED_BYTE,bytes);return Array.from(bytes);};
  const night=render(0,-1,200),transition=render(.5,-1,200),observerDay=render(1,-1,200),localDay=render(1,1,200),normalizedDay=render(1,1,8000);
  const delta=(a,b)=>Math.max(...a.map((v,i)=>Math.abs(v-b[i])));
  const energy=a=>a.reduce((s,v,i)=>s+(i%4===3?0:v),0);
  const reds=night.filter((_,i)=>i%4===0),peak=Math.max(...reds),peakHeight=-10.+(reds.indexOf(peak)+.5)/512*150.;
  const result={observerDelta:Math.max(delta(night,transition),delta(night,observerDay)),normalizedSunDelta:delta(night,normalizedDay),dayRatio:energy(localDay)/energy(night),peak,peakHeight,limbStep:Math.abs(reds[34]-reds[33]),error:gl.getError()};
  gl.deleteProgram(p);gl.deleteBuffer(buffer);gl.getExtension('WEBGL_lose_context')?.loseContext();return result;
 })()`);
 console.log('airglow measurements',airglow);
 assert.equal(airglow.error,0);assert.equal(airglow.observerDelta,0);
 assert.ok(airglow.normalizedSunDelta<=1);
 assert.ok(airglow.dayRatio>.015&&airglow.dayRatio<.035);
 assert.ok(airglow.peak>20&&airglow.peak<254);
 assert.ok(airglow.peakHeight>70&&airglow.peakHeight<105);
 assert.ok(airglow.limbStep<airglow.peak*.05);
 results.push({airglow});console.log('airglow: fixed altitude profile, local sunrise fade, continuous solid limb',airglow);
 for(const pose of ['t=900&yaw=79&pitch=-10','t=1200&yaw=100&pitch=-10','t=900&yaw=79&pitch=-10&aurora=0']){
  await run('open',`${base}/?${pose}&motion=0`);await wait(settled);
  assert.equal(await evaluate("document.querySelector('canvas').getContext('webgl').getError()"),0);
  assert.equal(await evaluate("document.querySelector('orbital-sky').dataset.aurora"),pose.includes('aurora=0')?'off':'volume');
  await run('screenshot',`${out}/aurora-${pose.replaceAll('&','-').replaceAll('=','_')}.png`);
 }
 for(const time of [0,1000,1338.89,2488.10,2753.09,4156.13,4594.06]){
  await run('open',`${base}/?t=${time}&motion=0&quality=fixed`);await wait(settled);
  const state=await evaluate(`(()=>{const e=document.querySelector('orbital-sky'),i=e.querySelector('[data-look=grain]');i.value='0';i.dispatchEvent(new Event('input'));const c=e.querySelector('canvas'),gl=c.getContext('webgl');return {time:${time},ready:e.hasAttribute('data-ready'),error:gl.getError(),data:{...e.dataset},canvas:[c.width,c.height]};})()`);
  assert.equal(state.ready,true);assert.equal(state.error,0);assert.equal(state.data.assetFailures,'0');
  assert.deepEqual([state.data.terrainWork,state.data.terrainRefinement,state.data.cloudSteps],['bounded','pixel','balanced']);
  if(state.data.terrainTiles){const terrain=JSON.parse(state.data.terrainTiles);for(const [field,name] of [['cacheMode','SCENE_TERRAIN_CACHE'],['decoderMode','SCENE_TERRAIN_DECODER'],['sourceMode','SCENE_TERRAIN_SOURCE']])if(process.env[name])assert.equal(terrain[field],process.env[name]);if(process.env.SCENE_TERRAIN_SOURCE==='packed')assert.equal(terrain.packedFallbacks,0);}
  await run('screenshot',`${out}/frame-${time}.png`);results.push(state);console.log(`frame ${time}: clean`);
 }
 // The historical renderer remains available for matched comparisons.
 if(process.env.SCENE_TERRAIN_SOURCE==='packed'){
  await run('open',`${base}/?t=3235.65&pitch=-25&motion=0&quality=fixed`);await wait(settled);
  const terrain=await evaluate(`JSON.parse(document.querySelector('orbital-sky').dataset.terrainTiles)`);
  assert.equal(terrain.sourceMode,'packed');assert.ok(terrain.packedDecodes>0);assert.equal(terrain.packedFallbacks,0);assert.ok(terrain.fineResident>0);
  console.log('prepared terrain: actual packed residents, no TIFF error fallback');
 }
 await run('open',`${base}/?t=1338.89&motion=0&quality=fixed&terrainWork=legacy&terrainRefinement=full&cloudSteps=full`);await wait(settled);
 const legacyWork=await evaluate(`(()=>{const e=document.querySelector('orbital-sky');return {work:[e.dataset.terrainWork,e.dataset.terrainRefinement,e.dataset.cloudSteps],failures:e.dataset.assetFailures,error:e.querySelector('canvas').getContext('webgl').getError()};})()`);
 assert.deepEqual(legacyWork.work,['legacy','full','full']);assert.equal(legacyWork.failures,'0');assert.equal(legacyWork.error,0);
 results.push({legacyWork});console.log('ray work: optimized defaults and explicit legacy settings render cleanly');
 // Refine failures must retain preview images and still complete focus.
 for(const failure of ['psf','detail','all']){
  await run('open',`${base}/?t=1338.89&motion=0&quality=fixed`);await wait(settled);
  await evaluate(`(()=>{const original=fetch.bind(window);window.fetch=(url,o)=>{const u=String(url),fail=${JSON.stringify(failure)};return (u.includes('/media/orbit/')&&(fail==='all'||fail==='psf'&&u.includes('optical-psf.bin')||fail==='detail'&&!u.includes('/preview/')&&!u.includes('stars-hyg.bin')&&!u.includes('optical-psf.bin')))?Promise.resolve(new Response('',{status:503})):original(url,o);};const e=document.querySelector('orbital-sky'),copy=e.cloneNode(true);for(const key of Object.keys(copy.dataset))if(!['composition','astroCidNouzbqmj'].includes(key))delete copy.dataset[key];e.replaceWith(copy);return true;})()`);
  await wait("document.querySelector('orbital-sky').dataset.assetPhase==='settled'");
  if(failure!=='all')await wait("document.querySelector('orbital-sky').dataset.focus==='sharp'");
  const state=await evaluate(`(()=>{const e=document.querySelector('orbital-sky');return {failure:${JSON.stringify(failure)},ready:e.hasAttribute('data-ready'),data:{...e.dataset},fallback:getComputedStyle(e.querySelector('.sky-fallback')).backgroundImage};})()`);
  assert.equal(state.ready,failure!=='all');assert.ok(Number(state.data.assetFailures)>0);
  if(failure==='all')assert.ok(state.fallback.includes('poster.webp'));
  results.push(state);console.log(`failure ${failure}: fallback works`);
 }
 // Lose the context while decoded inputs and strip uploads are queued.
 await run('open',`${base}/?t=2488.10&motion=0`);
 await evaluate(`(()=>{
  const old=document.querySelector('orbital-sky'),e=old.cloneNode(true);
  for(const key of Object.keys(e.dataset))if(key!=='composition'&&!key.startsWith('astro'))delete e.dataset[key];
  old.replaceWith(e);
  const gl=e.querySelector('canvas').getContext('webgl'),native=gl.texSubImage2D.bind(gl);
  window.loadingContextLost=false;
  gl.texSubImage2D=(...args)=>{
   const result=native(...args);
   if(!window.loadingContextLost){
    window.loadingContextLost=true;gl.texSubImage2D=native;
    const ext=gl.getExtension('WEBGL_lose_context');
    ext.loseContext();setTimeout(()=>ext.restoreContext(),150);
   }
   return result;
  };
  return true;
 })()`);
 await wait("window.loadingContextLost&&document.querySelector('orbital-sky').hasAttribute('data-terrain-ready')&&"+settled);
 assert.equal(await evaluate("document.querySelector('canvas').getContext('webgl').getError()"),0);
 assert.equal(await evaluate("document.querySelector('orbital-sky').dataset.assetFailures"),'0');
 results.push({loadingContextRestored:true});console.log('queued uploads: context restoration works');
 await run('set','viewport','390','844');await run('open',`${base}/?t=2488.10&motion=0`);await wait(settled);
 await evaluate(`(()=>{const e=document.querySelector('orbital-sky'),gl=e.querySelector('canvas').getContext('webgl');const ext=gl.getExtension('WEBGL_lose_context');window.restoreScene=()=>ext.restoreContext();ext.loseContext();return true;})()`);
 await wait("!document.querySelector('orbital-sky').hasAttribute('data-ready')");
 await evaluate('window.restoreScene();true');
 await wait("document.querySelector('orbital-sky').hasAttribute('data-terrain-ready')&&document.querySelector('orbital-sky').hasAttribute('data-ready')");
 const restored=true;
 assert.equal(await evaluate("document.querySelector('canvas').getContext('webgl').getError()"),0);
 await run('screenshot',`${out}/mobile-restored.png`);results.push({mobileContextRestored:restored});
 assert.equal(await evaluate("document.querySelector('orbital-sky').dataset.dayMapWidth"),'2048');
 // A real viewport resize must still update the targets and camera aspect.
 await run('set','viewport','844','390');
 await wait("document.querySelector('canvas').width>document.querySelector('canvas').height");
 const landscape=await evaluate(`(()=>{const c=document.querySelector('canvas');return {css:[c.clientWidth,c.clientHeight],buffer:[c.width,c.height],error:c.getContext('webgl').getError()};})()`);
 assert.deepEqual(landscape.css,[844,390]);assert.equal(landscape.error,0);
 assert.equal(await evaluate("document.querySelector('orbital-sky').dataset.dayMapWidth"),'2048');
 // Crossing the render-pixel threshold promotes only the color overview.
 // Shrinking again must not download/downgrade it repeatedly.
 await run('set','viewport','1600','900');
 await wait("document.querySelector('orbital-sky').dataset.dayMapWidth==='4096'");
 await run('set','viewport','390','844');
 await wait("document.querySelector('canvas').height>document.querySelector('canvas').width");
 assert.equal(await evaluate("document.querySelector('orbital-sky').dataset.dayMapWidth"),'4096');
 results.push({viewportRotation:landscape});console.log('viewport rotation: targets follow the new aspect');
 // Exercise actual RAF playback, pause and seek without relying on a screenshot.
 const motion=await evaluate(`(()=>{const e=document.querySelector('orbital-sky'),gl=e.querySelector('canvas').getContext('webgl'),native=gl.drawArrays.bind(gl);let frames=0;gl.drawArrays=(...a)=>{if(a[0]===gl.POINTS)frames++;return native(...a);};const button=e.querySelector('.sky-motion'),seek=e.querySelector('.sky-track input');seek.value='45';seek.dispatchEvent(new Event('input'));if(button.getAttribute('aria-label')==='Play')button.click();const start=performance.now();return new Promise(resolve=>setTimeout(()=>{button.click();gl.drawArrays=native;resolve({fps:frames*1000/(performance.now()-start),error:gl.getError(),scale:e.dataset.renderScale});},6000));})()`);
 assert.equal(motion.error,0);assert.ok(motion.fps>10);results.push(motion);console.log('motion',motion);
 // Exercise the guaranteed WebGL-1 sampler budget, without optional cloud LOD.
 await run('open',`${base}/?t=2488.10&motion=0&quality=fixed`);await wait(settled);
 await evaluate(`(()=>{const p=WebGLRenderingContext.prototype,get=p.getParameter,extension=p.getExtension;p.getParameter=function(key){return key===this.MAX_TEXTURE_IMAGE_UNITS?8:key===this.MAX_TEXTURE_SIZE?4096:get.call(this,key);};p.getExtension=function(name){return name==='EXT_shader_texture_lod'?null:extension.call(this,name);};const e=document.querySelector('orbital-sky'),copy=e.cloneNode(true);for(const key of Object.keys(copy.dataset))if(key!=='composition'&&!key.startsWith('astro'))delete copy.dataset[key];e.replaceWith(copy);return true;})()`);
 await wait(settled);
 const basic=await evaluate(`(()=>{const e=document.querySelector('orbital-sky');return {ready:e.hasAttribute('data-ready'),terrain:e.hasAttribute('data-terrain-ready'),error:e.querySelector('canvas').getContext('webgl').getError()};})()`);
 assert.equal(basic.ready,true);assert.equal(basic.terrain,false);assert.equal(basic.error,0);results.push({basicCapabilities:basic});console.log('basic WebGL capabilities: fallback works');
 // Save-Data must suppress both large overview maps and streamed detail.
 await run('open',`${base}/?t=2488.10&motion=0`);await wait(settled);
 await evaluate(`(()=>{Object.defineProperty(navigator,'connection',{configurable:true,value:{saveData:true}});performance.clearResourceTimings();window.saveDataStarted=performance.now();const e=document.querySelector('orbital-sky'),copy=e.cloneNode(true);for(const key of Object.keys(copy.dataset))if(key!=='composition'&&!key.startsWith('astro'))delete copy.dataset[key];e.replaceWith(copy);return true;})()`);
 await wait(settled);
 // Clearing completed entries does not remove prior in-flight DEM requests.
 const compact=await evaluate(`performance.getEntriesByType('resource').filter(x=>x.startTime>=window.saveDataStarted&&x.name.includes('/media/orbit/')).map(x=>x.name)`);
 assert.ok(compact.length>=6);assert.ok(compact.every(x=>x.includes('/preview/')||x.endsWith('stars-hyg.bin')||x.endsWith('optical-psf.bin')));results.push({saveDataRequests:compact.length});
 console.log('save-data: no large maps or tiles');
 // Slow optional detail must not leave the scene permanently defocused.
 await run('open',`${base}/?t=1000&motion=0`);await wait(settled);
 const focus=await evaluate(`(()=>{const original=fetch.bind(window);window.fetch=async(u,o)=>{if(String(u).includes('/media/orbit/')&&!String(u).includes('/preview/')&&!String(u).endsWith('.bin'))await new Promise(r=>setTimeout(r,8000));return original(u,o);};const e=document.querySelector('orbital-sky'),copy=e.cloneNode(true);for(const key of Object.keys(copy.dataset))if(key!=='composition'&&!key.startsWith('astro'))delete copy.dataset[key];e.replaceWith(copy);const start=performance.now(),samples=[];return new Promise(resolve=>{const timer=setInterval(()=>{samples.push({at:performance.now()-start,radius:Number(copy.dataset.focusRadius),filter:getComputedStyle(copy.querySelector('canvas')).filter,focus:copy.dataset.focus,assets:copy.dataset.assetPhase});if(copy.dataset.focus==='sharp'||performance.now()-start>10000){clearInterval(timer);resolve(samples);}},100);});})()`);
 assert.ok(focus.some(x=>x.focus==='acquiring'&&x.radius>0&&x.filter==='none'));assert.equal(focus.at(-1).focus,'sharp');assert.notEqual(focus.at(-1).assets,'settled');results.push({slowFocus:focus});console.log('slow detail: focus deadline works');
 // An optical fixture checks the actual GPU kernel, rather than matching shader text:
 // defocusing must spread a point while preserving integrated linear light.
 for(const byteTarget of [false,true]){
 await run('open',`${base}/?t=1338.89&motion=0&quality=fixed`);await wait(settled);
 await evaluate(`(()=>{const p=WebGLRenderingContext.prototype,source=p.shaderSource,get=p.getUniformLocation,set=p.uniform1f,names=new WeakMap();window.fixtureRadius=0;const fetchImage=window.fetch.bind(window);window.fetch=async(u,o)=>{if(String(u).includes('/media/orbit/')&&!String(u).includes('/preview/')&&!String(u).endsWith('.bin'))await new Promise(r=>setTimeout(r,8000));return fetchImage(u,o);};if(${byteTarget}){const ext=p.getExtension;p.getExtension=function(name){return name==='OES_texture_half_float'?null:ext.call(this,name);};}p.shaderSource=function(shader,text){if(text.includes('CameraFinish owns defocus'))text=text.slice(0,text.indexOf('void main()'))+'void main(){vec2 d=abs(gl_FragCoord.xy-resolution*.5);float v=d.x<4.&&d.y<4.?.2:.02;vec3 color=displayToLinear(vec3(v));gl_FragColor=sceneLinear>.5?vec4(color,1.):packSceneRadiance(color);}';return source.call(this,shader,text);};p.getUniformLocation=function(prog,name){const loc=get.call(this,prog,name);if(loc)names.set(loc,name);return loc;};p.uniform1f=function(loc,v){return set.call(this,loc,names.get(loc)==='focusRadius'?window.fixtureRadius:v);};const e=document.querySelector('orbital-sky'),copy=e.cloneNode(true);for(const k of Object.keys(copy.dataset))if(k!=='composition'&&!k.startsWith('astro'))delete copy.dataset[k];e.replaceWith(copy);return true;})()`);
 await wait("document.querySelector('orbital-sky').hasAttribute('data-ready')");
 await run('wait','1800');
 const optical=await evaluate(`(async()=>{
  const e=document.querySelector('orbital-sky'),gl=e.querySelector('canvas').getContext('webgl');
  // UI invalidation is asynchronous. Read inside the final camera pass, before
  // the browser clears the non-preserved drawing buffer for presentation.
  const capture=(size,dx,dy)=>new Promise(resolve=>{
    const native=gl.drawArrays.bind(gl);
    gl.drawArrays=(...args)=>{
      native(...args);
      if(gl.getUniformLocation(gl.getParameter(gl.CURRENT_PROGRAM),'grainAmount')===null)return;
      gl.drawArrays=native;
      const pixels=new Uint8Array(size*size*4);
      gl.readPixels(Math.floor(gl.drawingBufferWidth/2)+dx,Math.floor(gl.drawingBufferHeight/2)+dy,size,size,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
      resolve(pixels);
    };
    e.querySelector('[data-look=grain]').dispatchEvent(new Event('input'));
  });
  for(const key of ['ghosts','chromatic','grain']){const input=e.querySelector('[data-look='+key+']');input.value='0';input.dispatchEvent(new Event('input'));}
  const samples=[];
  for(const radius of [0,6]){
    window.fixtureRadius=radius;
    const pixels=await capture(64,-32,-32);let energy=0,area=0;
    const linear=v=>v<=.04045?v/12.92:Math.pow((v+.055)/1.055,2.4);
    const background=pixels[0];
    for(let i=0;i<pixels.length;i+=4){energy+=Math.max(0,linear(pixels[i]/255)-linear(background/255));if(pixels[i]>background+3)area++;}
    samples.push({radius,energy,area});
  }
  e.querySelector('[data-look=grain]').value='1';
  const pixels=await capture(32,64,0),values=[];
  for(let i=0;i<pixels.length;i+=4)values.push(pixels[i]);
  const mean=values.reduce((s,x)=>s+x,0)/values.length;
  return {samples,noiseVariance:values.reduce((s,x)=>s+(x-mean)**2,0)/values.length,filter:getComputedStyle(e.querySelector('canvas')).filter,error:gl.getError()};
 })()`);
 console.log('defocus samples',optical.samples);
 assert.equal(optical.error,0);assert.equal(optical.filter,'none');
 assert.ok(Math.abs(optical.samples[1].energy/optical.samples[0].energy-1)<.08);
 assert.ok(optical.samples[1].area>optical.samples[0].area*2);
 assert.ok(optical.noiseVariance>.1);results.push({byteTarget,optical});console.log('optical defocus: spreads light, preserves energy, retains sensor grain');
 }
 await run('set','viewport','1440','966');
 await run('open',`${base}/?t=900&motion=0`);await wait(settled);
 const viewState=()=>evaluate(`(()=>{const e=document.querySelector('orbital-sky');return {yaw:Number(e.dataset.cameraYaw),pitch:Number(e.dataset.cameraPitch),motion:e.querySelector('.sky-motion').getAttribute('aria-label'),dragging:document.querySelector('.orbit-view').hasAttribute('data-camera-dragging'),url:location.search};})()`);
 await run('mouse','move','600','400');await run('mouse','down','right');
 await run('mouse','move','853','553');await run('mouse','up','right');
 const dragged=await viewState();
 assert.ok(Math.abs(dragged.yaw+253*180/Math.PI/(966*1.25))<.1);assert.ok(Math.abs(dragged.pitch-153*180/Math.PI/(966*1.25))<.1);
 assert.equal(dragged.motion,'Play');assert.equal(dragged.dragging,false);
 await wait("new URLSearchParams(location.search).has('yaw')");
 dragged.url=await run('get','url');
 assert.ok(Math.abs(Number(new URL(dragged.url.trim()).searchParams.get('yaw'))-dragged.yaw)<.1);
 await run('reload');await wait(settled);
 assert.equal((await viewState()).yaw,dragged.yaw);
 // A control click must not begin a camera drag, and dragging must not pause playback.
 await run('click','.sky-settings-toggle');
 assert.equal((await viewState()).yaw,dragged.yaw);
 await run('click','.sky-motion');
 await run('mouse','move','500','400');await run('mouse','down');await run('mouse','move','550','440');await run('mouse','up');
 assert.equal((await viewState()).motion,'Pause');
 await evaluate("document.querySelector('.sky-motion').click();true");
 await run('mouse','move','500','400');await run('mouse','down');
 await evaluate("window.dispatchEvent(new Event('blur'));true");
 assert.equal((await viewState()).dragging,false);await run('mouse','up');
 results.push({cameraDrag:dragged});console.log('camera drag: fractional movement, URL reload, playback and cancellation');
 await evaluate("document.activeElement.blur();true");
 await run('press','Space');assert.equal((await viewState()).motion,'Pause');
 await evaluate("window.dispatchEvent(new KeyboardEvent('keydown',{code:'Space',repeat:true,bubbles:true}));true");
 assert.equal((await viewState()).motion,'Pause');
 await run('press','Space');assert.equal((await viewState()).motion,'Play');
 await evaluate("document.querySelector('#sky-settings').showPopover();document.querySelector('[data-view=yaw]').focus();true");
 await run('press','Space');assert.equal((await viewState()).motion,'Play');
 results.push({spacePlayback:true});console.log('space: toggles playback, ignores repeats and focused sliders');
 const canvasResize=await verifyCanvasResize({run,evaluate,wait,base});results.push({canvasResize});console.log('canvas resize: repaints before presentation',canvasResize);
 const textureBitmap=await verifyTextureBitmap(evaluate);results.push({textureBitmap});console.log('texture crops: exact numeric bytes at atlas edges',textureBitmap);
 const flight=await verifyFlight({run,evaluate,wait,base});results.push({flight});console.log('flight: routes, bounds, pause, URL restoration and input ownership',flight);
 const touch=await verifyTouch({run,evaluate,wait,base});results.push({touch});console.log('touch: look, pan, pinch and native controls',touch);
 const calendar=await verifyCalendar({run,evaluate,wait,base});results.push({calendar});console.log('calendar: lighting, camera independence, URL restoration and reset',calendar);
 await writeFile(`${out}/results.json`,JSON.stringify(results,null,2));
}finally{await run('close');}
