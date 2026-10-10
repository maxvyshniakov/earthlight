// Real Safari WebDriver / Android Chrome CDP comparison, without emulation.
// Start safaridriver on 4348, or forward Android chrome_devtools_remote to 9223.
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {sceneDevice} from './scene-device-driver.mjs';

const [browser='safari',base='http://127.0.0.1:4347',out='/tmp/orbit-device',views='day,night,clouds']=process.argv.slice(2);
assert.ok(['safari','safari-mcp','android'].includes(browser));
await mkdir(out,{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const {evaluate,navigate,close,capabilities}=await sceneDevice(browser,base);

const results={browser,capabilities,method:'ABBA sequential profiles, 32 frames after 8 warmups; native viewport; fixed resolution; completion time includes synchronous one-pixel readback and CPU submission',cases:[]};
const scenes=[{name:'day',t:3235.65,pitch:0},{name:'night',t:610.87,pitch:0},{name:'clouds',t:3235.65,pitch:-25}].filter(s=>views.split(',').includes(s.name));
try{
 for(const scene of scenes){
  let referencePixels;
  for(const [index,profile] of ['reference','compact','compact','reference'].entries()){
   const url=`${base}/?render=${profile}&motion=0&quality=fixed&t=${scene.t}&pitch=${scene.pitch}&epoch=2026-10-06T01:32:27Z&look-grain=0`;
   await navigate(url);
   const deadline=Date.now()+120000;let ready=false;
   while(Date.now()<deadline){
    try{ready=await evaluate(`(()=>{const s=document.querySelector('orbital-sky');return location.href===${JSON.stringify(url)}&&s?.dataset.renderProfile===${JSON.stringify(profile)}&&s.dataset.assetPhase==='settled'&&s.dataset.focus==='sharp'&&s.dataset.exposure==='settled'&&['dayTiles','nightTiles','cloudTiles'].every(k=>!s.dataset[k]||JSON.parse(s.dataset[k]).pending===0)})()`);}catch{}
    if(ready)break;await sleep(250);
   }
   if(!ready)console.log(await evaluate(`(()=>{const s=document.querySelector('orbital-sky');return {visibility:document.visibilityState,state:s?{...s.dataset}:null}})()`));
   assert.ok(ready,`Scene did not settle: ${scene.name}/${profile}`);
   console.log(`Settled ${scene.name}/${profile}`);
   const result=await evaluate(`(async()=>{
    const s=document.querySelector('orbital-sky'),c=s.querySelector('canvas'),gl=c.getContext('webgl');
    const timer=gl.getExtension('EXT_disjoint_timer_query'),debug=gl.getExtension('WEBGL_debug_renderer_info');
    const state={profile:s.dataset.renderProfile,volume:s.dataset.volumePass,failures:s.dataset.assetFailures,scale:s.dataset.renderScale,position:s.dataset.cameraPosition,basis:s.dataset.cameraBasis,width:c.width,height:c.height,cssWidth:innerWidth,cssHeight:innerHeight,dpr:devicePixelRatio,userAgent:navigator.userAgent,renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),gpuTimer:!!timer,halfFloat:!!gl.getExtension('OES_texture_half_float'),halfFloatTarget:!!gl.getExtension('EXT_color_buffer_half_float'),textureUnits:gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS)};
    const wait=ms=>new Promise(r=>setTimeout(r,ms));
    const bind=gl.bindFramebuffer,draw=gl.drawArrays;let target=gl.getParameter(gl.FRAMEBUFFER_BINDING),onFrame=null;
    gl.bindFramebuffer=function(k,v){target=v;return bind.call(this,k,v);};
    const samples=[],pixel=new Uint8Array(4);let query=null,start=null,capture=false,png;
    gl.drawArrays=function(...args){
     if(onFrame&&start===null){gl.finish();start=performance.now();if(timer){query=timer.createQueryEXT();timer.beginQueryEXT(timer.TIME_ELAPSED_EXT,query);}}
     draw.apply(this,args);
     if(onFrame&&target===null){if(timer)timer.endQueryEXT(timer.TIME_ELAPSED_EXT);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);const wall=performance.now()-start;if(capture)png=c.toDataURL('image/png');const f=onFrame;onFrame=null;f(wall);}
    };
    try{
     for(let i=0;i<40;i++){
      start=null;capture=i===39;
      const wall=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Frame timeout')),10000);onFrame=value=>{clearTimeout(timeout);resolve(value);};s.querySelector('[data-look=grain]').dispatchEvent(new Event('input'));});
      let gpu=null;if(timer){const until=performance.now()+10000;while(!timer.getQueryObjectEXT(query,timer.QUERY_RESULT_AVAILABLE_EXT)&&performance.now()<until)await wait(4);if(!timer.getQueryObjectEXT(query,timer.QUERY_RESULT_AVAILABLE_EXT))throw Error('GPU query timeout');if(!gl.getParameter(timer.GPU_DISJOINT_EXT))gpu=Number(timer.getQueryObjectEXT(query,timer.QUERY_RESULT_EXT))/1e6;timer.deleteQueryEXT(query);query=null;}
      if(i>=8)samples.push({completionMs:wall,gpuMs:gpu});
      if(gl.getError())throw Error('WebGL error');await wait(8);
     }
    }finally{gl.bindFramebuffer=bind;gl.drawArrays=draw;}
    // One renderer, natural cadence: no GPU queries or gl.finish in this test.
    let frames=0;target=gl.getParameter(gl.FRAMEBUFFER_BINDING);
    gl.bindFramebuffer=function(k,v){target=v;return bind.call(this,k,v);};
    gl.drawArrays=function(...args){draw.apply(this,args);if(target===null)frames++;};
    let fps,idleFrames;
    try{const button=s.querySelector('.sky-motion');button.click();const beginning=performance.now();await wait(10000);fps=frames*1000/(performance.now()-beginning);button.click();await wait(8500);frames=0;await wait(1200);idleFrames=frames;}finally{gl.bindFramebuffer=bind;gl.drawArrays=draw;}
    const median=a=>a.sort((a,b)=>a-b)[Math.floor(a.length/2)];
    return {state,samples,completionMs:median(samples.map(x=>x.completionMs)),gpuMs:timer?median(samples.filter(x=>x.gpuMs!==null).map(x=>x.gpuMs)):null,fps,idleFrames,error:gl.getError(),png};
   })()`);
   assert.equal(result.error,0);assert.equal(result.state.failures,'0');assert.equal(result.state.scale,'1.00');assert.equal(result.idleFrames,0);
   const png=Buffer.from(result.png.split(',')[1],'base64');delete result.png;
   await writeFile(`${out}/${scene.name}-${index}-${profile}.png`,png);
   const pixels=await sharp(png).removeAlpha().raw().toBuffer();assert.ok(pixels.some(x=>x>30));
   if(index===0)referencePixels=pixels;
   assert.equal(pixels.length,referencePixels.length);
   let sum=0,max=0,overTwo=0;for(let i=0;i<pixels.length;i++){const d=Math.abs(pixels[i]-referencePixels[i]);sum+=d;max=Math.max(max,d);if(d>2)overTwo++;}
   result.imageDifference={mean:sum/pixels.length,max,overTwo:overTwo/pixels.length};
   results.cases.push({scene:scene.name,index,profile,...result});
   await writeFile(`${out}/results.json`,JSON.stringify(results,null,2)+'\n');
   console.log(JSON.stringify({scene:scene.name,index,profile,state:result.state,completionMs:result.completionMs,gpuMs:result.gpuMs,fps:result.fps,imageDifference:result.imageDifference}));
  }
 }
}finally{await close();}
