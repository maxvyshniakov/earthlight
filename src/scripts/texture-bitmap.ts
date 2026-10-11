/** Give WebGL a bitmap whose backing surface has the crop's actual dimensions.
 * Firefox can validate a cropped ImageBitmap against its larger source surface,
 * rejecting otherwise valid writes near an atlas edge. Copy at 1:1: packed
 * numeric terrain heights must never be resized or interpolated. */
export async function cropTextureBitmap(source:ImageBitmap,x:number,y:number,width:number,height:number):Promise<ImageBitmap>{
 const canvas=typeof OffscreenCanvas==='function'?new OffscreenCanvas(width,height):document.createElement('canvas');
 if(canvas.width!==width)canvas.width=width;
 if(canvas.height!==height)canvas.height=height;
 const context=canvas.getContext('2d') as OffscreenCanvasRenderingContext2D|CanvasRenderingContext2D|null;
 if(!context)throw Error('Cannot allocate texture crop');
 context.imageSmoothingEnabled=false;
 context.drawImage(source,x,y,width,height,0,0,width,height);
 try{
  return 'transferToImageBitmap' in canvas?canvas.transferToImageBitmap():await createImageBitmap(canvas,{colorSpaceConversion:'none',premultiplyAlpha:'none'});
 }finally{canvas.width=canvas.height=1;}
}
