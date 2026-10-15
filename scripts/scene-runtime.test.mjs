import {SceneFrameClock} from '../src/scripts/scene-frame-clock.ts';
import {PointReflections} from '../src/scripts/point-reflections.ts';
import {draggedCamera} from '../src/scripts/orbit-camera-drag.ts';
import {test} from 'bun:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {SceneAssets,SceneFocus,sceneAssetPlan} from '../src/scripts/scene-assets.ts';
import {SceneWork,scenePriority} from '../src/scripts/scene-work.ts';
import {SceneQuality} from '../src/scripts/scene-quality.ts';
import {focusRenderScale,sceneComposition,sceneBufferSize,compactSurfaceOverview} from '../src/scripts/scene-viewport.ts';
import {poissonQuantiles,POISSON_COLUMNS,POISSON_ROWS} from '../src/scripts/sensor-noise.ts';
import {decodeTerrain} from '../src/scripts/earth-terrain.ts';
import {cameraProgram,EXPOSURE_MAX_EV} from '../src/scripts/camera-model.ts';
import {auroraInView,magneticNorth} from '../src/scripts/aurora.ts';
import {issFrame,cross,normalize,dot} from '../src/scripts/iss-orbit.ts';
import {stormPulse,stormLights,stormEpisode,MAX_STORM_LIGHTS} from '../src/scripts/storm-light.ts';
import {sceneProfile} from '../src/scripts/scene-profile.ts';
import {stormRegions} from '../src/scripts/storm-regions.ts';
import sharp from 'sharp';

test('lightning conserves sub-frame pulse energy at all playback speeds',()=>{
 for(const fps of [18,24])for(const rate of [.25,1,10,120]){
   const window=rate/fps;
   let integral=0;
   for(let t=-window;t<1+window;t+=window)integral+=stormPulse(t,.173,.09,window)*window;
   assert.ok(Math.abs(integral-.045)<1e-10,`pulse energy at ${rate}x`);
 }
 assert.equal(stormPulse(4,0,.09,1/24),0);
});
test('compact is the default and malformed render links retain it',()=>{
 for(const query of ['', 'render=unknown', 'render=constructor', 'render=__proto__'])assert.equal(sceneProfile(new URLSearchParams(query)).name,'compact');
 for(const name of ['balanced','eco'])assert.equal(sceneProfile(new URLSearchParams({render:name})).name,'compact');
});
test('storm regions select sparse dense cloud complexes, with neighbouring cells',async()=>{
 const {data,info}=await sharp('public/media/orbit/earth-clouds-nasa-4096.avif').removeAlpha().raw().toBuffer({resolveWithObject:true});
 assert.equal(stormRegions.length,64);
 for(const group of stormRegions){
  assert.ok(group.length>=3&&group.length<=5);
  for(const p of group){
   const x=Math.floor((Math.atan2(p[1],p[0])/(2*Math.PI)+.5)*info.width)%info.width;
   const y=Math.floor((.5-Math.asin(p[2])/Math.PI)*info.height);
   assert.ok(data[(y*info.width+x)*info.channels]/255>=.77,'actual atlas contains a dense cloud at every source');
   assert.ok(Math.hypot(...p.map((v,i)=>v-group[0][i]))*6371<160,'cells remain in their cloud complex');
  }
 }
});
test('storm episodes revisit neighbouring cells and include quiet intervals and varied strokes',()=>{
 let quiet=0,active=0,multiple=0;
 const patterns=new Set();
 for(let id=0;id<stormRegions.length;id++)for(let cycle=0;cycle<100;cycle++){
  const episode=stormEpisode(id,cycle);
  assert.deepEqual(stormEpisode(id,cycle),episode);
  if(!episode.length){quiet++;continue;}active++;
  for(const [i,event] of episode.entries()){
   assert.ok(event.cell>=0&&event.cell<stormRegions[id].length);
   assert.ok(event.strokes.length>=1&&event.strokes.length<=4);
   if(event.strokes.length>1)multiple++;
   patterns.add(event.strokes.length);
   for(let k=1;k<event.strokes.length;k++){
    const previous=event.strokes[k-1];
    const gap=event.strokes[k].start-previous.start-previous.width;
    assert.ok(gap>=.0249&&gap<=.1151,'strokes have short dark gaps');
   }
   if(i)assert.ok(event.strokes[0].start-episode[i-1].strokes[0].start>=.79,'neighbours flash separately, not as one deck');
  }
 }
 assert.ok(quiet>active*.25&&quiet<active,'some dense complexes are quiet');
 assert.ok(multiple>active*.5);assert.equal(patterns.size,4);
});
test('storm source timeline is repeatable across camera culling and reverse seeks',()=>{
 for(const t of [-100,0,71,610.87,1122.38,5400])for(const rate of [.25,10,120,-10]){
  const frame=issFrame(t),before=stormLights(t,rate,frame.camera,frame.cameraBasis,1.6);
  const away=issFrame(t+900,.138,{yaw:180,pitch:-45});
  stormLights(t+900,rate,away.camera,away.cameraBasis,1.6);
  assert.deepEqual(stormLights(t,rate,frame.camera,frame.cameraBasis,1.6),before);
 }
});
test('storm lighting is bounded and reproduces paused frames after seeking',()=>{
 const n=stormRegions[0][0],right=normalize(cross(n,[0,0,1])),up=cross(right,n);
 const frame={camera:n.map(v=>v*1.08),cameraBasis:[...right,...up,...n.map(v=>-v)]},sources=stormLights(1122.38,10,frame.camera,frame.cameraBasis,1.6);
 stormLights(3300,120,frame.camera,frame.cameraBasis,1.6);
 assert.deepEqual(stormLights(1122.38,10,frame.camera,frame.cameraBasis,1.6),sources);
 assert.equal(sources.length,MAX_STORM_LIGHTS*4);
 let seen=0;
 for(let t=0;t<600;t+=.25){
   const lights=stormLights(t,10,frame.camera,frame.cameraBasis,1.6);
   for(let i=0;i<lights.length;i+=4){
     assert.ok(Number.isFinite(lights[i+3])&&lights[i+3]>=0);
     if(lights[i+3]>0){seen++;assert.ok(Math.abs(Math.hypot(...lights.slice(i,i+3))-(1+3.6/6371))<1e-6);}
   }
 }
 assert.ok(seen>0,'visible storms occur without camera-triggered events');
});

test('camera program preserves metered brightness while separating photons from ISO gain',()=>{
 let previous=cameraProgram(-5.5);
 for(let ev=-5.5;ev<=EXPOSURE_MAX_EV;ev+=.01){
  const camera=cameraProgram(ev);
  assert.ok(Math.abs(camera.opticalGain*camera.isoGain-2**(ev-.5))<1e-10);
  assert.ok(Math.abs(camera.opticalGain-(4/camera.fNumber)**2)<1e-10);
  assert.ok(camera.fNumber<=previous.fNumber&&camera.iso>=previous.iso);
  assert.equal(camera.shutterSeconds,1/48);
  previous=camera;
 }
 assert.deepEqual(cameraProgram(-10),cameraProgram(-5.5));
 assert.deepEqual(cameraProgram(100),cameraProgram(EXPOSURE_MAX_EV));
 assert.equal(cameraProgram(EXPOSURE_MAX_EV).fNumber,cameraProgram(3.1).fNumber);
 assert.ok(Math.abs(cameraProgram(EXPOSURE_MAX_EV).iso/cameraProgram(EXPOSURE_MAX_EV-1).iso-2)<1e-9);
 assert.equal(cameraProgram(-5.5).fNumber,16);
 assert.equal(cameraProgram(-5.5).iso,100);
 assert.equal(cameraProgram(3.1).fNumber,cameraProgram(1.6).fNumber);
 assert.ok(cameraProgram(3.1).iso>cameraProgram(1.6).iso*2.8);
 assert.ok(cameraProgram(1.6).fNumber>3.1&&cameraProgram(1.6).fNumber<3.3);
});

test('stable mobile framing preserves the opening horizon and hides Earth at 0.75 small viewports',()=>{
 const small=741,large=821;
 const opening=sceneComposition(0,small,large,true);
 assert.ok(Math.abs((1-opening.limb)*large-small*.78)<1e-9);
 const hidden=sceneComposition(small*.75,small,large,true);
 assert.equal(hidden.limb,opening.limb);assert.ok(hidden.altitudeLift>1000);assert.equal(hidden.offset,90);
 const middle=sceneComposition(150,small,large,true);
 assert.equal(middle.limb,opening.limb);assert.ok(middle.altitudeLift>0&&middle.altitudeLift<hidden.altitudeLift);
 assert.equal(opening.altitudeLift,0);
 assert.equal(sceneComposition(1000,small,large,false).altitudeLift,0);
 assert.ok(Math.abs(sceneComposition(0,966,966,true).limb-.22)<1e-9);
 assert.equal(sceneComposition(-30,small,large,true).offset,0);
});

test('render sizing keeps pixel budget and aspect ratio across rotation and quality changes',()=>{
 for(const [w,h] of [[395,821],[821,395],[3840,2160]]){
  const full=sceneBufferSize(w,h,3.4,1),reduced=sceneBufferSize(w,h,3.4,.6);
  assert.ok(full.width*full.height<1_802_000);
  assert.ok(Math.abs(full.width/full.height-w/h)<.003);
  assert.ok(reduced.width<full.width&&reduced.height<full.height);
 }
});
test('compact surface tier follows actual capped render pixels and requires fine tiles',()=>{
 const phone=sceneBufferSize(395,821,3.4,1);
 assert.equal(compactSurfaceOverview(phone.width,phone.height,true),true);
 assert.equal(compactSurfaceOverview(phone.height,phone.width,true),true);
 assert.equal(compactSurfaceOverview(phone.width,phone.height,false),false);
 const desktop=sceneBufferSize(1440,966,2,1);
 assert.equal(compactSurfaceOverview(desktop.width,desktop.height,true),false);
 const plan=sceneAssetPlan(false,4096,true,false,true).filter(x=>!x.preview);
 assert.ok(plan.find(x=>x.key==='day').url.endsWith('/mobile/day-2048.avif'));
 assert.ok(plan.find(x=>x.key==='clouds').url.endsWith('4096.avif'));
 assert.ok(plan.find(x=>x.key==='night').url.endsWith('/earth-night.avif'));
 assert.ok(plan.find(x=>x.key==='galaxy').url.endsWith('/milky-way.avif'));
});

test('terrain predictor preserves every elevation, coast mask and mip byte',()=>{
 for(const width of [4096,8192]){
  const read=suffix=>{const b=gunzipSync(readFileSync(new URL(`../public/media/orbit/earth-terrain-${width}${suffix}.dem`,import.meta.url)));return decodeTerrain(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));};
  const old=read(''),next=read('-v2');
  assert.equal(next.levels.length,old.levels.length);
  old.levels.forEach((level,i)=>assert.deepEqual(next.levels[i].data,level.data));
 }
});
test('sensor quantiles preserve dark shot-noise mean and variance without an iterative shader',()=>{
 const values=poissonQuantiles();
 for(const expected of [0,.01,.1,1,4,8,15.9]){
  const row=Math.round(Math.sqrt(expected/16)*(POISSON_ROWS-1));
  const samples=values.subarray(row*POISSON_COLUMNS,(row+1)*POISSON_COLUMNS);
  const mean=samples.reduce((s,x)=>s+x,0)/samples.length;
  const variance=samples.reduce((s,x)=>s+(x-mean)**2,0)/samples.length;
  assert.ok(Math.abs(mean-expected)<.02,`${expected}: mean ${mean}`);
  assert.ok(Math.abs(variance-expected)<.04,`${expected}: variance ${variance}`);
 }
});
test('focus settles for both successful detail and failed/slow detail, without refocusing',()=>{
 for(const success of [true,false]){
  const focus=new SceneFocus();assert.equal(focus.value(0,true,false,false),6);
  assert.equal(focus.value(100,true,success,success),6);
  const release=success?500:6000;
  assert.equal(focus.value(release,true,success,success),6);
  const middle=focus.value(release+650,true,false,false);assert.ok(middle>0&&middle<6);
  assert.equal(focus.value(release+1300,true,false,false),0);
  assert.equal(focus.value(release+15000,true,false,false),0);
 }
});
test('adaptive quality ignores invalid samples and uses cooldown instead of oscillating',()=>{
 const quality=new SceneQuality();
 for(const sample of [NaN,Infinity,-1,1000])quality.observe(sample,0);
 assert.equal(quality.scale,1);
 for(let i=0;i<12;i++)quality.observe(40,1000);
 assert.equal(quality.scale,.9);
 for(let i=0;i<100;i++)quality.observe(60,2000);
 assert.equal(quality.scale,.9);
 for(let i=0;i<12;i++)quality.observe(10,7000);
 assert.ok(Math.abs(quality.scale-.95)<1e-9);
});
test('cadence fallback tolerates 24 FPS quantization and isolated stalls, then reduces sustained overload',()=>{
 const quality=new SceneQuality();let now=0;
 // Establish stable delivery first, including one isolated startup stall.
 for(let i=0;i<144;i++){
  const interval=i===10?180:i%2?50:1000/30;
  now+=interval;quality.observeCadence(interval,now);
 }
 assert.equal(quality.scale,1);
 quality.resetCadence(); // Start an established-mode window without earlier mixed samples.
 for(let i=0;i<48;i++){now+=50;quality.observeCadence(50,now);}
 assert.equal(quality.scale,.9);
 for(let i=0;i<12;i++){now+=100;quality.observeCadence(100,now);}
 assert.equal(quality.scale,.9,'The established-mode cooldown prevents repeated reductions');
 for(let i=0;i<120;i++){now+=1000/24;quality.observeCadence(1000/24,now);}
 assert.equal(quality.scale,.9,'Recovery requires its own stable observation period');
 for(let i=0;i<800;i++){now+=80;quality.observeCadence(80,now);}
 assert.ok(Math.abs(quality.scale-.45)<1e-9);
});
test('severe mobile GPU and cadence stalls trigger bounded recovery instead of being discarded',()=>{
 const gpu=new SceneQuality();
 for(let i=0;i<6;i++)gpu.observe(320,1000);
 assert.equal(gpu.scale,.45);
 const cadence=new SceneQuality();
 for(let i=0;i<6;i++)cadence.observeCadence(400,1000);
 assert.equal(cadence.scale,.45);
 for(let i=0;i<12;i++)gpu.observe(12,3000);
 assert.equal(gpu.scale,.5);
});
test('save-data uses only small previews and the two compact sky inputs',()=>{
 const plan=sceneAssetPlan(true,16384,true,true);
 assert.ok(plan.every(x=>x.preview));assert.ok(!plan.some(x=>x.key==='terrain'));
});
test('a failed refinement keeps the preview, other layers progress, and context restore uses compressed inputs',async()=>{
 const previous=globalThis.fetch,warning=console.warn;
 const seen=[];
 globalThis.fetch=async url=>new Response(url==='bad'?'bad':'image');console.warn=()=>{};
 const uploads=[];
 const assets=new SceneAssets([{key:'day',url:'preview',preview:true},{key:'day',url:'bad'},{key:'galaxy',url:'galaxy'}],async(a,b)=>{
  seen.push(a.url);if(await b.text()==='bad')throw Error('corrupt decode');uploads.push(a.url);
 },()=>{});
 try{
  await assets.start();assert.equal(assets.settled,true);assert.equal(assets.previewSettled,true);
  assert.deepEqual(assets.failures,['bad']);assert.ok(uploads.includes('galaxy'));
  assets.suspend();await assets.restore();assert.deepEqual(uploads.slice(-2),['preview','galaxy']);
  assets.dispose();assert.equal(assets.bytes,0);
 }finally{assets.dispose();globalThis.fetch=previous;console.warn=warning;}
});
test('viewport upgrade loads once, keeps focus settled and restores the upgraded input',async()=>{
 const previous=globalThis.fetch,requests=[],uploads=[];
 globalThis.fetch=async url=>{requests.push(url);return new Response(url);};
 const assets=new SceneAssets([{key:'day',url:'small'}],async a=>{uploads.push(a.url);},()=>{});
 try{
  await assets.start();
  await Promise.all([assets.refine({key:'day',url:'large'}),assets.refine({key:'day',url:'large'})]);
  assert.deepEqual(requests,['small','large']);assert.equal(assets.settled,true);
  assets.suspend();await assets.restore();assert.deepEqual(uploads,['small','large','large']);
 }finally{assets.dispose();globalThis.fetch=previous;}
});

test('refinement concurrency is bounded and disposal aborts pending fetches',async()=>{
 const previous=globalThis.fetch;
 let active=0,peak=0;const requests=[];
 globalThis.fetch=async(url,options)=>new Promise((resolve,reject)=>{
  active++;peak=Math.max(active,peak);
  requests.push({url,signal:options.signal,resolve:()=>{active--;resolve(new Response('image'));}});
  options.signal.addEventListener('abort',()=>{active--;reject(Error('aborted'));},{once:true});
 });
 const assets=new SceneAssets(['day','night','clouds','galaxy'].map(key=>({key,url:key})),async()=>{},()=>{});
 try{
  const started=assets.start();await new Promise(setImmediate);
  assert.equal(requests.length,2);requests[0].resolve();await new Promise(setImmediate);
  assert.equal(requests.length,3);assert.equal(peak,2);
  assets.dispose();await started;assert.ok(requests.slice(1).every(x=>x.signal.aborted));assert.equal(assets.bytes,0);
 }finally{assets.dispose();globalThis.fetch=previous;}
});
test('a corrupt refinement received while context is lost cannot overwrite the working preview',async()=>{
 const previous=globalThis.fetch,warning=console.warn;
 let release;const uploads=[];
 globalThis.fetch=async url=>url==='detail'?new Promise(resolve=>{release=()=>resolve(new Response('bad'));}):new Response('good');
 console.warn=()=>{};
 const assets=new SceneAssets([{key:'day',url:'preview',preview:true},{key:'day',url:'detail'}],async(a,b)=>{if(await b.text()==='bad')throw Error('bad');uploads.push(a.url);},()=>{});
 try{
  const started=assets.start();await new Promise(setImmediate);assets.suspend();release();await started;
  await assets.restore();assert.deepEqual(uploads,['preview','preview']);assert.deepEqual(assets.failures,['detail']);
  assets.suspend();await assets.restore();assert.equal(uploads.at(-1),'preview');
 }finally{assets.dispose();globalThis.fetch=previous;console.warn=warning;}
});

test('a decode crossing context restoration retries against the restored context',async()=>{
 const previous=globalThis.fetch;globalThis.fetch=async()=>new Response('image');
 let finishDecode;const uploads=[];
 const assets=new SceneAssets([{key:'day',url:'preview',preview:true},{key:'day',url:'detail'}],async a=>{
  uploads.push(a.url);
  if(a.url==='detail'&&!finishDecode)await new Promise(resolve=>{finishDecode=resolve;});
 },()=>{});
 try{
  const started=assets.start();await new Promise(setImmediate);
  assets.suspend();await assets.restore();finishDecode();await started;
  assert.deepEqual(uploads,['preview','detail','preview','detail']);
 }finally{assets.dispose();globalThis.fetch=previous;}
});


test('defocus uses bounded temporary render sizes and restores full resolution before sharp',()=>{
 assert.equal(focusRenderScale(6),.6);
 assert.equal(focusRenderScale(3),.8);
 assert.equal(focusRenderScale(1),1);
 assert.equal(focusRenderScale(0),1);
 const tiers=new Set(Array.from({length:601},(_,i)=>focusRenderScale(i/100)));
 assert.equal(tiers.size,3);
});

test('GPU quality responds during warmup but a single slow sample cannot lower fidelity',()=>{
 const q=new SceneQuality();
 for(const ms of [20,20,120,20,20,20])q.observe(ms,500);
 assert.equal(q.scale,1);assert.equal(q.warmingUp,false);
 const slow=new SceneQuality();
 for(let i=0;i<5;i++)slow.observe(45,500);
 assert.equal(slow.scale,1);slow.observe(45,600);assert.equal(slow.scale,.9);
});
test('all producers share a network limit and queued previews outrank detail',async()=>{
 const work=new SceneWork(),controller=new AbortController(),started=[],release=[];
 const job=(name,priority)=>work.network.run(priority,controller.signal,()=>new Promise(resolve=>{started.push(name);release.push(resolve);}));
 const running=Array.from({length:4},(_,i)=>job(i,scenePriority.tile));
 const detail=job('detail',scenePriority.overview),preview=job('preview',scenePriority.preview);
 await new Promise(setImmediate);assert.equal(started.length,4);
 release.shift()();await new Promise(setImmediate);assert.equal(started.at(-1),'preview');
 controller.abort();await assert.rejects(detail,{name:'AbortError'});
 for(const resolve of release)resolve();await Promise.all([...running,preview]);
});
test('decode budget covers bitmap lifetime; queued cancelled work never starts',async()=>{
 const work=new SceneWork(),controller=new AbortController();let active=0,peak=0;const release=[];
 const job=()=>work.decode.run(1,undefined,async()=>{active++;peak=Math.max(peak,active);await new Promise(resolve=>release.push(resolve));active--;});
 const first=job(),second=job();
 const cancelled=work.decode.run(0,controller.signal,async()=>assert.fail('cancelled decode ran'));
 controller.abort();await assert.rejects(cancelled,{name:'AbortError'});
 await new Promise(setImmediate);assert.equal(peak,2);
 release.forEach(resolve=>resolve());await Promise.all([first,second]);
});
test('upload work yields between bounded batches and drops stale generation jobs',async()=>{
 const work=new SceneWork(),controller=new AbortController();let calls=0;
 const jobs=Array.from({length:20},()=>work.upload(1,controller.signal,()=>{calls++;}));
 await new Promise(resolve=>setTimeout(resolve,1));assert.ok(calls>0&&calls<=4);
 controller.abort();await Promise.allSettled(jobs);assert.ok(calls<=4);
});


test('aurora culling retains every visible polar-volume sample across camera turns',()=>{
 const axis=magneticNorth,east=normalize(cross([0,0,1],axis)),north=cross(axis,east);
 let visible=0,culled=0;
 for(const t of [0,900,2100,3600,4800])for(const yaw of [-150,-60,0,79,150])for(const pitch of [-90,-10,50]){
  const frame=issFrame(t,.138,{yaw,pitch}),camera=frame.camera,basis=frame.cameraBasis;
  for(const aspect of [.46,1.5]){
   const retained=auroraInView(camera,basis,aspect);if(!retained)culled++;
   for(const sign of [-1,1])for(const radius of [1+85/6371,1+420/6371])for(const colat of [.2,.45,.66])for(let az=0;az<Math.PI*2;az+=Math.PI/12){
    const point=axis.map((v,i)=>radius*(v*Math.cos(colat)*sign+(east[i]*Math.cos(az)+north[i]*Math.sin(az))*Math.sin(colat)));
    const delta=point.map((v,i)=>v-camera[i]),distance=Math.hypot(...delta),ray=delta.map(v=>v/distance);
    const project=offset=>delta.reduce((sum,v,i)=>sum+v*basis[offset+i],0);
    const z=project(6);if(z<=0||Math.abs(project(0)/z)>aspect/2.5||Math.abs(project(3)/z)>.4)continue;
    const b=dot(camera,ray),d=b*b-dot(camera,camera)+1;
    if(d>=0&&b<0&&-b-Math.sqrt(d)<distance)continue;
    visible++;assert.equal(retained,true,`visible cap at t=${t}, yaw=${yaw}, pitch=${pitch}`);
   }
  }
 }
 assert.ok(visible>20,`visible sample count: ${visible}`);assert.ok(culled>10,'away-facing views skip the emission pass');
});

test('camera drag crosses the seam continuously and stops at the poles',()=>{
 // One viewport height of drag turns the view by the pinhole's central angle.
 const k=180/Math.PI/1.25/550,near=(a,b)=>Math.abs(a-b)<1e-9;
 const right=draggedCamera(179,0,-2/k,0,550),left=draggedCamera(-179,0,2/k,0,550);
 assert.ok(near(right.yaw,-179)&&right.pitch===0);assert.ok(near(left.yaw,179)&&left.pitch===0);
 assert.equal(draggedCamera(0,85,0,500,550).pitch,90);
 assert.equal(draggedCamera(0,-85,0,-500,550).pitch,-90);
 assert.ok(near(draggedCamera(0,0,1,1,550).yaw,-k));
 assert.deepEqual(draggedCamera(31,-17,0,0,550),{yaw:31,pitch:-17});
});

test('point reflections initialize after the catalog arrives in a paused scene',()=>{
 const points=new PointReflections(),identity=[1,0,0,0,1,0,0,0,1];
 const camera=[0,0,1.07],planet=[];
 const before=points.update(identity,identity,camera,0,planet,1.6,900,42);
 assert.ok(before.every(v=>v===0));
 points.upload(new Float32Array([0,0,1,0,0,0,-1,.45]));
 const loaded=points.update(identity,identity,camera,0,planet,1.6,900,42);
 assert.ok(loaded[2]>0,'a visible source must not stay at zero weight while paused');
 assert.deepEqual(points.update(identity,identity,camera,0,planet,1.6,900,42),loaded);
});

 test('paused inspection can resolve a large display without raising the motion budget',()=>{
 const moving=sceneBufferSize(2653,1786,2,1),still=sceneBufferSize(2653,1786,2,1,true);
 assert.ok(moving.width*moving.height<1_805_000);
 assert.ok(still.width*still.height<4_805_000&&still.width>moving.width*1.5);
 });


test('flight frames follow 60 Hz input and return to passive cadence',()=>{
 for(const hz of [60,120]){
  const clock=new SceneFrameClock();let frames=0;
  for(let i=1;i<=hz*2;i++){const now=i*1000/hz;clock.interact(now);if(clock.due(now))frames++;}
  assert.ok(Math.abs(frames-120)<=1,`delivered ${frames} on ${hz} Hz`);
  clock.due(2250);assert.equal(clock.fps,24);
  clock.reset(2250);frames=0;
  for(let i=1;i<=hz*5;i++)if(clock.due(2250+i*1000/hz))frames++;
  assert.equal(frames,120,'passive 24 FPS keeps fractional deadlines');
 }
});
test('steady cadence lands on whole refreshes, at least 24 FPS, unchanged by passive gestures',()=>{
 for(const [hz,expected,refreshes] of [[60,30,2],[90,30,3],[120,24,5],[144,24,6]]){
  const clock=new SceneFrameClock(24,true),period=1000/hz,gaps=[];let previous=null;
  for(let i=1;i<=hz*4;i++){
   // Sub-millisecond timestamp jitter must not move a frame to another refresh.
   const now=i*period+(i%3-1)*.4;clock.observe(now);
   // A downscaled device asks for no more than its passive rate.
   if(i%7===0)clock.interact(now,24);
   if(clock.due(now)){if(previous!==null)gaps.push(i-previous);previous=i;}
  }
  const settled=gaps.slice(10);
  assert.ok(settled.every(gap=>gap===refreshes),`${hz} Hz: ${[...new Set(settled)]}`);
  assert.ok(Math.abs(clock.fps-expected)<.3,`${hz} Hz runs at ${clock.fps}`);
 }
});
test('delayed input coalesces without catch-up draws or post-render drift',()=>{
 const clock=new SceneFrameClock();clock.interact(0);
 assert.equal(clock.due(0),true);assert.equal(clock.due(0),false);
 assert.equal(clock.due(100),true);assert.equal(clock.due(100),false);
 assert.equal(clock.due(116.667),true);
 clock.reset(1000);clock.interact(1000);
 assert.equal(clock.due(1016.667),true);
 assert.equal(clock.due(1022),false,'finishing a costly draw does not add another frame');
 assert.equal(clock.due(1033.333),true);
});

test('fast flight defers optional decode and GPU writes, preserves preview, then resumes',async()=>{
 const work=new SceneWork(),abort=new AbortController(),events=[];
 work.observeView([1,0,0],[1,0,0,0,1,0,0,0,1],0);
 work.observeView([1,.02,0],[1,0,0,0,1,0,0,0,1],16);
 assert.equal(work.moving,true);
 const tile=work.decode.run(scenePriority.tile,abort.signal,async()=>{
  events.push('decode');await work.upload(scenePriority.tile,abort.signal,()=>events.push('tile'));
 });
 const cancelled=new AbortController();
 const dropped=work.upload(scenePriority.tile,cancelled.signal,()=>events.push('cancelled')).catch(()=>{});
 cancelled.abort();
 const previews=Array.from({length:6},()=> 'preview');
 await Promise.all(previews.map(()=>work.upload(scenePriority.preview,abort.signal,()=>events.push('preview'))));
 assert.deepEqual(events,previews,'all preview batches must bypass the motion hold');
 assert.equal(work.moving,true,'previews must finish before the detail hold expires');
 await Promise.all([tile,dropped]);
 assert.equal(work.moving,false);
 assert.deepEqual(events,[...previews,'decode','tile'],'queued detail resumes without another user event');
 const slow=new SceneWork();slow.observeView([1,0,0],[1,0,0,0,1,0,0,0,1],0);
 slow.observeView([1,.00002,0],[1,0,0,0,1,0,0,0,1],16);
 assert.equal(slow.moving,false,'normal orbital motion keeps streaming');
});

test('an already downscaled scene uses an even 30 Hz interaction cadence',()=>{
 const clock=new SceneFrameClock();let frames=0;
 for(let i=1;i<=120;i++){const now=i*1000/60;clock.interact(now,30);if(clock.due(now))frames++;}
 assert.ok(Math.abs(frames-60)<=1);assert.equal(clock.fps,30);
});
test('fast changing views cannot trigger upscale probes but retain overload recovery',()=>{
 const quality=new SceneQuality();quality.scale=.65;let now=0;
 for(let i=0;i<1200;i++){now+=1000/30;quality.observeCadence(1000/30,now,false);}
 assert.equal(quality.scale,.65,'extra gesture frames do not imply spare GPU capacity');
 for(let i=0;i<90;i++){now+=100;quality.observeCadence(100,now,false);}
 assert.ok(quality.scale<.65,'overload still reduces the target during interaction');
});
test('a gesture renders on whole refreshes up to 60 FPS, slowing a step at a time while frames are late',()=>{
 for(const [hz,fast] of [[60,1],[120,2],[144,2]]){
  const clock=new SceneFrameClock(24,true),period=1000/hz,gaps=[];let previous=null;
  for(let i=1;i<=hz*3;i++){
   const now=i*period;clock.observe(now);
   if(i>hz)clock.interact(now,60);
   if(clock.due(now)){if(i>hz*1.5&&previous!==null)gaps.push(i-previous);previous=i;}
  }
  assert.ok(gaps.every(gap=>gap===fast),`${hz} Hz: ${[...new Set(gaps)]}`);
  assert.ok(Math.abs(clock.passiveRate-(hz===60?30:24))<.3,'the passive rate is still reported');
 }
 // At 120 Hz a frame takes 20 ms: the next callback comes on the first
 // refresh after it, so 60 FPS (every second refresh) is never on time.
 const clock=new SceneFrameClock(24,true),period=1000/120;let now=0;const gaps=[];let previous=0;
 for(let i=0;i<240;i++){now+=period;clock.observe(now);clock.due(now);}
 let busy=0;
 for(let n=0;n<400;n++){
  now+=busy?Math.ceil(busy/period)*period:period;busy=0;clock.observe(now);clock.interact(now,60);
  if(clock.due(now)){busy=20;if(n>300)gaps.push(Math.round((now-previous)/period));previous=now;}
 }
 assert.ok(Math.abs(clock.fps-40)<.5,`settles at 40 FPS, every third refresh: ${clock.fps}`);
 assert.ok(gaps.every(gap=>gap===3),`${[...new Set(gaps)]}`);
 // Lifting the finger returns to the passive cadence.
 for(let n=0;n<60;n++){now+=period;clock.observe(now);clock.due(now);}
 assert.ok(Math.abs(clock.fps-24)<.1);
});
test('steady cadence keeps the display period through GPU backpressure, not a real rate change',()=>{
 const clock=new SceneFrameClock(24,true);let now=0;
 for(let i=0;i<240;i++){now+=1000/120;clock.observe(now);clock.due(now);}
 assert.ok(Math.abs(clock.refreshPeriod-1000/120)<.1);
 // Two seconds where every render refresh arrives a refresh late.
 for(let i=0;i<240;i++){now+=i%5===0?1000/60:1000/120;clock.observe(now);clock.due(now);}
 assert.ok(Math.abs(clock.refreshPeriod-1000/120)<.1,'backpressure does not slow the estimate');
 assert.ok(Math.abs(clock.fps-24)<.1);
 // The display itself drops to 60 Hz, as adaptive phone panels do when idle.
 for(let i=0;i<40;i++){now+=1000/60;clock.observe(now);clock.due(now);}
 assert.ok(Math.abs(clock.refreshPeriod-1000/60)<.2,`now ${clock.refreshPeriod}`);
 assert.ok(Math.abs(clock.fps-30)<.2);
});
