"""Run inside browser-lab as its browser user. Stock, visible Wayland browsers.

Usage: python profile-swipes.py chrome http://HOST:4351 OUTPUT [adaptive,fixed]
Fast trackpad swipes against a baseline port. No GPU queries or finish calls during motion.
"""
import json
import os
import sys
import time
from pathlib import Path
from urllib.parse import urlencode

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
const s=document.querySelector('earthlight-explorer');return s&&s.dataset.focus==='sharp'&&s.dataset.assetPhase==='settled'&&s.dataset.exposure==='settled'&&['dayTiles','nightTiles','cloudTiles','terrainTiles','galaxyTiles'].every(k=>!s.dataset[k]||JSON.parse(s.dataset[k]).pending===0);
"""
TRACE = """
const done=arguments[arguments.length-1];(async()=>{
const s=document.querySelector('earthlight-explorer'),surface=s.closest('.explorer-view'),canvas=s.querySelector('canvas'),gl=canvas.getContext('webgl'),samples=[],uploads=[],long=[];
const bind=gl.bindFramebuffer,draw=gl.drawArrays,sub=gl.texSubImage2D,img=gl.texImage2D;let target=null;
gl.bindFramebuffer=function(k,t){target=t;return bind.call(this,k,t)};
gl.drawArrays=function(...a){const t=performance.now();const r=draw.apply(this,a);if(target===null)samples.push({t,ms:performance.now()-t,pos:s.dataset.cameraPosition});return r};
for(const [name,orig] of [['texSubImage2D',sub],['texImage2D',img]])gl[name]=function(...a){const t=performance.now(),r=orig.apply(this,a);uploads.push({t,ms:performance.now()-t,name,w:a.length===9?a[4]:a[6]?.width,h:a.length===9?a[5]:a[6]?.height});return r};
const observer=new PerformanceObserver(l=>long.push(...l.getEntries().map(e=>({t:e.startTime,ms:e.duration}))));observer.observe({type:'longtask',buffered:false});
const start=performance.now();let last=start,events=0;
await new Promise(resolve=>{function tick(t){if(t-start>18000){resolve();return;}if(t-last>=16){const delta=t-last;last=t;surface.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,clientX:innerWidth*.5,clientY:innerHeight*.6,deltaX:2.718*delta,deltaY:.222*delta}));events++;}requestAnimationFrame(tick)}requestAnimationFrame(tick)});
gl.bindFramebuffer=bind;gl.drawArrays=draw;gl.texSubImage2D=sub;gl.texImage2D=img;observer.disconnect();
const gaps=samples.slice(1).map((x,i)=>x.t-samples[i].t),sort=[...gaps].sort((a,b)=>a-b),q=p=>sort[Math.floor(sort.length*p)];return {elapsedMs:performance.now()-start,error:gl.getError(),events,frames:samples.length,median:q(.5),p95:q(.95),p99:q(.99),max:Math.max(...gaps),over100:gaps.filter(t=>t>100).length,long,uploads,samples,state:{...s.dataset},buffer:[canvas.width,canvas.height]};})().then(done,error=>done({error:String(error.stack)}));
"""
results={"browser":browser,"runs":[],"method":"18 seconds of synthetic DOM trackpad wheel input, time-scaled deltas on RAF; hardware GUI browser; final canvas submission cadence, no GPU waits"}
try:
 for quality in selected:
  for variant in os.environ.get('EARTHLIGHT_VARIANTS','baseline,candidate,candidate,baseline').split(','):
   restart_browser()
   params={"api":api,"quality":quality,"motion":"0","look-grain":"0","t":"1435.17","epoch":"2026-10-11T07:45:51.988Z","flight":"free","position":"-0.48260145,0.88247718,-0.35725092","orientation":"-0.1766052077,0.9644298534,0.1157268414,-0.1590375953"}
   url=(base.replace(':4355',':4357') if variant=='baseline' else base)+'/?'+urlencode(params)
   driver.get(url);started=time.monotonic()
   while not driver.execute_script(SETTLED):
    if time.monotonic()-started>180: raise RuntimeError('Settlement timeout '+json.dumps(driver.execute_script(STATE)))
    time.sleep(1)
   state=driver.execute_script(STATE)
   if browser=='chrome' and (not state['renderer'] or any(x in state['renderer'].lower() for x in ['llvmpipe','swiftshader','softpipe'])): raise RuntimeError('Software GPU '+str(state))
   driver.execute_script("document.querySelector('earthlight-explorer .explorer-motion').click()")
   print('START',quality,variant,state['renderer'],flush=True)
   trace=driver.execute_async_script(TRACE)
   if trace.get('error'): raise RuntimeError(str(trace['error']))
   row={"quality":quality,"variant":variant,"url":url,"before":state,"trace":trace}
   results['runs'].append(row);(output/'results.json').write_text(json.dumps(results,indent=2))
   driver.save_screenshot(str(output/f"{len(results['runs'])}-{quality}-{variant}.png"))
   print('RESULT',quality,variant,'fps',round(trace['frames']*1000/trace['elapsedMs'],2),'p95',trace['p95'],'p99',trace['p99'],'max',trace['max'],'over100',trace['over100'],'buffer',trace['buffer'],'scale',trace['state']['renderScale'],flush=True)
   assert trace['state']['assetFailures']=='0'
finally:
 if driver:
  try:
   if browser=='firefox':
    driver.get('about:support');time.sleep(3)
    (output/'firefox-support.txt').write_text(driver.find_element('tag name','body').text)
  finally: driver.quit()
