import { gstime } from 'satellite.js';
import { equatorialFrame } from './celestial-sky.ts';
import { issFrame, EARTH_RADIUS_KM as R, ISS_PERIOD_SECONDS, START_DATE, add, scale, dot, cross, normalize, type Vec3, type CameraView } from './iss-orbit.ts';

export type Orbit = 'iss'|'polar'|'high';
export type ObserverFrame = ReturnType<typeof issFrame>;
export type Pose = {camera:Vec3;cameraBasis:number[]};
export const MIN_ALTITUDE=150,MAX_ALTITUDE=50_000;
/** Degrees of roll within which the horizon counts as level, so H turns the view over instead. */
export const LEVEL_TOLERANCE=1;
export const ORBIT_LABELS={iss:'ISS orbit replay',polar:'Polar orbit',high:'High orbit'};
const rad=Math.PI/180;
const clamp=(x:number,a:number,b:number)=>Math.max(a,Math.min(b,x));
const tangent=(v:Vec3,n:Vec3)=>normalize(add(v,scale(n,-dot(v,n))));
const axis=(basis:number[],i:number)=>basis.slice(i,i+3) as Vec3;
export const altitude=(position:Vec3)=>(Math.hypot(...position)-1)*R;
export const altitudeAt=(position:number)=>MIN_ALTITUDE*(MAX_ALTITUDE/MIN_ALTITUDE)**clamp(position,0,1);
export const altitudePosition=(km:number)=>clamp(Math.log(km/MIN_ALTITUDE)/Math.log(MAX_ALTITUDE/MIN_ALTITUDE),0,1);
export const orbitPeriod=(orbit:Orbit)=>orbit==='iss'?ISS_PERIOD_SECONDS:2*Math.PI*Math.sqrt((R+(orbit==='polar'?800:20_000))**3/398600.4418);

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
export function orbitFrame(orbit:Orbit,seconds:number,view:CameraView={yaw:0,pitch:0},limb=.138):ObserverFrame{
 if(orbit==='iss')return issFrame(seconds,limb,view);
 const date=new Date(START_DATE.getTime()+seconds*1000),angle=seconds/orbitPeriod(orbit)*2*Math.PI;
 const inclination=(orbit==='polar'?90:25)*rad,distance=1+(orbit==='polar'?800:20_000)/R;
 const a=angle+.55,node=.7-gstime(date),c=Math.cos(node),s=Math.sin(node);
 const rotate=(v:Vec3):Vec3=>[c*v[0]-s*v[1],s*v[0]+c*v[1],v[2]];
 const camera=scale(rotate([Math.cos(a),Math.sin(a)*Math.cos(inclination),Math.sin(a)*Math.sin(inclination)]),distance);
 const along=rotate([-Math.sin(a),Math.cos(a)*Math.cos(inclination),Math.cos(a)*Math.sin(inclination)]);
 const elevation=orbit==='high'?-Math.PI/2:-Math.acos(1/distance)+Math.atan((.5-limb)/1.25);
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

// A free camera is a rig: a position and an attitude. Flying turns the whole
// rig about Earth's centre, so the view relative to the local horizon survives
// a lap around the planet. Nothing rebuilds orientation from north or the
// local vertical, so poles and nadir need no special cases.
type FreePose={position:Vec3;basis:number[]};
export type FlightInput={forward:number;right:number;climb:number;roll:number;yaw:number;pitch:number;lens:number;fast:boolean};
/** Pinhole distance in viewport heights at the wide end of the lens (1×,
 * about 30 mm full-frame). A zoomed lens multiplies it; every shader reads
 * the frame's own focal length. */
export const PROJECTION=1.25;
const smooth=(a:number,b:number,x:number)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
/** The level view \ returns to, facing `heading` along the ground: what
 * following an orbit at this height shows. Low, the horizon sits `limb` of the
 * frame up from the bottom, as from the ISS; once Earth's disk is less than
 * twice as tall as the frame the view tips down, and from about where the disk
 * fits, as from the high orbit, Earth is centred. */
export function horizonBasis(position:Vec3,heading:Vec3,focal=PROJECTION,limb=.138){
 const radius=Math.asin(1/Math.hypot(...position)),half=Math.atan(.5/focal),rest=Math.atan((.5-limb)/focal);
 return basisAt(position,heading,{yaw:0,pitch:0},-Math.PI/2+(radius+rest)*smooth(half,2*half,radius));
}
const wrap=(a:number)=>a-2*Math.PI*Math.round(a/(2*Math.PI));
const columns=(basis:number[])=>[axis(basis,0),axis(basis,3),axis(basis,6)];
const turnBasis=(basis:number[],about:Vec3,angle:number)=>columns(basis).flatMap(v=>rotate(v,about,angle));
const rollBasis=(basis:number[],angle:number)=>{
 const [right,up,forward]=columns(basis),c=Math.cos(angle),s=Math.sin(angle);
 return [...add(scale(right,c),scale(up,s)),...add(scale(up,c),scale(right,-s)),...forward];
};
function orthonormal(basis:number[]){
 const forward=normalize(axis(basis,6)),right=tangent(axis(basis,0),forward);
 return [...right,...normalize(cross(right,forward)),...forward];
}
// Turn one camera attitude toward another by a share of the way.
const turnToward=(from:number[],to:number[],t:number)=>blendPose({camera:[1,0,0],cameraBasis:from},{camera:[1,0,0],cameraBasis:to},t).cameraBasis;
const anyTangent=(n:Vec3)=>tangent(Math.abs(n[2])<.9?[0,0,1]:[1,0,0],n);
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
/** Where a ray appears, in viewport heights from the centre, y up. */
export const screenPoint=(basis:number[],ray:Vec3,focal=PROJECTION)=>{const z=Math.max(1e-6,dot(ray,axis(basis,6)));return [focal*dot(ray,axis(basis,0))/z,focal*dot(ray,axis(basis,3))/z];};
/** Screen offsets in viewport heights from the centre, y up. */
export const cameraRay=(basis:number[],x:number,y:number,focal=PROJECTION)=>normalize(add(add(scale(axis(basis,0),x),scale(axis(basis,3),y)),scale(axis(basis,6),focal)));
/** Where a ray meets Earth. A miss yields the limb point nearest the ray, so a
 * grab dragged into space slides along the horizon instead of jumping. */
export function earthPoint(camera:Vec3,ray:Vec3){
 const b=dot(camera,ray),h=b*b-dot(camera,camera)+1;
 if(b<0&&h>=0)return {point:normalize(add(camera,scale(ray,-b-Math.sqrt(h)))),hit:true};
 const distance=Math.hypot(...camera),down=scale(camera,-1/distance),side=add(ray,scale(down,-dot(ray,down)));
 const across=Math.hypot(...side)>1e-9?normalize(side):anyTangent(down);
 const limb=add(scale(down,Math.sqrt(1-1/(distance*distance))),scale(across,1/distance));
 return {point:normalize(add(camera,scale(limb,Math.sqrt(distance*distance-1)))),hit:false};
}
/** Image rotation of a reference direction: 0 when the horizon is level, sky up. */
export const horizonRoll=(basis:number[],vertical:Vec3)=>Math.atan2(dot(axis(basis,0),vertical),dot(axis(basis,3),vertical));
// Looking straight down or up the horizon has no angle; north up stands in.
const wrapAngle=(a:number)=>Math.atan2(Math.sin(a),Math.cos(a));
const levelRoll=(basis:number[],vertical:Vec3)=>horizonRoll(basis,Math.abs(dot(axis(basis,6),vertical))<.995?vertical:[0,0,1]);
// The ground direction toward the top of the image: the view's heading near
// the horizon, the image's up direction when looking straight down or up.
function groundHeading(basis:number[],vertical:Vec3):Vec3{
 const along=(v:Vec3)=>add(v,scale(vertical,-dot(v,vertical))),forward=axis(basis,6);
 const heading=add(along(forward),scale(along(axis(basis,3)),-dot(forward,vertical)));
 return Math.hypot(...heading)>1e-9?normalize(heading):anyTangent(vertical);
}
export function attitude(pose:Pose){
 const vertical=normalize(pose.camera),heading=groundHeading(pose.cameraBasis,vertical);
 const east:Vec3=Math.hypot(vertical[0],vertical[1])>1e-9?normalize(cross([0,0,1],vertical)):[0,1,0],north=cross(vertical,east);
 return {heading:(Math.atan2(dot(heading,east),dot(heading,north))/rad+360)%360,
  pitch:Math.asin(clamp(dot(axis(pose.cameraBasis,6),vertical),-1,1))/rad,roll:gaugeRoll(pose.cameraBasis,vertical)/rad};
}
/** Roll as the gauge shows it and H levels it: against the local vertical
 * right down to the nadir, so it turns smoothly there. The north-up stand-in
 * used to take over within about 6° of straight down, flipping the gauge; now
 * only an exactly vertical view, where the horizon has no angle, falls back. */
const gaugeRoll=(basis:number[],vertical:Vec3)=>Math.abs(dot(axis(basis,6),vertical))<1-1e-9?horizonRoll(basis,vertical):levelRoll(basis,vertical);
/** Following an orbit the camera turns only by yaw about the local vertical
 * and pitch above the horizon. Re-aim those angles so the direction under
 * screen point (x,y) keeps its place while the focal length changes from
 * `from` to `to`. Near zenith or nadir yaw mostly spins the image, so, like
 * the free camera's horizon hold, it fades there and the point may drift
 * rather than swing the picture around it. */
export function followLens(frame:Pose,view:CameraView,x:number,y:number,from:number,to:number):CameraView{
 if((!x&&!y)||from===to)return {...view};
 const vertical=normalize(frame.camera),level=tangent(axis(frame.cameraBasis,0),vertical),heading=cross(vertical,level);
 if(!level.every(Number.isFinite))return {...view};
 const target=cameraRay(frame.cameraBasis,x,y,from),pitch=Math.asin(clamp(dot(axis(frame.cameraBasis,6),vertical),-1,1));
 let yaw=0,next=pitch;
 for(let i=0;i<6;i++){
  const along=add(scale(heading,Math.cos(yaw)),scale(level,Math.sin(yaw))),right=add(scale(level,Math.cos(yaw)),scale(heading,-Math.sin(yaw)));
  const forward=add(scale(along,Math.cos(next)),scale(vertical,Math.sin(next))),up=add(scale(along,-Math.sin(next)),scale(vertical,Math.cos(next)));
  const ray=cameraRay([...right,...up,...forward],x,y,to),miss=add(ray,scale(target,-1));
  // How the ray moves per radian of yaw and of pitch, and what yaw costs.
  const a=cross(ray,vertical),b=cross(right,ray),spin=smooth(.8,.97,Math.abs(Math.sin(next)));
  const aa=dot(a,a)+spin,ab=dot(a,b),bb=dot(b,b)+1e-12,ga=-dot(a,miss)-spin*yaw,gb=-dot(b,miss),det=aa*bb-ab*ab;
  if(det<1e-18)break;
  let turn=(ga*bb-gb*ab)/det,tilt=(gb*aa-ga*ab)/det;
  // Pitch stops at zenith and nadir; then only yaw is left to solve.
  if(Math.abs(next+tilt)>Math.PI/2){tilt=Math.sign(next+tilt)*Math.PI/2-next;turn=(ga-ab*tilt)/aa;}
  yaw+=turn;next+=tilt;
 }
 return {yaw:((view.yaw+yaw/rad+180)%360+360)%360-180,pitch:clamp(view.pitch+(next-pitch)/rad,-90,90)};
}
export class FlightNavigation {
 orbit:Orbit='iss';
 free:FreePose|null=null;
 /** Lens focal length in viewport heights; PROJECTION is 1×, and the lens runs from half that to twenty times it. */
 focal=PROJECTION;
 // Rig angular velocity about Earth's centre (rad/s) and its decay without input.
 private velocity:Vec3=[0,0,0];
 private coast=.12;
 private climb=0;
 private rolling=0;
 private spin:[number,number]=[0,0];
 private targetAltitude:number|null=null;
 private zooming:{log:number;x:number;y:number}|null=null;
 private flight:{anchor:Vec3|null;ray:Vec3;from:[number,number];to:[number,number];log:number;done:number;time:number;duration:number}|null=null;
 private grip:{anchor:Vec3;x:number;y:number;sx:number;sy:number;rate:Vec3;releasing?:boolean}|null=null;
 /** Seconds over which a dragged point catches up with the pointer; 0 follows each event. */
 inputSmoothing=0;
 /** Fastest fling, radians per second, and its coasting time constant in seconds. */
 flingLimit=2;
 flingCoast=.45;
 private leveling=false;
 /** A world direction the camera is turning to face, read afresh each step. */
 private facing:(()=>Vec3)|null=null;
 /** The ground heading of the level view the camera is turning to. */
 private homing:Vec3|null=null;
 private levelTarget=0;
 private levelLeft=0;
 /** Camera velocity over the last step, Earth radii per second. */
 motion:Vec3=[0,0,0];
 private transition:{from:Pose;start:number}|null=null;
 get mode(){return this.free?'free':'follow';}
 get moving(){
  return Math.hypot(...this.velocity)>1e-6||this.climb!==0||this.rolling!==0||this.spin[0]!==0||this.spin[1]!==0||this.targetAltitude!==null
   ||this.zooming!==null||this.flight!==null||this.grip!==null||this.leveling||this.facing!==null||this.homing!==null||this.transition!==null;
 }
 read(seconds:number,view:CameraView,now:number):ObserverFrame{
  const target=this.free?observer(new Date(START_DATE.getTime()+seconds*1000),{camera:this.free.position,cameraBasis:this.free.basis}):orbitFrame(this.orbit,seconds,view);
  if(!this.transition)return target;
  const progress=clamp((now-this.transition.start)/1200,0,1);
  if(progress===1){this.transition=null;return target;}
  return observer(target.date,blendPose(this.transition.from,target,progress*progress*(3-2*progress)));
 }
 detach(frame:Pose,_view:CameraView){
  this.free={position:[...frame.camera],basis:[...frame.cameraBasis]};
  this.transition=null;this.stop();this.grip=null;
 }
 follow(orbit:Orbit,from:Pose,now:number,animate=true){
  this.orbit=orbit;this.free=null;this.stop();this.grip=null;this.transition=animate?{from,start:now}:null;
 }
 stop(){
  this.velocity=[0,0,0];this.motion=[0,0,0];this.coast=.12;this.climb=this.rolling=0;this.spin=[0,0];
  this.targetAltitude=null;this.zooming=null;this.flight=null;this.leveling=false;this.facing=null;this.homing=null;
 }
 setAltitude(km:number){if(this.free){this.stop();this.targetAltitude=clamp(km,MIN_ALTITUDE,MAX_ALTITUDE);}}
 private turnRig(about:Vec3,angle:number){
  const pose=this.free!;pose.position=rotate(pose.position,about,angle);pose.basis=orthonormal(turnBasis(pose.basis,about,angle));
  if(this.homing)this.homing=rotate(this.homing,about,angle);
 }
 // Turn the rig about Earth's centre until Earth-fixed `anchor` lies under (x,y).
 private pull(anchor:Vec3,x:number,y:number):Vec3{
  const pose=this.free!,under=earthPoint(pose.position,cameraRay(pose.basis,x,y,this.focal)).point;
  const about=cross(under,anchor),length=Math.hypot(...about);
  if(length<1e-12)return [0,0,0];
  const angle=Math.atan2(length,dot(under,anchor));
  this.turnRig(scale(about,1/length),angle);
  return scale(about,angle/length);
 }
 // Move along the line through an Earth point, scaling the distance to it by
 // e^log. That point keeps its place in the image, so Earth never leaves the
 // frame while climbing away from the horizon.
 private dolly(anchor:Vec3,log:number){
  const pose=this.free!,before=normalize(pose.position);
  pose.position=boundedMove(pose.position,scale(add(pose.position,scale(anchor,-1)),Math.exp(log)-1));
  this.orient(pose.basis,before);
 }
 private anchorAt(x:number,y:number){const pose=this.free!;return earthPoint(pose.position,cameraRay(pose.basis,x,y,this.focal));}
 private zoomAt(log:number,x:number,y:number){
  const pose=this.free!,hit=this.anchorAt(x,y),toward=()=>normalize(add(hit.point,scale(pose.position,-1)));
  // Off Earth, the horizon point keeps its place, drifting toward the pointer
  // while pulling away, so climbing out of a horizon view frames the planet.
  const [sx,sy]=screenPoint(pose.basis,toward(),this.focal),pull=hit.hit?1:log>0?1-Math.exp(-.6*log):0;
  this.dolly(hit.point,log);this.aim(toward(),sx+(x-sx)*pull,sy+(y-sy)*pull);
 }
 // Looking around never tips a level horizon. Near zenith or nadir the horizon
 // has no stable angle, so the hold fades and the camera turns freely. Once
 // the camera is rolled on purpose the hold lets go too: looking is then purely
 // about the camera's own axes, so the image slides instead of spinning. The
 // correction turns about `pivot`, the ray under the pointer, which therefore
 // stays exactly where it is.
 private orient(next:number[],before=normalize(this.free!.position),pivot=axis(next,6)){
  const pose=this.free!,vertical=normalize(pose.position),previous=horizonRoll(pose.basis,before);
  const level=Math.abs(previous)<3*rad;
  const hold=level?1-smooth(.8,.97,Math.abs(dot(axis(next,6),vertical))):0,drift=wrap(horizonRoll(next,vertical)-previous);
  let basis=next;
  // A drift past 90 degrees means the view went over a pole: that is a loop.
  if(hold>0&&Math.abs(drift)<Math.PI/2){
   const want=previous+drift*(1-hold);
   for(let i=0;i<4;i++)basis=turnBasis(basis,pivot,wrap(horizonRoll(basis,vertical)-want));
  }
  pose.basis=orthonormal(basis);
 }
 // Turn the camera so a world direction appears at screen point (x,y).
 private aim(direction:Vec3,x:number,y:number){
  const basis=this.free!.basis,from=cameraRay(basis,x,y,this.focal),about=cross(from,direction),length=Math.hypot(...about);
  if(length>1e-12)this.orient(turnBasis(basis,scale(about,1/length),Math.atan2(length,dot(from,direction))),undefined,direction);
 }
 /** Degrees about the camera's own axes. */
 turn(yaw:number,pitch:number){
  if(!this.free)return;
  const basis=this.free.basis,rotation=add(scale(axis(basis,3),-yaw*rad),scale(axis(basis,0),pitch*rad)),angle=Math.hypot(...rotation);
  if(angle>1e-12)this.orient(turnBasis(basis,scale(rotation,1/angle),angle));
 }
 /** Move the sky seen at one screen point to another, as a finger drags it. */
 turnBetween(x0:number,y0:number,x1:number,y1:number){if(this.free)this.aim(cameraRay(this.free.basis,x0,y0,this.focal),x1,y1);}
 /** Change the focal length without moving the camera. The world direction
  * under screen point (x,y) stays there; about the centre nothing turns.
  * Following an orbit, `followLens` re-aims the view angles instead. */
 setLens(focal:number,x=0,y=0){
  const previous=this.focal;this.focal=focal;
  if(this.free&&focal!==previous&&(x||y))this.aim(cameraRay(this.free.basis,x,y,previous),x,y);
 }
 roll(angle:number){if(this.free){this.free.basis=orthonormal(rollBasis(this.free.basis,angle));this.leveling=false;this.homing=null;}}
 spinLook(yaw:number,pitch:number){if(this.free)this.spin=[yaw,pitch];}
 /** Level the horizon; when it already is, turn the view upside down, and back.
  * A small correction takes the short way; a longer turn always runs clockwise. */
 level(now=false){
  if(!this.free)return;
  const pose=this.free,roll=gaugeRoll(pose.basis,normalize(pose.position));
  this.homing=null;this.levelTarget=Math.abs(roll)<LEVEL_TOLERANCE*rad?Math.PI:0;
  const left=wrapAngle(roll-this.levelTarget);
  this.levelLeft=Math.abs(left)<=Math.PI/2?left:left>0?left-2*Math.PI:left;
  this.leveling=true;
  if(now){pose.basis=orthonormal(rollBasis(pose.basis,-left));this.leveling=false;}
 }
 /** Turn to face a world direction, such as the Sun's, over a moment unless `now`. */
 face(direction:()=>Vec3,now=false){
  if(!this.free)return;
  this.flight=null;this.spin=[0,0];this.homing=null;this.facing=direction;
  if(now){this.aim(direction(),0,0);this.facing=null;}
 }
 /** Turn to the level view of `horizonBasis`, keeping the heading along the
  * ground (looking straight down, the way the top of the image points), over
  * a moment unless `now`. */
 horizon(now=false){
  if(!this.free)return;
  const pose=this.free;
  this.flight=null;this.spin=[0,0];this.facing=null;this.leveling=false;
  this.homing=groundHeading(pose.basis,normalize(pose.position));
  if(now){pose.basis=horizonBasis(pose.position,this.homing,this.focal);this.homing=null;}
 }
 /** Circle the camera about an Earth point, which keeps its place on screen:
  * `across` turns about the point's vertical, `up` raises the camera over it
  * (negative lowers it). The camera stays at least 5° above the point's
  * horizon, short of overhead, and above the lowest altitude. */
 circleAbout(anchor:Vec3,across:number,up:number){
  if(!this.free)return;
  const pose=this.free,vertical=normalize(anchor);
  const turned=(about:Vec3,angle:number)=>({position:add(anchor,rotate(add(pose.position,scale(anchor,-1)),about,angle)),basis:orthonormal(turnBasis(pose.basis,about,angle))});
  if(across){const next=turned(vertical,across);pose.position=next.position;pose.basis=next.basis;}
  if(up){
    // Straight overhead the offset gives no axis; the camera's up stands in for
    // the way back from the point, so lowering brings the horizon in at the top.
    const offset=add(pose.position,scale(anchor,-1)),across=cross(vertical,offset),overhead=Math.hypot(...across)<1e-6*Math.hypot(...offset);
    const side=overhead?cross(vertical,scale(axis(pose.basis,3),-1)):across,length=Math.hypot(...side);
    // A positive turn about vertical × offset lowers the camera toward the
    // horizon. Limits stop only the way toward them, so a camera low over a far point
    // can still rise; a step past one is halved until it fits.
    const height=(position:Vec3)=>dot(normalize(add(position,scale(anchor,-1))),vertical),now=height(pose.position);
    for(let angle=-up,i=0;length>1e-9&&i<6;i++,angle/=2){
      const next=turned(scale(side,1/length),angle),h=height(next.position),km=altitude(next.position);
      // A step must go the way asked: from overhead, where nothing is higher,
      // any turn would otherwise lower the camera.
      if((up>0?h>now:h<now)&&(h>now?h<Math.cos(.5*rad)&&km<=MAX_ALTITUDE:h>Math.sin(5*rad)&&km>=MIN_ALTITUDE)){pose.position=next.position;pose.basis=next.basis;break;}
    }
  }
  this.leveling=false;this.facing=null;this.homing=null;
 }
 /** Hold an Earth-fixed point under the pointer; the rig follows each frame. */
 grab(anchor:Vec3,x:number,y:number){if(this.free){this.stop();this.grip={anchor,x,y,sx:x,sy:y,rate:[0,0,0]};}}
 drag(x:number,y:number){if(this.grip){this.grip.x=x;this.grip.y=y;}}
 release(fling:boolean){
  const rate=this.grip?.rate,speed=rate?Math.hypot(...rate):0;
  if(fling&&rate&&speed>1e-3){this.velocity=scale(rate,Math.min(1,this.flingLimit/speed));this.coast=this.flingCoast;}
  // A smoothed grab still lands where the pointer was lifted, without a jump.
  else if(this.grip&&this.inputSmoothing>0){this.grip.releasing=true;return;}
  this.grip=null;
 }
 /** Spin the planet like a desk globe, about its centre: the surface under
  * (x,y) moves by (dx,dy) screen units. Unlike a grab, it never runs out of
  * travel at the limb. The swipe maps to the motion perpendicular to the line
  * to Earth's centre that looks like it on screen, so a swipe up rolls the
  * globe up, and over a horizon it slides the ground toward the horizon. */
 spinGlobe(dx:number,dy:number,x:number,y:number){
  if(!this.free)return;
  const turn=this.spinTurn(dx,dy,x,y);if(turn)this.turnRig(turn.axis,turn.angle);
 }
 /** Keep spinning at (vx,vy) screen units per second after a flick, then coast. */
 flingSpin(vx:number,vy:number,x:number,y:number){
  if(!this.free)return;
  const turn=this.spinTurn(vx,vy,x,y);if(!turn)return;
  this.velocity=scale(turn.axis,Math.min(turn.angle,this.flingLimit));this.coast=this.flingCoast;
 }
 private spinTurn(dx:number,dy:number,x:number,y:number):{axis:Vec3;angle:number}|null{
  const pose=this.free!,centre=normalize(scale(pose.position,-1)),forward=axis(pose.basis,6),facing=dot(forward,centre);
  const swipe=add(scale(axis(pose.basis,0),dx),scale(axis(pose.basis,3),dy));
  const motion=Math.abs(facing)>.05?add(swipe,scale(forward,-dot(swipe,centre)/facing)):add(swipe,scale(centre,-dot(swipe,centre)));
  const length=Math.hypot(...motion),travel=Math.hypot(dx,dy);
  if(length<1e-12||travel<1e-12)return null;
  const reach=Math.hypot(...add(this.anchorAt(x,y).point,scale(pose.position,-1)));
  return {axis:normalize(cross(centre,motion)),angle:travel*reach/this.focal};
 }
 /** Scale the distance to the Earth point under (x,y) by e^log; off Earth, the nearest horizon point. */
 zoom(log:number,x=0,y=0){if(this.free){this.flight=null;this.targetAltitude=null;this.zoomAt(log,x,y);}}
 zoomBy(log:number,x=0,y=0){if(this.free){this.flight=null;this.targetAltitude=null;this.zooming={log:(this.zooming?.log??0)+log,x,y};}}
 /** Approach an Earth point and centre it; a point in the sky is only centred. */
 flyTo(x:number,y:number,log:number,duration=.9){
  if(!this.free)return;
  const hit=this.anchorAt(x,y);
  this.stop();this.grip=null;
  this.flight={anchor:hit.hit?hit.point:null,ray:cameraRay(this.free.basis,x,y,this.focal),from:[x,y],to:log<0?[0,0]:[x,y],log:hit.hit?log:0,done:0,time:0,duration};
 }
 step(dt:number,input:Partial<FlightInput>={}){
  if(!this.free)return false;
  dt=clamp(dt,0,.05);
  const pose=this.free,before=[...pose.position,...pose.basis],fast=!!input.fast;
  const settle=(tau:number)=>1-Math.exp(-dt/tau);
  const vertical=normalize(pose.position),along=(v:Vec3)=>add(v,scale(vertical,-dot(v,vertical)));
  // Keys fly along the ground and never change altitude.
  const heading=groundHeading(pose.basis,vertical),screenRight=along(axis(pose.basis,0));
  const side=Math.hypot(...screenRight)>.2?normalize(screenRight):normalize(cross(heading,vertical));
  let direction=add(scale(heading,input.forward??0),scale(side,input.right??0));
  const length=Math.hypot(...direction);if(length>1)direction=scale(direction,1/length);
  if(length>0){
   this.coast=.12;
   const rate=Math.min(.6,Math.max(4,altitude(pose.position)*.55)/R)*(fast?3:1);
   this.velocity=add(this.velocity,scale(add(scale(cross(vertical,direction),rate),scale(this.velocity,-1)),settle(.12)));
  }else this.velocity=scale(this.velocity,1-settle(this.coast));
  const omega=Math.hypot(...this.velocity);
  // Below a hundredth of a degree per second a coasting planet has stopped.
  if(omega<(length>0?1e-6:5e-4))this.velocity=[0,0,0];else this.turnRig(scale(this.velocity,1/omega),omega*dt);
  // Climb away from the Earth point at the centre of the view (or its horizon),
  // multiplicatively, so 150 km and 50,000 km feel alike.
  this.climb+=((input.climb??0)*Math.log(2.5)*(fast?2.5:1)-this.climb)*settle(.12);
  if(Math.abs(this.climb)<1e-3)this.climb=0;
  if(this.climb)this.zoomAt(this.climb*dt,0,0);
  if(this.targetAltitude!==null){
   const height=altitude(pose.position),log=(Math.log(this.targetAltitude)-Math.log(height))*settle(.14);
   const start=[...pose.position];this.zoomAt(log,0,0);
   if(Math.abs(altitude(pose.position)-this.targetAltitude)<.05||start.every((v,i)=>Math.abs(v-pose.position[i])<1e-12))this.targetAltitude=null;
  }
  this.rolling+=((input.roll??0)*70*rad*(fast?2:1)-this.rolling)*settle(.08);
  if(input.roll){this.leveling=false;this.homing=null;}
  if(Math.abs(this.rolling)<1e-3)this.rolling=0;else pose.basis=orthonormal(rollBasis(pose.basis,this.rolling*dt));
  this.spin=this.spin.map(v=>Math.abs(v)<.05?0:v*(1-settle(.3))) as [number,number];
  // A longer lens turns slower, so the sky keeps its pace across the image.
  const look=60*(fast?2.5:1)*PROJECTION/this.focal,yaw=(input.yaw??0)*look+this.spin[0],pitch=(input.pitch??0)*look+this.spin[1];
  if(input.yaw||input.pitch)this.facing=this.homing=null;
  if(yaw||pitch)this.turn(yaw*dt,pitch*dt);
  if(this.zooming){
   const zoom=this.zooming,part=Math.abs(zoom.log)<1e-3?zoom.log:zoom.log*settle(.09);
   this.zoomAt(part,zoom.x,zoom.y);zoom.log-=part;if(zoom.log===0)this.zooming=null;
  }
  if(this.flight){
   const f=this.flight;f.time+=dt;
   const t=f.duration>0?clamp(f.time/f.duration,0,1):1,e=t*t*(3-2*t),x=f.from[0]+(f.to[0]-f.from[0])*e,y=f.from[1]+(f.to[1]-f.from[1])*e;
   if(f.anchor){this.dolly(f.anchor,f.log*(e-f.done));this.aim(normalize(add(f.anchor,scale(pose.position,-1))),x,y);}
   else this.aim(f.ray,x,y);
   f.done=e;if(t===1)this.flight=null;
  }
  if(this.grip){
   const grip=this.grip;
   // Pointer events can arrive in bursts while a frame is submitted; follow
   // them continuously so each display refresh moves by a similar amount.
   const follow=this.inputSmoothing>0?1-Math.exp(-dt/this.inputSmoothing):1;
   grip.sx+=(grip.x-grip.sx)*follow;grip.sy+=(grip.y-grip.sy)*follow;
   const turn=this.pull(grip.anchor,grip.sx,grip.sy);
   if(grip.releasing&&Math.hypot(grip.x-grip.sx,grip.y-grip.sy)<1e-5)this.grip=null;
   grip.rate=add(grip.rate,scale(add(scale(turn,1/Math.max(dt,1/240)),scale(grip.rate,-1)),settle(.05)));
  }
  if(this.leveling){
   // Measure the last quarter turn afresh, so the view ends exactly level.
   const roll=Math.abs(this.levelLeft)<Math.PI/2?wrapAngle(gaugeRoll(pose.basis,normalize(pose.position))-this.levelTarget):this.levelLeft;
   const part=Math.abs(roll)<1e-3?roll:roll*settle(.1);
   pose.basis=orthonormal(rollBasis(pose.basis,-part));this.levelLeft=roll-part;if(part===roll)this.leveling=false;
  }
  if(this.facing){
   // Turn toward the direction about the axis square to it and the view,
   // easing in, and land on it exactly.
   const forward=axis(pose.basis,6),target=this.facing(),about=cross(forward,target),across=Math.hypot(...about);
   const angle=Math.atan2(across,dot(forward,target));
   if(angle<1e-3){this.aim(target,0,0);this.facing=null;}
   else this.orient(turnBasis(pose.basis,across>1e-9?scale(about,1/across):axis(pose.basis,0),angle*settle(.12)));
  }
  if(this.homing){
   // Ease the whole attitude, pitch and roll together, and land on it exactly.
   const target=horizonBasis(pose.position,this.homing,this.focal),a=quaternion(pose.basis),b=quaternion(target);
   const angle=2*Math.acos(clamp(Math.abs(a.reduce((s,x,i)=>s+x*b[i],0)),0,1));
   if(angle<1e-3){pose.basis=target;this.homing=null;}
   else pose.basis=orthonormal(turnToward(pose.basis,target,settle(.12)));
  }
  const after=[...pose.position,...pose.basis];
  this.motion=dt>0?[0,1,2].map(i=>(after[i]-before[i])/dt) as Vec3:[0,0,0];
  return before.some((v,i)=>Math.abs(v-after[i])>1e-12);
 }
 restore(params:URLSearchParams){
  const orbit=params.get('orbit')??params.get('route');this.orbit=orbit==='polar'||orbit==='high'?orbit:'iss';
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
  for(const key of ['orbit','route','flight','position','heading','elevation','roll','orientation'])params.delete(key);
  if(this.orbit!=='iss')params.set('orbit',this.orbit);
  if(this.free){
   params.set('flight','free');params.set('position',this.free.position.map(v=>v.toFixed(8)).join(','));
   params.set('orientation',quaternion(this.free.basis).map(v=>v.toFixed(10)).join(','));
  }
 }
}
