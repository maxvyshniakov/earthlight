import {textureImage2D,drawBuffersApi,halfFloatTarget} from './webgl-context.ts';
import {PRE_EXPOSURE,PRE_EXPOSED_MAX} from './pre-exposure';

// Pre-exposure: fresh radiance is stored at its frame's exposure, and the EV
// rides in the depth target's z (whole eighths) and w (the rest), exact in
// half floats. The resolve brings the previous frame's columns to this one's.
const freshExposure=PRE_EXPOSURE?`min(scattered*sceneExposure(),vec3(${PRE_EXPOSED_MAX}.))`:'scattered';
const freshEV=PRE_EXPOSURE?'floor(log2(sceneExposure())*8.)/8.,fract(log2(sceneExposure())*8.)':'0.,1.';
const historyRescale=PRE_EXPOSURE?`
  vec4 nowEV=texture2D(freshDepth,vec2(.5)),thenEV=texture2D(historyDepth,vec2(.5));
  vec4 rescale=vec4(vec3(exp2(nowEV.z-thenEV.z+(nowEV.w-thenEV.w)/8.)),1.);`:'';

// Column-interleaved clouds. Each frame integrates every other full-resolution
// column into a dense half-width target, so fragment work really halves. A
// resolve pass rebuilds the full image: computed columns are copied exactly,
// the others reproject the previous frame's computed columns, never its
// reconstructed ones, so errors cannot accumulate. Moving or changing content
// clamps that history to the range its freshly computed neighbours span, so
// stale clouds cannot trail behind. A still, unchanged view reuses it exactly.
export const TEMPORAL_FRESH_UNITS=[3,8],TEMPORAL_HISTORY_UNITS=[6,13],TEMPORAL_PREVIOUS_UNIT=5,TEMPORAL_RESOLVED_UNITS=[3,8];

/** Cloud integral for this frame's columns; same encoding as the half-resolution path. */
export const temporalCloudMain=`
uniform sampler2D worldScene;
uniform float cloudParity;
void main(){
  float column=min(floor(gl_FragCoord.x)*2.+cloudParity,resolution.x-1.);
  vec2 uv=vec2(column+.5,gl_FragCoord.y)/resolution;
  vec3 ray=normalize(cameraBasis*normalize(vec3((uv-.5)*vec2(resolution.x/resolution.y,1.),FOCAL)));
  vec4 world=texture2D(worldScene,uv);
  float b=dot(cameraPosition,ray),c=dot(cameraPosition,cameraPosition);
  float groundDistance=world.a< -1.?-1.:-b-sqrt(max(0.,b*b-c+1.))+world.a;
  float transmission=1.,atmosphereDistance=groundDistance;
  vec3 scattered=vec3(0.);
  if(mapsReady*surfaceEnabled>.5)scattered=cloudIntegral(ray,groundDistance,transmission,atmosphereDistance);
  float entry=max(0.,-b-sqrt(max(0.,b*b-c+1.0018835*1.0018835)));
  float depth=groundDistance>0.?atmosphereDistance-groundDistance:
    (transmission<.999?(atmosphereDistance-entry)*(1.-transmission):0.);
  gl_FragData[0]=vec4(${freshExposure},transmission);
  gl_FragData[1]=vec4(depth,world.a,${freshEV});
}
`;

const entryShader=`
float temporalCloudEntry(vec3 ray){
  float b=dot(cameraPosition,ray);
  return max(0.,-b-sqrt(max(0.,b*b-dot(cameraPosition,cameraPosition)+1.0018835*1.0018835)));
}`;

/** Full-resolution resolve: exact fresh columns, clamped reprojected history elsewhere. */
export const temporalResolveFragment=`#extension GL_EXT_draw_buffers : require
precision highp float;
uniform sampler2D freshRadiance,freshDepth,historyRadiance,historyDepth,previousResolved,worldScene;
uniform vec2 resolution,freshResolution;
uniform float cloudParity,historyValid,zoomExcess,previousFocal;
uniform vec3 cameraPosition,previousCamera;
uniform mat3 cameraBasis,previousBasis;
#define FOCAL (1.25*(1.+zoomExcess))
${entryShader}
vec2 freshUV(float column,float row){return vec2((floor((column-cloudParity)*.5)+.5)/freshResolution.x,row/freshResolution.y);}
void main(){
  vec2 pixel=floor(gl_FragCoord.xy),uv=gl_FragCoord.xy/resolution;
  if(mod(pixel.x-cloudParity,2.)<.5){
    gl_FragData[0]=texture2D(freshRadiance,freshUV(pixel.x,gl_FragCoord.y));
    gl_FragData[1]=texture2D(freshDepth,freshUV(pixel.x,gl_FragCoord.y));
    return;
  }
  float groundResidual=texture2D(worldScene,uv).a;
  bool ground=groundResidual> -1.;${historyRescale}
  // Bounds from the computed columns on either side, three rows each, and a
  // ground-aware interpolation of the two horizontal neighbours.
  vec4 low=vec4(1e9),high=vec4(-1e9),sum=vec4(0.),unweighted=vec4(0.);
  float depthSum=0.,weightSum=0.,count=0.,change=0.;
  for(int side=0;side<2;side++){
    float column=pixel.x+(side==0?-1.:1.);
    if(column<0.||column>resolution.x-1.)continue;
    for(int row=-1;row<=1;row++){
      vec2 at=freshUV(column,gl_FragCoord.y+float(row));
      vec4 light=texture2D(freshRadiance,at);
      low=min(low,light);high=max(high,light);
      if(row!=0)continue;
      vec4 meta=texture2D(freshDepth,at);
      float weight=1.;bool tapGround=meta.y> -1.;
      if(tapGround!=ground)weight=0.;
      if(tapGround&&ground)weight*=exp(-abs(meta.y-groundResidual)*6371./.5);
      sum+=light*weight;depthSum+=meta.x*weight;weightSum+=weight;unweighted+=light;count+=1.;
      // How much this neighbour changed since the last frame, in place.
      vec4 before=texture2D(previousResolved,(vec2(column,pixel.y)+.5)/resolution)${PRE_EXPOSURE?'*rescale':''};
      change=max(change,max(max(abs(light.r-before.r),abs(light.g-before.g)),max(abs(light.b-before.b),abs(light.a-before.a)))
        /(.02+.1*max(max(light.r,light.g),max(light.b,light.a))));
    }
  }
  vec4 result=weightSum>1e-4?sum/weightSum:unweighted/max(1.,count);
  float depth=weightSum>1e-4?depthSum/weightSum:0.;
  if(historyValid>.5){
    vec3 ray=normalize(cameraBasis*normalize(vec3((uv-.5)*vec2(resolution.x/resolution.y,1.),FOCAL)));
    float b=dot(cameraPosition,ray),c=dot(cameraPosition,cameraPosition);
    float groundDistance=ground?-b-sqrt(max(0.,b*b-c+1.))+groundResidual:-1.;
    float opacity=1.-result.a;
    float distance=groundDistance>0.?groundDistance+(opacity>.001?depth:0.)
      :temporalCloudEntry(ray)+(opacity>.001?depth/opacity:0.);
    vec3 d=cameraPosition+ray*max(distance,.0001)-previousCamera;
    vec3 v=vec3(dot(d,previousBasis[0]),dot(d,previousBasis[1]),dot(d,previousBasis[2]));
    if(v.z>.0001){
      vec2 previous=previousFocal*v.xy/v.z/vec2(resolution.x/resolution.y,1.)+.5;
      if(previous.x>=0.&&previous.y>=0.&&previous.x<=1.&&previous.y<=1.){
        // Last frame computed the other columns. Interpolate between them on
        // their own half-width lattice; a still view lands exactly on one.
        float column=(previous.x*resolution.x-.5-(1.-cloudParity))*.5;
        vec2 at=vec2((column+.5)/freshResolution.x,previous.y);
        vec4 history=texture2D(historyRadiance,at)${PRE_EXPOSURE?'*rescale':''},historyMeta=texture2D(historyDepth,at);
        if((historyMeta.y> -1.)==ground){
          float moved=length((previous-uv)*resolution);
          // Exact reuse only when nothing moved and the neighbours did not change.
          float clampAmount=max(smoothstep(.05,.35,moved),smoothstep(.5,1.,change));
          result=mix(history,clamp(history,low,high),clampAmount);
          depth=historyMeta.x;
        }
      }
    }
  }
  gl_FragData[0]=result;
  gl_FragData[1]=vec4(depth,groundResidual,0.,1.);
}
`;

/** Composite: read the resolved cloud result instead of integrating it. */
export const temporalCompositeShader=`
uniform sampler2D temporalRadiance,temporalDepth;
${entryShader}
vec3 temporalClouds(vec2 uv,vec3 ray,float groundDistance,vec3 background,out float atmosphereDistance){
  vec4 light=texture2D(temporalRadiance,uv);
  float depth=texture2D(temporalDepth,uv).x,opacity=1.-light.a;
  atmosphereDistance=groundDistance;
  if(opacity>.001)atmosphereDistance=groundDistance>0.?groundDistance+depth:temporalCloudEntry(ray)+depth/opacity;
  return max(vec3(0.),background*light.a+light.rgb${PRE_EXPOSURE?'/sceneExposure()':''});
}
`;

type Target={framebuffer:WebGLFramebuffer;textures:WebGLTexture[]};
/** A half-width fresh target and two full-resolution resolved targets. */
export class TemporalClouds {
  private fresh:Target[]=[];
  private resolved:Target[]=[];
  private width=0;private height=0;
  private current=0;
  parity=0;
  historyValid=false;
  private drawBuffers:WEBGL_draw_buffers;
  private pixelType:number;
  static supported(gl:WebGLRenderingContext){
    const mrt=drawBuffersApi(gl);
    return !!mrt&&gl.getParameter(mrt.MAX_DRAW_BUFFERS_WEBGL)>=2&&gl.getParameter(mrt.MAX_COLOR_ATTACHMENTS_WEBGL)>=2
      &&gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS)>15&&halfFloatTarget(gl)!==null;
  }
  constructor(private gl:WebGLRenderingContext){
    this.drawBuffers=drawBuffersApi(gl)!;this.pixelType=halfFloatTarget(gl)!;
    try{this.fresh=[this.target(true),this.target(true)];this.resolved=[this.target(false),this.target(false)];this.allocate(2,2);}
    catch(error){this.dispose();throw error;}
    finally{gl.bindFramebuffer(gl.FRAMEBUFFER,null);}
  }
  private target(interpolated:boolean):Target{
    const gl=this.gl,framebuffer=gl.createFramebuffer();if(!framebuffer)throw Error('Cannot allocate temporal clouds');
    // Computed radiance is resampled between columns when reprojected; depth
    // metadata (including the sky sentinel) must never be blended.
    const linear=interpolated&&halfFloatTarget(this.gl,true)!==null;
    const textures=[0,1].map(index=>{
      const texture=gl.createTexture();if(!texture)throw Error('Cannot allocate temporal clouds');
      gl.activeTexture(gl.TEXTURE6);gl.bindTexture(gl.TEXTURE_2D,texture);
      for(const axis of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,axis,gl.CLAMP_TO_EDGE);
      for(const filter of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,filter,linear&&index===0?gl.LINEAR:gl.NEAREST);
      return texture;
    });
    return {framebuffer,textures};
  }
  private attach(target:Target,width:number,height:number){
    const gl=this.gl;gl.bindFramebuffer(gl.FRAMEBUFFER,target.framebuffer);
    target.textures.forEach((texture,index)=>{
      gl.activeTexture(gl.TEXTURE6);gl.bindTexture(gl.TEXTURE_2D,texture);
      textureImage2D(gl,gl.TEXTURE_2D,0,gl.RGBA,width,height,0,gl.RGBA,this.pixelType,null);
      gl.framebufferTexture2D(gl.FRAMEBUFFER,this.drawBuffers.COLOR_ATTACHMENT0_WEBGL+index,gl.TEXTURE_2D,texture,0);
    });
    this.drawBuffers.drawBuffersWEBGL([this.drawBuffers.COLOR_ATTACHMENT0_WEBGL,this.drawBuffers.COLOR_ATTACHMENT1_WEBGL]);
    if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Incomplete temporal cloud target');
  }
  private allocate(width:number,height:number){
    if(width===this.width&&height===this.height)return;
    for(const target of this.fresh)this.attach(target,Math.ceil(width/2),height);
    for(const target of this.resolved)this.attach(target,width,height);
    this.width=width;this.height=height;this.historyValid=false;
  }
  /** Bind the half-width target for this frame's columns. */
  beginFresh(width:number,height:number){
    const gl=this.gl;this.allocate(width,height);
    gl.bindFramebuffer(gl.FRAMEBUFFER,this.fresh[this.current].framebuffer);gl.viewport(0,0,Math.ceil(width/2),height);
    return [Math.ceil(width/2),height] as const;
  }
  /** Bind the resolved target and the fresh/history inputs on their units. */
  beginResolve(){
    const gl=this.gl,history=this.fresh[1-this.current];
    this.fresh[this.current].textures.forEach((texture,i)=>{gl.activeTexture(gl.TEXTURE0+TEMPORAL_FRESH_UNITS[i]);gl.bindTexture(gl.TEXTURE_2D,texture);});
    history.textures.forEach((texture,i)=>{gl.activeTexture(gl.TEXTURE0+TEMPORAL_HISTORY_UNITS[i]);gl.bindTexture(gl.TEXTURE_2D,texture);});
    gl.activeTexture(gl.TEXTURE0+TEMPORAL_PREVIOUS_UNIT);gl.bindTexture(gl.TEXTURE_2D,this.resolved[1-this.current].textures[0]);
    gl.bindFramebuffer(gl.FRAMEBUFFER,this.resolved[this.current].framebuffer);gl.viewport(0,0,this.width,this.height);
  }
  bindResolved(){
    const gl=this.gl;
    this.resolved[this.current].textures.forEach((texture,i)=>{gl.activeTexture(gl.TEXTURE0+TEMPORAL_RESOLVED_UNITS[i]);gl.bindTexture(gl.TEXTURE_2D,texture);});
  }
  /** The resolved image becomes next frame's history; the other columns go next. */
  advance(){this.current=1-this.current;this.parity=1-this.parity;this.historyValid=true;}
  invalidate(){this.historyValid=false;}
  dispose(){
    const gl=this.gl;
    for(const target of [...this.fresh,...this.resolved]){target.textures.forEach(texture=>gl.deleteTexture(texture));gl.deleteFramebuffer(target.framebuffer);}
    this.fresh=[];this.resolved=[];
  }
}
