import {continuousLongitudeShader} from './surface-map.ts';
// An illustrative cloud volume driven by NASA's optical cloud composite.
// The photograph provides coverage, not measured height/density: the vertical
// profile and small-scale relief below are a bounded reconstruction.
import {stormLightShader} from './storm-light.ts';
import {modisPatchShader} from './modis-patch.ts';
import {cloudPropertiesShader} from './cloud-properties.ts';
export const cloudShader=continuousLongitudeShader+`
#ifndef FOCAL
#define FOCAL 1.25
#endif
uniform float cloudMapWidth;
${modisPatchShader}
${cloudPropertiesShader}
vec3 cloudCoordinates(vec3 point){
#ifndef CLOUD_PROPERTIES
  // Measured clouds stay where they were observed.
  point.xy=rotate(time*.000008)*point.xy;
#endif
  return point;
}
float cloudMapSample(vec2 uv,float lod,float texels,bool detailed){
#ifdef CLOUD_EXPLICIT_LOD
  float mapped=texture2DLodEXT(cloudMap,uv,lod).r;
#else
  // Conservative fallback for old WebGL 1 drivers without explicit LOD.
  float mapped=texture2D(cloudMap,continuousLongitude(uv),max(0.,lod-1.)).r;
#endif
  if(detailed)mapped=detailedCloud(uv,texels*16384./max(1.,cloudMapWidth),mapped);
  return mapped;
}
float cloudCoverageAt(vec2 uv,float latitudeScale,float footprint,bool detailed){
  // Filter for BOTH the pixel cone and the integration interval. Implicit
  // derivatives inside divergent raymarch/shadow branches are unreliable.
  float texels=footprint*max(1.,cloudMapWidth)/(6.283185307*latitudeScale);
  float lod=max(0.,log2(max(1.,texels)));
  float mapped=cloudMapSample(uv,lod,texels,detailed);
#ifdef CLOUD_PROPERTIES
  // Measured opacity is the coverage; there are no plate seams to repair.
  return mapped;
#endif
  // The NASA W/E photographic plates disagree south of 50 degrees at their
  // joins at Greenwich AND the date line. Blend paired geography only inside
  // these narrow seam bands;
  // all density, shadow and lens-transmission paths share the correction.
  float seam=mod(uv.x+.25,.5)-.25;
  float repair=(1.-smoothstep(.20,.23,uv.y))*(1.-smoothstep(0.,.012,abs(seam)));
  if(repair>0.){
    float paired=cloudMapSample(vec2(fract(uv.x-2.*seam),uv.y),lod,texels,detailed);
    mapped=mix(mapped,(mapped+paired)*.5,repair);
  }
  // Keep the photograph's faint sheets and soft edges. Raising this cutoff
  // erases them at full-disc scale and leaves only disconnected bright cores.
  return smoothstep(.025,.94,mapped);
}
float cloudCoverage(vec3 point,float footprint,bool detailed){
  vec3 n=normalize(cloudCoordinates(point));
  float coverage=cloudCoverageAt(earthUV(n),max(.15,length(n.xy)),footprint,detailed);
#ifdef MODIS_PATCH
  float weight;vec4 field=modisSample(point,footprint,weight);
  coverage=mix(coverage,field.r,weight);
#endif
  return coverage;
}
// Once an octave is below the sampling footprint its contribution is exactly
// the mean. Avoid evaluating eight-corner noise that will be discarded.
float filteredCloudNoise(vec3 point,float frequency,float footprint){
  float fade=smoothstep(.3,1.,footprint*frequency);
  if(fade>=1.)return .5;
  return mix(noise(point*frequency),.5,fade);
}
float cloudBaseDensity(vec3 point,float footprint,bool detailed){
  float height=(length(point)-1.)*6371.;
  if(height<.6 || height>12.)return 0.;
#if defined(LEAN_SHADER_WORK) && !defined(MODIS_PATCH)
  // One projection serves both the detailed and neighbourhood samples.
  vec3 cloudNormal=normalize(cloudCoordinates(point));
  vec2 cloudUV=earthUV(cloudNormal);
  float latitudeScale=max(.15,length(cloudNormal.xy));
  float coverage=cloudCoverageAt(cloudUV,latitudeScale,footprint,detailed);
  if(coverage<.001)return 0.;
  float neighborhood=cloudCoverageAt(cloudUV,latitudeScale,max(footprint,.0025),false);
#else
  float coverage=cloudCoverage(point,footprint,detailed);
  if(coverage<.001)return 0.;
  // The optical map is the only evidence for horizontal cloud structure.
  // An unrelated regional noise mask used to label broad patches as deep
  // convection, changing their height, whiteness and texture all at once.
  float neighborhood=cloudCoverage(point,max(footprint,.0025),false);
#endif
  float connected=smoothstep(.32,.78,min(coverage,neighborhood));
  float relief=0.;
#ifndef TEXTURE_SHAPED_CLOUDS
  vec3 material=cloudCoordinates(point),horizontal=normalize(material);
  vec3 cellPoint=vec3(dot(horizontal,vec3(.36,.48,-.8)),
    dot(horizontal,vec3(-.8,.6,0.)),dot(horizontal,vec3(.48,.64,.6)));
  float coarse=filteredCloudNoise(cellPoint,1200.,footprint);
  float fine=filteredCloudNoise(material*vec3(.45,1.,.8),3600.,footprint);
  relief=(.75*coarse+.25*fine-.5)*mix(.65,.12,connected);
#endif
  // A continuous illustrative envelope, not a cloud-height retrieval. Broad
  // photographic structure controls its rise; local coverage retains edges.
  float base=.8+.3*neighborhood;
  float top=2.+5.5*smoothstep(.15,.95,neighborhood)
    +smoothstep(.10,1.,coverage)+relief;
  // Keep the ramps disjoint even at thin edges so the column integral below
  // remains valid at every coverage and noise value.
  float thickness=top-base;
  float baseFeather=min(.7,thickness*.35),topFeather=min(.9,thickness*.45);
  float profile=smoothstep(base,base+baseFeather,height)
    *(1.-smoothstep(top-topFeather,top+topFeather*.5,height));
  // Preserve the column optical thickness while changing its height. This
  // prevents an illustrative crown from becoming a separate opaque white lid.
  float column=top-base-.5*baseFeather-.25*topFeather;
  float density=profile*1.4/max(.5,column);
#ifdef BALANCED_CLOUDS
  // Gently thin weak columns without changing their extent or height. Dense
  // cores retain their optical thickness; all light paths share this density.
  density*=mix(.72,1.,smoothstep(.2,.8,coverage));
#endif
  return pow(coverage,1.35)*density*(1.-smoothstep(11.5,12.,height));
}
float cloudIntegratedDensity(vec3 point,float footprint,bool detailed,float halfSpan){
#ifdef CLOUDS_DISABLED
  return 0.;
#endif
#ifdef CLOUD_PROPERTIES
  return cloudPropertiesDensity(point,footprint,detailed,halfSpan);
#endif
#ifdef MODIS_GUIDANCE
  float weight;vec4 field=modisSample(point,footprint,weight);
  float guided=weight>0.?modisDensity(field,(length(point)-1.)*6371.,halfSpan):0.;
  if(weight>=.999)return guided;
  return mix(cloudBaseDensity(point,footprint,detailed),guided,weight);
#else
  return cloudBaseDensity(point,footprint,detailed);
#endif
}
float cloudDensity(vec3 point,float footprint,bool detailed){return cloudIntegratedDensity(point,footprint,detailed,0.);}
float cloudLightTransmission(vec3 point,vec3 lightDirection,float samples){
#ifdef CLOUDS_DISABLED
  return 1.;
#endif
  // Trace the whole cloud shell, including high clouds and oblique sunlight.
  // A fixed 25 km ray silently missed both. Trim the empty space below base.
  const float outer=1.0018835,inner=1.00009418;
  float b=dot(point,lightDirection),c=dot(point,point);
  float disc=b*b-c+outer*outer;
  if(disc<=0.)return 1.;
  float start=max(0.,-b-sqrt(disc)),end=-b+sqrt(disc);
  float hole=b*b-c+inner*inner;
  if(hole>0.){
    float near=-b-sqrt(hole),far=-b+sqrt(hole);
    if(c<inner*inner)start=max(start,far);
    else if(near>0.)end=min(end,near);
  }
  if(end<=start)return 1.;
  float pixelFootprint=length(point-cameraPosition)/(resolution.y*FOCAL);
  float tau=0.;
  float lateral=sqrt(max(0.,1.-pow(dot(normalize(point),lightDirection),2.)));
  for(int j=0;j<12;j++){
    if(float(j)>=samples || tau>8.)break;
    float a=float(j)/samples,z=(float(j)+1.)/samples;
    // Self-shadow changes fastest just above the current cloud sample.
    if(samples<10.){a*=a;z*=z;}
    float width=(end-start)*(z-a),distance=start+(end-start)*(a+z)*.5;
    // Filter lateral travel, not the vertical thickness of a shadow slice.
    // The finite solar disc also softens distant cloud shadows naturally.
    float footprint=max(pixelFootprint,max(distance*.00465,width*lateral*.35));
    // Surface shadows retain atlas detail; only the distant part of a cloud's
    // self-shadow uses the overview, after its sharp local structure is traced.
    vec3 samplePoint=point+lightDirection*distance;
    tau+=cloudIntegratedDensity(samplePoint,footprint,samples>=10.||j<3,width*3185.5*abs(dot(normalize(samplePoint),lightDirection)))*width*6371.;
  }
  return exp(-tau);
}
float cloudShadowAlong(vec3 point,vec3 lightDirection){return cloudLightTransmission(point,lightDirection,12.);}
float cloudShadow(vec3 point){return cloudLightTransmission(point,sunDirection,6.);}
// Five source rays are evaluated in a tiny prepass, never once per screen pixel.
// The same coverage, height profile and filtering drive visible clouds and the
// light reaching the lens. Scattering into the ray does not feed lens ghosts.
float lensCloudDepth(vec3 ray){
 float b=dot(cameraPosition,ray),c=dot(cameraPosition,cameraPosition);
 float cloudTau=0.;
 const float outer=1.0018835,inner=1.00009418;
 float disc=b*b-c+outer*outer;
 if(b<0.&&disc>0.){
  float entry=max(0.,-b-sqrt(disc)),end=-b+sqrt(disc);
  float hole=b*b-c+inner*inner;
  if(hole>0.)end=min(end,-b-sqrt(hole));
  float width=max(0.,end-entry)/96.;
  for(int i=0;i<96;i++){
   if(cloudTau>8.)break;
   float distance=entry+(float(i)+.5)*width;
   vec3 samplePoint=cameraPosition+ray*distance;
   cloudTau+=cloudIntegratedDensity(samplePoint,max(distance/(resolution.y*FOCAL),width*.5),true,width*3185.5*abs(dot(normalize(samplePoint),ray)))*width*6371.;
  }
 }
 return cloudTau;
}
// Clear air between the lens and the source, aerosol included: a source near
// the limb is seen through ~300 km of the lowest kilometres.
vec3 lensAirTransmission(vec3 ray){
 float b=dot(cameraPosition,ray),c=dot(cameraPosition,cameraPosition);
 float limit=10.;
 float ground=b*b-c+1.;if(b<0.&&ground>0.)limit=max(0.,-b-sqrt(ground));
 return exp(-limbExtinction(limbColumns(cameraPosition,ray,limit)));
}
vec3 lensTransmission(vec3 ray){return lensAirTransmission(ray)*exp(-lensCloudDepth(ray));}
${stormLightShader}
vec3 cloudIntegral(vec3 ray,float groundDistance,out float transmission,out float atmosphereDistance){
  transmission=1.;
  atmosphereDistance=groundDistance;
#ifdef CLOUDS_DISABLED
  return vec3(0.);
#endif
  const float outer=1.0018835;
  const float inner=1.00009418;
  float b=dot(cameraPosition,ray),c=dot(cameraPosition,cameraPosition);
  float disc=b*b-c+outer*outer;
  if(b>=0. || disc<=0.)return vec3(0.);
  float entry=max(0.,-b-sqrt(disc)),exitDistance=-b+sqrt(disc);
  float innerDisc=b*b-c+inner*inner;
  if(innerDisc>0.)exitDistance=min(exitDistance,-b-sqrt(innerDisc));
  if(groundDistance>0.)exitDistance=min(exitDistance,groundDistance);
  // At orbital grazing angles, 24 slices skip over cloud tops and imprint
  // moving contour bands. Resolve the density profile along the ray itself;
  // texture mip filtering alone cannot antialias this volume integral.
  // Resolve the smooth kilometre-scale density profile at ~650 m intervals.
  // Near-nadir views cross only a thin shell and do not need the 96 samples
  // reserved for long horizon paths (each lit sample also traces a shadow).
  float pathLength=max(0.,exitDistance-entry);
#ifdef BOUNDED_RAY_WORK
  if(pathLength<=0.)return vec3(0.);
#endif
#ifdef BALANCED_CLOUD_STEPS
  float viewSteps=clamp(ceil(pathLength*6371.),16.,96.);
#else
  float viewSteps=clamp(ceil(pathLength*6371./.65),16.,96.);
#endif
  float stepLength=pathLength/viewSteps;
  vec4 stormA,stormB;
  stormRaySources(ray,entry,exitDistance,stormA,stormB);
  vec3 scattered=vec3(0.);
  float weightedDistance=0.;
  // Broad ground illumination is sampled once per view ray, not at every
  // volume step. Density and view transmittance still integrate inside clouds.
  vec3 cityPoint=cameraPosition+ray*mix(entry,exitDistance,.72);
  float urbanNight=1.-smoothstep(-.12,.02,dot(normalize(cityPoint),sunDirection));
  vec3 urbanLight=urbanNight>.001?cityCloudLight(cityPoint):vec3(0.);
  vec3 lunarLight=urbanNight>.001?moonlightAt(cityPoint):vec3(0.);
  vec3 lunarDirection=moonDirectionAt(cityPoint);
  // Hemispheric illumination is evaluated once per ray. Optical thickness
  // still controls the scattered signal at every volume sample below.
  vec3 nightSky=urbanNight>.001?(airglowIrradiance(cityPoint)+galacticIrradiance(normalize(cityPoint))*nightSkyTransmission(cityPoint))*.8/3.141592654:vec3(0.);
  float cosTheta=dot(ray,sunDirection);
  float forward=.1225/pow(max(.08,1.4225-1.3*cosTheta),1.5);
#ifdef SHARED_CLOUD_LIGHTING
  float shadowBlock=-1.,shadowStart=1.,shadowEnd=1.;
#endif
  for(int i=0;i<96;i++){
    if(float(i)>=viewSteps)break;
    if(transmission<.015)break;
    vec3 point=cameraPosition+ray*(entry+(float(i)+.5)*stepLength);
    float pixelFootprint=length(point-cameraPosition)/(resolution.y*FOCAL);
#ifdef HALF_CLOUD_PASS
    pixelFootprint*=2.;
#endif
    float footprint=max(pixelFootprint,stepLength*.5);
    float rho=cloudIntegratedDensity(point,footprint,true,stepLength*3185.5*abs(dot(normalize(point),ray)));
    if(rho>.001){
#ifdef MODIS_GUIDANCE
      // Light the cloud mass inside the interval, not its possibly empty
      // centre. Otherwise thin layers strobe as viewSteps changes by one.
      point=modisLightingPoint(point,ray,stepLength*3185.5*abs(dot(normalize(point),ray)),footprint);
#endif
      vec3 normal=normalize(point);
      float mu=dot(normal,sunDirection),sb=dot(point,sunDirection);
      float earthDisc=sb*sb-dot(point,point)+1.;
      float sunVisible=(sb>=0. || earthDisc<0.)?1.:0.;
      float dusk=1.-smoothstep(.01,.22,mu);
      vec3 sunColor=mix(vec3(1.,.98,.94),vec3(1.,.46,.20),dusk*.8);
      float shadow=1.;
#ifdef SHARED_CLOUD_LIGHTING
      // Preserve every density sample. Reuse the expensive light integral
      // between four view samples, interpolating at their actual positions.
      if(sunVisible>.5){
        float block=floor(float(i)/4.);
        if(block!=shadowBlock){
          float end=entry+(min(block*4.+4.,viewSteps-1.)+.5)*stepLength;
          // One integration call site matters: duplicating this large helper
          // inside the loop made the first cache experiment slower on Metal.
          float nextShadow=cloudShadow(cameraPosition+ray*end);
          shadowStart=block==shadowBlock+1.&&shadowBlock>=0.?shadowEnd:nextShadow;
          shadowEnd=nextShadow;
          shadowBlock=block;
        }
        float span=max(1.,min(4.,viewSteps-1.-block*4.));
        shadow=mix(shadowStart,shadowEnd,(float(i)-block*4.)/span);
      }
#else
      shadow=sunVisible>.5?cloudShadow(point):1.;
#endif
#ifdef CLOUD_PROPERTIES
      if(sunVisible>.5)shadow=cloudPropertiesIllumination(point,footprint,shadow);
#endif
      // Twilight belongs to the Sun; no source-independent night fill.
      float ambient=smoothstep(-.15,.20,mu)*.09;
      vec3 light=vec3(.76,.84,1.)*ambient+sunColor*sunVisible*(.20+.80*shadow)*(.48+.38*max(0.,mu))*(.8+forward*.30);
      light+=nightSky;
      light+=lunarLight*(.20+.80*max(0.,dot(normal,lunarDirection)));
      float cloudHeight=max(0.,(length(point)-1.)*6371.);
      light+=urbanLight*exp(-cloudHeight/5.);
      // Wispy foreground cloud must not become a second luminous storm sheet.
      light+=(stormCloudLight(point,stormA)+stormCloudLight(point,stormB))*smoothstep(.025,.07,rho);
#ifdef CLOUD_PROPERTIES_QUALITY
      light*=cloudPropertiesTint(point);
#endif
      float opacity=1.-exp(-rho*stepLength*6371.);
      weightedDistance+=transmission*opacity*(entry+(float(i)+.5)*stepLength);
      scattered+=transmission*opacity*light;
      transmission*=1.-opacity;
    }
  }
  if(transmission<.999){
    float clearDistance=groundDistance>0.?groundDistance:exitDistance;
    atmosphereDistance=mix(clearDistance,weightedDistance/(1.-transmission),1.-transmission);
  }
  return scattered;
}
vec3 cloudVolume(vec3 ray,float groundDistance,vec3 background,out float atmosphereDistance){
  float transmission;
  vec3 scattered=cloudIntegral(ray,groundDistance,transmission,atmosphereDistance);
#ifdef CLOUD_PROPERTIES_QUALITY
  if(groundDistance>0.)background=cloudPropertiesGround(cameraPosition+ray*groundDistance,background);
#endif
  return max(vec3(0.),background*transmission+scattered);
}
`;
