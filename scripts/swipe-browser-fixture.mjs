import assert from 'node:assert/strict';

export async function verifySwipeRecovery({run,evaluate,wait,base}){
 await run('set','viewport','1280','800');
 await run('open',`${base}/?motion=0&t=1435.17&epoch=2026-10-11T07%3A45%3A51.988Z&flight=free&position=-0.48260145,0.88247718,-0.35725092&orientation=-0.1766052077,0.9644298534,0.1157268414,-0.1590375953`);
 await wait("document.querySelector('earthlight-explorer').dataset.focus==='sharp'&&document.querySelector('earthlight-explorer').dataset.assetPhase==='settled'&&document.querySelector('earthlight-explorer').dataset.inspection==='true'");
 await evaluate("document.querySelector('earthlight-explorer [data-look=grain]').dispatchEvent(new Event('input'));true");
 await run('wait','250');
 assert.equal(await evaluate("document.querySelector('earthlight-explorer').dataset.inspection"),'true','exposure changes keep inspection size stable');
 const motion=await evaluate(`(async()=>{
  const s=document.querySelector('earthlight-explorer'),surface=s.closest('.explorer-view'),g=(s.querySelector('canvas').getContext('webgl2')||s.querySelector('canvas').getContext('webgl')),upload=g.texSubImage2D;
  const start=performance.now(),writes=[];let deferred=false;
  g.texSubImage2D=function(...args){const w=args.length===9?args[4]:args[6].width,h=args.length===9?args[5]:args[6].height;if(w>=256&&h>=256)writes.push(performance.now()-start);return upload.apply(this,args);};
  try{for(let i=0;i<35;i++){
   surface.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,clientX:640,clientY:500,deltaX:85.3,deltaY:3.7}));
   await new Promise(r=>setTimeout(r,20));deferred||=s.dataset.streamingMotion==='deferred';
  }}finally{g.texSubImage2D=upload;}
  return {deferred,target:s.dataset.targetFps,lateWrites:writes.filter(t=>t>250),motion:s.querySelector('.explorer-motion').getAttribute('aria-label')};
 })()`);
 // The explorer renders on whole display refreshes: about 30 FPS at 60 Hz
 // and 24 at 120 Hz, and with headroom up to 60 during a gesture.
 assert.equal(motion.deferred,true);assert.ok(Number(motion.target)>=23.9&&Number(motion.target)<=60.1,motion.target);assert.equal(motion.motion,'Play');
 assert.deepEqual(motion.lateWrites,[],'large optional uploads stay out of a sustained swipe');
 await wait("(()=>{const s=document.querySelector('earthlight-explorer');return s.dataset.streamingMotion==='ready'&&['dayTiles','nightTiles','cloudTiles','terrainTiles','galaxyTiles'].every(k=>!s.dataset[k]||JSON.parse(s.dataset[k]).pending===0);})()");
 const after=await evaluate("(()=>{const s=document.querySelector('earthlight-explorer');return {motion:s.dataset.streamingMotion,fps:s.dataset.targetFps,failures:s.dataset.assetFailures,terrain:JSON.parse(s.dataset.terrainTiles),error:(s.querySelector('canvas').getContext('webgl2')||s.querySelector('canvas').getContext('webgl')).getError()};})()");
 assert.ok(Number(after.fps)>=23.9&&Number(after.fps)<=30.1,`the passive cadence returns: ${after.fps}`);assert.equal(after.failures,'0');assert.equal(after.error,0);assert.ok(after.terrain.resident>0);
 return {during:motion,after};
}
