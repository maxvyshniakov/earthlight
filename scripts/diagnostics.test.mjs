import {test,expect} from 'bun:test';
import {runInNewContext} from 'node:vm';
import {diagnosticsBoot} from '../src/scripts/diagnostics-boot.ts';
import {diagnosticTestFrame,diagnosticTestPhase} from '../src/scripts/diagnostic-test.ts';
function fixture(search='?diagnostics=1&token=private'){
 let now=10;const listeners={},observations={},intervals=[],storage=new Map();
 const document={hidden:false,readyState:'loading',querySelector:()=>null,addEventListener:(name,fn)=>{listeners[name]=fn;}};
 const window={addEventListener:(name,fn)=>{listeners[name]=fn;}};
 const context={window,document,location:{search,origin:'https://example.test'},navigator:{userAgent:'test',hardwareConcurrency:8,language:'en'},
  performance:{now:()=>now,timeOrigin:123},innerWidth:1280,innerHeight:720,devicePixelRatio:1,URL,URLSearchParams,Date,
  sessionStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)},
  requestAnimationFrame:()=>1,setInterval:fn=>{intervals.push(fn);return 1;},clearInterval:()=>{},
  PerformanceObserver:class{constructor(fn){this.fn=fn;}observe({type}){observations[type]=entries=>this.fn({getEntries:()=>entries});}disconnect(){}},
 };
 runInNewContext(`(${diagnosticsBoot.toString()})({revision:'abc',dirty:false})`,context);
 return {recorder:window.earthlightDiagnostics,listeners,observations,storage,document,setTime:n=>now=n,flush:()=>intervals[0]()};
}
test('ordinary visits install no recorder, observers or listeners',()=>{
 const f=fixture('?perf=1');expect(f.recorder).toBeUndefined();expect(Object.keys(f.observations)).toHaveLength(0);expect(Object.keys(f.listeners)).toHaveLength(0);
});
test('report separates CPU/GPU/queues, captures stalls and never includes arbitrary query strings',()=>{
 const f=fixture(),r=f.recorder;r.frame(2);f.setTime(26);r.frame(3);f.setTime(226);r.frame(4);r.gpu(8);r.work('network',20,70);r.event('user-stutter');
 r.state({shaderStartup:'ready',firstLight:'loaded'});f.flush();const report=r.report();
 expect(report.windows[0].frameIntervals.max).toBe(200);expect(report.windows[0].cpuSubmissionMs.max).toBe(4);expect(report.windows[0].gpuMs.max).toBe(8);expect(report.windows[0].jobs.network.maxWaitMs).toBe(20);
 expect(report.milestones.firstFrame).toBe(10);expect(report.milestones['shaderStartup:ready']).toBe(226);expect(JSON.stringify(report)).not.toContain('private');
});
test('resource timing strips query data; visibility does not create a huge fake frame gap',()=>{
 const f=fixture();f.observations.resource([{name:'https://example.test/map.avif?token=secret',startTime:1,duration:10,responseStart:3,transferSize:20,encodedBodySize:20,decodedBodySize:20,initiatorType:'fetch'}]);
 f.recorder.frame(1);f.document.hidden=true;f.listeners.visibilitychange();f.setTime(60000);f.document.hidden=false;f.listeners.visibilitychange();f.recorder.frame(1);f.flush();
 expect(f.recorder.report().resources[0].path).toBe('/map.avif');expect(JSON.stringify(f.recorder.report())).not.toContain('secret');expect(f.recorder.report().windows.at(-1).frameIntervals).toBeNull();
});
test('history is bounded and intermediate reports survive without a renderer',()=>{
 const f=fixture();f.recorder.event('user-stutter');for(let i=0;i<510;i++)f.recorder.event('test');for(let i=0;i<905;i++){f.setTime(i*1000);f.flush();}
 const r=f.recorder.report();expect(r.markers).toHaveLength(1);expect(r.events.length).toBe(500);expect(r.windows.length).toBe(900);expect(r.dropped.windows).toBe(5);expect(r.dropped.events).toBeGreaterThan(0);expect(f.storage.size).toBe(1);const recovery=JSON.parse([...f.storage.values()][0]);expect(recovery.recoverySnapshot).toBe(true);expect(recovery.windows.length).toBe(90);
});
test('guided views are repeatable, finite, distinct and have a bounded end',()=>{
 for(const t of [0,19.9,20,39.9,40,59.9]){const a=diagnosticTestFrame(t),b=diagnosticTestFrame(t);expect(a).toEqual(b);expect(a.camera.every(Number.isFinite)).toBe(true);expect(a.focal).toBe(1.25);}
 expect(diagnosticTestFrame(60)).toBeNull();expect(diagnosticTestFrame(-1)).toBeNull();expect(diagnosticTestPhase(60)).toBe('free');expect(diagnosticTestFrame(0).camera).not.toEqual(diagnosticTestFrame(20).camera);
});

test('diagnostic GPU sampling is sparse, discards disjoint results and does not drive cadence quality',async()=>{
 const {SceneTimer}=await import('../src/scripts/scene-quality.ts');
 const previous=globalThis.window;let active=true,queries=0,disjoint=false;const samples=[];
 const recorder={get active(){return active;},environment(){},event(){},gpu:ms=>samples.push(ms)};
 globalThis.window={earthlightDiagnostics:recorder};
 const ext={TIME_ELAPSED_EXT:1,GPU_DISJOINT_EXT:2,QUERY_RESULT_AVAILABLE_EXT:3,QUERY_RESULT_EXT:4,
  createQueryEXT(){queries++;return {};},beginQueryEXT(){},endQueryEXT(){},deleteQueryEXT(){},getQueryObjectEXT:(_,key)=>key===3?true:100_000_000};
 const gl={getExtension:()=>ext,getParameter:()=>disjoint};
 const timer=new SceneTimer(gl);
 try{
  timer.observeAnimationFrame(1);
  for(let i=0;i<120;i++){timer.begin();for(const name of ['resources-and-lighting','source-attenuation','world','volumes','camera-finish'])timer.section(name);timer.end();}
  expect(queries).toBe(10);expect(samples.length).toBeGreaterThan(0);expect(timer.quality.scale).toBe(1);
  const count=samples.length;disjoint=true;timer.begin();timer.end();expect(samples.length).toBe(count);
  active=false;disjoint=false;timer.begin();timer.end();expect(queries).toBe(10);
 }finally{timer.dispose();if(previous===undefined)delete globalThis.window;else globalThis.window=previous;}
});


test('a synchronous first phase is not overwritten by the test button',()=>{
 const f=fixture();
 const element=()=>({children:[],append(...children){this.children.push(...children);},setAttribute(){},addEventListener(){},textContent:''});
 f.document.createElement=element;f.document.head=element();f.document.body=element();
 f.listeners.DOMContentLoaded();
 f.recorder.test=()=>{f.listeners['earthlight-diagnostic-phase']({detail:'day · 1/3'});return true;};
 f.document.body.children[0].children[1].onclick();f.setTime(1010);f.flush();
 expect(f.recorder.report().windows.at(-1).phase).toBe('day · 1/3');
});

test('GPU groups use one query per frame, wait for results, and discard invalid samples',async()=>{
 const {SceneTimer}=await import('../src/scripts/scene-quality.ts');
 const previous=globalThis.window,groups=[],deleted=new Set();let active=null,created=0,available=true,disjoint=false;
 globalThis.window={earthlightDiagnostics:{active:true,environment(){},event(){},gpu(){},gpuPasses:s=>groups.push(s)}};
 const ext={TIME_ELAPSED_EXT:1,GPU_DISJOINT_EXT:2,QUERY_RESULT_AVAILABLE_EXT:3,QUERY_RESULT_EXT:4,
  createQueryEXT:()=>({id:++created}),beginQueryEXT:(_,q)=>{expect(active).toBeNull();active=q;},endQueryEXT:()=>{expect(active).not.toBeNull();active=null;},
  deleteQueryEXT:q=>deleted.add(q.id),getQueryObjectEXT:(_,key)=>key===3?available:2_000_000};
 const timer=new SceneTimer({getExtension:()=>ext,getParameter:()=>disjoint});
 const frame=()=>{const before=created;timer.begin(1920,1080);for(const name of ['resources-and-lighting','source-attenuation','world','volumes','camera-finish'])timer.section(name);timer.end();expect(created-before).toBeLessThanOrEqual(1);};
 try{
  timer.observeAnimationFrame(1);
  for(let i=0;i<=12;i++)frame();
  available=false;frame();expect(groups).toHaveLength(0);
  available=true;frame();expect(groups).toHaveLength(1);
  expect(groups[0].buffer).toEqual([1920,1080]);expect(groups[0].passes).toEqual({sky:2});expect(timer.quality.scale).toBe(1);
  for(let i=15;i<=132;i++)frame();
  disjoint=true;frame();expect(groups).toHaveLength(5);
  disjoint=false;for(let i=134;i<280;i++)frame();
  expect(new Set(groups.flatMap(g=>Object.keys(g.passes))).size).toBe(6);
  expect(groups.every(g=>Object.keys(g.passes).length===1)).toBe(true);
  timer.dispose();expect(deleted.size).toBe(created);expect(active).toBeNull();
 }finally{timer.dispose();if(previous===undefined)delete globalThis.window;else globalThis.window=previous;}
});
