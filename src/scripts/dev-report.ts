/** Development only: send a startup failure and the GPU's limits to the dev
 * server, which prints them (server/client-log-middleware.mjs). Phones on the
 * tailnet have no console the developer can read. Production builds drop it. */
export function reportToDevServer(kind:string,error:unknown,gl?:WebGLRenderingContext){
  if(!import.meta.env.DEV)return;
  const info:Record<string,unknown>={kind,message:String((error as Error)?.message??error),userAgent:navigator.userAgent};
  if(gl){
    const debug=gl.getExtension('WEBGL_debug_renderer_info');
    info.renderer=debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
    info.webgl2=typeof WebGL2RenderingContext!=='undefined'&&gl instanceof WebGL2RenderingContext;
    for(const name of ['MAX_TEXTURE_IMAGE_UNITS','MAX_COMBINED_TEXTURE_IMAGE_UNITS','MAX_FRAGMENT_UNIFORM_VECTORS','MAX_VERTEX_UNIFORM_VECTORS','MAX_VARYING_VECTORS','MAX_TEXTURE_SIZE'] as const)
      info[name]=gl.getParameter(gl[name]);
    const precision=gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER,gl.HIGH_FLOAT);
    info.fragmentHighp=precision?precision.precision:0;
  }
  fetch('/__earthlight/client-log',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(info),keepalive:true}).catch(()=>{});
}
