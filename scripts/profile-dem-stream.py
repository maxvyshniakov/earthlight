"""Run inside browser-lab as its browser user. Stock, visible Wayland browsers.

Usage: python profile-dem-stream.py chrome http://HOST:4351 OUTPUT [adaptive,fixed]
DEM90 streaming A/B/A/B comparison. No GPU queries or finish calls during motion.
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
selected = sys.argv[4].split(",") if len(sys.argv) > 4 else ["adaptive"]
if any(q not in ["adaptive", "fixed"] for q in selected):
    raise ValueError("Pass adaptive or fixed via the lab wrapper --scenes option")
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
const s=document.querySelector('earthlight-explorer'),c=s?.querySelector('canvas');
const g=c?.getContext('webgl')||c?.getContext('webgl2'),e=g?.getExtension('WEBGL_debug_renderer_info');
return {state:{...s?.dataset},width:c?.width,height:c?.height,
  viewport:[innerWidth,innerHeight,devicePixelRatio],visibility:document.visibilityState,
  renderer:e&&g.getParameter(e.UNMASKED_RENDERER_WEBGL),extensions:g?.getSupportedExtensions()};
"""
SETTLED = """
const s=document.querySelector('earthlight-explorer');return s&&s.dataset.focus==='sharp'&&
s.dataset.assetPhase==='settled'&&s.dataset.exposure==='settled'&&
Number(JSON.parse(s.dataset.terrainTiles||'{}').fineResident)>0&&
(!s.dataset.cloudLighting||s.dataset.cloudLighting!=='texture'||
 (s.dataset.cloudLightingReady==='1'&&s.dataset.cloudLightingProgress==='0'))&&
['dayTiles','nightTiles','cloudTiles','terrainTiles','galaxyTiles'].every(k=>
 !s.dataset[k]||JSON.parse(s.dataset[k]).pending===0);
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
    loading = []
    while time.monotonic() - started < 180:
        peak = max(peak, sum(p["rss"] for p in memory()))
        loading.append({"seconds":time.monotonic()-started,**driver.execute_script(STATE)})
        if driver.execute_script(SETTLED):
            state = driver.execute_script(STATE)
            if state["state"].get("assetFailures") != "0":
                raise RuntimeError("Asset failures: " + json.dumps(state))
            if not state.get("renderer") or any(x in state["renderer"].lower() for x in ["llvmpipe", "swiftshader", "softpipe"]):
                raise RuntimeError("Software or unknown renderer: " + json.dumps(state))
            return {"settledSeconds": time.monotonic() - started, "peakSampledRss": peak, "loading": loading, **state}
        time.sleep(1)
    raise RuntimeError("Settlement timeout: " + json.dumps(driver.execute_script(STATE)))


TRACE = """
const seconds=arguments[0],done=arguments[arguments.length-1];
const s=document.querySelector('earthlight-explorer'),c=s.querySelector('canvas'),g=c.getContext('webgl')||c.getContext('webgl2');
const priorErrors=[];for(let i=0;i<16;i++){const e=g.getError();if(!e)break;priorErrors.push(e);}
const draw=g.drawArrays,bind=g.bindFramebuffer,upload=g.texSubImage2D,activeTexture=g.activeTexture,useProgram=g.useProgram;
const frames=[],rafs=[],longTasks=[],uploads=[],states=[],draws=[],programs=new Map();
let program=g.getParameter(g.CURRENT_PROGRAM);
let target=g.getParameter(g.FRAMEBUFFER_BINDING),unit=g.getParameter(g.ACTIVE_TEXTURE),active=true;
const start=performance.now(),before={...s.dataset},canvasBefore=[c.width,c.height];
g.bindFramebuffer=function(k,v){target=v;return bind.call(this,k,v);};
g.activeTexture=function(v){unit=v;return activeTexture.call(this,v);};
g.useProgram=function(p){program=p;return useProgram.call(this,p);};
g.drawArrays=function(...a){if(!programs.has(program))programs.set(program,programs.size);const t=performance.now();draw.apply(this,a);draws.push({at:t-start,ms:performance.now()-t,program:programs.get(program),final:target===null});if(target===null)frames.push(performance.now()-start);};
g.texSubImage2D=function(...a){const t=performance.now();upload.apply(this,a);uploads.push({at:t-start,ms:performance.now()-t,unit:unit-g.TEXTURE0,x:a[2],y:a[3],width:a.length===9?a[4]:a[6].width,height:a.length===9?a[5]:a[6].height});};
const tick=t=>{if(active){rafs.push(t-start);requestAnimationFrame(tick);}};requestAnimationFrame(tick);
let observer;try{observer=new PerformanceObserver(l=>longTasks.push(...l.getEntries().map(e=>({at:e.startTime-start,ms:e.duration}))));observer.observe({entryTypes:['longtask']});}catch{}
const timer=setInterval(()=>states.push({at:performance.now()-start,terrain:s.dataset.terrainTiles,scale:s.dataset.renderScale,camera:s.dataset.cameraPosition,lighting:{ready:s.dataset.cloudLightingReady,progress:s.dataset.cloudLightingProgress,generation:s.dataset.cloudLightingGeneration,rows:s.dataset.cloudLightingRows,draws:s.dataset.cloudLightingDraws},canvas:[c.width,c.height]}),1000);
s.querySelector('.explorer-motion').click();
setTimeout(()=>{
 s.querySelector('.explorer-motion').click();active=false;clearInterval(timer);
 g.drawArrays=draw;g.bindFramebuffer=bind;g.texSubImage2D=upload;g.activeTexture=activeTexture;g.useProgram=useProgram;observer?.disconnect();
 window.demTracePrograms=[...programs.keys()];
 done({elapsedMs:performance.now()-start,frames,rafs,longTasks,uploads,states,draws,canvasBefore,canvasAfter:[c.width,c.height],before,after:{...s.dataset},error:g.getError(),priorErrors});
},seconds*1000);
"""
results={"browser":browser,"api":api,"runs":[],"method":"Fresh GUI browser per case; settled paused start, 24 seconds of motion at 10x; no GPU synchronization calls in trace"}
try:
    for quality in selected:
        for variant in os.environ.get("EARTHLIGHT_VARIANTS", "base,pool,packed,bake,all,base").split(","):
            mode='tile' if variant in ['tile','combined'] else 'strips'
            if variant not in ['strips','tile','cache','combined','base','pool','packed','bake','dem','all']: raise ValueError('Unknown variant: '+variant)
            cache='small' if variant in ['strips','tile'] else 'working'
            decoder='pool' if variant in ['pool','dem','all'] else 'single'
            source='packed' if variant in ['packed','dem','all'] else 'tiff'
            bake='budget' if variant in ['bake','all'] else 'fixed'
            params={"api":api,"render":"compact","motion":"0","quality":quality,
                    "t":"3235.65","pitch":"-25","epoch":"2026-10-06T01:32:27Z",
                    "look-grain":"0","exposure-mode":"manual","exposure-fixed":"0","terrainUpload":mode,"terrainCache":cache,"terrainDecoder":decoder,"terrainSource":source,"cloudBake":bake}
            state=navigate(params)
            print(quality,variant,"settled",round(state["settledSeconds"],2),"s",flush=True)
            terrain=json.loads(state["state"]["terrainTiles"])
            assert terrain["uploadMode"]==mode, terrain
            assert terrain["cacheMode"]==cache, terrain
            assert terrain["fineResident"]>0, terrain
            assert terrain["decoderMode"]==decoder and terrain["sourceMode"]==source, terrain
            assert state["state"]["cloudLightingBake"]==bake, state
            if source=="packed": assert terrain["packedDecodes"]>0 and terrain["packedFallbacks"]==0, terrain
            trace=driver.execute_async_script(TRACE,24)
            shader_probe = None
            if browser == "firefox":
                shader_probe = driver.execute_script("""
const g=document.querySelector('canvas').getContext('webgl'),errors=[],invalid=[];
for(const [i,p] of (window.demTracePrograms||[]).entries()){
 if(!g.isProgram(p))invalid.push(i);
 const shaders=g.getAttachedShaders(p);if(shaders)for(const shader of shaders)g.getShaderSource(shader);
 const error=g.getError();if(error)errors.push({program:i,error});
}
return {errors,invalid};
""")
                print("post-trace shader probe", shader_probe, flush=True)
            driver.save_screenshot(str(output / f"{len(results['runs'])}-{quality}-{variant}.png"))
            row={"quality":quality,"mode":mode,"variant":variant,"params":params,**state,"trace":trace,"shaderProbe":shader_probe,"memory":memory(),"demRequests":driver.execute_script("return performance.getEntriesByType('resource').filter(r=>(r.name.includes('/dem90/')||r.name.includes('/terrain-packed/'))).map(r=>({url:r.name,start:r.startTime,duration:r.duration,bytes:r.encodedBodySize,transfer:r.transferSize}));")}
            results["runs"].append(row)
            (output / "results.json").write_text(json.dumps(results,indent=2))
            assert not trace["priorErrors"] and trace["error"]==0, trace["error"]
            assert trace["after"]["assetFailures"]=="0"
            dem=[u for u in trace["uploads"] if u["unit"]==15 and u["width"]>1]
            gaps=sorted(b-a for a,b in zip(trace["frames"],trace["frames"][1:]))
            print(quality,variant,"fps",round(len(trace["frames"])*1000/trace["elapsedMs"],2),
                  "gap p95",round(gaps[int(len(gaps)*.95)],2),"max",round(max(gaps),2),
                  "DEM uploads",len(dem),"call ms",round(sum(u["ms"] for u in dem),2),
                  "max call",round(max((u["ms"] for u in dem),default=0),2),
                  "draw ms",round(sum(d["ms"] for d in trace["draws"]),2),
                  "fine end",json.loads(trace["after"]["terrainTiles"])["fineResident"],flush=True)
    results["capabilities"]=driver.capabilities
    if browser=="firefox":
        driver.get("about:support")
        time.sleep(2)
        (output / "firefox-support.txt").write_text(driver.find_element("tag name","body").text)
finally:
    (output / "results.json").write_text(json.dumps(results,indent=2))
    if driver: driver.quit()
