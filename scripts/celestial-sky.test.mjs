import {test} from 'bun:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Body, Equator, Illumination, MakeTime, MoonPhase, Observer, ObserverVector, RotateVector, Rotation_EQJ_HOR, SiderealTime, Vector } from 'astronomy-engine';
import { celestialFrame, currentLunarLight, equatorialFrame, transform, galacticBasis, lunarSamples } from '../src/scripts/celestial-sky.ts';
import optics from '../src/data/optical-psf.json' with { type:'json' };
import { issFrame, dot, normalize } from '../src/scripts/iss-orbit.ts';
import { visibleSourceDisk } from '../src/scripts/lens-reflections.ts';
import { PointReflections } from '../src/scripts/point-reflections.ts';
import {pointImageFlux,pointBrightness} from '../src/scripts/point-photometry.ts';
import { srgbToP3,p3ToSrgb } from '../src/scripts/scene-color.ts';

const radians=Math.PI/180;
test('stellar reflection input preserves magnitude ratios and image-plane flux',()=>{
 const ghosts=new PointReflections(),identity=[1,0,0,0,1,0,0,0,1];
 const flux=(m,height)=>{ghosts.upload(new Float32Array([0,0,1,0,0,0,m,.45]));return ghosts.update(identity,identity,[0,0,1.07],0,[],1.5,1200,0,height)[2];};
 assert.ok(Math.abs(flux(-5,1000)/flux(0,1000)-100)<.001,'five magnitudes remain exactly 100x, with no saturation');
 assert.ok(Math.abs(flux(0,1000)/pointImageFlux(0,1000)-1)<1e-6);
 assert.ok(Math.abs(flux(0,2000)/flux(0,1000)-.25)<1e-6,'same ratio to a star PSF on a taller CSS image');
 assert.ok(Math.abs(pointImageFlux(0,1000)*1e6/pointBrightness(0)-optics.integral)<1e-12);
});
test('display gamut conversion preserves neutral colors and round-trips source colors',()=>{
  const multiply=(m,v)=>[0,1,2].map(i=>m[i]*v[0]+m[i+3]*v[1]+m[i+6]*v[2]);
  for(const color of [[0,0,0],[1,1,1],[.18,.18,.18],[.9,.08,.03],[.03,.8,.12],[.04,.2,.9]]){
    const converted=multiply(srgbToP3,color),roundTrip=multiply(p3ToSrgb,converted);
    color.forEach((x,i)=>assert.ok(Math.abs(x-roundTrip[i])<1e-7));
    if(color[0]===color[1]&&color[1]===color[2])converted.forEach(x=>assert.ok(Math.abs(x-color[0])<1e-7));
  }
  const p3Green=multiply(p3ToSrgb,[0,1,0]);
  assert.ok(p3Green[0]<0 && p3Green[1]>1,'saturated P3 green needs gamut mapping on sRGB');
});

test('point reflections select bright visible sources, cap their count and respect Earth occlusion',()=>{
  const ghosts=new PointReflections(),identity=[1,0,0,0,1,0,0,0,1];
  const data=[[-.2,-1],[-.1,0],[.1,.5],[.2,3]].flatMap(([x,m])=>[x,0,Math.sqrt(1-x*x),0,0,0,m,.45]);
  ghosts.upload(new Float32Array(data));
  const frame=(camera,time,planets=[])=>ghosts.update(identity,identity,camera,0,planets,1.5,966,time);
  const a=frame([0,0,1.07],0,[0,.1,Math.sqrt(.99),-2]);
  assert.equal(a.length,12);
  assert.equal([a[2],a[6],a[10]].filter(x=>x>0).length,3);
  assert.ok(a[2]>a[6]&&a[6]>a[10]);
  assert.deepEqual(frame([0,0,1.07],0,[0,.1,Math.sqrt(.99),-2]),a,'paused frame is stable');
  const hidden=frame([0,0,-1.07],100);
  assert.ok([hidden[2],hidden[6],hidden[10]].every(x=>x===0),'Earth blocks all sources');
  ghosts.upload(new Float32Array([0,0,1,0,0,0,3,.45]));
  const faint=frame([0,0,1.07],200);
  assert.ok([faint[2],faint[6],faint[10]].every(x=>x===0),'faint sources never generate chains');
});
const angle=(a,b)=>Math.atan2(Math.hypot(a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]),dot(a,b));
const fixed=(v,date)=>{
  const a=SiderealTime(date)*Math.PI/12,c=Math.cos(a),s=Math.sin(a);
  return [c*v.x+s*v.y,-s*v.x+c*v.y,v.z];
};

test('solar flare visibility follows the disk through the limb, including partial sunrise',()=>{
  const camera=[0,0,1.066],radius=.00465,limb=-Math.acos(1/camera[2]);
  let previous=-1;
  for(const height of [-2,-1,-.8,-.3,0,.3,.8,1,2]){
    const elevation=limb+height*radius;
    const direction=[Math.cos(elevation),0,Math.sin(elevation)];
    const visible=visibleSourceDisk(camera,direction,radius);
    assert.ok(visible>=previous && visible>=0 && visible<=1);
    previous=visible;
    // Independent disk quadrature and ray/sphere intersections.
    const up=[-Math.sin(elevation),0,Math.cos(elevation)];
    let clear=0;
    for(let i=0;i<4096;i++){
      const r=radius*Math.sqrt((i+.5)/4096),a=i*2.399963229728653;
      const ray=normalize(direction.map((v,k)=>v+up[k]*r*Math.cos(a)+(k===1?r*Math.sin(a):0)));
      const b=dot(camera,ray);
      if(!(b<0 && b*b-dot(camera,camera)+1>0))clear++;
    }
    assert.ok(Math.abs(visible-clear/4096)<.006,`limb offset ${height}`);
    if(height<=-1)assert.ok(visible<1e-8);
    if(height>=1)assert.ok(visible>1-1e-8);
  }
});

test('Galactic center and north pole align with their catalog equatorial directions',()=>{
  const basis=galacticBasis([1,0,0,0,1,0,0,0,1]);
  for(const [ra,dec,offset] of [[266.4051,-28.936175,0],[192.85948,27.12825,6]]){
    const expected=[Math.cos(dec*radians)*Math.cos(ra*radians),Math.cos(dec*radians)*Math.sin(ra*radians),Math.sin(dec*radians)];
    // Allow 15 arcseconds between the adopted transform and published landmarks.
    assert.ok(angle(expected,basis.slice(offset,offset+3))<15*radians/3600);
  }
});

test('lunar convolution conserves phase flux and removes Earth-occluded samples',()=>{
  const moon=[0,0,1,.0046],basis=[1,0,0,0,1,0,0,0,1];
  const flux=(sun,camera=[0,0,1.07])=>lunarSamples(moon,sun,basis,camera).filter((_,i)=>i%4===3).reduce((a,b)=>a+b,0);
  assert.ok(Math.abs(flux([0,0,-1])-2/3)<.002);
  assert.ok(Math.abs(flux([1,0,0])/(2/3)-1/Math.PI)<.01);
  assert.equal(flux([0,0,1]),0);
  assert.equal(flux([0,0,-1],[0,0,-1.07]),0);
});

test('lunar samples span both crescents and preserve source position and phase flux',()=>{
  // Sunlight turning through a phase cycle in the plane of the Moon's direction and celestial east (+Y here).
  const moon=[1,0,0,.0046],identity=[0,1,0,0,0,1,1,0,0],camera=[1.07,0,0];
  const sunlight=degrees=>[Math.cos(degrees*Math.PI/180),-Math.sin(degrees*Math.PI/180),0];
  const samples=degrees=>lunarSamples(moon,sunlight(degrees),identity,camera);
  const flux=degrees=>samples(degrees).filter((_,i)=>i%4===3).reduce((a,b)=>a+b,0);
  assert.equal(flux(0),0);assert.ok(flux(360)<1e-12);
  assert.ok(Math.abs(flux(180)-2/3)<.002);
  assert.ok(Math.abs(flux(90)/(2/3)-1/Math.PI)<.01);
  assert.ok(Math.abs(flux(90)-flux(270))<.005);
  assert.notDeepEqual(samples(90).filter((_,i)=>i%4===3),samples(270).filter((_,i)=>i%4===3));
  for(const degrees of [0,45,90,180,270,360]){
    assert.deepEqual(samples(degrees).filter((_,i)=>i%4!==3),samples(0).filter((_,i)=>i%4!==3));
  }
});

test('current lunar phase and waxing/waning follow the real date, independent of replay time',()=>{
  const phases=[];
  for(let day=1;day<=30;day++){
    const date=new Date(Date.UTC(2026,9,day,12));
    const expected=Illumination(Body.Moon,date).phase_fraction;
    phases.push(expected);
    for(const t of [1000,2800,4900]){
      const orbit=issFrame(t),sky=celestialFrame(orbit.date,orbit.camera);
      const light=currentLunarLight(date,sky.moon,sky.starToFixed);
      assert.ok(Math.abs(Math.hypot(...light)-1)<1e-12);
      // For a spherical disk, illuminated fraction is (1 + cos phase angle)/2.
      assert.ok(Math.abs((1-dot(light,sky.moon))/2-expected)<1e-10);
    }
    const identity=[1,0,0,0,1,0,0,0,1];
    const light=currentLunarLight(date,[1,0,0,.0046],identity);
    // East is +Y here: a waxing Moon's sunlit limb faces west, waning faces east.
    assert.equal(Math.sign(light[1]),MoonPhase(date)<180?-1:1);
  }
  assert.ok(Math.min(...phases)<.01&&Math.max(...phases)>.99);
});

test('changing the phase changes lunar light, but never its sampled position or occultation',()=>{
  const orbit=issFrame(1048,.22),sky=celestialFrame(orbit.date,orbit.camera);
  const samples=date=>lunarSamples(sky.moon,currentLunarLight(new Date(date),sky.moon,sky.starToFixed),orbit.cameraBasis,orbit.camera);
  const a=samples('2026-10-10T12:00:00Z'),b=samples('2026-10-26T12:00:00Z');
  assert.deepEqual(a.filter((_,i)=>i%4!==3),b.filter((_,i)=>i%4!==3));
  assert.notDeepEqual(a.filter((_,i)=>i%4===3),b.filter((_,i)=>i%4===3));
  let blocked=0;
  for(let i=0;i<a.length;i+=4){
    const ray=a.slice(i,i+3),projection=dot(orbit.camera,ray);
    if(projection<0&&projection**2-dot(orbit.camera,orbit.camera)+1>0){
      blocked++;
      assert.equal(a[i+3],0);
      assert.equal(b[i+3],0);
    }
  }
  assert.ok(blocked>0&&blocked<a.length/4);
});

test('iris atlas preserves equal spectral energy and zero boundaries at every opening',()=>{
  const data=readFileSync(new URL('../public/media/earthlight/optical-psf.bin',import.meta.url));
  assert.equal(data.length,optics.size**2*optics.states*3);
  for(let state=0;state<optics.states;state++)for(let c=0;c<3;c++){
    let sum=0;
    for(let y=0;y<optics.size;y++)for(let x=0;x<optics.size;x++){
      const code=data[((state*optics.size+y)*optics.size+x)*3+c];
      const value=Math.max(0,2**(code/255*26-24)-2**-24);
      sum+=value;
      if(x===0||y===0||x===optics.size-1||y===optics.size-1)assert.equal(value,0);
    }
    const integral=sum*(optics.span/optics.size)**2;
    assert.ok(Math.abs(integral/optics.integral-1)<.015,`iris ${state}, channel ${c}: ${integral}`);
  }
  // The wider, rounder pupil must strongly reduce blade angular modulation.
  const angularVariation=state=>{
    const sample=(x,y)=>{
      const i=((state*optics.size+y)*optics.size+x)*3;
      return (2**(data[i]/255*26-24)+2**(data[i+1]/255*26-24)+2**(data[i+2]/255*26-24))/3;
    };
    const values=Array.from({length:72},(_,i)=>{
      const angle=i/72*Math.PI*2;let sum=0;
      for(let r=24;r<60;r++)sum+=sample(Math.round(optics.size/2+Math.cos(angle)*r),Math.round(optics.size/2+Math.sin(angle)*r));
      return sum;
    });
    const mean=values.reduce((a,b)=>a+b)/values.length;
    return values.reduce((sum,v)=>sum+(v/mean-1)**2,0)/values.length;
  };
  assert.ok(angularVariation(optics.states-1)<angularVariation(0)*.3);
});

test('packed HYG contains real J2000 stars, magnitudes and proper motion',()=>{
  const file=readFileSync(new URL('../public/media/earthlight/stars-hyg.bin',import.meta.url));
  assert.equal(file.length,15598*32);
  const data=new DataView(file.buffer,file.byteOffset,file.byteLength);
  const stars=Array.from({length:15598},(_,i)=>Array.from({length:8},(_,j)=>data.getFloat32(i*32+j*4,true)));
  for(const star of stars){
    assert.ok(star.every(Number.isFinite));
    assert.ok(Math.abs(Math.hypot(...star.slice(0,3))-1)<1e-6);
    assert.ok(star[6]>=-1.5&&star[6]<=7);
  }
  const sirius=stars.reduce((a,b)=>a[6]<b[6]?a:b);
  assert.ok(Math.abs(sirius[6]+1.44)<.03);
  assert.ok(Math.abs(Math.atan2(sirius[1],sirius[0])/radians/15-6.75248)<.0001);
  assert.ok(Math.abs(Math.asin(sirius[2])/radians+16.7161)<.001);
  const advanced=normalize(sirius.slice(0,3).map((v,i)=>v+sirius[i+3]*26.76));
  // Sirius moves about 1.34 arcsec/year; ensure the velocity survives packing.
  const arcseconds=angle(advanced,sirius)*180/Math.PI*3600;
  assert.ok(arcseconds>30&&arcseconds<42);
});

test('J2000 stars agree with independent local horizon projections along the ISS track',()=>{
  for(const seconds of [0,1200,3000,4923.2]){
    const orbit=issFrame(seconds),{date,latitude,longitude,altitude}=orbit;
    const {starToFixed}=equatorialFrame(date);
    const lat=latitude*radians,lon=longitude*radians;
    const north=[-Math.sin(lat)*Math.cos(lon),-Math.sin(lat)*Math.sin(lon),Math.cos(lat)];
    const west=[Math.sin(lon),-Math.cos(lon),0];
    const zenith=[Math.cos(lat)*Math.cos(lon),Math.cos(lat)*Math.sin(lon),Math.sin(lat)];
    const rotation=Rotation_EQJ_HOR(date,new Observer(latitude,longitude,altitude*1000));
    for(const direction of [[1,0,0],[0,1,0],[0,0,1],normalize([.3,-.6,.8])]){
      const earth=transform(starToFixed,direction);
      const actual=[dot(earth,north),dot(earth,west),dot(earth,zenith)];
      const expected=RotateVector(rotation,new Vector(...direction,MakeTime(date)));
      assert.ok(Math.hypot(actual[0]-expected.x,actual[1]-expected.y,actual[2]-expected.z)<1e-10);
    }
  }
});

test('Moon and planets include observer parallax and agree with topocentric ephemerides',()=>{
  for(const [lat,lon] of [[0,0],[45,70],[-51,-140]]){
    const date=new Date('2026-10-06T01:35:47.000Z');
    const observer=new Observer(lat,lon,420000);
    const camera=fixed(ObserverVector(date,observer,true),date).map(x=>x*149597870.7/6371);
    const sky=celestialFrame(date,camera);
    const vectors=[sky.moon,...Array.from({length:5},(_,i)=>sky.planets.slice(i*4,i*4+4))];
    [Body.Moon,Body.Mercury,Body.Venus,Body.Mars,Body.Jupiter,Body.Saturn].forEach((body,i)=>{
      const expected=normalize(fixed(Equator(body,date,observer,true,true).vec,date));
      assert.ok(angle(expected,vectors[i])<5e-6,`${body} topocentric frame`);
    });
    assert.ok(sky.moon[3]>.004&&sky.moon[3]<.0055);
    const geocentric=celestialFrame(date,[0,0,0]);
    assert.ok(angle(sky.moon,geocentric.moon)>.001,'Moon parallax must not be discarded');
  }
});
