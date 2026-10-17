import {test} from 'bun:test';
import assert from 'node:assert/strict';
import { DayPyramid, PYRAMID_TABLE, pyramidKey, pyramidLevel, pyramidTile } from '../src/scripts/day-pyramid.ts';

// Straight down from 420 km over Giza, at a lens magnification of `zoom`.
function nadir(lon,lat,zoom){
  const r=Math.PI/180,up=[Math.cos(lat*r)*Math.cos(lon*r),Math.cos(lat*r)*Math.sin(lon*r),Math.sin(lat*r)];
  const east=[-Math.sin(lon*r),Math.cos(lon*r),0],north=[up[1]*east[2]-up[2]*east[1],up[2]*east[0]-up[0]*east[2],up[0]*east[1]-up[1]*east[0]];
  const camera=up.map(v=>v*(1+420/6371));
  return {camera,cameraBasis:[...east,...north,...up.map(v=>-v)],sun:up,focal:1.25*zoom};
}
const tileOf=(level,lon,lat)=>pyramidKey(level,Math.floor((lon+180)/360*(160<<level)),Math.floor((90-lat)/180*(80<<level)));
function pyramid(keys){
  const result=Object.create(DayPyramid.prototype);
  Object.assign(result,{available:new Set(keys),directory:new Uint8Array(12800),table:new Uint8Array(PYRAMID_TABLE.width*PYRAMID_TABLE.height*4),wanted:0,baseURL:'/media/earthlight/'});
  return result;
}

test('pyramid keys round-trip and stay clear of BMNG ids',()=>{
  for(const [level,x,y] of [[1,0,0],[3,1279,639],[5,5119,2559],[5,2992,1667]]){
    const key=pyramidKey(level,x,y);
    assert.ok(key>=12800);
    assert.deepEqual(pyramidTile(key),{level,x,y});
  }
});

test('deep levels start only once BMNG runs out of texels',()=>{
  assert.equal(pyramidLevel(40),0);
  assert.equal(pyramidLevel(2),0);
  assert.equal(pyramidLevel(1.5),1);
  assert.equal(pyramidLevel(.25),2);
  assert.equal(pyramidLevel(.03),5);
  assert.equal(pyramidLevel(.001),5);
});

test('selection follows the footprint and falls back to the deepest available ancestor',()=>{
  const giza=[31.134,29.979],all=[];
  for(let level=1;level<=5;level++){
    const x0=Math.floor((30.375+180)/360*(160<<level)),y0=Math.floor((90-30.375)/180*(80<<level)),n=1<<(level-1);
    for(let y=y0;y<y0+n;y++)for(let x=x0;x<x0+n;x++)all.push(pyramidKey(level,x,y));
  }
  assert.equal(all.length,341);
  const full=pyramid(all);
  // At ½× a BMNG texel is half a pixel: nothing deep is wanted.
  assert.deepEqual(full.select(nadir(...giza,.5),1280,800,15),[]);
  const deep=full.select(nadir(...giza,50),1280,800,15);
  assert.ok(deep.length>0&&deep.length<=15);
  assert.ok(deep.includes(tileOf(5,...giza)));
  assert.ok(deep.every(key=>pyramidTile(key).level>=4));
  assert.equal(pyramidTile(deep[0]).level,4,'the coarser parent loads first');
  // Missing level 4 and 5 children: level 3 serves the same view.
  const sparse=pyramid(all.filter(key=>pyramidTile(key).level<=3));
  assert.ok(sparse.select(nadir(...giza,50),1280,800,15).includes(tileOf(3,...giza)));
  // Outside the region, nothing.
  assert.deepEqual(full.select(nadir(12.5,41.9,50),1280,800,15),[]);
});

test('the page table keeps the deepest resident tile and the one it replaces',()=>{
  const p=pyramid([]);
  // BMNG 4253 is column 93, row 26. Level 1 (187, 53) is its south-east
  // quadrant, cells 16–31; level 5 (2992, 848) is cell (16, 16).
  const l1=pyramidKey(1,187,53),l5=pyramidKey(5,2992,848);
  const resident=new Map([[l5,{slot:9,loaded:0}],[l1,{slot:3,loaded:0}],[4253,{slot:5,loaded:0}],[pyramidKey(4,1500,424),{slot:7,loaded:Infinity}]]);
  assert.equal(p.write(resident,1000),true);
  assert.equal(p.write(resident,1000),false);
  assert.equal(p.directory[4253],1);
  assert.equal(p.directory.reduce((a,b)=>a+b),1);
  const cell=(x,y)=>Array.from(p.table.subarray((y*PYRAMID_TABLE.width+x*2)*4,(y*PYRAMID_TABLE.width+x*2)*4+8));
  assert.deepEqual(cell(16,16),[9,5,255,0,3,1,0,0]);
  assert.deepEqual(cell(17,16),[3,1,255,0,0,0,0,0]);
  assert.deepEqual(cell(31,31),[3,1,255,0,0,0,0,0]);
  assert.deepEqual(cell(15,16),[0,0,0,0,0,0,0,0]);
  assert.deepEqual(cell(16,15),[0,0,0,0,0,0,0,0]);
  // A tile still fading in keeps its ancestor for the shader's cross-fade.
  p.write(new Map([[l1,{slot:3,loaded:0}],[l5,{slot:9,loaded:900}]]),1000);
  const fading=cell(16,16);
  assert.deepEqual([fading[0],fading[1],fading[4],fading[5]],[9,5,3,1]);
  assert.ok(fading[2]>0&&fading[2]<255);
});
