/** Compact is the main renderer; retained candidates and controls are URL-addressable. */
export const sceneProfiles = {
  'clouds-half': { label: 'Half-resolution clouds', scale: 1, fps: 24,
    description: 'Experimental cloud reconstruction with full-resolution ground and atmosphere. Falls back to compact when unavailable.' },
  compact: { label: 'Compact volume pass', scale: 1, fps: 24,
    description: 'Full resolution. Separate volumes with a smaller intermediate buffer; compare the ground and horizon.' },
  split: { label: 'Separate volume pass', scale: 1, fps: 24,
    description: 'Full quality. Renders ground and sky separately from clouds and atmosphere; uses an extra full-resolution buffer.' },
  lighting: { label: 'Shared cloud lighting', scale: 1, fps: 24,
    description: 'Full cloud detail. Interpolates lighting between nearby samples; compare cloud shadows in motion.' },
  reference: { label: 'Original', scale: 1, fps: 24,
    description: 'Full resolution and the original cloud shadows.' },
} as const;
export type SceneProfileName = keyof typeof sceneProfiles;
export function sceneProfile(params: URLSearchParams) {
  const requested = params.get('render');
  const name: SceneProfileName = requested && Object.hasOwn(sceneProfiles, requested)
    ? requested as SceneProfileName : 'compact';
  // Lab override for device diagnosis: a fixed fraction of the base buffer.
  const scale=Number(params.get('scale'));
  return { name, ...sceneProfiles[name], ...(scale>=.2&&scale<=1?{scale}:{}) };
}

/** Removed experiments are reproducible at the orbit-experiments-2026-10-10 tag. */
export const comparisonProfileGroups: {label:string;names:SceneProfileName[]}[] = [
  {label:'Reference',names:['reference']},
  {label:'Candidates',names:['compact','clouds-half']},
  {label:'Controls',names:['split','lighting']},
];
