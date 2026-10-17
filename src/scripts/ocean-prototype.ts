import {sceneShadersFor,vertexSource} from './scene-shader';
import type {NightMode} from './physical-night';
import {ShaderProgramBatch} from './shader-programs';
import {shaderLod,textureImage2D} from './webgl-context';

export type OceanPrototype='regions'|'fronts'|'combined'|'advected';
export function oceanPrototype(params:URLSearchParams):OceanPrototype|null {
 const value=params.get('ocean');
 return value==='regions'||value==='fronts'||value==='combined'||value==='advected'?value:null;
}

// Synthetic sea state, fixed to the globe. This models neither observed weather
// nor current velocities. All expensive structure is evaluated once in a bake.
const field=`
float seaNoise(vec3 p){
 // Rotate and combine octaves before shaping thresholds, so the contours do
 // not expose the axis-aligned cells of value noise.
 vec3 q=mat3(.80,-.48,.36,.60,.64,-.48,0.,.60,.80)*p;
 return .68*noise(q)+.32*noise(q*1.93+vec3(11.,3.,7.));
}
vec4 oceanState(vec3 n){
 float broad=noise(n*17.);
 float heading=6.2831853*noise(n*8.+vec3(3.,7.,11.));
 vec3 warp=vec3(noise(n*31.+vec3(8.,2.,5.)),noise(n*31.+vec3(3.,9.,1.)),noise(n*31.+vec3(1.,4.,7.)))-.5;
 vec3 q=n*38.+warp*1.8;
 float basin=seaNoise(q*.6+vec3(7.,3.,12.));
 float calm=1.-smoothstep(.33,.53,basin);
 // Elongated calm corridors. No thin isocontours or repeated wave rings.
 vec3 flow=vec3(dot(n,vec3(.8,.3,.52))*12.,dot(n,vec3(-.35,.936,0.))*75.,dot(n,vec3(-.49,-.18,.85))*25.);
 float ribbons=1.-smoothstep(.36,.55,seaNoise(flow+warp*.55));
 float envelope=smoothstep(.3,.65,noise(n*23.+vec3(7.,1.,4.)));
#if OCEAN_STYLE == 1
 float smoothWater=calm*.92;
#elif OCEAN_STYLE == 2
 float smoothWater=ribbons*envelope*.96;
#else
 float smoothWater=max(calm*.78,ribbons*(.35+.65*envelope));
#endif
 float wind=mix(4.+7.*broad,.45+1.2*broad,smoothWater);
 return vec4(wind/16.,.5+.5*cos(2.*heading),.5+.5*sin(2.*heading),1.);
}
`;

// Periodic gradient noise with analytical derivatives. Quintic interpolation
// keeps the transport velocity continuous across lattice boundaries.
const transportedField=`
vec2 seaGradient(vec2 cell,vec2 period){
 float a=6.2831853*latticeHash(mod(cell,period));
 return vec2(cos(a),sin(a));
}
vec3 seaPotential(vec2 p,float frequency){
 vec2 x=p*frequency,cell=floor(x),f=fract(x),period=vec2(2.,1.)*frequency;
 vec2 a=seaGradient(cell,period),b=seaGradient(cell+vec2(1.,0.),period);
 vec2 c=seaGradient(cell+vec2(0.,1.),period),d=seaGradient(cell+vec2(1.),period);
 float va=dot(a,f),vb=dot(b,f-vec2(1.,0.)),vc=dot(c,f-vec2(0.,1.)),vd=dot(d,f-1.);
 vec2 u=f*f*f*(f*(f*6.-15.)+10.),du=30.*f*f*(f-1.)*(f-1.);
 float v=mix(mix(va,vb,u.x),mix(vc,vd,u.x),u.y);
 vec2 grad=mix(mix(a,b,u.x),mix(c,d,u.x),u.y);
 grad+=du*vec2(mix(vb-va,vd-vc,u.y),mix(vc-va,vd-vb,u.x));
 return vec3(v,grad);
}
vec2 seaTransport(vec2 p){
 vec2 g=seaPotential(p+vec2(.17,.31),18.).yz;
 g+=.4*seaPotential(p+vec2(.61,.11),46.).yz;
 return vec2(g.y,-g.x);
}
vec4 transportedState(vec2 uv){
 vec2 p=uv*vec2(2.,1.),q=p;
 // Backtrace a passive scalar through a smooth incompressible field. Stretch
 // existing areas rather than drawing parallel ridges or vortex primitives.
 for(int i=0;i<20;i++){
  vec2 shift=vec2(.00035,.00055)*float(i);
  vec2 v=seaTransport(q+shift);
  q-=.00075*seaTransport(q-.000375*v+shift);
 }
 // Regional shelter dominates. Transported small structures have much less
 // contrast than the few calm patches, as in the orbital photographs.
 float region=seaPotential(p+vec2(.7,.1),5.).x;
 float calmSeed=seaPotential(q+vec2(.43,.12),28.).x;
 calmSeed+=.12*seaPotential(q+vec2(.21,.83),86.).x;
 float softness=mix(.18,.42,smoothstep(-.25,.25,seaPotential(p,7.).x));
 float availability=smoothstep(-.12,.24,seaPotential(p+vec2(.31,.67),3.).x);
 float calm=smoothstep(.08,softness+.12,calmSeed)*availability;
 float fine=.55*seaPotential(q+vec2(.19,.72),101.).x
  +.30*seaPotential(q+vec2(.53,.08),193.).x
  +.15*seaPotential(q+vec2(.89,.42),293.).x;
 float wind=mix(6.1+3.8*region,1.4+.5*region,calm*.9);
 wind+=1.35*fine*(1.-.65*calm);
 float heading=3.14159265*seaPotential(p,4.).x;
 return vec4(wind/16.,.5+.5*cos(2.*heading),.5+.5*sin(2.*heading),1.);
}
`;

/** Replace only sea statistics. Keep Cox-Munk, Fresnel, masking and illumination. */
export function oceanPrototypeSource(source:string){
 source=source.replace('void oceanSurface(', 'uniform sampler2D oceanField;\nuniform float oceanFieldWidth;\nuniform float oceanFieldRepeats;\nvoid oceanSurface(');
 const start=source.indexOf(' float weather=waterField(');
 const end=source.indexOf(' along=east*cos(',start);
 if(start<0||end<0)throw Error('Ocean reflection signature changed');
 return source.slice(0,start)+`
 vec2 uv=earthUV(n)*oceanFieldRepeats;
 float latitudeScale=max(.02,sqrt(max(0.,1.-n.z*n.z)));
 float lod=max(0.,log2(max(1.,footprint*oceanFieldWidth*oceanFieldRepeats/(6.2831853*latitudeScale))));
#ifdef CLOUD_EXPLICIT_LOD
 vec3 sea=texture2DLodEXT(oceanField,uv,lod).rgb;
#else
 vec3 sea=texture2D(oceanField,uv,lod).rgb;
#endif
 float wind=max(.35,sea.r*16.);
 vec3 east=normalize(cross(abs(n.z)<.98?vec3(0.,0.,1.):vec3(0.,1.,0.),n));
 vec3 north=cross(n,east);
 float heading=.5*atan(sea.b*2.-1.,sea.g*2.-1.);
`+source.slice(end);
}

export class OceanField {
 readonly texture:WebGLTexture;
 readonly bytes:number;
 private bindings=new Map<WebGLProgram,WebGLUniformLocation|null>();
 static supported(gl:WebGLRenderingContext){return gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS)>14&&gl.getParameter(gl.MAX_TEXTURE_SIZE)>=2048&&!!shaderLod(gl);}
 static prepare(batch:ShaderProgramBatch,mode:OceanPrototype,night:NightMode){
  const {fragmentSource}=sceneShadersFor(night);
  const header=`#define OCEAN_STYLE ${['regions','fronts','combined','advected'].indexOf(mode)+1}\n`;
  const source=fragmentSource.slice(0,fragmentSource.indexOf('void main()'))+(mode==='advected'?transportedField:field)+`
uniform vec2 oceanBakeSize;
void main(){
 vec2 uv=gl_FragCoord.xy/oceanBakeSize;
#if OCEAN_STYLE == 4
 gl_FragColor=transportedState(uv);
#else
 float lon=(uv.x-.5)*6.2831853,lat=(uv.y-.5)*3.141592654;
#if OCEAN_STYLE == 1
 vec3 n=vec3(cos(lat)*cos(lon),cos(lat)*sin(lon),sin(lat));
#else
 // A seamless periodic material tile concentrates texels on smaller features.
 // Repetition is about 10000 km by 5000 km at the equator, not observed weather.
 vec3 n=vec3(cos(lon)*(.7+.3*cos(lat*2.)),sin(lon)*(.7+.3*cos(lat*2.)),.3*sin(lat*2.));
#endif
 gl_FragColor=oceanState(n);
#endif
}`;
  return batch.add('Ocean sea-state bake',vertexSource,header+source);
 }
 constructor(private gl:WebGLRenderingContext,program:WebGLProgram,readonly width=2048,private repeats=1){
  const texture=gl.createTexture(),target=gl.createFramebuffer();
  if(!texture||!target){if(texture)gl.deleteTexture(texture);if(target)gl.deleteFramebuffer(target);gl.deleteProgram(program);throw Error('Cannot allocate ocean field');}
  this.texture=texture;let bytes=0;
  for(let w=width,h=width/2;;w=Math.max(1,w/2),h=Math.max(1,h/2)){bytes+=w*h*4;if(w===1&&h===1)break;}
  this.bytes=bytes;
  const oldProgram=gl.getParameter(gl.CURRENT_PROGRAM),oldTarget=gl.getParameter(gl.FRAMEBUFFER_BINDING),viewport=gl.getParameter(gl.VIEWPORT);
  const active=gl.getParameter(gl.ACTIVE_TEXTURE);gl.activeTexture(gl.TEXTURE14);
  const oldTexture=gl.getParameter(gl.TEXTURE_BINDING_2D),dither=gl.isEnabled(gl.DITHER);
  try{
   gl.bindTexture(gl.TEXTURE_2D,texture);
   textureImage2D(gl,gl.TEXTURE_2D,0,gl.RGBA,width,width/2,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
   gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,repeats>1?gl.REPEAT:gl.CLAMP_TO_EDGE);
   gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);
   gl.bindFramebuffer(gl.FRAMEBUFFER,target);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
   if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Ocean field framebuffer incomplete');
   gl.useProgram(program);gl.uniform2f(gl.getUniformLocation(program,'oceanBakeSize'),width,width/2);
   const position=gl.getAttribLocation(program,'position');gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
   gl.viewport(0,0,width,width/2);gl.disable(gl.DITHER);gl.drawArrays(gl.TRIANGLES,0,3);
   gl.bindFramebuffer(gl.FRAMEBUFFER,oldTarget);gl.generateMipmap(gl.TEXTURE_2D);
  }catch(error){gl.deleteTexture(texture);throw error;}
  finally{
   if(dither)gl.enable(gl.DITHER);gl.deleteFramebuffer(target);gl.deleteProgram(program);
   gl.bindFramebuffer(gl.FRAMEBUFFER,oldTarget);gl.viewport(viewport[0],viewport[1],viewport[2],viewport[3]);
   gl.bindTexture(gl.TEXTURE_2D,oldTexture);gl.activeTexture(active);gl.useProgram(oldProgram);
  }
 }
 bind(program:WebGLProgram){
  const gl=this.gl;
  if(!this.bindings.has(program)){this.bindings.set(program,gl.getUniformLocation(program,'oceanField'));gl.uniform1f(gl.getUniformLocation(program,'oceanFieldWidth'),this.width);gl.uniform1f(gl.getUniformLocation(program,'oceanFieldRepeats'),this.repeats);}
  gl.activeTexture(gl.TEXTURE14);gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.uniform1i(this.bindings.get(program)!,14);
 }
 dispose(){this.gl.deleteTexture(this.texture);this.bindings.clear();}
}
