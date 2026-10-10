// GPU checks called by verify-scene-browser, in its isolated browser session.
import assert from 'node:assert/strict';
import {browserModule} from './browser-module.mjs';
import {issFrame} from '../src/scripts/iss-orbit.ts';

export async function verifyAurora(evaluate){
 const production=await browserModule('aurora');
 const precise=await browserModule('aurora',{transform:(source,id)=>id==='scripts/aurora.ts'?source.replace('(end-start)/128.','(end-start)/384.').replaceAll('i<128','i<384'):source});
 const frames=[issFrame(900,.138,{yaw:79,pitch:-10}),issFrame(1000),issFrame(3600),issFrame(900,.138,{yaw:79,pitch:-90}),issFrame(1000,.138,{yaw:-90,pitch:30})];
 const motionFrames=Array.from({length:12},(_,i)=>({time:900+i*10/24,...issFrame(900+i*10/24,.138,{yaw:79,pitch:-10})}));
 const result=await evaluate(`(async()=>{
  const exports=${production};
  const c=document.createElement('canvas'),gl=c.getContext('webgl');gl.disable(gl.DITHER);
  const layer=new exports.Aurora(gl),frames=${JSON.stringify(frames)};
  const read=()=>{
   const v=gl.getParameter(gl.VIEWPORT),type=gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_TYPE);
   if(type===gl.FLOAT||type===0x140b||type===0x8d61){
    const packed=type===gl.FLOAT?new Float32Array(v[2]*v[3]*4):new Uint16Array(v[2]*v[3]*4);
    gl.readPixels(0,0,v[2],v[3],gl.RGBA,type,packed);
    const raw=type===gl.FLOAT?packed:Float32Array.from(packed,h=>{const e=(h>>10)&31,f=h&1023;return (h&32768?-1:1)*(e===0?f*2**-24:e===31?(f?NaN:Infinity):(1+f/1024)*2**(e-15));});
    return {raw,bytes:Uint8Array.from(raw,x=>Math.round(Math.max(0,Math.min(1,x))*255))};
   }
   const bytes=new Uint8Array(v[2]*v[3]*4);gl.readPixels(0,0,v[2],v[3],gl.RGBA,gl.UNSIGNED_BYTE,bytes);return {raw:Float32Array.from(bytes,x=>x/255),bytes};
  };
  const pixels=(frame,time=900)=>{layer.render(960,640,frame.camera,frame.cameraBasis,frame.sun,time);return read().bytes;};
  const energy=p=>{let sum=0,peak=0;for(let i=0;i<p.length;i++)if(i%4!==3){sum+=p[i];peak=Math.max(peak,p[i]);}return {sum,peak};};
  const night=pixels(frames[0]),rawNight=read().raw,repeat=pixels(frames[0]),next=pixels(frames[0],900+10/24);
  const precision={halfFloat:layer.pixelType!==gl.UNSIGNED_BYTE,greenLevels:new Set(Array.from(rawNight).filter((v,i)=>i%4===1&&v>0&&v<1)).size};
  const compare=(a,b)=>{let peak=0,squared=0,count=0;for(let i=0;i<a.length;i++)if(i%4!==3){const d=Math.abs(a[i]-b[i]);peak=Math.max(peak,d);squared+=d*d;count++;}return {peak,rms:Math.sqrt(squared/count)};};
  // Read the generated footprint: real folds cross a longitude repeatedly,
  // with dark gaps between the sheets. The longitude boundary must wrap.
  gl.bindFramebuffer(gl.FRAMEBUFFER,layer.fieldTarget);
  gl.viewport(0,0,2048,1024);const atlas=read().bytes;
  let foldedColumns=0,maxCrossings=0,seamSum=0,diffusePixels=0,diffuseWithoutRays=0,rayPixels=0;
  for(let x=0;x<2048;x++)for(let pole=0;pole<2;pole++){
   let crossings=0,inside=false;
   for(let y=pole*512;y<(pole+1)*512;y++){
    const lit=atlas[(y*2048+x)*4]>2;if(lit&&!inside)crossings++;inside=lit;
   }
   if(crossings>=3)foldedColumns++;maxCrossings=Math.max(maxCrossings,crossings);
  }
  for(let y=0;y<1024;y++)seamSum+=Math.abs(atlas[y*2048*4]-atlas[(y*2048+2047)*4]);
  // Broad emission must survive away from every narrow ray; otherwise a
  // "body" tweak can leave only thickened outlines again in overhead views.
  for(let i=0;i<atlas.length;i+=4){
   if(atlas[i]>2)rayPixels++;
   if(atlas[i+3]>32){diffusePixels++;if(atlas[i]===0&&atlas[i+1]===0)diffuseWithoutRays++;}
  }
  const structure={foldedColumns,maxCrossings,seamMean:seamSum/1024,diffusePixels,diffuseWithoutRays,rayPixels};
  const evolved=pixels(frames[0],930);
  const dark=frames.slice(1).map(f=>energy(pixels(f))),returned=pixels(frames[0]);
  // Independent oversampling reference uses 3x as many ray integration steps.
  // The same footprint texture keeps this a test of integration, not two maps.
  const precise=${precise};
  const reference=new precise.Aurora(gl);reference.render(960,640,frames[0].camera,frames[0].cameraBasis,frames[0].sun,900);
  const hi=read().bytes;
  // Compare unquantized encoded radiance. Rounding both HDR captures to bytes
  // before subtracting can add a full LSB to the temporal error estimate.
  const motion=[];
  for(const [width,height] of [[1440,966],[390,844]]){
   let previous=null,squared=0,count=0,peak=0,bad=0,errorSquared=0;
   for(const frame of ${JSON.stringify(motionFrames)}){
    const render=l=>{l.render(width,height,frame.camera,frame.cameraBasis,frame.sun,frame.time);return Float32Array.from(read().raw,x=>x*255);};
    const low=render(layer),high=render(reference),errors=new Float32Array(low.length);
    for(let i=0;i<low.length;i++){
     if(i%4===3)continue;errors[i]=low[i]-high[i];
     if(previous&&Math.max(low[i],high[i])>5){const delta=Math.abs(errors[i]-previous[i]);peak=Math.max(peak,delta);squared+=delta*delta;errorSquared+=errors[i]*errors[i];count++;if(delta>2)bad++;}
    }
    previous=errors;
   }
   motion.push({width,height,peak,rms:Math.sqrt(squared/count),spatialRms:Math.sqrt(errorSquared/count),badFraction:bad/count,count});
  }
  reference.dispose();
  // Exercise actual RGBA8 fallback allocation, shader defines and mipmaps by
  // hiding the optional extension, not by substituting a different shader.
  const byteGl=new Proxy(gl,{get(target,key){
   if(key==='getExtension')return name=>name==='OES_texture_half_float'?null:target.getExtension(name);
   const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
  }});
  const byteLayer=new exports.Aurora(byteGl);
  byteLayer.render(960,640,frames[0].camera,frames[0].cameraBasis,frames[0].sun,900);
  const fallbackPixels=read().bytes;
  byteLayer.render(960,640,frames[0].camera,frames[0].cameraBasis,frames[0].sun,900);
  const fallback={error:gl.getError(),difference:compare(night,fallbackPixels),repeat:compare(fallbackPixels,read().bytes),energy:energy(fallbackPixels)};
  byteLayer.dispose();
  // Sample altitude profiles around the whole oval. Test emission color/extent
  // independently of viewing geometry, exposure, defocus and sensor noise.
  const axis=exports.magneticNorth;
  const source='#extension GL_EXT_shader_texture_lod : enable\\n#define AURORA_LOD 1\\nprecision highp float;uniform vec3 sunDirection;const vec3 cameraPosition=vec3(0.,0.,1.1);const float time=900.;'+exports.auroraShader+
   'void main(){vec3 a=vec3('+axis.join(',')+');vec3 e=normalize(cross(vec3(0.,0.,1.),a)),n=cross(a,e);float az=gl_FragCoord.x/256.*6.283185307;float row=floor(gl_FragCoord.y);float h=row<1.?80.:row<2.?115.:row<3.?170.:row<4.?300.:row<5.?430.:100.;vec3 light=vec3(0.);for(int j=0;j<64;j++){float co=row<5.?.20+(float(j)+.5)/64.*.53:1.570796327;vec3 p=(a*cos(co)+(e*cos(az)+n*sin(az))*sin(co))*(1.+h/6371.);light+=auroraDensity(p,.00001);}gl_FragColor=vec4(light*(12000./64.),1.);}';
  const compile=(type,s)=>{const q=gl.createShader(type);gl.shaderSource(q,s);gl.compileShader(q);if(!gl.getShaderParameter(q,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(q));return q;};
  const p=gl.createProgram(),vertex=compile(gl.VERTEX_SHADER,'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}'),fragment=compile(gl.FRAGMENT_SHADER,source);
  gl.attachShader(p,vertex);gl.attachShader(p,fragment);gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));
  c.width=256;c.height=6;gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,256,6);gl.useProgram(p);
  gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,layer.fieldTexture);
  const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);const a=gl.getAttribLocation(p,'p');gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,2,gl.FLOAT,false,0,0);
  const profiles=sign=>{gl.uniform3fv(gl.getUniformLocation(p,'sunDirection'),axis.map(x=>x*sign));gl.drawArrays(gl.TRIANGLES,0,3);const bytes=new Uint8Array(256*6*4);gl.readPixels(0,0,256,6,gl.RGBA,gl.UNSIGNED_BYTE,bytes);return Array.from({length:6},(_,y)=>[0,1,2].map(ch=>{let sum=0;for(let x=0;x<256;x++)sum+=bytes[(y*256+x)*4+ch];return sum;}));};
  const altitude=profiles(-1),day=profiles(1);
  const ext=gl.getExtension('EXT_disjoint_timer_query'),gpu=[];
  if(ext){for(const frame of frames.slice(0,2)){const queries=[];for(let i=0;i<18;i++){const q=ext.createQueryEXT();ext.beginQueryEXT(ext.TIME_ELAPSED_EXT,q);layer.render(1440,966,frame.camera,frame.cameraBasis,frame.sun,900+i*.4167);ext.endQueryEXT(ext.TIME_ELAPSED_EXT);gl.flush();queries.push(q);await new Promise(r=>setTimeout(r,45));}await new Promise(r=>setTimeout(r,100));const times=queries.slice(2).filter(q=>ext.getQueryObjectEXT(q,ext.QUERY_RESULT_AVAILABLE_EXT)).map(q=>ext.getQueryObjectEXT(q,ext.QUERY_RESULT_EXT)/1e6).sort((a,b)=>a-b);gpu.push({median:times[Math.floor(times.length*.5)],p90:times[Math.floor(times.length*.9)],disjoint:gl.getParameter(ext.GPU_DISJOINT_EXT)});queries.forEach(q=>ext.deleteQueryEXT(q));}}
  const error=gl.getError();layer.dispose();gl.deleteProgram(p);gl.deleteShader(vertex);gl.deleteShader(fragment);gl.deleteBuffer(b);gl.getExtension('WEBGL_lose_context').loseContext();
  return {precision,fallback,structure,motion,night:energy(night),dark,repeat:compare(night,repeat),returned:compare(night,returned),temporal:compare(night,next),evolution:compare(night,evolved),reference:compare(night,hi),altitude,day,gpu,error};
 })()`);
 assert.equal(result.error,0);
 assert.equal(result.fallback.error,0,'RGBA8 fallback compiles and renders');
 assert.equal(result.fallback.repeat.peak,0,'fallback dither is deterministic on pause');
 assert.ok(result.fallback.difference.rms<1.5,'dithered fallback remains close to HDR radiance');
 assert.ok(Math.abs(result.fallback.energy.sum/result.night.sum-1)<.06,'fallback retains faint emission energy');
 if(result.precision.halfFloat)assert.ok(result.precision.greenLevels>1024,'HDR aurora keeps more than 8-bit gradient precision before exposure');
 assert.ok(result.structure.foldedColumns>10&&result.structure.maxCrossings>=3,'folded sheets turn back across longitude');
 assert.ok(result.structure.seamMean<1,'periodic footprint has no longitude seam');
 assert.ok(result.structure.diffusePixels>result.structure.rayPixels*5,'diffuse field covers a broad area, not a widened outline');
 assert.ok(result.structure.diffuseWithoutRays>result.structure.diffusePixels*.5,'diffuse light persists between discrete curtains');
 assert.ok(result.night.sum>100000);assert.ok(result.night.peak<250,'emission target retains highlight headroom');
 assert.ok(result.dark.slice(1).every(p=>p.sum===0),'sunlit, ground-facing and away-facing views emit no aurora');
 assert.equal(result.repeat.peak,0,'paused emission is deterministic');
 assert.equal(result.returned.peak,0,'returning from a culled view restores emission');
 assert.ok(result.temporal.peak<=3&&result.temporal.rms<.2,'small time steps must not flicker');
 assert.ok(result.evolution.rms>result.temporal.rms*5,'brightness and folds evolve over simulated time');
 assert.ok(result.reference.rms<2,'production integral agrees with oversampled reference');
 for(const run of result.motion){
  assert.ok(run.count>10000,'motion regression samples the lit curtain');
  assert.ok(run.peak<=2&&run.rms<.45&&run.badFraction===0,'moving orbital camera must not beat against the ray integration grid: '+JSON.stringify(run));
 }
 for(const row of [0,4,5])assert.deepEqual(result.altitude[row],[0,0,0],'no emission below/above layer or at equator');
 assert.ok(result.altitude[1][1]>result.altitude[1][0]*3,'lower curtain is predominantly green');
 assert.ok(result.altitude[3][0]>result.altitude[3][1]*2,'upper curtain is predominantly red');
 assert.ok(result.day.every(row=>row.every(v=>v===0)),'fully sunlit oval is suppressed');
 return result;
}
