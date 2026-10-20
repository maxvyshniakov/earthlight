/** Software renderer names reported by Chromium, Firefox and Mesa. */
export const SOFTWARE_RENDERER=/swiftshader|llvmpipe|softpipe|software|basic render driver/i;

/** Reads the renderer name and releases the probe. The probe shares the
 * caller's attributes, so a refused software context is never created. */
export function softwareProbe(probe:WebGLRenderingContext|null){
  try{
    if(!probe)return false;
    const debug=probe.getExtension('WEBGL_debug_renderer_info');
    const renderer=String(debug?probe.getParameter(debug.UNMASKED_RENDERER_WEBGL):probe.getParameter(probe.RENDERER));
    probe.getExtension('WEBGL_lose_context')?.loseContext();
    return SOFTWARE_RENDERER.test(renderer);
  }catch{return false;}
}
