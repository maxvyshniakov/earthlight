import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile} from 'node:fs/promises';
import {modisStudyURL} from '../src/scripts/modis-study-view.ts';
import {modisPatchShader} from '../src/scripts/modis-patch.ts';
const [base='http://127.0.0.1:4322',out='/tmp/modis-patch-checks']=process.argv.slice(2);
await mkdir(out,{recursive:true});
const exec=promisify(execFile),session='modis-check-'+process.pid;
const run=async(...args)=>(await exec('agent-browser',['--session',session,...args],{maxBuffer:32e6,timeout:120000})).stdout;
const evaluate=async code=>JSON.parse(await run('eval','--base64',Buffer.from(code).toString('base64')));
const wait=async()=>{for(let i=0;i<160;i++){
 const ready=await evaluate(`(()=>{const s=document.querySelector('earthlight-explorer');return s?.hasAttribute('data-ready')&&s.dataset.modisReady==='1'&&s.dataset.focus==='sharp'&&s.dataset.assetPhase==='settled'&&s.dataset.exposure==='settled';})()`);
 if(ready)return;await new Promise(r=>setTimeout(r,500));
}throw Error('Scene not ready');};
const state=()=>evaluate(`(()=>{const s=document.querySelector('earthlight-explorer');return {data:{...s.dataset},url:location.href,overflow:document.documentElement.scrollWidth>innerWidth};})()`);
const results={};
try{
 await run('set','viewport','1200','800');
 const url=modisStudyURL(base);url.searchParams.set('api','webgl');url.searchParams.set('quality','fixed');
 await run('open',url.href);await wait();
 const before=await state();assert.equal(before.data.assetFailures,'0');
 await run('select','#modis-study-mode','photo');await wait();
 const photo=await state();assert.equal(photo.data.cloudStudy,'photo');
 for(const key of ['cameraPosition','cameraBasis']){
   const parse=value=>value.startsWith('[')?JSON.parse(value):value.split(',').map(Number);
   const a=parse(photo.data[key]),b=parse(before.data[key]);
   assert.ok(a.every((v,i)=>Math.abs(v-b[i])<5e-8),'Pose changed: '+key);
 }
 assert.equal(Date.parse(new URL(photo.url).searchParams.get('epoch')),Date.parse(new URL(before.url).searchParams.get('epoch')));
 assert.equal(new URL(photo.url).searchParams.get('exposure-fixed'),'0');
 await run('select','#modis-study-mode','modis');await wait();
 results.switchPreservesPose=true;
 // Integrating a column must not depend on ray-step phase or count. The
 // expected total is analytic, independent of the shader's CDF implementation.
 const source=`#define MODIS_PATCH 1\nprecision highp float;${modisPatchShader}
 void main(){float h=1.5+floor(gl_FragCoord.x/8.)*1.2;
 float steps=8.+mod(floor(gl_FragCoord.x),8.)*3.;float ds=20./steps;
 vec4 field=vec4(.7,h/16.,.6,1.);float tau=0.;
 for(int i=0;i<32;i++){if(float(i)>=steps)break;float altitude=-4.+(float(i)+.5)*ds+(gl_FragCoord.y-.5)*.13;tau+=modisDensity(field,altitude,ds*.5)*ds;}
 gl_FragColor=vec4(exp(-tau),0.,0.,1.);}`;
 const oracle=await evaluate(`(()=>{
 const c=document.createElement('canvas');c.width=64;c.height=8;const gl=c.getContext('webgl');gl.disable(gl.DITHER);
 const p=gl.createProgram();for(const [type,text] of [[gl.VERTEX_SHADER,'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}'],[gl.FRAGMENT_SHADER,${JSON.stringify(source)}]]){const s=gl.createShader(type);gl.shaderSource(s,text);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));gl.attachShader(p,s);gl.deleteShader(s);}
 gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));gl.useProgram(p);
 const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);const a=gl.getAttribLocation(p,'p');gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,2,gl.FLOAT,false,0,0);gl.drawArrays(gl.TRIANGLES,0,3);
 const pixels=new Uint8Array(64*8*4);gl.readPixels(0,0,64,8,gl.RGBA,gl.UNSIGNED_BYTE,pixels);const values=Array.from(pixels).filter((_,i)=>i%4===0);const result={min:Math.min(...values),max:Math.max(...values),error:gl.getError()};gl.deleteProgram(p);gl.deleteBuffer(b);gl.getExtension('WEBGL_lose_context').loseContext();return result;
 })()`);
 const t=Math.max(0,Math.min(1,(Math.exp(.6*5.0172798)-2)/37)),optical=.35+4.15*t*t*(3-2*t);
 const expected=Math.round(Math.exp(-(.7**1.35)*optical)*255);
 assert.equal(oracle.error,0);assert.ok(Math.abs(oracle.min-expected)<=1&&Math.abs(oracle.max-expected)<=1);results.column={...oracle,expected};
 await evaluate(`(()=>{const c=document.querySelector('earthlight-explorer canvas');const gl=c.getContext('webgl');const e=gl.getExtension('WEBGL_lose_context');e.loseContext();setTimeout(()=>e.restoreContext(),250);return true;})()`);
 await new Promise(r=>setTimeout(r,500));await wait();assert.equal((await state()).data.modisReady,'1');results.contextRestore=true;
 await new Promise(r=>setTimeout(r,800));await run('screenshot',out+'/desktop.png');
 await run('set','viewport','412','915');await wait();assert.equal((await state()).overflow,false);
 await run('screenshot',out+'/mobile.png');results.narrowLayout=true;
 await run('set','viewport','1200','800');
 await run('open',new URL('/?studyView=day&cloudStudy=modis&api=webgl2',base).href);await wait();
 const secondAPI=await state();assert.equal(secondAPI.data.renderApi,'webgl2');
 assert.equal(new URL(secondAPI.url).searchParams.has('studyView'),false);results.shortLinkAndWebGL2=true;
 results.motion=await evaluate(`(async()=>{
 const s=document.querySelector('earthlight-explorer'),before=s.dataset.cameraBasis;document.activeElement?.blur();
 window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',code:'ArrowRight',bubbles:true}));
 await new Promise(r=>setTimeout(r,700));
 window.dispatchEvent(new KeyboardEvent('keyup',{key:'ArrowRight',code:'ArrowRight',bubbles:true}));
 await new Promise(r=>setTimeout(r,500));
 return {cameraMoved:before!==s.dataset.cameraBasis,error:s.querySelector('canvas').getContext('webgl2').getError()};
 })()`);
 assert.equal(results.motion.cameraMoved,true);assert.equal(results.motion.error,0);
 await writeFile(out+'/results.json',JSON.stringify(results,null,2)+'\n');console.log(results);
}finally{await run('close');}
