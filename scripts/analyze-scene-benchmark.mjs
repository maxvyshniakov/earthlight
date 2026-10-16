import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {issFrame,dot} from '../src/scripts/iss-orbit.ts';
import {equatorialFrame,transform} from '../src/scripts/celestial-sky.ts';
const out=path.resolve(process.argv[2]);
const load=async name=>sharp(path.join(out,name)).removeAlpha().raw().toBuffer({resolveWithObject:true});
const compare=(a,b,width,height)=>{
  const count=width*Math.floor(height*.77);let sum=0,sum2=0,max=0,over1=0,over3=0,over8=0;
  for(let i=0;i<count;i++){
    let peak=0;for(let c=0;c<3;c++){const e=Math.abs(a[i*3+c]-b[i*3+c]);sum+=e;sum2+=e*e;peak=Math.max(peak,e);}
    max=Math.max(max,peak);if(peak>1)over1++;if(peak>3)over3++;if(peak>8)over8++;
  }
  return {mae:sum/(count*3),rmse:Math.sqrt(sum2/(count*3)),max,percentOver1:over1/count*100,percentOver3:over3/count*100,percentOver8:over8/count*100};
};
const binary=fs.readFileSync(new URL('../public/media/earthlight/stars-hyg.bin',import.meta.url));
const stars=Array.from({length:binary.length/32},(_,i)=>Array.from({length:8},(_,j)=>binary.readFloatLE(i*32+j*4)));
const starRows=[];
for(const time of [610.87,1244.05,3433.69]){
  const baseline=await load(`stars-${Math.floor(time)}-7.png`),{width,height}=baseline.info;
  const orbit=issFrame(time),sky=equatorialFrame(orbit.date),basis=orbit.cameraBasis;
  for(const cutoff of [6.75,6.5,6,5.5]){
    const candidate=await load(`stars-${Math.floor(time)}-${cutoff}.png`);
    let removedInSky=0,visibleOver3=0,visibleOver8=0,visibleOver16=0,maxRemovedPeak=0;
    for(const star of stars){
      if(star[6]<=cutoff)continue;
      const v=transform(sky.starToFixed,star.slice(0,3));
      const view=[0,3,6].map(i=>dot(v,basis.slice(i,i+3)));
      if(view[2]<=0)continue;
      const x=Math.round(width*.5+height*1.25*view[0]/view[2]),y=Math.round(height*.5-height*1.25*view[1]/view[2]);
      if(x<3||x>=width-3||y<3||y>=height*.77-3)continue;
      removedInSky++;let peak=0;
      for(let yy=y-2;yy<=y+2;yy++)for(let xx=x-2;xx<=x+2;xx++)for(let c=0;c<3;c++){
        const i=(yy*width+xx)*3+c;peak=Math.max(peak,baseline.data[i]-candidate.data[i]);
      }
      maxRemovedPeak=Math.max(maxRemovedPeak,peak);if(peak>3)visibleOver3++;if(peak>8)visibleOver8++;if(peak>16)visibleOver16++;
    }
    starRows.push({time,cutoff,...compare(baseline.data,candidate.data,width,height),removedInSky,visibleOver3,visibleOver8,visibleOver16,maxRemovedPeak});
  }
}
fs.writeFileSync(path.join(out,'star-visual.json'),JSON.stringify(starRows,null,2));
console.log('Stars',JSON.stringify(starRows));
if(fs.existsSync(path.join(out,'texture-610-reference.png.png'))){
  const {rows}=JSON.parse(fs.readFileSync(path.join(out,'codecs.json'))),textureRows=[];
  for(const time of [610.87,3235.65]){
    const reference=await load(`texture-${Math.floor(time)}-reference.png.png`);
    for(const row of rows){
      const name=`texture-${Math.floor(time)}-${row.file}.png`;
      if(!fs.existsSync(path.join(out,name)))continue;
      const candidate=await load(name);
      textureRows.push({time,file:row.file,...compare(reference.data,candidate.data,reference.info.width,reference.info.height)});
    }
  }
  fs.writeFileSync(path.join(out,'texture-visual.json'),JSON.stringify(textureRows,null,2));console.log('Textures',JSON.stringify(textureRows));
}
