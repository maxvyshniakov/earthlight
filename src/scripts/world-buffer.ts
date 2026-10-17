import {textureImage2D,radianceTarget,floatTarget} from './webgl-context.ts';
/** Full-resolution linear radiance + ray distance between independent passes.
 * Float32 preserves distant ground intersections; optional Float16 halves the
 * bandwidth and stores terrain distance as a small residual. Neither uses upsampling or history.
 */
export class WorldBuffer {
 readonly texture:WebGLTexture;
 private framebuffer:WebGLFramebuffer;
 private width=0;private height=0;
 static supported(gl:WebGLRenderingContext,compact=false){return gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS)>14&&(compact?radianceTarget(gl)!==null:floatTarget(gl));}
 private pixelType:number;
 constructor(private gl:WebGLRenderingContext,compact=false){
  this.pixelType=compact?radianceTarget(gl)!:gl.FLOAT;
  const texture=gl.createTexture(),framebuffer=gl.createFramebuffer();
  if(!texture||!framebuffer){gl.deleteTexture(texture);gl.deleteFramebuffer(framebuffer);throw Error('Cannot allocate world buffer');}
  this.texture=texture;this.framebuffer=framebuffer;
  gl.activeTexture(gl.TEXTURE14);gl.bindTexture(gl.TEXTURE_2D,texture);
  for(const axis of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,axis,gl.CLAMP_TO_EDGE);
  for(const filter of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,filter,gl.NEAREST);
 }
 begin(width:number,height:number){
  const gl=this.gl;
  gl.bindFramebuffer(gl.FRAMEBUFFER,this.framebuffer);
  if(this.width!==width||this.height!==height){
   // Galaxy detail owns unit 14 during the world pass. Preserve that input
   // during allocation; steady frames do not need a texture bind or query.
   gl.activeTexture(gl.TEXTURE14);
   const previous=gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture|null;
   try{
    gl.bindTexture(gl.TEXTURE_2D,this.texture);
    textureImage2D(gl,gl.TEXTURE_2D,0,gl.RGBA,width,height,0,gl.RGBA,this.pixelType,null);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.texture,0);
    if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Incomplete world buffer');
    this.width=width;this.height=height;
   }finally{gl.bindTexture(gl.TEXTURE_2D,previous);}
  }
  gl.viewport(0,0,width,height);
 }
 dispose(){this.gl.deleteTexture(this.texture);this.gl.deleteFramebuffer(this.framebuffer);}
}
