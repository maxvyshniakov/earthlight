type Point={x:number;y:number};

/** The scene owns touch gestures; controls outside this element keep native touch behavior. */
export function createTouchCamera(surface:HTMLElement,look:(dx:number,dy:number)=>void,pan:(dx:number,dy:number)=>void,zoom:(delta:number)=>void){
  const pointers=new Map<number,Point>();
  let previous:Point[]=[],frame=0;
  const snapshot=()=>[...pointers.values()].map(point=>({...point}));
  const flush=()=>{
    cancelAnimationFrame(frame);frame=0;
    const current=snapshot();
    if(current.length===previous.length){
      if(current.length===1){
        const dx=current[0].x-previous[0].x,dy=current[0].y-previous[0].y;
        if(dx||dy)look(dx,dy);
      }else if(current.length===2){
        const dx=(current[0].x+current[1].x-previous[0].x-previous[1].x)/2;
        const dy=(current[0].y+current[1].y-previous[0].y-previous[1].y)/2;
        if(dx||dy)pan(dx,dy);
        const distance=(points:Point[])=>Math.hypot(points[1].x-points[0].x,points[1].y-points[0].y);
        const before=distance(previous),after=distance(current);
        if(before>8&&after>8&&before!==after)zoom(-Math.log(after/before)/.005);
      }
    }
    previous=current;
  };
  const start=(event:PointerEvent)=>{
    if(event.pointerType!=='touch')return;
    flush();pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});previous=snapshot();
    surface.setPointerCapture(event.pointerId);event.preventDefault();
  };
  const move=(event:PointerEvent)=>{
    if(!pointers.has(event.pointerId))return;
    pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});event.preventDefault();
    if(!frame)frame=requestAnimationFrame(flush);
  };
  const end=(event:PointerEvent)=>{
    if(!pointers.has(event.pointerId))return;
    if(event.type==='pointerup')flush();else {cancelAnimationFrame(frame);frame=0;}
    pointers.delete(event.pointerId);previous=snapshot();
    if(surface.hasPointerCapture(event.pointerId))surface.releasePointerCapture(event.pointerId);
  };
  const cancel=()=>{
    cancelAnimationFrame(frame);frame=0;
    const ids=[...pointers.keys()];pointers.clear();previous=[];
    for(const id of ids)if(surface.hasPointerCapture(id))surface.releasePointerCapture(id);
  };
  const visibility=()=>{if(document.hidden)cancel();};
  surface.addEventListener('pointerdown',start);
  surface.addEventListener('pointermove',move);
  for(const type of ['pointerup','pointercancel','lostpointercapture'])surface.addEventListener(type,end as EventListener);
  window.addEventListener('blur',cancel);document.addEventListener('visibilitychange',visibility);
  return ()=>{
    cancel();surface.removeEventListener('pointerdown',start);surface.removeEventListener('pointermove',move);
    for(const type of ['pointerup','pointercancel','lostpointercapture'])surface.removeEventListener(type,end as EventListener);
    window.removeEventListener('blur',cancel);document.removeEventListener('visibilitychange',visibility);
  };
}
