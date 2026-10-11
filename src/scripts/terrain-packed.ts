import {DEM_CELL} from './terrain-detail';
export const DEM_PACKED_VERSION=1;
const MAGIC=new TextEncoder().encode('ELDEM001'),HEADER=16;
export const DEM_PATCH_BYTES=DEM_CELL*DEM_CELL*2*4;
export const DEM_PACKED_BYTES=HEADER+4*DEM_PATCH_BYTES;
/** Versioned, lossless wrapper around the existing four RGBA atlas patches. */
export function packTerrainParent(parent:number,patches:Uint8Array[]){
 if(!Number.isInteger(parent)||parent<0||parent>=64800||patches.length!==4||patches.some(p=>p.length!==DEM_PATCH_BYTES))throw Error('Invalid packed terrain input');
 const bytes=new Uint8Array(DEM_PACKED_BYTES),view=new DataView(bytes.buffer);
 bytes.set(MAGIC);view.setUint32(8,parent,true);view.setUint32(12,DEM_PATCH_BYTES,true);
 patches.forEach((patch,i)=>bytes.set(patch,HEADER+i*DEM_PATCH_BYTES));return bytes;
}
export function unpackTerrainParent(bytes:Uint8Array,parent:number){
 if(bytes.length!==DEM_PACKED_BYTES||MAGIC.some((v,i)=>bytes[i]!==v))throw Error('Invalid packed terrain format');
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 if(view.getUint32(8,true)!==parent||view.getUint32(12,true)!==DEM_PATCH_BYTES)throw Error('Invalid packed terrain identity');
 // Independent transferable buffers keep parent ownership identical to TIFF.
 return Array.from({length:4},(_,i)=>bytes.slice(HEADER+i*DEM_PATCH_BYTES,HEADER+(i+1)*DEM_PATCH_BYTES));
}
export async function decompressTerrainParent(buffer:ArrayBuffer,parent:number){
 const reader=new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
 const bytes=new Uint8Array(DEM_PACKED_BYTES);let offset=0;
 try{for(;;){const {value,done}=await reader.read();if(done)break;if(offset+value.length>bytes.length)throw Error('Packed terrain too large');bytes.set(value,offset);offset+=value.length;}}
 finally{await reader.cancel();reader.releaseLock();}
 if(offset!==bytes.length)throw Error('Packed terrain truncated');
 return unpackTerrainParent(bytes,parent);
}
