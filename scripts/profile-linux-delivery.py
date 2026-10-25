"""Measure normal animated playback without diagnostic mode or GPU queries.
Run through the browser-lab wrapper; --scenes fixed,adaptive selects quality.
Frame counts are CPU submissions, not proof of physical display presentation.
"""
import os,sys,json,time,statistics
from pathlib import Path
from urllib.parse import urlencode, urlsplit, urlunsplit, parse_qsl
from selenium import webdriver
from selenium.webdriver.support.ui import WebDriverWait
os.environ.update(XDG_RUNTIME_DIR='/run/browser-lab',WAYLAND_DISPLAY='wayland-0')
out=Path(sys.argv[3]);out.mkdir(parents=True,exist_ok=True)
BOOT="""
window.delivery={frames:[],longTasks:[],sizes:[],started:0};
for(const C of [WebGLRenderingContext,WebGL2RenderingContext]){
 const bind=C.prototype.bindFramebuffer,draw=C.prototype.drawArrays;const targets=new WeakMap();
 C.prototype.bindFramebuffer=function(k,v){if(k===this.FRAMEBUFFER||k===this.DRAW_FRAMEBUFFER)targets.set(this,v);return bind.call(this,k,v);};
 C.prototype.drawArrays=function(...args){const r=draw.apply(this,args);if(!targets.get(this))window.delivery.frames.push(performance.now());return r;};
}
new PerformanceObserver(list=>{for(const e of list.getEntries())delivery.longTasks.push({at:e.startTime,duration:e.duration});}).observe({type:'longtask',buffered:true});
"""
rows=[]
qualities=sys.argv[4].split(',') if len(sys.argv)>4 else ['fixed','adaptive']
assert all(q in ('fixed','adaptive') for q in qualities), 'Use --scenes fixed,adaptive'
for quality in qualities:
 label=quality
 options=webdriver.ChromeOptions()
 for a in ['--ozone-platform=wayland','--window-size=1280,800','--disable-dev-shm-usage','--remote-debugging-pipe']:options.add_argument(a)
 d=webdriver.Chrome(options=options)
 try:
  d.set_page_load_timeout(120);d.set_script_timeout(120)
  d.execute_cdp_cmd('Emulation.setDeviceMetricsOverride',{'width':1536,'height':738,'deviceScaleFactor':1.25,'mobile':False})
  d.execute_cdp_cmd('Page.addScriptToEvaluateOnNewDocument',{'source':BOOT})
  p={'api':'webgl2','quality':quality,'t':2488.1,'epoch':'2026-10-06T01:32:27Z'}
  u=urlsplit(sys.argv[2]);params=dict(p);params.update(parse_qsl(u.query));params['quality']=quality
  d.get(urlunsplit((u.scheme,u.netloc,u.path,urlencode(params),u.fragment)))
  WebDriverWait(d,120).until(lambda d:d.execute_script("return document.querySelector('earthlight-explorer')?.dataset.focus==='sharp'"))
  env=d.execute_script("const c=document.querySelector('canvas'),g=c.getContext('webgl2'),e=g.getExtension('WEBGL_debug_renderer_info');return {renderer:g.getParameter(e.UNMASKED_RENDERER_WEBGL),state:{...document.querySelector('earthlight-explorer').dataset},buffer:[c.width,c.height],firstFrame:delivery.frames[0]};")
  assert 'Intel' in env['renderer'],env
  measurement=d.execute_async_script("""
   const done=arguments[arguments.length-1];delivery.frames=[];delivery.longTasks=[];delivery.started=performance.now();
   const timer=setInterval(()=>{const e=document.querySelector('earthlight-explorer'),c=e.querySelector('canvas');delivery.sizes.push({at:performance.now(),buffer:[c.width,c.height],scale:e.dataset.renderScale,target:e.dataset.targetFps});},250);
   setTimeout(()=>{clearInterval(timer);done({...delivery,ended:performance.now(),finalState:{...document.querySelector('earthlight-explorer').dataset}});},45000);
  """)
  frames=measurement['frames'];gaps=[b-a for a,b in zip(frames,frames[1:])];sort=sorted(gaps)
  summary={'fps':len(frames)*1000/(measurement['ended']-measurement['started']),'gapP95':sort[int((len(sort)-1)*.95)] if sort else None,'gapMax':max(gaps,default=0),'gapsOver100':sum(x>100 for x in gaps),'buffer':measurement['sizes'][-1]['buffer'],'firstFrame':env['firstFrame']}
  rows.append({'label':label,'environment':env,'measurement':measurement,'summary':summary});(out/'results.json').write_text(json.dumps(rows,indent=2));d.save_screenshot(str(out/(label+'.png')))
  print(label,json.dumps(summary),flush=True)
 finally:d.quit()
