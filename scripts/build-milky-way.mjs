// Convert NASA SVS's linear EXR background to a small web texture.
// Requires ffmpeg/ffprobe; accepts NASA's 4k or 8k galactic EXR.
// Source, coordinate convention, and credit: public/media/earthlight/README.md.
import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
const source=process.argv[2];
if(!source)throw new Error('Pass NASA milkyway_2020_[4k|8k]_gal.exr');
const probe=spawnSync('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=width,height','-of','json',source]);
if(probe.status!==0)throw new Error(probe.stderr.toString());
const {width,height}=JSON.parse(probe.stdout.toString()).streams[0];
if(![4096,8192].includes(width)||height!==width/2)throw new Error('Expected NASA 4k or 8k 2:1 source');
const decode=spawnSync('ffmpeg',['-v','error','-i',source,'-pix_fmt','gbrpf32le','-f','rawvideo','pipe:1'],{maxBuffer:512*1024*1024});
if(decode.status!==0)throw new Error(decode.stderr.toString());
const count=width*height;
if(decode.stdout.length!==count*12)throw new Error('Unexpected decoded RGB float size');
const pixels=Buffer.alloc(count*3);
// NASA rasterizes the same stellar flux into four times as many pixels at 8K.
// Normalize pixel area before storing the map as surface brightness.
const pixelAreaScale=(width/4096)**2;
sharp.concurrency(2);
// Find extended galactic structure in the source itself. A ~0.7 degree
// low-pass guide prevents isolated noisy pixels from opening the shadow mask.
// Square-root encoding keeps precision in the faint linear-light background.
const guide=Buffer.alloc(count);
for(let i=0;i<count;i++){
  const y=(.2126*decode.stdout.readFloatLE((2*count+i)*4)+.7152*decode.stdout.readFloatLE(i*4)+.0722*decode.stdout.readFloatLE((count+i)*4))*pixelAreaScale;
  guide[i]=Math.round(255*Math.sqrt(Math.max(0,Math.min(1,y))));
}
const smoothGuide=await sharp(guide,{raw:{width,height,channels:1}})
  .blur(width/360*.7).raw().toBuffer({resolveWithObject:true});
// Bake the photographic grade into the linear source, before AVIF encoding.
// A soft shadow toe suppresses the map's faint all-sky pedestal without
// sharpening/noise, while preserving the brighter galactic structures.
// One luminance gain for RGB preserves color ratios through the contrast curve.
const grade={black:.0015,toe:.012,pivot:.12,saturation:1.2,exposure:5,backgroundLow:.004,backgroundHigh:.020};
const pivotShift=grade.pivot-grade.black;
const normalization=grade.pivot*(pivotShift+grade.toe)/(pivotShift*pivotShift);
for(let i=0;i<count;i++){
  const r=Math.max(0,decode.stdout.readFloatLE((2*count+i)*4)*pixelAreaScale);
  const g=Math.max(0,decode.stdout.readFloatLE(i*4)*pixelAreaScale);
  const b=Math.max(0,decode.stdout.readFloatLE((count+i)*4)*pixelAreaScale);
  const luminance=.2126*r+.7152*g+.0722*b;
  const shadow=Math.max(0,luminance-grade.black);
  const graded=normalization*shadow*shadow/(shadow+grade.toe);
  const localLuminance=(smoothGuide.data[i*smoothGuide.info.channels]/255)**2;
  const support=Math.max(0,Math.min(1,(localLuminance-grade.backgroundLow)/(grade.backgroundHigh-grade.backgroundLow)));
  const mask=support*support*(3-2*support);
  // The shader raises linear texture values to 1.5, so this bakes the old
  // 500% brightness into the map while applying the source-derived sky mask.
  const gain=graded/Math.max(luminance,1e-12)*Math.pow(grade.exposure*mask,2/3);
  for(let c=0;c<3;c++){
    const value=(luminance+([r,g,b][c]-luminance)*grade.saturation)*gain;
    // Roll off the brightest core gently instead of clipping it to white.
    const shoulder=value<=.65?value:.65+.35*(1-Math.exp(-(value-.65)/.35));
    pixels[i*3+c]=Math.round(255*Math.pow(Math.max(0,Math.min(1,shoulder)),1/2.2));
  }
}
const output=new URL(`../public/media/earthlight/milky-way${width===8192?'-8k':''}.avif`,import.meta.url);
await sharp(pixels,{raw:{width,height,channels:3}})
  .avif({quality:50,effort:4,chromaSubsampling:'4:4:4',bitdepth:8}).toFile(output.pathname);
console.log({sourceSha256:createHash('sha256').update(readFileSync(source)).digest('hex'),width,height,grade,bytes:statSync(output).size});
