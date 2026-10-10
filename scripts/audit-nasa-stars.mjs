// Independent image/catalog cross-check. The EXR stays outside the repository.
// bun scripts/audit-nasa-stars.mjs /path/to/hiptyc_2020_8k_gal.exr
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {Rotation_EQJ_GAL} from 'astronomy-engine';
const source=process.argv[2];
const radius=Number(process.argv[3]??4);
if(!source)throw new Error('Pass NASA hiptyc_2020_8k_gal.exr');
const width=8192,height=4096,count=width*height;
const decoded=spawnSync('ffmpeg',['-v','error','-i',source,'-pix_fmt','gbrpf32le','-f','rawvideo','pipe:1'],{maxBuffer:512*1024*1024});
if(decoded.status!==0||decoded.stdout.length!==count*12)throw new Error('Expected NASA 8K RGB float EXR');
const map=decoded.stdout;
const rotation=Rotation_EQJ_GAL().rot;
const file=readFileSync(new URL('../public/media/orbit/stars-hyg.bin',import.meta.url));
const stars=Array.from({length:file.length/32},(_,i)=>Array.from({length:8},(_,j)=>file.readFloatLE(i*32+j*4)));
const sample=(x,y)=>{
  const i=Math.max(0,Math.min(height-1,y))*width+(x%width+width)%width;
  return [2,0,1].map(c=>map.readFloatLE((c*count+i)*4));
};
const rows=[];
for(const [id,star] of stars.entries()){
  if(star[6]>4)continue;
  const g=[0,1,2].map(j=>star.slice(0,3).reduce((sum,v,i)=>sum+v*rotation[i][j],0));
  const longitude=Math.atan2(g[1],g[0]),latitude=Math.asin(g[2]);
  const x=(.5-longitude/(2*Math.PI))*width-.5,y=(.5-latitude/Math.PI)*height-.5;
  let peak=-Infinity,px=0,py=0,flux=0;
  for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++){
    const xx=Math.round(x)+dx,yy=Math.round(y)+dy;
    const rgb=sample(xx,yy),light=rgb.reduce((a,b)=>a+b,0);
    flux+=light;
    if(light>peak){peak=light;px=xx;py=yy;}
  }
  const offset=Math.hypot((px-x)*Math.cos(latitude),py-y)*360/width*60;
  flux*=Math.cos(latitude); // Plate carree pixel solid angle.
  // Equal-radius image apertures; compare summed RGB only in similar B-V bins.
  rows.push({id,mag:star[6],bv:star[7],offsetArcmin:offset,flux,fluxPerMagnitude:flux/10**(-.4*star[6])});
}
const percentile=(values,q)=>values.sort((a,b)=>a-b)[Math.floor((values.length-1)*q)];
const isolation=Math.max(.6,2*radius*360/width+.1)*Math.PI/180;
const isolated=rows.filter(a=>!rows.some(b=>a.id!==b.id&&Math.acos(Math.min(1,stars[a.id].slice(0,3).reduce((s,v,i)=>s+v*stars[b.id][i],0)))<isolation));
const bins=[];
for(let lo=-.4;lo<2;lo+=.4){
  const group=isolated.filter(s=>s.bv>=lo&&s.bv<lo+.4&&s.offsetArcmin<5);
  if(group.length<5)continue;
  const median=percentile(group.map(s=>s.fluxPerMagnitude),.5);
  const errors=group.map(s=>Math.abs(-2.5*Math.log10(s.fluxPerMagnitude/median)));
  const meanX=group.reduce((a,s)=>a+s.mag,0)/group.length,meanY=group.reduce((a,s)=>a+Math.log10(s.flux),0)/group.length;
  const slope=group.reduce((a,s)=>a+(s.mag-meanX)*(Math.log10(s.flux)-meanY),0)/group.reduce((a,s)=>a+(s.mag-meanX)**2,0);
  bins.push({bv:[+lo.toFixed(1),+(lo+.4).toFixed(1)],count:group.length,logFluxSlope:slope,medianAbsoluteMagnitudeError:percentile(errors,.5),p90AbsoluteMagnitudeError:percentile(errors,.9)});
}
console.log(JSON.stringify({source,stars:rows.length,isolated:isolated.length,medianOffsetArcmin:percentile(isolated.map(s=>s.offsetArcmin),.5),p95OffsetArcmin:percentile(isolated.map(s=>s.offsetArcmin),.95),pixelArcmin:360/width*60,photometry:bins,worstOffsets:rows.sort((a,b)=>b.offsetArcmin-a.offsetArcmin).slice(0,8)},null,2));
