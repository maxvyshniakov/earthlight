export function draggedCamera(yaw:number,pitch:number,dx:number,dy:number,height:number){
  const degrees=55/Math.max(1,height);
  return {yaw:((yaw-dx*degrees+180)%360+360)%360-180,pitch:Math.max(-90,Math.min(90,pitch+dy*degrees))};
}

/** Orbit page only. Pointer movement is coalesced before sharing slider state. */
export function createCameraDrag(surface:HTMLElement,look:(dx:number,dy:number)=>void,pan:(dx:number,dy:number)=>void){
  let drag:{pointer:number;x:number;y:number;pan:boolean}|null=null;
  let frame=0,dx=0,dy=0,panning=false;
  const flush=()=>{cancelAnimationFrame(frame);frame=0;if(dx||dy){(panning?pan:look)(dx,dy);dx=dy=0;}};
  const end=(event?:PointerEvent)=>{
    if(!drag||(event&&event.pointerId!==drag.pointer))return;
    const pointer=drag.pointer;drag=null;flush();delete surface.dataset.cameraDragging;
    if(surface.hasPointerCapture(pointer))surface.releasePointerCapture(pointer);
  };
  const start=(event:PointerEvent)=>{
    if(drag||event.pointerType==='touch'||!event.isPrimary||event.button!==0||(event.target as Element).closest('a,button,input,select,.sky-panel,.sky-controls,.flight-hint,.scene-comparison'))return;
    surface.focus({preventScroll:true});
    drag={pointer:event.pointerId,x:event.clientX,y:event.clientY,pan:event.shiftKey};panning=event.shiftKey;
    surface.setPointerCapture(event.pointerId);surface.dataset.cameraDragging='';event.preventDefault();
  };
  const move=(event:PointerEvent)=>{
    if(!drag||event.pointerId!==drag.pointer)return;
    if(drag.pan!==event.shiftKey){
      flush();Object.assign(drag,{x:event.clientX,y:event.clientY,pan:event.shiftKey});panning=event.shiftKey;return;
    }
    dx+=event.clientX-drag.x;dy+=event.clientY-drag.y;drag.x=event.clientX;drag.y=event.clientY;
    if(!frame)frame=requestAnimationFrame(flush);
  };
  surface.addEventListener('pointerdown',start);
  surface.addEventListener('pointermove',move);
  for(const type of ['pointerup','pointercancel','lostpointercapture'])surface.addEventListener(type,end as EventListener);
  const blur=()=>end();
  window.addEventListener('blur',blur);
  return ()=>{
    end();cancelAnimationFrame(frame);
    surface.removeEventListener('pointerdown',start);surface.removeEventListener('pointermove',move);
    for(const type of ['pointerup','pointercancel','lostpointercapture'])surface.removeEventListener(type,end as EventListener);
    window.removeEventListener('blur',blur);
  };
}
