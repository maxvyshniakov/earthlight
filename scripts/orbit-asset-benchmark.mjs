// Local experiment, never writes production assets.
// encode /path/to/milkyway_2020_8k_gal.exr /tmp/orbit-codecs
// serve /tmp/orbit-codecs 4339 (serves dist with per-page texture/star overrides)
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
import {gzipSync,brotliCompressSync} from 'node:zlib';
import sharp from 'sharp';
const [mode,arg,outArg]=process.argv.slice(2);
const root=path.resolve(import.meta.dirname,'..');
sharp.concurrency(2);sharp.cache(false);
const width=mode==='encode4k'?4096:8192,height=width/2;
let variants=[
  ['jpeg-q80.jpg','jpeg',{quality:80,chromaSubsampling:'4:4:4',mozjpeg:true}],
  ['jpeg-q90.jpg','jpeg',{quality:90,chromaSubsampling:'4:4:4',mozjpeg:true}],
  ...[80,90,95].map(quality=>[`webp-q${quality}.webp`,'webp',{quality,effort:6,smartSubsample:true}]),
  ...[50,65,80].map(quality=>[`avif-q${quality}-444.avif`,'avif',{quality,effort:4,chromaSubsampling:'4:4:4',bitdepth:8}]),
  ['avif-q65-420.avif','avif',{quality:65,effort:4,chromaSubsampling:'4:2:0',bitdepth:8}],
];
if(mode==='encode4k')variants=variants.filter(([name])=>['webp-q80.webp','avif-q50-444.avif','avif-q65-444.avif'].includes(name));
const catalog=fs.readFileSync(path.join(root,'public/media/orbit/stars-hyg.bin'));
const subset=limit=>Buffer.concat(Array.from({length:catalog.length/32},(_,i)=>catalog.subarray(i*32,i*32+32)).filter(row=>row.readFloatLE(24)<=limit));
const counts=[7,6.75,6.5,6.25,6,5.5,5].map(limit=>{
  const data=subset(limit);
  return {limit,stars:data.length/32,removed:(catalog.length-data.length)/32,bytes:data.length,gzip:gzipSync(data).length,brotli:brotliCompressSync(data).length,savedBytes:catalog.length-data.length};
});
if(mode==='encode'||mode==='encode4k'){
  const out=path.resolve(outArg);fs.mkdirSync(out,{recursive:true});
  fs.writeFileSync(path.join(out,'stars.json'),JSON.stringify(counts,null,2));
  const rawFile=path.join(out,'reference.rgb');
  if(!fs.existsSync(rawFile)){
    console.log('Decoding original EXR');
    const decode=spawnSync('ffmpeg',['-v','error','-i',arg,'-pix_fmt','gbrpf32le','-f','rawvideo','pipe:1'],{maxBuffer:512*1024*1024});
    if(decode.status!==0||decode.stdout.length!==width*height*12)throw new Error('Unexpected EXR size');
    const pixels=Buffer.alloc(width*height*3),count=width*height;
    for(let i=0;i<count;i++)for(let c=0;c<3;c++)pixels[i*3+c]=Math.round(255*Math.pow(Math.max(0,Math.min(1,decode.stdout.readFloatLE(([2,0,1][c]*count+i)*4)*(width/4096)**2)),1/2.2));
    fs.writeFileSync(rawFile,pixels);
  }
  const raw=fs.readFileSync(rawFile),input={raw:{width,height,channels:3}};
  if(!fs.existsSync(path.join(out,'reference.png')))await sharp(raw,input).png().toFile(path.join(out,'reference.png'));
  // Recreate the historical JPEG baseline after production moved to AVIF.
  const baseline=path.join(out,'current.jpg');
  if(!fs.existsSync(baseline)){
    const encoded=spawnSync('ffmpeg',['-v','error','-f','rawvideo','-pix_fmt','rgb24','-s',`${width}x${height}`,'-i','pipe:0','-frames:v','1','-c:v','mjpeg','-q:v','2','-pix_fmt','yuvj444p','-y',baseline],{input:raw,maxBuffer:1024*1024});
    if(encoded.status!==0)throw new Error(encoded.stderr.toString());
  }
  const rows=[{file:'current.jpg',format:'jpeg',settings:{encoder:'ffmpeg mjpeg',q:2,chroma:'444'},bytes:fs.statSync(path.join(out,'current.jpg')).size}];
  for(const [file,format,settings] of variants){
    const output=path.join(out,file),start=performance.now();
    if(!fs.existsSync(output))await sharp(raw,input)[format](settings).toFile(output);
    const encodeSeconds=(performance.now()-start)/1000;
    const decoded=await sharp(output).removeAlpha().raw().toBuffer();
    let error=0,gradError=0,gradRef=0,gradOut=0,n=0;
    // Three fixed 512px patches: core, dust lanes, faint disk. Measure actual
    // night display intensity and small-scale luma gradients, not smooth-sky PSNR.
    const light=(data,p)=>[.2126,.7152,.0722].reduce((s,w,c)=>s+w*Math.pow(data[p+c]/255,1.5)*Math.pow(.036,1/2.2)*255,0);
    const factor=width/8192;
    for(const [cx,cy] of [[4096,2048],[5200,2050],[1800,1850]].map(p=>p.map(v=>v*factor)))for(let y=cy-256*factor;y<cy+256*factor;y++)for(let x=cx-256*factor;x<cx+256*factor;x++){
      const p=(y*width+x)*3,a=light(raw,p),b=light(decoded,p);
      error+=(a-b)**2;n++;
      for(const d of [3,width*3]){const ga=a-light(raw,p+d),gb=b-light(decoded,p+d);gradError+=(ga-gb)**2;gradRef+=ga*ga;gradOut+=gb*gb;}
    }
    const row={file,format,settings,bytes:fs.statSync(output).size,encodeSeconds,nightLumaRmse:Math.sqrt(error/n),gradientErrorFraction:Math.sqrt(gradError/gradRef),detailEnergyRatio:Math.sqrt(gradOut/gradRef)};
    rows.push(row);fs.writeFileSync(path.join(out,'codecs.json'),JSON.stringify({versions:sharp.versions,width,height,rows},null,2));console.log(JSON.stringify(row));
  }
  console.log('Star thresholds',JSON.stringify(counts));
}else if(mode==='serve'){
  const out=path.resolve(arg),port=Number(outArg||4339),dist=path.join(root,'dist');
  const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.jpg':'image/jpeg','.png':'image/png','.webp':'image/webp','.avif':'image/avif','.json':'application/json','.bin':'application/octet-stream','.svg':'image/svg+xml'};
  createServer((req,res)=>{
    const url=new URL(req.url,'http://localhost'),ref=new URL(req.headers.referer||'http://localhost');
    let filename;
    if(url.pathname==='/media/orbit/stars-hyg.bin'&&ref.searchParams.has('cutoff')){
      const data=subset(Number(ref.searchParams.get('cutoff')));res.writeHead(200,{'Content-Type':'application/octet-stream','Cache-Control':'no-store'});res.end(data);return;
    }
    if(url.pathname.startsWith('/bench/'))filename=path.join(out,path.basename(url.pathname));
    else if(url.pathname.includes('/media/orbit/milky-way')&&ref.searchParams.has('texture'))filename=path.join(out,path.basename(ref.searchParams.get('texture')));
    else filename=path.join(dist,url.pathname.endsWith('/')?url.pathname+'index.html':url.pathname);
    if(!filename.startsWith(dist+path.sep)&&!filename.startsWith(out+path.sep)){res.writeHead(403);res.end();return;}
    if(!fs.existsSync(filename)){res.writeHead(404);res.end();return;}
    res.writeHead(200,{'Content-Type':types[path.extname(filename)]||'application/octet-stream','Cache-Control':'no-store'});fs.createReadStream(filename).pipe(res);
  }).listen(port,'127.0.0.1',()=>console.log(`Benchmark: http://127.0.0.1:${port}/?t=610.87&motion=0&texture=reference.png`));
}else if(mode==='stars')console.log(JSON.stringify(counts,null,2));
else throw new Error('Use encode, serve, or stars');
