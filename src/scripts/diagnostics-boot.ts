import type {DiagnosticRecorder} from './scene-diagnostics';

/** Serialized into the document head: must not depend on module imports at runtime. */
export function diagnosticsBoot(build:Record<string,unknown>){
 if(new URLSearchParams(location.search).get('diagnostics')!=='1'||window.earthlightDiagnostics)return;
 const started=new Date().toISOString(),key='earthlight-diagnostic-report-v1';
 const events:{at:number;name:string;detail?:unknown}[]=[],windows:Record<string,unknown>[]=[],resources:Record<string,unknown>[]=[];
 const gpuPassSamples:{at:number;buffer:[number,number];passes:Record<string,number>}[]=[];let droppedGpuPassSamples=0;
 const markers:{at:number}[]=[];let droppedMarkers=0;
 const milestones:Record<string,number>={},environment:Record<string,unknown>={build,userAgent:navigator.userAgent,cores:navigator.hardwareConcurrency,language:navigator.language,gpuTimerSupported:null};
 const dropped={events:0,windows:0,resources:0};
 const limits={events:500,windows:900,resources:2000};
 let previous:string|null=null;
 try{previous=sessionStorage.getItem(key);}catch{/* storage can be disabled */}
 let lastFrame=0,lastTick=0,windowStart=performance.now(),frameCount=0,phase='startup';
 let frameGaps:number[]=[],rafGaps:number[]=[],cpu:number[]=[],gpu:number[]=[];
 let jobs:Record<string,{count:number;waitMs:number;durationMs:number;maxWaitMs:number;maxDurationMs:number}>={};
 let stopped=false;
 const round=(n:number)=>Math.round(n*100)/100;
 const summary=(values:number[])=>{
  const sorted=[...values].sort((a,b)=>a-b),n=sorted.length;
  return n?{count:n,p50:round(sorted[Math.floor((n-1)*.5)]),p95:round(sorted[Math.floor((n-1)*.95)]),p99:round(sorted[Math.floor((n-1)*.99)]),max:round(sorted[n-1]),over50:sorted.filter(x=>x>50).length,over100:sorted.filter(x=>x>100).length}:null;
 };
 const append=(kind:keyof typeof dropped,value:never)=>{
  const target=kind==='events'?events:kind==='windows'?windows:resources;
  if(target.length>=limits[kind]){target.shift();dropped[kind]++;}
  target.push(value);
 };
 const event=(name:string,detail?:unknown)=>{if(stopped)return;const at=round(performance.now());if(name==='user-stutter'){if(markers.length>=50){markers.shift();droppedMarkers++;}markers.push({at});}append('events',{at,name,detail} as never);};
 const mark=(name:string)=>{if(milestones[name]===undefined)milestones[name]=round(performance.now());};
 const state=(values:Record<string,string>)=>{
  for(const key of ['shaderStartup','firstLight','assetPhase','focus'])if(values[key])mark(`${key}:${values[key]}`);
 };
 // Only explicitly named scene settings, never arbitrary query values or auth URLs.
 const settings=()=>{
  const params=new URLSearchParams(location.search),safe:Record<string,string>={};
  for(const name of ['render','quality','api','night','clouds','orbit','epoch','t','motion','lens','yaw','pitch','startScale','cadence','headroom','scale']){
   const value=params.get(name);if(value!==null)safe[name]=value.slice(0,100);
  }return safe;
 };
 // Navigation entries predate this inline recorder. Copy numeric timings only:
 // name, referrer and serverTiming can contain authentication or private data.
 const navigation=()=>{
  const entry=performance.getEntriesByType?.('navigation')[0] as PerformanceNavigationTiming|undefined;
  if(!entry)return null;
  const timing:Record<string,number|string>={type:entry.type};
  for(const name of ['startTime','duration','redirectCount','redirectStart','redirectEnd','workerStart','fetchStart','domainLookupStart','domainLookupEnd','connectStart','secureConnectionStart','connectEnd','requestStart','responseStart','responseEnd','domInteractive','domContentLoadedEventStart','domContentLoadedEventEnd','domComplete','loadEventStart','loadEventEnd','transferSize','encodedBodySize','decodedBodySize'] as const){
   const value=entry[name];if(Number.isFinite(value))timing[name]=round(value);
  }
  return timing;
 };
 const paint=()=>performance.getEntriesByType?.('paint').filter(e=>e.name==='first-paint'||e.name==='first-contentful-paint').map(e=>({name:e.name,at:round(e.startTime)}))??[];
 const report=()=>({testProtocol:'guided-v1-60s',schema:'earthlight-diagnostics/v2',started,exported:new Date().toISOString(),timeOrigin:performance.timeOrigin,
  environment,navigation:navigation(),paint:paint(),settings:settings(),milestones,gpuPassSamples:[...gpuPassSamples],droppedGpuPassSamples,markers:[...markers],droppedMarkers,dropped,limits,events:[...events],windows:[...windows],resources:[...resources],
  notes:['Times are milliseconds since navigation. CPU submission is not GPU execution.','Frame intervals measure submissions, not confirmed screen presentation.','GPU fence ages end at a readiness poll; they include time before polling and are not GPU execution durations.','Decode queue duration includes upload lifetime; network queue duration includes body download.','GPU pass samples measure one rotating group per frame; never sum groups from different frames. Timestamp and buffer belong to submission, not result delivery.','Resource byte/timing fields may be unavailable across origins. Zero bytes do not prove a cache hit.','History is bounded; dropped counters indicate omitted records.']});
 const snapshot=()=>{
  const now=performance.now(),root=document.querySelector<HTMLElement>('earthlight-explorer'),canvas=root?.querySelector('canvas');
  if(root){state(root.dataset as Record<string,string>);if(root.hasAttribute('data-unavailable'))mark('unavailable');}
  const data:Record<string,string>={};
  for(const name of ['gpuQueuePolls','gpuQueueBlocked','gpuFenceLongestMs','renderProfile','renderScale','startScale','targetFps','refreshPeriodMs','qualityScale','viewScale','viewCoverage','focus','assetPhase','assetFailures','shaderStartup','shaderCompileMs','cameraPosition','cameraBasis','lens','cameraAltitude','flightMode','orbit','nightMode','cloudPass','cloudReuse','terrainTiles','dayTiles','nightTiles','cloudTiles','galaxyTiles']){
   const value=root?.dataset[name];if(value!==undefined)data[name]=value.slice(0,6000);
  }
  append('windows',{at:round(windowStart),durationMs:round(now-windowStart),phase,hidden:document.hidden,frames:frameCount,
   fps:round(frameCount*1000/Math.max(1,now-windowStart)),frameIntervals:summary(frameGaps),rafIntervals:summary(rafGaps),cpuSubmissionMs:summary(cpu),gpuMs:summary(gpu),jobs,
   viewport:[innerWidth,innerHeight,devicePixelRatio],buffer:canvas?[canvas.width,canvas.height]:null,paused:root?.hasAttribute('data-paused')??null,state:data} as never);
  windowStart=now;frameCount=0;frameGaps=[];rafGaps=[];cpu=[];gpu=[];jobs={};
 };
 // Recovery writes stay small even after a long run; full history is serialized
 // only when the user requests a download. Storage itself is synchronous.
 const save=()=>{try{const data=report();sessionStorage.setItem(key,JSON.stringify({...data,recoverySnapshot:true,windows:data.windows.slice(-90),resources:data.resources.slice(-200),events:data.events.slice(-100),gpuPassSamples:data.gpuPassSamples.slice(-60)}));}catch{/* downloading still works */}};
 const recorder:DiagnosticRecorder={get active(){return !stopped;},event,state,report,resetFrames(){lastFrame=0;},
  frame(ms){if(stopped)return;const now=performance.now();if(lastFrame&&frameGaps.length<1000)frameGaps.push(now-lastFrame);lastFrame=now;frameCount++;if(cpu.length<1000)cpu.push(ms);mark('firstFrame');if(phase==='startup')phase='free';},
  gpu(ms){if(!stopped&&gpu.length<1000&&Number.isFinite(ms))gpu.push(ms);},
  gpuPasses(sample){if(stopped)return;if(gpuPassSamples.length>=600){gpuPassSamples.shift();droppedGpuPassSamples++;}gpuPassSamples.push(sample);},
  work(kind,waitMs,durationMs){if(stopped)return;const v=jobs[kind]??={count:0,waitMs:0,durationMs:0,maxWaitMs:0,maxDurationMs:0};v.count++;v.waitMs+=waitMs;v.durationMs+=durationMs;v.maxWaitMs=Math.max(v.maxWaitMs,waitMs);v.maxDurationMs=Math.max(v.maxDurationMs,durationMs);},
  environment(values){Object.assign(environment,values);},
 };
 window.earthlightDiagnostics=recorder;mark('recorderStarted');event('recording-start');
 const observers:PerformanceObserver[]=[];
 const observe=(type:string,receive:(entry:PerformanceEntry)=>void)=>{
  try{const observer=new PerformanceObserver(list=>list.getEntries().forEach(receive));observer.observe({type,buffered:true});observers.push(observer);return true;}catch{return false;}
 };
 environment.resourceTiming=observe('resource',entry=>{
  const r=entry as PerformanceResourceTiming;let path:string;
  try{const u=new URL(r.name);if(u.origin!==location.origin&&!u.pathname.startsWith('/earthlight/'))return;path=u.pathname;}catch{return;}
  append('resources',{path,at:round(r.startTime),durationMs:round(r.duration),responseStart:r.responseStart,transferSize:r.transferSize,encodedBodySize:r.encodedBodySize,decodedBodySize:r.decodedBodySize,initiator:r.initiatorType} as never);
 });
 environment.longAnimationFrames=observe('long-animation-frame',entry=>{
  const e=entry as PerformanceEntry&{blockingDuration:number;renderStart:number;styleAndLayoutStart:number};
  event('long-animation-frame',{at:e.startTime,durationMs:e.duration,blockingMs:e.blockingDuration,renderStart:e.renderStart,styleAndLayoutStart:e.styleAndLayoutStart});
 });
 environment.longTasks=observe('longtask',e=>event('long-task',{at:e.startTime,durationMs:e.duration}));
 // No error messages/URLs: exceptions can include private query parameters.
 window.addEventListener('error',e=>event('error',{kind:e.error?.name??'resource',line:e.lineno,column:e.colno}),true);
 window.addEventListener('unhandledrejection',e=>event('unhandled-rejection',{kind:e.reason?.name??typeof e.reason}));
 document.addEventListener('visibilitychange',()=>{snapshot();lastFrame=lastTick=0;event('visibility',{hidden:document.hidden});if(document.hidden){recorder.cancelTest?.();save();}});
 document.addEventListener('webglcontextlost',()=>event('context-lost'),true);
 document.addEventListener('webglcontextrestored',()=>event('context-restored'),true);
 const tick=(now:number)=>{if(stopped)return;if(!document.hidden&&lastTick&&rafGaps.length<1000)rafGaps.push(now-lastTick);lastTick=now;requestAnimationFrame(tick);};requestAnimationFrame(tick);
 let count=0;
 const timer=setInterval(()=>{snapshot();if(++count%5===0)save();},1000);
 window.addEventListener('pagehide',()=>{recorder.cancelTest?.();snapshot();save();});
 const download=(text:string,suffix:string)=>{
  const url=URL.createObjectURL(new Blob([text],{type:'application/json'})),a=document.createElement('a');
  a.href=url;a.download=`earthlight-${started.replace(/[:.]/g,'-')}-${suffix}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 };
 const install=()=>{
  const panel=document.createElement('aside');panel.className='earthlight-diagnostics';panel.setAttribute('aria-label','Earthlight diagnostics');
  const style=document.createElement('style');style.textContent='.earthlight-diagnostics{position:fixed;top:12px;right:12px;z-index:1000;max-width:min(340px,calc(100vw - 24px));padding:12px;background:#16191ff2;color:#fff;border:1px solid #777;border-radius:8px;font:13px/1.5 system-ui;box-sizing:border-box}.earthlight-diagnostics p{margin:0 0 8px}.earthlight-diagnostics button{font:inherit;padding:7px 10px;margin:3px;border:1px solid #888;border-radius:4px;background:#292d35;color:#fff;cursor:pointer}.earthlight-diagnostics button:focus-visible{outline:2px solid white}.earthlight-diagnostics button:disabled{opacity:.5}';document.head.append(style);
  const status=document.createElement('p');status.textContent='Recording locally. Nothing is sent.';panel.append(status);
  const button=(label:string,action:()=>void)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=action;panel.append(b);return b;};
  const test=button('Run 60-second test',()=>{if(!recorder.test?.()){status.textContent='Wait for the scene to load, or for the current test to finish.';return;}event('test-start');status.textContent=`Test: ${phase}. Interacting with the scene cancels it.`;});
  button('It stuttered',()=>{event('user-stutter');save();status.textContent='Stutter marked. Continue or download the report.';});
  button('Download report',()=>{snapshot();save();download(JSON.stringify(report(),null,2),'report');});
  if(previous)button('Previous report',()=>download(previous!,'previous'));
  button('Stop recording',()=>{recorder.cancelTest?.();event('recording-stop');snapshot();save();stopped=true;clearInterval(timer);observers.forEach(o=>o.disconnect());test.disabled=true;status.textContent='Recording stopped. Your report is ready to download.';});
  window.addEventListener('earthlight-diagnostic-phase',e=>{snapshot();phase=(e as CustomEvent<string>).detail;event('test-phase',phase);status.textContent=phase==='free'?'Test finished. Explore freely or download the report.':`Test: ${phase}`;});
  for(const name of ['pointerdown','wheel','keydown'])panel.addEventListener(name,e=>e.stopPropagation());
  document.body.append(panel);
 };
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
}
