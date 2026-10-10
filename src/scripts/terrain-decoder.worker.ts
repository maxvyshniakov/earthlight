import { decodeTerrain } from './earth-terrain';

self.onmessage=async(event:MessageEvent<Blob>)=>{
  try{
    const buffer=await new Response(event.data.stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    const data=decodeTerrain(buffer);
    const transfer=[...new Set(data.levels.map(level=>level.data.buffer))];
    self.postMessage({data},{transfer});
  }catch(error){self.postMessage({error:error instanceof Error?error.message:String(error)});}
};
