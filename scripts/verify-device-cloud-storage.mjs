// Compare identical Pixel frames while changing only metadata RG16F -> RGBA16F.
// Unlock the phone and leave Chrome foregrounded; waking does not unlock it.
import {sceneDevice} from './scene-device-driver.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import sharp from 'sharp';
const [base='http://127.0.0.1:4350',out='/tmp/earthlight-device-cloud-storage']=process.argv.slice(2);
const adb=(...a)=>execFileSync('adb',[...a],{encoding:'utf8',timeout:15000}).trim();
const awake=adb('shell','settings','get','global','stay_on_while_plugged_in');
await mkdir(out,{recursive:true});
const results=[];let device;
try{
 adb('shell','settings','put','global','stay_on_while_plugged_in','3');adb('shell','input','keyevent','224');
 device=await sceneDevice('android',base);const {evaluate,navigate}=device;
 const wait=async()=>{
  const end=Date.now()+120000;
  while(Date.now()<end){if(await evaluate(`(()=>{const s=document.querySelector('earthlight-explorer');return s?.hasAttribute('data-ready')&&s.dataset.exposure==='settled'&&s.dataset.assetPhase==='settled'&&s.dataset.focus==='sharp'&&['dayTiles','nightTiles','cloudTiles','terrainTiles','galaxyTiles'].every(k=>!s.dataset[k]||JSON.parse(s.dataset[k]).pending===0)})()`))return;await new Promise(r=>setTimeout(r,500));}
  throw Error('Scene did not settle');
 };
 const capture=()=>evaluate(`(async()=>{
  const s=document.querySelector('earthlight-explorer'),c=s.querySelector('canvas'),g=c.getContext('webgl2'),draw=g.drawArrays,bind=g.bindFramebuffer;
  let target=g.getParameter(g.FRAMEBUFFER_BINDING),onFrame=null;
  g.bindFramebuffer=function(k,v){if(k===g.FRAMEBUFFER||k===g.DRAW_FRAMEBUFFER)target=v;return bind.call(this,k,v);};
  g.drawArrays=function(...a){draw.apply(this,a);if(target===null&&onFrame){const f=onFrame;onFrame=null;f(c.toDataURL('image/png'));}};
  try{const png=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('No captured frame')),10000);onFrame=p=>{clearTimeout(timer);resolve(p);};s.querySelector('.explorer-track input').dispatchEvent(new Event('input'));});return {png,width:c.width,height:c.height,data:{...s.dataset},error:g.getError()};}
  finally{g.drawArrays=draw;g.bindFramebuffer=bind;}
 })()`);
 for(const scene of [{name:'clouds',t:3235.65,pitch:-25,exposure:0},{name:'horizon',t:3235.65,pitch:5,exposure:0},{name:'night',t:610.87,pitch:-25,exposure:4.1}].filter(s=>!process.env.DEVICE_CLOUD_CASES||process.env.DEVICE_CLOUD_CASES.split(',').includes(s.name))){
  console.log('START',scene.name);
  const u=new URL('/',base);for(const[k,v]of Object.entries({render:'clouds-half',quality:'fixed',motion:0,t:scene.t,pitch:scene.pitch,epoch:'2026-10-06T01:32:27Z','look-grain':0,'exposure-mode':'manual','exposure-fixed':scene.exposure}))u.searchParams.set(k,String(v));
  await navigate(u.href);await new Promise(r=>setTimeout(r,500));await wait();
  // Android's toolbar can change viewport height during context restoration.
  // Keep both captures at the same CSS size and therefore the same render buffer.
  const viewport=await evaluate(`(()=>{const c=document.querySelector('earthlight-explorer canvas'),v=document.querySelector('.explorer-viewport'),b=c.getBoundingClientRect();c.style.width=b.width+'px';c.style.height=b.height+'px';if(v)v.style.height=v.clientHeight+'px';window.dispatchEvent(new Event('resize'));return {width:b.width,height:b.height};})()`);
  await new Promise(r=>setTimeout(r,500));await wait();
  await evaluate(`(()=>{document.querySelector('.explorer-track input').dispatchEvent(new Event('input'));return true;})()`);await wait();
  const rg=await capture();
  await evaluate(`(async()=>{const c=document.querySelector('earthlight-explorer canvas'),g=c.getContext('webgl2'),upload=g.texImage2D,e=g.getExtension('WEBGL_lose_context');window.__metadataUpload=upload;window.__metadataReplacements=0;g.texImage2D=function(...a){if(a.length===9&&a[2]===g.RG16F&&a[6]===g.RG){a[2]=g.RGBA16F;a[6]=g.RGBA;window.__metadataReplacements++;}return upload.apply(this,a);};const lost=new Promise(r=>c.addEventListener('webglcontextlost',r,{once:true}));e.loseContext();await lost;g.getError();const restored=new Promise(r=>c.addEventListener('webglcontextrestored',r,{once:true}));setTimeout(()=>e.restoreContext(),300);await restored;return true;})()`);
  await wait();const rgba=await capture();const replacements=await evaluate('window.__metadataReplacements');assert.ok(replacements>=2);
  for(const frame of [rg,rgba]){assert.equal(frame.error,0);assert.equal(frame.data.renderApi,'webgl2');assert.equal(frame.data.cloudPass,'half');assert.equal(frame.data.assetFailures,'0');}
  assert.equal(rg.width,rgba.width);assert.equal(rg.height,rgba.height);assert.equal(rg.data.cameraPosition,rgba.data.cameraPosition);assert.equal(rg.data.cameraBasis,rgba.data.cameraBasis);
  const pixels=[];
  for(const [name,frame]of [['rg',rg],['rgba',rgba]]){const png=Buffer.from(frame.png.split(',')[1],'base64');await writeFile(`${out}/${scene.name}-${name}.png`,png);pixels.push(await sharp(png).removeAlpha().raw().toBuffer());delete frame.png;}
  let different=0,max=0;for(let i=0;i<pixels[0].length;i++){const delta=Math.abs(pixels[0][i]-pixels[1][i]);if(delta)different++;max=Math.max(max,delta);}
  const result={scene,viewport,rg,rgba,replacements,differentChannelSamples:different,maxChannelDifference:max};results.push(result);await writeFile(out+'/results.json',JSON.stringify(results,null,2)+'\n');console.log('RESULT',scene.name,{different,max});
  // Return to RG16F to separate storage differences from context-reset drift.
  await evaluate(`(async()=>{const c=document.querySelector('earthlight-explorer canvas'),g=c.getContext('webgl2'),e=g.getExtension('WEBGL_lose_context');g.texImage2D=window.__metadataUpload;const lost=new Promise(r=>c.addEventListener('webglcontextlost',r,{once:true}));e.loseContext();await lost;g.getError();const restored=new Promise(r=>c.addEventListener('webglcontextrestored',r,{once:true}));setTimeout(()=>e.restoreContext(),300);await restored;return true;})()`);
  await wait();const control=await capture();assert.equal(control.width,rg.width);assert.equal(control.height,rg.height);assert.equal(control.error,0);assert.equal(control.data.cameraPosition,rg.data.cameraPosition);assert.equal(control.data.cameraBasis,rg.data.cameraBasis);
  const png=Buffer.from(control.png.split(',')[1],'base64');await writeFile(`${out}/${scene.name}-rg-control.png`,png);delete control.png;
  const controlPixels=await sharp(png).removeAlpha().raw().toBuffer();let controlDifferent=0,controlMax=0;
  for(let i=0;i<pixels[0].length;i++){const delta=Math.abs(pixels[0][i]-controlPixels[i]);if(delta)controlDifferent++;controlMax=Math.max(controlMax,delta);}
  Object.assign(result,{channelSamples:pixels[0].length,control,controlDifferentChannelSamples:controlDifferent,controlMaxChannelDifference:controlMax});
  await writeFile(out+'/results.json',JSON.stringify(results,null,2)+'\n');console.log('CONTROL',scene.name,{controlDifferent,controlMax});
 }
 // Use the same one-output-code tolerance as the existing WebGL1/WebGL2 audit.
 for(const result of results){
  assert.ok(result.maxChannelDifference<=1,`${result.scene.name}: storage difference exceeds one output code`);
  assert.ok('controlMaxChannelDifference' in result&&Number(result.controlMaxChannelDifference)<=1,`${result.scene.name}: context reset drift exceeds one output code`);
 }
}finally{try{if(device)await device.close();}finally{adb('shell','settings','put','global','stay_on_while_plugged_in',awake);}}
