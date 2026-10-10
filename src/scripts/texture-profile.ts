/** Storage experiment: leave the full-resolution star catalog and streamed
 * galaxy tiles alone, and reduce only the global diffuse-sky overview. */
export function textureProfile(params: URLSearchParams) {
  return params.get('texture') === 'compact' ? 'compact' : 'reference';
}

export function galaxyOverview(compact: boolean,base='/media/orbit/') {
  return base.replace(/\/+$/, '') + '/' + (compact ? 'mobile/galaxy-2048.avif' : 'milky-way.avif');
}

/** Match the 64-texel-wide irradiance footprint used by the original 4K map. */
export function galaxyIrradianceLod(width: number) {
  return Math.max(0, Math.log2(Math.max(1, width) / 64));
}

export const galaxyOverviewShader = `
uniform float galaxyMapWidth;
float galaxyIrradianceLod(){return max(0.,log2(max(1.,galaxyMapWidth)/64.));}
`;
