export interface SceneSources { assetBaseURL?: string; terrainBaseURL?: string; background?: boolean; }
export function assetURL(path:string,base='/media/earthlight/') {
  if (!path || path.startsWith('/') || path.split('/').some(part=>part==='..') || /[?#\\]/.test(path)) throw new Error('Invalid scene asset path');
  return base.replace(/\/+$/, '') + '/' + path;
}
