import type {SceneRenderCapabilities} from './scene-render-capabilities';
import type {SceneRenderOptions} from './scene-render-options';
import {NOISE_TABLE_UNIT} from './noise-table';

export interface SceneRenderEnvironment {
 readonly background:boolean;
 readonly saveData:boolean;
 readonly touchDevice:boolean;
}

/** Pure policy for supported combinations, independent of WebGL and the page.
 * A plan permits a path; allocation/compilation can still fall back at runtime.
 * Preserve the comparison profiles even when a device cannot realize them. */
export function createSceneRenderPlan(options:SceneRenderOptions,caps:SceneRenderCapabilities,environment:SceneRenderEnvironment) {
 const {profile,clouds,experiments:lab}=options,{background,saveData,touchDevice}=environment;
 const units=caps.textureUnits,size=caps.textureSize;
 const compactWorld=profile.name==='compact'||profile.name==='clouds-half';
 const separateVolume=!lab.terrainView&&['split','compact','clouds-half'].includes(profile.name)
  &&units>14&&(compactWorld?caps.halfFloat:caps.float);
 const oceanMode=units>14&&size>=2048&&caps.explicitLod?lab.ocean:null;
 const streamDetail=!background&&!saveData&&size>=4096;
 const modisStudy=['photo','modis'].includes(lab.cloudStudy)&&units>9;
 const cloudProperties=streamDetail&&!modisStudy&&lab.cloudStudy==='global';
 const supportsTerrain=!background&&units>8&&size>=4096;
 const supportsTerrainTiles=supportsTerrain&&streamDetail&&units>15&&options.terrain&&options.terrainDetail!=='0';
 const wantsAurora=options.aurora==='on'||(options.aurora==='auto'&&!touchDevice);
 const mrt=caps.drawBuffers>=2&&caps.colorAttachments>=2&&caps.halfFloat;
 return Object.freeze({
  compactWorld,separateVolume,oceanMode,streamDetail,modisStudy,cloudProperties,
  sharedLighting:profile.name==='lighting',
  textureLighting:clouds!=='off'&&separateVolume&&profile.name==='compact'&&lab.cloudLighting!=='raymarch'
   &&!['photo','modis'].includes(lab.cloudStudy)&&units>15&&size>=2048,
  halfClouds:profile.name==='clouds-half'&&separateVolume&&mrt&&units>14,
  temporalClouds:lab.cloudReuse&&profile.name==='compact'&&separateVolume&&compactWorld&&clouds!=='off'&&mrt&&units>15,
  wantsMoonSurface:!background&&!lab.terrainView&&options.moonSurface,
  wantsAurora,supportsAurora:wantsAurora&&units>11&&size>=2048&&caps.explicitLod,
  supportsTerrain,supportsTerrainTiles,
  // Ocean prototypes and the detailed galaxy use unit 14 in the same pass.
  supportsGalaxyTiles:!oceanMode&&streamDetail&&units>14&&options.galaxyDetail,
  dayPyramid:streamDetail&&options.dayDetail==='sentinel',
  supportsCloudTiles:clouds!=='off'&&!modisStudy&&streamDetail&&units>9&&options.cloudDetail,
  // Half-resolution depth owns unit 13, including its compact fallback.
  noiseTable:lab.noise!=='hash'&&profile.name!=='clouds-half'&&units>NOISE_TABLE_UNIT,
  supportsSourceAttenuation:units>10,supportsSolarTransmission:units>12,
  terrainBound:supportsTerrainTiles&&options.terrainDetail!=='coarse'?lab.terrainBound:'off' as const,
  motionShutter:background?0:options.motionShutter,
 });
}
export type SceneRenderPlan=ReturnType<typeof createSceneRenderPlan>;
