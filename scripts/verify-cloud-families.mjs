// Isolated regional experiment; this does not certify production Earthlight or a phone GPU.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {cloudFamiliesShader} from '../src/scripts/cloud-families.ts';
const [base='http://127.0.0.1:4321',out='/tmp/cloud-family-proof']=process.argv.slice(2);
await mkdir(out,{recursive:true});
const exec=promisify(execFile),session=`cloud-families-${process.pid}`;
const run=async(...args)=>(await exec('rtk',['proxy','agent-browser','--session',session,...args],{maxBuffer:12e6,timeout:90000})).stdout;
const evaluate=async code=>JSON.parse(await run('eval','--base64',Buffer.from(code).toString('base64')));
const hash=x=>createHash('sha256').update(x).digest('hex');
const result={};
const render=async(state)=>evaluate(`new Promise(resolve=>{
 const root=document.querySelector('#cloud-lab'),old=root.dataset.drawCount;
 const observer=new MutationObserver(()=>{if(root.dataset.drawCount!==old){observer.disconnect();resolve(document.querySelector('canvas').toDataURL());}});
 observer.observe(root,{attributes:true,attributeFilter:['data-draw-count']});
 for(const [key,value] of Object.entries(${JSON.stringify(state)}))document.querySelector('#'+key).value=String(value);
 document.querySelector('#family').dispatchEvent(new Event('input'));
})`);
const capture=async(name,state)=>{const image=await render(state);await writeFile(`${out}/${name}.png`,Buffer.from(image.split(',')[1],'base64'));return hash(image);};
try{
 await run('set','viewport','1200','1000');
 await run('open',`${base}/cloud-lab/`);
 await run('wait','--fn',`document.querySelector('#cloud-lab').dataset.ready==='true'||!!document.querySelector('#cloud-lab').dataset.error`);
 assert.equal(await evaluate(`document.querySelector('#cloud-lab').dataset.error??null`),null);
 // Probe actual GLSL vertical sections, including density outside the allowed
 // shell. High clouds must be separate from low decks; all families are positive.
 const source=`precision highp float;${cloudFamiliesShader}
 void main(){float h=gl_FragCoord.y/192.*20.-1.;float x=gl_FragCoord.x/256.*480.-240.;
 float density=cloudFamilyDensity(vec3(x,x*.37,h),.10);
 gl_FragColor=vec4(density/4.,0.,0.,1.);}`;
 result.profiles=await evaluate(`(()=>{
 const c=document.createElement('canvas');c.width=256;c.height=192;const gl=c.getContext('webgl');gl.disable(gl.DITHER);
 const program=gl.createProgram();for(const [type,text] of [[gl.VERTEX_SHADER,'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}'],[gl.FRAGMENT_SHADER,${JSON.stringify(source)}]]){
 const shader=gl.createShader(type);gl.shaderSource(shader,text);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(shader));gl.attachShader(program,shader);gl.deleteShader(shader);}
 gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));gl.useProgram(program);
 const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);const p=gl.getAttribLocation(program,'p');gl.enableVertexAttribArray(p);gl.vertexAttribPointer(p,2,gl.FLOAT,false,0,0);
 gl.uniform1f(gl.getUniformLocation(program,'weatherSeed'),7);const rows=[];
 for(let family=0;family<6;family++){
 gl.uniform1f(gl.getUniformLocation(program,'family'),family);gl.drawArrays(gl.TRIANGLES,0,3);const pixels=new Uint8Array(256*192*4);gl.readPixels(0,0,256,192,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
 let maxHeight=0,low=0,high=0,outside=0;for(let y=0;y<192;y++)for(let x=0;x<256;x++){const h=(y+.5)/192*20-1,v=pixels[(y*256+x)*4];if(v){maxHeight=Math.max(maxHeight,h);if(h<.45||h>18)outside++;if(h>8)high+=v;else low+=v;}}
 rows.push({family,maxHeight,low,high,outside});}
 const error=gl.getError();gl.deleteBuffer(b);gl.deleteProgram(program);gl.getExtension('WEBGL_lose_context')?.loseContext();if(error)throw Error('WebGL '+error);return rows;
 })()`);
 for(const p of result.profiles){assert.equal(p.outside,0);assert.ok(p.low+p.high>0);if(p.family<2)assert.ok(p.maxHeight<4);if(p.family>=3)assert.ok(p.high>0);}
 result.frames=[];
 for(let family=0;family<6;family++)result.frames.push({family,hash:await capture(`family-${family}`,{family,view:'oblique',sun:25,time:0,cells:0,diagnostic:0,ev:0,seed:7})});
 assert.equal(new Set(result.frames.map(x=>x.hash)).size,6);
 await capture('open-cells',{family:1,cells:1});
 await capture('storm-limb',{family:4,view:'limb',sun:8});
 await capture('cirrus-top',{family:5,view:'top',sun:65});
 const start=await capture('cumulus-t0',{family:2,view:'oblique',sun:25,time:0});
 for(const time of [10,30,60])await capture(`cumulus-t${time}`,{time});
 const later=hash(await render({time:60}));
 assert.notEqual(start,later,'clouds develop and advect');
 assert.equal(hash(await render({time:0})),start,'reverse seek reproduces the frame exactly');
 assert.notEqual(hash(await render({seed:81})),start,'seed changes the regional field');
 const shape=hash(await render({seed:7,time:30,diagnostic:1,sun:8}));
 assert.equal(hash(await render({sun:75})),shape,'lighting cannot change cloud geometry or opacity');
 const bright=hash(await render({diagnostic:0}));assert.notEqual(hash(await render({sun:8})),bright,'sun angle changes illumination and shadows');
 result.deterministic=true;result.lightIndependentDensity=true;
 // A stationary lab does not consume a perpetual render loop.
 const before=await evaluate(`Number(document.querySelector('#cloud-lab').dataset.drawCount)`);
 await new Promise(r=>setTimeout(r,300));
 assert.equal(await evaluate(`Number(document.querySelector('#cloud-lab').dataset.drawCount)`),before);
 await evaluate(`document.querySelector('#play').click();true`);await new Promise(r=>setTimeout(r,1800));
 await evaluate(`document.querySelector('#play').click();true`);
 assert.ok(await evaluate(`Number(document.querySelector('#time').value)>30`),'play advances absolute time');
 result.playback=true;
 await render({time:30,seed:7,family:4,view:'oblique',sun:25});
 const saved=await evaluate(`location.href`);await run('reload');await run('wait','--fn',`document.querySelector('#cloud-lab').dataset.ready==='true'`);
 assert.equal(await evaluate(`document.querySelector('#time').value`),'30');assert.equal(await evaluate(`location.href`),saved);result.urlRestoration=true;
 const beforeLoss=hash(await render({time:30}));
 await evaluate(`window.labContext=document.querySelector('canvas').getContext('webgl');window.labLoss=window.labContext.getExtension('WEBGL_lose_context');window.labLoss.loseContext();true`);
 await run('wait','--fn',`!document.querySelector('#cloud-lab').dataset.ready`);await evaluate(`window.labLoss.restoreContext();true`);
 await run('wait','--fn',`document.querySelector('#cloud-lab').dataset.ready==='true'`);
 assert.equal(hash(await render({time:30})),beforeLoss);result.contextRestoration=true;
 await run('set','viewport','412','915');await run('screenshot',`${out}/mobile.png`);
 assert.equal(await evaluate(`document.documentElement.scrollWidth>innerWidth`),false);
 assert.equal(await evaluate(`document.querySelector('canvas').getContext('webgl').getError()`),0);
 result.mobileLayout=true;result.gpuDeviceAcceptance=false;
 await writeFile(`${out}/results.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await run('close');}
