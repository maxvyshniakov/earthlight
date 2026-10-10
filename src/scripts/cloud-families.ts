/** Regional cloud experiment. Positions and extinction are in km and km^-1.
 * Seed + absolute simulated minutes define the field; no frame-history state.
 * These are illustrative morphologies, not a numerical weather forecast.
 */
export const cloudFamilies = [
  {id:'stratus', name:'Низкий слой', description:'Связный покров, мягкий волнистый верх. Ветер переносит слой, крупные просветы меняются медленно.'},
  {id:'cells', name:'Морские ячейки', description:'Закрытые ячейки заполняют центр; открытые оставляют облачные стенки. Общий размер ячеек меняется внутри региона.'},
  {id:'cumulus', name:'Кучевые', description:'Раздельные облака с общей базой и округлыми верхушками. Каждый очаг растёт и распадается в своём ритме.'},
  {id:'front', name:'Дождевой фронт', description:'Протяжённый плотный слой с неровной верхней поверхностью и отдельной высокой вуалью. Верх тучи освещается тем же Солнцем.'},
  {id:'storm', name:'Грозовой комплекс', description:'Башни разного возраста, расширяющиеся наковальни и нижняя облачность. При распаде башни верхняя часть задерживается.'},
  {id:'cirrus', name:'Перистые над низкими', description:'Высокие волокна движутся быстрее нижних облаков. Сдвиг ветра растягивает хвосты; тени падают на нижний слой.'},
] as const;

export const cloudFamiliesShader = `
uniform float family, minutes, weatherSeed, openCells;
// Noise is evaluated in material coordinates; unresolved octaves tend to their
// mean, never to zero. No derivatives inside divergent view/shadow loops.
float weatherHash(vec3 p){
 p=fract(p*.1031);p+=dot(p,p.yzx+33.33);return fract((p.x+p.y)*p.z);
}
float weatherNoise(vec3 p){
 vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
 return mix(mix(mix(weatherHash(i),weatherHash(i+vec3(1,0,0)),f.x),
 mix(weatherHash(i+vec3(0,1,0)),weatherHash(i+vec3(1,1,0)),f.x),f.y),
 mix(mix(weatherHash(i+vec3(0,0,1)),weatherHash(i+vec3(1,0,1)),f.x),
 mix(weatherHash(i+vec3(0,1,1)),weatherHash(i+vec3(1,1,1)),f.x),f.y),f.z);
}
float weatherFiltered(vec3 p,float footprint){
 float fade=smoothstep(.35,1.2,footprint);
 if(fade>=1.)return .5;
 return mix(weatherNoise(p+vec3(weatherSeed*.137,17.,29.)),.5,fade);
}
float weather2(vec2 p,float scale,float footprint){
 return weatherFiltered(vec3(p/scale,3.7),footprint/scale);
}
vec2 cloudWind(float height){return vec2(.52,.17)+vec2(.052,-.028)*height;}
vec2 cloudMaterial(vec2 p,float height){return p-cloudWind(height)*minutes;}
// Nearest site, distance to its neighbour and stable site identity. Sites are
// jittered, and the low-frequency warp below removes a rectangular lattice.
vec3 cloudCell(vec2 p){
 vec2 cell=floor(p),local=fract(p);float a=10.,b=10.,id=0.;
 for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
  vec2 k=cell+vec2(float(x),float(y));
  float r=weatherHash(vec3(k,weatherSeed));
  vec2 site=vec2(float(x),float(y))+.05+.9*vec2(r,weatherHash(vec3(k,weatherSeed+23.)));
  float d=length(site-local);
  if(d<a){b=a;a=d;id=r;}else b=min(b,d);
 }
 return vec3(a,b,id);
}
vec2 weatherWarp(vec2 q,float scale,float amplitude,float footprint){
 return q+amplitude*(vec2(weather2(q,scale,footprint),weather2(q+71.,scale,footprint))-.5);
}
float cloudSlab(float h,float base,float top,float feather){
 return smoothstep(base,base+feather,h)*(1.-smoothstep(top-feather,top+feather,h));
}
float cloudLife(float id,float period){
 // The field is continuous across cycle boundaries, including negative times.
 float phase=fract(minutes/period+id);
 return smoothstep(.04,.28,phase)*(1.-smoothstep(.65,.98,phase));
}
float cloudPuffs(vec2 q,float h,float footprint){
 if(h<.9||h>6.6)return 0.;
 vec2 warped=weatherWarp(q,21.,11.,footprint);
 warped=weatherWarp(warped,4.5,1.7,footprint);
 vec3 cell=cloudCell(warped/9.);
 float life=cloudLife(cell.z,48.+cell.z*36.);
 float regional=weather2(q,55.,footprint);
 float growth=life*smoothstep(.23,.62,regional+.18*cell.z);
 float base=1.1+.22*weather2(q,30.,footprint);
 float top=base+.4+4.2*growth+.5*(weather2(q,2.8,footprint)-.5);
 float vertical=clamp((h-base)/max(.2,top-base),0.,1.);
 float radius=(.065+.24*sqrt(growth))*sqrt(max(0.,1.-pow(vertical*.97,2.)));
 float lumps=weatherFiltered(vec3(q/1.6,h/1.0),footprint/1.0)-.5;
 float edge=cell.x-radius+.18*lumps+.11*(weather2(q,3.8,footprint)-.5);
 float body=1.-smoothstep(-.07,.10+footprint/9.,edge);
 body*=smoothstep(0.,.055,cell.y-cell.x);
 return growth*body*cloudSlab(h,base,top,.28)*1.8;
}
// Overlapping cloud groups, without nearest-site ownership or cell clipping.
// The horizontal organization is sparse; resolved lobes belong to the volume.
float marineCumulus(vec2 q,float h,float footprint){
 if(h<.85 || h>6.4)return 0.;
 vec2 flow=weatherWarp(q,58.,12.,footprint);
 vec2 grid=floor(flow/16.);
 float region=weather2(flow,65.,footprint);
 float shape=0.;
 float billow=weatherFiltered(vec3(flow/1.9,h/1.6),footprint/1.6)-.5;
 float fine=weatherFiltered(vec3(flow/.65,h/.65),footprint/.65)-.5;
 for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
  vec2 cell=grid+vec2(float(x),float(y));
  float id=weatherHash(vec3(cell,weatherSeed));
  vec2 center=(cell+.12+.76*vec2(id,weatherHash(vec3(cell,weatherSeed+31.))))*16.;
  float life=cloudLife(id,95.+id*65.);
  float strength=life*smoothstep(.37,.69,region+.22*(id-.5));
  if(strength<.035)continue;
  float base=1.+.15*region;
  float height=1.+3.9*strength;
  float radius=1.7+3.4*sqrt(strength);
  vec2 delta=flow-center-vec2(.18,-.07)*(h-base);
  if(length(delta)>radius*2.2 || h>base+height*1.2)continue;
  // A broad base with several rising lobes; the same noise deforms the sides
  // and crown, rather than painting detail on a flat top.
  float vertical=(h-base)/height;
  float distance=length(vec3(delta/vec2(radius,radius*(.7+.45*id)),vertical));
  for(int l=0;l<3;l++){
   float r=weatherHash(vec3(cell,weatherSeed+float(l)*17.+72.));
   float angle=r*6.2831853+float(l)*2.1;
   vec2 offset=vec2(cos(angle),sin(angle))*radius*(.45+.55*r);
   float size=.45+.35*weatherHash(vec3(cell,weatherSeed+float(l)*19.+103.));
   float crown=.55+.50*r;
   float lobe=length(vec3((delta-offset)/(radius*size),vertical/crown));
   // Smooth union lets neighbouring billows merge, without a hard seam.
   float blend=max(.18-abs(distance-lobe),0.)/.18;
   distance=min(distance,lobe)-blend*blend*.045;
  }
  float edge=distance-1.+.24*billow+.09*fine;
  float body=1.-smoothstep(-.06,.09+footprint/radius,edge);
  shape=max(shape,body*smoothstep(base,base+.25,h)*strength);
 }
 return shape*2.8;
}
float cirrusFibres(vec2 high,float h,float footprint){
 if(h<8.3 || h>12.7)return 0.;
 float fall=clamp(11.8-h,0.,3.5);
 // Crystal trails extend from patchy heads; shear bends the path at different
 // heights. The envelope travels with the head, so fibres end with their cloud.
 float bend=weather2(high,85.,footprint)-.5;
 vec2 source=high-vec2(4.2,-1.8+5.*bend)*fall-vec2(.7,1.8*bend)*fall*fall;
 source=weatherWarp(source,38.,11.,footprint);
 float patch=weather2(source,48.,footprint);
 float heads=weather2(source,9.,footprint);
 float envelope=smoothstep(.46,.73,.45*patch+.55*heads);
 if(envelope<.002)return 0.;
 vec2 curl=weatherWarp(source,9.,3.8,footprint);
 curl.y+=2.5*(weather2(source,21.,footprint)-.5);
 float fibre=weather2(vec2(curl.x*.22,curl.y),1.3,footprint);
 float fine=weather2(vec2(curl.x*.30,curl.y),.48,footprint);
 float strands=smoothstep(.27,.73,.72*fibre+.28*fine);
 float plume=cloudSlab(h,8.5,11.7+.5*patch,.65);
 return envelope*(.08+.92*strands)*plume*.12*exp(-fall*.28);
}
float cloudFamilyDensity(vec3 p,float footprint){
 float h=p.z;if(h<.45||h>18.)return 0.;
 vec2 q=mat2(.8,.6,-.6,.8)*cloudMaterial(p.xy,2.);
 float density=0.;
 if(family<.5){
  if(h>3.4)return 0.;
  float broad=weather2(q,60.,footprint);
  float fold=weather2(q+vec2(0.,minutes*.025),13.,footprint);
  float top=1.75+.75*broad+.36*fold;
  float edge=broad+.20*(weather2(q,15.,footprint)-.5)+.08*(weather2(q,4.,footprint)-.5);
  float continuity=smoothstep(.18,.32,edge);
  // Small ripples move only the top, never drill through an overcast body.
  top+=.30*(weather2(q,2.5,footprint)-.5);
  density=continuity*cloudSlab(h,.7,top,.25)*1.25;
 }else if(family<1.5){
  if(h>3.7)return 0.;
  vec2 warp=weatherWarp(q,33.,16.,footprint);
  warp=weatherWarp(warp,3.5,2.6,footprint);
  vec3 cell=cloudCell(warp/12.);
  float gap=cell.y-cell.x;
  float fine=weather2(q,1.8,footprint);
  float wall=1.-smoothstep(.07,.22+footprint/12.,gap+.05*(fine-.5));
  float centre=.78+.22*smoothstep(.015,.16,gap);
  float shape=mix(centre,wall,openCells);
  float top=mix(2.05+.45*(1.-smoothstep(0.,.75,cell.x)),1.7+.95*wall,openCells);
  top+=.4*(fine-.5);
  float region=smoothstep(.18,.38,weather2(q,90.,footprint));
  density=region*shape*cloudSlab(h,.8,top,.24)*1.55;
 }else if(family<2.5){
  density=marineCumulus(q,h,footprint);
 }else if(family<3.5){
  vec2 front=vec2(q.x*.93+q.y*.37,-q.x*.37+q.y*.93);
  float bend=25.*(weather2(vec2(front.x,0.),95.,footprint)-.5);
  float band=exp(-pow((front.y-bend)/70.,2.));
  float broad=weather2(q,27.,footprint);
  float top=4.4+2.2*broad+.45*weather2(q,3.5,footprint);
  density=band*cloudSlab(h,.65,top,.6)*(.65+.65*broad);
  if(h>7.){
   vec2 high=mat2(.8,.6,-.6,.8)*cloudMaterial(p.xy,10.);
   float veil=weather2(vec2(high.x,high.y*4.),32.,footprint*4.);
   density+=cloudSlab(h,8.2,10.3,.7)*veil*band*.16;
  }
 }else if(family<4.5){
  // Bound each component before expensive shape noise. These are the same
  // fields as the reference integral, not a change in cloud/shadow quality.
  density=cloudPuffs(q+37.,h,footprint)*.08;
  float regional=smoothstep(.38,.65,weather2(q,110.,footprint));
  if(regional>0. && h<16.2){
   vec2 towerQ=q-vec2(.22,-.09)*max(0.,h-4.);
   vec3 cell=cloudCell(weatherWarp(towerQ,65.,7.,footprint)/32.);
   float selected=regional*smoothstep(.12,.38,cell.z);
   float phase=fract(minutes/(85.+cell.z*35.)+cell.z);
   float growth=smoothstep(.04,.34,phase)*(1.-smoothstep(.62,.88,phase));
   float top=3.+12.5*growth;
   if(selected>0. && growth>0. && h<top+.65 && cell.x<.30){
    float billow=weatherFiltered(vec3(towerQ/2.4,h/1.5),footprint/1.5)-.5;
    float radius=.12+.065*growth+.11*billow;
    density+=(1.-smoothstep(radius-.045,radius+.055,cell.x))
      *cloudSlab(h,1.1,top,.65)*growth*1.6*smoothstep(0.,.08,cell.y-cell.x)*selected;
   }
  }
  if(h>9.65 && h<15.45){
   vec2 anvilQ=q-vec2(1.3,-.55)*max(0.,h-5.);
   float selected=smoothstep(.38,.65,weather2(anvilQ,110.,footprint));
   if(selected>0.){
    vec3 cell=cloudCell(weatherWarp(anvilQ,65.,7.,footprint)/32.);
    selected*=smoothstep(.12,.38,cell.z);
    float phase=fract(minutes/(85.+cell.z*35.)+cell.z);
    float life=smoothstep(.24,.48,phase)*(1.-smoothstep(.80,1.,phase));
    if(selected>0. && life>0. && cell.x<.66){
     float top=11.8+2.6*cell.z+.65*(weather2(anvilQ,4.,footprint)-.5);
     vec2 towerQ=q-vec2(.22,-.09)*max(0.,h-4.);
     float billow=weatherFiltered(vec3(towerQ/2.4,h/1.5),footprint/1.5)-.5;
     float edgeNoise=.12*(weather2(anvilQ,3.5,footprint)-.5)+.08*billow;
     float spread=.12+.35*life;
     density+=(1.-smoothstep(spread-.12,spread+.07,cell.x+edgeNoise))
       *cloudSlab(h,top-1.5,top,.65)*life*.8*smoothstep(0.,.10,cell.y-cell.x)*selected;
    }
   }
  }
 }else{
  density=marineCumulus(q+vec2(28.,54.),h,footprint)*.7;
  vec2 high=mat2(.8,.6,-.6,.8)*cloudMaterial(p.xy,11.);
  density+=cirrusFibres(high,h,footprint);
 }
 return max(0.,density);
}
`;
