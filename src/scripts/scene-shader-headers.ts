import type {SceneRenderOptions} from './scene-render-options';
import type {SceneRenderPlan} from './scene-render-plan';
import type {SceneRenderCapabilities} from './scene-render-capabilities';
import {cloudPropertiesSwathHeader} from './cloud-properties';

/** Shader policy is pure and uses only typed input. Keep definition ordering
 * stable: the supported comparison paths compile byte-identical programs. */
export function sceneShaderHeaders(options:SceneRenderOptions,plan:SceneRenderPlan,caps:Pick<SceneRenderCapabilities,'explicitLod'|'derivatives'>) {
 const {experiments:lab,clouds,cloudDay}=options,renderPlan=plan;
 const {compactWorld,sharedLighting,cloudProperties,modisStudy,supportsTerrainTiles,
  supportsGalaxyTiles,supportsSolarTransmission,supportsAurora,supportsSourceAttenuation,
  supportsCloudTiles,dayPyramid,supportsTerrain,separateVolume,noiseTable}=plan;
 const {terrainView,terrainSun:diagnosticSun}=lab;
 const terrainHeader=terrainView?`#define TERRAIN_VIEW ${terrainView}\n${diagnosticSun?`#define TERRAIN_SUN vec2(${diagnosticSun.map(v=>v.toFixed(4)).join(',')})\n`:''}`:'';
 const noiseHeader=noiseTable?'#define NOISE_TABLE 1\n':'';
 const cloudLod=caps.explicitLod,skyGrad=cloudLod&&caps.derivatives;
 const cloud=(cloudLod?'#extension GL_EXT_shader_texture_lod : enable\n#define CLOUD_EXPLICIT_LOD 1\n':'')
  +(skyGrad?'#extension GL_OES_standard_derivatives : enable\n#define SKY_EXPLICIT_GRAD 1\n':'')
  // Implicit-LOD fallbacks still need derivatives at the date line.
  +(caps.derivatives?(skyGrad?'':'#extension GL_OES_standard_derivatives : enable\n')+'#define SKY_DERIVATIVES 1\n':'')
  +(compactWorld?'#define COMPACT_WORLD_PASS 1\n':'')
  +(sharedLighting?'#define SHARED_CLOUD_LIGHTING 1\n':'')
  +(lab.terrainWork==='bounded'?'#define BOUNDED_RAY_WORK 1\n':'')
  +(lab.terrainRefinement==='pixel'?'#define PIXEL_TERRAIN_REFINEMENT 1\n':'')
  +(lab.cloudSteps==='balanced'?'#define BALANCED_CLOUD_STEPS 1\n':'')
  +(lab.shaderWork==='lean'?'#define LEAN_SHADER_WORK 1\n':'')
  +(lab.terrainFetch==='shared'?'#define SHARED_TERRAIN_ENTRY 1\n':'')
  +(clouds==='balanced'?'#define BALANCED_CLOUDS 1\n':clouds==='calibrated'?'#define CALIBRATED_CLOUDS 1\n':clouds==='off'?'#define CLOUDS_DISABLED 1\n':'')
  +(cloudProperties?'#define CLOUD_PROPERTIES 1\n'+cloudPropertiesSwathHeader(cloudDay.date)+(lab.cloudStudyView==='quality'?'#define CLOUD_PROPERTIES_QUALITY 1\n':''):'')
  +(modisStudy?'#define MODIS_PATCH 1\n'+(lab.cloudStudy==='modis'?'#define MODIS_GUIDANCE 1\n':''):'')
  +(modisStudy||lab.cloudShape==='texture'?'#define TEXTURE_SHAPED_CLOUDS 1\n':'');
 const scene=cloud+noiseHeader+terrainHeader
  +(options.nightDetail==='vnp46'?'#define NIGHT_VNP46 1\n'+(lab.nightRange==='extended'?'#define NIGHT_VNP46_EXTENDED 1\n':''):'')
  +(supportsTerrainTiles?(options.terrainDetail==='coarse'?'#define TERRAIN_TILES 1\n':'#define TERRAIN_STREAM 1\n'+(renderPlan.terrainBound==='regional'?'#define TERRAIN_BOUND 1\n':'')):'')
  +(supportsGalaxyTiles?'#define GALAXY_TILES 1\n':'')
  +(supportsSolarTransmission?'#define SOLAR_TRANSMISSION 1\n':'')
  +(supportsAurora?'#define AURORA 1\n':'')
  +(supportsSourceAttenuation?'#define SOURCE_ATTENUATION 1\n#define CAMERA_PUPIL_STATE 1\n':'')
  +(supportsCloudTiles?'#define CLOUD_TILES 1\n':'')
  +(dayPyramid?'#define DAY_PYRAMID 1\n':'')
  +(supportsTerrain?'#define TERRAIN_MAP 1\n':'')
  +(separateVolume?'#define SEPARATE_WORLD_PASS 1\n':'');
 const attenuation=cloud+noiseHeader+(supportsCloudTiles?'#define CLOUD_TILES 1\n':'');
 const volume=cloud+noiseHeader+(supportsSourceAttenuation?'#define CAMERA_PUPIL_STATE 1\n':'')+(supportsSolarTransmission?'#define SOLAR_TRANSMISSION 1\n':'')+(supportsAurora?'#define AURORA 1\n':'')+(supportsCloudTiles?'#define CLOUD_TILES 1\n':'');
 return {scene,attenuation,volume};
}
