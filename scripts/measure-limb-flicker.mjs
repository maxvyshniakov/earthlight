// Pixel instability under sub-pixel camera turns, binned by view grazing.
// bun scripts/measure-limb-flicker.mjs <base-url> <out-dir> <label> [extra-query]
// Each view renders five frames turned by ~0.3 px steps in a fresh isolated
// agent-browser session. A band-limited image moving that little changes
// almost linearly at each pixel, so the second temporal difference
// |I(k-1)-2I(k)+I(k+1)| isolates aliasing from honest motion. The first
// difference over 0.6 px matches the owner's original limb measurement.
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import sharp from 'sharp';
const [base='http://127.0.0.1:4391',out='/tmp/earthlight-limb',label='current',extra='',only='']=process.argv.slice(2);
// SUPERSAMPLE=2 renders 2560 x 1600 and box-filters to 1280 x 800: a reference
// for the instability an ideally filtered frame would still show.
const scale=Number(process.env.SUPERSAMPLE??1);
const views=[
 // The owner's polar view at 6,490 km; its turn is a step in orientation x.
 {name:'polar',query:'t=1823.83&epoch=2026-06-13T08%3A29%3A36.170Z&orbit=high&flight=free&position=0.11965373%2C-0.06507290%2C2.01408503',
  turn:k=>`orientation=${(.0093430278+k*.00015).toFixed(10)}%2C0.0461255948%2C-0.5480009724%2C0.8351527235`},
 // ISS altitude (420 km) looking north over the Bay of Bengal's monsoon cloud.
 {name:'horizon',query:'t=0&epoch=2026-06-13T08%3A29%3A36.170Z&flight=free&'+issPose(8,86,20,420),
  turn:k=>`elevation=${(-.33+k*.0003).toFixed(6)}`},
].filter(v=>!only||only.split(',').includes(v.name));
function issPose(latDeg,lonDeg,headingDeg,altitude){
 const r=Math.PI/180,lat=latDeg*r,lon=lonDeg*r,h=headingDeg*r;
 const n=[Math.cos(lat)*Math.cos(lon),Math.cos(lat)*Math.sin(lon),Math.sin(lat)];
 const north=[-Math.sin(lat)*Math.cos(lon),-Math.sin(lat)*Math.sin(lon),Math.cos(lat)],east=[-Math.sin(lon),Math.cos(lon),0];
 return `position=${n.map(v=>(v*(1+altitude/6371)).toFixed(8)).join('%2C')}&heading=${north.map((v,i)=>(v*Math.cos(h)+east[i]*Math.sin(h)).toFixed(8)).join('%2C')}&roll=0`;
}
// Grain, auto exposure and the HUD are not under test; fix all three.
const fixed='motion=0&quality=fixed&look-grain=0&exposure-mode=manual&exposure-fixed=-0.6';
const settled=`(()=>{const s=document.querySelector('earthlight-explorer');return s.dataset.focus==='sharp'&&s.dataset.assetPhase==='settled'&&s.dataset.exposure==='settled'&&Number(s.dataset.cloudLightingProgress??0)===0&&['dayTiles','nightTiles','cloudTiles','terrainTiles','galaxyTiles'].every(k=>!s.dataset[k]||JSON.parse(s.dataset[k]).pending===0)})()`;
let session='';
const run=(...args)=>execFileSync('agent-browser',['--session',session,...args],{encoding:'utf8',timeout:180000,maxBuffer:8e6});
const evaluate=js=>JSON.parse(JSON.parse(run('eval','--base64',Buffer.from(`JSON.stringify(${js})`).toString('base64'))));
// Heavily loaded machines miss the first readiness window; retry once.
const wait=()=>{try{run('wait','--fn',settled);}catch{run('wait','--fn',settled);}};

const luminance=async file=>{
 const {data,info}=await sharp(file).removeAlpha().raw().toBuffer({resolveWithObject:true});
 const f=Math.round(info.width/1280),width=info.width/f,height=info.height/f,v=new Float32Array(width*height);
 for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){
  const i=y*info.width+x;v[Math.floor(y/f)*width+Math.floor(x/f)]+=(data[3*i]+data[3*i+1]+data[3*i+2])/(3*f*f);
 }
 return {v,width,height};
};
// Bands from the renderer's own camera: cosine between view ray and ground
// normal (mu) on the disc, and tangent height for rays that miss the ground.
function bands(width,height,camera,basis,focal){
 const label=new Uint8Array(width*height),c2=camera[0]**2+camera[1]**2+camera[2]**2;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const px=((x+.5)/width-.5)*width/height,py=(height-y-.5)/height-.5;
  let r=[0,1,2].map(i=>basis[i]*px+basis[3+i]*py+basis[6+i]*focal);const l=Math.hypot(...r);r=r.map(v=>v/l);
  const b=camera[0]*r[0]+camera[1]*r[1]+camera[2]*r[2],disc=b*b-c2+1;
  let band=0;
  if(b<0&&disc>=0){
   const t=-b-Math.sqrt(disc),g=[0,1,2].map(i=>camera[i]+r[i]*t),mu=-(g[0]*r[0]+g[1]*r[1]+g[2]*r[2]);
   band=mu<.1?1:mu<.25?2:mu<.5?3:4;
  }else{const h=(Math.sqrt(Math.max(0,c2-b*b))-1)*6371;if(b<0&&h<60)band=5;}
  label[y*width+x]=band;
 }
 return label;
}
const names=['space','limb mu<0.1','grazing 0.1-0.25','oblique 0.25-0.5','disc mu>0.5','air above limb <60 km'];

await mkdir(out,{recursive:true});
const report={label,extra,date:new Date().toISOString(),views:{}};
for(const view of views){
 const files=[];let camera,basis,focal;
 for(let k=0;k<5;k++){
  session=`limb-${process.pid}-${view.name}-${k}`;
  try{
   run('set','viewport',String(1280*scale),String(800*scale));
   run('open',`${base}/?${view.query}&${view.turn(k)}&${fixed}${extra?'&'+extra:''}`);
   wait();
   if(k===0){const s=evaluate(`{...document.querySelector('earthlight-explorer').dataset}`);camera=s.cameraPosition.split(',').map(Number);basis=JSON.parse(s.cameraBasis);focal=1.25*Number(s.lens);}
   evaluate(`(()=>{const style=document.createElement('style');style.id='limb-capture';style.textContent='earthlight-explorer > :not(canvas){visibility:hidden!important}';document.head.append(style);return true})()`);
   const file=`${out}/${label}-${view.name}-${k}.png`;run('screenshot',file);files.push(file);
  }finally{try{run('close');}catch{}}
 }
 const frames=await Promise.all(files.map(luminance));
 const {width,height}=frames[0],band=bands(width,height,camera,basis,focal);
 const sums=names.map(()=>({n:0,first:0,second:0}));
 const map=Buffer.alloc(width*height);
 for(let i=0;i<width*height;i++){
  const s=sums[band[i]];s.n++;
  s.first+=Math.abs(frames[2].v[i]-frames[0].v[i]);
  let second=0;for(let k=1;k<4;k++)second+=Math.abs(frames[k-1].v[i]-2*frames[k].v[i]+frames[k+1].v[i]);
  s.second+=second/3;map[i]=Math.min(255,second/3*16);
 }
 await sharp(map,{raw:{width,height,channels:1}}).png().toFile(`${out}/${label}-${view.name}-instability.png`);
 report.views[view.name]=Object.fromEntries(names.map((n,i)=>[n,{pixels:sums[i].n,turnDifference:+(sums[i].first/Math.max(1,sums[i].n)).toFixed(3),instability:+(sums[i].second/Math.max(1,sums[i].n)).toFixed(3)}]));
 console.log(view.name,JSON.stringify(report.views[view.name]));
}
await writeFile(`${out}/${label}.json`,JSON.stringify(report,null,1));
