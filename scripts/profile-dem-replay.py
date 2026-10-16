"""Run inside browser-lab as its browser user. Stock, visible Wayland browsers.

Usage: python profile-dem-replay.py chrome http://HOST:4351 OUTPUT
Repeat identical DEM bytes on a paused scene to isolate upload cost.
The initial framebuffer readback is excluded from measured samples.
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


REPLAY = """
const mode=arguments[0],done=arguments[arguments.length-1];
(async()=>{
 const s=document.querySelector('earthlight-explorer'),g=s.querySelector('canvas').getContext('webgl');
 // Texture unit 15 is reused by cloud lighting AFTER the terrain draw.
 // Capture its terrain binding at the owning draw, not after the frame.
 let texture,layout;const native=g.drawArrays;
 await new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>{g.drawArrays=native;reject(Error('Terrain draw not found'));},10000);
  g.drawArrays=function(...args){
   const p=g.getParameter(g.CURRENT_PROGRAM),loc=g.getUniformLocation(p,'terrainTileLayout');
   if(loc){layout=g.getUniform(p,loc);if(layout[0]>0){
    const unit=g.getParameter(g.ACTIVE_TEXTURE);g.activeTexture(g.TEXTURE15);texture=g.getParameter(g.TEXTURE_BINDING_2D);g.activeTexture(unit);
    g.drawArrays=native;clearTimeout(timeout);resolve();
   }}
   return native.apply(this,args);
  };
  s.querySelector('.explorer-track input').dispatchEvent(new Event('input'));
 });
 const previousUnit=g.getParameter(g.ACTIVE_TEXTURE),previousTarget=g.getParameter(g.FRAMEBUFFER_BINDING);
 g.activeTexture(g.TEXTURE15);const fb=g.createFramebuffer();
 g.bindFramebuffer(g.FRAMEBUFFER,fb);g.framebufferTexture2D(g.FRAMEBUFFER,g.COLOR_ATTACHMENT0,g.TEXTURE_2D,texture,0);
 if(g.checkFramebufferStatus(g.FRAMEBUFFER)!==g.FRAMEBUFFER_COMPLETE)throw Error('Atlas readback unavailable');
 const page=new Uint8Array(800*360*4);g.readPixels(0,0,800,360,g.RGBA,g.UNSIGNED_BYTE,page);
 let slot=0;for(let y=0;y<360&&!slot;y++)for(let x=0;x<720;x++){const p=(y*800+x)*4;if(page[p]>0&&page[p+1]===255){slot=page[p];break;}}
 if(!slot)throw Error('No fully loaded fine terrain tile');
 const columns=layout[1],cell=632,x=slot%columns*cell,y=Math.floor(slot/columns)*cell,packed=new Uint8Array(cell*cell*2*4);
 g.readPixels(x,y,cell*2,cell,g.RGBA,g.UNSIGNED_BYTE,packed);
 g.bindFramebuffer(g.FRAMEBUFFER,previousTarget);g.deleteFramebuffer(fb);g.activeTexture(previousUnit);
 if(g.getError())throw Error('Atlas readback failed');
 const strips=[];for(let half=0;half<2;half++)for(let row=0;row<cell;row+=64){const height=Math.min(64,cell-row),data=new Uint8Array(cell*height*4);for(let i=0;i<height;i++)data.set(packed.subarray(((row+i)*cell*2+half*cell)*4,((row+i)*cell*2+half*cell+cell)*4),i*cell*4);strips.push({x:x+half*cell,y:y+row,width:cell,height,data});}
 const originalDraw=g.drawArrays,originalBind=g.bindFramebuffer,frames=[],draws=[],uploads=[];let target=previousTarget;
 const start=performance.now();
 g.bindFramebuffer=function(k,v){target=v;return originalBind.call(this,k,v);};
 g.drawArrays=function(...a){const t=performance.now();originalDraw.apply(this,a);draws.push({at:t-start,ms:performance.now()-t});if(target===null)frames.push(performance.now()-start);};
 const input=s.querySelector('.explorer-track input'),drawTimer=setInterval(()=>input.dispatchEvent(new Event('input')),1000/24);
 const delay=ms=>new Promise(r=>setTimeout(r,ms));
 const upload=(x,y,width,height,data)=>{g.activeTexture(g.TEXTURE15);g.bindTexture(g.TEXTURE_2D,texture);const t=performance.now();g.texSubImage2D(g.TEXTURE_2D,0,x,y,width,height,g.RGBA,g.UNSIGNED_BYTE,data);uploads.push({at:t-start,ms:performance.now()-t,width,height});};
 try{
  for(let i=0;i<20;i++){
   await delay(Math.max(0,start+(i+1)*1000-performance.now()));
   if(mode==='tile')upload(x,y,cell*2,cell,packed);
   if(mode==='strips')for(const strip of strips){await delay(0);upload(strip.x,strip.y,strip.width,strip.height,strip.data);}
  }
 }finally{clearInterval(drawTimer);g.drawArrays=originalDraw;g.bindFramebuffer=originalBind;}
 return {mode,slot,x,y,terrain:s.dataset.terrainTiles,elapsedMs:performance.now()-start,frames,draws,uploads,state:{...s.dataset},error:g.getError()};
})().then(done,e=>done({error:String(e.stack??e)}));
"""
results={"browser":browser,"runs":[],"method":"Same paused view; replay identical bytes into a loaded DEM slot once per second for 20 s while invalidating at 24 Hz. Initial atlas readback is outside measurement. No geometry changes."}
try:
    for mode in os.environ.get("EARTHLIGHT_VARIANTS","none,strips,tile,none").split(","):
        state=navigate({"api":"webgl","render":"compact","quality":"fixed","motion":"0","t":"3235.65","pitch":"-25","epoch":"2026-10-06T01:32:27Z","look-grain":"0","exposure-mode":"manual","exposure-fixed":"0","terrainUpload":"tile"})
        driver.execute_script("document.querySelector('.explorer-track input').dispatchEvent(new Event('input'))")
        started=time.monotonic()
        while not driver.execute_script(SETTLED):
            if time.monotonic()-started>180: raise RuntimeError('Replay priming timeout')
            time.sleep(1)
        time.sleep(2)
        trace=driver.execute_async_script(REPLAY,mode)
        results["runs"].append({"mode":mode,**state,"trace":trace})
        (output / "results.json").write_text(json.dumps(results,indent=2))
        if trace["error"]: raise RuntimeError(trace["error"])
        gaps=sorted(b-a for a,b in zip(trace["frames"],trace["frames"][1:]))
        print(mode,"fps",round(len(trace["frames"])*1000/trace["elapsedMs"],2),"p95",round(gaps[int(len(gaps)*.95)],1),"max gap",round(max(gaps),1),"upload ms",round(sum(u["ms"] for u in trace["uploads"]),1),"draw ms",round(sum(d["ms"] for d in trace["draws"]),1),flush=True)
finally:
    (output / "results.json").write_text(json.dumps(results,indent=2))
    if driver: driver.quit()
