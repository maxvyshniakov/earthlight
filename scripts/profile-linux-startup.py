"""Cold-profile and same-profile reload startup probe for the hardware lab.

Run through proxmox/files/browser-lab/run.py. Uses production rendering and
records GL submission spans without finish(), GPU timers or added GL queries
until the first scene is sharp. Completion timestamps are observed readiness,
not isolated compilation cost. Each run owns one fresh browser profile; a
fresh profile is not proof that OS/driver caches are empty. Sources are saved
with program IDs to identify expensive calls. The probe adds JS timing overhead
and does not measure screen presentation or reproduce Windows D3D11 on Linux.
"""
import os,sys,json,time
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.support.ui import WebDriverWait
os.environ.update(XDG_RUNTIME_DIR='/run/browser-lab',WAYLAND_DISPLAY='wayland-0')
out=Path(sys.argv[3]);out.mkdir(parents=True,exist_ok=True)
BOOT=r'''
window.startupProbe={programs:[],draws:[],slowCalls:[],firstFrame:null};
for(const C of [WebGLRenderingContext,WebGL2RenderingContext]){
 const programs=new WeakMap(),sources=new WeakMap(),active=new WeakMap(),targets=new WeakMap();
 for(const name of ['shaderSource','attachShader','linkProgram','getProgramParameter','useProgram','bindFramebuffer','drawArrays','getUniformLocation','getAttribLocation','getParameter','checkFramebufferStatus','texImage2D','texSubImage2D','generateMipmap']){
  const original=C.prototype[name];
  C.prototype[name]=function(...args){
   const before=performance.now(),result=original.apply(this,args),after=performance.now();
   if(name==='shaderSource')sources.set(args[0],args[1]);
   if(name==='attachShader'){
    let p=programs.get(args[0]);if(!p){p={id:startupProbe.programs.length,sources:[]};programs.set(args[0],p);startupProbe.programs.push(p);}
    p.sources.push(sources.get(args[1]));
   }
   if(name==='linkProgram'){const p=programs.get(args[0]);if(p){p.linkAt=before;p.linkReturn=after;}}
   if(name==='getProgramParameter'&&args[1]===0x91B1&&result){const p=programs.get(args[0]);if(p&&p.ready===undefined)p.ready=after;}
   if(name==='useProgram')active.set(this,programs.get(args[0])?.id);
   if(name==='bindFramebuffer'&&(args[0]===this.FRAMEBUFFER||args[0]===this.DRAW_FRAMEBUFFER))targets.set(this,args[1]);
   if(name==='drawArrays'&&startupProbe.draws.length<60){startupProbe.draws.push({at:before,ms:after-before,program:active.get(this),screen:!targets.get(this)});if(!targets.get(this)&&startupProbe.firstFrame===null)startupProbe.firstFrame=after;}
   if(after-before>10&&startupProbe.slowCalls.length<100)startupProbe.slowCalls.push({name,at:before,ms:after-before,program:active.get(this)});
   return result;
  };
 }
}
'''
rows=[]
for label in ['startup']:
 options=webdriver.ChromeOptions()
 for a in ['--ozone-platform=wayland','--window-size=1280,800','--disable-dev-shm-usage','--remote-debugging-pipe']:options.add_argument(a)
 d=webdriver.Chrome(options=options)
 try:
  d.set_page_load_timeout(180);d.set_script_timeout(180)
  d.execute_cdp_cmd('Emulation.setDeviceMetricsOverride',{'width':1536,'height':738,'deviceScaleFactor':1.25,'mobile':False})
  d.execute_cdp_cmd('Page.addScriptToEvaluateOnNewDocument',{'source':BOOT})
  for cache in ['fresh-profile','reload']:
   if cache=='reload':d.refresh()
   else:d.get(sys.argv[2].rstrip('/')+'/?api=webgl2&t=1000&epoch=2026-10-06T01%3A32%3A27Z')
   WebDriverWait(d,180).until(lambda d:d.execute_script("return document.querySelector('earthlight-explorer')?.dataset.focus==='sharp'"))
   row=d.execute_script("const s=document.querySelector('earthlight-explorer'),c=s.querySelector('canvas'),g=c.getContext('webgl2'),e=g.getExtension('WEBGL_debug_renderer_info');return {...startupProbe,state:{...s.dataset},renderer:g.getParameter(e.UNMASKED_RENDERER_WEBGL),buffer:[c.width,c.height]};")
   assert 'Intel' in row['renderer'],row['renderer']
   row.update(label=label,cache=cache);rows.append(row)
   (out/'results.json').write_text(json.dumps(rows,indent=2))
   print(label,cache,'first',row['firstFrame'],'compile',row['state'].get('shaderCompileMs'),'slow',row['slowCalls'],flush=True)
 finally:d.quit()
