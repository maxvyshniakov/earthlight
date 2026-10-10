// An illustrative cloud volume driven by NASA's optical cloud composite.
// The photograph provides coverage, not measured height/density: the vertical
// profile and small-scale erosion below are a bounded reconstruction.
import {stormLightShader} from './storm-light.ts';
export const cloudShader=`
uniform float cloudMapWidth;
vec3 cloudCoordinates(vec3 point){
  point.xy=rotate(time*.000008)*point.xy;
  return point;
}
float cloudMapSample(vec2 uv,float lod,float texels,bool detailed){
#ifdef CLOUD_EXPLICIT_LOD
  float mapped=texture2DLodEXT(cloudMap,uv,lod).r;
#else
  // Conservative fallback for old WebGL 1 drivers without explicit LOD.
  float mapped=texture2D(cloudMap,uv,max(0.,lod-1.)).r;
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
  // The NASA W/E photographic plates disagree south of 50 degrees at their
  // meridian join. Blend paired geography only inside this narrow seam band;
  // all density, shadow and lens-transmission paths share the correction.
  float seam=uv.x-.5;
  float repair=(1.-smoothstep(.20,.23,uv.y))*(1.-smoothstep(0.,.012,abs(seam)));
  if(repair>0.){
    float paired=cloudMapSample(vec2(.5-seam,uv.y),lod,texels,detailed);
    mapped=mix(mapped,(mapped+paired)*.5,repair);
  }
  return smoothstep(.025,.94,mapped);
}
float cloudCoverage(vec3 point,float footprint,bool detailed){
  vec3 n=normalize(cloudCoordinates(point));
  return cloudCoverageAt(earthUV(n),max(.15,length(n.xy)),footprint,detailed);
}
// Once an octave is below the sampling footprint its contribution is exactly
// the mean. Avoid evaluating eight-corner noise that will be discarded.
float filteredCloudNoise(vec3 point,float frequency,float footprint){
  float fade=smoothstep(.3,1.,footprint*frequency);
  if(fade>=1.)return .5;
  return mix(noise(point*frequency),.5,fade);
}
float cloudDensity(vec3 point,float footprint,bool detailed){
  float height=(length(point)-1.)*6371.;
  if(height<.6 || height>12.)return 0.;
  float coverage=cloudCoverage(point,footprint,detailed);
  if(coverage<.001)return 0.;
  // Optical coverage sets density, not a height-map surface. A soft sheet
  // stays translucent face-on and becomes opaque along a long grazing path.
  vec3 material=cloudCoordinates(point),horizontal=normalize(material);
  float regional=filteredCloudNoise(horizontal+vec3(17.,31.,9.)/38.,38.,footprint);
  float neighborhood=cloudCoverage(point,max(footprint,.0025),false);
  float convection=smoothstep(.66,.90,regional)*smoothstep(.55,.9,neighborhood);
  float base=.85+1.05*regional;
  float bottom=base+.65*(1.-smoothstep(.12,.72,coverage));
  float center=3.+regional*.4+convection*.6;
  float width=1.2+.3*regional+convection*.6;
  float profile=smoothstep(bottom,bottom+.9,height)*exp(-.5*pow((height-center)/width,2.))
    *(1.-smoothstep(10.,12.,height));
  if(profile<.001)return 0.;
  // Density variations stretch into wisps; they cannot emboss a hard roof.
  float coarse=filteredCloudNoise(material*vec3(.45,1.,.8),1800.,footprint);
  float fine=filteredCloudNoise(material,4200.,footprint);
  float textureDensity=.65+.25*coarse+.10*fine;
  float extinction=mix(.12,.22,convection);
  return pow(coverage,1.35)*profile*textureDensity*extinction;
}
float cloudShadowAlong(vec3 point,vec3 lightDirection){
  float tau=0.;
  // Integrate the original 25.5 km support with filtered shadow samples.
  float pixelFootprint=length(point-cameraPosition)/(resolution.y*1.25);
  float distance=0.;
  // Resolve nearby self-shadow with detail; distant shadow samples use the
  // overview. Broad neighborhood/depth also needs no high-frequency tile data.
  for(int j=0;j<4;j++){
    float width=j==0?.00012:j==1?.00036:j==2?.00108:.00244;
    tau+=cloudDensity(point+lightDirection*(distance+width*.5),max(pixelFootprint,width*.5),j==0)*width*6371.;
    distance+=width;
  }
  return exp(-tau);
}
float cloudShadow(vec3 point){return cloudShadowAlong(point,sunDirection);}
// Five source rays are evaluated in a tiny prepass, never once per screen pixel.
// The same coverage, height profile and filtering drive visible clouds and the
// light reaching the lens. Scattering into the ray does not feed lens ghosts.
vec3 lensTransmission(vec3 ray){
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
   cloudTau+=cloudDensity(cameraPosition+ray*distance,max(distance/(resolution.y*1.25),width*.5),true)*width*6371.;
  }
 }
 float limit=10.;
 float ground=b*b-c+1.;if(b<0.&&ground>0.)limit=max(0.,-b-sqrt(ground));
 return exp(-airExtinction*airColumn(cameraPosition,ray,limit)-vec3(cloudTau));
}
${stormLightShader}
vec3 cloudIntegral(vec3 ray,float groundDistance,out float transmission,out float atmosphereDistance){
  transmission=1.;
  atmosphereDistance=groundDistance;
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
  float viewSteps=clamp(ceil(pathLength*6371./.65),16.,96.);
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
    float pixelFootprint=length(point-cameraPosition)/(resolution.y*1.25);
#ifdef HALF_CLOUD_PASS
    pixelFootprint*=2.;
#endif
    float footprint=max(pixelFootprint,stepLength*.5);
    float rho=cloudDensity(point,footprint,true);
    if(rho>.001){
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
      // Twilight belongs to the Sun; no source-independent night fill.
      float ambient=smoothstep(-.15,.20,mu)*.09;
      vec3 light=vec3(.76,.84,1.)*ambient+sunColor*sunVisible*(.20+.80*shadow)*(.48+.38*max(0.,mu))*(.8+forward*.30);
      light+=nightSky;
      light+=lunarLight*(.20+.80*max(0.,dot(normal,lunarDirection)));
      float cloudHeight=max(0.,(length(point)-1.)*6371.);
      light+=urbanLight*exp(-cloudHeight/5.);
      // Wispy foreground cloud must not become a second luminous storm sheet.
      light+=(stormCloudLight(point,stormA)+stormCloudLight(point,stormB))*smoothstep(.025,.07,rho);
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
  return max(vec3(0.),background*transmission+scattered);
}
`;
