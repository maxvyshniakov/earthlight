import type { CameraController, CameraSession } from './camera-controller.ts';

type Point={x:number;y:number};
const TAP_MS=260,DOUBLE_MS=320,SLOP=10;

/** The scene owns touch gestures; controls outside this element keep native
 * touch behaviour. One finger moves over Earth wherever it starts: it grabs the
 * point it touches, or with `spin`, and always off the planet, turns the globe
 * like a trackpad scroll, which never runs out at the limb. Two fingers move together
 * to look, pinch to approach and twist to roll; each starts past a small
 * threshold so a pinch does not also roll. Double-tap flies in,
 * double-tap-and-drag approaches with one thumb, and a two-finger tap flies
 * out. Touch has no Shift, so the HUD's lens buttons zoom the lens. */
export function createTouchCamera(surface:HTMLElement,camera:CameraController,touched:()=>void,gain=1,spin=false){
  const pointers=new Map<number,Point>();
  let previous:Point[]=[],frame=0;
  let single:{session:CameraSession|null;start:Point;time:number;moved:boolean;quick:boolean}|null=null;
  let pair:{start:{c:Point;d:number;a:number};time:number;moved:boolean;look:boolean;zoom:boolean;roll:boolean}|null=null;
  let lastTap:{time:number;x:number;y:number}|null=null;
  const snapshot=()=>[...pointers.values()].map(point=>({...point}));
  const centre=(p:Point[])=>({x:(p[0].x+p[1].x)/2,y:(p[0].y+p[1].y)/2});
  const span=(p:Point[])=>Math.hypot(p[1].x-p[0].x,p[1].y-p[0].y);
  const angle=(p:Point[])=>Math.atan2(p[1].y-p[0].y,p[1].x-p[0].x);
  const turn=(a:number)=>Math.atan2(Math.sin(a),Math.cos(a));
  const flush=()=>{
    cancelAnimationFrame(frame);frame=0;
    const current=snapshot();
    if(current.length===previous.length){
      if(current.length===1&&single){
        const p=current[0];
        if(Math.hypot(p.x-single.start.x,p.y-single.start.y)>SLOP)single.moved=true;
        // Double-tap-and-drag: down zooms in around the tapped point.
        if(single.quick){if(single.moved)camera.zoom((p.y-previous[0].y)*-.008,single.start.x,single.start.y);}
        else single.session?.move(p.x,p.y);
      }else if(current.length===2&&pair){
        const c0=centre(previous),c1=centre(current),d0=span(previous),d1=span(current);
        const travel=Math.hypot(c1.x-pair.start.c.x,c1.y-pair.start.c.y);
        const spread=Math.abs(Math.log(d1/Math.max(1,pair.start.d))),twist=Math.abs(turn(angle(current)-pair.start.a));
        if(travel>SLOP||spread>.04||twist>.08)pair.moved=true;
        const other=pair.zoom||pair.roll;
        pair.look||=travel>(other?30:12);
        pair.zoom||=spread>.08;
        pair.roll||=twist>(pair.zoom?.3:.18);
        if(pair.look)camera.look(c0.x,c0.y,c1.x,c1.y);
        if(pair.zoom&&d0>8&&d1>8)camera.zoom(-Math.log(d1/d0),c1.x,c1.y);
        if(pair.roll)camera.roll(turn(angle(current)-angle(previous)));
      }
    }
    previous=current;
  };
  const beginSingle=(p:Point,now:number,quick:boolean)=>{
    single={session:quick?null:camera.press(p.x,p.y,'auto',gain,spin),start:p,time:now,moved:false,quick};
  };
  const endSingle=(fling:boolean)=>{single?.session?.end(fling);single=null;};
  const start=(event:PointerEvent)=>{
    if(event.pointerType!=='touch')return;
    flush();touched();
    const now=performance.now(),p={x:event.clientX,y:event.clientY};
    pointers.set(event.pointerId,p);previous=snapshot();
    surface.setPointerCapture(event.pointerId);event.preventDefault();
    if(pointers.size===1){
      const quick=!!lastTap&&now-lastTap.time<DOUBLE_MS&&Math.hypot(p.x-lastTap.x,p.y-lastTap.y)<40;
      beginSingle(p,now,quick);if(quick)lastTap=null;
    }else if(pointers.size===2){
      endSingle(false);
      const points=snapshot();
      pair={start:{c:centre(points),d:span(points),a:angle(points)},time:now,moved:false,look:false,zoom:false,roll:false};
    }
  };
  const move=(event:PointerEvent)=>{
    if(!pointers.has(event.pointerId))return;
    pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});event.preventDefault();
    if(!frame)frame=requestAnimationFrame(flush);
  };
  const end=(event:PointerEvent)=>{
    if(!pointers.has(event.pointerId))return;
    const up=event.type==='pointerup',now=performance.now();
    if(up)flush();else {cancelAnimationFrame(frame);frame=0;}
    const lifted=pointers.get(event.pointerId)!;
    pointers.delete(event.pointerId);previous=snapshot();
    if(surface.hasPointerCapture(event.pointerId))surface.releasePointerCapture(event.pointerId);
    if(single&&pointers.size===0){
      const tap=up&&!single.moved&&now-single.time<TAP_MS;
      if(single.quick&&tap)camera.flyTo(single.start.x,single.start.y);
      lastTap=tap&&!single.quick?{time:now,x:lifted.x,y:lifted.y}:null;
      endSingle(up);
    }else if(pair&&pointers.size<2){
      if(up&&!pair.moved&&now-pair.time<TAP_MS)camera.flyTo(pair.start.c.x,pair.start.c.y,true);
      pair=null;lastTap=null;
      // The remaining finger continues as a fresh one-finger gesture.
      const rest=snapshot()[0];if(rest)beginSingle(rest,now,false);
    }
  };
  const cancel=()=>{
    cancelAnimationFrame(frame);frame=0;endSingle(false);pair=null;lastTap=null;
    const ids=[...pointers.keys()];pointers.clear();previous=[];
    for(const id of ids)if(surface.hasPointerCapture(id))surface.releasePointerCapture(id);
  };
  const visibility=()=>{if(document.hidden)cancel();};
  surface.addEventListener('pointerdown',start);
  surface.addEventListener('pointermove',move);
  for(const type of ['pointerup','pointercancel','lostpointercapture'])surface.addEventListener(type,end as EventListener);
  window.addEventListener('blur',cancel);document.addEventListener('visibilitychange',visibility);
  return {
    get active(){return pointers.size>0;},
    dispose(){
      cancel();surface.removeEventListener('pointerdown',start);surface.removeEventListener('pointermove',move);
      for(const type of ['pointerup','pointercancel','lostpointercapture'])surface.removeEventListener(type,end as EventListener);
      window.removeEventListener('blur',cancel);document.removeEventListener('visibilitychange',visibility);
    },
  };
}
