import sharp from 'sharp';
import { resolve } from 'node:path';

// NASA Black Marble 2016 color composite and Solar System Scope 8K clouds.
// See public/media/orbit/README.md for source URLs and attribution.
const [nightSource, cloudSource, daySource] = process.argv.slice(2);
if (!nightSource || !cloudSource || !daySource) throw new Error('Usage: bun scripts/build-earth-maps.mjs BLACK_MARBLE_3KM.jpg CLOUDS_8K.jpg DAY_8K.jpg');
sharp.concurrency(2);
const smoothstep = (low, high, value) => {
  const t = Math.max(0, Math.min(1, (value-low)/(high-low)));
  return t*t*(3-2*t);
};
const { data, info } = await sharp(nightSource).toColourspace('srgb').removeAlpha().raw().toBuffer({ resolveWithObject: true });
if (info.width < 8192 || info.height < 4096) throw new Error('Night source must contain real 8K detail; do not upscale the 3600px overview.');
for (const source of [cloudSource,daySource]) {
  const metadata=await sharp(source).metadata();
  if(metadata.width<8192||metadata.height<4096)throw new Error('Surface and cloud sources must contain real 8K detail.');
}
const emission = Buffer.alloc(info.width*info.height);
for (let i=0; i<emission.length; i++) {
  const r=data[i*3]/255, g=data[i*3+1]/255, b=data[i*3+2]/255;
  const peak=Math.max(r,g);
  const luminance=.2126*r+.7152*g+.0722*b;
  // Reject blue terrain at source resolution, before any mip filtering.
  // Preserve both warm lights and bright neutral city centers.
  const warm=smoothstep(.025,.22,(peak-b)/Math.max(peak,.001));
  const neutral=smoothstep(.30,.65,luminance);
  emission[i]=Math.round(255*Math.max(0,luminance-.025)*Math.max(warm,neutral));
}
for(const width of [4096,8192]) {
  const suffix=width===8192?'-8k':'';
  const encode={quality:50,effort:4,chromaSubsampling:'4:4:4',bitdepth:8};
  await sharp(emission,{raw:{width:info.width,height:info.height,channels:1}})
    .resize(width,width/2).avif({...encode,quality:65})
    .toFile(resolve(`public/media/orbit/earth-night${suffix}.avif`));
  await sharp(cloudSource).resize(width,width/2).greyscale().avif(encode)
    .toFile(resolve(`public/media/orbit/earth-clouds${suffix}.avif`));
  await sharp(daySource).resize(width,width/2).avif(encode)
    .toFile(resolve(`public/media/orbit/earth-day${suffix}.avif`));
  console.log(`Built ${width} x ${width/2} day, night emission and cloud maps.`);
}
