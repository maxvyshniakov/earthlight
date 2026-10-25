"""Capture the production diagnostic protocol in the hardware browser lab.

Invoke through proxmox/files/browser-lab/run.py, which owns serialization,
resource limits, artifact retrieval and shutdown. Uses a fresh Chrome profile;
the emulated viewport matches the Windows reports, not the virtual monitor.
This is an end-to-end adaptive run, not a fixed-resolution speedup benchmark.
"""
import json,os,sys,time
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.support.ui import WebDriverWait
os.environ.update(XDG_RUNTIME_DIR='/run/browser-lab',WAYLAND_DISPLAY='wayland-0')
if sys.argv[1]!='chrome':raise ValueError('This capture requires Chrome viewport emulation')
out=Path(sys.argv[3]);out.mkdir(parents=True,exist_ok=True)
options=webdriver.ChromeOptions()
for arg in ['--ozone-platform=wayland','--window-size=1280,800','--disable-dev-shm-usage','--remote-debugging-pipe']:options.add_argument(arg)
driver=webdriver.Chrome(options=options)
try:
 driver.set_page_load_timeout(120)
 driver.execute_cdp_cmd('Emulation.setDeviceMetricsOverride',{'width':1536,'height':738,'deviceScaleFactor':1.25,'mobile':False})
 driver.get(sys.argv[2].rstrip('/')+'/?diagnostics=1')
 wait=WebDriverWait(driver,120)
 wait.until(lambda d:d.execute_script("return !!window.earthlightDiagnostics&&document.querySelector('earthlight-explorer')?.hasAttribute('data-ready')"))
 env=driver.execute_script('return window.earthlightDiagnostics.report().environment')
 print(json.dumps({'ready':True,'environment':env}),flush=True)
 renderer=env.get('gpuRenderer','');assert 'Intel' in renderer and not any(x in renderer.lower() for x in ['swiftshader','llvmpipe','softpipe']),renderer
 driver.execute_script("document.querySelector('.earthlight-diagnostics button').click()")
 wait.until(lambda d:d.execute_script("return window.earthlightDiagnostics.report().events.some(e=>e.name==='test-phase'&&e.detail==='free')"))
 time.sleep(20)
 driver.execute_script("document.querySelector('.earthlight-diagnostics button:last-of-type').click()")
 report=driver.execute_script('return window.earthlightDiagnostics.report()')
 (out/'report.json').write_text(json.dumps(report,indent=2))
 phases={e.get('detail') for e in report['events'] if e['name']=='test-phase'}
 assert {'day · 1/3','surface · 2/3','night turn · 3/3','free'}<=phases,phases
 driver.save_screenshot(str(out/'scene.png'))
 (out/'conditions.json').write_text(json.dumps({'browser':driver.capabilities,'viewportOverride':[1536,738,1.25],'freshProfile':True,'url':sys.argv[2],'method':'GUI Chrome on Weston; same CSS viewport and DPR as Windows; virtual-output cadence is not a physical 144 Hz monitor'},indent=2))
 driver.get('chrome://gpu');time.sleep(2)
 (out/'chrome-gpu.txt').write_text(driver.find_element('tag name','body').text)
 print(json.dumps({'build':report['environment']['build'],'renderer':renderer,'windows':len(report['windows']),'gpuSamples':len(report.get('gpuPassSamples',[]))}),flush=True)
finally:driver.quit()
