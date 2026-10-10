// Local, reproducible Black Marble codec experiment. Does not change site assets.
// node scripts/night-lights-benchmark.mjs /path/to/B2_gray.jpg /path/to/B2.jpg /tmp/night-lights-lab
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {createHash} from 'node:crypto';
const [graySource,colorSource,outArg]=process.argv.slice(2);
if(!outArg)throw new Error('Expected grayscale B2, color B2, output directory');
const out=path.resolve(outArg);fs.mkdirSync(out,{recursive:true});
sharp.concurrency(2);sharp.cache(false);
const regions=[
 {name:'Buenos Aires / Montevideo',west:-59.5,north:-33.5},
 {name:'São Paulo',west:-48.5,north:-22},
 {name:'Santiago',west:-72,north:-32},
 {name:'South Atlantic',west:-40,north:-35}
];
const sourceOptions={limitInputPixels:false};
const meta=await sharp(graySource,sourceOptions).metadata();
if(meta.width!==21600||meta.height!==21600)throw new Error('Expected NASA B2 at 21600 square');
const crop=r=>({left:Math.round((r.west+90)*240),top:Math.round(-r.north*240),width:1024,height:1024});
const input={raw:{width:2048,height:2048,channels:1}};
const reference=Buffer.alloc(2048*2048),color=Buffer.alloc(2048*2048*3);
for(const [i,r] of regions.entries()){
 const g=await sharp(graySource,sourceOptions).extract(crop(r)).toColourspace('b-w').raw().toBuffer();
 const rgb=await sharp(colorSource,sourceOptions).extract(crop(r)).removeAlpha().raw().toBuffer();
 for(let y=0;y<1024;y++){
  const start=((i>>1)*1024+y)*2048+(i%2)*1024;
  g.copy(reference,start,y*1024,(y+1)*1024);
  rgb.copy(color,start*3,y*3072,(y+1)*3072);
 }
}
await sharp(reference,input).toColourspace('b-w').png().toFile(path.join(out,'reference.png'));
await sharp(color,{raw:{width:2048,height:2048,channels:3}}).png().toFile(path.join(out,'color-reference.png'));
const variants=[
 ['gray-png','png',{compressionLevel:9}],
 ...[16,32,64].map(colours=>['png-'+colours,'png',{palette:true,colours,dither:0,effort:10}]),
 ['webp-lossless','webp',{lossless:true,effort:6}],
 ['webp-nearlossless','webp',{nearLossless:true,quality:80,effort:6}],
 ...[80,90,95].map(quality=>['webp-'+quality,'webp',{quality,effort:6}]),
 ...[40,50,65,80].map(quality=>['avif-'+quality,'avif',{quality,effort:5,chromaSubsampling:'4:4:4',bitdepth:8}]),
 ...[1024,512].map(width=>['half-'+width,'avif',{quality:65,effort:5,chromaSubsampling:'4:4:4',bitdepth:8},width])
];
const rows=[];
const metrics=(decoded)=>{
 let active=0,err=0,gradRef=0,gradErr=0,refSum=0,outSum=0,lit=0,lost=0,leaks=0;
 for(let y=0;y<2047;y++)for(let x=0;x<2047;x++){
  const i=y*2048+x,a=reference[i],b=decoded[i];
  refSum+=a;outSum+=b;
  if(a>=4){active++;err+=(a-b)**2;}
  if(a>=16){lit++;if(b<8)lost++;}
  if(a===0&&b>=8)leaks++;
  for(const step of [1,2048]){
   const ga=a-reference[i+step],gb=b-decoded[i+step];
   gradRef+=ga*ga;gradErr+=(ga-gb)**2;
  }
 }
 return {activeRmse:Math.sqrt(err/active),edgeError:Math.sqrt(gradErr/gradRef),fluxRatio:outSum/refSum,lostLitFraction:lost/lit,blackPixelsRaised:leaks};
};
for(const [name,format,settings,width=2048] of variants){
 const file=name+'.'+format,start=performance.now();
 // Explicit levels make the palette experiment deterministic: the encoder
 // can otherwise fall back to a full grayscale image to meet its quality target.
 const levels=name.startsWith('png-')?Number(name.slice(4)):0;
 const quantized=levels?Buffer.from(reference.map(v=>Math.round(Math.round(v*(levels-1)/255)*255/(levels-1)))):reference;
 let encoder=sharp(quantized,input).resize(width,width).toColourspace(levels?'srgb':'b-w');
 await encoder[format](settings).toFile(path.join(out,file));
 const decodeStart=performance.now();
 const decoded=await sharp(path.join(out,file)).resize(2048,2048,{kernel:'linear'}).toColourspace('b-w').raw().toBuffer();
 rows.push({name,file,width,settings,bytes:fs.statSync(path.join(out,file)).size,encodeMs:decodeStart-start,decodeMs:performance.now()-decodeStart,...metrics(decoded)});
 console.log(JSON.stringify(rows.at(-1)));
}
// Alpha is not needed for additive emission, but measure the proposed overlay.
const rgba=Buffer.alloc(reference.length*4);
for(let i=0;i<reference.length;i++){rgba[i*4]=255;rgba[i*4+1]=163;rgba[i*4+2]=77;rgba[i*4+3]=reference[i];}
for(const [name,data,raw,format,settings] of [
 ['rgba-overlay',rgba,{width:2048,height:2048,channels:4},'webp',{lossless:true,effort:6}],
 ['color-avif-50',color,{width:2048,height:2048,channels:3},'avif',{quality:50,effort:5,chromaSubsampling:'4:4:4'}]
]){
 const file=name+'.'+format;await sharp(data,{raw})[format](settings).toFile(path.join(out,file));
 rows.push({name,file,width:2048,bytes:fs.statSync(path.join(out,file)).size,settings,comparisonOnly:true});
}
// A native-resolution region for the actual Earth shader. Extent is 8192/240 degrees.
const extent={west:-77,north:-14,width:8192,height:8192};
extent.east=extent.west+extent.width/240;extent.south=extent.north-extent.height/240;
const rect={left:Math.round((extent.west+90)*240),top:Math.round(-extent.north*240),width:8192,height:8192};
const regional=await sharp(graySource,sourceOptions).extract(rect).toColourspace('b-w').raw().toBuffer();
const regionInput={raw:{width:8192,height:8192,channels:1}};
const scene=[];
for(const [name,width,format,settings] of [
 ['native-avif-50',8192,'avif',{quality:50,effort:4,chromaSubsampling:'4:4:4'}],
 ['native-avif-80',8192,'avif',{quality:80,effort:4,chromaSubsampling:'4:4:4'}],
 ['native-webp-lossless',8192,'webp',{lossless:true,effort:4}],
 ['native-webp-nearlossless',8192,'webp',{nearLossless:true,quality:80,effort:6}],
 ['half-avif-65',4096,'avif',{quality:65,effort:4,chromaSubsampling:'4:4:4'}]
]){
 const file=name+'.'+format;
 await sharp(regional,regionInput).resize(width,width).toColourspace('b-w')[format](settings).toFile(path.join(out,file));
 scene.push({name,file,width,bytes:fs.statSync(path.join(out,file)).size});
 console.log(scene.at(-1));
}
// Quantify empty space on one real 90x90-degree NASA tile; no global extrapolation.
const all=await sharp(graySource,sourceOptions).toColourspace('b-w').raw().toBuffer();
const sparse={sourcePixels:all.length,zeroPixels:0,atMost3:0,tileSize:512,total:0,empty:0,faintOnly:0,faintFlux:0,totalFlux:0};
for(let y=0;y<21600;y+=512)for(let x=0;x<21600;x+=512){
 let peak=0,sum=0;
 for(let j=y;j<Math.min(y+512,21600);j++)for(let k=x;k<Math.min(x+512,21600);k++){
  const v=all[j*21600+k];peak=Math.max(peak,v);sum+=v;
  if(!v)sparse.zeroPixels++;if(v<=3)sparse.atMost3++;
 }
 sparse.total++;sparse.totalFlux+=sum;if(!peak)sparse.empty++;
 if(peak<=3){sparse.faintOnly++;sparse.faintFlux+=sum;}
}
const manifest={source:'NASA Black Marble 2016 B2, grayscale / color, 500m',urls:[
 'https://assets.science.nasa.gov/content/dam/science/esd/eo/images/imagerecords/144000/144897/BlackMarble_2016_B2_gray.jpg',
 'https://assets.science.nasa.gov/content/dam/science/esd/eo/images/imagerecords/144000/144898/BlackMarble_2016_B2.jpg'],
 sourceSha256:createHash('sha256').update(fs.readFileSync(graySource)).digest('hex'),versions:sharp.versions,regions,rows,scene,extent,sparse};
fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(manifest,null,2));
console.log('Sparse coverage:',sparse);
