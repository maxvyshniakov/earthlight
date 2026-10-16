import {test} from 'bun:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SceneQuality,SceneTimer} from '../src/scripts/scene-quality.ts';

for(const api of ['webgl','webgl2'])test(`${api} timer support cannot hide sustained 20 FPS delivery`,()=>{
 const allocated=[],deleted=[];
 const ext={TIME_ELAPSED_EXT:1,GPU_DISJOINT_EXT:2,QUERY_RESULT_AVAILABLE_EXT:3,QUERY_RESULT_EXT:4,
  createQueryEXT:()=>{const q={};allocated.push(q);return q;},beginQueryEXT(){},endQueryEXT(){},
  getQueryObjectEXT:()=>false,deleteQueryEXT:q=>deleted.push(q)};
 const gl={getExtension:()=>ext,getParameter:()=>false};
 if(api==='webgl2')Object.assign(gl,{createQuery:ext.createQueryEXT,beginQuery:ext.beginQueryEXT,
  endQuery:ext.endQueryEXT,getQueryParameter:ext.getQueryObjectEXT,deleteQuery:ext.deleteQueryEXT,
  QUERY_RESULT_AVAILABLE:3,QUERY_RESULT:4});
 const timer=new SceneTimer(gl);
 timer.begin();timer.end(); // A driver query that never completes.
 assert.equal(allocated.length,1);
 let now=0;
 for(let i=0;i<240;i++){
  now+=1000/24;timer.observeAnimationFrame(now);timer.observeCadence(1000/24,now);timer.begin();timer.end();
 }
 assert.equal(timer.quality.scale,1,'Healthy playback preserves resolution');
 assert.deepEqual(deleted,allocated,'Playback releases pending GPU queries');
 for(let i=0;i<48;i++){
  now+=50;timer.observeAnimationFrame(now);timer.observeCadence(50,now);timer.begin();timer.end();
 }
 assert.equal(timer.quality.scale,.9,'The delivered frame budget applies with either timer API');
 assert.equal(allocated.length,1,'Playback does not poll/allocate redundant GPU timers');
 timer.resetCadence();
 for(let i=0;i<12;i++){timer.begin();timer.end();}
 assert.ok(allocated.length>1,'Paused interactive rendering retains GPU timing');
 timer.dispose();assert.equal(deleted.length,allocated.length);
});

function stream(q,seconds,interval=1000/24,start=0){
 let now=start;
 const changes=[];
 while(now<start+seconds*1000){now+=interval;if(q.observeCadence(interval,now))changes.push({now,scale:q.scale});}
 return {now,changes};
}
test('cadence recovers lost resolution with small observed probes',()=>{
 const q=new SceneQuality();
 let {now}=stream(q,3,160);
 assert.ok(q.scale<.7);
 ({now}=stream(q,5,1000/24,now)); // Drain the preceding overloaded window.
 const before=q.scale;
 const recovery=stream(q,150,1000/24,now);
 assert.equal(q.scale,1);
 assert.ok(recovery.changes.length>3);
 let previous=before;
 for(const change of recovery.changes){assert.ok(change.scale>previous&&change.scale-previous<=.0501);previous=change.scale;}
});
test('a failed upscale rolls back to its known size and backs off',()=>{
 const q=new SceneQuality();q.scale=.7;
 const first=stream(q,10);
 assert.equal(q.scale,.75);
 const failure=stream(q,2,80,first.now);
 assert.equal(q.scale,.7);
 const retry=stream(q,8,1000/24,failure.now);
 assert.equal(q.scale,.7,'No immediate repeated probe at a saturated size');
 stream(q,10,1000/24,retry.now);
 assert.equal(q.scale,.75);
});
test('long pauses and invalid samples do not count as stable delivery',()=>{
 const q=new SceneQuality();q.scale=.6;
 let {now}=stream(q,5);
 q.observeCadence(NaN,now+10000);
 ({now}=stream(q,5,1000/24,now+10000));
 assert.equal(q.scale,.6);
 stream(q,5,1000/24,now+30000);
 assert.equal(q.scale,.6);
});
test('a new severe overload during a probe can still reach the safe floor',()=>{
 const q=new SceneQuality();q.scale=.7;
 const {now}=stream(q,10);
 assert.equal(q.scale,.75);
 stream(q,3,400,now);
 assert.equal(q.scale,.45);
});

test('steady 20 FPS lowers established resolution after two bad windows',()=>{
 const q=new SceneQuality();const {now}=stream(q,5);
 for(let i=1;i<=24;i++)q.observeCadence(50,now+i*50);
 assert.equal(q.scale,1,'One slow window may be a transient stall');
 for(let i=25;i<=48;i++)q.observeCadence(50,now+i*50);
 assert.equal(q.scale,.9,'Sustained 50 ms frames miss the 24 FPS budget');
});

test('normal 60 Hz quantization preserves 24 FPS and allows recovery',()=>{
 const q=new SceneQuality();q.scale=.7;
 let now=0;
 for(let i=0;i<3600;i++){
  const interval=i%2?50:1000/30;
  now+=interval;
  q.observeCadence(interval,now);
  assert.ok(q.scale>=.7,'Alternating 33/50 ms frames must not lower resolution');
 }
 assert.equal(q.scale,1);
});

test('an upscale that settles at 20 FPS rolls back after one bad window',()=>{
 const q=new SceneQuality();q.scale=.7;
 let now=0;
 while(q.scale===.7&&now<15000){now+=1000/24;q.observeCadence(1000/24,now);}
 assert.equal(q.scale,.75);
 now+=300; // The resize cooldown does not count toward the trial window.
 for(let i=0;i<23;i++){now+=50;q.observeCadence(50,now);}
 assert.equal(q.scale,.75);
 now+=50;q.observeCadence(50,now);
 assert.equal(q.scale,.7);
 stream(q,8,1000/24,now);
 assert.equal(q.scale,.7,'A failed trial must still observe retry backoff');
});

test('healthy windows and pauses break the consecutive overload streak',()=>{
 for(const separator of ['healthy','pause','invalid']){
  const q=new SceneQuality();let {now}=stream(q,5);
  for(let i=0;i<24;i++){now+=50;q.observeCadence(50,now);}
  if(separator==='healthy')for(let i=0;i<24;i++){now+=1000/24;q.observeCadence(1000/24,now);}
  if(separator==='pause')now+=3000;
  if(separator==='invalid')q.observeCadence(NaN,now);
  for(let i=0;i<24;i++){now+=50;q.observeCadence(50,now);}
  assert.equal(q.scale,1,`${separator} must prevent stale overload evidence`);
 }
});

test('six consecutive severe stalls bypass the two-window delay',()=>{
 const q=new SceneQuality();
 for(let i=1;i<=5;i++)q.observeCadence(400,i*400);
 assert.equal(q.scale,1);
 q.observeCadence(400,2400);
 assert.equal(q.scale,.45);
});

// The same remainder-carrying frame limiter as explorer.ts tick(). A loaded
// GPU is modelled by delayed RAF callbacks on the refresh grid; it is not a
// hardware performance model. Every callback, including skipped draws, is sent.
function animation(q){
 let now=0,lastDraw=0,lastAnimationDraw=0;
 const changes=[],frames=[];
 return {
  get now(){return now;},changes,frames,
  run(seconds,hz,cost=()=>0){
   const until=now+seconds*1000,period=1000/hz,draws=[];
   while(now<until){
    now+=period;
    q.observeAnimationFrame(now);
    if(now-lastDraw>=1000/24){
     const previous=q.scale,interval=lastAnimationDraw?now-lastAnimationDraw:0;
     if(lastAnimationDraw&&q.observeCadence(interval,now))changes.push({now,scale:q.scale,previous});
     frames.push({now,interval,scale:q.scale});
     lastAnimationDraw=now;draws.push(now);
     lastDraw=now-(now-lastDraw)%(1000/24);
     const busy=cost(q.scale,now);
     now+=Math.max(0,Math.ceil(busy/period)-1)*period;
    }
   }
   return draws;
  },
  pause(milliseconds){now+=milliseconds;lastDraw=now;lastAnimationDraw=0;q.resetCadence();},
 };
}

// Cadence correctness is separate from the initial acquisition policy below.
for(const hz of [30,50,60,120]){
 test(`tick simulation at ${hz} Hz preserves healthy 24 FPS for two minutes`,()=>{
  const q=new SceneQuality(),a=animation(q);
  const draws=a.run(120,hz);
  assert.equal(q.scale,1);
  assert.equal(a.changes.length,0);
  assert.ok(draws.length/120>23.9&&draws.length/120<24.1);
 });
 test(`tick simulation at ${hz} Hz lowers under load and recovers afterward`,()=>{
  const q=new SceneQuality(),a=animation(q);
  a.run(5,hz); // Establish a healthy size before introducing load.
  a.run(20,hz,scale=>100*scale*scale);
  assert.ok(q.scale<.81,'Loaded RAF must not be mistaken for a lower refresh rate');
  const before=q.scale;
  a.run(160,hz);
  assert.equal(q.scale,1,`Recovery from ${before} must tolerate refresh quantization`);
 });
}

test('60 to 30 to 60 Hz transitions preserve quality and low-refresh recovery',()=>{
 const q=new SceneQuality(),a=animation(q);
 a.run(10,60);a.run(40,30);a.run(10,60);
 assert.equal(q.scale,1);assert.equal(a.changes.length,0);
 q.scale=.7;
 a.run(100,30);
 assert.equal(q.scale,1,'The 67 ms tail must not indefinitely block recovery');
});

test('pause and resume discard partial delivery and RAF evidence',()=>{
 const q=new SceneQuality();q.scale=.7;
 const a=animation(q);
 a.run(7,60);
 a.pause(60000);
 a.run(5,30);
 assert.equal(q.scale,.7,'Time hidden must not count as proof of spare capacity');
 a.run(5,30);
 assert.equal(q.scale,.75);
});

// Acquisition converges promptly only at first startup; established quality
// still needs consecutive overload windows and uses conservative upward probes.
for(const hz of [30,50,60,120])test(`initial acquisition at ${hz} Hz finds a working size within five seconds`,()=>{
 const q=new SceneQuality(),a=animation(q);
 a.run(5,hz,scale=>100*scale*scale);
 assert.ok(a.changes[0].now<1600,'Do not wait two windows plus a five-second cooldown');
 assert.ok(q.scale<.8);
 const draws=a.run(5,hz,scale=>100*scale*scale);
 assert.ok(draws.length/5>=22,`Expected near-target delivery, got ${draws.length/5} FPS`);
});

test('healthy startup stays full size without a compulsory low-resolution phase',()=>{
 const q=new SceneQuality(),a=animation(q);
 a.run(30,30);
 assert.equal(q.scale,1);assert.equal(a.changes.length,0);
});


test('initial acquisition ignores one isolated long frame without masking sustained 20 FPS',()=>{
 const q=new SceneQuality();let now=0;
 for(let i=0;i<144;i++){
  const interval=i===10?200:i%2?50:1000/30;
  now+=interval;q.observeCadence(interval,now);
  assert.equal(q.scale,1,'One upload or scheduler stall must not lower startup quality');
 }
 const slow=new SceneQuality();
 stream(slow,1,50);
 assert.ok(slow.scale<1,'A steady 20 FPS deficit still starts acquisition');
});

test('pause during an upward probe preserves rollback size but clears observation time',()=>{
 const q=new SceneQuality();q.scale=.7;
 let {now}=stream(q,10);
 assert.equal(q.scale,.75);
 q.resetCadence();now+=60000;
 stream(q,2,80,now);
 assert.equal(q.scale,.7,'An unaccepted probe must still roll back after resume');
});


// Transition acceptance: the full-size GPU model moves from 12 to 92 ms and
// scales with pixel count. Callbacks arrive on the refresh grid after that work;
// no rendered interval is injected directly into the controller.
const meanWindow=(a,start,end)=>{
 const frames=a.frames.filter(f=>f.interval>0&&f.now-f.interval>=start&&f.now<=end);
 assert.ok(frames.length>=50,'A five-second window needs actual delivered samples');
 return frames.reduce((sum,f)=>sum+f.interval,0)/frames.length;
};
for(const hz of [30,60,120]){
 test(`established ${hz} Hz sharp load reaches a healthy five-second window by eight seconds`,()=>{
  const q=new SceneQuality(),a=animation(q);
  a.run(10,hz,scale=>12*scale*scale);const start=a.now;
  a.run(8,hz,scale=>92*scale*scale);
  assert.ok(meanWindow(a,start+3000,start+8000)<=46);
  const descent=a.changes.filter(c=>c.now>start);
  assert.ok(descent.length<=2,'At most two resizes for the sharp descent');
 });
 test(`established ${hz} Hz follows a sixty-second load ramp with bounded changes`,()=>{
  const q=new SceneQuality(),a=animation(q);
  a.run(10,hz,scale=>12*scale*scale);const start=a.now;
  a.run(60,hz,(scale,now)=>(12+80*Math.min(1,(now-start)/60000))*scale*scale);
  a.run(6,hz,scale=>92*scale*scale);
  assert.ok(meanWindow(a,start+61000,start+66000)<=46);
  const descent=a.changes.filter(c=>c.now>start);
  assert.ok(descent.length<=8,`Ramp resize budget exceeded: ${descent.length}`);
  // During the moving target, permit brief minor deficits while retaining
  // two-window hysteresis: every overlapping five-second window stays above 19 FPS.
  for(let offset=0;offset<=61;offset++){
   assert.ok(meanWindow(a,start+offset*1000,start+(offset+5)*1000)<=52,'Ramp must not sustain a severe delivery deficit');
  }
 });
 test(`established ${hz} Hz isolated stall and two-second upload burst do not cause repeated blur`,()=>{
  for(const transient of ['stall','upload67','upload100','upload160','upload250','upload334']){
   const q=new SceneQuality(),a=animation(q);
   a.run(10,hz,scale=>12*scale*scale);const start=a.now;let stalled=false;
   a.run(7,hz,(scale,now)=>{
    if(transient==='stall'&&!stalled){stalled=true;return 400;}
    // Upload/main-thread pressure is deliberately independent of render size.
    return transient.startsWith('upload')&&now<start+2000?Number(transient.slice(6)):12*scale*scale;
   });
   // Count through five seconds after the upload burst, before ordinary
   // upward recovery is eligible; the eventual recovery is tested separately.
   const changes=a.changes.filter(c=>c.now>start);
   assert.ok(changes.length<=1,`${transient} caused ${changes.length} resizes`);
   assert.ok(q.scale>=.9,`${transient} must cost at most one 0.1 quality step`);
   if(transient==='stall')assert.equal(changes.length,0);
  }
 });
 test(`established ${hz} Hz repeated light-heavy-light cycles bound resizing and recover`,()=>{
  const q=new SceneQuality(),a=animation(q);
  a.run(10,hz,scale=>12*scale*scale);
  for(let cycle=0;cycle<3;cycle++){
   const start=a.now;
   a.run(8,hz,scale=>92*scale*scale);
   assert.ok(meanWindow(a,start+3000,start+8000)<=46);
   a.run(160,hz,scale=>12*scale*scale);
   assert.equal(q.scale,1,'Conservative probes eventually recover full resolution');
   const changes=a.changes.filter(c=>c.now>start);
   const down=changes.filter(c=>c.scale<c.previous),up=changes.filter(c=>c.scale>c.previous);
   assert.ok(down.length<=2&&up.length<=11&&changes.length<=13,`Cycle ${cycle}: ${down.length} down, ${up.length} up`);
  }
 });
}


test('healthy delivery, pause and invalid timing discard material escalation evidence',()=>{
 for(const separator of ['healthy','pause','gap','invalid']){
  const q=new SceneQuality();let {now}=stream(q,5);
  for(let i=0;i<8;i++){now+=80;q.observeCadence(80,now);}
  assert.equal(q.scale,.9);
  now+=1600;
  if(separator==='healthy')({now}=stream(q,1.2,1000/24,now));
  if(separator==='pause')q.resetCadence();
  if(separator==='gap')now+=3000;
  if(separator==='invalid')q.observeCadence(NaN,now);
  for(let i=0;i<8;i++){now+=80;q.observeCadence(80,now);}
  assert.ok(Math.abs(q.scale-.8)<1e-9,`${separator}: a new episode starts with one small step`);
 }
});

for(const hz of [30,60,120])test(`a two-second burst during a ${hz} Hz upward probe only rolls back`,()=>{
 for(const uploadCost of [67,100,160,250,334]){
  const q=new SceneQuality();q.scale=.7;
  const a=animation(q);a.run(10,hz,scale=>12*scale*scale);
  assert.equal(q.scale,.75);const start=a.now;
  a.run(7,hz,(scale,now)=>now<start+2000?uploadCost:12*scale*scale);
  const changes=a.changes.filter(c=>c.now>start);
  assert.equal(changes.length,1);
  assert.equal(q.scale,.7,'Do not turn a failed probe into a large transient blur');
 }
});


test('six sustained 400 ms frames retain emergency recovery at an established size',()=>{
 const q=new SceneQuality();let {now}=stream(q,5);
 for(let i=0;i<5;i++){now+=400;q.observeCadence(400,now);}
 assert.equal(q.scale,1);
 now+=400;q.observeCadence(400,now);
 assert.equal(q.scale,.45);
});


test('recorded Pixel bunched RAF triggers a bounded first response within one second',()=>{
 const fixture=JSON.parse(readFileSync(new URL('./fixtures/pixel-bunched-raf-2026-10-10.json',import.meta.url),'utf8'));
 const q=new SceneQuality();let lastDraw=fixture.raf[0],lastAnimationDraw=0,first=null;
 for(const now of fixture.raf){
  q.observeAnimationFrame(now);
  if(now-lastDraw>=1000/24){
   if(lastAnimationDraw&&q.observeCadence(now-lastAnimationDraw,now)){
    assert.ok(now>=fixture.cloudPhaseStart,'Healthy sky must stay full resolution');
    first={now,scale:q.scale};break;
   }
   lastAnimationDraw=now;lastDraw=now-(now-lastDraw)%(1000/24);
  }
 }
 assert.ok(first,'Bunched callbacks must still reveal sustained mean overload');
 assert.ok(first.now-fixture.cloudPhaseStart<=1000);
 assert.equal(first.scale,.9);
});

test('alternating long and short cadence detects load without treating a two-second burst as permanent',()=>{
 // This is a cadence-contract test, not a GPU timing claim. The recorded RAF
 // fixture above verifies actual limiter wiring separately.
 for(const burst of [false,true]){
  const q=new SceneQuality();let {now}=stream(q,5);const start=now;let count=0;
  const changes=[],frames=[];
  while(now<start+8000){
   const loaded=!burst||now<start+2000;
   const interval=loaded?(count++%2?10:190)*(burst?1:q.scale*q.scale):1000/24;
   now+=interval;q.observeAnimationFrame(now);
   if(q.observeCadence(interval,now))changes.push({now,scale:q.scale});
   frames.push({now,interval});
  }
  assert.equal(changes[0].scale,.9);
  if(burst){assert.equal(changes.length,1);assert.equal(q.scale,.9);}
  else {
   const settled=frames.filter(f=>f.now-f.interval>=start+3000&&f.now<=start+8000);
   assert.ok(settled.reduce((sum,f)=>sum+f.interval,0)/settled.length<=46);
   assert.ok(changes.length<=2);
  }
 }
});


test('emergency evidence outranks material overload after mixed healthy history',()=>{
 const q=new SceneQuality();let {now}=stream(q,5);
 q.resetCadence();
 for(let i=0;i<2;i++){now+=1000/24;q.observeCadence(1000/24,now);}
 for(let i=0;i<6;i++){now+=400;q.observeCadence(400,now);}
 assert.equal(q.scale,.45,'Six sustained 400 ms stalls must not take only the first small step');
});

// A 120 Hz display at 24 FPS: on time is 41.67 ms; one refresh late is 50 ms.
function jittered(q,seconds,start,{lateEvery=4,interacting=false}={}){
 let now=start,i=0;const changes=[];
 while(now<start+seconds*1000){const interval=++i%lateEvery===0?50:1000/24;now+=interval;if(q.observeCadence(interval,now,!interacting))changes.push({now,scale:q.scale});}
 return {now,changes};
}
test('headroom lowers scale when frames miss refreshes although the mean holds',()=>{
 const plain=new SceneQuality(),headroom=new SceneQuality();
 for(const q of [plain,headroom]){q.scale=.8;q.setCadence(1000/24,1000/120);}
 headroom.headroom=true;
 for(const q of [plain,headroom]){const settled=stream(q,4,1000/24);jittered(q,6,settled.now);}
 // The mean-only controller even probes upward while a quarter of frames are late.
 assert.ok(plain.scale>=.8,'mean-only adaptation keeps or enlarges a saturated size');
 assert.ok(headroom.scale<.8,`headroom ${headroom.scale}`);
 assert.ok(Math.abs((.8-headroom.scale)/.06-Math.round((.8-headroom.scale)/.06))<1e-6,'reductions are single steps');
});
test('isolated stalls are not overload: headroom keeps the scale',()=>{
 const q=new SceneQuality();q.scale=.8;q.headroom=true;q.setCadence(1000/24,1000/120);
 let now=stream(q,4,1000/24).now,i=0;
 // A 100 ms stall every second, as a garbage collection or the compositor makes.
 while(now<20000){const interval=++i%24===0?100:1000/24;now+=interval;q.observeCadence(interval,now);}
 assert.ok(q.scale>=.8,`no reduction: ${q.scale}`);
});
test('headroom defers its resize until a gesture ends and blocks upward probes',()=>{
 const q=new SceneQuality();q.scale=.8;q.headroom=true;q.setCadence(1000/24,1000/120);
 let {now}=stream(q,4,1000/24);
 ({now}=jittered(q,6,now,{interacting:true}));
 assert.equal(q.scale,.8,'no reallocation mid-gesture');
 ({now}=stream(q,.2,1000/24,now));
 assert.ok(q.scale<.8,'applied once the view is quiet');
 const reduced=q.scale;
 jittered(q,20,now,{lateEvery:6});
 assert.ok(q.scale<=reduced,'late frames never justify a larger buffer');
});
