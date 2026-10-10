// Derive the optional 2K overview from the existing graded 4K plate. No new
// source imagery, decoder or runtime dependency is needed.
import sharp from 'sharp';
import {stat} from 'node:fs/promises';
const source=new URL('../public/media/orbit/milky-way.avif',import.meta.url);
const output=new URL('../public/media/orbit/mobile/galaxy-2048.avif',import.meta.url);
await sharp(source.pathname).resize(2048,1024,{kernel:'lanczos3'})
  .avif({quality:80,effort:4,chromaSubsampling:'4:4:4'}).toFile(output.pathname);
console.log({sourceBytes:(await stat(source)).size,outputBytes:(await stat(output)).size});
