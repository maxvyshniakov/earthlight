// Browser policy/UI checks; touch emulation is not physical phone performance evidence.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const exec=promisify(execFile);
const [base='http://127.0.0.1:4352',out='/tmp/earthlight-effects-policy',section='all']=process.argv.slice(2);
await mkdir(out,{recursive:true});
const init=`(()=>{
 const probe=window.__effectProbe={footprintPrograms:0,volumePrograms:0,footprintDraws:0,volumeDraws:0,blockedContexts:0,blockedLod:0};
 const unsupported=new URL(location.href).searchParams.has('probeUnsupported');
 const get=HTMLCanvasElement.prototype.getContext;
 HTMLCanvasElement.prototype.getContext=function(kind,...args){if(unsupported&&kind==='webgl2'){probe.blockedContexts++;return null;}return get.call(this,kind,...args);};
 for(const proto of [WebGLRenderingContext.prototype,WebGL2RenderingContext.prototype]){
  const shaders=new WeakMap(),programs=new WeakMap(),source=proto.shaderSource,link=proto.linkProgram,draw=proto.drawArrays,extension=proto.getExtension;
  proto.getExtension=function(name){if(unsupported&&name==='EXT_shader_texture_lod'){probe.blockedLod++;return null;}return extension.call(this,name);};
  proto.shaderSource=function(shader,text){if(text.includes('float arcLatitude('))shaders.set(shader,'footprint');else if(text.includes('uniform sampler2D auroraFootprint'))shaders.set(shader,'volume');return source.call(this,shader,text);};
  proto.linkProgram=function(program){const kind=this.getAttachedShaders(program)?.map(s=>shaders.get(s)).find(Boolean);if(kind){programs.set(program,kind);probe[kind+'Programs']++;}return link.call(this,program);};
  proto.drawArrays=function(...args){const kind=programs.get(this.getParameter(this.CURRENT_PROGRAM));if(kind)probe[kind+'Draws']++;return draw.apply(this,args);};
 }
})();`;
await writeFile(`${out}/init.js`,init);
let session='';
const run=async(...args)=>(await exec('agent-browser',['--session',session,...args],{timeout:90000,maxBuffer:8e6,env:{...process.env,AGENT_BROWSER_INIT_SCRIPTS:`${out}/init.js`,AGENT_BROWSER_DEFAULT_TIMEOUT:'60000'}})).stdout;
const evaluate=async code=>JSON.parse(await run('eval','--base64',Buffer.from(code).toString('base64')));
let touchClient=null;
const emulateTouch=async()=>{
 touchClient?.close();
 const activeURL=await evaluate('location.href');
 const endpoint=(await run('get','cdp-url')).trim(),ws=new WebSocket(endpoint);touchClient=ws;
 await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
 let id=0;const pending=new Map();ws.addEventListener('message',event=>{const value=JSON.parse(event.data);if(value.id){const item=pending.get(value.id);pending.delete(value.id);if(value.error)item?.reject(Error(value.error.message));else item?.resolve(value.result);}});
 const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params,sessionId}));});
 const {targetInfos}=await send('Target.getTargets'),target=targetInfos.find(t=>t.type==='page'&&t.url===activeURL);assert.ok(target);
 const {sessionId}=await send('Target.attachToTarget',{targetId:target.targetId,flatten:true});
 await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1},sessionId);
};
const settled=`(()=>{const s=document.querySelector('earthlight-explorer');return s?.hasAttribute('data-ready')&&s.dataset.focus==='sharp'&&s.dataset.exposure==='settled'&&s.dataset.assetPhase==='settled'})()`;
const wait=()=>run('wait','--fn',settled);
const state=()=>evaluate(`(()=>{const s=document.querySelector('earthlight-explorer'),c=s.querySelector('canvas'),gl=c.getContext(s.dataset.renderApi);return {url:location.href,api:s.dataset.renderApi,mode:s.dataset.auroraMode,aurora:s.dataset.aurora,profile:s.dataset.renderProfile,clouds:s.dataset.cloudPass,selected:s.querySelector('#explorer-aurora').value,position:s.dataset.cameraPosition,basis:s.dataset.cameraBasis,exposure:s.querySelector('#explorer-exposure-mode').value,fixedExposure:s.querySelector('#explorer-fixed-exposure').value,grain:s.querySelector('[data-look=grain]').value,rate:s.querySelector('.explorer-speed input').value,motion:s.querySelector('.explorer-motion').getAttribute('aria-label'),touchFirst:matchMedia('(hover: none) and (pointer: coarse)').matches,errors:gl.getError(),failures:s.dataset.assetFailures,probe:window.__effectProbe,client:[...document.scripts].map(s=>s.src).filter(Boolean)}})()`);
const urlFor=(query={})=>{const url=new URL('/',base);for(const[k,v]of Object.entries({motion:'0',quality:'fixed',t:'3235.65',pitch:'-25',epoch:'2026-10-06T01:32:27Z','exposure-mode':'manual','exposure-fixed':'-0.7','look-grain':'.3',rate:'25',...query}))url.searchParams.set(k,v);return url.href;};
const showSettings=async()=>{if(!await evaluate(`document.querySelector('#explorer-settings').matches(':popover-open')`))await run('click','.explorer-settings-toggle');};
const change=async mode=>{await showSettings();await run('select','#explorer-aurora',mode);await run('wait','--fn',`document.querySelector('earthlight-explorer')?.dataset.auroraMode===${JSON.stringify(mode)}`);await wait();return state();};
const check=(s,mode,active,api)=>{assert.equal(s.mode,mode);assert.equal(s.selected,mode);assert.equal(s.aurora,active);assert.equal(s.api,api);assert.equal(s.errors,0);assert.equal(s.failures,'0');if(active==='off'||active==='unsupported'){assert.equal(s.probe.footprintPrograms,0);assert.equal(s.probe.volumePrograms,0);assert.equal(s.probe.footprintDraws,0);assert.equal(s.probe.volumeDraws,0);}else{assert.ok(s.probe.footprintPrograms>0);assert.ok(s.probe.volumePrograms>0);assert.ok(s.probe.footprintDraws>0);}};
const preserved=(a,b)=>{for(const key of ['position','basis','exposure','fixedExposure','grain','rate','motion'])assert.equal(b[key],a[key],`Preserve ${key}`);};
const screenshot=async name=>{await showSettings();await run('scrollintoview','#explorer-aurora');const layout=await evaluate(`(()=>{const box=document.querySelector('#explorer-aurora').getBoundingClientRect(),panel=document.querySelector('#explorer-settings').getBoundingClientRect();return {viewport:[innerWidth,innerHeight],select:{left:box.left,right:box.right,top:box.top,bottom:box.bottom},panel:{left:panel.left,right:panel.right,top:panel.top,bottom:panel.bottom},scrollWidth:document.documentElement.scrollWidth}})()`);assert.ok(layout.select.left>=0&&layout.select.right<=layout.viewport[0]);assert.equal(layout.scrollWidth,layout.viewport[0]);await run('screenshot',`${out}/${name}.png`);return layout;};
let results={environment:{launchArgs:process.env.AGENT_BROWSER_ARGS??'',scope:'Chromium desktop and touch-first emulation; not physical iPhone or Android performance'},desktop:{},touch:{}};
if(section==='touch'){results=JSON.parse(await readFile(`${out}/results.json`,'utf8'));results.harnessRetry='Desktop checks completed; mobile template corrected to supported iPhone 15 and native CDP touch emulation enabled because the CLI device preset only changed metrics/UA; touch checks resumed.';delete results.failure;}
try{
 if(section!=='touch'){
 session=`effects-desktop-${process.pid}`;await run('set','viewport','1280','900');await run('open',urlFor());await wait();
 results.desktop.auto=await state();check(results.desktop.auto,'auto','volume','webgl');assert.equal(results.desktop.auto.touchFirst,false);results.desktop.layout=await screenshot('desktop-auto');
 results.desktop.on=await change('on');check(results.desktop.on,'on','volume','webgl2');preserved(results.desktop.auto,results.desktop.on);
 results.desktop.off=await change('off');check(results.desktop.off,'off','off','webgl');preserved(results.desktop.auto,results.desktop.off);
 await showSettings();await run('click','.reset-all');await run('wait','--fn',`document.querySelector('earthlight-explorer')?.dataset.auroraMode==='auto'&&document.querySelector('earthlight-explorer').dataset.focus==='sharp'&&document.querySelector('earthlight-explorer').dataset.assetPhase==='settled'`);results.desktop.reset=await state();check(results.desktop.reset,'auto','volume','webgl');assert.equal(new URL(results.desktop.reset.url).searchParams.has('aurora'),false);assert.equal(results.desktop.reset.exposure,'auto');assert.equal(results.desktop.reset.motion,'Pause');
 await run('open',urlFor({aurora:'1',probeUnsupported:'1'}));await wait();results.desktop.unsupported=await state();check(results.desktop.unsupported,'on','unsupported','webgl');assert.ok(results.desktop.unsupported.probe.blockedContexts>0&&results.desktop.unsupported.probe.blockedLod>0);assert.match(results.desktop.unsupported.status,/unavailable/);assert.equal(results.desktop.unsupported.statusHidden,false);
 const home=new URL(urlFor({aurora:'0'}));home.pathname='/';await run('open',home.href);await wait();results.desktop.homeLink=await evaluate(`document.querySelector('.explorer-link').href`);assert.equal(new URL(results.desktop.homeLink).searchParams.get('aurora'),'0');
 await run('close');}
 session=`effects-touch-${process.pid}`;await run('set','device','iPhone 15');await run('set','viewport','390','844');
 await run('open',urlFor());await emulateTouch();await evaluate('location.reload();true');await run('wait','--fn',`matchMedia('(hover: none) and (pointer: coarse)').matches&&document.querySelector('earthlight-explorer')?.dataset.aurora==='off'`);await wait();results.touch.auto=await state();assert.equal(results.touch.auto.touchFirst,true);check(results.touch.auto,'auto','off','webgl');results.touch.layout=await screenshot('touch-auto');
 results.touch.on=await change('on');check(results.touch.on,'on','volume','webgl2');preserved(results.touch.auto,results.touch.on);
 results.touch.returnAuto=await change('auto');check(results.touch.returnAuto,'auto','off','webgl');preserved(results.touch.auto,results.touch.returnAuto);
 await run('open',urlFor({render:'clouds-half'}));await emulateTouch();await evaluate('location.reload();true');await run('wait','--fn',`matchMedia('(hover: none) and (pointer: coarse)').matches&&document.querySelector('earthlight-explorer')?.dataset.aurora==='off'`);await wait();results.touch.halfAuto=await state();check(results.touch.halfAuto,'auto','off','webgl2');assert.equal(results.touch.halfAuto.clouds,'half');
 console.log('Desktop/touch policy, API choice, real dropdowns, zero disabled aurora programs/draws, unsupported fallback, state preservation, Reset all and layouts passed.');
}catch(error){results.failure={message:error.message,stack:error.stack,console:await run('console').catch(String),errors:await run('errors').catch(String)};throw error;}
finally{await writeFile(`${out}/results.json`,JSON.stringify(results,null,2)+'\n');touchClient?.close();if(session)await run('close');}
