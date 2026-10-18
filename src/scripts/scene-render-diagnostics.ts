import type {SceneRenderOptions} from './scene-render-options';
import type {SceneRenderPlan} from './scene-render-plan';

/** One-way projection for the existing dataset/HUD protocol. Never use its
 * strings to choose shader variants or resources: those use the typed plan. */
export function sceneRenderDiagnostics(options:SceneRenderOptions,plan:SceneRenderPlan):Record<string,string> {
 const {experiments:lab,cloudDay}=options;
 return {
  textureProfile:options.texture,cloudShape:plan.modisStudy||lab.cloudShape==='texture'?'texture':'current',
  clouds:options.clouds,cloudStudy:plan.modisStudy||plan.cloudProperties?lab.cloudStudy:'off',
  cloudDate:plan.cloudProperties?cloudDay.date:'',
  cloudDateSource:plan.cloudProperties?cloudDay.measured?'epoch':'default':'',
  terrainWork:lab.terrainWork,terrainRefinement:lab.terrainRefinement,
  cloudSteps:lab.cloudSteps,shaderWork:lab.shaderWork,noise:plan.noiseTable?'table':'hash',
  terrainFetch:lab.terrainFetch,terrainBound:plan.terrainBound,
 };
}
