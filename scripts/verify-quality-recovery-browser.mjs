// Exercise the actual explorer/clock/quality wiring from a remembered low scale.
// Use a small viewport to leave GPU headroom; this is not a GPU benchmark.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const [base='http://127.0.0.1:4392',out='/tmp/earthlight-quality-recovery']=process.argv.slice(2);
const session=`quality-recovery-${process.pid}`,exec=promisify(execFile);
const run=async(...args)=>(await exec('agent-browser',['--session',session,...args],{timeout:90000,maxBuffer:8e6,env:{...process.env,AGENT_BROWSER_DEFAULT_TIMEOUT:'75000'}})).stdout;
const evaluate=async source=>JSON.parse(await run('eval','--base64',Buffer.from(source).toString('base64')));
await mkdir(out,{recursive:true});
try{
 await run('set','viewport','640','480');
 await run('open',`${base}/?motion=0`);
 await run('wait','--fn',"document.querySelector('earthlight-explorer').hasAttribute('data-ready')");
 await evaluate(`(()=>{const r=document.querySelector('earthlight-explorer canvas').getBoundingClientRect();localStorage.setItem('earthlight.renderScale.v1',JSON.stringify({scale:.45,width:r.width,height:r.height,dpr:devicePixelRatio,profile:'compact',at:Date.now()}));return true;})()`);
 await run('open',`${base}/?diagnostics=1`);
 await run('wait','--fn',"document.querySelector('earthlight-explorer').dataset.focus==='sharp'");
 assert.equal(await evaluate("document.querySelector('earthlight-explorer').dataset.startScale"),'0.45');
 await run('wait','--fn',"Number(document.querySelector('earthlight-explorer').dataset.qualityScale)>=.5");
 const report=await evaluate('window.earthlightDiagnostics.report()');
 const scale=await evaluate("Number(document.querySelector('earthlight-explorer').dataset.qualityScale)");
 assert.ok(scale>=.5);
 assert.ok(report.events.some(e=>e.name==='buffer-resize'&&e.detail.qualityScale>=.5));
 await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));
 await writeFile(`${out}/result.json`,JSON.stringify({startScale:.45,recoveredScale:scale,build:report.environment.build},null,2));
 console.log('Remembered quality recovers in the actual explorer:',scale);
}finally{await run('close');}
