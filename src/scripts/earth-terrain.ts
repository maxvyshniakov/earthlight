import {terrainTileShader} from './night-tiles.ts';
import {terrainDetailShader} from './terrain-detail.ts';
// ETOPO heights and an independent Natural Earth ocean mask. One optional
// sampler (unit 8); devices limited to eight samplers retain the sphere.
export function decodeTerrain(buffer:ArrayBuffer){
  const header=new DataView(buffer);
  const magic=buffer.byteLength>=16?header.getUint32(0,true):0;
  if(magic!==0x314d4544&&magic!==0x324d4544)throw Error('Invalid terrain header');
  const width=header.getUint32(4,true),height=header.getUint32(8,true),count=header.getUint32(12,true);
  if(![4096,8192].includes(width)||height!==width/2||count!==Math.log2(width)+1)throw Error('Invalid terrain dimensions');
  let offset=16,w=width,h=height;
  const levels:Array<{width:number;height:number;data:Uint8Array}>=[];
  for(let i=0;i<count;i++){
    const length=w*h*3;
    if(offset+length>buffer.byteLength)throw Error('Truncated terrain');
    let data=new Uint8Array(buffer,offset,length);
    if(magic===0x324d4544){
      const decoded=new Uint8Array(length),count=w*h;
      for(let c=0;c<3;c++)for(let y=0;y<h;y++){
        let previous=0;
        for(let x=0;x<w;x++){const pixel=y*w+x;previous=(previous+data[c*count+pixel])&255;decoded[pixel*3+c]=previous;}
      }
      data=decoded;
    }
    levels.push({width:w,height:h,data});
    offset+=length;w=Math.max(1,w/2);h=Math.max(1,h/2);
  }
  if(offset!==buffer.byteLength)throw Error('Unexpected terrain data');
  return {width,height,levels};
}

export const terrainShader=`
#ifndef FOCAL
#define FOCAL 1.25
#endif
uniform float terrainReady;
uniform float terrainWidth;
#ifdef TERRAIN_STREAM
${terrainDetailShader}
#elif defined(TERRAIN_TILES)
${terrainTileShader}
#endif
float terrainSamplingWidth(){
#if defined(TERRAIN_STREAM)
 return terrainWidth;
#elif defined(TERRAIN_TILES)
 return terrainTileLayout.x>0.?21600.:terrainWidth;
#else
 return terrainWidth;
#endif
}
#ifndef TERRAIN_STREAM
float terrainSamplingWidthAt(vec2 uv){return terrainSamplingWidth();}
#endif
#ifdef TERRAIN_MAP
uniform sampler2D terrainMap;
vec3 terrainData(vec2 uv,float lod){
 float baseLod=max(0.,lod-log2(terrainSamplingWidthAt(uv)/terrainWidth));
#ifdef CLOUD_EXPLICIT_LOD
 vec3 base=texture2DLodEXT(terrainMap,uv,baseLod).rgb;
#else
 vec3 base=texture2D(terrainMap,uv,baseLod).rgb;
#endif
#ifdef TERRAIN_STREAM
 base.rg=streamedTerrain(uv,exp2(lod),base).rg;
#elif defined(TERRAIN_TILES)
 // The independent coastline stays on the global mask. Numeric RGB tiles
 // contain heights only, with mip levels averaged before byte packing.
 base.rg=detailedTerrain(uv,exp2(lod),base).rg;
#endif
 return base;
}
#else
vec3 terrainData(vec2 uv,float lod){return vec3(0.);}
#endif
float terrainHeight(vec3 point,float lod){
 vec3 encoded=terrainData(earthUV(normalize(point)),lod);
 return dot(encoded.rg,vec2(65280.,255.))*8./6371000.*terrainReady;
}
float terrainIntersection(vec3 ray,float seaDistance){
 if(terrainReady<.5)return seaDistance;
 float b=dot(cameraPosition,ray),c=dot(cameraPosition,cameraPosition);
 const float outer=1.001413; // 9 km; no artistic vertical exaggeration.
 float disc=b*b-c+outer*outer;
 if(b>=0.||disc<=0.)return seaDistance;
 float start=-b-sqrt(disc),end=seaDistance>0.?seaDistance:-b;
 // Half a DEM texel along the horizontal ray is enough to locate a crossing;
 // the binary refinement below still resolves its height. Short downward
 // views must not pay for the 96 steps allowed for horizon rays.
 vec3 radial=normalize(cameraPosition+ray*start);
 float horizontal=(end-start)*sqrt(max(0.,1.-pow(dot(radial,ray),2.)));
 float steps=clamp(ceil(horizontal*terrainSamplingWidthAt(earthUV(radial))/(3.14159265*max(.2,length(radial.xy)))),8.,96.);
 float stepLength=(end-start)/steps;
 float previous=start;
 // First crossing preserves near ridges occluding more distant lights.
 for(int i=1;i<=96;i++){
   if(float(i)>steps)break;
   float t=start+float(i)*stepLength;
   vec3 point=cameraPosition+ray*t;
   if(length(point)-1.<=terrainHeight(point,0.)){
     float lo=previous,hi=t;
     for(int j=0;j<11;j++){
#ifdef PIXEL_TERRAIN_REFINEMENT
       // Bound view-ray uncertainty to a quarter of the pixel cone.
       // Keep a two-metre floor for very close inspection.
       if(hi-lo<=max(2./6371000.,lo/(resolution.y*FOCAL)*.25))break;
#endif
       float mid=(lo+hi)*.5;
       vec3 p=cameraPosition+ray*mid;
       if(length(p)-1.>terrainHeight(p,0.))lo=mid;else hi=mid;
     }
     return (lo+hi)*.5;
   }
   previous=t;
 }
 return seaDistance;
}
vec3 terrainNormal(vec3 point,float distance){
 vec3 n=normalize(point);
 if(terrainReady<.5)return n;
 vec2 uv=earthUV(n);
 float pixel=distance/(resolution.y*FOCAL*max(.06,-dot(n,normalize(point-cameraPosition))));
 float width=terrainSamplingWidthAt(uv);
 float texels=pixel*width/(6.2831853*max(.15,length(n.xy)));
 float lod=max(0.,log2(max(1.,texels)));
 float du=exp2(lod)/width;
 vec3 e=normalize(vec3(-n.y,n.x,0.)),north=cross(n,e);
 vec2 ua=uv+vec2(du,0.),ub=uv-vec2(du,0.),uc=uv+vec2(0.,du*2.),ud=uv-vec2(0.,du*2.);
 vec3 a=terrainData(ua,lod+log2(terrainSamplingWidthAt(ua)/width)),b=terrainData(ub,lod+log2(terrainSamplingWidthAt(ub)/width));
 vec3 c=terrainData(uc,lod+log2(terrainSamplingWidthAt(uc)/width)),d=terrainData(ud,lod+log2(terrainSamplingWidthAt(ud)/width));
 vec2 slopes=vec2(dot(a.rg-b.rg,vec2(65280.,255.)),dot(c.rg-d.rg,vec2(65280.,255.)))*8./6371000.;
 slopes/=vec2(12.5663706*du*max(.02,length(n.xy)),12.5663706*du);
 return normalize(n-e*slopes.x-north*slopes.y);
}
float terrainLightVisibility(vec3 point,vec3 lightDirection){
 if(terrainReady<.5)return 1.;
 // Anchor the shadow ray on the same height field instead of inheriting the
 // residual error of the view-ray intersection. Filter sub-pixel occluders and
 // include a pixel-sized penumbra; distant DEM samples must not create stipple.
 vec3 radial=normalize(point);
 float width=terrainSamplingWidthAt(earthUV(radial));
 float texel=6.2831853/width;
 float footprint=length(point-cameraPosition)/(resolution.y*FOCAL*max(.12,-dot(radial,normalize(point-cameraPosition))));
 float bias=12./6371000.;
 vec3 origin=radial*(1.+terrainHeight(point,0.)+bias);
 float visibility=1.;
 float first=max(90./6371000.,min(500./6371000.,texel*.5));
 for(int i=0;i<24;i++){
   float distance=first*pow(1.35,float(i));
   if(distance>40000./6371000.)break;
   vec3 p=origin+lightDirection*distance;
#ifdef BOUNDED_RAY_WORK
   // Heights use the same 9 km bound as terrainIntersection. Once an
   // outward ray clears it, every remaining sample is also above terrain.
   if(dot(p,lightDirection)>=0. && dot(p,p)>1.001413*1.001413)break;
#endif
   float support=max(footprint*.5,distance*.00465);
   float sampleTexel=6.2831853/terrainSamplingWidthAt(earthUV(normalize(p)));
   float lod=max(0.,log2(max(1.,support/sampleTexel)));
   float clearance=length(p)-1.-terrainHeight(p,lod);
   float softness=max(bias,support);
   visibility=min(visibility,smoothstep(-softness,0.,clearance));
#ifdef BOUNDED_RAY_WORK
   if(visibility<=0.)break;
#endif
 }
 return visibility;
}
float terrainSunVisibility(vec3 point){return terrainLightVisibility(point,sunDirection);}
// Cox–Munk directional Gaussian slope statistics. Wind is a smooth synthetic
// field, not historical weather. Waves smaller than a pixel are integrated in
// the slope distribution; resolved roughness patches are footprint-filtered.
float waterField(vec3 n,float frequency,float footprint){
 return mix(noise(n*frequency),.5,smoothstep(.25,1.,footprint*frequency));
}
float waterMasking(float cosine,float alpha){
 float a=cosine/max(.0001,alpha*sqrt(max(0.,1.-cosine*cosine)));
 if(a>=1.6)return 1.;
 return (3.535*a+2.181*a*a)/(1.+2.276*a+2.577*a*a);
}
float oceanReflection(vec3 n,vec3 v,vec3 l,float footprint){
 float nv=dot(n,v),nl=dot(n,l);
 if(nv<=0.||nl<=0.)return 0.;
 float weather=waterField(n,17.,footprint);
 // Most unresolved waves belong in the slope distribution. Strong kilometre
 // scale changes in its variance made the glint resemble mottled varnish.
 // Keep broad wind systems and weak mesoscale variation, not a gloss texture.
 float gust=waterField(n+vec3(4.,9.,2.),65.,footprint);
 float wind=clamp(3.+8.*weather+(gust-.5)*1.2,2.,12.);
 vec3 east=normalize(cross(abs(n.z)<.98?vec3(0.,0.,1.):vec3(0.,1.,0.),n));
 vec3 north=cross(n,east);
 float heading=6.2831853*waterField(n+vec3(3.,7.,11.),8.,footprint);
 vec3 along=east*cos(heading)+north*sin(heading),across=cross(n,along);
 vec2 variance=vec2(.00316*wind,.003+.00192*wind);
 vec3 h=normalize(v+l);
 float nh=max(.0001,dot(n,h)),vh=max(0.,dot(v,h));
 vec2 slopes=vec2(dot(h,along),dot(h,across))/nh;
 float d=exp(-.5*dot(slopes*slopes,1./variance))
   /(6.2831853*sqrt(variance.x*variance.y)*pow(nh,4.));
 float alpha=sqrt(variance.x+variance.y);
 float masking=waterMasking(nv,alpha)*waterMasking(nl,alpha);
 float fresnel=.02037+.97963*pow(1.-vh,5.);
 return d*masking*fresnel/(4.*max(.0001,nv));
}

`;
