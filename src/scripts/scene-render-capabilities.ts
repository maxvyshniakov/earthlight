import {drawBuffersApi,floatTarget,halfFloatTarget,shaderDerivatives,shaderLod} from './webgl-context';

/** Facts from the context. Probing allocates no scene resources; constructors
 * still validate framebuffer completeness and retain their runtime fallbacks. */
export interface SceneRenderCapabilities {
 readonly textureUnits:number;
 readonly textureSize:number;
 readonly explicitLod:boolean;
 readonly derivatives:boolean;
 readonly halfFloat:boolean;
 readonly float:boolean;
 readonly drawBuffers:number;
 readonly colorAttachments:number;
}
export function readSceneRenderCapabilities(gl:WebGLRenderingContext):SceneRenderCapabilities {
 const mrt=drawBuffersApi(gl);
 return Object.freeze({
  textureUnits:gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS),
  textureSize:gl.getParameter(gl.MAX_TEXTURE_SIZE),
  explicitLod:shaderLod(gl),derivatives:shaderDerivatives(gl),
  halfFloat:halfFloatTarget(gl)!==null,float:floatTarget(gl),
  drawBuffers:mrt?gl.getParameter(mrt.MAX_DRAW_BUFFERS_WEBGL):0,
  colorAttachments:mrt?gl.getParameter(mrt.MAX_COLOR_ATTACHMENTS_WEBGL):0,
 });
}
