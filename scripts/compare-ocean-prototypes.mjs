// Matched scene captures. Cloud removal is a diagnostic browser-only ablation.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile} from 'node:fs/promises';
const exec=promisify(execFile);
const [base='http://127.0.0.1:4395',out='/tmp/ocean-prototypes',selected='wide,oblique']=process.argv.slice(2);
const session=`ocean-compare-${process.pid}`;
const run=async(...args)=>(await exec('agent-browser',['--session',session,...args],{maxBuffer:8e6,timeout:90000})).stdout;
const evaluate=async code=>JSON.parse(await run('eval','--base64',Buffer.from(code).toString('base64')));
export function oceanSceneURL(base,scene,mode){
 const angle=scene.startsWith('angle-')?Number(scene.slice(6)):null;
 const aegean=scene==='aegean';
 const r=Math.PI/180,lat=(aegean?37.2:-10)*r,lon=(aegean?24:150+(angle??0))*r,alt=scene==='wide'?1531:angle!==null?600:420,h=(aegean?180:scene==='wide'?0:270)*r;
 const n=[Math.cos(lat)*Math.cos(lon),Math.cos(lat)*Math.sin(lon),Math.sin(lat)];
 const north=[-Math.sin(lat)*Math.cos(lon),-Math.sin(lat)*Math.sin(lon),Math.cos(lat)],east=[-Math.sin(lon),Math.cos(lon),0];
 let position=n.map(v=>v*(1+alt/6371)),heading=north.map((v,i)=>v*Math.cos(h)+east[i]*Math.sin(h)),elevation=(aegean?-72:scene==='wide'?-90:-50)*r,roll=0;
 if(angle!==null){
  const target=[Math.cos(lat)*Math.cos(150*r),Math.cos(lat)*Math.sin(150*r),Math.sin(lat)],look=target.map((v,i)=>v-position[i]),length=Math.hypot(...look),radial=look.reduce((v,x,i)=>v+x*n[i],0);
  elevation=Math.asin(radial/length);heading=look.map((v,i)=>v-n[i]*radial);const lengthH=Math.hypot(...heading);heading=lengthH>1e-8?heading.map(v=>v/lengthH):north;
  roll=Math.atan2(heading.reduce((v,x,i)=>v+x*east[i],0),heading.reduce((v,x,i)=>v+x*north[i],0));
 }
 const url=new URL('/',base);
 for(const [k,v] of Object.entries({api:'webgl',render:'compact',ocean:mode,motion:0,quality:'fixed',t:0,epoch:aegean?'2026-06-25T10:25:00Z':(scene==='wide'||angle!==null)?'2026-10-06T01:32:27Z':'2026-10-06T04:30:00Z',flight:'free',position:position.join(','),heading:heading.join(','),elevation,roll,'exposure-mode':'manual','exposure-fixed':.5,'look-grain':0,galaxyDetail:0}))url.searchParams.set(k,String(v));
 return url.href;
}
const settled=`(()=>{const s=document.querySelector('earthlight-explorer');return s&&s.dataset.shaderStartup==='ready'&&s.dataset.focus==='sharp'&&s.dataset.assetPhase==='settled'&&Number(s.dataset.cloudLightingProgress??0)===0&&(Number(s.dataset.cameraAltitude)>1529||s.dataset.cloudLighting!=='texture'||s.dataset.cloudLightingReady==='1')&&['dayTiles','nightTiles','cloudTiles','terrainTiles'].every(k=>!s.dataset[k]||JSON.parse(s.dataset[k]).pending===0)})()`;
const wait=async()=>{for(let i=0;i<5;i++){try{await run('wait','--fn',settled);return;}catch(e){if(i===4)throw e;}}};
await mkdir(out,{recursive:true});const results=[];
try{
 await run('set','viewport','1200','800');
 for(const scene of selected.split(','))for(const mode of (process.env.OCEAN_VARIANTS??'original,regions,fronts,combined').split(',')){
  const actualMode=mode.replace('-1024','');
  const address=new URL(oceanSceneURL(base,scene,actualMode));if(mode.endsWith('-1024'))address.searchParams.set('oceanResolution','1024');
  const url=address.href;await run('open',url);await wait();
  await evaluate(`(()=>{const style=document.createElement('style');style.textContent='earthlight-explorer > :not(canvas),astro-dev-toolbar{visibility:hidden!important}';document.head.append(style);return true})()`);
  await run('screenshot',`${out}/${scene}-${mode}-clouds.png`);
  await evaluate(`(()=>{const p=WebGLRenderingContext.prototype,mip=p.generateMipmap;p.generateMipmap=function(target){if(this.getParameter(this.ACTIVE_TEXTURE)===this.TEXTURE14)window.__oceanBake={gl:this,texture:this.getParameter(this.TEXTURE_BINDING_2D)};return mip.call(this,target)};const original=p.shaderSource;p.shaderSource=function(shader,text){return original.call(this,shader,'#define CLOUDS_DISABLED 1\\n'+text);};const s=document.querySelector('earthlight-explorer'),copy=s.cloneNode(true);for(const k of Object.keys(copy.dataset))if(!['assetBase','terrainBase','exploreUrl','composition'].includes(k)&&!k.startsWith('astro'))delete copy.dataset[k];s.replaceWith(copy);return true})()`);
  await wait();await run('screenshot',`${out}/${scene}-${mode}-clear.png`);
  if(process.env.OCEAN_FIELD_CAPTURE&&actualMode!=='original'){
   const data=await evaluate(`(()=>{const {gl:g,texture}=window.__oceanBake,w=Number(document.querySelector('earthlight-explorer').dataset.oceanWidth),h=w/2,f=g.createFramebuffer(),old=g.getParameter(g.FRAMEBUFFER_BINDING),pixels=new Uint8Array(w*h*4);g.bindFramebuffer(g.FRAMEBUFFER,f);g.framebufferTexture2D(g.FRAMEBUFFER,g.COLOR_ATTACHMENT0,g.TEXTURE_2D,texture,0);g.readPixels(0,0,w,h,g.RGBA,g.UNSIGNED_BYTE,pixels);g.bindFramebuffer(g.FRAMEBUFFER,old);g.deleteFramebuffer(f);const c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d'),im=ctx.createImageData(w,h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const src=((h-1-y)*w+x)*4,dst=(y*w+x)*4,v=Math.max(0,Math.min(255,(pixels[src]*16/255-1)/7*255));im.data[dst]=im.data[dst+1]=im.data[dst+2]=v;im.data[dst+3]=255;}ctx.putImageData(im,0,0);return c.toDataURL()})()`);
   await writeFile(`${out}/${scene}-${mode}-field.png`,Buffer.from(data.split(',')[1],'base64'));
  }
  const state=await evaluate(`(()=>{const s=document.querySelector('earthlight-explorer'),c=s.querySelector('canvas'),g=c.getContext('webgl');return {data:{...s.dataset},width:c.width,height:c.height,error:g.getError()}})()`);
  if(state.error||state.data.assetFailures!=='0'||state.data.ocean!==actualMode)throw Error(JSON.stringify(state));
  results.push({scene,mode,url,...state});await writeFile(`${out}/captures.json`,JSON.stringify(results,null,2));
  console.log(`${scene}/${mode}`);
 }
}finally{await run('close');}
