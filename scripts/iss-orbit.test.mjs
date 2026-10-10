import { sceneComposition } from '../src/scripts/scene-viewport.ts';
import {OrbitNavigation,routeFrame,routePeriod,blendPose,altitude,attitude,cameraRay,screenPoint,earthPoint,followLens,PROJECTION,MIN_ALTITUDE,MAX_ALTITUDE} from '../src/scripts/orbit-navigation.ts';
import {test} from 'bun:test';
import assert from 'node:assert/strict';
import { OrbitPlayback } from '../src/scripts/orbit-playback.ts';
import { issFrame, ORBIT_SECONDS, START_DATE, DEFAULT_ORBIT_SECONDS, initialOrbitSeconds, dot, add, scale, normalize } from '../src/scripts/iss-orbit.ts';

test('orbit presets have distinct heights, periods and polar coverage',()=>{
 assert.equal(routePeriod('iss'),ORBIT_SECONDS);
 assert.ok(routePeriod('high')>routePeriod('polar')*5);
 for(const route of ['polar','high'])for(let i=0;i<20;i++){
  const f=routeFrame(route,i*routePeriod(route)/20);
  assert.ok(Math.abs(f.altitude-(route==='polar'?800:20000))<1e-8);
  assert.ok(f.cameraBasis.every(Number.isFinite));
 }
 const north=routeFrame('polar',(Math.PI/2-.55)/(2*Math.PI)*routePeriod('polar'));
 assert.ok(north.latitude>89.99);
});

test('detaching and restoring free flight preserve every camera ray',()=>{
 for(const route of ['iss','polar','high'])for(const view of [{yaw:131,pitch:-18},{yaw:-124,pitch:80},{yaw:0,pitch:0}]){
  const nav=new OrbitNavigation();nav.route=route;
  const before=nav.read(2300,view,0);nav.detach(before,view);
  const after=nav.read(2300,view,0);
  for(let i=0;i<9;i++)assert.ok(Math.abs(before.cameraBasis[i]-after.cameraBasis[i])<1e-7);
  assert.deepEqual(after.camera,before.camera);
  const params=new URLSearchParams();nav.write(params);const restored=new OrbitNavigation();restored.restore(params);
  const copy=restored.read(2300,view,0);
  for(let i=0;i<9;i++)assert.ok(Math.abs(copy.cameraBasis[i]-after.cameraBasis[i])<1e-7);
  for(let i=0;i<3;i++)assert.ok(Math.abs(copy.camera[i]-after.camera[i])<1e-7);
 }
});

const project=(nav,point)=>{const b=nav.free.basis,d=add(point,scale(nav.free.position,-1)),z=dot(d,b.slice(6,9));return [1.25*dot(d,b.slice(0,3))/z,1.25*dot(d,b.slice(3,6))/z];};
const horizon=nav=>attitude({camera:nav.free.position,cameraBasis:nav.free.basis});

test('free movement respects altitude limits and clears momentum on interruption',()=>{
 const view={yaw:0,pitch:0},nav=new OrbitNavigation();nav.detach(routeFrame('high',1000),view);
 for(let i=0;i<300;i++)nav.step(1/24,{climb:-1,fast:true});
 assert.ok(Math.abs(altitude(nav.free.position)-MIN_ALTITUDE)<1e-6);
 for(let i=0;i<350;i++)nav.step(1/24,{climb:1,fast:true});
 assert.ok(Math.abs(altitude(nav.free.position)-MAX_ALTITUDE)<1e-6);
 nav.stop();const before=[...nav.free.position];nav.step(.05);
 for(let i=0;i<3;i++)assert.ok(Math.abs(before[i]-nav.free.position[i])<1e-10);
 nav.setAltitude(-100);for(let i=0;i<200;i++)nav.step(.05);
 assert.ok(Math.abs(altitude(nav.free.position)-MIN_ALTITUDE)<.06);
});

test('flying a lap keeps the view relative to the horizon, across both poles',()=>{
 for(const route of ['iss','polar']){
  const nav=new OrbitNavigation();nav.detach(routeFrame(route,1000),{yaw:0,pitch:0});
  const start=horizon(nav),height=altitude(nav.free.position);let north=-90,south=90;
  for(let i=0;i<3000;i++){nav.step(.05,{forward:1,fast:true});const lat=Math.asin(normalize(nav.free.position)[2])*180/Math.PI;north=Math.max(north,lat);south=Math.min(south,lat);}
  const end=horizon(nav);
  assert.ok(Math.abs(end.pitch-start.pitch)<1e-6&&Math.abs(end.roll-start.roll)<1e-6,'pitch and roll survive the lap');
  assert.ok(Math.abs(altitude(nav.free.position)-height)<1e-6,'keys never change altitude');
  if(route==='polar')assert.ok(north>89&&south<-89,'the polar lap crosses both poles');
 }
});

test('a grabbed Earth point stays under the pointer without rolling the horizon',()=>{
 const nav=new OrbitNavigation();nav.detach(routeFrame('high',1000),{yaw:0,pitch:0});
 nav.turn(4,-5);nav.roll(.3);
 const start=horizon(nav),hit=earthPoint(nav.free.position,cameraRay(nav.free.basis,.1,-.05));assert.ok(hit.hit);
 nav.grab(hit.point,.1,-.05);
 for(const [x,y] of [[.12,-.08],[.05,0],[-.08,.06]]){
  nav.drag(x,y);nav.step(1/60);
  const [px,py]=project(nav,hit.point);assert.ok(Math.hypot(px-x,py-y)<1e-9,`anchor at ${px},${py}`);
  assert.ok(Math.abs(horizon(nav).roll-start.roll)<1e-6&&Math.abs(horizon(nav).pitch-start.pitch)<1e-6);
 }
 nav.release(false);assert.equal(nav.moving,false);
 // A flick keeps turning the planet, then settles.
 nav.grab(hit.point,-.2,.1);nav.drag(0,.1);nav.step(1/60);nav.release(true);assert.equal(nav.moving,true);
 let frames=0;while(nav.moving&&frames<2000){nav.step(1/60);frames++;}assert.ok(frames>20&&frames<2000);
});

test('looking around never tips a level horizon; a rolled camera looks about its own axes',()=>{
 const nav=new OrbitNavigation();nav.detach(routeFrame('iss',1000),{yaw:0,pitch:0});
 for(let k=0;k<20;k++)for(let i=0;i<64;i++){const a=i/32*Math.PI,b=(i+1)/32*Math.PI;nav.turnBetween(.3*Math.cos(a),.3*Math.sin(a),.3*Math.cos(b),.3*Math.sin(b));}
 assert.ok(Math.abs(horizon(nav).roll)<1e-6,'twenty circles of the pointer leave the horizon level');
 const sky=cameraRay(nav.free.basis,.2,.1);nav.turnBetween(.2,.1,.21,.12);
 const z=dot(sky,nav.free.basis.slice(6,9));
 assert.ok(Math.hypot(1.25*dot(sky,nav.free.basis.slice(0,3))/z-.21,1.25*dot(sky,nav.free.basis.slice(3,6))/z-.12)<1e-9,'the sky follows the pointer');
 // Rolled on purpose, the hold lets go: pitch turns about the image's own
 // right axis, so the picture slides rather than spinning about its centre.
 nav.roll(Math.PI/2);const rolled=[...nav.free.basis];nav.turn(0,10);
 for(let i=0;i<3;i++)assert.ok(Math.abs(nav.free.basis[i]-rolled[i])<1e-12);
 nav.level();for(let i=0;i<120;i++)nav.step(1/60);
 assert.ok(Math.abs(horizon(nav).roll)<1e-6);assert.equal(nav.moving,false);
 // Pitching over the zenith is a loop: the camera ends upside down, not snapped back.
 for(let i=0;i<120;i++)nav.turn(0,1);
 assert.ok(Math.abs(Math.abs(horizon(nav).roll)-180)<1e-6);
});

test('a scroll spins the globe about its centre in the swipe direction, without running out',()=>{
 for(const [x,y] of [[.1,.05],[-.2,.1]]){
  const nav=new OrbitNavigation();nav.detach(routeFrame('high',1000),{yaw:0,pitch:0});
  const point=earthPoint(nav.free.position,cameraRay(nav.free.basis,x,y)).point;
  nav.spinGlobe(0,.01,x,y);const [ux,uy]=project(nav,point);
  assert.ok(uy>y+.005&&Math.abs(ux-x)<.002,'a swipe up moves the touched surface straight up');
  const [cx,cy]=project(nav,[0,0,0]);assert.ok(Math.hypot(cx,cy)<1e-9,'the globe turns in place');
  const start=[...nav.free.position];for(let i=0;i<400;i++)nav.spinGlobe(0,.02,x,y);
  assert.ok(Math.hypot(...start.map((v,i)=>v-nav.free.position[i]))>4,'past the limb it keeps turning');
 }
 // Over a horizon the same swipe slides the ground toward the horizon.
 const nav=new OrbitNavigation();nav.detach(routeFrame('iss',1000),{yaw:0,pitch:0});
 const ground=earthPoint(nav.free.position,cameraRay(nav.free.basis,0,-.42)).point;
 nav.spinGlobe(0,.02,0,-.42);assert.ok(project(nav,ground)[1]>-.42);
});

test('zoom keeps the Earth point under the pointer, clips before Earth and never tunnels',()=>{
 const nav=new OrbitNavigation();nav.detach(routeFrame('high',0),{yaw:0,pitch:0});
 const hit=earthPoint(nav.free.position,cameraRay(nav.free.basis,.05,.03));
 for(let i=0;i<6;i++){nav.zoom(-.3,.05,.03);const [x,y]=project(nav,hit.point);assert.ok(Math.hypot(x-.05,y-.03)<1e-6);}
 const original=normalize(nav.free.position);
 for(let i=0;i<60;i++)nav.zoom(-.5);
 assert.ok(Math.abs(altitude(nav.free.position)-MIN_ALTITUDE)<1e-6);
 assert.ok(dot(normalize(nav.free.position),original)>.99,'cannot tunnel through Earth');
 for(let i=0;i<60;i++)nav.zoom(.5);
 assert.ok(Math.abs(altitude(nav.free.position)-MAX_ALTITUDE)<1e-6);
});

test('climbing out of the horizon view keeps Earth in frame',()=>{
 for(const input of ['zoom','keys']){
  const nav=new OrbitNavigation();nav.detach(routeFrame('iss',1000),{yaw:0,pitch:0});
  if(input==='zoom')for(let i=0;i<40;i++)nav.zoom(.3);else for(let i=0;i<300;i++)nav.step(1/24,{climb:1});
  assert.ok(altitude(nav.free.position)>MAX_ALTITUDE-1);
  const [x,y]=project(nav,[0,0,0]);assert.ok(Math.abs(x)<.5&&Math.abs(y)<.5,`Earth centre at ${x},${y}`);
 }
});

test('fly-to approaches a point and centres it; the sky is only centred',()=>{
 const nav=new OrbitNavigation();nav.detach(routeFrame('high',1000),{yaw:0,pitch:0});
 const hit=earthPoint(nav.free.position,cameraRay(nav.free.basis,.15,.05)),distance=Math.hypot(...add(hit.point,scale(nav.free.position,-1)));
 nav.flyTo(.15,.05,-Math.log(2),.5);for(let i=0;i<40;i++)nav.step(1/60);
 const [x,y]=project(nav,hit.point);assert.ok(Math.hypot(x,y)<1e-6);
 assert.ok(Math.abs(Math.hypot(...add(hit.point,scale(nav.free.position,-1)))/distance-.5)<1e-6);
 nav.turn(0,60);const sky=cameraRay(nav.free.basis,.3,.3),position=[...nav.free.position];
 nav.flyTo(.3,.3,-Math.log(2),0);nav.step(1/60);
 assert.deepEqual(nav.free.position,position);assert.ok(dot(sky,nav.free.basis.slice(6,9))>1-1e-9);
});

test('the lens keeps the direction under the pointer and never moves the camera',()=>{
 for(const route of ['iss','high']){
  const nav=new OrbitNavigation();nav.detach(routeFrame(route,1000),{yaw:0,pitch:0});nav.turn(12,-7);
  const position=[...nav.free.position],start=horizon(nav);
  for(const [focal,x,y] of [[2.5,.3,-.2],[6,-.41,.18],[25,.05,.33],[1.9,-.6,-.4],[PROJECTION,.2,.1]]){
   const ray=cameraRay(nav.free.basis,x,y,nav.focal);nav.setLens(focal,x,y);
   const [px,py]=screenPoint(nav.free.basis,ray,focal);
   assert.ok(Math.hypot(px-x,py-y)<1e-9,`${route} ray at ${px},${py} for ${x},${y}`);
   assert.deepEqual(nav.free.position,position,'zooming never moves the camera');
   if(route==='iss')assert.ok(Math.abs(horizon(nav).roll-start.roll)<1e-3,'a level horizon stays level');
  }
  const basis=[...nav.free.basis];nav.setLens(9,0,0);nav.setLens(1.4);
  assert.deepEqual(nav.free.basis,basis,'zooming about the centre does not turn the camera');
 }
 // Look speed follows the lens: a key turns 60°/s at 1×, 6°/s at 10×.
 const turned=focal=>{const nav=new OrbitNavigation();nav.detach(routeFrame('iss',1000),{yaw:0,pitch:0});nav.focal=focal;
  const forward=nav.free.basis.slice(6,9);nav.step(.05,{yaw:1});return Math.acos(Math.min(1,dot(forward,nav.free.basis.slice(6,9))))*180/Math.PI;};
 assert.ok(Math.abs(turned(PROJECTION)/turned(10*PROJECTION)-10)<1e-6);
 // Hit tests and the spin of the globe use the lens too.
 const nav=new OrbitNavigation();nav.detach(routeFrame('high',1000),{yaw:0,pitch:0});nav.setLens(4*PROJECTION);
 const point=earthPoint(nav.free.position,cameraRay(nav.free.basis,.1,.05,nav.focal)).point;
 nav.spinGlobe(0,.002,.1,.05);const [ux,uy]=screenPoint(nav.free.basis,add(point,scale(nav.free.position,-1)),nav.focal);
 assert.ok(Math.abs(uy-.052)<2e-4&&Math.abs(ux-.1)<2e-4,`a zoomed swipe keeps pace with the finger: ${ux},${uy}`);
});

test('following an orbit, the lens re-aims yaw and pitch instead of detaching',()=>{
 const t=2300,frame=(route,view)=>routeFrame(route,t,view);
 for(const [route,view] of [['iss',{yaw:0,pitch:0}],['iss',{yaw:40,pitch:12}],['polar',{yaw:-150,pitch:-20}]]){
  let current={...view},focal=PROJECTION;
  const ray=cameraRay(frame(route,current).cameraBasis,.32,-.18,focal);
  for(const next of [1.6,2.4,4,7.5,5]){current=followLens(frame(route,current),current,.32,-.18,focal,next*PROJECTION);focal=next*PROJECTION;}
  const [x,y]=screenPoint(frame(route,current).cameraBasis,ray,focal);
  assert.ok(Math.hypot(x-.32,y+.18)<1e-6,`${route} ${JSON.stringify(view)}: ${x},${y}`);
  assert.ok(Math.abs(current.pitch)<=90&&Math.abs(current.yaw)<=180);
 }
 // Zooming about the centre leaves the view alone.
 assert.deepEqual(followLens(frame('iss',{yaw:33,pitch:-8}),{yaw:33,pitch:-8},0,0,PROJECTION,8*PROJECTION),{yaw:33,pitch:-8});
 // Looking straight down from the high orbit, yaw would only spin the picture:
 // the pointer may drift, but the image does not swing around it.
 for(const [x,y] of [[.3,.05],[.32,-.18],[-.1,.3]]){
  const nadir=followLens(frame('high',{yaw:0,pitch:0}),{yaw:0,pitch:0},x,y,PROJECTION,2*PROJECTION);
  assert.ok(Math.abs(nadir.yaw)<1,`nadir yaw ${nadir.yaw}`);
 }
 // A ray right of centre at the horizon turns the head right, as a drag left would.
 assert.ok(followLens(frame('iss',{yaw:0,pitch:0}),{yaw:0,pitch:0},.3,0,PROJECTION,2*PROJECTION).yaw>0);
});

test('free URLs restore the exact pose after moving',()=>{
 const nav=new OrbitNavigation();nav.detach(routeFrame('high',1000),{yaw:0,pitch:0});
 nav.turn(35,24);for(let i=0;i<80;i++)nav.step(.04,{forward:.5,right:.5,climb:.5});
 const params=new URLSearchParams();nav.write(params);assert.ok(params.has('orientation'));assert.equal(params.has('heading'),false);
 const restored=new OrbitNavigation();restored.restore(params);
 for(let i=0;i<9;i++)assert.ok(Math.abs(restored.free.basis[i]-nav.free.basis[i])<1e-8);
 for(let i=0;i<3;i++)assert.ok(Math.abs(restored.free.position[i]-nav.free.position[i])<1e-7);
});

test('legacy Earth-relative links migrate once and malformed orientations are rejected',()=>{
 const params=new URLSearchParams('flight=free&position=0,0,4&heading=1,0,0&elevation=0&yaw=0&pitch=-90');
 const nav=new OrbitNavigation();nav.restore(params);
 assert.ok(dot(nav.read(0,{yaw:0,pitch:-90},0).forward,[0,0,-1])>.999999);
 nav.turn(30,0);assert.ok(Math.abs(dot(nav.read(0,{yaw:0,pitch:-90},0).forward,[0,-1,0])-.5)<1e-9);
 for(const orientation of ['0,0,0,0','NaN,0,0,1','1,2,3','0,,0,1','1e300,0,0,1']){
  const bad=new OrbitNavigation();bad.restore(new URLSearchParams({flight:'free',position:'0,0,4',orientation}));assert.equal(bad.mode,'follow');
 }
});

test('route transitions stay outside Earth and preserve orthogonal camera axes',()=>{
 const from=routeFrame('iss',1000),to=routeFrame('high',10000);
 for(let i=0;i<=20;i++){
  const pose=blendPose(from,to,i/20);
  assert.ok(altitude(pose.camera)>=MIN_ALTITUDE);
  const axes=[0,3,6].map(i=>pose.cameraBasis.slice(i,i+3));
  for(const a of axes)assert.ok(Math.abs(Math.hypot(...a)-1)<1e-9);
  assert.ok(Math.abs(dot(axes[0],axes[1]))<1e-9);
 }
});

test('malformed free-flight links cannot place the camera inside Earth or at infinity',()=>{
 for(const position of ['NaN,0,0','1e308,1e308,0','0,0,0',',,','2,0']){
  const nav=new OrbitNavigation();nav.restore(new URLSearchParams({flight:'free',position,heading:'0,1,0',elevation:'0',route:'unknown'}));
  assert.equal(nav.mode,'follow');assert.equal(nav.route,'iss');
 }
});

test('playback keeps exact speed across delayed frames and resumes after repeated seeks',()=>{
  const clock=new OrbitPlayback(1000,10);
  clock.setRunning(true,100);
  for(const now of [116,141,208,731,1100])assert.equal(clock.read(now),1000+(now-100)/100);
  clock.setRunning(false,1100);
  assert.equal(clock.read(10000),1010);
  for(const [now,position] of [[10000,2708.46],[20000,965.12],[30000,5578.7]]){
    clock.seek(position,now);
    assert.equal(clock.read(now+500),position);
    clock.setRunning(true,now+500);
    assert.ok(Math.abs(clock.read(now+1500)-position-10)<1e-9);
    clock.setRunning(false,now+1500);
  }
});

test('speed changes preserve the current time and suspension never catches up hidden time',()=>{
  const clock=new OrbitPlayback(1000,10);
  clock.setRunning(true,0);
  clock.setSpeed(2.5,1000);
  assert.equal(clock.read(1000),1010);
  assert.equal(clock.read(2000),1012.5);
  clock.setRunning(false,2000);
  clock.setRunning(true,90000);
  assert.equal(clock.read(91000),1015);
});

test('page entry starts before moonrise, while explicit frame links retain their timestamp',()=>{
  for(const query of ['', 'still=', 't=', 't=invalid', 't=Infinity', 't=1e100']) {
    const seconds=initialOrbitSeconds(new URLSearchParams(query));
    assert.equal(seconds,DEFAULT_ORBIT_SECONDS);
  }
  for(const seconds of [0,2708.46,172800.25,-600]) {
    const initial=initialOrbitSeconds(new URLSearchParams(`t=${seconds}&still=`));
    assert.equal(initial,seconds);
    assert.equal(issFrame(initial).date.getTime(),START_DATE.getTime()+seconds*1000);
  }
});

import { celestialFrame } from '../src/scripts/celestial-sky.ts';

test('the Moon rises within five seconds of default 10x playback',()=>{
  const upperLimb=t=>{
    const orbit=issFrame(t,.22);
    const moon=celestialFrame(orbit.date,orbit.camera).moon;
    return Math.asin(dot(normalize(orbit.camera),moon.slice(0,3)))
      +Math.acos(1/Math.hypot(...orbit.camera))+moon[3];
  };
  assert.ok(upperLimb(DEFAULT_ORBIT_SECONDS)<0);
  assert.ok(upperLimb(DEFAULT_ORBIT_SECONDS+30)<0);
  assert.ok(upperLimb(DEFAULT_ORBIT_SECONDS+50)>0);
});

test('ISS replay follows a low orbit, inclination and repeating orbital plane',()=>{
  let maxLatitude=0;
  for(let t=0;t<ORBIT_SECONDS;t+=30){
    const f=issFrame(t);
    assert.ok(f.altitude>400&&f.altitude<450);
    assert.ok([...f.camera,...f.sun,...f.cameraBasis].every(Number.isFinite));
    maxLatitude=Math.max(maxLatitude,Math.abs(f.latitude));
  }
  assert.ok(maxLatitude>51.5&&maxLatitude<52);
  assert.ok(ORBIT_SECONDS>5500&&ORBIT_SECONDS<5650);
  const a=issFrame(0),b=issFrame(ORBIT_SECONDS);
  assert.ok(Math.abs(a.latitude-b.latitude)<1);
  // Earth rotates eastward during a revolution, moving the ground track west.
  assert.ok(a.longitude-b.longitude>20&&a.longitude-b.longitude<26);
});

test('one shared camera keeps an orthonormal basis and the horizon at both scroll endpoints',()=>{
  for(const t of [0,1200,2800,4500])for(const limb of [.138,.22,.03,-.16]){
    const f=issFrame(t,limb),basis=f.cameraBasis;
    const axes=[basis.slice(0,3),basis.slice(3,6),basis.slice(6,9)];
    axes.forEach(a=>assert.ok(Math.abs(dot(a,a)-1)<1e-10));
    assert.ok(Math.abs(dot(axes[0],axes[1]))<1e-10);
    assert.ok(Math.abs(dot(axes[1],axes[2]))<1e-10);
    const ray=normalize(add(scale(axes[1],limb-.5),scale(axes[2],1.25)));
    const b=dot(f.camera,ray);
    assert.ok(b<0);
    assert.ok(Math.abs(dot(f.camera,f.camera)-b*b-1)<1e-10);
    assert.equal(f.date.getTime(),issFrame(t).date.getTime());
  }
});

test('Sun and ground share coordinates, with real eclipse and day/night transitions',()=>{
  const phases=new Set();let eclipse=0,lit=0;
  for(let t=0;t<ORBIT_SECONDS;t+=15){
    const f=issFrame(t);phases.add(f.phase);
    assert.ok(Math.abs(dot(normalize(f.camera),f.sun)-f.solar)<1e-10);
    assert.ok(Math.abs(Math.hypot(...f.sun)-1)<1e-10);
    if(f.shadow){eclipse+=15;assert.ok(f.solar<0);}else lit+=15;
  }
  assert.deepEqual([...phases],['Night','Dawn','Day','Dusk']);
  assert.ok(eclipse>1200&&eclipse<2400);
  assert.ok(lit>eclipse);
  assert.equal(issFrame(0).shadow,1);
  assert.equal(issFrame(3000).phase,'Day');
});


test('camera controls turn through 360 degrees without moving the ISS or rolling the horizon',()=>{
  const base=issFrame(4192.39,.22),radial=normalize(base.camera);
  const horizontal=frame=>normalize(add(frame.cameraBasis.slice(6,9),scale(radial,-dot(frame.cameraBasis.slice(6,9),radial))));
  for(const yaw of [-180,-90,0,90,180])for(const pitch of [-90,-35,0,40,90]){
    const view=issFrame(4192.39,.22,{yaw,pitch});
    assert.deepEqual(view.camera,base.camera);
    assert.deepEqual(view.sun,base.sun);
    assert.equal(view.phase,base.phase);
    assert.equal(view.date.getTime(),base.date.getTime());
    const axes=[0,3,6].map(i=>view.cameraBasis.slice(i,i+3));
    for(const axis of axes)assert.ok(Math.abs(dot(axis,axis)-1)<1e-10);
    for(let i=0;i<3;i++)for(let j=i+1;j<3;j++)assert.ok(Math.abs(dot(axes[i],axes[j]))<1e-10);
    assert.ok(Math.abs(dot(axes[0],radial))<1e-10,'right remains tangent to the Earth');
    if(pitch===0)assert.ok(Math.abs(dot(axes[2],radial)-dot(base.cameraBasis.slice(6,9),radial))<1e-10);
  }
  const back=issFrame(4192.39,.22,{yaw:180,pitch:0});
  assert.ok(dot(horizontal(back),horizontal(base))<-.99999);
  const right=issFrame(4192.39,.22,{yaw:90,pitch:0});
  assert.ok(dot(horizontal(right),base.cameraBasis.slice(0,3))>.99999);
  assert.ok(dot(issFrame(4192.39,.22,{yaw:0,pitch:90}).cameraBasis.slice(6,9),radial)>.99);
  assert.ok(dot(issFrame(4192.39,.22,{yaw:0,pitch:-90}).cameraBasis.slice(6,9),radial)<-.99);
  assert.deepEqual(issFrame(4192.39,.22,{yaw:0,pitch:0}),base);
});


test('scroll elevation preserves camera attitude and ISS telemetry while moving the limb below the frame',()=>{
  for(const t of [0,1200,2800,4500])for(const [small,large] of [[741,821],[966,966]]){
    const start=sceneComposition(0,small,large,true),end=sceneComposition(small*.75,small,large,true);
    const base=issFrame(t,start.limb),raised=issFrame(t,end.limb,undefined,end.altitudeLift);
    assert.deepEqual(raised.cameraBasis,base.cameraBasis);
    assert.equal(raised.altitude,base.altitude);
    assert.equal(raised.latitude,base.latitude);
    assert.equal(raised.longitude,base.longitude);
    assert.ok(Math.hypot(...raised.camera)>Math.hypot(...base.camera));
    const radial=normalize(raised.camera),forward=raised.cameraBasis.slice(6,9);
    const pitch=-Math.asin(dot(forward,radial));
    const depression=Math.acos(1/Math.hypot(...raised.camera));
    const limb=.5+1.25*Math.tan(pitch-depression);
    assert.ok(limb<-.14&&limb>-.18,`raised limb ${limb}`);
  }
});


test('calendar starts now and survives a shared URL independently of route time',async()=>{
 const {SceneCalendar}=await import('../src/scripts/scene-calendar.ts');
 const now=Date.parse('2026-10-08T18:43:27Z'),seconds=1000;
 const clock=new SceneCalendar(new URLSearchParams(),seconds,now);
 assert.equal(clock.date(seconds).getTime(),now);
 assert.equal(clock.date(seconds+60).getTime(),now+60000);
 const params=new URLSearchParams();clock.write(params);
 assert.equal(new SceneCalendar(params,seconds,0).date(seconds).getTime(),now);
 assert.equal(new SceneCalendar(new URLSearchParams('epoch=garbage'),seconds,now).date(seconds).getTime(),now);
});

test('calendar sliders preserve the other component and handle leap years',async()=>{
 const {SceneCalendar,dayOfYear,daysInYear}=await import('../src/scripts/scene-calendar.ts');
 const clock=new SceneCalendar(new URLSearchParams(),0,Date.parse('2028-02-28T18:43:27Z'));
 assert.equal(daysInYear(2028),366);assert.equal(daysInYear(2027),365);
 clock.setDay(59,0);assert.equal(clock.date(0).toISOString(),'2028-02-29T18:43:27.000Z');
 clock.setMinute(60,0);assert.equal(clock.date(0).toISOString(),'2028-02-29T01:00:00.000Z');
 assert.equal(dayOfYear(clock.date(0)),59);
 clock.setDay(365,0);assert.equal(clock.date(0).toISOString(),'2028-12-31T01:00:00.000Z');
});

test('calendar changes sunlight without moving the observer or replay ground track',async()=>{
 const {calendarFrame}=await import('../src/scripts/scene-calendar.ts');
 const original=issFrame(1000),morning=calendarFrame(original,new Date('2026-06-21T00:00:00Z')),evening=calendarFrame(original,new Date('2026-06-21T12:00:00Z'));
 assert.deepEqual(morning.camera,original.camera);assert.deepEqual(evening.cameraBasis,original.cameraBasis);
 assert.ok(morning.sun.reduce((sum,v,i)=>sum+v*evening.sun[i],0)<-.65);
 assert.notEqual(morning.shadow,evening.shadow);
});
