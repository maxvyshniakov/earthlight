import {auroraMode} from './scene-effects.ts';

/** Requested effects can prefer core MRT/LOD. Explicit API links stay reproducible. */
export function sceneContext(canvas:HTMLCanvasElement,params:URLSearchParams,attributes:WebGLContextAttributes){
  const api=params.get('api');
  const preferWebGL2=api==='webgl2'||(api!=='webgl'&&(params.get('render')==='clouds-half'||auroraMode(params)==='on'));
  return (preferWebGL2?canvas.getContext('webgl2',attributes):null)??canvas.getContext('webgl',attributes);
}

/** Keep the WebGL1 path explicit while testing the same scene on WebGL2. */
export function isWebGL2(gl: WebGLRenderingContext): gl is WebGL2RenderingContext {
  return 'texStorage2D' in gl;
}

export function shaderLod(gl: WebGLRenderingContext) {
  return isWebGL2(gl) || !!gl.getExtension('EXT_shader_texture_lod');
}

export function shaderDerivatives(gl: WebGLRenderingContext) {
  return isWebGL2(gl) || !!gl.getExtension('OES_standard_derivatives');
}

export function halfFloatTarget(gl: WebGLRenderingContext, linear = false): number | null {
  if (isWebGL2(gl)) return gl.getExtension('EXT_color_buffer_float') ? gl.HALF_FLOAT : null;
  const half = gl.getExtension('OES_texture_half_float');
  return half && gl.getExtension('EXT_color_buffer_half_float')
    && (!linear || gl.getExtension('OES_texture_half_float_linear')) ? half.HALF_FLOAT_OES : null;
}

export function floatTarget(gl: WebGLRenderingContext) {
  return isWebGL2(gl) ? !!gl.getExtension('EXT_color_buffer_float')
    : !!gl.getExtension('OES_texture_float') && !!gl.getExtension('WEBGL_color_buffer_float');
}

export function drawBuffersApi(gl: WebGLRenderingContext): WEBGL_draw_buffers | null {
  if (!isWebGL2(gl)) return gl.getExtension('WEBGL_draw_buffers');
  return {
    MAX_DRAW_BUFFERS_WEBGL: gl.MAX_DRAW_BUFFERS,
    MAX_COLOR_ATTACHMENTS_WEBGL: gl.MAX_COLOR_ATTACHMENTS,
    COLOR_ATTACHMENT0_WEBGL: gl.COLOR_ATTACHMENT0,
    COLOR_ATTACHMENT1_WEBGL: gl.COLOR_ATTACHMENT1,
    drawBuffersWEBGL: (buffers: number[]) => gl.drawBuffers(buffers),
  } as WEBGL_draw_buffers;
}

function textureFormat(gl: WebGLRenderingContext, format: number) {
  // Every scalar texture in this renderer samples .r; no RGB luminance swizzle
  // is needed. Preserve the byte data and its one-channel GPU storage.
  return isWebGL2(gl) && format === gl.LUMINANCE ? gl.RED : format;
}

function internalFormat(gl: WebGLRenderingContext, format: number, type: number) {
  if (!isWebGL2(gl)) return format;
  if (format === gl.LUMINANCE || format === gl.RED) return gl.R8;
  if (format === gl.RG) return type === gl.HALF_FLOAT ? gl.RG16F : type === gl.FLOAT ? gl.RG32F : gl.RG8;
  if (format === gl.RGBA) return type === gl.HALF_FLOAT ? gl.RGBA16F : type === gl.FLOAT ? gl.RGBA32F : gl.RGBA8;
  if (format === gl.RGB) return type === gl.HALF_FLOAT ? gl.RGB16F : type === gl.FLOAT ? gl.RGB32F : gl.RGB8;
  return format;
}

type ImageArgs = [number, number, number, number, number, TexImageSource]
  | [number, number, number, number, number, number, number, number, ArrayBufferView | null];
export function textureImage2D(gl: WebGLRenderingContext, ...args: ImageArgs) {
  if (isWebGL2(gl)) {
    const formatIndex = args.length === 6 ? 3 : 6;
    const typeIndex = formatIndex + 1;
    args[2] = internalFormat(gl, args[2], args[typeIndex] as number);
    args[formatIndex] = textureFormat(gl, args[formatIndex] as number);
  }
  Reflect.apply(gl.texImage2D, gl, args);
}

type SubImageArgs = [number, number, number, number, number, number, TexImageSource]
  | [number, number, number, number, number, number, number, number, ArrayBufferView | null];
export function textureSubImage2D(gl: WebGLRenderingContext, ...args: SubImageArgs) {
  const formatIndex = args.length === 7 ? 4 : 6;
  args[formatIndex] = textureFormat(gl, args[formatIndex] as number);
  Reflect.apply(gl.texSubImage2D, gl, args);
}

/** Mechanical GLSL dialect conversion for the renderer's owned shader sources.
 * Lighting, color transfer, sampling positions and iteration counts stay intact. */
export function prepareShaderSource(gl: WebGLRenderingContext, type: number, source: string) {
  if (!isWebGL2(gl)) return source;
  const fragment = type === gl.FRAGMENT_SHADER;
  let converted = source
    .replace(/^\s*#extension\s+GL_(?:EXT_shader_texture_lod|OES_standard_derivatives|EXT_draw_buffers)\s*:[^\n]*$/gm, '')
    .replace(/\battribute\b/g, 'in')
    .replace(/\bvarying\b/g, fragment ? 'in' : 'out')
    .replace(/\btexture2DLodEXT\b/g, 'textureLod')
    .replace(/\btexture2DGradEXT\b/g, 'textureGrad')
    .replace(/\btexture2D\b/g, 'texture');
  let outputs = '';
  if (fragment) {
    const locations = new Set<number>();
    converted = converted.replace(/\bgl_FragData\s*\[\s*(\d+)\s*\]/g, (_, index: string) => {
      locations.add(Number(index)); return `sceneOutput${index}`;
    }).replace(/\bgl_FragColor\b/g, () => { locations.add(0); return 'sceneOutput0'; });
    outputs = [...locations].sort().map(index => `layout(location=${index}) out highp vec4 sceneOutput${index};`).join('\n');
  }
  return `#version 300 es\n${outputs}\n${converted}`;
}
