import assert from 'node:assert/strict';

/** Resizing an opaque WebGL canvas clears it. A playing scene must repaint
 * before returning to the compositor, even between its normal 24 FPS ticks. */
export async function verifyCanvasResize({run,evaluate,wait,base}){
 await run('open',`${base}/?api=webgl&motion=1&quality=fixed&t=3235.65`);
 await wait("document.querySelector('orbital-sky').dataset.focus==='sharp'");
 await evaluate(`(()=>{
  const root=document.querySelector('orbital-sky'),canvas=root.querySelector('canvas');
  let version=0,painted=0;const result={resizes:0,unpainted:[]};window.__resizeProof=result;
  for(const name of ['width','height']){
   const property=Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype,name);
   Object.defineProperty(canvas,name,{configurable:true,get(){return property.get.call(this)},set(value){
    property.set.call(this,value);version++;result.resizes++;
    queueMicrotask(()=>{if(root.hasAttribute('data-ready')&&painted<version)result.unpainted.push({width:canvas.width,height:canvas.height});});
   }});
  }
  const gl=canvas.getContext('webgl'),draw=gl.drawArrays;
  gl.drawArrays=function(...args){const result=draw.apply(this,args);if(!this.getParameter(this.FRAMEBUFFER_BINDING))painted=version;return result;};
  return true;
 })()`);
 await run('set','viewport','1130','730');
 await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
 await evaluate("document.querySelector('.sky-motion').click();true");
 await run('set','viewport','1120','720');
 await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
 const result=await evaluate('window.__resizeProof');
 assert.ok(result.resizes>0,'the fixture must resize the drawing buffer');
 assert.deepEqual(result.unpainted,[],'a visible resized canvas must be painted in the same task');
 return result;
}
