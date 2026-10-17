// Where a measured cloud day's swath edges are drawn (cloudStudy=global):
// the mean opacity step |R(s + 5 km) - R(s - 5 km)| of the overview across
// the modelled edges (cloudPropertiesSwathEdge), by offset s, in 8 degree
// latitude bands where both sides were observed. Prints each band's peak and
// the edge offset, a quadratic in sin(latitude), that would put the peaks at
// zero; CLOUD_PROPERTIES_SWATHS holds the fitted day's.
//   bun scripts/fit-cloud-swath-edges.mjs [YYYY-MM-DD]
import sharp from 'sharp';
import {CLOUD_PROPERTIES_DATE,cloudPropertiesPath,cloudPropertiesSwathDay,cloudPropertiesSwathEdge,CLOUD_PROPERTIES_OVERVIEW} from '../src/scripts/cloud-properties.ts';
const date=process.argv[2]??CLOUD_PROPERTIES_DATE,day=cloudPropertiesSwathDay(date);
if(!day)throw Error(`No orbit fit for ${date}`);
const file=new URL(`../public/media/earthlight/${cloudPropertiesPath(date)}/${CLOUD_PROPERTIES_OVERVIEW}`,import.meta.url);
const {data,info}=await sharp(file.pathname).raw().toBuffer({resolveWithObject:true});
const W=info.width,H=info.height,C=info.channels;
const sample=(v,channel=0)=>{
  const lat=Math.asin(Math.max(-1,Math.min(1,v[2]))),lon=Math.atan2(v[1],v[0]);
  const x=(lon/(2*Math.PI)+.5)*W-.5,y=(.5-lat/Math.PI)*H-.5,x0=Math.floor(x),y0=Math.max(0,Math.min(H-2,Math.floor(y))),fx=x-x0,fy=y-y0;
  const g=(i,j)=>data[(j*W+((i%W)+W)%W)*C+channel]/255;
  return (g(x0,y0)*(1-fx)+g(x0+1,y0)*fx)*(1-fy)+(g(x0,y0+1)*(1-fx)+g(x0+1,y0+1)*fx)*fy;
};
const rad=Math.PI/180,unit=(lat,lon)=>[Math.cos(lat*rad)*Math.cos(lon*rad),Math.cos(lat*rad)*Math.sin(lon*rad),Math.sin(lat*rad)];
const offsets=[];for(let d=-50;d<=50;d+=2)offsets.push(d);
const peaks=[];
for(let south=-64;south<64;south+=8){
  const sum=new Float64Array(offsets.length);let edges=0;
  for(let lat=south;lat<south+8;lat+=.25){
    let previous=null;
    for(let lon=-180;lon<180;lon+=.05){
      const edge=cloudPropertiesSwathEdge(unit(lat,lon),day);
      if(previous?.valid&&edge.valid&&previous.distance<0&&edge.distance>=0&&edge.distance<10){
        const p=unit(lat,lon),n=edge.across;
        const at=km=>{const a=(km-edge.distance)/6371;return p.map((x,i)=>x*Math.cos(a)+n[i]*Math.sin(a));};
        // Both sides observed (alpha >= 0.225), well beyond the band.
        if(sample(at(-80),3)>=.225&&sample(at(80),3)>=.225){
          offsets.forEach((d,i)=>{sum[i]+=Math.abs(sample(at(d+5))-sample(at(d-5)));});edges++;
        }
      }
      previous=edge;
    }
  }
  const mean=[...sum].map(x=>x/edges),j=mean.indexOf(Math.max(...mean));
  const a=mean[j-1]??mean[j],b=mean[j+1]??mean[j],peak=offsets[j]+(a-b)/(2*(a-2*mean[j]+b)||1)*2;
  const floor=[...mean].sort((x,y)=>x-y)[mean.length>>1];
  // A peak on the window's end is another feature, not this band's edges.
  const inside=j>0&&j<offsets.length-1;
  if(inside)peaks.push([Math.sin((south+4)*rad),peak]);
  console.log(`${south}..${south+8}`.padEnd(8),'edges',String(edges).padStart(4),'peak',peak.toFixed(1).padStart(6),'km  contrast',(mean[j]/floor).toFixed(2),inside?'':'(not fitted)');
}
// Least squares: residual peak = r0 + r1 s + r2 s^2, added to the current offset.
const A=[[0,0,0,0],[0,0,0,0],[0,0,0,0]];
for(const [s,y] of peaks)for(let i=0;i<3;i++){for(let k=0;k<3;k++)A[i][k]+=s**(i+k);A[i][3]+=y*s**i;}
for(let i=0;i<3;i++)for(let r=i+1;r<3;r++){const f=A[r][i]/A[i][i];for(let c=i;c<4;c++)A[r][c]-=f*A[i][c];}
const r=[0,0,0];for(let i=2;i>=0;i--)r[i]=(A[i][3]-A[i].slice(i+1,3).reduce((s,v,k)=>s+v*r[i+1+k],0))/A[i][i];
console.log('edge offset',day.edgeOffset.map((x,i)=>+(x+r[i]).toFixed(1)),'(current',day.edgeOffset,')');
