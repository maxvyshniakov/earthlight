import {fromArrayBuffer} from 'geotiff';
import {packTerrainPatch} from './terrain-detail';
self.onmessage=async(event:MessageEvent<{buffer:ArrayBuffer}>)=>{
 try{
  const tiff=await fromArrayBuffer(event.data.buffer),image=await tiff.getImage();
  const width=image.getWidth(),height=image.getHeight();
  if(width<2||width>1200||height!==1200||image.getSamplesPerPixel()!==1)throw Error('Invalid GLO-90 dimensions');
  const raster=await image.readRasters({interleave:true});
  const patches=[];
  for(let y=0;y<2;y++)for(let x=0;x<2;x++)patches.push(packTerrainPatch(raster as unknown as Float32Array,width,height,x,y));
  self.postMessage({patches},{transfer:patches.map(p=>p.buffer)});
 }catch(error){self.postMessage({error:String(error)});}
};
