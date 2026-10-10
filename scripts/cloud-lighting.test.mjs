import {test} from 'bun:test';
import assert from 'node:assert/strict';
import {CloudLightingSchedule,CloudLightingAtlas} from '../src/scripts/cloud-lighting.ts';

const camera=(longitude=0,latitude=0,altitude=150)=>{
  const lon=longitude*Math.PI/180,lat=latitude*Math.PI/180,r=1+altitude/6371;
  return [r*Math.cos(lat)*Math.cos(lon),r*Math.cos(lat)*Math.sin(lon),r*Math.sin(lat)];
};
const sun=[1,0,0];
function bake(schedule,point=camera(),stamp='a',light=sun){
  schedule.update(point,light,0,stamp,true,0);
  schedule.update(point,light,0,stamp,true,701);
  assert.ok(schedule.pending);
  for(let i=0;i<63;i++)assert.equal(schedule.advance(),false);
  assert.equal(schedule.advance(),true);
}

test('lighting waits for settled imagery and publishes only complete atlases',()=>{
  const schedule=new CloudLightingSchedule();
  assert.deepEqual(schedule.update(camera(),sun,0,'a',false,0),{ready:false,work:true});
  schedule.update(camera(),sun,0,'a',false,800);assert.equal(schedule.pending,null);
  schedule.update(camera(),sun,0,'a',true,801);
  for(let i=0;i<63;i++){schedule.advance();assert.equal(schedule.current,null);}
  schedule.advance();assert.equal(schedule.generation,1);
  assert.deepEqual(schedule.update(camera(),sun,0,'a',true,900),{ready:true,work:false});
});

test('moving across the patch starts a replacement while keeping the old light',()=>{
  const schedule=new CloudLightingSchedule();bake(schedule);
  const first=schedule.current;
  assert.deepEqual(schedule.update(camera(5),sun,0,'a',true,900),{ready:true,work:true});
  assert.equal(schedule.current,first);assert.ok(schedule.pending);
  for(let i=0;i<64;i++)schedule.advance();
  assert.notEqual(schedule.current,first);assert.equal(schedule.generation,2);
  assert.deepEqual(schedule.update(camera(5),sun,0,'a',true,1000),{ready:true,work:false});
});

test('a teleport or new sun discards obsolete partial work and disables old light',()=>{
  const schedule=new CloudLightingSchedule();bake(schedule);
  schedule.update(camera(5),sun,0,'a',true,900);schedule.advance();
  assert.equal(schedule.update(camera(80),sun,0,'a',true,1000).ready,false);
  assert.equal(schedule.pending.chunk,0);
  assert.ok(Math.abs(schedule.pending.patch[0]-80*Math.PI/180)<1e-10);
  schedule.update(camera(80),[0,1,0],0,'a',true,1100);
  assert.deepEqual(schedule.pending.sun,[0,1,0]);
});

test('changed assets restart a bake only after their fade has settled',()=>{
  const schedule=new CloudLightingSchedule();bake(schedule);
  schedule.update(camera(),sun,0,'b',true,1000);assert.equal(schedule.pending,null);
  schedule.update(camera(),sun,0,'b',true,1701);schedule.advance();
  schedule.update(camera(),sun,0,'c',true,1800);assert.equal(schedule.pending,null);
  schedule.update(camera(),sun,0,'c',true,2501);assert.equal(schedule.pending.chunk,0);
});

test('longitude wraps across the dateline; polar and high views use traced light',()=>{
  const schedule=new CloudLightingSchedule();bake(schedule,camera(179));
  assert.deepEqual(schedule.update(camera(-179),sun,0,'a',true,900),{ready:true,work:false});
  assert.deepEqual(schedule.update(camera(179,80),sun,0,'a',true,1000),{ready:false,work:false});
  assert.deepEqual(schedule.update(camera(179,0,20000),sun,0,'a',true,1100),{ready:false,work:false});
});

test('cloud rotation moves both the sampling coordinates and the cached sun',()=>{
  const schedule=new CloudLightingSchedule();bake(schedule);
  // Compensate the world vectors for cloud rotation: the material has not moved.
  const time=1000,angle=time*.000008;
  const rotate=v=>[Math.cos(angle)*v[0]-Math.sin(angle)*v[1],Math.sin(angle)*v[0]+Math.cos(angle)*v[1],v[2]];
  assert.deepEqual(schedule.update(rotate(camera()),rotate(sun),time,'a',true,900),{ready:true,work:false});
});

test('low texture limits and sampler counts leave traced lighting available',()=>{
  const gl={MAX_TEXTURE_IMAGE_UNITS:1,MAX_TEXTURE_SIZE:2,getParameter:key=>key===1?16:2048};
  assert.equal(CloudLightingAtlas.supported(gl),true);
  gl.getParameter=key=>key===1?8:4096;assert.equal(CloudLightingAtlas.supported(gl),false);
  gl.getParameter=key=>key===1?16:1024;assert.equal(CloudLightingAtlas.supported(gl),false);
});


function allocationGL(failAt=Infinity){
  let unit=3,binding={prior:true},target={prior:true},allocations=0;
  const textures=new Set(),targets=new Set();
  const gl={ACTIVE_TEXTURE:1,TEXTURE_BINDING_2D:2,FRAMEBUFFER_BINDING:3,TEXTURE15:15,
    FRAMEBUFFER_COMPLETE:100,
    getParameter:key=>key===1?unit:key===2?binding:target,
    getAttribLocation:()=>0,getUniformLocation:()=>null,
    activeTexture:value=>{unit=value;},bindTexture:(_kind,value)=>{binding=value;},
    bindFramebuffer:(_kind,value)=>{target=value;},
    createTexture:()=>{const value={};textures.add(value);return value;},
    createFramebuffer:()=>{const value={};targets.add(value);return value;},
    deleteTexture:value=>textures.delete(value),deleteFramebuffer:value=>targets.delete(value),
    texImage2D:()=>{allocations++;},texParameteri(){},framebufferTexture2D(){},
    checkFramebufferStatus:()=>allocations===failAt?0:100,
    useProgram(){},uniform1i(){},deleteProgram(){},
  };
  return {gl,textures,targets,state:()=>({unit,binding,target})};
}

test('partial allocation failure releases both targets and restores caller bindings',()=>{
  for(const failAt of [1,2]){
    const fake=allocationGL(failAt),before=fake.state();
    assert.throws(()=>new CloudLightingAtlas(fake.gl,{},()=>{}),/framebuffer incomplete/);
    assert.equal(fake.textures.size,0);assert.equal(fake.targets.size,0);
    assert.deepEqual(fake.state(),before);
  }
});

test('disposing a complete atlas releases both textures and its framebuffer',()=>{
  const fake=allocationGL(),before=fake.state();
  const atlas=new CloudLightingAtlas(fake.gl,{},()=>{});
  assert.equal(fake.textures.size,2);assert.equal(fake.targets.size,1);
  assert.deepEqual(fake.state(),before);
  atlas.dispose();assert.equal(fake.textures.size,0);assert.equal(fake.targets.size,0);
});
