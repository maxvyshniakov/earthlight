import type { CameraController, CameraSession, CameraIntent } from './camera-controller.ts';

// Degrees per pixel at the image centre, from the lens focal length in
// viewport heights (1.25 at the wide end), so the sky stays under the pointer.
export function draggedCamera(yaw:number,pitch:number,dx:number,dy:number,height:number,focal=1.25){
  const degrees=180/Math.PI/focal/Math.max(1,height);
  return {yaw:((yaw-dx*degrees+180)%360+360)%360-180,pitch:Math.max(-90,Math.min(90,pitch+dy*degrees))};
}
// Wheels, drags and pinches over these stay theirs; the scene ignores them.
export const SCENE_CONTROLS='a,button,input,select,textarea,[role="slider"],.explorer-panel,.explorer-dialog,.explorer-controls,.scene-comparison,.flight-hud,.flight-help';
type CameraHoverIntent=CameraIntent|'altitude';
const hoverIntent=(event:{altKey:boolean;shiftKey:boolean}):CameraHoverIntent=>event.altKey?'roll':event.shiftKey?'altitude':'auto';

/** Mouse and pen. The left button moves over Earth from anywhere; the middle
 * button, as it pans in design tools, or Shift, looks; Option/Alt twists the
 * image; the right button circles the point under the pointer. On a trackpad
 * the right button is a two-finger press, which looks instead: browsers report
 * both alike, so `secondaryLooks` says which device was in use. Explorer only. */
export function createCameraDrag(surface:HTMLElement,camera:CameraController,hover:(clientX:number|null,clientY:number,intent:CameraHoverIntent)=>void,secondaryLooks:()=>boolean=()=>false){
  let drag:{pointer:number;session:CameraSession;x:number;y:number}|null=null,frame=0;
  let hovering:{x:number;y:number}|null=null;
  const control=(target:EventTarget|null)=>target instanceof Element&&!!target.closest(SCENE_CONTROLS);
  const intent=(event:PointerEvent):CameraIntent|null=>event.button===1?'look':event.button===2?(secondaryLooks()?'look':'circle'):event.button!==0?null:event.altKey?'roll':event.shiftKey?'look':'auto';
  const flush=()=>{cancelAnimationFrame(frame);frame=0;drag?.session.move(drag.x,drag.y);};
  const end=(event?:PointerEvent)=>{
    if(!drag||(event&&event.pointerId!==drag.pointer))return;
    const {pointer,session}=drag;flush();drag=null;
    session.end(event?.type==='pointerup');delete surface.dataset.cameraDragging;
    if(surface.hasPointerCapture(pointer))surface.releasePointerCapture(pointer);
  };
  const start=(event:PointerEvent)=>{
    if(drag||event.pointerType==='touch'||!event.isPrimary||control(event.target))return;
    const kind=intent(event);if(!kind)return;
    const session=camera.press(event.clientX,event.clientY,kind);if(!session)return;
    surface.focus({preventScroll:true});
    drag={pointer:event.pointerId,session,x:event.clientX,y:event.clientY};
    surface.setPointerCapture(event.pointerId);surface.dataset.cameraDragging=session.kind;event.preventDefault();
    hover(null,0,'auto');
  };
  const move=(event:PointerEvent)=>{
    if(event.pointerType==='touch')return;
    if(!drag){
      hovering=control(event.target)?null:{x:event.clientX,y:event.clientY};
      if(hovering)hover(hovering.x,hovering.y,hoverIntent(event));else hover(null,0,'auto');
      return;
    }
    if(event.pointerId!==drag.pointer)return;
    drag.x=event.clientX;drag.y=event.clientY;
    if(!frame)frame=requestAnimationFrame(flush);
  };
  const leave=()=>{hovering=null;if(!drag)hover(null,0,'auto');};
  // Before pressing a button, modifiers hint the pinch action. An active
  // mouse drag exposes its own session kind (Shift-drag still looks).
  const modifier=(event:KeyboardEvent)=>{if((event.key==='Shift'||event.key==='Alt')&&hovering&&!drag)hover(hovering.x,hovering.y,hoverIntent(event));};
  // A right-button drag must not open the browser menu over the scene.
  const menu=(event:MouseEvent)=>{if(!control(event.target))event.preventDefault();};
  // The middle button looks; it must not start the browser's autoscroll.
  const middle=(event:MouseEvent)=>{if(event.button===1&&!control(event.target))event.preventDefault();};
  const double=(event:MouseEvent)=>{if(!control(event.target)&&event.button===0){event.preventDefault();camera.flyTo(event.clientX,event.clientY,event.shiftKey);}};
  const blur=()=>{end();leave();};
  surface.addEventListener('pointerdown',start);
  surface.addEventListener('pointermove',move);
  surface.addEventListener('pointerleave',leave);
  surface.addEventListener('contextmenu',menu);surface.addEventListener('mousedown',middle);
  surface.addEventListener('dblclick',double);
  for(const type of ['pointerup','pointercancel','lostpointercapture'])surface.addEventListener(type,end as EventListener);
  window.addEventListener('blur',blur);
  window.addEventListener('keydown',modifier);window.addEventListener('keyup',modifier);
  return ()=>{
    end();cancelAnimationFrame(frame);
    surface.removeEventListener('pointerdown',start);surface.removeEventListener('pointermove',move);
    surface.removeEventListener('pointerleave',leave);surface.removeEventListener('contextmenu',menu);surface.removeEventListener('mousedown',middle);surface.removeEventListener('dblclick',double);
    for(const type of ['pointerup','pointercancel','lostpointercapture'])surface.removeEventListener(type,end as EventListener);
    window.removeEventListener('blur',blur);
    window.removeEventListener('keydown',modifier);window.removeEventListener('keyup',modifier);
  };
}
