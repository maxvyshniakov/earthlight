import {textureImage2D,drawBuffersApi,radianceTarget,isWebGL2} from './webgl-context.ts';
/** Half-resolution cloud radiance/transmittance and depth metadata. WebGL1 MRT
 * avoids running the cloud integral twice or quantizing HDR light into bytes. */
export class CloudBuffer {
  readonly textures: WebGLTexture[] = [];
  private framebuffer: WebGLFramebuffer | null = null;
  private width = 0;
  private height = 0;
  private drawBuffers: WEBGL_draw_buffers;
  private pixelType: number;

  static supported(gl: WebGLRenderingContext) {
    const mrt = drawBuffersApi(gl);
    return !!mrt && gl.getParameter(mrt.MAX_DRAW_BUFFERS_WEBGL) >= 2
      && gl.getParameter(mrt.MAX_COLOR_ATTACHMENTS_WEBGL) >= 2
      && gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) > 14
      && radianceTarget(gl) !== null;
  }

  constructor(private gl: WebGLRenderingContext) {
    this.drawBuffers = drawBuffersApi(gl)!;
    this.pixelType = radianceTarget(gl)!;
    try {
      this.framebuffer = gl.createFramebuffer();
      if (!this.framebuffer) throw Error('Cannot allocate cloud framebuffer');
      for (let index = 0; index < 2; index++) {
        const texture = gl.createTexture();
        if (!texture) throw Error('Cannot allocate cloud attachment');
        this.textures.push(texture);
        gl.activeTexture(gl.TEXTURE0 + (index ? 13 : 6));
        gl.bindTexture(gl.TEXTURE_2D, texture);
        for (const axis of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, axis, gl.CLAMP_TO_EDGE);
        for (const filter of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, filter, gl.NEAREST);
      }
      // Probe actual renderability before compiling the experimental programs.
      this.begin(2, 2);
    } catch (error) {
      this.dispose();
      throw error;
    } finally {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
  }

  begin(fullWidth: number, fullHeight: number) {
    const gl = this.gl;
    const width = Math.max(1, Math.ceil(fullWidth / 2));
    const height = Math.max(1, Math.ceil(fullHeight / 2));
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    if (width !== this.width || height !== this.height) {
      this.textures.forEach((texture, index) => {
        gl.activeTexture(gl.TEXTURE0 + (index ? 13 : 6));
        gl.bindTexture(gl.TEXTURE_2D, texture);
        // Depth reconstruction reads only .xy. WebGL2 can retain those two
        // Float16 values in RG16F without paying for two unused channels;
        // WebGL1 keeps its renderable RGBA half-float attachment.
        const format = index === 1 && isWebGL2(gl) ? gl.RG : gl.RGBA;
        textureImage2D(gl,gl.TEXTURE_2D, 0, format, width, height, 0, format, this.pixelType, null);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, this.drawBuffers.COLOR_ATTACHMENT0_WEBGL + index, gl.TEXTURE_2D, texture, 0);
      });
      this.drawBuffers.drawBuffersWEBGL([this.drawBuffers.COLOR_ATTACHMENT0_WEBGL, this.drawBuffers.COLOR_ATTACHMENT1_WEBGL]);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw Error('Incomplete cloud framebuffer');
      this.width = width;
      this.height = height;
    }
    gl.viewport(0, 0, width, height);
    return [width, height] as const;
  }

  bind() {
    this.textures.forEach((texture, index) => {
      this.gl.activeTexture(this.gl.TEXTURE0 + (index ? 13 : 6));
      this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
    });
  }

  dispose() {
    this.textures.forEach(texture => this.gl.deleteTexture(texture));
    this.gl.deleteFramebuffer(this.framebuffer);
  }
}
