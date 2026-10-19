import assert from 'node:assert/strict';
import {browserModule} from './browser-module.mjs';
import * as cameraModel from '../src/scripts/camera-model.ts';
export async function verifyExposure(evaluate){
 const exposureModule=await browserModule('camera-exposure');
 const exposure=await evaluate(`(()=>{
  const exports=${exposureModule};
  const canvas=document.createElement('canvas'),gl=canvas.getContext('webgl');
  const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);
  for(const f of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,f,gl.NEAREST);
  const fill=value=>{gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([value,value,value,255]));};
  const read=()=>{const v=new Uint8Array(4);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,v);return (v[0]*256+v[1])/65535*${cameraModel.EXPOSURE_MAX_EV-cameraModel.EXPOSURE_MIN_EV}+(${cameraModel.EXPOSURE_MIN_EV});};
  const run=hz=>{const meter=new exports.CameraExposure(gl);fill(10);meter.update(texture,true,false,0);const first=read();fill(1);const rise=[];for(let i=1;i<=7*hz;i++){meter.update(texture,true,false,i*1000/hz);if(i%hz===0)rise.push(read());}fill(10);const fall=[];for(let i=1;i<=hz;i++){meter.update(texture,true,false,7000+i*1000/hz);if(i%Math.round(hz/5)===0)fall.push(read());}const held=read();meter.update(texture,true,false,8000);const sameTime=read();meter.dispose();return {first,rise,fall,held,sameTime};};
  const low=run(30),high=run(120);
  const solar=(position,visible=1)=>{const meter=new exports.CameraExposure(gl);fill(1);meter.update(texture,true,false,0,[position,.13,visible],1.5);const ev=read();meter.dispose();return ev;};
  const sun=solar(.17),offscreen=solar(2),occluded=solar(.17,0);
  const highlightMeter=new exports.CameraExposure(gl);fill(255);highlightMeter.update(texture,true,false,0);const highlight=read();highlightMeter.dispose();
  const emission=(band,offset=0)=>{const meter=new exports.CameraExposure(gl),pixels=new Uint8Array(128*128*4);
   for(let y=0;y<128;y++)for(let x=0;x<128;x++){let i=(y*128+x)*4;pixels[i+3]=255;if(band?y>=offset&&y<offset+4:x===66&&y===66){pixels[i]=5;pixels[i+1]=128;pixels[i+2]=12;}}
   gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,128,128,0,gl.RGBA,gl.UNSIGNED_BYTE,pixels);meter.update(texture,true,false,0,[0,0,0],1.5,null,null);const ev=read();meter.dispose();return ev;};
  const aurora=emission(true,66),auroraShifted=emission(true,69),point=emission(false);
  // A bright 14x14 block on black: 1.2% of the frame, a small Earth or a zoomed Moon.
  const block=(()=>{const meter=new exports.CameraExposure(gl),pixels=new Uint8Array(128*128*4);
   for(let y=0;y<128;y++)for(let x=0;x<128;x++){const i=(y*128+x)*4;pixels[i+3]=255;if(x>=57&&x<71&&y>=57&&y<71)pixels[i]=pixels[i+1]=pixels[i+2]=128;}
   gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,128,128,0,gl.RGBA,gl.UNSIGNED_BYTE,pixels);meter.update(texture,true,false,0,[0,0,0],1.5,null,null);const ev=read();meter.dispose();return ev;})();
  const uniform=(value,manual=null)=>{const meter=new exports.CameraExposure(gl);fill(value);meter.update(texture,true,false,0,[0,0,0],1.5,null,manual);const ev=read();meter.dispose();return ev;};
  const uniformLevels=[0,1,4,16,64,255].map(value=>uniform(value));
  const manual=[0,1,255].map(value=>uniform(value,1.2));
  const manualMinimum=uniform(255,${cameraModel.EXPOSURE_MIN_EV});
  const flashMeter=new exports.CameraExposure(gl);fill(1);flashMeter.update(texture,true,false,0);const beforeFlash=read();fill(255);
  const flash=[];for(let i=1;i<=8;i++){flashMeter.update(texture,true,false,i*10);flash.push(read());}
  fill(1);flashMeter.update(texture,true,false,90);const afterFlash=read();flashMeter.dispose();
  const error=gl.getError();gl.deleteTexture(texture);gl.getExtension('WEBGL_lose_context')?.loseContext();return {low,high,sun,offscreen,occluded,highlight,aurora,auroraShifted,point,block,uniformLevels,manual,manualMinimum,beforeFlash,flash,afterFlash,error};
 })()`);
 assert.equal(exposure.error,0);
 assert.ok(Math.abs(exposure.sun-cameraModel.AUTO_EXPOSURE_MIN_EV)<.001,'solar disk reaches the brighter automatic floor even between grid taps');
 assert.ok(Math.abs(exposure.offscreen-exposure.occluded)<.001,'occluded and offscreen sunlight cannot affect the meter');
 assert.ok(Math.abs(exposure.highlight-cameraModel.AUTO_EXPOSURE_MIN_EV)<.001,'extended glare reaches the brighter automatic floor');
 assert.ok(exposure.aurora<1.0,'thin colored emission protects its strongest channel');
 assert.ok(Math.abs(exposure.aurora-exposure.auroraShifted)<.05,'moving a thin curtain between grid rows must retain metering');
 assert.ok(exposure.point>4,'an isolated point must not darken the sky');
 assert.ok(exposure.block<cameraModel.EXPOSURE_MAX_EV-.5,'a bright region of 1.2% pulls exposure below the black-sky ceiling');
 assert.ok(Math.abs(exposure.uniformLevels[0]-cameraModel.EXPOSURE_MAX_EV)<.001,'black frame reaches the single bounded ceiling');
 for(let i=1;i<exposure.uniformLevels.length;i++)assert.ok(exposure.uniformLevels[i]<=exposure.uniformLevels[i-1],'more light never raises exposure');
 for(let i=2;i<5;i++)if(exposure.uniformLevels[i]>cameraModel.AUTO_EXPOSURE_MIN_EV+.001)assert.ok(Math.abs(exposure.uniformLevels[i-1]-exposure.uniformLevels[i]-2)<.005,'fourfold radiance reduces exposure by two stops');
 assert.ok(Math.abs(exposure.manualMinimum-cameraModel.EXPOSURE_MIN_EV)<.001,'manual mode retains its original lower limit');
 assert.ok(exposure.manual.every(ev=>Math.abs(ev-1.2)<.001),'manual exposure stays fixed from dark to daylight');
 assert.ok(exposure.flash.every(ev=>Math.abs(ev-exposure.beforeFlash)<.005)&&Math.abs(exposure.afterFlash-exposure.beforeFlash)<.005,'an 80 ms flash cannot pump exposure');
 for(const sample of [exposure.low,exposure.high]){
  const target=exposure.uniformLevels[1];
  assert.ok(Math.abs(sample.rise[0]-(target+(sample.first-target)*Math.exp(-1/1.25)))<.005);
  assert.ok(sample.rise.every((v,i,a)=>i===0||v>=a[i-1]));
  assert.ok(Math.abs(sample.rise.at(-1)-(target+(sample.first-target)*Math.exp(-7/1.25)))<.004);
  assert.ok(sample.fall.every((v,i,a)=>i===0||v<=a[i-1]));
  assert.ok(sample.fall.at(-1)<sample.first+.7,'sustained daylight converges after the flash hold');
  assert.equal(sample.held,sample.sameTime);
 }
 assert.ok(Math.abs(exposure.low.rise[0]-exposure.high.rise[0])<.002);
 exposure.pyramid=await verifyPyramidMeter(evaluate,exposureModule);
 return exposure;
}

// The pyramid meter on float scenes of 1200 x 800: stars must not count, a
// half-lit Moon of 40 px (5x zoom) must, wherever it falls, and a uniform
// frame must meter as with point samples.
async function verifyPyramidMeter(evaluate,exposureModule){
 const glareModule=await browserModule('camera-glare');
 const result=await evaluate(`(()=>{
  const exposure=${exposureModule},glareExports=${glareModule};
  const w=1200,h=800,canvas=document.createElement('canvas'),gl=canvas.getContext('webgl2');
  if(!gl?.getExtension('EXT_color_buffer_float'))throw Error('Float metering unavailable');
  const scene=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,scene);
  for(const f of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,f,gl.LINEAR);
  for(const a of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,a,gl.CLAMP_TO_EDGE);
  const glare=new glareExports.CameraGlare(gl,gl.HALF_FLOAT);
  const read=()=>{const v=new Uint8Array(4);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,v);return (v[0]*256+v[1])/65535*${cameraModel.EXPOSURE_MAX_EV-cameraModel.EXPOSURE_MIN_EV}+(${cameraModel.EXPOSURE_MIN_EV});};
  const meter=(paint,pyramid=true)=>{
   const data=new Float32Array(w*h*4);
   for(let y=0;y<h;y++)for(let x=0;x<w;x++){const v=paint(x+.5,y+.5);data.set([v,v,v,1],(y*w+x)*4);}
   gl.bindTexture(gl.TEXTURE_2D,scene);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA16F,w,h,0,gl.RGBA,gl.FLOAT,data);
   glare.build(scene,w,h,[0,0,0,0]);
   const m=new exposure.CameraExposure(gl);m.update(scene,true,false,0,[0,0,0],w/h,null,null,1.25,pyramid?glare.meter:null);
   const ev=read();m.dispose();return ev;
  };
  // As the camera does: one update meters the frame EV, the pyramid is then
  // built against it and a second meter takes its request at once.
  const framed=paint=>{
   const data=new Float32Array(w*h*4);
   for(let y=0;y<h;y++)for(let x=0;x<w;x++){const v=paint(x+.5,y+.5);data.set([v,v,v,1],(y*w+x)*4);}
   gl.bindTexture(gl.TEXTURE_2D,scene);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA16F,w,h,0,gl.RGBA,gl.FLOAT,data);
   const first=new exposure.CameraExposure(gl);glare.build(scene,w,h,[0,0,0,0]);
   first.update(scene,true,false,0,[0,0,0],w/h,null,null,1.25,glare.meter);
   glare.build(scene,w,h,[0,0,0,0],null,first.frameTexture);
   const m=new exposure.CameraExposure(gl);m.update(scene,true,false,0,[0,0,0],w/h,null,null,1.25,glare.meter);
   const ev=read();m.dispose();first.dispose();return ev;
  };
  const sky=1e-4;
  const stars=(x,y)=>[[200,160],[840,600],[666,300]].some(([sx,sy])=>Math.abs(x-sx)<1.5&&Math.abs(y-sy)<1.5)?50:sky;
  // A Moon of radius 20 px lit on its right half, radiance 0.08 like the scene's.
  const moon=(cx,cy)=>(x,y)=>Math.hypot(x-cx,y-cy)<20&&x>cx?.08:sky;
  const uniform=()=>.1;
  const out={
   stars:meter(stars),
   // Sub-block steps across the pyramid's subject blocks (12 px).
   moon:[[0,0],[3.4,1.7],[6.8,3.4],[10.2,5.1]].map(([dx,dy])=>meter(moon(600+dx,400+dy))),
   moonPoints:[[0,0],[6.8,3.4]].map(([dx,dy])=>meter(moon(600+dx,400+dy),false)),
   uniform:meter(uniform),uniformPoints:meter(uniform,false),
  };
  // A soft subject on a black sky whose peak lies in the METER_LIT band, an
  // aurora seen from orbit: radiance 0.05 and twice that.
  const glow=peak=>(x,y)=>sky+peak*Math.exp(-((x-600)**2+(y-400)**2)/(2*14*14));
  out.glow=[.05,.1].map(peak=>meter(glow(peak)));
  out.glowFramed=[.05,.1].map(peak=>framed(glow(peak)));
  out.starsFramed=framed(stars);
  out.uniformFramed=framed(uniform);
  // A partial subject on a black sky, written straight into a meter field:
  // one 37 x 25 cell holds a subject of radiance 0.5 covering a share of it.
  // Its EV at 25%, 50% and 75% of full coverage, then with 1% more area.
  const field=gl.createTexture(),fw=37,fh=25;
  gl.bindTexture(gl.TEXTURE_2D,field);
  for(const f of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,f,gl.NEAREST);
  const partial=share=>{
   const data=new Float32Array(fw*fh*4);
   for(let i=0;i<fw*fh;i++)data.set([sky,sky,sky,0],i*4);
   data.set([.5*share+sky,.5*share+sky,.5*share+sky,share],(12*fw+18)*4);
   gl.bindTexture(gl.TEXTURE_2D,field);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,fw,fh,0,gl.RGBA,gl.FLOAT,data);
   const m=new exposure.CameraExposure(gl);m.update(scene,true,false,0,[0,0,0],w/h,null,null,1.25,{texture:field,rect:[0,0,1,1],width:fw,height:fh,atlasWidth:fw,atlasHeight:fh});
   const ev=read();m.dispose();return ev;
  };
  out.partial=[.25,.5,.75].map(f=>{const share=f*.00025*fw*fh;return [partial(share),partial(share*1.01)];});
  gl.deleteTexture(field);
  const error=gl.getError();glare.dispose();gl.getExtension('WEBGL_lose_context').loseContext();
  return {...out,error};
 })()`);
 assert.equal(result.error,0);
 assert.ok(result.stars>cameraModel.EXPOSURE_MAX_EV-.2,`three bright stars must not darken the sky (${result.stars})`);
 assert.ok(Math.max(...result.moon)<2,`a half-lit Moon of 0.07% of the frame is a subject (${result.moon})`);
 assert.ok(Math.min(...result.moonPoints)>cameraModel.EXPOSURE_MAX_EV-.2,'point samples miss the same Moon');
 assert.ok(Math.max(...result.moon)-Math.min(...result.moon)<.25,`moving the Moon across blocks changes exposure by under 0.25 EV (${result.moon})`);
 assert.ok(Math.abs(result.uniform-result.uniformPoints)<.1,'a uniform frame meters as with point samples');
 // Subjects relative to the frame (docs/lab/subject-threshold-2026-10-20.md).
 assert.ok(result.starsFramed>cameraModel.EXPOSURE_MAX_EV-.2,`relative to a black frame, three bright stars still do not darken the sky (${result.starsFramed})`);
 assert.ok(Math.abs(result.uniformFramed-result.uniform)<.01,`a frame within the range keeps the day's thresholds (${result.uniformFramed}, ${result.uniform})`);
 assert.ok(result.glowFramed[0]-result.glowFramed[1]<1.1,`twice the light of a dim subject darkens exposure by about a stop, not by its coverage (${result.glowFramed}; day thresholds ${result.glow})`);
 for(const [ev,larger] of result.partial)assert.ok(ev<cameraModel.EXPOSURE_MAX_EV-.5&&Math.abs(larger-ev)<.035,`a partial subject pulls exposure, and 1% more of it moves exposure under 0.035 EV (${result.partial})`);
 return result;
}
