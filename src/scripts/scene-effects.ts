export type AuroraMode = 'auto' | 'off' | 'on';

/** Effect policy is independent of graphics API capability. Legacy links stay valid. */
export function auroraMode(params:URLSearchParams):AuroraMode {
 const value=params.get('aurora');
 return value==='0'||value==='off'?'off':value==='1'||value==='on'?'on':'auto';
}

export function auroraEnabled(params:URLSearchParams,touchDevice:boolean) {
 const mode=auroraMode(params);
 return mode==='on'||(mode==='auto'&&!touchDevice);
}
