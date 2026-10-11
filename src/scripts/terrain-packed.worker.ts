import {decompressTerrainParent} from './terrain-packed';
self.onmessage=async(event:MessageEvent<{buffer:ArrayBuffer;parent:number}>)=>{
 try{const patches=await decompressTerrainParent(event.data.buffer,event.data.parent);self.postMessage({patches},{transfer:patches.map(p=>p.buffer)});}
 catch(error){self.postMessage({error:String(error)});}
};
