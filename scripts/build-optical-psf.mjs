// Offline Fourier-optics LUT. No runtime FFT or external image asset.
// Run with Node 24: node scripts/build-optical-psf.mjs
import { writeFileSync } from 'node:fs';
const N=512, size=256, span=64, states=3;
// Preserve the existing photometric normalization across every iris opening.
const integral=1.8577971262943016;
const bytes=new Uint8Array(size*size*states*3);
for(let state=0;state<states;state++){
const opening=state/(states-1);
function fft(re,im){
  for(let i=1,j=0;i<N;i++){
    let bit=N>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;
    if(i<j){[re[i],re[j]]=[re[j],re[i]];[im[i],im[j]]=[im[j],im[i]];}
  }
  for(let len=2;len<=N;len*=2){
    const angle=-2*Math.PI/len;
    for(let start=0;start<N;start+=len)for(let k=0;k<len/2;k++){
      const c=Math.cos(angle*k),s=Math.sin(angle*k),a=start+k,b=a+len/2;
      const r=re[b]*c-im[b]*s,i=re[b]*s+im[b]*c;
      re[b]=re[a]-r;im[b]=im[a]-i;re[a]+=r;im[a]+=i;
    }
  }
}
const channels=Array.from({length:3},()=>new Float64Array(N*N));
const weights=[0,0,0];
for(let lambda=420;lambda<=680;lambda+=5){
  const radius=56*550/lambda,re=new Float64Array(N*N),im=new Float64Array(N*N);
  for(let y=0;y<N;y++)for(let x=0;x<N;x++){
    const u=(x-N/2)/radius,v=(y-N/2)/radius,r2=u*u+v*v;
    let edge=1-Math.sqrt(r2);
    for(let k=0;k<6;k++)edge=Math.min(edge,(.91+.075*opening)-u*Math.cos(k*Math.PI/3+.27)-v*Math.sin(k*Math.PI/3+.27));
    const aperture=Math.max(0,Math.min(1,edge*radius+.5));
    // Small fixed wavefront errors in waves at 550 nm, not random screen noise.
    const opd=.025*(2*r2-1)+.025*(u*u-v*v)+.015*(3*r2-2)*u;
    const phase=2*Math.PI*opd*550/lambda;
    re[y*N+x]=aperture*Math.cos(phase);im[y*N+x]=aperture*Math.sin(phase);
  }
  for(let y=0;y<N;y++)fft(re.subarray(y*N,(y+1)*N),im.subarray(y*N,(y+1)*N));
  for(let x=0;x<N;x++){
    const r=new Float64Array(N),i=new Float64Array(N);
    for(let y=0;y<N;y++){r[y]=re[y*N+x];i[y]=im[y*N+x];}fft(r,i);
    for(let y=0;y<N;y++){re[y*N+x]=r[y];im[y*N+x]=i[y];}
  }
  const intensity=Float64Array.from(re,(r,i)=>r*r+im[i]*im[i]);
  const sum=intensity.reduce((a,b)=>a+b,0);
  for(let channel=0;channel<3;channel++){
    const response=Math.exp(-.5*((lambda-[610,540,460][channel])/[45,40,35][channel])**2);
    weights[channel]+=response;
    for(let y=0;y<N;y++)for(let x=0;x<N;x++)channels[channel][y*N+x]+=response*intensity[((y+N/2)%N)*N+(x+N/2)%N]/sum;
  }
}
const kernel=[];let kernelSum=0;
for(let y=-3;y<=3;y++)for(let x=-3;x<=3;x++){
  const weight=Math.exp(-(x*x+y*y)/2);kernel.push([x,y,weight]);kernelSum+=weight;
}
for(let c=0;c<3;c++){
  const input=channels[c],output=new Float64Array(N*N);
  for(let y=0;y<N;y++)for(let x=0;x<N;x++){
    let value=0;
    for(const [dx,dy,w] of kernel){const xx=x+dx,yy=y+dy;if(xx>=0&&xx<N&&yy>=0&&yy<N)value+=input[yy*N+xx]*w;}
    const r=Math.hypot(x-N/2,y-N/2)/(N/2);
    const taper=r<.70?1:r>=.98?0:.5+.5*Math.cos(Math.PI*(r-.70)/.28);
    output[y*N+x]=taper*value/kernelSum/weights[c];
  }
  const total=output.reduce((a,b)=>a+b,0);
  channels[c]=output.map(v=>v/total);
}
// Crop the central focal plane, then normalize each spectral channel to the
// same flux. The FFT pupil has twice the spatial sampling of the old LUT;
// this reduces staircase diffraction from the rasterized blade boundaries.
const cropped=channels.map(channel=>Float64Array.from({length:size*size},(_,i)=>
  channel[(Math.floor(i/size)+(N-size)/2)*N+i%size+(N-size)/2]));
for(let c=0;c<3;c++){
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const r=Math.hypot(x-size/2,y-size/2)/(size/2);
  // Suppress the finite FFT window gradually, well before its edge. Broad
  // scattering is an analytic tail at runtime, not a disc cropped into the LUT.
  cropped[c][y*size+x]*=Math.exp(-Math.pow(r/.32,4))*(r>=.98?0:1);
 }
 const total=cropped[c].reduce((a,b)=>a+b,0)*(span/size)**2;
 for(let i=0;i<size*size;i++)cropped[c][i]*=integral/total;
}
for(let i=0;i<size*size;i++)for(let c=0;c<3;c++)bytes[(state*size*size+i)*3+c]=Math.round(Math.max(0,Math.min(1,(Math.log2(cropped[c][i])+24)/26))*255);
}
const directory=new URL('../public/media/orbit/',import.meta.url);
writeFileSync(new URL('optical-psf.bin',directory),bytes);
writeFileSync(new URL('../src/data/optical-psf.json',import.meta.url),JSON.stringify({size,states,span,integral},null,2)+'\n');
console.log({bytes:bytes.length,integral});
