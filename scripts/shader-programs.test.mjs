import {test,afterEach} from 'bun:test';

const cleanups=[];
afterEach(()=>{for(const cleanup of cleanups.splice(0).reverse())cleanup();});
import assert from 'node:assert/strict';
import {ShaderProgramBatch} from '../src/scripts/shader-programs.ts';

function fixture({parallel=true}={}){
 const calls=[],frames=new Map();let next=0,lost=false;
 const before={requestAnimationFrame:globalThis.requestAnimationFrame,cancelAnimationFrame:globalThis.cancelAnimationFrame};
 globalThis.requestAnimationFrame=callback=>{const id=++next;frames.set(id,callback);return id;};
 globalThis.cancelAnimationFrame=id=>frames.delete(id);
 cleanups.push(()=>{for(const [key,value] of Object.entries(before)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}});
 const gl={
  VERTEX_SHADER:1,FRAGMENT_SHADER:2,LINK_STATUS:3,COMPILE_STATUS:4,
  getExtension:()=>parallel?{COMPLETION_STATUS_KHR:5}:null,
  createShader:type=>({type,compiled:true}),shaderSource:(shader,source)=>{shader.source=source;},
  compileShader:shader=>calls.push(['compile',shader]),
  createProgram:()=>({complete:false,linked:true}),attachShader:()=>{},
  linkProgram:program=>calls.push(['link',program]),
  getProgramParameter:(program,kind)=>{calls.push(['program-status',kind,program]);return kind===5?program.complete:program.linked;},
  getShaderParameter:(shader,kind)=>{calls.push(['shader-status',kind,shader]);return shader.compiled;},
  getShaderInfoLog:()=> 'bad shader',getProgramInfoLog:()=> 'bad link',
  deleteShader:shader=>calls.push(['delete-shader',shader]),deleteProgram:program=>calls.push(['delete-program',program]),
  isContextLost:()=>lost,
 };
 return {gl,calls,frames,lose:()=>{lost=true;},tick:()=>{const work=[...frames.values()];frames.clear();for(const callback of work)callback(0);}};
}

test('batch submits all shaders before links and polls every program without blocking status calls',async()=>{
 const f=fixture(),batch=new ShaderProgramBatch(f.gl),controller=new AbortController();
 const a=batch.add('a','vertex','fragment-a'),b=batch.add('b','vertex','fragment-b');
 assert.equal(f.calls.filter(x=>x[0]==='compile').length,3,'Shared vertex shader is compiled once');
 assert.equal(f.calls.some(x=>x[0]==='link'),false);
 assert.throws(()=>batch.take(a),/not ready/);
 const ready=batch.wait(controller.signal);
 assert.deepEqual(f.calls.map(x=>x[0]),['compile','compile','compile','link','link']);
 a.complete=true;f.tick();
 assert.deepEqual(f.calls.filter(x=>x[0]==='program-status').map(x=>x[1]),[5,5]);
 assert.equal(f.calls.some(x=>x[0]==='shader-status'),false);
 b.complete=true;f.tick();await ready;
 assert.deepEqual(f.calls.filter(x=>x[0]==='program-status').map(x=>x[1]),[5,5,5,5,3,3]);
 assert.equal(batch.take(a),a);assert.throws(()=>batch.take(a),/already claimed/);
 batch.dispose();
 assert.deepEqual(f.calls.filter(x=>x[0]==='delete-program').map(x=>x[1]),[b]);
 assert.equal(f.calls.filter(x=>x[0]==='delete-shader').length,3);
 assert.equal(f.frames.size,0);
});

test('without KHR the same batch links every program before synchronous validation',async()=>{
 const f=fixture({parallel:false}),batch=new ShaderProgramBatch(f.gl);
 batch.add('a','v','a');batch.add('b','v','b');await batch.wait(new AbortController().signal);
 const firstStatus=f.calls.findIndex(x=>x[0]==='program-status');
 assert.equal(f.calls.slice(0,firstStatus).filter(x=>x[0]==='link').length,2);
 assert.ok(f.calls.filter(x=>x[0]==='program-status').every(x=>x[1]===3));
 assert.equal(f.frames.size,0);batch.dispose();
});

test('compile diagnostics are read only after all programs complete and linking fails',async()=>{
 const f=fixture(),batch=new ShaderProgramBatch(f.gl),bad=batch.add('broken clouds','v','bad');
 bad.linked=false;
 const ready=batch.wait(new AbortController().signal),rejection=assert.rejects(ready,/broken clouds: bad link/);
 f.tick();assert.equal(f.calls.some(x=>x[0]==='shader-status'),false);
 bad.complete=true;f.tick();await rejection;
 assert.equal(f.calls.filter(x=>x[0]==='shader-status').length,2);batch.dispose();
});

test('aborting pending compilation cancels polling and never claims programs',async()=>{
 const f=fixture(),batch=new ShaderProgramBatch(f.gl),program=batch.add('a','v','f'),controller=new AbortController();
 const rejection=assert.rejects(batch.wait(controller.signal),{name:'AbortError'});
 controller.abort();await rejection;
 assert.equal(f.frames.size,0);assert.equal(f.calls.some(x=>x[0]==='program-status'),false);
 assert.throws(()=>batch.take(program),/not ready/);batch.dispose();
 assert.equal(f.calls.filter(x=>x[0]==='delete-program').length,1);
});

test('context loss does not treat the extension completion result as success',async()=>{
 const f=fixture(),batch=new ShaderProgramBatch(f.gl),program=batch.add('a','v','f');
 program.complete=true;
 const rejection=assert.rejects(batch.wait(new AbortController().signal),{name:'AbortError'});
 f.lose();f.tick();await rejection;
 assert.equal(f.calls.some(x=>x[0]==='program-status'),false);batch.dispose();
});

test('disposing a pending batch rejects its waiter and releases unclaimed resources once',async()=>{
 const f=fixture(),batch=new ShaderProgramBatch(f.gl);batch.add('a','v','f');
 const rejection=assert.rejects(batch.wait(new AbortController().signal),{name:'AbortError'});
 batch.dispose();batch.dispose();await rejection;
 assert.equal(f.frames.size,0);assert.equal(f.calls.filter(x=>x[0]==='delete-program').length,1);
 assert.equal(f.calls.filter(x=>x[0]==='delete-shader').length,2);
});

test('an already aborted signal never submits links or completion queries',async()=>{
 const f=fixture(),batch=new ShaderProgramBatch(f.gl),controller=new AbortController();batch.add('a','v','f');
 controller.abort();await assert.rejects(batch.wait(controller.signal),{name:'AbortError'});
 assert.equal(f.calls.some(x=>x[0]==='link'||x[0]==='program-status'),false);batch.dispose();
});
