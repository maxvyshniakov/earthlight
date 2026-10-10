import type { Vec3 } from './iss-orbit.ts';

export type FlightGesture='look'|'pan'|'zoom';

/** Real-time input clock, independent of replay speed and pause. */
export function createFlightControls(surface:HTMLElement,options:{enabled:()=>boolean;step:(dt:number,input:Vec3,fast:boolean)=>boolean;gesture:(kind:FlightGesture,dx:number,dy:number)=>void;changed:()=>void;stop:()=>void}){
 const keys=new Set<string>();let frame=0,last=0;
 let pending:{kind:FlightGesture;dx:number;dy:number}[]=[];
 const blocked=(target:EventTarget|null)=>target instanceof Element&&!!target.closest('a,button,input,select,textarea,[contenteditable]:not([contenteditable="false"]),.sky-panel,.flight-hint,.scene-comparison');
 const loop=(now:number)=>{
  frame=0;if(document.hidden){cancel();return;}
  const gestures=pending;pending=[];for(const gesture of gestures)options.gesture(gesture.kind,gesture.dx,gesture.dy);
  const dt=last?Math.min(.05,(now-last)/1000):1/60;last=now;
  const direction:Vec3=[Number(keys.has('KeyW'))-Number(keys.has('KeyS')),Number(keys.has('KeyD'))-Number(keys.has('KeyA')),Number(keys.has('KeyE'))-Number(keys.has('KeyQ'))];
  const moving=options.step(dt,direction,keys.has('ShiftLeft')||keys.has('ShiftRight'));
  options.changed();
  if(moving||keys.size)frame=requestAnimationFrame(loop);else last=0;
 };
 const request=()=>{if(!frame&&!document.hidden)frame=requestAnimationFrame(loop);};
 const down=(event:KeyboardEvent)=>{
  if(!options.enabled()||event.defaultPrevented||event.ctrlKey||event.metaKey||event.altKey||blocked(event.target))return;
  if(!['KeyW','KeyA','KeyS','KeyD','KeyQ','KeyE','ShiftLeft','ShiftRight'].includes(event.code))return;
  event.preventDefault();keys.add(event.code);request();
 };
 const up=(event:KeyboardEvent)=>{keys.delete(event.code);};
 const wheel=(event:WheelEvent)=>{
  if(blocked(event.target)||event.defaultPrevented)return;
  event.preventDefault();
  const kind:FlightGesture=event.ctrlKey||event.metaKey?'zoom':event.shiftKey?'pan':'look';
  const unit=event.deltaMode===1?16:event.deltaMode===2?surface.clientHeight:1;
  const dx=event.deltaX*unit,dy=event.deltaY*unit,previous=pending.at(-1);
  if(previous?.kind===kind){previous.dx+=dx;previous.dy+=dy;}else pending.push({kind,dx,dy});
  request();
 };
 const cancel=()=>{pending=[];keys.clear();cancelAnimationFrame(frame);frame=0;last=0;options.stop();};
 const visibility=()=>{if(document.hidden)cancel();};
 const focus=(event:FocusEvent)=>{if(blocked(event.target))cancel();};
 window.addEventListener('keydown',down);window.addEventListener('keyup',up);window.addEventListener('blur',cancel);
 document.addEventListener('visibilitychange',visibility);document.addEventListener('focusin',focus);
 surface.addEventListener('wheel',wheel,{passive:false});
 return {request,cancel,dispose:()=>{cancel();window.removeEventListener('keydown',down);window.removeEventListener('keyup',up);window.removeEventListener('blur',cancel);document.removeEventListener('visibilitychange',visibility);document.removeEventListener('focusin',focus);surface.removeEventListener('wheel',wheel);}};
}
