import { decodeTerrain } from './earth-terrain';
import { terrainBoundGrid } from './terrain-bound';

self.onmessage=async(event:MessageEvent<Blob|{blob:Blob;bound:boolean}>)=>{
  try{
    const request=event.data instanceof Blob?{blob:event.data,bound:false}:event.data;
    const buffer=await new Response(request.blob.stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    const data=decodeTerrain(buffer);
    const bound=request.bound?terrainBoundGrid(data.levels[0].data,data.width,data.height):undefined;
    const transfer=[...new Set(data.levels.map(level=>level.data.buffer)),...(bound?[bound.buffer]:[])];
    self.postMessage({data,bound},{transfer});
  }catch(error){self.postMessage({error:error instanceof Error?error.message:String(error)});}
};
