import {test} from 'bun:test';
import assert from 'node:assert/strict';
import {CloudBuffer} from '../src/scripts/cloud-buffer.ts';
import {WorldBuffer} from '../src/scripts/world-buffer.ts';

function fakeGL({missing,failAbove=Infinity,webgl2=false}={}){
  let next=0,unit=0,target=null;
  const bindings=new Map(),textures=new Set(),framebuffers=new Set(),attachments=new Map();
  const allocations=[],viewports=[],queries=[],drawBuffers=[];
  const mrt={MAX_DRAW_BUFFERS_WEBGL:101,MAX_COLOR_ATTACHMENTS_WEBGL:102,COLOR_ATTACHMENT0_WEBGL:201,COLOR_ATTACHMENT1_WEBGL:202,drawBuffersWEBGL(){}};
  const gl={
    TEXTURE0:1000,TEXTURE14:1014,TEXTURE_2D:1,FRAMEBUFFER:2,RGBA:3,FLOAT:4,
    TEXTURE_WRAP_S:5,TEXTURE_WRAP_T:6,CLAMP_TO_EDGE:7,TEXTURE_MIN_FILTER:8,TEXTURE_MAG_FILTER:9,NEAREST:10,
    MAX_TEXTURE_IMAGE_UNITS:11,FRAMEBUFFER_COMPLETE:12,TEXTURE_BINDING_2D:13,COLOR_ATTACHMENT0:201,
    getExtension(name){if(name===missing)return null;return name==='WEBGL_draw_buffers'?mrt:name==='OES_texture_half_float'?{HALF_FLOAT_OES:14}:{};},
    getParameter(name){queries.push(name);return name===gl.TEXTURE_BINDING_2D?bindings.get(unit)??null:name===gl.MAX_TEXTURE_IMAGE_UNITS?16:2;},
    createTexture(){const t={id:++next};textures.add(t);return t;},
    createFramebuffer(){const f={id:++next};framebuffers.add(f);return f;},
    deleteTexture(t){textures.delete(t);},deleteFramebuffer(f){framebuffers.delete(f);},
    activeTexture(value){unit=value;},bindTexture(_type,t){bindings.set(unit,t);},texParameteri(){},
    bindFramebuffer(_type,f){target=f;},
    texImage2D(_target,_level,internal,w,h,_border,format,type){allocations.push({texture:bindings.get(unit),w,h,internal,format,type});},
    framebufferTexture2D(_target,attachment,_type,texture){attachments.set(`${target.id}:${attachment}`,texture);},
    checkFramebufferStatus(){const last=allocations.at(-1);return last.w*last.h>failAbove?0:gl.FRAMEBUFFER_COMPLETE;},
    viewport(x,y,w,h){viewports.push([x,y,w,h]);},
  };
  if(webgl2)Object.assign(gl,{
    texStorage2D(){},HALF_FLOAT:21,RGBA16F:22,RG16F:23,RG:24,
    MAX_DRAW_BUFFERS:101,MAX_COLOR_ATTACHMENTS:102,COLOR_ATTACHMENT1:202,
    drawBuffers(buffers){drawBuffers.push(buffers);},
  });
  return {gl,bindings,textures,framebuffers,allocations,viewports,queries,attachments,drawBuffers,get target(){return target;}};
}

test('WebGL2 cloud metadata uses two half-float channels through core MRT',()=>{
  const fake=fakeGL({webgl2:true,missing:'WEBGL_draw_buffers'}),{gl}=fake;
  assert.equal(CloudBuffer.supported(gl),true,'WebGL2 does not require the WebGL1 MRT extension');
  const buffer=new CloudBuffer(gl);
  buffer.begin(593,1197);
  assert.deepEqual(fake.allocations.slice(-2).map(({internal,format,type,w,h})=>({internal,format,type,w,h})),[
    {internal:gl.RGBA16F,format:gl.RGBA,type:gl.HALF_FLOAT,w:297,h:599},
    {internal:gl.RG16F,format:gl.RG,type:gl.HALF_FLOAT,w:297,h:599},
  ]);
  assert.deepEqual(fake.drawBuffers.at(-1),[gl.COLOR_ATTACHMENT0,gl.COLOR_ATTACHMENT0+1]);
  const count=fake.allocations.length;
  buffer.begin(593,1197);
  assert.equal(fake.allocations.length,count);
  buffer.dispose();
  assert.equal(fake.textures.size,0);
  assert.equal(fake.framebuffers.size,0);
});

test('WebGL2 mixed cloud targets still require renderable float support and a complete framebuffer',()=>{
  assert.equal(CloudBuffer.supported(fakeGL({webgl2:true,missing:'EXT_color_buffer_float'}).gl),false);
  const fake=fakeGL({webgl2:true,failAbove:0});
  assert.throws(()=>new CloudBuffer(fake.gl),/Incomplete cloud framebuffer/);
  assert.equal(fake.textures.size,0);
  assert.equal(fake.framebuffers.size,0);
  assert.equal(fake.target,null);
});

test('half cloud targets round odd sizes up and reuse stable allocations',()=>{
  const fake=fakeGL(),buffer=new CloudBuffer(fake.gl);
  assert.deepEqual(buffer.begin(593,1197),[297,599]);
  assert.deepEqual(fake.allocations.slice(-2).map(({w,h})=>[w,h]),[[297,599],[297,599]]);
  assert.deepEqual(fake.allocations.slice(-2).map(({internal,format,type})=>[internal,format,type]),[[fake.gl.RGBA,fake.gl.RGBA,14],[fake.gl.RGBA,fake.gl.RGBA,14]],'WebGL1 retains RGBA half-float targets');
  const count=fake.allocations.length;
  buffer.begin(593,1197);
  assert.equal(fake.allocations.length,count);
  assert.equal(fake.textures.size,2);
  assert.equal(fake.framebuffers.size,1);
  buffer.dispose();
  assert.equal(fake.textures.size,0);
  assert.equal(fake.framebuffers.size,0);
});

test('missing MRT or half-float support leaves capability false',()=>{
  for(const missing of ['WEBGL_draw_buffers','OES_texture_half_float','EXT_color_buffer_half_float'])
    assert.equal(CloudBuffer.supported(fakeGL({missing}).gl),false);
  assert.equal(CloudBuffer.supported(fakeGL().gl),true);
});

test('an incomplete probe releases both attachments and the framebuffer',()=>{
  const fake=fakeGL({failAbove:0});
  assert.throws(()=>new CloudBuffer(fake.gl),/Incomplete cloud framebuffer/);
  assert.equal(fake.textures.size,0);
  assert.equal(fake.framebuffers.size,0);
  assert.equal(fake.target,null);
});

test('an actual-size failure is surfaced even after the small probe succeeds',()=>{
  const fake=fakeGL({failAbove:16}),buffer=new CloudBuffer(fake.gl);
  assert.throws(()=>buffer.begin(100,100),/Incomplete cloud framebuffer/);
  buffer.dispose();
  assert.equal(fake.textures.size,0);
  assert.equal(fake.framebuffers.size,0);
});

test('world target allocation preserves the galaxy sampler on unit 14',()=>{
  const fake=fakeGL(),buffer=new WorldBuffer(fake.gl,true);
  const galaxy=fake.gl.createTexture();
  fake.gl.activeTexture(fake.gl.TEXTURE14);fake.gl.bindTexture(fake.gl.TEXTURE_2D,galaxy);
  buffer.begin(800,600);
  assert.equal(fake.bindings.get(fake.gl.TEXTURE14),galaxy);
  assert.equal(fake.attachments.get(`${fake.target.id}:201`),buffer.texture);
  const queryCount=fake.queries.length;
  buffer.begin(800,600);
  assert.equal(fake.queries.length,queryCount,'steady frames do not query GL state');
  assert.equal(fake.bindings.get(fake.gl.TEXTURE14),galaxy);
  buffer.begin(801,601);
  assert.equal(fake.bindings.get(fake.gl.TEXTURE14),galaxy);
  buffer.dispose();
  assert.deepEqual([...fake.textures],[galaxy]);
  const failing=fakeGL({failAbove:16}),failedBuffer=new WorldBuffer(failing.gl,true);
  const retained=failing.gl.createTexture();
  failing.gl.bindTexture(failing.gl.TEXTURE_2D,retained);
  assert.throws(()=>failedBuffer.begin(800,600),/Incomplete world buffer/);
  assert.equal(failing.bindings.get(failing.gl.TEXTURE14),retained,'allocation failures also restore the sampler');
  failedBuffer.dispose();
});
