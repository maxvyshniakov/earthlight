import {test} from 'bun:test';
import assert from 'node:assert/strict';
import {readSceneRenderOptions} from '../src/scripts/scene-render-options.ts';
import {createSceneRenderPlan} from '../src/scripts/scene-render-plan.ts';
import {sceneRenderDiagnostics} from '../src/scripts/scene-render-diagnostics.ts';
import {sceneShaderHeaders} from '../src/scripts/scene-shader-headers.ts';

const desktop={textureUnits:16,textureSize:8192,explicitLod:true,derivatives:true,
 halfFloat:true,float:true,drawBuffers:4,colorAttachments:4};
const explorer={background:false,saveData:false,touchDevice:false};
const options=query=>readSceneRenderOptions(new URLSearchParams(query));
const plan=(query='',caps={},environment={})=>createSceneRenderPlan(options(query),{...desktop,...caps},{...explorer,...environment});
const pick=(value,keys)=>Object.fromEntries(keys.map(key=>[key,value[key]]));

test('renderer options keep legacy URL aliases and invalid-value defaults',()=>{
 const defaults=options(''),unknown=options('render=removed&clouds=broken&night=1&terrainDetail=unknown&dayDetail=unknown&motionBlur=wrong');
 assert.equal(defaults.profile.name,'compact');assert.equal(defaults.clouds,'calibrated');assert.equal(defaults.motionShutter,.75);
 assert.equal(unknown.profile.name,'compact');assert.equal(unknown.clouds,'calibrated');assert.equal(unknown.night,'current');
 assert.equal(unknown.terrainDetail,'stream');assert.equal(unknown.dayDetail,'tiles');assert.equal(unknown.motionShutter,0);
 for(const value of ['0','off']){assert.equal(options('clouds='+value).clouds,'off');assert.equal(options('aurora='+value).aurora,'off');}
 for(const value of ['1','on'])assert.equal(options('aurora='+value).aurora,'on');
 // These controls historically used exact string matches, not generic booleans.
 assert.equal(options('surface=off&terrain=off').surface,true);
 assert.equal(options('surface=0&terrain=0').terrain,false);
 assert.equal(options('cloudStudy=modis').clouds,'original');
 assert.equal(options('cloudStudy=modis&clouds=balanced').clouds,'balanced');
});

test('renderer owns an immutable URL snapshot with bounded numeric controls',()=>{
 const params=new URLSearchParams('terrainView=color&terrainSun=-450,120&scale=.4&motionBlur=2');
 const value=readSceneRenderOptions(params);
 params.set('terrainView','clay');params.set('scale','1');
 assert.equal(value.experiments.terrainView,2);assert.deepEqual(value.experiments.terrainSun,[270,90]);
 assert.equal(value.profile.scale,.4);assert.equal(value.motionShutter,1);
 for(const query of ['terrainSun=no,5','terrainSun=1,2,3'])assert.equal(options(query).experiments.terrainSun,null);
 for(const query of ['scale=0','scale=2','scale=NaN'])assert.equal(options(query).profile.scale,1);
 assert.equal(options('motionBlur=-1').motionShutter,0);
 assert.ok(Object.isFrozen(value)&&Object.isFrozen(value.experiments)&&Object.isFrozen(value.profile)&&Object.isFrozen(value.experiments.terrainSun));
});

test('each retained renderer profile selects its documented pass family',()=>{
 const fields=['compactWorld','separateVolume','sharedLighting','textureLighting','halfClouds','temporalClouds','noiseTable'];
 const expected={
  compact:[true,true,false,true,false,true,true],
  'clouds-half':[true,true,false,false,true,false,false],
  split:[false,true,false,false,false,false,true],
  lighting:[false,false,true,false,false,false,true],
  reference:[false,false,false,false,false,false,true],
 };
 for(const [name,values] of Object.entries(expected))assert.deepEqual(pick(plan('render='+name),fields),Object.fromEntries(fields.map((key,i)=>[key,values[i]])),name);
});

test('target format and MRT failures retain independent inline or compact fallbacks',()=>{
 assert.equal(plan('',{halfFloat:false}).separateVolume,false);
 assert.equal(plan('render=split',{halfFloat:false}).separateVolume,true);
 assert.equal(plan('render=split',{float:false}).separateVolume,false);
 assert.equal(plan('',{float:false}).separateVolume,true);
 for(const caps of [{drawBuffers:1},{colorAttachments:1}]){
  const half=plan('render=clouds-half',caps),compact=plan('',caps);
  assert.equal(half.separateVolume,true);assert.equal(half.halfClouds,false);
  assert.equal(compact.separateVolume,true);assert.equal(compact.temporalClouds,false);
 }
});

test('sampler limits admit only the features that fit at each boundary',()=>{
 const features=['supportsTerrain','supportsCloudTiles','supportsSourceAttenuation','supportsAurora','supportsSolarTransmission','noiseTable','supportsGalaxyTiles','supportsTerrainTiles'];
 const minimum=[9,10,11,12,13,14,15,16];
 for(let textureUnits=8;textureUnits<=16;textureUnits++){
  const value=plan('',{textureUnits});
  for(let i=0;i<features.length;i++)assert.equal(value[features[i]],textureUnits>=minimum[i],`${textureUnits} units: ${features[i]}`);
 }
 assert.equal(plan('',{textureUnits:15}).temporalClouds,false);
 assert.equal(plan('render=clouds-half',{textureUnits:15}).halfClouds,true);
});

test('ocean prototypes reserve the galaxy unit only when the prototype is supported',()=>{
 for(const ocean of ['regions','fronts','combined','advected']){
  const value=plan('ocean='+ocean);assert.equal(value.oceanMode,ocean);assert.equal(value.supportsGalaxyTiles,false);
 }
 const fallback=plan('ocean=advected',{explicitLod:false});
 assert.equal(fallback.oceanMode,null);assert.equal(fallback.supportsGalaxyTiles,true);
 assert.equal(plan('ocean=removed').oceanMode,null);
 assert.equal(plan('render=clouds-half',{halfFloat:false}).noiseTable,false,'depth sampler reservation survives the inline fallback');
});

test('save-data and background suppress detail independently of terrain overview and effects',()=>{
 const fields=['streamDetail','supportsTerrainTiles','supportsGalaxyTiles','supportsCloudTiles','dayPyramid','cloudProperties'];
 for(const environment of [{saveData:true},{background:true}]){
  const value=plan('dayDetail=sentinel&cloudStudy=global',{},environment);
  for(const field of fields)assert.equal(value[field],false,field);
 }
 assert.equal(plan('',{},{saveData:true}).supportsTerrain,true);
 const background=plan('motionBlur=1',{}, {background:true});
 assert.equal(background.supportsTerrain,false);assert.equal(background.wantsMoonSurface,false);assert.equal(background.motionShutter,0);
 assert.equal(background.separateVolume,true);
});

test('texture size and touch policy retain explicit effect overrides',()=>{
 const small=plan('',{textureSize:1024});
 assert.equal(small.streamDetail,false);assert.equal(small.supportsAurora,false);assert.equal(small.textureLighting,false);
 assert.equal(plan('',{textureSize:2048}).textureLighting,true);
 assert.equal(plan('',{textureSize:2048}).streamDetail,false);
 assert.equal(plan('',{}, {touchDevice:true}).wantsAurora,false);
 assert.equal(plan('aurora=on',{}, {touchDevice:true}).supportsAurora,true);
 assert.equal(plan('aurora=on',{explicitLod:false},{touchDevice:true}).supportsAurora,false);
});

test('cloud studies keep their distinct inputs and comparison paths',()=>{
 for(const study of ['photo','modis']){
  const value=plan('cloudStudy='+study);
  assert.equal(value.modisStudy,true);assert.equal(value.cloudProperties,false);
  assert.equal(value.supportsCloudTiles,false);assert.equal(value.textureLighting,false);
  assert.equal(value.temporalClouds,true,'temporal reuse is retained for photographic lab comparisons');
 }
 const measured=plan('cloudStudy=global');
 assert.equal(measured.modisStudy,false);assert.equal(measured.cloudProperties,true);assert.equal(measured.supportsCloudTiles,true);assert.equal(measured.textureLighting,true);
 const off=plan('clouds=off');assert.equal(off.supportsCloudTiles,false);assert.equal(off.textureLighting,false);assert.equal(off.temporalClouds,false);
 assert.equal(plan('cloudReuse=off').temporalClouds,false);
 assert.equal(plan('cloudLighting=raymarch').textureLighting,false);
});

test('terrain inspection and comparison flags resolve before shader compilation',()=>{
 const inspected=plan('terrainView=clay');assert.equal(inspected.separateVolume,false);assert.equal(inspected.wantsMoonSurface,false);
 assert.equal(plan('terrainDetail=coarse').terrainBound,'off');
 assert.equal(plan('terrainDetail=0').supportsTerrainTiles,false);
 assert.equal(plan('terrain=0').supportsTerrainTiles,false);
 assert.equal(plan('terrainBound=off').terrainBound,'off');
 const requested=options('terrainWork=legacy&terrainRefinement=full&terrainFetch=separate&cloudSteps=full&shaderWork=legacy&noise=hash');
 const resolved=createSceneRenderPlan(requested,desktop,explorer),headers=sceneShaderHeaders(requested,resolved,desktop);
 for(const define of ['BOUNDED_RAY_WORK','PIXEL_TERRAIN_REFINEMENT','SHARED_TERRAIN_ENTRY','BALANCED_CLOUD_STEPS','LEAN_SHADER_WORK','NOISE_TABLE'])assert.ok(!headers.scene.includes('#define '+define),define);
});

test('diagnostics cannot change renderer policy or night-switch shader definitions',()=>{
 const requested=options('cloudStudy=global&cloudStudyView=quality&nightDetail=vnp46&nightRange=extended');
 const resolved=createSceneRenderPlan(requested,desktop,explorer),before=sceneShaderHeaders(requested,resolved,desktop);
 const diagnostics=sceneRenderDiagnostics(requested,resolved);
 diagnostics.terrainBound='off';diagnostics.shaderWork='legacy';diagnostics.cloudStudy='off';
 assert.deepEqual(sceneShaderHeaders(requested,resolved,desktop),before);
 for(const define of ['TERRAIN_BOUND','LEAN_SHADER_WORK','CLOUD_PROPERTIES_QUALITY','NIGHT_VNP46_EXTENDED'])assert.ok(before.scene.includes('#define '+define),define);
 assert.equal(sceneRenderDiagnostics(requested,resolved).cloudStudy,'global');
});

test('implicit-LOD fallback retains wrapped derivatives exactly once on every pass',()=>{
 const requested=options(''),resolved=createSceneRenderPlan(requested,desktop,explorer);
 for(const [explicitLod,derivatives] of [[false,false],[false,true],[true,false],[true,true]]){
  for(const header of Object.values(sceneShaderHeaders(requested,resolved,{explicitLod,derivatives}))){
   assert.equal(header.includes('#define CLOUD_EXPLICIT_LOD'),explicitLod);
   assert.equal(header.includes('#define SKY_EXPLICIT_GRAD'),explicitLod&&derivatives);
   assert.equal(header.includes('#define SKY_DERIVATIVES'),derivatives);
   assert.equal(header.split('#extension GL_OES_standard_derivatives').length-1,derivatives?1:0);
  }
 }
});
