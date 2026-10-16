// Offline Fourier-optics LUT. No runtime FFT or external image asset.
// Run with Bun: bun scripts/build-optical-psf.mjs, then
// bun scripts/pack-startup-assets.mjs for the gzipped transfer copy.
// One tile per f-number in OPTICAL_PSF_F_NUMBERS: the rounded nine-blade iris
// of src/scripts/camera-iris.ts flattens as it stops down. Below the tiles,
// the same atlas holds each f-number's far-field angular profile, the Sun's
// diffraction rays beyond the tiles' window.
import { writeFileSync } from 'node:fs';
import { irisDistance } from '../src/scripts/camera-iris.ts';
import { OPTICAL_PSF_F_NUMBERS } from '../src/scripts/camera-model.ts';
const N=512, size=256, span=64, states=OPTICAL_PSF_F_NUMBERS.length;
// Preserve the existing photometric normalization across every iris opening.
const integral=1.8577971262943016;
// Ray rows: 1020 angles per profile in four overlapping rows of 256, so
// linear filtering never mixes rows; eight semicircle blurs of the angle.
const rayRows=4,raySamples=rayRows*(size-1),rayLevels=[0,.5,1,2,4,8,16,32].map(degrees=>degrees*Math.PI/180);
const rayEncoding=[16,-14];
const tileBytes=size*size*states*3,bytes=new Uint8Array(tileBytes+size*rayRows*rayLevels.length*states*3);
const rayMean=[];
// Pupil scaled to the area of a unit disk: the f-number fixes the entrance
// pupil's area, so every state keeps the same flux and core size.
function equivalentScale(iris){
  let open=0;for(let y=0;y<400;y++)for(let x=0;x<400;x++)if(iris((x+.5)/400*3-1.5,(y+.5)/400*3-1.5)>0)open++;
  return Math.sqrt(open*9/160000/Math.PI);
}
function fft(re,im){
  const N=re.length;
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
function fft2(re,im,N){
  for(let y=0;y<N;y++)fft(re.subarray(y*N,(y+1)*N),im.subarray(y*N,(y+1)*N));
  const r=new Float64Array(N),i=new Float64Array(N);
  for(let x=0;x<N;x++){
    for(let y=0;y<N;y++){r[y]=re[y*N+x];i[y]=im[y*N+x];}fft(r,i);
    for(let y=0;y<N;y++){re[y*N+x]=r[y];im[y*N+x]=i[y];}
  }
}
// Broadband pupil field at one wavelength, `radius` samples per unit radius.
function pupilField(iris,equivalent,N,radius,lambda){
  const re=new Float64Array(N*N),im=new Float64Array(N*N);
  for(let y=0;y<N;y++)for(let x=0;x<N;x++){
    const u=(x-N/2)/radius,v=(y-N/2)/radius,r2=u*u+v*v;
    if(r2>2)continue;
    const aperture=Math.max(0,Math.min(1,iris(u*equivalent,v*equivalent)/equivalent*radius+.5));
    // Small fixed wavefront errors in waves at 550 nm, not random screen noise.
    const opd=.025*(2*r2-1)+.025*(u*u-v*v)+.015*(3*r2-2)*u;
    const phase=2*Math.PI*opd*550/lambda;
    re[y*N+x]=aperture*Math.cos(phase);im[y*N+x]=aperture*Math.sin(phase);
  }
  return [re,im];
}
const response=(lambda,channel)=>Math.exp(-.5*((lambda-[610,540,460][channel])/[45,40,35][channel])**2);
for(let state=0;state<states;state++){
const iris=irisDistance(OPTICAL_PSF_F_NUMBERS[state]),equivalent=equivalentScale(iris);
const channels=Array.from({length:3},()=>new Float64Array(N*N));
const weights=[0,0,0];
for(let lambda=420;lambda<=680;lambda+=5){
  const [re,im]=pupilField(iris,equivalent,N,56*550/lambda,lambda);
  fft2(re,im,N);
  const intensity=Float64Array.from(re,(r,i)=>r*r+im[i]*im[i]);
  const sum=intensity.reduce((a,b)=>a+b,0);
  for(let channel=0;channel<3;channel++){
    const weight=response(lambda,channel);
    weights[channel]+=weight;
    for(let y=0;y<N;y++)for(let x=0;x<N;x++)channels[channel][y*N+x]+=weight*intensity[((y+N/2)%N)*N+(x+N/2)%N]/sum;
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

// Far field: P(θ) = r³·I averaged over rings 60-160 CSS px at f/4 for unit
// flux, where the rays have settled into fans and r³·I is flat. Farther out
// the antialiased pupil edge starts to suppress it. A 2048² FFT with 448
// samples per unit pupil radius at 550 nm puts 0.5 CSS px in a sample.
const far=2048,profile=[0,1,2].map(()=>new Float64Array(raySamples)),farWeights=[0,0,0];
for(let lambda=430;lambda<=670;lambda+=20){
  const [re,im]=pupilField(iris,equivalent,far,448*550/lambda,lambda);
  fft2(re,im,far);
  let sum=0;for(let k=0;k<far*far;k++){re[k]=re[k]*re[k]+im[k]*im[k];sum+=re[k];}
  const at=(x,y)=>re[(((y%far)+far)%far)*far+((x%far)+far)%far];
  for(let channel=0;channel<3;channel++)farWeights[channel]+=response(lambda,channel);
  for(let t=0;t<raySamples;t++){
    let value=0,count=0;
    for(let r=60;r<=160;r+=5)for(let sub=0;sub<4;sub++){
      const angle=(t+(sub+.5)/4-.5)/raySamples*2*Math.PI,x=2*r*Math.cos(angle),y=2*r*Math.sin(angle);
      const x0=Math.floor(x),y0=Math.floor(y),fx=x-x0,fy=y-y0;
      value+=(at(x0,y0)*(1-fx)*(1-fy)+at(x0+1,y0)*fx*(1-fy)+at(x0,y0+1)*(1-fx)*fy+at(x0+1,y0+1)*fx*fy)*4/sum*r**3;count++;
    }
    for(let channel=0;channel<3;channel++)profile[channel][t]+=response(lambda,channel)*value/count;
  }
}
for(let channel=0;channel<3;channel++)for(let t=0;t<raySamples;t++)profile[channel][t]/=farWeights[channel];
rayMean.push(profile.map(channel=>+(channel.reduce((a,b)=>a+b,0)/raySamples).toFixed(6)));
rayLevels.forEach((blur,level)=>{
  const width=blur/(2*Math.PI)*raySamples,reach=Math.ceil(width),kernel=[];
  for(let i=-reach;i<=reach;i++)kernel.push(width<.5?(i===0?1:0):Math.sqrt(Math.max(0,1-(i/width)**2)));
  const total=kernel.reduce((a,b)=>a+b,0);
  for(let row=0;row<rayRows;row++)for(let x=0;x<size;x++){
    const sample=row*(size-1)+x;
    for(let channel=0;channel<3;channel++){
      let value=0;for(let i=-reach;i<=reach;i++)value+=profile[channel][((sample+i)%raySamples+raySamples)%raySamples]*kernel[i+reach];
      const code=(Math.log2(Math.max(value/total,2**rayEncoding[1]))-rayEncoding[1])/rayEncoding[0];
      bytes[tileBytes+(((state*rayLevels.length+level)*rayRows+row)*size+x)*3+channel]=Math.round(Math.max(0,Math.min(1,code))*255);
    }
  }
});
console.log(`f/${OPTICAL_PSF_F_NUMBERS[state]}: ray mean ${rayMean.at(-1)}`);
}
const directory=new URL('../public/media/earthlight/',import.meta.url);
writeFileSync(new URL('optical-psf-iris9.bin',directory),bytes);
const rays={rows:rayRows,samples:raySamples,levels:rayLevels.map(x=>+x.toFixed(6)),encoding:rayEncoding,mean:rayMean};
writeFileSync(new URL('../src/data/optical-psf.json',import.meta.url),JSON.stringify({size,states,span,integral,rays})+'\n');
console.log({bytes:bytes.length,integral});
