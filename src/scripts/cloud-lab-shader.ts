import {cloudFamiliesShader} from './cloud-families';

export const cloudLabFragment = `precision highp float;
uniform vec2 resolution;
uniform vec3 eye, sun;
uniform mat3 basis;
uniform float exposure, diagnostic;
${cloudFamiliesShader}
const float earthRadius=6371.;
float cloudCeiling(){return family>1.5&&family<2.5?6.4:family>4.5?12.7:18.;}
vec2 shell(vec3 p,vec3 d,float r){
 vec3 q=p+vec3(0.,0.,earthRadius);float b=dot(q,d);
 float disc=b*b-dot(q,q)+r*r;
 if(disc<0.)return vec2(-1.);
 float root=sqrt(disc);return vec2(-b-root,-b+root);
}
float field(vec3 p,float footprint){
 float h=length(p+vec3(0.,0.,earthRadius))-earthRadius;
 return cloudFamilyDensity(vec3(p.xy,h),footprint);
}
float shadow(vec3 p,float footprint){
 vec2 hit=shell(p,sun,earthRadius+cloudCeiling());
 float end=max(0.,hit.y),tau=0.;
 // Quadratic intervals resolve the nearby side of a cloud. All receivers
 // sample this same field: water, low layers and high cloud self-shadow.
 for(int j=0;j<20;j++){
  float a=float(j)/20.,b=(float(j)+1.)/20.;
  float ds=end*(b*b-a*a),t=end*(a*a+b*b)*.5;
  float lateral=length(sun.xy);
  tau+=field(p+sun*t,max(footprint,max(ds*lateral*.22,t*.00465)))*ds;
  if(tau>10.)break;
 }
 return tau;
}
vec3 displayColor(vec3 color){
 color=vec3(1.)-exp(-color*exposure);
 return mix(color*12.92,1.055*pow(max(color,vec3(0.)),vec3(1./2.4))-.055,step(vec3(.0031308),color));
}
void main(){
 vec2 uv=(gl_FragCoord.xy-.5*resolution)/resolution.y;
 vec3 ray=normalize(basis*vec3(uv,1.5));
 vec2 earth=shell(eye,ray,earthRadius);
 float ground=earth.x>0.?earth.x:1.e5;
 vec2 bounds=shell(eye,ray,earthRadius+cloudCeiling());
 vec3 sky=vec3(.008,.018,.037);
 vec3 color=sky;
 if(ground<1.e4){
  vec3 p=eye+ray*ground;
  float tau=shadow(p,ground/(resolution.y*1.5));
  vec3 n=normalize(p+vec3(0.,0.,earthRadius));
  float mu=max(0.,dot(n,sun));
  // Neutral ocean receiver keeps cloud-shadow comparisons independent of
  // the production ocean BRDF, exposure metering and lens effects.
  color=vec3(.016,.055,.085)*(.20+mu*exp(-tau)*.85);
 }
 float first=max(0.,bounds.x),last=min(ground,bounds.y);
 vec2 base=shell(eye,ray,earthRadius+.45);
 if(base.x>0.)last=min(last,base.x);
 float trans=1.;vec3 scattered=vec3(0.);
 if(bounds.y>0.&&last>first){
  float path=last-first;
  float refined=(family>1.5&&family<2.5)||family>4.5?1.:0.;
  float steps=clamp(ceil(path/mix(.28,.10,refined)),40.,mix(180.,240.,refined));
  float ds=path/steps;
  for(int i=0;i<240;i++){
   if(float(i)>=steps||trans<.008)break;
   float distance=first+(float(i)+.5)*ds;
   vec3 p=eye+ray*distance;
   float footprint=max(distance/(resolution.y*1.5),ds*length(ray.xy)*.35);
   float rho=field(p,footprint);
   if(rho<.001)continue;
   float tau=shadow(p,footprint);
   vec3 n=normalize(p+vec3(0.,0.,earthRadius));
   float mu=dot(n,sun);
   float sunVisible=step(0.,mu);
   vec3 sunlight=mix(vec3(1.,.56,.30),vec3(1.,.98,.94),smoothstep(.05,.40,mu));
   float forward=.15/pow(max(.15,1.49-1.4*dot(ray,sun)),1.5);
   // Bounded multiple-scattering approximation shared by every family.
   // It is not a measured radiometric calibration or a full atmosphere model.
   vec3 light=vec3(.10,.14,.19)*smoothstep(-.05,.25,mu)
    +sunlight*sunVisible*(.82*exp(-tau)+.16*exp(-tau*.25))*(.8+forward*.3);
   if(refined>.5){
    float skyTau=field(p+vec3(0.,0.,.4),footprint)*.4+field(p+vec3(0.,0.,1.25),footprint)*1.1;
    vec3 skyLight=vec3(.10,.16,.24)*(.25+.75*exp(-skyTau*.65));
    light=skyLight*smoothstep(-.05,.25,mu)+sunlight*sunVisible
      *(1.1*exp(-tau)+.28*exp(-tau*.28))*(.8+forward*.3);
   }
   float opacity=1.-exp(-rho*ds);
   scattered+=trans*opacity*light;trans*=1.-opacity;
  }
 }
 color=color*trans+scattered;
 // A subtle range cue, held constant in all comparisons.
 float haze=ground<1.e4?1.-exp(-ground*.00035):0.;
 color=mix(color,vec3(.10,.16,.22),haze*.38);
 if(diagnostic>.5)color=vec3(1.-trans);
 gl_FragColor=vec4(displayColor(color),1.);
}`;
