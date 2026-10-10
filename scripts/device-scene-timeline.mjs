// Browser-side instrumentation installed before scene startup. Canvas sizes are
// observed at setters and every submitted final draw; dataset changes are
// timestamped when MutationObserver delivers them, not at the original write.
export function deviceSceneTimeline(){
 const log=window.__sceneTimeline={active:false,frames:[],sizes:[],scales:[],raf:[],visibility:[],phases:[]};
 const clock=()=>performance.now(),wrapped=new WeakSet(),get=HTMLCanvasElement.prototype.getContext,request=window.requestAnimationFrame;
 let lastRaf=null;
 window.requestAnimationFrame=function(callback){return request.call(this,time=>{if(log.active&&lastRaf!==time){log.raf.push(time);lastRaf=time;}return callback(time);});};
 const visible=()=>{if(log.active)log.visibility.push({time:clock(),state:document.visibilityState,focused:document.hasFocus()});};
 document.addEventListener('visibilitychange',visible);window.addEventListener('focus',visible);window.addEventListener('blur',visible);
 log.start=()=>{for(const key of ['frames','sizes','scales','raf','visibility','phases'])log[key]=[];log.active=true;log.started=clock();lastRaf=null;visible();return log.started;};
 log.stop=()=>{log.ended=clock();log.active=false;return log.ended;};
 HTMLCanvasElement.prototype.getContext=function(...args){
  const g=get.apply(this,args),canvas=this,s=canvas.closest('orbital-sky');
  if(!g||!s||!['webgl','webgl2','experimental-webgl'].includes(args[0])||wrapped.has(g))return g;wrapped.add(g);
  for(const axis of ['width','height']){
   const property=Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype,axis);
   Object.defineProperty(canvas,axis,{configurable:true,get(){return property.get.call(this);},set(value){const before=property.get.call(this),time=clock();property.set.call(this,value);if(log.active&&before!==property.get.call(this))log.sizes.push({time,axis,before,value:property.get.call(this),width:canvas.width,height:canvas.height,scale:Number(s.dataset.renderScale)});}});
  }
  let lastScale=s.dataset.renderScale;
  new MutationObserver(records=>{const value=s.dataset.renderScale;if(!log.active){lastScale=value;return;}if(value!==lastScale){log.scales.push({time:clock(),oldValue:records[0]?.oldValue??lastScale,value:Number(value),width:canvas.width,height:canvas.height});lastScale=value;}}).observe(s,{attributes:true,attributeFilter:['data-render-scale'],attributeOldValue:true});
  const draw=g.drawArrays,bind=g.bindFramebuffer;let target=null;
  g.bindFramebuffer=function(k,v){if(k===g.FRAMEBUFFER||k===g.DRAW_FRAMEBUFFER)target=v;return bind.call(this,k,v);};
  g.drawArrays=function(...a){const r=draw.apply(this,a);if(log.active&&target===null)log.frames.push({time:clock(),rafTime:lastRaf,width:canvas.width,height:canvas.height,scale:Number(s.dataset.renderScale),focus:s.dataset.focus});return r;};
  return g;
 };
}
