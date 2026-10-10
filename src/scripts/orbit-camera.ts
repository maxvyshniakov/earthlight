import { cameraRay, earthPoint, type OrbitNavigation, type ObserverFrame } from './orbit-navigation.ts';

/** Approach moves the camera; lens zooms the image and never moves it. */
export type CameraAction='fly'|'look'|'approach'|'lens'|'roll';
export type CameraIntent='auto'|'look'|'roll';
export type CameraSession={readonly kind:'fly'|'look'|'roll';move(clientX:number,clientY:number):void;end(fling?:boolean):void};
export type ScrollSession={readonly kind:'fly'|'look';by(dx:number,dy:number):void};
type Options={
  canvas:HTMLCanvasElement;
  navigation:OrbitNavigation;
  frame:()=>ObserverFrame;
  ready:()=>boolean;
  detach:()=>void;
  followLook:(dx:number,dy:number)=>void;
  /** Lens zoom by e^log about screen point (x,y); positive magnifies. */
  lens:(log:number,x:number,y:number,smooth:boolean)=>void;
  changed:()=>void;
  request:()=>void;
  used:(action:CameraAction)=>void;
  marked:(clientX:number,clientY:number)=>void;
  reducedMotion:()=>boolean;
};

/** One meaning per gesture on every device: whatever is under the pointer moves
 * with it. Earth pulls the camera around the planet; the sky turns the camera. */
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
  const press=(clientX:number,clientY:number,intent:CameraIntent):CameraSession|null=>{
    if(!o.ready())return null;
    nav.stop();
    // Grabbing Earth while following an orbit starts free flight from that pose.
    const hit=intent==='auto'?pick(clientX,clientY):null;
    const kind=intent==='roll'?'roll':hit?.hit?'fly':'look';
    if(kind!=='look')free();
    if(kind==='fly'){const p=screen(clientX,clientY);nav.grab(hit!.point,p.x,p.y);o.request();}
    let last={x:clientX,y:clientY},travel=0,taught=false;
    const samples:{t:number;x:number;y:number}[]=[{t:performance.now(),x:clientX,y:clientY}];
    const r=o.canvas.getBoundingClientRect(),centre={x:r.left+r.width/2,y:r.top+r.height/2};
    return {kind,
      move(x,y){
        if(x===last.x&&y===last.y)return;
        travel+=Math.hypot(x-last.x,y-last.y);
        const now=performance.now();samples.push({t:now,x,y});while(samples.length>2&&now-samples[0].t>100)samples.shift();
        if(kind==='fly'){const p=screen(x,y);nav.drag(p.x,p.y);o.request();}
        else if(kind==='look')look(last.x,last.y,x,y);
        else{
          // Twist about the image centre, like turning a dial.
          const a=Math.atan2(last.y-centre.y,last.x-centre.x),b=Math.atan2(y-centre.y,x-centre.x);
          if(Math.hypot(x-centre.x,y-centre.y)>24&&Math.hypot(last.x-centre.x,last.y-centre.y)>24){nav.roll(Math.atan2(Math.sin(b-a),Math.cos(b-a)));o.changed();}
        }
        last={x,y};
        if(!taught&&travel>24){taught=true;o.used(kind);}
      },
      end(fling=true){
        const now=performance.now(),first=samples[0],latest=samples.at(-1)!,span=(latest.t-first.t)/1000;
        const vx=span>0?(latest.x-first.x)/span:0,vy=span>0?(latest.y-first.y)/span:0;
        const flung=fling&&!o.reducedMotion()&&now-latest.t<60&&Math.hypot(vx,vy)>240;
        if(kind==='fly'){nav.release(flung);o.request();}
        else if(kind==='look'&&flung&&nav.free){const k=degreesPerPixel();nav.spinLook(-vx*k,vy*k);o.request();}
      }};
  };
  /** A trackpad scroll at a resting pointer. Over Earth it spins the globe
   * about its centre, so it never runs out of travel; over the sky, or with
   * Shift anywhere, it looks. The content follows the fingers. */
  const scroll=(clientX:number,clientY:number,lookOnly:boolean):ScrollSession|null=>{
    if(!o.ready())return null;
    nav.stop();
    const spinning=!lookOnly&&pick(clientX,clientY).hit;
    if(spinning)free();
    let travel=0,taught=false;
    return {kind:spinning?'fly':'look',
      by(dx,dy){
        if(!dx&&!dy)return;
        if(spinning){const p=screen(clientX,clientY),h=Math.max(1,o.canvas.getBoundingClientRect().height);nav.spinGlobe(dx/h,-dy/h,p.x,p.y);o.changed();}
        else look(clientX,clientY,clientX+dx,clientY+dy);
        travel+=Math.hypot(dx,dy);
        if(!taught&&travel>24){taught=true;o.used(spinning?'fly':'look');}
      }};
  };
  return {
    screen,pick,press,scroll,
    /** Two-finger drag: the sky under the fingers' centre follows them. */
    look(x0:number,y0:number,x1:number,y1:number){if(o.ready()){look(x0,y0,x1,y1);o.used('look');}},
    zoom(log:number,clientX?:number,clientY?:number,smooth=false){
      if(!o.ready()||!log)return;
      free();
      const p=clientX===undefined||clientY===undefined?{x:0,y:0}:screen(clientX,clientY);
      if(smooth&&!o.reducedMotion())nav.zoomBy(log,p.x,p.y);else nav.zoom(log,p.x,p.y);
      o.used('approach');o.changed();o.request();
    },
    /** Lens zoom about the pointer, or the image centre. Positive log
     * magnifies. The camera stays put and a followed orbit stays followed. */
    lens(log:number,clientX?:number,clientY?:number,smooth=false){
      if(!o.ready()||!log)return;
      const p=clientX===undefined||clientY===undefined?{x:0,y:0}:screen(clientX,clientY);
      o.lens(log,p.x,p.y,smooth&&!o.reducedMotion());o.used('lens');
    },
    roll(angle:number){if(o.ready()&&angle){free();nav.roll(angle);o.used('roll');o.changed();}},
    flyTo(clientX:number,clientY:number,out=false){
      if(!o.ready())return;
      free();const p=screen(clientX,clientY);
      nav.flyTo(p.x,p.y,out?Math.log(2):-Math.log(2),o.reducedMotion()?0:.9);
      o.marked(clientX,clientY);o.used('approach');o.request();
    },
  };
}
export type CameraController=ReturnType<typeof createCameraController>;
