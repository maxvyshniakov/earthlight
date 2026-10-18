/** Synthetic sea-state comparisons accepted by existing lab links. */
export type OceanPrototype='regions'|'fronts'|'combined'|'advected';
export function oceanPrototype(params:URLSearchParams):OceanPrototype|null {
 const value=params.get('ocean');
 return value==='regions'||value==='fronts'||value==='combined'||value==='advected'?value:null;
}
