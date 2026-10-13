import {test} from 'bun:test';
import assert from 'node:assert/strict';
import {rememberedScale,rememberScale} from '../src/scripts/scene-scale-memory.ts';

test('a settled scale is reused only for the same device, viewport and profile',()=>{
 const store=new Map();
 globalThis.localStorage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,String(v))};
 try{
  const now=1_800_000_000_000;
  assert.equal(rememberedScale(390,844,3,'compact',now),null);
  rememberScale(.54,390,844,3,'compact',now);
  assert.equal(rememberedScale(392,840,3,'compact',now+1000),.54);
  assert.equal(rememberedScale(844,390,3,'compact',now),null,'rotation is a different viewport');
  assert.equal(rememberedScale(390,844,2,'compact',now),null);
  assert.equal(rememberedScale(390,844,3,'reference',now),null);
  assert.equal(rememberedScale(390,844,3,'compact',now+31*86400_000),null,'stale entries expire');
  rememberScale(.1,390,844,3,'compact',now);
  assert.equal(rememberedScale(390,844,3,'compact',now),.45,'the controller floor still applies');
  store.set('earthlight.renderScale.v1','{broken');
  assert.equal(rememberedScale(390,844,3,'compact',now),null);
 }finally{delete globalThis.localStorage;}
});
