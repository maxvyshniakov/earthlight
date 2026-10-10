// Selected dense cloud complexes move in the cloud atlas material frame.
// Their electrical activity is illustrative, not inferred from cloud whiteness.
import {stormRegions} from './storm-regions.ts';
export const MAX_STORM_LIGHTS=8;
const random=(seed:number)=>{const x=Math.sin(seed*127.1+311.7)*43758.5453;return x-Math.floor(x);};
type Stroke={start:number;width:number;energy:number};
type Flash={cell:number;strokes:Stroke[]};
const groups=stormRegions.map((cells,id)=>({cells,id,period:14+random(id+4)*18,offset:random(id+9)*32,cycle:NaN,events:[] as Flash[]}));

// Several nearby cells belong to one long-lived complex. A short activity
// episode visits neighbours; it is not one synchronized flash over the deck.
export function stormEpisode(id:number,cycle:number):Flash[]{
 const group=groups[id],seed=id*109+cycle*73,start=cycle*group.period-group.offset;
 const life=620+random(id+21)*760,phase=((start+random(id+31)*life)%life+life)%life/life;
 // Minutes of activity, followed by minutes of quiet, stable through seeks.
 if(phase>.68)return [];
 const envelope=Math.min(1,phase/.08,(.68-phase)/.10);
 const first=Math.floor(random(seed+2)*group.cells.length),count=1+Math.floor(random(seed+3)*3);
 const events:Flash[]=[];
 let delay=random(seed+4)*3;
 for(let j=0;j<count;j++){
  const eventSeed=seed+j*17,strokes:Stroke[]=[];
  let t=start+delay;
  const strength=(.65+random(eventSeed+6)*.85)*envelope;
  const pulses=1+Math.floor(random(eventSeed+7)*4);
  for(let k=0;k<pulses;k++){
   const width=.035+random(eventSeed+20+k)*.065;
   strokes.push({start:t,width,energy:strength*(k===0?1:.25+random(eventSeed+40+k)*.65)});
   t+=width+.025+random(eventSeed+60+k)*.09;
  }
  events.push({cell:(first+j)%group.cells.length,strokes});
  delay+=.8+random(eventSeed+9)*3.4;
 }
 return events;
}

// Analytic box integration of a triangular pulse: short strokes retain their
// energy at accelerated playback, independent of previous frames or seeks.
export function stormPulse(time:number,start:number,width:number,window:number){
  const primitive=(t:number)=>{const x=Math.max(0,Math.min(1,(t-start)/width));return width*(x<.5?x*x:.5-(1-x)*(1-x));};
  const interval=Math.max(.0001,window);
  return (primitive(time+interval/2)-primitive(time-interval/2))/interval;
}
export function stormLights(time:number,rate:number,camera:ArrayLike<number>,basis:ArrayLike<number>,aspect:number,fps=24){
 // Full-frame integration preserves short flashes at accelerated playback.
 const window=Math.max(1/48,Math.abs(rate)/fps),c=Math.cos(time*.000008),s=Math.sin(time*.000008);
 const active:Array<{point:number[];energy:number;score:number}>=[];
 const r=1+3.6/6371,radius=42/6371;
 const camera2=camera[0]**2+camera[1]**2+camera[2]**2;
 for(const group of groups){
  let visible=false;
  const points=group.cells.map(([x,y,z])=>[(c*x-s*y)*r,(s*x+c*y)*r,z*r]);
  const scores=points.map(([px,py,pz])=>{
   const dx=px-camera[0],dy=py-camera[1],dz=pz-camera[2];
   const depth=dx*basis[6]+dy*basis[7]+dz*basis[8];
   if(depth< -radius)return 0;
   const horizontal=dx*basis[0]+dy*basis[1]+dz*basis[2],vertical=dx*basis[3]+dy*basis[4]+dz*basis[5];
   if(Math.abs(horizontal)>Math.max(0,depth)*aspect/2.5+radius||Math.abs(vertical)>Math.max(0,depth)/2.5+radius)return 0;
   const distance2=dx*dx+dy*dy+dz*dz;
   if(camera2>1.01){
    const along=Math.max(0,Math.min(1,-(dx*camera[0]+dy*camera[1]+dz*camera[2])/distance2));
    if((camera[0]+dx*along)**2+(camera[1]+dy*along)**2+(camera[2]+dz*along)**2<.998**2)return 0;
   }
   visible=true;return 1/Math.max(.01,distance2);
  });
  if(!visible)continue;
  const cycle=Math.floor((time+group.offset)/group.period);
  if(group.cycle!==cycle){
   group.events=[-1,0,1].flatMap(k=>stormEpisode(group.id,cycle+k));group.cycle=cycle;
  }
  const energies=new Float64Array(points.length);
  for(const event of group.events){
   if(!scores[event.cell])continue;
   for(const stroke of event.strokes)energies[event.cell]+=stroke.energy*stormPulse(time,stroke.start,stroke.width,window);
  }
  for(let i=0;i<points.length;i++)if(energies[i]>.00001)active.push({point:points[i],energy:energies[i],score:energies[i]*scores[i]});
 }
 active.sort((a,b)=>b.score-a.score);
 const sources=new Float32Array(MAX_STORM_LIGHTS*4);
 for(let i=0;i<Math.min(active.length,MAX_STORM_LIGHTS);i++)sources.set([...active[i].point,active[i].energy],i*4);
 return sources;
}

export const stormLightShader=`
uniform vec4 stormSources[${MAX_STORM_LIGHTS}];
// Select the two contributing cells along this ray before marching the volume.
// Empty / distant candidates cost no texture reads, and inactive rays do no
// additional per-step lighting work.
void stormRaySources(vec3 ray,float entry,float end,out vec4 first,out vec4 second){
  first=vec4(0.);second=vec4(0.);
  float best=0.,next=0.;
  for(int i=0;i<${MAX_STORM_LIGHTS};i++){
    vec4 source=stormSources[i];
    if(source.w<=0.)continue;
    float distance=clamp(dot(source.xyz-cameraPosition,ray),entry,end);
    vec3 delta=cameraPosition+ray*distance-source.xyz;
    float km2=dot(delta,delta)*6371.*6371.;
    if(km2>1764.)continue;
    // Require a dense body AND a resolved dense center. Coarse map averages
    // must not admit a source into a gap in the detailed visible cloud.
    float body=cloudCoverage(source.xyz,.0025,false);
    if(body<.65)continue;
    float cover=cloudCoverage(source.xyz,.00035,true);
    source.w*=smoothstep(.70,.90,cover)*smoothstep(.65,.85,body);
    float score=source.w*exp(-km2/(2.*14.*14.));
    if(score>best){second=first;next=best;first=source;best=score;}
    else if(score>next){second=source;next=score;}
  }
}
vec3 stormCloudLight(vec3 point,vec4 source){
  if(source.w<=0.)return vec3(0.);
  vec3 material=normalize(cloudCoordinates(source.xyz));
  vec3 delta=cloudCoordinates(point-source.xyz)*6371.;
  float vertical=dot(delta,material);
  vec3 east=normalize(cross(vec3(0.,0.,1.),material));
  vec3 north=cross(material,east);
  // A short embedded channel lights connected pockets, not a round lamp.
  // Its footprint remains fixed in cloud material space during every stroke.
  float angle=dot(material,vec3(31.,17.,23.));
  vec2 p=rotate(angle)*vec2(dot(delta,east),dot(delta,north));
  vec2 branchA=p-vec2(6.,3.),branchB=p-vec2(-5.,2.);
  float spread=.35*exp(-dot(p/vec2(12.,8.),p/vec2(12.,8.))*.5)
    +7.*exp(-dot(p/vec2(5.,2.8),p/vec2(5.,2.8))*.5)
    +4.*exp(-dot(branchA/vec2(3.5,2.2),branchA/vec2(3.5,2.2))*.5)
    +3.*exp(-dot(branchB/vec2(2.5,2.),branchB/vec2(2.5,2.))*.5);
  spread*=exp(-vertical*vertical/18.);
  return vec3(.72,.80,1.)*source.w*spread;
}
`;
