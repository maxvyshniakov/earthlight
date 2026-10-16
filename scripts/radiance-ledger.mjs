// Measures scene radiance per light source in fixed views and compares it
// with photometry (src/scripts/radiometry.ts). Uses an isolated agent-browser
// session and reads the scene buffer the exposure meter samples, so nothing
// in the renderer changes. Prints a table and writes ledger.json.
// bun scripts/radiance-ledger.mjs http://localhost:4382 /tmp/ledger
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {RADIANCE_LEDGER,SCENE_CANDELA,expectedSceneRadiance} from '../src/scripts/radiometry.ts';
import {pointImageFlux} from '../src/scripts/point-photometry.ts';
import {SOLAR_IRRADIANCE,SOLAR_RADIANCE} from '../src/scripts/solar-light.ts';

const exec=promisify(execFile);
const [base='http://127.0.0.1:4322',out=join(tmpdir(),'radiance-ledger')]=process.argv.slice(2);
await mkdir(out,{recursive:true});
const session=`ledger-${process.pid}`;
const ab=async(...args)=>(await exec('agent-browser',['--session',session,...args],{maxBuffer:3e7,timeout:180000})).stdout;

// Remember the texture bound to unit 0 while the meter draws into its 1 x 1
// state target: that is the scene buffer in scene radiance.
const hook=`(()=>{
 const sizes=new Map(),types=new Map(),small=new Set();let scene=null,owner=null;
 for(const proto of [WebGLRenderingContext.prototype,window.WebGL2RenderingContext?.prototype].filter(Boolean)){
  const tex=proto.texImage2D,attach=proto.framebufferTexture2D,draw=proto.drawArrays;
  proto.texImage2D=function(...a){const t=this.getParameter(this.TEXTURE_BINDING_2D);if(a.length>=9&&t){sizes.set(t,[a[3],a[4]]);types.set(t,a[7]);}return tex.apply(this,a);};
  proto.framebufferTexture2D=function(target,att,tt,texture,level){const fb=this.getParameter(this.FRAMEBUFFER_BINDING),s=sizes.get(texture);if(fb&&s&&s[0]===1&&s[1]===1)small.add(fb);return attach.call(this,target,att,tt,texture,level);};
  proto.drawArrays=function(...a){
   const fb=this.getParameter(this.FRAMEBUFFER_BINDING);
   if(fb&&small.has(fb)){const unit=this.getParameter(this.ACTIVE_TEXTURE);this.activeTexture(this.TEXTURE0);const t=this.getParameter(this.TEXTURE_BINDING_2D);this.activeTexture(unit);if(t&&sizes.get(t)?.[0]>32){scene=t;owner=this;}}
   return draw.apply(this,a);
  };
 }
 window.__ledger=filters=>{
  const gl=owner;if(!gl||!scene)return null;
  const [w,h]=sizes.get(scene);if(types.get(scene)===gl.UNSIGNED_BYTE)return {error:'RGBE scene buffer'};
  const previous=gl.getParameter(gl.FRAMEBUFFER_BINDING),fb=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,scene,0);
  const px=new Float32Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.FLOAT,px);
  gl.bindFramebuffer(gl.FRAMEBUFFER,previous);gl.deleteFramebuffer(fb);
  const tests={all:()=>true,lit:(r,g,b,m)=>m>.02,dark:(r,g,b,m)=>m<.02,green:(r,g,b,m)=>g>1.6*r&&g>1.6*b&&m>1e-7};
  const result={};
  for(const name of filters){
   const values=[],test=tests[name];
   for(let i=0;i<w*h*4;i+=4){const r=px[i],g=px[i+1],b=px[i+2],m=Math.max(r,g,b);if(test(r,g,b,m))values.push(.2126*r+.7152*g+.0722*b);}
   values.sort((a,b)=>a-b);
   const q=f=>values.length?values[Math.floor(f*(values.length-1))]:0;
   result[name]={share:values.length/(w*h),p50:q(.5),p90:q(.9),p99:q(.99)};
  }
  return result;
 };
})();`;
const hookPath=join(out,'ledger-hook.js');
await writeFile(hookPath,hook);

const E='t=4752.76&epoch=2026-10-16T07%3A57%3A47.730Z&motion=0&flight=free';
const D='t=4752.76&epoch=2026-12-31T08%3A44%3A47.237Z&motion=0&flight=free';
// Each view isolates one source; the class picks its pixels and the quantile
// stands for the source's typical (p50) or bright (p90/p99) radiance.
const views=[
 {id:'earthDay',url:`${E}&position=0.9055%2C0.6860%2C-0.1790&heading=0.6039%2C-0.7971%2C0&elevation=-1.45`,filter:'all',quantiles:['p50','p99']},
 {id:'moon',url:`t=4467.23&epoch=2026-10-16T07%3A57%3A47.730Z&motion=0&lens=20&flight=free&position=1.10881872%2C-0.60483293%2C1.52370774&orientation=0.4338328567%2C0.2681440705%2C-0.2334190738%2C0.8278909021`,filter:'lit',quantiles:['p50','p90']},
 {id:'cityNight',url:`${E}&position=-0.412%2C-0.776%2C0.593&heading=0.883%2C-0.469%2C0&elevation=-1.45`,filter:'all',quantiles:['p90','p99']},
 {id:'aurora',url:`${D}&position=-1.09581066%2C-3.11456437%2C4.67295321&orientation=0.0021512078%2C-0.3047774493%2C0.8476354792%2C0.4343042402`,filter:'green',quantiles:['p50','p99']},
 {id:'airglowLimb',url:`${E}&position=-0.834%2C-0.632%2C0.165&heading=0.6039%2C-0.7971%2C0&elevation=-0.33`,filter:'all',quantiles:['p99']},
 {id:'milkyWay',url:`t=4467.23&epoch=2026-10-16T07%3A57%3A47.730Z&motion=0&lens=5&flight=free&position=1.10881872%2C-0.60483293%2C1.52370774&orientation=0.4338328567%2C0.2681440705%2C-0.2334190738%2C0.8278909021`,filter:'dark',quantiles:['p50','p90']},
 {id:'emptySky',url:`${E}&position=-0.9055%2C-0.6860%2C0.1789&heading=0.6039%2C-0.7971%2C0&elevation=1.45`,filter:'dark',quantiles:['p50']},
];
const settled="document.querySelector('orbital-sky')?.dataset.assets==='settled'&&document.querySelector('orbital-sky')?.dataset.focus==='sharp'";
await exec('agent-browser',['--session',session,'--init-script',hookPath,'set','viewport','1200','800'],{timeout:60000});
const measured={};
try{
 for(const view of views){
  await ab('open',`${base}/?${view.url}`);await ab('wait','--fn',settled);await ab('wait','3000');
  const stats=JSON.parse(JSON.parse(await ab('eval',`JSON.stringify(window.__ledger(['${view.filter}']))`)));
  if(!stats||stats.error)throw Error(`${view.id}: ${stats?.error??'scene buffer not found'}`);
  await ab('screenshot',join(out,`${view.id}.png`));
  measured[view.id]=Object.fromEntries(view.quantiles.map(q=>[q,stats[view.filter][q]]));
  measured[view.id].share=stats[view.filter].share;
 }
}finally{await ab('close');}

// Point sources and the Sun have exact scene values; compare them as flux
// ratios to the Sun instead of radiance.
const sunFlux=SOLAR_IRRADIANCE*1.25*1.25;
measured.stars={ratioToSun:pointImageFlux(0,800)/sunFlux};
measured.sunDisk={radiance:SOLAR_RADIANCE};

const rows=RADIANCE_LEDGER.map(entry=>{
 const value=entry.measure(measured);
 const [lo,hi]=expectedSceneRadiance(entry);
 const factor=value/Math.sqrt(lo*hi);
 return {id:entry.id,label:entry.label,scene:value,physical:[lo,hi],factor,within:value>=lo&&value<=hi};
});
await writeFile(join(out,'ledger.json'),JSON.stringify({sceneCandela:SCENE_CANDELA,measured,rows},null,1));
for(const r of rows)console.log(`${r.label.padEnd(34)} scene ${r.scene.toExponential(2).padStart(9)}  physical ${r.physical.map(v=>v.toExponential(1)).join('–').padStart(17)}  ×${r.factor.toExponential(1)}${r.within?'  ok':''}`);
