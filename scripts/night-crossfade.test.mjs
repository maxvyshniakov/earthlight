import {test} from 'bun:test';
import assert from 'node:assert/strict';
import {NightCrossfade} from '../src/scripts/night-crossfade.ts';

class Canvas extends EventTarget {
  hidden=true;
  dataset={};
  width=0;
  height=0;
  copies=[];
  getContext(){return {drawImage:source=>this.copies.push(source)};}
}
function fixture(){
  let id=0;
  const pending=new Map(),callbacks=[];
  const timers={later:(callback,ms)=>{assert.equal(ms,800);callbacks.push(callback);pending.set(++id,callback);return id;},cancel:key=>pending.delete(key)};
  const canvas=new Canvas(),source=new Canvas();source.width=600;source.height=400;
  return {canvas,source,pending,callbacks,timers,owner:new NightCrossfade(canvas,timers)};
}
test('a new hand-over cancels the old fade event and timeout, even if its callback is already queued',()=>{
  const {owner,canvas,source,pending,callbacks}=fixture();
  owner.hold(source);owner.release(false);
  assert.equal(canvas.dataset.fading,'');assert.equal(pending.size,1);
  const oldTimeout=callbacks[0];
  owner.hold(source);assert.equal(pending.size,0);assert.equal(canvas.dataset.fading,undefined);
  canvas.dispatchEvent(new Event('transitionend'));oldTimeout();
  assert.equal(canvas.hidden,false);assert.equal(canvas.width,600);assert.equal(canvas.copies.length,2);
  owner.release(false);oldTimeout();assert.equal(canvas.hidden,false);assert.equal(pending.size,1);
  canvas.dispatchEvent(new Event('transitionend'));assert.equal(canvas.hidden,true);assert.equal(canvas.width,0);assert.equal(pending.size,0);
});
test('disconnect cancels completion and an old host cannot hide a new host frame on the same canvas',()=>{
  const {owner,canvas,source,pending,callbacks,timers}=fixture();
  owner.hold(source);owner.release(false);const oldTimeout=callbacks[0];
  owner.dispose();assert.equal(pending.size,0);assert.equal(canvas.hidden,true);
  const reconnected=new NightCrossfade(canvas,timers);reconnected.hold(source);
  oldTimeout();canvas.dispatchEvent(new Event('transitionend'));owner.release(false);owner.hold(source);owner.dispose();
  assert.equal(canvas.hidden,false);assert.equal(canvas.width,600);assert.equal(canvas.copies.length,2);
  reconnected.dispose();
});
test('fallback completion and reduced motion retain their exact visible behavior',()=>{
  const {owner,canvas,source,pending,callbacks}=fixture();
  owner.hold(source);assert.equal(canvas.hidden,false);assert.equal(canvas.height,400);
  owner.release(false);callbacks[0]();assert.equal(canvas.hidden,true);assert.equal(canvas.height,0);assert.equal(pending.size,0);
  owner.hold(source);owner.release(true);assert.equal(canvas.hidden,true);assert.equal(canvas.dataset.fading,undefined);assert.equal(pending.size,0);
});
