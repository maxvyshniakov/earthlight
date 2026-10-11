import assert from 'node:assert/strict';
import {cropTextureBitmap} from '../src/scripts/texture-bitmap.ts';

export const textureBitmapFixture=`(async()=>{
 const crop=${cropTextureBitmap.toString()};
 const bytes=Uint8ClampedArray.from({length:8*4*4},(_,i)=>i%4===3?255:(i*37+Math.floor(i/4)*11)%256);
 const source=await createImageBitmap(new ImageData(bytes,8,4),{colorSpaceConversion:'none',premultiplyAlpha:'none'});
 const canvas=document.createElement('canvas'),gl=canvas.getContext('webgl');
 const texture=gl.createTexture(),fb=gl.createFramebuffer();gl.bindTexture(gl.TEXTURE_2D,texture);
 gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,8,8,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
 gl.bindFramebuffer(gl.FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
 const results=[];
 try{for(const [x,y,w,h,dx,dy] of [[0,0,4,4,4,4],[4,0,4,4,4,4],[0,2,8,2,0,6]]){
  const bitmap=await crop(source,x,y,w,h);
  try{
   gl.texSubImage2D(gl.TEXTURE_2D,0,dx,dy,gl.RGBA,gl.UNSIGNED_BYTE,bitmap);
   const actual=new Uint8Array(w*h*4);gl.readPixels(dx,dy,w,h,gl.RGBA,gl.UNSIGNED_BYTE,actual);
   let mismatches=0;for(let row=0;row<h;row++)for(let col=0;col<w*4;col++)if(actual[row*w*4+col]!==bytes[((row+y)*8+x)*4+col])mismatches++;
   results.push({x,y,w,h,mismatches,error:gl.getError()});
  }finally{bitmap.close();}
 }}finally{source.close();gl.deleteFramebuffer(fb);gl.deleteTexture(texture);gl.getExtension('WEBGL_lose_context').loseContext();}
 return results;
})()`;

export async function verifyTextureBitmap(evaluate){
 const results=await evaluate(textureBitmapFixture);
 for(const result of results){assert.equal(result.error,0);assert.equal(result.mismatches,0);}
 return results;
}
