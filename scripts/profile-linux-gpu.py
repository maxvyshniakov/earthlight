"""Run inside browser-lab as its browser user. Stock, visible Wayland browsers.

Usage: python profile-linux-gpu.py chrome http://HOST:4351 OUTPUT [day,clouds,night]
Per-pass timers are diagnostic; sustained cadence is measured without queries.
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
selected = sys.argv[4].split(",") if len(sys.argv) > 4 else ["day", "clouds", "night"]
api = os.environ.get("EARTHLIGHT_API", "webgl")
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
s.dataset.assetPhase==='settled'&&s.dataset.exposure==='settled'&&
(!s.dataset.cloudLighting||s.dataset.cloudLighting!=='texture'||
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
 for(const mode of ['whole','passes'])for(let i=0;i<24;i++){
  const value=await measure(mode);if(i>=8)samples.push({mode,...value});
 }
 return {method:ext?'GPU elapsed queries':'synchronous CPU+GPU completion; per-pass finish perturbs scheduling',priorErrors,samples,sources};
})().then(done,error=>done({error:String(error)+'; '+String(error.stack)}));
"""
CADENCE = """
const seconds=arguments[0],done=arguments[arguments.length-1];
const s=document.querySelector('orbital-sky'),c=s.querySelector('canvas'),g=c.getContext('webgl')||c.getContext('webgl2');
const draw=g.drawArrays,bind=g.bindFramebuffer,upload=g.texSubImage2D,frames=[],rafs=[],longTasks=[],uploads=[];
let target=g.getParameter(g.FRAMEBUFFER_BINDING),active=true;
g.bindFramebuffer=function(k,v){target=v;return bind.call(this,k,v);};
g.drawArrays=function(...a){draw.apply(this,a);if(target===null)frames.push(performance.now());};
g.texSubImage2D=function(...a){const t=performance.now();upload.apply(this,a);uploads.push({ms:performance.now()-t,width:a.length===9?a[4]:a[6].width,height:a.length===9?a[5]:a[6].height});};
const tick=t=>{if(active){rafs.push(t);requestAnimationFrame(tick);}};requestAnimationFrame(tick);
let observer;try{observer=new PerformanceObserver(l=>longTasks.push(...l.getEntries().map(e=>e.duration)));observer.observe({entryTypes:['longtask']});}catch{}
const start=performance.now();setTimeout(()=>{active=false;g.drawArrays=draw;g.bindFramebuffer=bind;g.texSubImage2D=upload;observer?.disconnect();
 done({elapsedMs:performance.now()-start,frames,rafs,longTasks,uploads,state:{...s.dataset}});},seconds*1000);
"""


def memory():
    processes = []
    for process in psutil.process_iter(["name", "memory_info"]):
        if process.info["name"] and any(n in process.info["name"] for n in ["chrome", "firefox", "Web Content", "RDD", "Utility"]):
            processes.append({"name": process.info["name"], "rss": process.info["memory_info"].rss})
    return processes


def navigate(params):
    restart_browser()
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
            return {"settledSeconds": time.monotonic() - started, "peakSampledRss": peak, **state}
        time.sleep(1)
    raise RuntimeError("Settlement timeout: " + json.dumps(driver.execute_script(STATE)))


reference_work = {"terrainWork": "legacy", "terrainRefinement": "full", "cloudSteps": "full"}

results = {"browser": browser, "api": api, "isolation": "Fresh browser process and profile per variant", "runs": []}
try:
    for scene, t, pitch in [("day", 3235.65, 0), ("clouds", 3235.65, -25), ("night", 610.87, 0)]:
        if scene not in selected:
            continue
        # A/B/A comparisons retain identical cameras and fixed quality.
        variants = [("baseline", {}), ("half", {"render": "clouds-half"}),
                    ("control", {}), ("no-terrain", {"terrain": "0"}),
                    ("control2", {})] if scene == "clouds" else [("baseline", {})]
        if os.environ.get("EARTHLIGHT_VARIANTS") and any(name in os.environ["EARTHLIGHT_VARIANTS"].split(",") for name in ["bounded", "pixel", "balanced", "combined", "coarse-gpu", "default"]):
            variants = [("baseline", {}), ("bounded", {"terrainWork": "bounded"}),
                        ("control", {}), ("pixel", {"terrainWork": "bounded", "terrainRefinement": "pixel"}),
                        ("control2", {}), ("balanced", {"cloudSteps": "balanced"}),
                        ("combined", {"terrainWork": "bounded", "terrainRefinement": "pixel", "cloudSteps": "balanced"}),
                        ("coarse-gpu", {"terrainDetail": "coarse"}), ("control3", {}), ("default", {})]
        if os.environ.get("EARTHLIGHT_TEXTURE_TEST") == "1":
            variants = [("baseline", {}), ("compact-textures", {"texture": "compact"}), ("control", {})]
        if os.environ.get("EARTHLIGHT_VARIANTS"):
            variants = [(name, params) for name, params in variants
                        if name in os.environ["EARTHLIGHT_VARIANTS"].split(",")]
        for variant, extra in variants:
            params = {"api": api, "render": "compact", "motion": "0", "quality": "fixed",
                      "t": t, "pitch": pitch, "epoch": "2026-10-06T01:32:27Z", "look-grain": "0",
                      "exposure-mode": "manual", "exposure-fixed": "0",
                      **({} if variant == "default" else reference_work), **extra}
            state = navigate(params)
            results["capabilities"] = driver.capabilities
            if variant == "half" and state["state"].get("cloudPass") != "half":
                results["runs"].append({"scene": scene, "variant": variant, **state,
                                        "skipped": "Half-resolution pass fell back"})
                (output / "results.json").write_text(json.dumps(results, indent=2))
                print(scene, variant, "SKIP: half-resolution pass fell back", flush=True)
                continue
            measurement = driver.execute_async_script(MEASURE)
            if "error" in measurement:
                (output / "measurement-error.json").write_text(json.dumps({**state, **measurement}, indent=2))
                raise RuntimeError(measurement["error"])
            driver.save_screenshot(str(output / f"{scene}-{variant}.png"))
            row = {"scene": scene, "variant": variant, "params": params, **state, **measurement}
            results["runs"].append(row)
            (output / "results.json").write_text(json.dumps(results, indent=2))
            values = sorted(s["frameMs"] for s in row["samples"] if s["mode"] == "whole")
            print(scene, variant, row["method"], "median ms", values[len(values)//2], flush=True)
        motion_cases = [("fixed", {}), ("adaptive", {})]
        if os.environ.get("EARTHLIGHT_VARIANTS") == "coarse":
            motion_cases = [("fixed-before", {}), ("fixed-coarse", {"terrainDetail": "coarse"}), ("fixed-control", {})]
        for quality, extra in (motion_cases if os.environ.get("EARTHLIGHT_MOTION", "1") == "1" else []):
            if os.environ.get("EARTHLIGHT_VARIANTS") == "combined":
                extra = {"terrainWork": "bounded", "terrainRefinement": "pixel", "cloudSteps": "balanced", **extra}
            params = {"api": api, "render": "compact", "t": t, "pitch": pitch,
                      "epoch": "2026-10-06T01:32:27Z", "quality": quality.split("-")[0],
                      **({} if os.environ.get("EARTHLIGHT_VARIANTS") == "default" else reference_work), **extra}
            restart_browser()
            driver.get(base + "/?" + urlencode(params))
            time.sleep(35)
            if browser == "chrome":
                driver.execute_cdp_cmd("Profiler.enable", {})
                driver.execute_cdp_cmd("Profiler.start", {})
            cadence = driver.execute_async_script(CADENCE, 20)
            if browser == "chrome":
                profile = driver.execute_cdp_cmd("Profiler.stop", {})
                (output / f"{scene}-{quality}.cpuprofile").write_text(json.dumps(profile["profile"]))
            results["runs"].append({"scene": scene, "variant": "motion-" + quality,
                                    **driver.execute_script(STATE), "cadence": cadence, "rss": memory()})
            (output / "results.json").write_text(json.dumps(results, indent=2))
            print(scene, quality, "submitted fps", len(cadence["frames"])*1000/cadence["elapsedMs"], flush=True)
finally:
    if driver:
        try:
            if browser == "firefox":
                driver.get("about:support")
                time.sleep(3)
                (output / "firefox-support.txt").write_text(driver.find_element("tag name", "body").text)
        except Exception as error:
            (output / "diagnostics-error.txt").write_text(str(error))
        finally:
            driver.quit()
