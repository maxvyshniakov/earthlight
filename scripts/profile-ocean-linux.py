"""Run inside browser-lab as its browser user. Stock, visible Wayland browsers.

Usage: python profile-ocean-linux.py chrome http://HOST:4395 OUTPUT [wide,oblique]
Use EARTHLIGHT_API=webgl2 on the UHD 630 lab. Assert active variants; do not
accept capability fallbacks as candidate measurements. Hardware GPU queries
measure bake, whole-frame and separate surface-pass costs.
"""
import json
import os
import sys
import time
from pathlib import Path
from urllib.parse import urlencode

import psutil
from selenium import webdriver
from selenium.webdriver.firefox.service import Service as FirefoxService

os.environ.update(XDG_RUNTIME_DIR="/run/browser-lab", WAYLAND_DISPLAY="wayland-0",
                  MOZ_ENABLE_WAYLAND="1")
browser, base, destination = sys.argv[1:4]
if browser != "chrome":
    raise ValueError("Ocean bake startup instrumentation requires Chrome CDP")
selected = sys.argv[4].split(",") if len(sys.argv) > 4 else ["wide", "oblique"]
api = os.environ.get("EARTHLIGHT_API", "webgl2")
output = Path(destination)
output.mkdir(parents=True, exist_ok=True)
driver = None


def restart_browser():
    global driver
    if driver:
        driver.quit()
    if browser == "chrome":
        options = webdriver.ChromeOptions()
        options.add_argument("--ozone-platform=wayland")
        options.add_argument("--window-size=1280,800")
        options.add_argument("--disable-dev-shm-usage")
        options.add_argument("--remote-debugging-pipe")
        driver = webdriver.Chrome(options=options)
    else:
        options = webdriver.FirefoxOptions()
        driver = webdriver.Firefox(options=options, service=FirefoxService(
            service_args=["--allow-system-access"], log_output=str(output / "geckodriver.log")))
    driver.set_window_size(1280, 800)
    driver.set_page_load_timeout(180)
    driver.set_script_timeout(180)

STATE = """
const s=document.querySelector('orbital-sky'),c=s?.querySelector('canvas');
const g=c?.getContext('webgl')||c?.getContext('webgl2'),e=g?.getExtension('WEBGL_debug_renderer_info');
return {state:{...s?.dataset},width:c?.width,height:c?.height,
  viewport:[innerWidth,innerHeight,devicePixelRatio],visibility:document.visibilityState,
  renderer:e&&g.getParameter(e.UNMASKED_RENDERER_WEBGL),extensions:g?.getSupportedExtensions()};
"""
SETTLED = """
const s=document.querySelector('orbital-sky');return s&&s.dataset.focus==='sharp'&&
s.dataset.assetPhase==='settled'&&
(Number(s.dataset.cameraAltitude)>1529||!s.dataset.cloudLighting||s.dataset.cloudLighting!=='texture'||
 (s.dataset.cloudLightingReady==='1'&&s.dataset.cloudLightingProgress==='0'))&&
['dayTiles','nightTiles','cloudTiles','terrainTiles','galaxyTiles'].every(k=>
 !s.dataset[k]||JSON.parse(s.dataset[k]).pending===0);
"""
MEASURE = """
const done=arguments[arguments.length-1];
(async()=>{
 const s=document.querySelector('orbital-sky'),c=s.querySelector('canvas'),g=c.getContext('webgl')||c.getContext('webgl2');
 const priorErrors=[];for(let i=0;i<16;i++){const e=g.getError();if(!e)break;priorErrors.push(e);}
 const native=g.getExtension('EXT_disjoint_timer_query_webgl2');
 const ext=native?{TIME_ELAPSED_EXT:native.TIME_ELAPSED_EXT,GPU_DISJOINT_EXT:native.GPU_DISJOINT_EXT,
  QUERY_RESULT_AVAILABLE_EXT:g.QUERY_RESULT_AVAILABLE,QUERY_RESULT_EXT:g.QUERY_RESULT,
  createQueryEXT:()=>g.createQuery(),beginQueryEXT:(t,q)=>g.beginQuery(t,q),endQueryEXT:t=>g.endQuery(t),
  getQueryObjectEXT:(q,k)=>g.getQueryParameter(q,k),deleteQueryEXT:q=>g.deleteQuery(q)}:g.getExtension('EXT_disjoint_timer_query');
 const draw=g.drawArrays,bind=g.bindFramebuffer;
 const programs=new Map(),sources=[],samples=[];let target=g.getParameter(g.FRAMEBUFFER_BINDING);
 const identify=()=>{const p=g.getParameter(g.CURRENT_PROGRAM);if(!programs.has(p)){
  programs.set(p,programs.size);sources.push(g.getAttachedShaders(p).map(s=>g.getShaderSource(s)));
 }return programs.get(p);};
 const measure=mode=>new Promise((resolve,reject)=>{
  let started=null,whole=null,passes=[],ended=false,cpu=0,wall=0;
  const timeout=setTimeout(()=>{restore();reject(Error('frame timeout'));},10000);
  const restore=()=>{g.drawArrays=draw;g.bindFramebuffer=bind;clearTimeout(timeout);};
  g.bindFramebuffer=function(k,v){target=v;return bind.call(this,k,v);};
  g.drawArrays=function(...args){
   if(started===null){g.finish();started=performance.now();
    if(ext&&mode==='whole'){whole=ext.createQueryEXT();ext.beginQueryEXT(ext.TIME_ELAPSED_EXT,whole);}}
   let q=null,id=null;
   if(mode==='passes'){id=identify();if(ext){q=ext.createQueryEXT();ext.beginQueryEXT(ext.TIME_ELAPSED_EXT,q);}else g.finish();}
   const t=performance.now();draw.apply(this,args);cpu+=performance.now()-t;
   if(mode==='passes'){
    if(ext)ext.endQueryEXT(ext.TIME_ELAPSED_EXT);else g.finish();
    passes.push({program:id,viewport:[...g.getParameter(g.VIEWPORT)],query:q,ms:performance.now()-t});
   }
   if(target===null&&!ended){ended=true;
    if(whole)ext.endQueryEXT(ext.TIME_ELAPSED_EXT);
    if(!ext)g.readPixels(0,0,1,1,g.RGBA,g.UNSIGNED_BYTE,new Uint8Array(4));
    wall=performance.now()-started;restore();
    (async()=>{const queries=whole?[whole]:passes.map(p=>p.query).filter(Boolean);
     const deadline=performance.now()+10000;
     while(queries.some(q=>!ext.getQueryObjectEXT(q,ext.QUERY_RESULT_AVAILABLE_EXT))){
      if(performance.now()>deadline)throw Error('GPU query timeout');await new Promise(r=>setTimeout(r,5));}
     if(ext&&g.getParameter(ext.GPU_DISJOINT_EXT))throw Error('disjoint timer');
     const result={cpuDrawMs:cpu,submissionOrCompletionMs:wall,
      frameMs:whole?Number(ext.getQueryObjectEXT(whole,ext.QUERY_RESULT_EXT))/1e6:wall,
      passes:passes.map(p=>({...p,query:undefined,ms:p.query?Number(ext.getQueryObjectEXT(p.query,ext.QUERY_RESULT_EXT))/1e6:p.ms}))};
     queries.forEach(q=>ext.deleteQueryEXT(q));const error=g.getError();if(error)throw Error('WebGL '+error);
     resolve(result);
    })().catch(reject);
   }
  };
  s.querySelector('.sky-track input').dispatchEvent(new Event('input'));
 });
 for(const mode of ['whole','passes'])for(let i=0;i<(mode==='whole'?32:16);i++){
  const value=await measure(mode);if(i>=8)samples.push({mode,...value});
 }
 return {method:ext?'GPU elapsed queries':'synchronous CPU+GPU completion; per-pass finish perturbs scheduling',priorErrors,samples,sources};
})().then(done,error=>done({error:String(error)+'; '+String(error.stack)}));
"""
def memory():
    processes = []
    for process in psutil.process_iter(["name", "memory_info"]):
        if process.info["name"] and any(n in process.info["name"] for n in ["chrome", "firefox", "Web Content", "RDD", "Utility"]):
            processes.append({"name": process.info["name"], "rss": process.info["memory_info"].rss})
    return processes


BAKE_TIMER = r"""
(()=>{
 window.__oceanBake=null;
 for(const proto of [WebGLRenderingContext.prototype,WebGL2RenderingContext.prototype]){
  const draw=proto.drawArrays,mips=proto.generateMipmap;let active=null;
  proto.drawArrays=function(...args){
   if(this.getUniformLocation(this.getParameter(this.CURRENT_PROGRAM),'oceanBakeSize')!==null){
    const g=this,is2='texStorage2D' in g,native=g.getExtension(is2?'EXT_disjoint_timer_query_webgl2':'EXT_disjoint_timer_query');
    if(native){const q=is2?g.createQuery():native.createQueryEXT();active={g,native,q,is2};if(is2)g.beginQuery(native.TIME_ELAPSED_EXT,q);else native.beginQueryEXT(native.TIME_ELAPSED_EXT,q);}
   }
   return draw.apply(this,args);
  };
  proto.generateMipmap=function(...args){
   const result=mips.apply(this,args);
   if(active){const {g,native,is2}=active;if(is2)g.endQuery(native.TIME_ELAPSED_EXT);else native.endQueryEXT(native.TIME_ELAPSED_EXT);window.__oceanBake=active;active=null;proto.drawArrays=draw;proto.generateMipmap=mips;}
   return result;
  };
 }
 window.__readOceanBake=()=>{
  const a=window.__oceanBake;if(!a)return null;
  const {g,native:n,q,is2}=a,available=is2?g.getQueryParameter(q,g.QUERY_RESULT_AVAILABLE):n.getQueryObjectEXT(q,n.QUERY_RESULT_AVAILABLE_EXT),disjoint=g.getParameter(n.GPU_DISJOINT_EXT);
  const ms=available&&!disjoint?(is2?g.getQueryParameter(q,g.QUERY_RESULT):n.getQueryObjectEXT(q,n.QUERY_RESULT_EXT))/1e6:null;
  if(available){if(is2)g.deleteQuery(q);else n.deleteQueryEXT(q);window.__oceanBake=null;}
  return {available,disjoint,ms};
 };
})();
"""

def navigate(params):
    restart_browser()
    driver.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {"source": BAKE_TIMER})
    started = time.monotonic()
    driver.get(base + "/?" + urlencode(params))
    peak = 0
    while time.monotonic() - started < 180:
        peak = max(peak, sum(p["rss"] for p in memory()))
        if driver.execute_script(SETTLED):
            state = driver.execute_script(STATE)
            if state["state"].get("assetFailures") != "0":
                raise RuntimeError("Asset failures: " + json.dumps(state))
            if not state.get("renderer") or any(x in state["renderer"].lower() for x in ["llvmpipe", "swiftshader", "softpipe"]):
                raise RuntimeError("Software or unknown renderer: " + json.dumps(state))
            return {"settledSeconds": time.monotonic() - started, "peakSampledRss": peak, "bake":driver.execute_script("return window.__readOceanBake?.()"), **state}
        time.sleep(1)
    raise RuntimeError("Settlement timeout: " + json.dumps(driver.execute_script(STATE)))



# Adapted from Earthlight profile-linux-gpu.py; retains its hardware checks,
# timers and bounded settling. Matched sea-state variants only.
import math
results={"browser":browser,"api":api,"runs":[]}
try:
 for scene in selected:
  lat,lon=math.radians(-10),math.radians(150)
  alt=1531 if scene=="wide" else 420
  h=math.radians(0 if scene=="wide" else 270)
  n=[math.cos(lat)*math.cos(lon),math.cos(lat)*math.sin(lon),math.sin(lat)]
  north=[-math.sin(lat)*math.cos(lon),-math.sin(lat)*math.sin(lon),math.cos(lat)]
  east=[-math.sin(lon),math.cos(lon),0]
  variants=[("original",{}),("advected",{"ocean":"advected"}),("advected-1024",{"ocean":"advected","oceanResolution":"1024"}),("control",{})]
  for variant,extra in variants:
   params={"api":api,"render":"compact","motion":"0","quality":"fixed","t":0,"epoch":"2026-10-06T01:32:27Z" if scene=="wide" else "2026-10-06T04:30:00Z","flight":"free","position":",".join(str(v*(1+alt/6371)) for v in n),"heading":",".join(str(v*math.cos(h)+east[i]*math.sin(h)) for i,v in enumerate(north)),"elevation":math.radians(-90 if scene=="wide" else -50),"roll":0,"exposure-mode":"manual","exposure-fixed":.5,"look-grain":0,"galaxyDetail":0,**extra}
   state=navigate(params)
   expected=extra.get("ocean","original")
   if state["state"].get("ocean")!=expected:raise RuntimeError("Candidate silently fell back: "+json.dumps(state))
   if expected!="original" and (not state.get("bake") or state["bake"].get("ms") is None):raise RuntimeError("Missing bake timing: "+json.dumps(state))
   measured=driver.execute_async_script(MEASURE)
   if "error" in measured:raise RuntimeError(measured["error"])
   driver.execute_script("const s=document.createElement('style');s.textContent='orbital-sky > :not(canvas){visibility:hidden!important}';document.head.append(s)")
   driver.save_screenshot(str(output/(scene+"-"+variant+".png")))
   row={"scene":scene,"variant":variant,"params":params,**state,"measurement":measured}
   results["runs"].append(row)
   (output/"results.json").write_text(json.dumps(results,indent=2))
   print(scene,variant,measured["method"],flush=True)
 results["capabilities"]=driver.capabilities
finally:
 if driver:driver.quit()
 (output/"results.json").write_text(json.dumps(results,indent=2))
