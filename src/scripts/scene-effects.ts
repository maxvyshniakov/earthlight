export type AuroraMode = 'auto' | 'off' | 'on';
export type CloudMode = 'balanced' | 'calibrated' | 'original' | 'off';

/** Photographic coverage presets; the MODIS study retains its measured input. */
export function cloudMode(params:URLSearchParams):CloudMode {
 const value=params.get('clouds');
 if(value==='off'||value==='0')return 'off';
 if(value==='calibrated')return 'calibrated';
 if(value==='original'||['photo','modis'].includes(params.get('cloudStudy')??''))return 'original';
 // Old clouds=broken links now use the corrected, full-disc-safe preset.
 return 'balanced';
}

/** Effect policy is independent of graphics API capability. Legacy links stay valid. */
export function auroraMode(params:URLSearchParams):AuroraMode {
 const value=params.get('aurora');
 return value==='0'||value==='off'?'off':value==='1'||value==='on'?'on':'auto';
}

export function auroraEnabled(params:URLSearchParams,touchDevice:boolean) {
 const mode=auroraMode(params);
 return mode==='on'||(mode==='auto'&&!touchDevice);
}
