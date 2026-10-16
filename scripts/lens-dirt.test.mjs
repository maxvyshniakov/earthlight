import {test} from 'bun:test';
import assert from 'node:assert/strict';
import {VEIL_LOBES,VEIL_PATTERN_SCALE,VEIL_LOBE_SHARE,VEIL_OFFSET_LOBES,SMUDGE_FOOTPRINT,CLEANING_SWIRL,SENSOR_DUST,WINDOW_DUST,FRAME_HEIGHT_MM} from '../src/scripts/lens-dirt.ts';
import {VEIL_COMPONENTS} from '../src/scripts/solar-light.ts';

// Script twins of veilPattern and veilLobes in lens-dirt.ts.
const pattern=(x,y,wavelength)=>{
  const r=Math.max(Math.hypot(x,y)/wavelength,1e-5),a=Math.atan2(y,x),t=Math.log(r/VEIL_PATTERN_SCALE);
  return VEIL_LOBES.reduce((m,[order,amp,phase,twist])=>m+amp*Math.cos(order*a+phase+twist*t),1);
};
const smoothstep=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
const total=VEIL_OFFSET_LOBES.reduce((t,[share])=>t+share,0);
const cover=([sx,sy],[px,py],radius)=>1-smoothstep(.4,1,Math.hypot(sx/SMUDGE_FOOTPRINT-px,sy/SMUDGE_FOOTPRINT-py)/(1+radius));
const lobeCover=sun=>VEIL_OFFSET_LOBES.reduce((t,[share,,,,place,radius])=>t+share/total*cover(sun,place,radius),0);
const lobes=(x,y,sun)=>VEIL_OFFSET_LOBES.reduce((sum,[share,[ox,oy],[a,b],angle,place,radius])=>{
  const dx=x-ox,dy=y-oy,u=(dx*Math.cos(angle)+dy*Math.sin(angle))/a,v=(-dx*Math.sin(angle)+dy*Math.cos(angle))/b;
  return sum+share/total*cover(sun,place,radius)/(Math.PI*a*b)*(1+u*u+v*v)**-2;
},0);
const swirlSpot=([sx,sy])=>[sx/SMUDGE_FOOTPRINT-CLEANING_SWIRL.place[0],sy/SMUDGE_FOOTPRINT-CLEANING_SWIRL.place[1]];
const swirlCover=sun=>1-smoothstep(.6,1,Math.hypot(...swirlSpot(sun))/(CLEANING_SWIRL.extent+1));
const swirlRing=(x,y,sun,wavelength)=>{
  const [vx,vy]=swirlSpot(sun),offset=Math.hypot(vx,vy),m=.45*offset/(offset+1.5);
  const r=Math.max(Math.hypot(x,y),.0005),a=Math.atan2(y,x)-Math.atan2(vy,vx+1e-6),w=CLEANING_SWIRL.width;
  return (1+m*Math.cos(2*a))*Math.exp(-.5*((r-CLEANING_SWIRL.ring*wavelength)/w)**2)/(2*Math.PI*r*w*Math.sqrt(2*Math.PI));
};
const taken=sun=>VEIL_LOBE_SHARE*lobeCover(sun)+CLEANING_SWIRL.share*swirlCover(sun);
const radial=(r2,sun)=>(1-taken(sun))*VEIL_COMPONENTS.reduce((sum,{share,scale})=>sum+share/(Math.PI*scale*scale)*(1+r2/(scale*scale))**-2,0);

test('the dirty veil scatters exactly the clean veil\'s light, only redistributed',()=>{
  assert.ok(VEIL_LOBES.reduce((s,[,amp])=>s+amp,0)<1,'the angular pattern never turns the kernel negative');
  // Lobe shares are relative: normalized by their sum, so lit smudges never
  // take more than VEIL_LOBE_SHARE.
  assert.ok(VEIL_OFFSET_LOBES.every(([share])=>share>0));
  // Polar integration out to 40 rad radius (the kernel's own tail beyond is
  // below 0.2%), log-spaced in radius so the 0.015 rad core is resolved.
  // Smudges light and fade as the Sun moves; the veil's integral must not.
  const suns=[[0,0],[-.2,.3],[.3,.1],[.1,-.35],[-.4,-.2]];
  const covers=suns.map(lobeCover);
  assert.ok(Math.max(...covers)-Math.min(...covers)>.3,`smudges light and fade across the field: ${covers.map(c=>c.toFixed(2))}`);
  for(const sun of suns)for(const wavelength of [610/540,1,460/540]){
    let integral=0,minimum=Infinity;const radii=300,angles=480,r0=1e-4,r1=40;
    for(let i=0;i<radii;i++){
      const ra=r0*(r1/r0)**(i/radii),rb=r0*(r1/r0)**((i+1)/radii),r=Math.sqrt(ra*rb),dr=rb-ra;
      for(let j=0;j<angles;j++){
        const a=(j+.5)/angles*2*Math.PI,x=r*Math.cos(a),y=r*Math.sin(a);
        const k=radial(r*r,sun)*pattern(x,y,wavelength)+VEIL_LOBE_SHARE*lobes(x,y,sun)+CLEANING_SWIRL.share*swirlCover(sun)*swirlRing(x,y,sun,wavelength);
        minimum=Math.min(minimum,k);integral+=k*r*dr*2*Math.PI/angles;
      }
    }
    assert.ok(minimum>0,'kernel stays positive');
    assert.ok(Math.abs(integral-1)<.01,`veil integrates to one at wavelength ${wavelength}, Sun ${sun}: ${integral}`);
  }
},60000);

test('the cleaning swirl is a round ring, red outside, brighter sides turning with the Sun',()=>{
  const peak=(sun,wavelength,angle)=>{let best=0,at=0;for(let r=.02;r<.2;r+=.0005){const v=swirlRing(r*Math.cos(angle),r*Math.sin(angle),sun,wavelength);if(v>best){best=v;at=r;}}return at;};
  const sun=[.3,.25],[vx,vy]=swirlSpot(sun),toward=Math.atan2(vy,vx);
  assert.ok(peak(sun,610/540,toward)>peak(sun,460/540,toward)*1.2,'red ring is larger than blue');
  const arc=(s,angle)=>swirlRing(.1*Math.cos(angle),.1*Math.sin(angle),s,1);
  const along=arc(sun,toward),across=arc(sun,toward+Math.PI/2);
  assert.ok(across>0&&along/across<2.7,'the ring stays round: its dimmest side is at least 37% of its brightest');
  assert.ok(along>across*1.2,'off axis it is brighter along the spot direction');
  const other=[-.4,.25],[ox,oy]=swirlSpot(other),otherward=Math.atan2(oy,ox);
  assert.ok(Math.abs(toward-otherward)>.5,'moving the Sun turns the brighter sides');
  assert.ok(arc(other,otherward)>arc(other,toward),'the brighter sides follow the Sun');
});

test('dust is a hint: shadows at most a fifth deep at f/16, window specks faint and sized by the pupil',()=>{
  for(const [, , z, d] of SENSOR_DUST){
    const depth=n=>Math.min(.35,(d*n/z)**2);
    assert.ok(depth(16)>depth(4)*10,'stopping down darkens the shadow');
    assert.ok(depth(16)<.2,`a sensor dust shadow stays a hint: ${depth(16)}`);
  }
  // A 50 µm speck 12-25 cm from a 3 mm pupil forward-scatters a few 1e-6 of
  // the light entering the lens back into it: far below any ghost path.
  for(const [x,y,z,share] of WINDOW_DUST){
    assert.ok(share<1e-5,'window dust stays far below the ghosts');
    // Disc radius in frame heights: focal² · frame / (2 N z); 1× is focal 1.25.
    const radius=(focal,n)=>focal*focal*FRAME_HEIGHT_MM/(2*n*z);
    assert.ok(Math.abs(radius(2.5,9.4)/radius(1.25,9.4)-4)<1e-9,'zooming 2× makes the speck 4× larger');
    assert.ok(radius(1.25,16)<radius(1.25,4),'stopping down shrinks it');
    assert.ok(Math.hypot(x,y)<.6,'the speck sits within the widest view');
  }
});
