/** `sky:false` renders Earth without the celestial sky (stars, Milky Way, Moon,
 * planets), as the background poster captures do: the sky turns with sidereal
 * time, so a poster keyed to the Sun's position cannot show it. */
export interface SceneSources { assetBaseURL?: string; terrainBaseURL?: string; background?: boolean; sky?: boolean; }
export function assetURL(path:string,base='/media/earthlight/') {
  if (!path || path.startsWith('/') || path.split('/').some(part=>part==='..') || /[?#\\]/.test(path)) throw new Error('Invalid scene asset path');
  return base.replace(/\/+$/, '') + '/' + path;
}
