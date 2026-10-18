// Standalone comparison: production scene functions with a regional night
// texture and direct display output, without CameraFinish or tile streaming.
import {buildSceneShaders} from '../src/scripts/scene-shader.ts';
import {buildCloudShader} from '../src/scripts/earth-clouds.ts';

const regionalCityEmission=`float cityEmission(vec2 uv) {
  float base=surfaceMapSample(nightMap,uv).r;
  vec2 q=(uv-detailBounds.xy)/detailBounds.zw;
  if(detailEnabled>.5 && all(greaterThanEqual(q,vec2(0.))) && all(lessThanEqual(q,vec2(1.)))){
    float edge=min(min(q.x,q.y),min(1.-q.x,1.-q.y));
    return mix(base,texture2D(nightDetail,q).r*detailGain,smoothstep(0.,.002,edge));
  }
  return base;
}
`;
export const nightLightsLabShader=buildSceneShaders('current',{
 declarations:'\nuniform sampler2D nightDetail;\nuniform vec4 detailBounds;\nuniform float detailEnabled;\nuniform float detailGain;\nuniform float cloudAmount;',
 nightTiles:'float detailedNight(vec2 uv,float footprint,float fallback){return fallback;}',
 dayTiles:'vec3 detailedDay(vec2 uv,float footprint,vec3 fallback){return fallback;}',
 cloudTiles:'float detailedCloud(vec2 uv,float footprint,float fallback){return fallback;}',
 cityEmission:regionalCityEmission,
 clouds:buildCloudShader('current',{photographicDensityScale:'cloudAmount'}),
 output:'display',
}).fragmentSource;
