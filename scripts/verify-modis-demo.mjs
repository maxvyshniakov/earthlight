import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {modisDemoFragment} from '../src/scripts/modis-demo-shader.ts';
const [base='http://127.0.0.1:4322',out='/tmp/modis-proof']=process.argv.slice(2);
await mkdir(out,{recursive:true});const exec=promisify(execFile),session='modis-proof-'+process.pid;
const run=async(...args)=>(await exec('rtk',['proxy','agent-browser','--session',session,...args],{timeout:120000,maxBuffer:16e6})).stdout;
const evaluate=async s=>JSON.parse(await run('eval','--base64',Buffer.from(s).toString('base64')));
const hash=s=>createHash('sha256').update(s).digest('hex');const result={};
const manifest=JSON.parse(await readFile('public/media/earthlight/modis-demo/manifest.json'));
for(const d of manifest.dates){
 const q=await sharp(`public/media/earthlight/modis-demo/${d.date}-quality.png`).raw().toBuffer();
 const fields=await Promise.all(['low','middle','high'].map(k=>sharp(`public/media/earthlight/modis-demo/${d.date}-${k}.png`).raw().toBuffer()));
 let cloudy=0;for(let i=0;i<q.length;i+=4){const count=fields.reduce((n,f)=>n+Number(f[i+3]>0),0);assert.equal(count,q[i]===255?1:0,'No invented coverage in unknown/clear pixels or duplicated layers');cloudy+=count;}
 assert.equal(cloudy,d.cloudPixels);assert.equal(d.cloudPixels+d.clearPixels+d.unknownPixels,manifest.size**2);
}
result.dataMasks=true;
async function render(state={}){return evaluate(`new Promise((resolve,reject)=>{
 const root=document.querySelector('#modis-demo'),old=root.dataset.drawCount,timer=setTimeout(()=>{obs.disconnect();reject(Error('draw timeout'));},30000);
 const obs=new MutationObserver(()=>{if(root.dataset.error){clearTimeout(timer);obs.disconnect();reject(Error(root.dataset.error));}else if(root.dataset.ready==='true'&&root.dataset.drawCount!==old){clearTimeout(timer);obs.disconnect();resolve(document.querySelector('canvas').toDataURL());}});obs.observe(root,{attributes:true});
 for(const [id,v] of Object.entries(${JSON.stringify(state)})){const el=document.querySelector('#'+id);if(el.type==='checkbox')el.checked=!!v;else el.value=String(v);}
 document.querySelector(${JSON.stringify('date' in state?'#date':'reconstruction' in state?'#reconstruction':'#time')}).dispatchEvent(new Event('input'));
})`);}
async function capture(name,state){const png=await render(state);await writeFile(`${out}/${name}.png`,Buffer.from(png.split(',')[1],'base64'));return hash(png);}
try{
 await run('set','viewport','1280','1080');await run('open',base+'/modis-demo/');
 await run('wait','--fn',`document.querySelector('#modis-demo').dataset.ready==='true'||!!document.querySelector('#modis-demo').dataset.error`);
 assert.equal(await evaluate(`document.querySelector('#modis-demo').dataset.error??null`),null);
 result.dates=[];for(const d of manifest.dates)result.dates.push({date:d.date,hash:await capture(d.date,{date:d.date,time:0})});
 assert.equal(new Set(result.dates.map(d=>d.hash)).size,3);
 const day=await capture('day',{date:manifest.dates[0].date,time:0,sun:32,view:'oblique'});
 assert.notEqual(await capture('measured-only',{reconstruction:0}),day);assert.equal(hash(await render({reconstruction:1})),day);result.reconstructionSwitch=true;
 assert.notEqual(await capture('low-sun',{sun:10}),day);
 await capture('top',{view:'top',sun:32});await capture('close',{view:'close'});
 const shape=hash(await render({view:'oblique',diagnostic:1,sun:10}));assert.equal(hash(await render({sun:70})),shape,'Sun must not change density map');
 await capture('height-groups',{diagnostic:1,sun:32});
 const all=hash(await render({diagnostic:0}));assert.notEqual(hash(await render({low:false,middle:false,high:false})),all);
 assert.equal(hash(await render({low:true,middle:true,high:true})),all);
 const later=await capture('wind-60',{time:60});assert.notEqual(later,all);assert.equal(hash(await render({time:0})),all);
 result.lightIndependentData=true;result.layerSwitches=true;result.deterministicWind=true;
 const count=await evaluate(`document.querySelector('#modis-demo').dataset.drawCount`);await new Promise(r=>setTimeout(r,400));assert.equal(await evaluate(`document.querySelector('#modis-demo').dataset.drawCount`),count);
 await evaluate(`document.querySelector('#play').click();true`);await new Promise(r=>setTimeout(r,1200));await evaluate(`document.querySelector('#play').click();true`);
 assert.ok(await evaluate(`Number(document.querySelector('#time').value)>0`));result.playback=true;
 const saved=await capture('restoration',{time:30,view:'close',sun:18});await run('reload');await run('wait','--fn',`document.querySelector('#modis-demo').dataset.ready==='true'`);
 assert.equal(hash(await render({})),saved);result.urlRestoration=true;
 await evaluate(`window.loss=document.querySelector('canvas').getContext('webgl2').getExtension('WEBGL_lose_context');window.loss.loseContext();true`);
 await run('wait','--fn',`!document.querySelector('#modis-demo').dataset.ready`);await evaluate(`window.loss.restoreContext();true`);
 await run('wait','--fn',`document.querySelector('#modis-demo').dataset.ready==='true'`);assert.equal(hash(await render({})),saved);result.contextRestoration=true;
 // Actual shader, uniform synthetic cloud: both ray integration and sunlight
 // must agree with Beer-Lambert transmission for its encoded vertical tau.
 const probe=modisDemoFragment.slice(0,modisDemoFragment.indexOf('void main()'))+`void main(){float t=segment(vec3(0.,0.,4.),vec3(0.,0.,-1.),12.);float s=opticalDepth(vec3(0.));fragColor=vec4(exp(-t),exp(-s),0.,1.);}`;
 result.transmission=await evaluate(`(()=>{const c=document.createElement('canvas');c.width=c.height=1;const gl=c.getContext('webgl2');gl.disable(gl.DITHER);const p=gl.createProgram();
 for(const [type,source] of [[gl.VERTEX_SHADER,${JSON.stringify('#version 300 es\nin vec2 p;void main(){gl_Position=vec4(p,0.,1.);}')}],[gl.FRAGMENT_SHADER,${JSON.stringify(probe)}]]){const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));gl.attachShader(p,s);gl.deleteShader(s);}gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));gl.useProgram(p);
 const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);const a=gl.getAttribLocation(p,'p');gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,2,gl.FLOAT,false,0,0);
 for(const [i,name] of ['lowMap','middleMap','highMap'].entries()){const t=gl.createTexture();gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,t);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array(i===1?[80,56,0,255]:[0,0,0,0]));gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.uniform1i(gl.getUniformLocation(p,name),i);}
 gl.uniform3f(gl.getUniformLocation(p,'layers'),1,1,1);gl.uniform3f(gl.getUniformLocation(p,'eye'),0,0,100);gl.uniform3f(gl.getUniformLocation(p,'sun'),0,0,1);gl.uniform2f(gl.getUniformLocation(p,'extent'),1000,1000);gl.uniform2f(gl.getUniformLocation(p,'resolution'),1000,1000);gl.drawArrays(gl.TRIANGLES,0,3);const v=new Uint8Array(4);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,v);const error=gl.getError();gl.getExtension('WEBGL_lose_context').loseContext();return {ray:v[0],sun:v[1],error};})()`);
 const expected=Math.round(Math.exp(-(Math.exp(56/255*Math.log(151))-1))*255);
 assert.equal(result.transmission.error,0);assert.ok(Math.abs(result.transmission.ray-expected)<=2);assert.ok(Math.abs(result.transmission.sun-expected)<=2);
 await run('set','viewport','412','915');await run('screenshot',out+'/mobile.png');assert.equal(await evaluate(`document.documentElement.scrollWidth>innerWidth`),false);
 assert.equal(await evaluate(`document.querySelector('canvas').getContext('webgl2').getError()`),0);result.mobileLayout=true;
 await writeFile(out+'/results.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await run('close');}
