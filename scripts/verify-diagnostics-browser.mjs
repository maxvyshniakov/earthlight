// Isolated browser proof, including actual browser downloads and module failure.
// bun scripts/verify-diagnostics-browser.mjs http://127.0.0.1:4392 /tmp/earthlight-diagnostics-proof
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const [base='http://127.0.0.1:4392',out='/tmp/earthlight-diagnostics-proof']=process.argv.slice(2);
await mkdir(out,{recursive:true});
const session=`diagnostics-proof-${process.pid}`,exec=promisify(execFile);
const run=async(...args)=>(await exec('agent-browser',['--session',session,...args],{timeout:90000,maxBuffer:8e6,env:{...process.env,AGENT_BROWSER_DEFAULT_TIMEOUT:'75000'}})).stdout;
const evaluate=async source=>JSON.parse(await run('eval','--base64',Buffer.from(source).toString('base64')));
try{
 await run('network','route','**/_astro/*.js','--abort');
 await run('open',`${base}/?diagnostics=1&motion=0&secret=not-in-report`);
 assert.equal(await evaluate('!!window.earthlightDiagnostics'),true);
 assert.equal(await evaluate('!!document.querySelector(".earthlight-diagnostics")'),true);
 await run('screenshot',`${out}/early.png`);
 await run('download','.earthlight-diagnostics button:nth-of-type(3)',`${out}/early.json`);
 const early=JSON.parse(await readFile(`${out}/early.json`,'utf8'));
 assert.equal(early.schema,'earthlight-diagnostics/v2');assert.equal(early.milestones.firstFrame,undefined);
 assert.ok(!JSON.stringify(early).includes('not-in-report'));
 console.log('early module failure: visible panel and real JSON download');
 await run('network','unroute');await run('reload');
 await run('wait','--fn',"document.querySelector('earthlight-explorer').hasAttribute('data-ready')");
 assert.equal(await evaluate("[...document.querySelectorAll('.earthlight-diagnostics button')].some(b=>b.textContent==='Previous report')"),true);
 await run('download','.earthlight-diagnostics button:nth-of-type(4)',`${out}/previous.json`);
 const previous=JSON.parse(await readFile(`${out}/previous.json`,'utf8'));
 assert.equal(previous.started,early.started);
 await run('click','.earthlight-diagnostics button:nth-of-type(1)');
 await run('wait','--fn',"window.earthlightDiagnostics.report().events.some(e=>e.name==='test-phase'&&e.detail==='day · 1/3')");
 await run('screenshot',`${out}/guided-day.png`);
 await run('wait','--fn',"window.earthlightDiagnostics.report().events.some(e=>e.name==='test-phase'&&e.detail==='free')");
 assert.equal(await evaluate("document.querySelector('earthlight-explorer').hasAttribute('data-paused')"),true);
 await run('click','.earthlight-diagnostics button:nth-of-type(2)');
 await run('download','.earthlight-diagnostics button:nth-of-type(3)',`${out}/report.json`);
 const report=JSON.parse(await readFile(`${out}/report.json`,'utf8'));
 assert.ok(report.milestones.firstFrame>0);assert.ok(report.events.some(e=>e.name==='user-stutter'));
 for(const phase of ['day · 1/3','surface · 2/3','night turn · 3/3'])assert.ok(report.windows.some(w=>w.phase===phase&&w.frames>0),phase);
 assert.ok(report.windows.some(w=>w.cpuSubmissionMs));
 if(report.environment.gpuTimerSupported&&report.windows.some(w=>w.gpuMs)){
  assert.ok(report.gpuPassSamples.length>0,'GPU pass samples');
  assert.equal(new Set(report.gpuPassSamples.flatMap(s=>Object.keys(s.passes))).size,6,'all six groups');
  for(const sample of report.gpuPassSamples){assert.equal(Object.keys(sample.passes).length,1);assert.ok(['sky','resources-and-lighting','source-attenuation','world','volumes','camera-finish'].includes(Object.keys(sample.passes)[0]));assert.ok(Object.values(sample.passes).every(ms=>Number.isFinite(ms)&&ms>=0));}
 }
 assert.ok(report.windows.some(w=>Number(w.state.refreshPeriodMs)>0));assert.ok(report.windows.some(w=>Object.keys(w.jobs).length));
 assert.equal(report.events.filter(e=>e.name==='test-phase'&&e.detail==='free').length,1);
 console.log('guided test: all three phases, timing windows, problem mark and playback restoration');
 await run('set','viewport','390','844');await run('screenshot',`${out}/mobile.png`);
 assert.equal(await evaluate("(()=>{const r=document.querySelector('.earthlight-diagnostics').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;})()"),true);
 await run('click','.earthlight-diagnostics button:last-of-type');assert.equal(await evaluate('window.earthlightDiagnostics.active'),false);
 await run('open',base);assert.equal(await evaluate('!!window.earthlightDiagnostics'),false);assert.equal(await evaluate('!!document.querySelector(".earthlight-diagnostics")'),false);
 await writeFile(`${out}/result.json`,JSON.stringify({earlyDownload:true,previousDownload:true,guidedTest:true,mobile:true,ordinaryVisit:true,revision:report.environment.build}));
 console.log('mobile panel, stop and ordinary-visit isolation: passed');
}finally{await run('close');}
