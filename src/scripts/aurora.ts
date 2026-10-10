import {halfFloatTarget,shaderLod,textureImage2D} from './webgl-context.ts';
import type {ShaderProgramBatch} from './shader-programs';
// WMM2025 degree-one coefficients, reduced to a centered dipole. The auroral
// weather below is a deterministic artistic preset, not a historical forecast.
// NOAA: https://library.oarcloud.noaa.gov/noaa_documents.lib/NESDIS/NCEI/WWM_Report_2025.pdf
export const magneticNorth=[1410.8,-4545.4,29351.8].map((v,_,a)=>v/Math.hypot(...a));

/** Conservative frustum test of spheres enclosing the two emitting caps. */
export function auroraInView(camera:number[],basis:number[],aspect:number){
 const outer=1+420/6371,center=outer*Math.cos(.76),radius=outer*Math.sin(.76);
 const tx=aspect/(2*1.25),ty=1/(2*1.25);
 for(const sign of [-1,1]){
  const p=magneticNorth.map((v,i)=>v*center*sign-camera[i]);
  const distance=Math.hypot(...p),eye=Math.hypot(...camera);
  if(eye>1&&distance>radius){
   const cosine=-p.reduce((sum,v,i)=>sum+v*camera[i],0)/(distance*eye);
   const angle=Math.acos(Math.max(-1,Math.min(1,cosine)));
   if(angle+Math.asin(radius/distance)<Math.asin(1/eye)&&distance-radius>Math.sqrt(eye*eye-1))continue;
  }
  const project=(offset:number)=>p.reduce((sum,v,i)=>sum+v*basis[offset+i],0);
  const x=project(0),y=project(3),z=project(6);
  if(z+radius>0&&Math.abs(x)<=z*tx+radius*Math.hypot(1,tx)&&Math.abs(y)<=z*ty+radius*Math.hypot(1,ty))return true;
 }
 return false;
}
export const AURORA_RADIANCE_RANGE=1;
const footprintShader=`precision highp float;
precision highp sampler2D;
float auroraNoise(vec2 p){
 vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
 vec4 q=fract(sin(vec4(dot(i,vec2(127.1,311.7)),dot(i+vec2(1.,0.),vec2(127.1,311.7)),
   dot(i+vec2(0.,1.),vec2(127.1,311.7)),dot(i+1.,vec2(127.1,311.7))))*43758.5453);
 return mix(mix(q.x,q.y,f.x),mix(q.z,q.w,f.x),f.y);
}
// A periodic, two-dimensional warp can turn a sheet back on itself. A latitude
// offset alone cannot make the hairpins and overlapping folds seen from orbit.
float arcLatitude(float az,float pole){
 vec2 q=vec2(cos(az),sin(az));
 return .445+(auroraNoise(q*5.+pole*11.)-.5)*.070
   +(auroraNoise(q*19.+pole*7.)-.5)*.020;
}
void main(){
 float azimuth=(gl_FragCoord.x/2048.-.5)*6.283185307;
 float pole=gl_FragCoord.y<512.?-1.:1.;
 float colat=.18+mod(gl_FragCoord.y,512.)/512.*.55;
 vec2 sheet=vec2(azimuth,colat);
 // Continuous shears at several scales create kinks and returning folds.
 // There are no repeated cells, rotation centres or prescribed spiral shapes.
 vec2 broadQ=vec2(cos(azimuth),sin(azimuth));
 sheet.x+=(auroraNoise(broadQ*7.+vec2(colat*24.,pole*13.))-.5)*.22;
 vec2 bentQ=vec2(cos(sheet.x),sin(sheet.x));
 sheet.y+=(auroraNoise(bentQ*12.+vec2(colat*33.,pole*31.))-.5)*.060;
 sheet.x+=(auroraNoise(bentQ*27.+vec2(sheet.y*55.,pole*41.))-.5)*.075;
 sheet.y+=(auroraNoise(broadQ*53.+vec2(sheet.y*91.,pole*7.))-.5)*.013;
 vec2 q=vec2(cos(sheet.x),sin(sheet.x));
 float fold=auroraNoise(q*31.+vec2(sheet.y*19.,pole*23.));
 // Fine pleats ride on the folded sheet, rather than disconnected noise blobs.
 float crease=(auroraNoise(q*115.+pole*29.)-.5)*.004;
 float crossArc=sheet.y-arcLatitude(sheet.x,pole)-crease;
 float secondary=auroraNoise(q*7.3+vec2(31.,pole*23.));
 float branch=smoothstep(.48,.76,auroraNoise(q*3.7+pole*43.));
 float secondOffset=crossArc-(.008+.030*secondary)*branch;
 float width=.0012+.0019*fold*fold;
 float first=exp(-pow(crossArc/width,2.));
 float second=exp(-pow(secondOffset/(width*1.2),2.));
 float patches=smoothstep(.22,.72,auroraNoise(q*11.+pole*19.));
 float sectors=smoothstep(.20,.65,auroraNoise(q*3.+vec2(pole*7.,29.)));
 float rays=auroraNoise(q*370.+vec2(pole*31.,0.));
 float bundles=auroraNoise(q*93.+vec2(0.,pole*17.));
 float striation=.18+2.6*pow(rays,3.)+.65*pow(bundles,4.);
 float curtains=(first*(.12+.9*patches*patches)
   +second*.36*branch*secondary)*(.18+.82*sectors)*striation;
 // A translucent body follows the same folded sheets. Its precipitation is
 // smoother than the fine rays, so the volume survives between bright ribs.
 // Keep this separate from the narrow edge instead of blurring that edge.
 float bodyWidth=.006+.004*fold;
 float bodyField=(exp(-pow(crossArc/bodyWidth,2.))*(.16+.60*patches)
   +exp(-pow(secondOffset/(bodyWidth*1.2),2.))*.22*branch*secondary)
   *(.15+.85*sectors)*(.65+.35*bundles);
 // Along-sheet variation remains coherent up the magnetic field lines.
 float altitude=.18+.55*auroraNoise(q*17.+pole*41.)+.20*rays;
 // Diffuse precipitation fills a broad band on the equatorward side of the
 // discrete oval (NASA Heliopedia: diffuse aurora). It is a separate source,
 // not a blur of the narrow sheets and not illumination of the ground/clouds.
 float diffuseOffset=colat-arcLatitude(azimuth,pole);
 float widthField=auroraNoise(broadQ*6.2+pole*17.);
 float diffuseWidth=.035+.075*widthField;
 float cloudWarp=auroraNoise(broadQ*14.+vec2(colat*18.,pole*9.));
 float diffuseBand=smoothstep(-.020,.015,diffuseOffset)
   *(1.-smoothstep(diffuseWidth*.50,diffuseWidth,diffuseOffset+(cloudWarp-.5)*.024));
 // Unequal diffuse patches and dark channels stay broad; fine rays belong to
 // the discrete sheet. Do not fill every longitude with the same green floor.
 float diffuseSectors=smoothstep(.24,.68,auroraNoise(broadQ*4.+vec2(pole*7.,29.)));
 float cloud=auroraNoise(broadQ*19.+vec2(colat*39.,pole*9.));
 float cloudDetail=auroraNoise(broadQ*47.+vec2(colat*83.,pole*3.));
 float diffuseCloud=.12+.88*smoothstep(.25,.74,cloud*.75+cloudDetail*.25);
 float diffuse=diffuseBand*(.10+.90*diffuseSectors)*diffuseCloud;
 vec4 field=vec4(curtains/4.,bodyField,altitude,diffuse);
 #ifdef AURORA_BYTE_TARGET
 float dither=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715))))-.5;
 field+=step(vec4(.000001),field)*dither/255.;
 #endif
 gl_FragColor=field;
}`;

export const auroraShader=`
uniform sampler2D auroraFootprint;
vec3 auroraDensity(vec3 point,float footprint,vec3 rayStep,out vec3 diffuse){
 diffuse=vec3(0.);
 float radius=length(point),height=(radius-1.)*6371.;
 if(height<85.||height>420.)return vec3(0.);
 const vec3 axis=vec3(${magneticNorth.join(',')});
 vec3 n=point/radius;
 float latitude=dot(n,axis),pole=sign(latitude);
 // Map each altitude along a dipolar field line to the 110 km footprint.
 float colat=asin(sqrt(clamp((1.-latitude*latitude)*(1.+110./6371.)/radius,0.,1.)));
 if(colat<.20||colat>.73)return vec3(0.);
 float night=1.-smoothstep(-.16,.04,dot(n,sunDirection));
 if(night<=0.)return vec3(0.);
 vec3 east=normalize(cross(vec3(0.,0.,1.),axis)),north=cross(axis,east);
 float azimuth=atan(dot(n,north),dot(n,east));
 // Slowly advect and fold the fixed emission field in magnetic coordinates.
 // Motion deforms whole field lines, so the upper/lower curtain stays joined.
 float drift=time*.000002;
 // Coherent travelling folds and precipitation waves evolve in simulated
 // seconds: playback rate speeds up shape AND brightness; pause freezes both.
 float activity=.5+.5*sin(azimuth*3.+1.7);
 float waveA=azimuth*9.-time*.045,waveB=azimuth*17.+time*.028;
 // Magnetic oval expands on the night side. Its displacement follows the
 // Sun, while the two hemispheres retain different precipitation patterns.
 float solarAzimuth=atan(dot(sunDirection,north),dot(sunDirection,east));
 float localTimeAngle=azimuth-solarAzimuth;
 float nightward=.035*cos(localTimeAngle);
 float bend=nightward+.002*sin(waveA)+activity*.004*sin(waveB);
 float activitySlope=1.5*cos(azimuth*3.+1.7);
 vec2 uv=vec2(azimuth/6.283185307+.5+drift,((colat+bend-.18)/.55+step(0.,pole))*.5);
 // Filter in atlas texels, not just latitude radians. Longitude texels get
 // narrower toward the pole; a ray step can cross several fine light rays.
 // The analytic Jacobian includes field-line inclination and animated folding.
 vec3 azimuthGradient=(north*dot(n,east)-east*dot(n,north))/(radius*max(.0001,1.-latitude*latitude));
 float fieldSin=sin(colat),fieldCos=cos(colat);
 vec3 colatGradient=(1.+110./6371.)*(-2.*latitude*axis+(3.*latitude*latitude-1.)*n)
   /(radius*radius*max(.0001,2.*fieldSin*fieldCos));
 float bendSlope=.018*cos(waveA)+activity*.068*cos(waveB)+activitySlope*.004*sin(waveB);
 vec3 uGradient=azimuthGradient*(2048./6.283185307);
 vec3 vGradient=(colatGradient+(bendSlope-.035*sin(localTimeAngle))*azimuthGradient)*(512./.55);
 float pixelTexels=footprint*max(length(uGradient),length(vGradient));
 float stepTexels=max(abs(dot(uGradient,rayStep)),abs(dot(vGradient,rayStep)));
 float lod=max(0.,log2(max(1.,max(pixelTexels,stepTexels))));
 #ifdef AURORA_LOD
 vec4 field=texture2DLodEXT(auroraFootprint,uv,lod);
 #else
 vec4 field=texture2D(auroraFootprint,uv,-16.);
 #endif
 if(max(max(field.r,field.g),field.a)<=0.)return vec3(0.);
 float precipitation=.65+.55*pow(.5+.5*sin(azimuth*13.-time*.065
   +.8*sin(azimuth*5.+time*.019)),2.);
 float curtains=field.r*4.*precipitation,bodyField=field.g*precipitation;
 // Precipitation varies along AND between folds. The lower edge is not one
 // spherical altitude, and red peak heights vary independently at larger scale.
 float upper=.5+.5*sin(azimuth*7.+pole*3.);
 float lower=99.+38.*smoothstep(.12,.88,field.b);
 float verticalStep=abs(dot(n,rayStep))*6371.;
 // The lower boundary also changes horizontally across a sample footprint.
 float heightFootprint=verticalStep+1.5*max(pixelTexels,stepTexels);
 float edgeWidth=max(2.5,heightFootprint*.5);
 float rise=smoothstep(lower-edgeWidth,lower+edgeWidth,height);
 float green=rise*exp(-pow(max(0.,height-lower)/(28.+90.*upper*upper),1.5))
   *(1.-smoothstep(240.,290.,height));
 // Soft body joins the fine rays above each discrete lower rim.
 float body=rise*exp(-pow(max(0.,height-lower)/(65.+35.*upper),1.5))
   *(1.-smoothstep(220.,285.,height));
 float coreWidth=sqrt(4.*4.+heightFootprint*heightFootprint/12.);
 float core=exp(-.5*pow((height-lower-4.)/coreWidth,2.))*4./coreWidth;
 float redCenter=245.+85.*upper;
 float red=exp(-.5*pow((height-redCenter)/(35.+25.*upper),2.));
 float violet=exp(-.5*pow((height-lower)/5.,2.))*.16;
 // Diffuse green self-emission has no sharp lower rim or discrete ray mask.
 // Smooth activity keeps the inter-arc field continuous through dim ray gaps.
 float diffuseHeight=smoothstep(95.,120.,height)*exp(-.5*pow((height-145.)/38.,2.))
   *(1.-smoothstep(220.,270.,height));
 float diffuseActivity=(.88+.12*sin(azimuth*3.-time*.008))
   *(.25+.75*smoothstep(-.2,.8,-cos(localTimeAngle)));
 float top=1.-smoothstep(360.,420.,height);
 float visibility=night*top*(1.-smoothstep(.715,.73,colat))*.0011;
 diffuse=(vec3(.10,1.,.26)*diffuseHeight*.16
   +vec3(1.,.018,.055)*red*.009)*field.a*diffuseActivity*visibility;
 return (vec3(.055,1.,.18)*(green*.9+core*1.8)*curtains
   +vec3(.10,1.,.26)*body*bodyField*.65
   +vec3(1.,.018,.055)*red*bodyField*.085
   +vec3(.38,.045,1.)*violet*curtains)*visibility;
}
vec3 auroraDensity(vec3 point,float footprint){
 vec3 diffuse;
 vec3 discrete=auroraDensity(point,footprint,vec3(0.),diffuse);
 return discrete+diffuse;
}
vec3 auroraIntegral(vec3 ray,float start,float end,float pixelAngle){
 if(end<=start)return vec3(0.);
 float stepLength=(end-start)/128.;
 vec3 light=vec3(0.);
 for(int i=0;i<128;i++){
  float distance=start+(float(i)+.5)*stepLength;
  float footprint=distance*pixelAngle;
  // A conservative coarse footprint finds the emitting sheets. Refine only
  // occupied intervals: thin lower edges need more samples than empty space.
  vec3 diffuse;
  vec3 coarse=auroraDensity(cameraPosition+ray*distance,footprint,ray*stepLength,diffuse);
  // The smooth diffuse field needs no eight-way refinement. Only sharp sheets
  // pay that cost; a wide luminous region must not multiply fragment work.
  light+=diffuse*stepLength*6371.;
  if(max(coarse.r,max(coarse.g,coarse.b))>0.){
   for(int j=0;j<8;j++){
    float fineDistance=distance+((float(j)+.5)/8.-.5)*stepLength;
    light+=auroraDensity(cameraPosition+ray*fineDistance,fineDistance*pixelAngle,
      ray*(stepLength/8.),diffuse)*(stepLength/8.)*6371.;
   }
  }
 }
 return light;
}
vec3 auroraSegment(vec3 ray,float start,float end,float pixelAngle){
 // The emitting oval fits inside two magnetic polar cones. Intersect these
 // before marching, rather than spending samples in empty equatorial space.
 const vec3 axis=vec3(${magneticNorth.join(',')});
 const float cap=.525; // Wider than the footprint: field lines lean with altitude
 float pa=dot(cameraPosition,axis),ra=dot(ray,axis);
 float a=ra*ra-cap,b=pa*ra-cap*dot(cameraPosition,ray);
 float c=pa*pa-cap*dot(cameraPosition,cameraPosition);
 // A conservative sunlit half-space also excludes fully invisible emission.
 float sunStart=dot(cameraPosition,sunDirection)-.043;
 float sunSlope=dot(ray,sunDirection);
 if(abs(sunSlope)<.00001){if(sunStart>0.)return vec3(0.);}
 else if(sunSlope>0.)end=min(end,-sunStart/sunSlope);
 else start=max(start,-sunStart/sunSlope);
 if(end<=start)return vec3(0.);
 if(abs(a)<.00001){
  if(abs(b)<.00001){if(c<0.)return vec3(0.);}
  else if(b>0.)start=max(start,-c/(2.*b));
  else end=min(end,-c/(2.*b));
  return auroraIntegral(ray,start,end,pixelAngle);
 }
 float d=b*b-a*c;
 if(d<0.)return a>0.?auroraIntegral(ray,start,end,pixelAngle):vec3(0.);
 float r0=(-b-sqrt(d))/a,r1=(-b+sqrt(d))/a;
 float low=min(r0,r1),high=max(r0,r1);
 if(a<0.)return auroraIntegral(ray,max(start,low),min(end,high),pixelAngle);
 return auroraIntegral(ray,start,min(end,low),pixelAngle)
   +auroraIntegral(ray,max(start,high),end,pixelAngle);
}
vec3 auroraEmission(vec3 ray,float pixelAngle){
 float b=dot(cameraPosition,ray),c=dot(cameraPosition,cameraPosition);
 const float outer=1.+420./6371.,inner=1.+85./6371.;
 float d=b*b-c+outer*outer;
 if(d<=0.)return vec3(0.);
 float start=max(0.,-b-sqrt(d)),end=-b+sqrt(d);
 float ground=b*b-c+1.;
 if(ground>0.&&b<0.)end=min(end,-b-sqrt(ground));
 if(end<=start)return vec3(0.);
 float hole=b*b-c+inner*inner,gap=sqrt(max(0.,hole));
 float nearEnd=hole>0.?min(end,-b-gap):end;
 float farStart=hole>0.?max(start,-b+gap):end;
 vec3 nearLight=auroraSegment(ray,start,nearEnd,pixelAngle);
 vec3 farLight=auroraSegment(ray,farStart,end,pixelAngle);
 float tangent=max(0.,(sqrt(max(0.,c-b*b))-1.)*6371.);
 float column=exp(-tangent/8.)*sqrt(6.283185307*8./6371.);
 return nearLight+farLight*exp(-vec3(36.9518,86.0085,210.8801)*column);
}
`;

const fragment=`precision highp float;
precision highp sampler2D;
uniform vec2 resolution;
uniform vec3 cameraPosition,sunDirection;
uniform mat3 cameraBasis;
uniform float time;
${auroraShader}
void main(){
 vec2 p=(gl_FragCoord.xy/resolution-.5)*vec2(resolution.x/resolution.y,1.);
 vec3 ray=normalize(cameraBasis*normalize(vec3(p,1.25)));
 // Half-float storage preserves smooth dim radiance before auto-exposure.
 // Keep the same square-root encoding on the dithered RGBA8 fallback.
 vec3 encoded=sqrt(clamp(auroraEmission(ray,1./(resolution.y*1.25))/${AURORA_RADIANCE_RANGE.toFixed(1)},0.,1.));
 #ifdef AURORA_BYTE_TARGET
 float dither=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715))))-.5;
 encoded+=step(vec3(.000001),encoded)*dither/255.;
 #endif
 gl_FragColor=vec4(encoded,1.);
}`;

/** Independent bounded-resolution emission pass. No asset download, history buffer
 * or frame jitter. The main scene composes it before the existing camera. */
export class Aurora {
 static targetType(gl:WebGLRenderingContext){
  return halfFloatTarget(gl,true)??gl.UNSIGNED_BYTE;
 }
 static sources(gl:WebGLRenderingContext){
  const storageHeader=Aurora.targetType(gl)===gl.UNSIGNED_BYTE?'#define AURORA_BYTE_TARGET 1\n':'';
  const header=shaderLod(gl)?'#extension GL_EXT_shader_texture_lod : enable\n#define AURORA_LOD 1\n':'';
  return {vertex:'attribute vec2 position;void main(){gl_Position=vec4(position,0.,1.);}',volume:header+storageHeader+fragment,field:storageHeader+footprintShader};
 }
 static prepare(gl:WebGLRenderingContext,batch:ShaderProgramBatch){
  const source=Aurora.sources(gl);
  return {batch,program:batch.add('Aurora volume',source.vertex,source.volume),fieldProgram:batch.add('Aurora footprint',source.vertex,source.field)};
 }
 private program:WebGLProgram|null=null;
 private buffer:WebGLBuffer|null=null;
 private target:WebGLFramebuffer|null=null;
 private fieldProgram:WebGLProgram|null=null;
 private fieldTarget:WebGLFramebuffer|null=null;
 private fieldTexture:WebGLTexture|null=null;
 private fieldPosition=0;
 private fieldReady=false;
 private empty=false;
 texture:WebGLTexture|null=null;
 private size=[0,0];
 private pixelType:number;
 private position=0;
 private uniforms:Record<string,WebGLUniformLocation|null>={};
 private gl:WebGLRenderingContext;
 constructor(gl:WebGLRenderingContext,prepared?:ReturnType<typeof Aurora.prepare>){
  this.gl=gl;
  this.pixelType=Aurora.targetType(gl);
  const shaders:WebGLShader[]=[];
  try{
   this.program=prepared?prepared.batch.take(prepared.program):gl.createProgram();this.buffer=gl.createBuffer();this.texture=gl.createTexture();this.target=gl.createFramebuffer();
   if(!this.program||!this.buffer||!this.texture||!this.target)throw Error('Cannot allocate aurora');
   if(!prepared){
    const sources=Aurora.sources(gl);
    for(const [type,source] of [[gl.VERTEX_SHADER,sources.vertex],[gl.FRAGMENT_SHADER,sources.volume]] as const){
     const shader=gl.createShader(type);if(!shader)throw Error('Cannot allocate aurora shader');
     shaders.push(shader);gl.shaderSource(shader,source);gl.compileShader(shader);
     if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(shader)??'Aurora compilation failed');
     gl.attachShader(this.program,shader);
    }
    gl.linkProgram(this.program);if(!gl.getProgramParameter(this.program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(this.program)??'Aurora link failed');
   }
   gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
   this.position=gl.getAttribLocation(this.program,'position');
   for(const name of ['resolution','cameraPosition','cameraBasis','sunDirection','time'])this.uniforms[name]=gl.getUniformLocation(this.program,name);
   gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.texture);
   for(const axis of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,axis,gl.CLAMP_TO_EDGE);
   for(const filter of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,filter,gl.LINEAR);
   this.fieldProgram=prepared?prepared.batch.take(prepared.fieldProgram):gl.createProgram();this.fieldTarget=gl.createFramebuffer();this.fieldTexture=gl.createTexture();
   if(!this.fieldProgram||!this.fieldTarget||!this.fieldTexture)throw Error('Cannot allocate auroral footprint');
   if(!prepared){
    const fieldShader=gl.createShader(gl.FRAGMENT_SHADER);if(!fieldShader)throw Error('Cannot allocate footprint shader');
    shaders.push(fieldShader);gl.shaderSource(fieldShader,Aurora.sources(gl).field);gl.compileShader(fieldShader);
    if(!gl.getShaderParameter(fieldShader,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(fieldShader)??'Footprint compilation failed');
    gl.attachShader(this.fieldProgram,shaders[0]);gl.attachShader(this.fieldProgram,fieldShader);gl.linkProgram(this.fieldProgram);
    if(!gl.getProgramParameter(this.fieldProgram,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(this.fieldProgram)??'Footprint link failed');
   }
   this.fieldPosition=gl.getAttribLocation(this.fieldProgram,'position');
   gl.bindTexture(gl.TEXTURE_2D,this.fieldTexture);textureImage2D(gl,gl.TEXTURE_2D,0,gl.RGBA,2048,1024,0,gl.RGBA,this.pixelType,null);
   gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
   gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);
   gl.bindFramebuffer(gl.FRAMEBUFFER,this.fieldTarget);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.fieldTexture,0);
   if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Incomplete footprint target');
  }catch(error){this.dispose();throw error;}finally{for(const shader of shaders)gl.deleteShader(shader);}
 }
 render(width:number,height:number,camera:number[],basis:number[],sun:number[],time:number){
  // Preserve resolved rays near the horizon too. Small drawing buffers keep a
  // bounded mobile budget; the main renderer can still lower its own scale.
  const budget=280000;
  const gl=this.gl,scale=Math.min(.5,Math.sqrt(budget/(width*height)));
  const w=Math.max(1,Math.round(width*scale)),h=Math.max(1,Math.round(height*scale));
  gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.bindFramebuffer(gl.FRAMEBUFFER,this.target);
  if(w!==this.size[0]||h!==this.size[1]){
   textureImage2D(gl,gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,this.pixelType,null);
   gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.texture,0);
   if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Incomplete aurora target');
   this.size=[w,h];
   this.empty=false;
  }
  if(!auroraInView(camera,basis,width/height)){
   if(!this.empty){gl.clearColor(0,0,0,1);gl.clear(gl.COLOR_BUFFER_BIT);this.empty=true;}
   gl.viewport(0,0,w,h);return;
  }
  this.empty=false;
  if(!this.fieldReady){
   gl.bindFramebuffer(gl.FRAMEBUFFER,this.fieldTarget);gl.viewport(0,0,2048,1024);gl.useProgram(this.fieldProgram);
   gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);
   gl.enableVertexAttribArray(this.fieldPosition);gl.vertexAttribPointer(this.fieldPosition,2,gl.FLOAT,false,0,0);
   gl.drawArrays(gl.TRIANGLES,0,3);
   gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.fieldTexture);gl.generateMipmap(gl.TEXTURE_2D);
   this.fieldReady=true;
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER,this.target);
  gl.viewport(0,0,w,h);gl.useProgram(this.program);
  gl.bindTexture(gl.TEXTURE_2D,this.fieldTexture);
  gl.uniform2f(this.uniforms.resolution,w,h);gl.uniform3fv(this.uniforms.cameraPosition,camera);
  gl.uniformMatrix3fv(this.uniforms.cameraBasis,false,basis);gl.uniform3fv(this.uniforms.sunDirection,sun);gl.uniform1f(this.uniforms.time,time);
  gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.enableVertexAttribArray(this.position);gl.vertexAttribPointer(this.position,2,gl.FLOAT,false,0,0);
  gl.drawArrays(gl.TRIANGLES,0,3);
 }
 dispose(){const gl=this.gl;if(this.program)gl.deleteProgram(this.program);if(this.buffer)gl.deleteBuffer(this.buffer);if(this.texture)gl.deleteTexture(this.texture);if(this.target)gl.deleteFramebuffer(this.target);if(this.fieldProgram)gl.deleteProgram(this.fieldProgram);if(this.fieldTexture)gl.deleteTexture(this.fieldTexture);if(this.fieldTarget)gl.deleteFramebuffer(this.fieldTarget);}
}
