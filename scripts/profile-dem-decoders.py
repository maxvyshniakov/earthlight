"""Visible-browser DEM microbenchmark. Inputs are fetched before timing.

Run via browser-lab/run.py; build the benchmark.json fixture with
scripts/prepare-dem-benchmark.mjs after the production build.
"""
import json
import os
import sys
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.firefox.service import Service

os.environ.update(XDG_RUNTIME_DIR="/run/browser-lab", WAYLAND_DISPLAY="wayland-0", MOZ_ENABLE_WAYLAND="1")
browser, base, destination = sys.argv[1:4]
output = Path(destination)
output.mkdir(parents=True, exist_ok=True)
if browser == "chrome":
    options = webdriver.ChromeOptions()
    options.add_argument("--ozone-platform=wayland")
    options.add_argument("--window-size=1280,800")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--remote-debugging-pipe")
    driver = webdriver.Chrome(options=options)
else:
    options = webdriver.FirefoxOptions()
    driver = webdriver.Firefox(options=options, service=Service(service_args=["--allow-system-access"], log_output=str(output / "geckodriver.log")))
driver.set_script_timeout(300)
try:
    driver.get(base + "/media/earthlight/terrain-packed/v1/benchmark.html")
    # Run the byte loop in the page realm; Firefox WebDriver wrappers make
    # indexed reads of worker-owned arrays prohibitively slow across realms.
    source = """
const done=result=>window.dispatchEvent(new CustomEvent('dem-benchmark-result',{detail:result}));
(async()=>{
 const fixture=await(await fetch('/media/earthlight/terrain-packed/v1/benchmark.json')).json(),inputs=[];
 for(const f of fixture.files){
  const get=async url=>{const r=await fetch(url);if(!r.ok)throw Error('Input unavailable '+url);return r.arrayBuffer();};
  inputs.push({...f,tiff:await get('/media/earthlight/dem90/'+f.name+'.tif'),packed:await get('/media/earthlight/terrain-packed/v1/'+f.name+'.dem')});
 }
 const references=new Map(),rows=[],workers=new Map();
 const one=async(mode,input)=>{
  const format=mode.startsWith('packed')?'packed':'tiff',buffer=input[format].slice(0),started=performance.now();
  let worker=workers.get(mode);if(!worker){worker=new Worker(fixture.workers[format],{type:'module'});if(!mode.endsWith('single'))workers.set(mode,worker);}
  try{
   const patches=await new Promise((resolve,reject)=>{worker.onmessage=e=>e.data.error?reject(Error(e.data.error)):resolve(e.data.patches);worker.onerror=e=>reject(Error(e.message));worker.postMessage({buffer,parent:input.id},[buffer]);});
   const ms=performance.now()-started;
   const previous=references.get(input.id);let mismatches=0;
   if(previous){for(let p=0;p<4;p++){if(patches[p].length!==previous[p].length)throw Error('Wrong patch size');for(let i=0;i<patches[p].length;i++)if(patches[p][i]!==previous[p][i])mismatches++;}}
   else references.set(input.id,patches);
   if(mismatches)throw Error('Numeric byte mismatch '+input.name+': '+mismatches);
   return {mode,id:input.id,name:input.name,ms,bytes:input[format].byteLength,mismatches};
  }finally{worker.onmessage=null;worker.onerror=null;if(mode.endsWith('single'))worker.terminate();}
 };
 try{
  // Warm every module/format; reference bytes are established by actual TIFF decode.
  for(const mode of ['single','pool','packed-single','packed'])await one(mode,inputs[0]);
  for(let round=0;round<3;round++)for(const input of inputs){
   const modes=round%2?['packed','packed-single','pool','single']:['single','pool','packed-single','packed'];
   // Establish TIFF reference before reverse-order timing for a new input.
   if(!references.has(input.id))await one('single',input);
   for(const mode of modes)rows.push({round,...await one(mode,input)});
  }
 }finally{for(const worker of workers.values())worker.terminate();}
 return {rows,fixture,method:'Inputs prefetched; sequential AB/BA-style mode ordering; three rounds, warmup excluded; wall time includes Worker creation for single mode; every output byte compared to TIFF.'};
})().then(done,e=>done({error:String(e.stack??e)}));
"""
    result = driver.execute_async_script("""
const done=arguments[arguments.length-1],script=document.createElement('script');
window.addEventListener('dem-benchmark-result',event=>done(event.detail),{once:true});
script.textContent=arguments[0];document.body.append(script);
""", source)
    (output / "results.json").write_text(json.dumps(result, indent=2))
    if "error" in result:
        raise RuntimeError(result["error"])
    for mode in ["single", "pool", "packed-single", "packed"]:
        costs = sorted(r["ms"] for r in result["rows"] if r["mode"] == mode)
        print(mode, "median ms", costs[len(costs) // 2], "samples", len(costs), flush=True)
finally:
    driver.quit()
