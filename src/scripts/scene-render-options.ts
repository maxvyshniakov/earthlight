import {sceneProfile} from './scene-profile';
import {auroraMode,cloudMode} from './scene-effects';
import {textureProfile} from './texture-profile';
import {readNightMode} from './physical-night';
import {cloudPropertiesDate} from './cloud-properties';
import {oceanPrototype} from './ocean-options';

/** Retained lab comparisons. These are requests, not GPU capability decisions. */
export interface SceneRenderExperiments {
 readonly terrainView: 0|1|2|3;
 readonly terrainSun: readonly number[]|null;
 readonly terrainBound: 'off'|'regional';
 readonly terrainWork: 'legacy'|'bounded';
 readonly terrainRefinement: 'full'|'pixel';
 readonly terrainFetch: 'separate'|'shared';
 readonly terrainUpload: 'tile'|'strips';
 readonly terrainCache: 'small'|'working';
 readonly terrainDecoder: 'pool'|'single';
 readonly terrainSource: 'packed'|'tiff';
 readonly terrainMap: 'v2'|'v3';
 readonly cloudStudy: 'off'|'photo'|'modis'|'global';
 readonly cloudStudyView: 'normal'|'quality';
 readonly cloudShape: 'current'|'texture';
 readonly cloudLighting: 'raymarch'|'texture';
 readonly cloudBake: 'budget'|'fixed';
 readonly cloudReuse: boolean;
 readonly cloudSteps: 'full'|'balanced';
 readonly shaderWork: 'legacy'|'lean';
 readonly noise: 'hash'|'table';
 readonly ocean: ReturnType<typeof oceanPrototype>;
 readonly oceanResolution: 1024|2048;
 readonly nightRange: 'normal'|'extended';
}

/** The URL compatibility boundary. A renderer owns one normalized snapshot;
 * live night changes are explicit switchNight calls, never URL re-reads. */
export function readSceneRenderOptions(params:URLSearchParams) {
 const choice=<T extends string>(key:string,values:readonly T[],fallback:T):T=>{
  const value=params.get(key);return values.includes(value as T)?value as T:fallback;
 };
 const sun=(params.get('terrainSun')??'').split(',').map(Number);
 const terrainSun=sun.length===2&&sun.every(Number.isFinite)
  ?Object.freeze(sun.map((v,i)=>i?Math.max(-90,Math.min(90,v)):((v%360)+360)%360)):null;
 const experiments:SceneRenderExperiments=Object.freeze({
  terrainView:(['clay','color','albedo'].indexOf(params.get('terrainView')??'')+1) as 0|1|2|3,
  terrainSun,
  terrainBound:choice('terrainBound',['off','regional'],'regional'),
  terrainWork:choice('terrainWork',['legacy','bounded'],'bounded'),
  terrainRefinement:choice('terrainRefinement',['full','pixel'],'pixel'),
  terrainFetch:choice('terrainFetch',['separate','shared'],'shared'),
  terrainUpload:choice('terrainUpload',['tile','strips'],'strips'),
  terrainCache:choice('terrainCache',['small','working'],'working'),
  terrainDecoder:choice('terrainDecoder',['pool','single'],'single'),
  terrainSource:choice('terrainSource',['packed','tiff'],'tiff'),
  terrainMap:choice('terrainMap',['v2','v3'],'v3'),
  cloudStudy:choice('cloudStudy',['photo','modis','global'],'off'),
  cloudStudyView:choice('cloudStudyView',['quality'],'normal'),
  cloudShape:choice('cloudShape',['texture'],'current'),
  cloudLighting:choice('cloudLighting',['raymarch'],'texture'),
  cloudBake:choice('cloudBake',['budget'],'fixed'),
  cloudReuse:params.get('cloudReuse')!=='off',
  cloudSteps:choice('cloudSteps',['full'],'balanced'),
  shaderWork:choice('shaderWork',['legacy'],'lean'),
  noise:choice('noise',['hash'],'table'),
  ocean:oceanPrototype(params),
  oceanResolution:params.get('oceanResolution')==='1024'?1024:2048,
  nightRange:choice('nightRange',['extended'],'normal'),
 });
 return Object.freeze({
  profile:Object.freeze(sceneProfile(params)),
  clouds:cloudMode(params),aurora:auroraMode(params),night:readNightMode(params),
  texture:textureProfile(params),cloudDay:Object.freeze(cloudPropertiesDate(params)),
  surface:params.get('surface')!=='0',terrain:params.get('terrain')!=='0',
  moonSurface:params.get('moonSurface')!=='off',galaxyDetail:params.get('galaxyDetail')!=='0',
  cloudDetail:params.get('cloudDetail')!=='0',
  terrainDetail:choice('terrainDetail',['0','coarse'],'stream'),
  dayDetail:choice('dayDetail',['0','sentinel'],'tiles'),
  nightDetail:choice('nightDetail',['0','vnp46'],'tiles'),
  motionShutter:params.has('motionBlur')?Math.max(0,Math.min(1,Number(params.get('motionBlur'))||0)):.75,
  skyShutter:params.get('skyBlur')!=='0',lightning:params.get('lightning')!=='0',
  adaptive:params.get('quality')!=='fixed',glare:params.get('glare')!=='off',
  fieldReflections:params.get('fieldReflections')!=='off',pyramidMeter:params.get('meter')!=='points',
  experiments,
 });
}
export type SceneRenderOptions=ReturnType<typeof readSceneRenderOptions>;
