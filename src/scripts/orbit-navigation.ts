import { gstime } from 'satellite.js';
import { equatorialFrame } from './celestial-sky.ts';
import { issFrame, EARTH_RADIUS_KM as R, ORBIT_SECONDS, START_DATE, add, scale, dot, cross, normalize, type Vec3, type CameraView } from './iss-orbit.ts';

export type Route = 'iss'|'polar'|'high';
export type ObserverFrame = ReturnType<typeof issFrame>;
export type Pose = {camera:Vec3;cameraBasis:number[]};
export const MIN_ALTITUDE=150,MAX_ALTITUDE=50_000;
export const ROUTE_LABELS={iss:'ISS orbit replay',polar:'Polar orbit',high:'High orbit'};
const rad=Math.PI/180;
const clamp=(x:number,a:number,b:number)=>Math.max(a,Math.min(b,x));
const tangent=(v:Vec3,n:Vec3)=>normalize(add(v,scale(n,-dot(v,n))));
const axis=(basis:number[],i:number)=>basis.slice(i,i+3) as Vec3;
export const altitude=(position:Vec3)=>(Math.hypot(...position)-1)*R;
export const altitudeAt=(position:number)=>MIN_ALTITUDE*(MAX_ALTITUDE/MIN_ALTITUDE)**clamp(position,0,1);
export const altitudePosition=(km:number)=>clamp(Math.log(km/MIN_ALTITUDE)/Math.log(MAX_ALTITUDE/MIN_ALTITUDE),0,1);
export const routePeriod=(route:Route)=>route==='iss'?ORBIT_SECONDS:2*Math.PI*Math.sqrt((R+(route==='polar'?800:20_000))**3/398600.4418);

function basisAt(position:Vec3,reference:Vec3,view:CameraView,elevation:number,roll=0){
 const up=normalize(position),along=tangent(reference,up),side=normalize(cross(along,up));
 const yaw=view.yaw*rad,pitch=clamp(elevation+view.pitch*rad,-Math.PI/2,Math.PI/2);
 const heading=add(scale(along,Math.cos(yaw)),scale(side,Math.sin(yaw)));
 const right=add(scale(side,Math.cos(yaw)),scale(along,-Math.sin(yaw)));
 const forward=add(scale(heading,Math.cos(pitch)),scale(up,Math.sin(pitch)));
 const cameraUp=normalize(cross(right,forward));
 return [...add(scale(right,Math.cos(roll)),scale(cameraUp,Math.sin(roll))),...add(scale(cameraUp,Math.cos(roll)),scale(right,-Math.sin(roll))),...forward];
}
function observer(date:Date,pose:Pose):ObserverFrame{
 const n=normalize(pose.camera),{sun}=equatorialFrame(date),solar=dot(n,sun),distance=Math.hypot(...pose.camera);
 return {...pose,date,sun,solar,right:axis(pose.cameraBasis,0),up:axis(pose.cameraBasis,3),forward:axis(pose.cameraBasis,6),
  latitude:Math.asin(clamp(n[2],-1,1))/rad,longitude:Math.atan2(n[1],n[0])/rad,altitude:altitude(pose.camera),
  shadow:solar<-Math.sqrt(1-1/(distance*distance))?1:0,
  phase:solar>.08?'Day':solar<-.12?'Night':'Twilight'};
}
export function routeFrame(route:Route,seconds:number,view:CameraView={yaw:0,pitch:0},limb=.138):ObserverFrame{
 if(route==='iss')return issFrame(seconds,limb,view);
 const date=new Date(START_DATE.getTime()+seconds*1000),angle=seconds/routePeriod(route)*2*Math.PI;
 const inclination=(route==='polar'?90:25)*rad,distance=1+(route==='polar'?800:20_000)/R;
 const a=angle+.55,node=.7-gstime(date),c=Math.cos(node),s=Math.sin(node);
 const rotate=(v:Vec3):Vec3=>[c*v[0]-s*v[1],s*v[0]+c*v[1],v[2]];
 const camera=scale(rotate([Math.cos(a),Math.sin(a)*Math.cos(inclination),Math.sin(a)*Math.sin(inclination)]),distance);
 const along=rotate([-Math.sin(a),Math.cos(a)*Math.cos(inclination),Math.cos(a)*Math.sin(inclination)]);
 const elevation=route==='high'?-Math.PI/2:-Math.acos(1/distance)+Math.atan((.5-limb)/1.25);
 return observer(date,{camera,cameraBasis:basisAt(camera,along,view,elevation)});
}

// Follow a great circle instead of interpolating through the planet.
function rotationBetween(a:Vec3,b:Vec3){
 const c=clamp(dot(a,b),-1,1),v=cross(a,b),length=Math.hypot(...v);
 const axis=length>1e-8?scale(v,1/length):normalize(cross(a,Math.abs(a[2])<.8?[0,0,1]:[0,1,0]));
 return {axis,angle:Math.acos(c)};
}
function rotate(v:Vec3,axis:Vec3,angle:number):Vec3{
 return add(add(scale(v,Math.cos(angle)),scale(cross(axis,v),Math.sin(angle))),scale(axis,dot(axis,v)*(1-Math.cos(angle))));
}
// Interpolate a proper rotation: renderer bases use +Z forward, so negate it
// when converting to/from right-handed quaternions.
function quaternion(b:number[]){
 const m=[b[0],b[3],-b[6],b[1],b[4],-b[7],b[2],b[5],-b[8]],q=[0,0,0,0],trace=m[0]+m[4]+m[8];
 if(trace>0){const s=Math.sqrt(trace+1)*2;q[3]=s/4;q[0]=(m[7]-m[5])/s;q[1]=(m[2]-m[6])/s;q[2]=(m[3]-m[1])/s;}
 else {const i=m[0]>m[4]&&m[0]>m[8]?0:m[4]>m[8]?1:2,j=(i+1)%3,k=(i+2)%3,s=Math.sqrt(1+m[i*3+i]-m[j*3+j]-m[k*3+k])*2;
  q[i]=s/4;q[j]=(m[j*3+i]+m[i*3+j])/s;q[k]=(m[k*3+i]+m[i*3+k])/s;q[3]=(m[k*3+j]-m[j*3+k])/s;}
 return q;
}
export function blendPose(from:Pose,to:Pose,t:number):Pose{
 const n=normalize(from.camera),turn=rotationBetween(n,normalize(to.camera));
 const camera=scale(rotate(n,turn.axis,turn.angle*t),Math.hypot(...from.camera)*(1-t)+Math.hypot(...to.camera)*t);
 const a=quaternion(from.cameraBasis),b=quaternion(to.cameraBasis);
 let cosine=a.reduce((s,x,i)=>s+x*b[i],0);if(cosine<0){b.forEach((x,i)=>b[i]=-x);cosine=-cosine;}
 const angle=Math.acos(clamp(cosine,-1,1)),s=Math.sin(angle);
 const q=a.map((x,i)=>s<.0001?x*(1-t)+b[i]*t:(x*Math.sin((1-t)*angle)+b[i]*Math.sin(t*angle))/s);
 return {camera,cameraBasis:basisFromQuaternion(q)};
}
function basisFromQuaternion(q:number[]){
 const length=Math.hypot(...q);const [x,y,z,w]=q.map(v=>v/length);
 const right=[1-2*(y*y+z*z),2*(x*y+w*z),2*(x*z-w*y)];
 const up=[2*(x*y-w*z),1-2*(x*x+z*z),2*(y*z+w*x)];
 const back=[2*(x*z+w*y),2*(y*z-w*x),1-2*(x*x+y*y)];
 return [...right,...up,...back.map(v=>-v)];
}

// A free camera owns its orientation. Position and the planet's local vertical
// must never reconstruct that orientation, even when crossing a pole or nadir.
type FreePose={position:Vec3;basis:number[]};
// Clip the entire movement segment, so a large gesture cannot tunnel through Earth.
function boundedMove(start:Vec3,delta:Vec3):Vec3{
 const length=Math.hypot(...delta);if(length<1e-12)return start;
 const direction=scale(delta,1/length),b=dot(start,direction),r2=dot(start,start);
 const inner=1+MIN_ALTITUDE/R,outer=1+MAX_ALTITUDE/R;
 let travel=length;
 const hit=b*b-r2+inner*inner;
 if(b<0&&hit>=0)travel=Math.min(travel,Math.max(0,-b-Math.sqrt(hit)));
 travel=Math.min(travel,Math.max(0,-b+Math.sqrt(Math.max(0,b*b-r2+outer*outer))));
 return add(start,scale(direction,travel));
}
export class OrbitNavigation {
 route:Route='iss';
 free:FreePose|null=null;
 private velocity:Vec3=[0,0,0];
 private targetAltitude:number|null=null;
 private transition:{from:Pose;start:number}|null=null;
 get mode(){return this.free?'free':'follow';}
 get moving(){return Math.hypot(...this.velocity)>.000001||this.targetAltitude!==null||this.transition!==null;}
 read(seconds:number,view:CameraView,now:number):ObserverFrame{
  const target=this.free?observer(new Date(START_DATE.getTime()+seconds*1000),{camera:this.free.position,cameraBasis:this.free.basis}):routeFrame(this.route,seconds,view);
  if(!this.transition)return target;
  const progress=clamp((now-this.transition.start)/1200,0,1);
  if(progress===1){this.transition=null;return target;}
  return observer(target.date,blendPose(this.transition.from,target,progress*progress*(3-2*progress)));
 }
 detach(frame:Pose,_view:CameraView){
  this.free={position:[...frame.camera],basis:[...frame.cameraBasis]};
  this.transition=null;this.stop();
 }
 follow(route:Route,from:Pose,now:number,animate=true){
  this.route=route;this.free=null;this.stop();this.transition=animate?{from,start:now}:null;
 }
 stop(){this.velocity=[0,0,0];this.targetAltitude=null;}
 setAltitude(km:number){if(this.free)this.targetAltitude=clamp(km,MIN_ALTITUDE,MAX_ALTITUDE);}
 private gesturePose(_view:CameraView){
  return this.free?{camera:this.free.position,cameraBasis:this.free.basis}:null;
 }
 private viewDepth(pose:Pose){
  const b=dot(pose.camera,axis(pose.cameraBasis,6)),hit=b*b-dot(pose.camera,pose.camera)+1;
  return b<0&&hit>=0?Math.max(MIN_ALTITUDE/R,-b-Math.sqrt(hit)):Math.max(MIN_ALTITUDE/R,altitude(pose.camera)/R);
 }
 pan(view:CameraView,dx:number,dy:number,height:number){
  const pose=this.gesturePose(view);if(!pose)return;
  this.stop();
  const delta=scale(add(scale(axis(pose.cameraBasis,0),-dx),scale(axis(pose.cameraBasis,3),dy)),this.viewDepth(pose)/(1.25*Math.max(1,height)));
  this.free!.position=boundedMove(pose.camera,delta);
 }
 zoom(view:CameraView,delta:number){
  const pose=this.gesturePose(view);if(!pose)return;
  this.stop();
  const distance=this.viewDepth(pose)*(1-Math.exp(clamp(delta,-240,240)*.005));
  this.free!.position=boundedMove(pose.camera,scale(axis(pose.cameraBasis,6),distance));
 }
 turn(yaw:number,pitch:number){
  if(!this.free)return;
  const basis=this.free.basis;
  // Rotate about camera-local axes, with no pitch clamp or planet-up vector.
  const rotation=add(scale(axis(basis,3),-yaw*rad),scale(axis(basis,0),pitch*rad));
  const angle=Math.hypot(...rotation);if(angle<1e-12)return;
  const direction=scale(rotation,1/angle);
  const forward=normalize(rotate(axis(basis,6),direction,angle));
  const right=tangent(rotate(axis(basis,0),direction,angle),forward);
  this.free.basis=[...right,...normalize(cross(right,forward)),...forward];
 }
 step(dt:number,_view:CameraView,input:Vec3,fast:boolean){
  if(!this.free)return false;
  dt=clamp(dt,0,.05);
  const old=this.free.position,basis=this.free.basis;
  let direction=add(add(scale(axis(basis,6),input[0]),scale(axis(basis,0),input[1])),scale(axis(basis,3),input[2]));
  const length=Math.hypot(...direction);if(length>1)direction=scale(direction,1/length);
  const speed=Math.max(4,altitude(old)*.55)*(fast?4:1)/R;
  const blend=1-Math.exp(-dt/.12);
  this.velocity=add(scale(this.velocity,1-blend),scale(direction,speed*blend));
  let next=boundedMove(old,scale(this.velocity,dt));
  if(this.targetAltitude!==null){
   const current=altitude(next),value=current+(this.targetAltitude-current)*(1-Math.exp(-dt/.14));
   next=scale(normalize(next),1+value/R);
   if(Math.abs(value-this.targetAltitude)<.05)this.targetAltitude=null;
  }
  const h=clamp(altitude(next),MIN_ALTITUDE,MAX_ALTITUDE);next=scale(normalize(next),1+h/R);
  this.free.position=next;
  if(Math.hypot(...this.velocity)<.000001)this.velocity=[0,0,0];
  return Math.hypot(...add(next,scale(old,-1)))>1e-10;
 }
 restore(params:URLSearchParams){
  const route=params.get('route');this.route=route==='polar'||route==='high'?route:'iss';
  const vector=(key:string)=>{const raw=params.get(key)?.split(',');const parts=raw?.map(Number);return parts?.length===3&&raw!.every(x=>x.trim()!=='')&&parts.every(x=>Number.isFinite(x)&&Math.abs(x)<100)?parts as Vec3:null;};
  const position=vector('position');
  if(params.get('flight')!=='free'||!position||Math.hypot(...position)<=1)return;
  const location=scale(normalize(position),1+clamp(altitude(position),MIN_ALTITUDE,MAX_ALTITUDE)/R);
  if(params.has('orientation')){
   const raw=params.get('orientation')!.split(','),q=raw.map(Number);
   if(q.length===4&&raw.every(v=>v.trim()!=='')&&q.every(v=>Number.isFinite(v)&&Math.abs(v)<=1.001)&&Math.hypot(...q)>.1){
    this.free={position:location,basis:basisFromQuaternion(q)};
   }
   return;
  }
  // Old shared links used a tangent heading and Earth-relative angles. Convert
  // that pose once; subsequent flight is fully independent of the local horizon.
  const heading=vector('heading'),elevation=Number(params.get('elevation')),roll=Number(params.get('roll'));
  if(heading&&Math.hypot(...heading)>.1&&Number.isFinite(elevation)&&Math.abs(elevation)<=Math.PI*2&&Number.isFinite(roll)&&Math.abs(roll)<=Math.PI){
   const n=normalize(position),projected=add(heading,scale(n,-dot(heading,n)));
   const angle=(key:string,limit:number)=>{const value=Number(params.get(key));return Number.isFinite(value)?clamp(value,-limit,limit):0;};
   if(Math.hypot(...projected)>.001)this.free={position:location,basis:basisAt(location,normalize(projected),{yaw:angle('yaw',180),pitch:angle('pitch',90)},elevation,roll)};
  }
 }

 write(params:URLSearchParams){
  for(const key of ['route','flight','position','heading','elevation','roll','orientation'])params.delete(key);
  if(this.route!=='iss')params.set('route',this.route);
  if(this.free){
   params.set('flight','free');params.set('position',this.free.position.map(v=>v.toFixed(8)).join(','));
   params.set('orientation',quaternion(this.free.basis).map(v=>v.toFixed(10)).join(','));
  }
 }
}
