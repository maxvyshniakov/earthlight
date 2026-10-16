import { cameraRay, earthPoint, type FlightNavigation, type ObserverFrame } from './flight-navigation.ts';
import type { Vec3 } from './iss-orbit.ts';

/** Approach moves the camera; lens zooms the image and never moves it. */
export type CameraAction='fly'|'look'|'approach'|'lens'|'roll';
export type CameraIntent='auto'|'look'|'roll'|'circle';
export type CameraSession={readonly kind:'fly'|'look'|'roll'|'circle';move(clientX:number,clientY:number):void;end(fling?:boolean):void};
export type ScrollSession={readonly kind:'fly'|'look';by(dx:number,dy:number):void};
type Options={
  canvas:HTMLCanvasElement;
  navigation:FlightNavigation;
  frame:()=>ObserverFrame;
  ready:()=>boolean;
  detach:()=>void;
  followLook:(dx:number,dy:number)=>void;
  /** Lens zoom by e^log about screen point (x,y); positive magnifies. */
  lens:(log:number,x:number,y:number,smooth:boolean)=>void;
  changed:()=>void;
  request:()=>void;
  /** A double-click's target: the Earth point it flies toward, if it hit one. */
  marked:(clientX:number,clientY:number,anchor?:Vec3)=>void;
  /** The point a right-drag circles, while it does; null when it ends. */
  pin:(anchor:Vec3|null)=>void;
  reducedMotion:()=>boolean;
};

/** One meaning per gesture on every device. The plain gesture moves over Earth
 * wherever it starts: a point of Earth stays under the pointer, and off the
 * planet the globe turns like a scroll. Shift, the middle button or two fingers
 * turn the camera instead; Option or a twist rolls; the right button circles
 * the point under the pointer. */
export function createCameraController(o:Options){
  const nav=o.navigation;
  const screen=(clientX:number,clientY:number)=>{
    const r=o.canvas.getBoundingClientRect(),h=Math.max(1,r.height);
    return {x:(clientX-r.left-r.width/2)/h,y:(r.top+r.height/2-clientY)/h};
  };
  // A longer lens turns less per pixel, so the sky stays under the finger.
  const degreesPerPixel=()=>180/Math.PI/(nav.focal*Math.max(1,o.canvas.getBoundingClientRect().height));
  const pick=(clientX:number,clientY:number)=>{const f=o.frame(),p=screen(clientX,clientY);return earthPoint(f.camera,cameraRay(f.cameraBasis,p.x,p.y,nav.focal));};
  const free=()=>{if(!nav.free)o.detach();};
  const look=(x0:number,y0:number,x1:number,y1:number)=>{
    if(nav.free){const a=screen(x0,y0),b=screen(x1,y1);nav.turnBetween(a.x,a.y,b.x,b.y);}
    else o.followLook(x1-x0,y1-y0);
    o.changed();
  };
  // gain > 1 turns Earth faster than the pointer moves (touch sensitivity).
  // spin turns the globe like a trackpad scroll instead of holding a point,
  // so a drag never runs out of travel at the limb; a flick keeps spinning.
  // Off the planet there is no point to hold, so a drag always spins.
  const press=(clientX:number,clientY:number,intent:CameraIntent,gain=1,spin=false):CameraSession|null=>{
    if(!o.ready())return null;
    nav.stop();
    const kind=intent==='auto'?'fly':intent;
    const height=()=>Math.max(1,o.canvas.getBoundingClientRect().height);
    // Moving over Earth, rolling or circling a point while following an orbit
    // starts free flight from that pose; only looking keeps the orbit. It waits
    // for the first movement, so a click, or the first of two fingers, leaves
    // the orbit alone.
    const hit=kind==='fly'||kind==='circle'?pick(clientX,clientY):null;
    const spinning=kind==='fly'&&(spin||!hit!.hit);
    let started=false;
    const begin=()=>{
      if(started)return;started=true;
      if(kind!=='look')free();
      if(kind==='circle')o.pin(hit!.point);
      if(kind==='fly'&&!spinning){const p=screen(clientX,clientY);nav.grab(hit!.point,p.x,p.y);o.request();}
    };
    if(kind==='circle'){
      // The point under the pointer, or off the planet the horizon point toward
      // it. It keeps its place on screen while the camera circles, so the
      // pointer works round it like a turntable: its angle about the point is
      // the camera's turn about the point's vertical, one for one, and its
      // distance from the point raises the camera (farther) or lowers it.
      // Within 16 px of the point the angle is too unsteady to use.
      const anchor=hit!.point,f=o.frame(),b=f.cameraBasis,r=o.canvas.getBoundingClientRect();
      const d=[0,1,2].map(i=>anchor[i]-f.camera[i]),z=Math.max(1e-6,d[0]*b[6]+d[1]*b[7]+d[2]*b[8]);
      const pivot={x:r.left+r.width/2+nav.focal*(d[0]*b[0]+d[1]*b[1]+d[2]*b[2])/z*r.height,y:r.top+r.height/2-nav.focal*(d[0]*b[3]+d[1]*b[4]+d[2]*b[5])/z*r.height};
      let last={x:clientX,y:clientY};
      return {kind,
        move(x,y){
          if(x===last.x&&y===last.y)return;
          begin();
          const a0=Math.atan2(last.y-pivot.y,last.x-pivot.x),a1=Math.atan2(y-pivot.y,x-pivot.x);
          const r0=Math.hypot(last.x-pivot.x,last.y-pivot.y),r1=Math.hypot(x-pivot.x,y-pivot.y);
          const across=r0>16&&r1>16?Math.atan2(Math.sin(a1-a0),Math.cos(a1-a0)):0;
          nav.circleAbout(anchor,across,(r1-r0)/height()*Math.PI*.5);o.changed();last={x,y};
        },
        end(){if(started)o.pin(null);}};
    }
    let last={x:clientX,y:clientY};
    const samples:{t:number;x:number;y:number}[]=[{t:performance.now(),x:clientX,y:clientY}];
    const r=o.canvas.getBoundingClientRect(),centre={x:r.left+r.width/2,y:r.top+r.height/2};
    return {kind,
      move(x,y){
        if(x===last.x&&y===last.y)return;
        begin();
        const now=performance.now();samples.push({t:now,x,y});while(samples.length>2&&now-samples[0].t>100)samples.shift();
        if(kind==='fly'&&spinning){const p=screen(clientX,clientY),h=height();nav.spinGlobe((x-last.x)*gain/h,-(y-last.y)*gain/h,p.x,p.y);o.changed();o.request();}
        else if(kind==='fly'){const p=screen(clientX+(x-clientX)*gain,clientY+(y-clientY)*gain);nav.drag(p.x,p.y);o.request();}
        else if(kind==='look')look(clientX+(last.x-clientX)*gain,clientY+(last.y-clientY)*gain,clientX+(x-clientX)*gain,clientY+(y-clientY)*gain);
        else{
          // Twist about the image centre, like turning a dial.
          const a=Math.atan2(last.y-centre.y,last.x-centre.x),b=Math.atan2(y-centre.y,x-centre.x);
          if(Math.hypot(x-centre.x,y-centre.y)>24&&Math.hypot(last.x-centre.x,last.y-centre.y)>24){nav.roll(Math.atan2(Math.sin(b-a),Math.cos(b-a)));o.changed();}
        }
        last={x,y};
      },
      end(fling=true){
        if(!started)return;
        const now=performance.now(),first=samples[0],latest=samples.at(-1)!,span=(latest.t-first.t)/1000;
        const vx=span>0?(latest.x-first.x)/span:0,vy=span>0?(latest.y-first.y)/span:0;
        const flung=fling&&!o.reducedMotion()&&now-latest.t<60&&Math.hypot(vx,vy)>240;
        if(kind==='fly'&&spinning){if(flung){const p=screen(clientX,clientY),h=height();nav.flingSpin(vx*gain/h,-vy*gain/h,p.x,p.y);}o.request();}
        else if(kind==='fly'){nav.release(flung);o.request();}
        else if(kind==='look'&&flung&&nav.free){const k=degreesPerPixel();nav.spinLook(-vx*k,vy*k);o.request();}
      }};
  };
  /** A trackpad scroll at a resting pointer spins the globe about its centre
   * wherever it is, so it never runs out of travel; with Shift it looks. The
   * content follows the fingers. */
  const scroll=(clientX:number,clientY:number,lookOnly:boolean):ScrollSession|null=>{
    if(!o.ready())return null;
    nav.stop();
    const spinning=!lookOnly;
    if(spinning)free();
    return {kind:spinning?'fly':'look',
      by(dx,dy){
        if(!dx&&!dy)return;
        if(spinning){const p=screen(clientX,clientY),h=Math.max(1,o.canvas.getBoundingClientRect().height);nav.spinGlobe(dx/h,-dy/h,p.x,p.y);o.changed();}
        else look(clientX,clientY,clientX+dx,clientY+dy);
      }};
  };
  return {
    screen,pick,press,scroll,
    /** Two-finger drag: the sky under the fingers' centre follows them. */
    look(x0:number,y0:number,x1:number,y1:number){if(o.ready())look(x0,y0,x1,y1);},
    zoom(log:number,clientX?:number,clientY?:number,smooth=false){
      if(!o.ready()||!log)return;
      free();
      const p=clientX===undefined||clientY===undefined?{x:0,y:0}:screen(clientX,clientY);
      if(smooth&&!o.reducedMotion())nav.zoomBy(log,p.x,p.y);else nav.zoom(log,p.x,p.y);
      o.changed();o.request();
    },
    /** Lens zoom about the pointer, or the image centre. Positive log
     * magnifies. The camera stays put and a followed orbit stays followed. */
    lens(log:number,clientX?:number,clientY?:number,smooth=false){
      if(!o.ready()||!log)return;
      const p=clientX===undefined||clientY===undefined?{x:0,y:0}:screen(clientX,clientY);
      o.lens(log,p.x,p.y,smooth&&!o.reducedMotion());
    },
    roll(angle:number){if(o.ready()&&angle){free();nav.roll(angle);o.changed();}},
    flyTo(clientX:number,clientY:number,out=false){
      if(!o.ready())return;
      const target=pick(clientX,clientY);
      free();const p=screen(clientX,clientY);
      nav.flyTo(p.x,p.y,out?Math.log(2):-Math.log(2),o.reducedMotion()?0:.9);
      o.marked(clientX,clientY,target.hit?target.point:undefined);o.request();
    },
  };
}
export type CameraController=ReturnType<typeof createCameraController>;
