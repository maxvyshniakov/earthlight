// Capture fixed frames through the isolated benchmark server using agent-browser.
// bun scripts/capture-scene-benchmark.mjs stars|textures /tmp/earthlight-codecs
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const [mode,folder]=process.argv.slice(2),out=path.resolve(folder);
const run=(...args)=>execFileSync('agent-browser',['--session','explorer-codecs',...args],{encoding:'utf8',timeout:120000});
const wait='document.querySelector("earthlight-explorer")?.hasAttribute("data-galaxy-ready") && document.querySelector("earthlight-explorer")?.hasAttribute("data-stars-ready") && document.querySelector("earthlight-explorer")?.hasAttribute("data-surface-ready") && getComputedStyle(document.querySelector("canvas")).opacity === "1"';
const captures=[];
if(mode==='stars'){
  for(const time of [610.87,1244.05,3433.69])for(const cutoff of [7,6.75,6.5,6,5.5])captures.push({name:`stars-${Math.floor(time)}-${cutoff}.png`,url:`http://127.0.0.1:4339/?t=${time}&motion=0&cutoff=${cutoff}`});
}else{
  const {rows}=JSON.parse(fs.readFileSync(path.join(out,'codecs.json')));
  for(const time of [610.87,3235.65])for(const texture of ['reference.png',...rows.map(r=>r.file)])captures.push({name:`texture-${Math.floor(time)}-${texture}.png`,url:`http://127.0.0.1:4339/?t=${time}&motion=0&texture=${texture}`});
}
for(const capture of captures){
  if(fs.existsSync(path.join(out,capture.name)))continue;
  run('open',capture.url);
  try{run('wait','--fn',wait);}catch{run('reload');run('wait','--fn',wait);}
  run('screenshot',path.join(out,capture.name));console.log(capture.name);
}
