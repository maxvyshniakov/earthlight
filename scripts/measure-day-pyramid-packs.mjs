// Bytes per view for the day pyramid's release packs (docs/lab/
// day-pyramid-global-2026-10-17.md, "Whole packs"), from the renderer's own
// tile selection (DayPyramid.select) straight down from the ISS's 420 km on a
// 1280 × 800 view, with a cold pack cache:
//
//   ideal   the wanted tiles' own bytes, as HTTP range reads would fetch them;
//   packs   the release packs those tiles are in, fetched whole (the media
//           host ignores Range);
//   day     the builder's day tile packs (one per day tile, all three levels,
//           the previous release layout) the same tiles are in, fetched whole.
//
// `session` zooms 2× → 4× → 8× → 20× → 50× over each region with the cache
// kept, so coarser packs already fetched serve as parents.
//
//   bun scripts/measure-day-pyramid-packs.mjs <release-dir> [<day-tile-packs-dir>] [--random=300] [--limit=15] [--json=file]
import { open, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DayPyramid, pyramidTile } from '../src/scripts/day-pyramid.ts';
import { decodeIndex, decodePackHeader, packHeaderLength, PACK_DEPTH, MAX_PACK_K } from '../src/scripts/day-pyramid-pack.ts';

const [release,build]=process.argv.slice(2).filter(a=>!a.startsWith('--'));
if(!release)throw new Error('Usage: measure-day-pyramid-packs.mjs <release-dir> [<day-tile-packs-dir>] [--random=N] [--limit=N] [--json=file]');
const option=(name,fallback)=>process.argv.find(a=>a.startsWith(`--${name}=`))?.split('=')[1]??fallback;
const limit=Number(option('limit',15)),randomViews=Number(option('random',300));
export const REGIONS={netherlands:[4.9,52.37],alps:[7.66,45.98],cairo:[31.24,30.04],himalaya:[86.71,27.81]};
export const ZOOMS=[2,4,8,20,50];

// Pack sizes and every tile's length, from the release packs' headers.
const packBytes=new Map(),tileBytes=new Map();
for(let level=1;level<=PACK_DEPTH;level++)for(const name of await readdir(join(release,String(level)))){
  const file=await open(join(release,String(level),name)),head=Buffer.alloc(packHeaderLength(MAX_PACK_K)),{bytesRead}=await file.read(head,0,head.length,0);await file.close();
  const header=decodePackHeader(new Uint8Array(head.buffer,head.byteOffset,bytesRead)),side=1<<header.k;
  packBytes.set(`${level}/${name}`,header.bytes);
  header.entries.forEach(([,length],slot)=>{if(length)tileBytes.set(level*1e8+(header.y+(slot>>header.k))*160*2**level+header.x+slot%side,length);});
}
const dayBytes=new Map();
if(build)for(const name of (await readdir(build)).filter(n=>/^\d+\.pack$/.test(n)))dayBytes.set(Number(name.slice(0,-5)),(await stat(join(build,name))).size);

const pyramid=Object.create(DayPyramid.prototype);
Object.assign(pyramid,{packs:decodeIndex(new Uint8Array(await readFile(join(release,'index.bin')))),directory:new Uint8Array(12800),table:new Uint8Array(0),wanted:0,requests:0,received:0,cached:0,cache:new Map(),loading:new Map(),signature:'',root:'',cacheBytes:Infinity});

function nadir(lon,lat,zoom){
  const r=Math.PI/180,up=[Math.cos(lat*r)*Math.cos(lon*r),Math.cos(lat*r)*Math.sin(lon*r),Math.sin(lat*r)];
  const east=[-Math.sin(lon*r),Math.cos(lon*r),0],north=[up[1]*east[2]-up[2]*east[1],up[2]*east[0]-up[0]*east[2],up[0]*east[1]-up[1]*east[0]];
  return {camera:up.map(v=>v*(1+420/6371)),cameraBasis:[...east,...north,...up.map(v=>-v)],sun:up,focal:1.25*zoom};
}
const dayOf=key=>{const {level,x,y}=pyramidTile(key);return (y>>level)*160+(x>>level);};
function view(lon,lat,zoom,fetched=new Set()){
  const keys=pyramid.select(nadir(lon,lat,zoom),1280,800,limit);
  const packs=new Set(keys.map(key=>pyramid.locate(key).path)),days=new Set(keys.map(dayOf));
  const fresh=[...packs].filter(path=>!fetched.has(path));
  return {keys,tiles:keys.length,levels:[...new Set(keys.map(key=>pyramidTile(key).level))].sort().join(''),
    ideal:keys.reduce((sum,key)=>sum+tileBytes.get(key),0),
    packs:fresh.reduce((sum,path)=>sum+packBytes.get(path),0),packCount:fresh.length,
    day:build?[...days].reduce((sum,id)=>sum+dayBytes.get(id),0):null,dayCount:days.size,fresh};
}
const mb=bytes=>bytes==null?'–':(bytes/1e6).toFixed(2);
const rows=[];
console.log(`${packBytes.size} release packs, ${tileBytes.size} tiles; limit ${limit} deep tiles per view\n`);
console.log('view               levels tiles  ideal MB  packs MB (n)   ×ideal   day packs MB (n)  ×ideal');
for(const [region,[lon,lat]] of Object.entries(REGIONS))for(const zoom of ZOOMS){
  const v=view(lon,lat,zoom);rows.push({region,zoom,...v,keys:undefined,fresh:undefined});
  console.log(`${`${region} ${zoom}×`.padEnd(18)} L${v.levels.padEnd(5)} ${String(v.tiles).padStart(5)} ${mb(v.ideal).padStart(9)} ${mb(v.packs).padStart(9)} (${v.packCount}) ${(v.packs/v.ideal).toFixed(1).padStart(7)} ${mb(v.day).padStart(12)} (${v.dayCount}) ${build?(v.day/v.ideal).toFixed(1).padStart(7):''}`);
}
console.log('\nsession 2× → 50× with the cache kept: packs MB / ideal MB (distinct tiles)');
const sessions=[];
for(const [region,[lon,lat]] of Object.entries(REGIONS)){
  pyramid.cache=new Map();const fetched=new Set(),seen=new Set();let packs=0,day=0;const days=new Set();
  for(const zoom of ZOOMS){
    const v=view(lon,lat,zoom,fetched);packs+=v.packs;
    for(const path of v.fresh){fetched.add(path);pyramid.cache.set(path,{});}
    for(const key of v.keys)seen.add(key);
    for(const key of v.keys){const id=dayOf(key);if(!days.has(id)){days.add(id);day+=dayBytes.get(id)??0;}}
  }
  const ideal=[...seen].reduce((sum,key)=>sum+tileBytes.get(key),0);
  sessions.push({region,packs,ideal,day:build?day:null});
  console.log(`${region.padEnd(12)} ${mb(packs)} / ${mb(ideal)} (${(packs/ideal).toFixed(1)}×)${build?`; day packs ${mb(day)} (${(day/ideal).toFixed(1)}×)`:''}`);
}
pyramid.cache=new Map();
// Random land: day tiles with detail, a random point in each.
let seed=7;const random=()=>(seed=seed*16807%2147483647)/2147483647,ids=[...pyramid.packs.keys()];
const sums=Object.fromEntries(ZOOMS.map(zoom=>[zoom,{views:0,ideal:0,packs:0,day:0}]));
for(let i=0;i<randomViews;i++){
  const id=ids[Math.floor(random()*ids.length)],lon=(id%160+random())*2.25-180,lat=90-(Math.floor(id/160)+random())*2.25;
  for(const zoom of ZOOMS){const v=view(lon,lat,zoom);if(!v.tiles)continue;const s=sums[zoom];s.views++;s.ideal+=v.ideal;s.packs+=v.packs;s.day+=v.day??0;}
}
console.log(`\n${randomViews} random land views, mean MB per view: ideal / packs / day packs`);
for(const zoom of ZOOMS){const s=sums[zoom];console.log(`${String(zoom).padStart(3)}×  ${mb(s.ideal/s.views)} / ${mb(s.packs/s.views)} (${(s.packs/s.ideal).toFixed(1)}×)${build?` / ${mb(s.day/s.views)} (${(s.day/s.ideal).toFixed(1)}×)`:''}  over ${s.views} views`);}
if(option('json'))await writeFile(option('json'),JSON.stringify({limit,rows,sessions,random:sums},null,1)+'\n');
