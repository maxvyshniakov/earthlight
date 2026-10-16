// Renders the background posters (src/scripts/background-poster.ts) through
// /lab/poster of a running build, in an isolated agent-browser session:
//   bun scripts/render-posters.mjs http://127.0.0.1:4322
// Writes public/media/earthlight/posters/<n>.webp and src/data/background-posters.json.
// Posters that look alike (the night side) share one file.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,rm,writeFile} from 'node:fs/promises';
import sharp from 'sharp';
import {equatorialFrame} from '../src/scripts/celestial-sky.ts';
import {POSTER_LATITUDES,POSTER_LONGITUDE_STEP,POSTER_WIDTH,POSTER_HEIGHT,posterCell} from '../src/scripts/background-poster.ts';
const exec=promisify(execFile);
const [base='http://127.0.0.1:4322']=process.argv.slice(2);
const out=new URL('../public/media/earthlight/posters/',import.meta.url);
const session=`posters-${process.pid}`;
const run=async(...args)=>(await exec('agent-browser',['--session',session,...args],{maxBuffer:32e6,timeout:120000})).stdout;
const degrees=180/Math.PI;
const subsolar=date=>{const [x,y,z]=equatorialFrame(date).sun;return {latitude:Math.asin(z)*degrees,longitude:Math.atan2(y,x)*degrees};};
const wrap=x=>((x+540)%360)-180;
/** A 2026 instant with the Sun overhead at (latitude, longitude). */
function epochFor(latitude,longitude){
 let best=null;
 for(let day=0;day<365;day++){
  const date=new Date(Date.UTC(2026,0,1+day,12)),error=Math.abs(subsolar(date).latitude-latitude);
  if(!best||error<best.error)best={date,error};
 }
 let time=best.date.getTime();
 for(let i=0;i<4;i++)time-=wrap(longitude-subsolar(new Date(time)).longitude)/15*3600000;
 return new Date(Math.round(time/1000)*1000);
}
const columns=Math.round(360/POSTER_LONGITUDE_STEP);
const kept=[],cells=[];
await rm(out,{recursive:true,force:true});await mkdir(out,{recursive:true});
await run('open','about:blank');await run('set','viewport','2100','900');
try{
 for(const [row,latitude] of POSTER_LATITUDES.entries())for(let column=0;column<columns;column++){
  const epoch=epochFor(latitude,wrap(column*POSTER_LONGITUDE_STEP));
  if(posterCell(epoch.getTime(),POSTER_LATITUDES,POSTER_LONGITUDE_STEP)!==row*columns+column)throw Error(`Cell mismatch at ${epoch.toISOString()}`);
  await run('open',`${base.replace(/\/$/,'')}/lab/poster/?epoch=${epoch.toISOString()}`);
  await run('wait','--fn','!!document.body.dataset.poster');
  const url=JSON.parse(await run('eval','document.body.dataset.poster'));
  const image=sharp(Buffer.from(url.slice(url.indexOf(',')+1),'base64')).resize(POSTER_WIDTH,POSTER_HEIGHT,{kernel:'lanczos3'});
  const pixels=await image.clone().resize(210,90).removeAlpha().raw().toBuffer();
  // Mean difference under 0.75 of 255: the same picture to the eye.
  let index=kept.findIndex(other=>other.reduce((sum,value,i)=>sum+Math.abs(value-pixels[i]),0)/pixels.length<.75);
  if(index<0){
   index=kept.push(pixels)-1;
   await writeFile(new URL(`${index}.webp`,out),await image.removeAlpha().webp({quality:75,effort:6}).toBuffer());
  }
  cells.push(index);
  console.log(`${latitude.toFixed(1)} ${wrap(column*POSTER_LONGITUDE_STEP)} ${epoch.toISOString()} -> ${index}`);
 }
}finally{await run('close').catch(()=>{});}
const posters={latitudes:POSTER_LATITUDES,longitudeStep:POSTER_LONGITUDE_STEP,width:POSTER_WIDTH,height:POSTER_HEIGHT,count:kept.length,cells:cells.map(x=>x.toString(36).padStart(2,'0')).join('')};
await writeFile(new URL('../src/data/background-posters.json',import.meta.url),JSON.stringify(posters,null,1)+'\n');
console.log(`${kept.length} posters for ${cells.length} cells`);
