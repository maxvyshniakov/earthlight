import {test} from 'bun:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import sharp from 'sharp';
import {decodeTerrain} from '../src/scripts/earth-terrain.ts';
import {TerrainBound,boundLevels,boundCode,boundMetres,terrainBoundGrid,tileCellMaxima,patchMaximum,BOUND_COLUMNS,BOUND_ROWS} from '../src/scripts/terrain-bound.ts';

const raw=gunzipSync(readFileSync(new URL('../public/media/earthlight/earth-terrain-4096-v2.dem',import.meta.url)));
const terrain=decodeTerrain(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength));
const random=(seed=>()=>((seed=Math.imul(seed^seed>>>15,2246822519)+1013904223>>>0)/2**32))(17);

test('codes never understate packed heights and keep zero for unknown',()=>{
 for(let units=0;units<=1125;units++)assert.ok(boundMetres(boundCode(units))>=units*8);
 assert.equal(boundMetres(0),Infinity);
 assert.ok(boundCode(1125)<255,'the highest DEM value still yields a usable bound');
});

test('global grid covers every texel of the decoded map, rows counted from the north',()=>{
 const {data,width,height}=terrain.levels[0],grid=terrainBoundGrid(data,width,height);
 for(let n=0;n<200000;n++){
  const x=Math.floor(random()*width),y=Math.floor(random()*height),i=(y*width+x)*3;
  const cell=Math.min(BOUND_ROWS-1,Math.floor((1-(y+.5)/height)*BOUND_ROWS))*BOUND_COLUMNS+Math.floor((x+.5)/width*BOUND_COLUMNS);
  assert.ok(grid[cell]>=boundCode(data[i]*256+data[i+1]));
 }
 const at=(lon,lat)=>grid[Math.floor((90-lat)/180*BOUND_ROWS)*BOUND_COLUMNS+Math.floor((lon+180)/360*BOUND_COLUMNS)];
 assert.equal(boundMetres(at(-130.2,0.2)),0,'open Pacific');
 assert.ok(boundMetres(at(88.2,32.2))>4500,'Tibet');
});

test('stored levels dominate every level-0 cell in their 3 x 3 window',()=>{
 const bound=new TerrainBound(),truth=new Uint8Array(BOUND_COLUMNS*BOUND_ROWS);
 for(let n=0;n<4000;n++){
  const column=Math.floor(random()*BOUND_COLUMNS),row=Math.floor(random()*BOUND_ROWS),code=1+Math.floor(random()*240);
  bound.raise(column,row,code);truth[row*BOUND_COLUMNS+column]=Math.max(truth[row*BOUND_COLUMNS+column],code);
 }
 for(const [level,[,,width,height]] of boundLevels.entries()){
  const scale=2**level;
  for(let i=0;i<truth.length;i++){
   if(!truth[i])continue;
   const column=Math.floor((i%BOUND_COLUMNS)/scale),row=Math.floor(Math.floor(i/BOUND_COLUMNS)/scale);
   for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
    const y=row+dy;if(y<0||y>=height)continue;
    assert.ok(bound.dilated[level][y*width+(column+dx+width)%width]>=truth[i]);
   }
  }
 }
});

test('nothing is published before the global maxima arrive',()=>{
 const bound=new TerrainBound(),writes=[];
 bound.raise(10,10,40);
 assert.equal(bound.flush((...args)=>writes.push(args)),0);
 bound.raiseGrid(new Uint8Array(BOUND_COLUMNS*BOUND_ROWS).fill(1));
 assert.ok(bound.flush((x,y,w,h,data)=>{writes.push([x,y,w,h]);assert.equal(data.length,w*h*4);})>0);
 assert.deepEqual(writes[0],[800,0,720,360]);
 assert.equal(bound.flush(()=>assert.fail('clean levels are not rewritten')),0);
});

// Mirror of terrainTrackBound in terrain-bound.ts. Keep the two in step.
const earthUV=n=>[Math.atan2(n[1],n[0])/(2*Math.PI)+.5,Math.asin(Math.max(-1,Math.min(1,n[2])))/Math.PI+.5];
const normalize=v=>{const l=Math.hypot(...v);return v.map(x=>x/l);};
const fract=x=>x-Math.floor(x);
function trackLevelCell(a,b,margin){
 const m=normalize(a.map((v,i)=>v+b[i])),polar=Math.max(Math.abs(a[2]),Math.abs(b[2]),Math.abs(m[2]));
 if(polar>.98)return null;
 const ua=earthUV(a),ub=earthUV(b),um=earthUV(m);
 const du=Math.max(Math.abs(fract(ub[0]-ua[0]+.5)-.5),Math.abs(fract(um[0]-ua[0]+.5)-.5));
 const dv=Math.max(Math.abs(ub[1]-ua[1]),Math.abs(um[1]-ua[1]));
 const span=Math.max((du+margin/(2*Math.PI*Math.sqrt(1-polar*polar)))*BOUND_COLUMNS,(dv+margin/Math.PI)*BOUND_ROWS)+.25;
 const level=Math.ceil(Math.log2(Math.max(1,span)));
 if(level>boundLevels.length-1)return null;
 const [,,width,height]=boundLevels[level],scale=2**level;
 return {level,column:Math.min(width-1,Math.floor(fract(ua[0])*BOUND_COLUMNS/scale)),row:Math.min(height-1,Math.floor(Math.min(.999999,1-ua[1])*BOUND_ROWS/scale))};
}
test('one stored texel bounds every cell within the margin of a great-circle track',()=>{
 const bound=new TerrainBound(),grid=new Uint8Array(BOUND_COLUMNS*BOUND_ROWS);
 for(let i=0;i<grid.length;i++)grid[i]=1+Math.floor(random()*250);
 bound.raiseGrid(grid);
 let checked=0;
 for(let n=0;n<3000;n++){
  const a=normalize([random()-.5,random()-.5,(random()-.5)*1.6]);
  const length=random()<.5?random()*.006:random()*.2,margin=random()*.004;
  const side=normalize([a[1],-a[0],0]),turn=random()*Math.PI*2;
  const direction=side.map((v,i)=>v*Math.cos(turn)+[a[1]*side[2]-a[2]*side[1],a[2]*side[0]-a[0]*side[2],a[0]*side[1]-a[1]*side[0]][i]*Math.sin(turn));
  const b=normalize(a.map((v,i)=>v*Math.cos(length)+direction[i]*Math.sin(length)));
  const cell=trackLevelCell(a,b,margin);if(!cell)continue;
  const [,,width]=boundLevels[cell.level],stored=bound.dilated[cell.level][cell.row*width+cell.column];
  for(let k=0;k<=64;k++){
   const t=k/64,p=normalize(a.map((v,i)=>v*Math.sin((1-t)*length)+b[i]*Math.sin(t*length)));
   for(const offset of [[0,0],[1,0],[-1,0],[0,1],[0,-1]]){
    const east=normalize([-p[1],p[0],0]),north=[p[1]*east[2]-p[2]*east[1],p[2]*east[0]-p[0]*east[2],p[0]*east[1]-p[1]*east[0]];
    const q=normalize(p.map((v,i)=>v+(east[i]*offset[0]+north[i]*offset[1])*margin));
    const [u,v]=earthUV(q),truth=grid[Math.min(BOUND_ROWS-1,Math.floor((1-v)*BOUND_ROWS))*BOUND_COLUMNS+Math.min(BOUND_COLUMNS-1,Math.floor(fract(u)*BOUND_COLUMNS))];
    assert.ok(stored>=truth,`level ${cell.level}: ${stored} < ${truth}`);checked++;
   }
  }
 }
 assert.ok(checked>100000);
});

test('ETOPO tile cell maxima include filter reach and match the full tile peak',async()=>{
 const {data}=await sharp(new URL('../public/media/earthlight/terrain-tiles/598.png',import.meta.url).pathname).ensureAlpha().extract({left:0,top:0,width:572,height:572}).raw().toBuffer({resolveWithObject:true});
 const maxima=tileCellMaxima(data);
 let peak=0,interior=0;
 for(let y=0;y<572;y++)for(let x=0;x<572;x++){const v=data[(y*572+x)*4]*256+data[(y*572+x)*4+1];peak=Math.max(peak,v);if(x>=16&&x<556&&y>=16&&y<556)interior=Math.max(interior,v);}
 const inner=Math.max(...maxima);
 assert.ok(inner>=interior&&inner<=peak,'cells cover the interior plus one pixel of gutter');
 for(let n=0;n<20000;n++){
  const x=16+Math.floor(random()*540),y=16+Math.floor(random()*540),cell=Math.floor((y-16)/30)*18+Math.floor((x-16)/30);
  assert.ok(maxima[cell]>=data[(y*572+x)*4]*256+data[(y*572+x)*4+1]);
 }
 const patch=new Uint8Array(4*4*2*4);patch[(1*8+2)*4]=3;patch[(1*8+2)*4+1]=7;patch[(1*8+6)*4]=9;
 assert.equal(patchMaximum(patch,4),3*256+7,'mip squares on the right are excluded');
});
