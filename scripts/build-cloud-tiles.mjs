// A 16K coverage map with true neighbor gutters; stream the visible region.
import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
const root=process.argv[2]||'/tmp/earthlight-reference';
const out='public/media/earthlight/cloud-tiles';await mkdir(out,{recursive:true});
sharp.concurrency(2);sharp.cache(false);
const resume=process.argv.includes('--resume');
const sourceHashes={};
for(const h of ['W','E'])sourceHashes[h]=createHash('sha256').update(await readFile(`${root}/clouds/cloud.${h}.2001210.21600x21600.png`)).digest('hex');
const halves=[];
for(const h of ['W','E'])halves.push(await sharp(`${root}/clouds/cloud.${h}.2001210.21600x21600.png`,{limitInputPixels:false}).resize(8192,8192).removeAlpha().toColourspace('b-w').raw().toBuffer());
const interior=512,gutter=16,cell=544,columns=32,rows=16;
const manifest={version:1,width:16384,height:8192,interior,gutter,columns,rows,quality:65,sourceHashes,tiles:[],bytes:0};
for(let ty=0;ty<rows;ty++)for(let tx=0;tx<columns;tx++){
 const id=ty*columns+tx;
 const pixels=Buffer.alloc(cell*cell);
 for(let y=0;y<cell;y++)for(let x=0;x<cell;x++){
  const px=(tx*interior+x-gutter+16384)%16384,py=Math.max(0,Math.min(8191,ty*interior+y-gutter));
  pixels[y*cell+x]=halves[px>=8192?1:0][py*8192+px%8192];
 }
 const file=`${out}/${id}.avif`;
 let encoded;
 try{if(!resume)throw Error('Rebuild');encoded=await readFile(file);}catch{encoded=await sharp(pixels,{raw:{width:cell,height:cell,channels:1}}).toColourspace('b-w').avif({quality:65,effort:5,chromaSubsampling:'4:4:4'}).toBuffer();await writeFile(file,encoded);}
 manifest.tiles.push(id);manifest.bytes+=encoded.length;
 if(tx===31)console.log(`row ${ty+1}/16, ${manifest.bytes} bytes`);
}
await writeFile(out+'/manifest.json',JSON.stringify(manifest));
