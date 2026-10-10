// Research reconstruction: measured cloud top/tau, assumed vertical profile.
// No photograph, procedural shape noise, or pre-lit cloud color in this shader.
export const modisDemoFragment=`#version 300 es
precision highp float;
out vec4 fragColor;
uniform sampler2D lowMap,middleMap,highMap,qualityMap;
uniform vec2 resolution,extent;
uniform vec3 eye,sun,layers;
uniform mat3 basis;
uniform float exposure,minutes,diagnostic;
const float R=6371.;
vec2 sphere(vec3 p,vec3 d,float radius){vec3 q=p+vec3(0.,0.,R);float b=dot(q,d),a=b*b-dot(q,q)+radius*radius;if(a<0.)return vec2(-1.);return vec2(-b-sqrt(a),-b+sqrt(a));}
float altitude(vec3 p){return length(p+vec3(0.,0.,R))-R;}
vec2 coords(vec3 p,float layer){
 vec2 wind=layer<.5?vec2(9.,2.):layer<1.5?vec2(18.,1.):vec2(27.,-8.);
 return (p.xy-wind*minutes/60.)/extent+.5;
}
vec4 column(vec3 p,float layer){
 float on=layer<.5?layers.x:layer<1.5?layers.y:layers.z;if(on<.5)return vec4(0.);
 vec2 uv=coords(p,layer);if(any(lessThan(uv,vec2(0.)))||any(greaterThan(uv,vec2(1.))))return vec4(0.);
 float footprint=length(p-eye)/(resolution.y*1.5),lod=max(0.,log2(max(.001,footprint*1024./min(extent.x,extent.y))));
 vec4 c=layer<.5?textureLod(lowMap,uv,lod):layer<1.5?textureLod(middleMap,uv,lod):textureLod(highMap,uv,lod);
 c.rgb/=max(c.a,.001);return vec4(c.r*16.,exp(c.g*log(151.))-1.,c.b,c.a);
}
float thickness(vec4 c){return min(max(.1,c.x-.1),mix(clamp(.35+c.y*.045,.35,3.5),clamp(.45+c.y*.035,.45,2.5),c.z));}
float primitive(float z){z=clamp(z,0.,1.);return z*z*(3.-2.*z);}
float columnSegment(vec4 c,vec3 p,vec3 dir,float ds){
 if(c.y<.02||c.a<.001)return 0.;float thick=thickness(c),h=altitude(p),mu=max(.015,abs(dot(normalize(p+vec3(0.,0.,R)),dir)));
 float a=(c.x-h-ds*mu*.5)/thick,b=(c.x-h+ds*mu*.5)/thick;
 return c.y*c.a*(primitive(b)-primitive(a))/mu;
}
float segment(vec3 p,vec3 dir,float ds){float sum=0.;for(int k=0;k<3;k++)sum+=columnSegment(column(p,float(k)),p,dir,ds);return sum;}
float opticalDepth(vec3 p){
 float end=max(0.,sphere(p,sun,R+16.).y),tau=0.;
 for(int j=0;j<16;j++){float a=float(j)/16.,b=(float(j)+1.)/16.;float ds=end*(b*b-a*a);tau+=segment(p+sun*(end*(a*a+b*b)*.5),sun,ds);if(tau>14.)break;}
 return tau;
}
vec3 display(vec3 c){c=1.-exp(-c*exposure);return mix(c*12.92,1.055*pow(max(c,vec3(0.)),vec3(1./2.4))-.055,step(vec3(.0031308),c));}
void main(){
 vec2 xy=(gl_FragCoord.xy-.5*resolution)/resolution.y;vec3 ray=normalize(basis*vec3(xy,1.5));
 vec2 hit=sphere(eye,ray,R);float ground=hit.x>0.?hit.x:1.e5;
 vec3 color=vec3(.015,.035,.07);
 if(ground<1.e4){
  vec3 p=eye+ray*ground;vec3 n=normalize(p+vec3(0.,0.,R));float mu=max(0.,dot(n,sun));
  float shadow=exp(-opticalDepth(p));float glint=pow(max(0.,dot(n,normalize(sun-ray))),110.);
  color=vec3(.009,.037,.064)*(.25+.85*mu*shadow)+vec3(.3,.31,.29)*glint*shadow;
  vec2 uv=p.xy/extent+.5;
  if(all(greaterThanEqual(uv,vec2(0.)))&&all(lessThanEqual(uv,vec2(1.)))){
   float known=textureLod(qualityMap,uv,0.).r;
   // Missing retrievals remain visibly separate from confirmed clear water.
   if(known<.1){float hatch=step(.55,fract((p.x+p.y)*.08));color=mix(color,vec3(.045,.028,.055),.45+hatch*.1);}
  }
 }
 vec2 bounds=sphere(eye,ray,R+16.);float first=max(0.,bounds.x),last=min(ground,bounds.y);float trans=1.;vec3 sum=vec3(0.);
 if(bounds.y>0.&&last>first){
  float ds=(last-first)/112.;
  for(int i=0;i<112;i++){
   if(trans<.005)break;vec3 p=eye+ray*(first+(float(i)+.5)*ds);float optical=segment(p,ray,ds);if(optical<.0001)continue;
   float tau=opticalDepth(p),mu=max(0.,dot(normalize(p+vec3(0.,0.,R)),sun));
   vec3 sunlight=mix(vec3(1.,.59,.33),vec3(1.,.98,.94),smoothstep(.06,.45,mu));
   float forward=.15/pow(max(.15,1.49-1.4*dot(ray,sun)),1.5);
   // Resolved cloud-top slopes supply directional detail; no photographed shadows.
   float d=max(1.4,length(p-eye)/(resolution.y*1.5)),chosen=0.,best=0.;vec4 c=vec4(0.);
   for(int k=0;k<3;k++){vec4 candidate=column(p,float(k));float w=columnSegment(candidate,p,ray,ds);if(w>best){best=w;chosen=float(k);c=candidate;}}
   vec4 cx=column(p+vec3(d,0.,0.),chosen),cy=column(p+vec3(0.,d,0.),chosen);
   vec3 normal=normalize(vec3(-(cx.x-c.x)/d*step(.5,cx.a)*step(.02,cx.y),-(cy.x-c.x)/d*step(.5,cy.a)*step(.02,cy.y),1.));
   float facing=max(0.,dot(normal,sun));
   float reflectance=.42+.58*(1.-exp(-c.y*.09));
   vec3 light=(vec3(.09,.13,.20)+sunlight*(.95*exp(-tau)+.32*exp(-tau*.18))*(.35+.65*facing)*(.85+.15*forward))*reflectance;
   float alpha=1.-exp(-optical);sum+=trans*alpha*light;trans*=1.-alpha;
  }
 }
 color=color*trans+sum;
 float haze=ground<1.e4?1.-exp(-ground*.00015):0.;color=mix(color,vec3(.08,.15,.23),haze*.25);
 if(diagnostic>.5&&ground<1.e4){vec3 p=eye+ray*ground;vec3 groups=vec3(0.);float tau=0.,valid=0.;
  for(int k=0;k<3;k++){vec4 c=column(p,float(k));float amount=(1.-exp(-c.y*.15))*c.a;tau+=c.y*c.a;valid+=c.a;
   groups+=amount*(k==0?vec3(.15,.8,.55):k==1?vec3(.95,.66,.22):vec3(.67,.48,1.));}
  color=diagnostic<1.5?groups:vec3(1.-exp(-tau*.15));
  vec2 uv=p.xy/extent+.5;if(all(greaterThanEqual(uv,vec2(0.)))&&all(lessThanEqual(uv,vec2(1.)))&&textureLod(qualityMap,uv,0.).r<.1)color=vec3(.28,.12,.3);
 }
 fragColor=vec4(display(color),1.);
}`;
