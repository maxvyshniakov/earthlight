import assert from 'node:assert/strict';
import {sceneColorShader} from '../src/scripts/scene-color.ts';
import {cityLightShader} from '../src/scripts/city-light.ts';
import {cloudShader} from '../src/scripts/earth-clouds.ts';

export async function verifyNightLight(evaluate,explicitLod=true){
 const transfer=`precision highp float;
 ${sceneColorShader}
 void main(){
   float energy=exp2(-24.+floor(gl_FragCoord.x)/8.);
   vec3 a=vec3(.2,.4,.6)*energy,b=vec3(.1,.2,.3)*energy;
   vec3 light=gl_FragCoord.y<1.?sceneToOutputLinear(a):sceneToOutputLinear(a+b)-sceneToOutputLinear(b);
   gl_FragColor=vec4(light/energy,1.);
 }`;
 const haze=`#extension GL_EXT_shader_texture_lod : enable
 ${explicitLod?'#define CLOUD_EXPLICIT_LOD 1':''}
 precision highp float;
 uniform sampler2D nightMap;uniform vec3 sunDirection;uniform float blocked;uniform float aerosolField;
 const vec2 nightMapResolution=vec2(2048.,1024.);
 const vec3 cameraPosition=vec3(1.08,0.,0.);
 float noise(vec3 p){return aerosolField;}
 vec2 earthUV(vec3 n){return vec2(atan(n.y,n.x)/6.283185307+.5,asin(n.z)/3.141592654+.5);}
 ${cityLightShader}
 void main(){
   vec3 ray=normalize(vec3(-1.,(gl_FragCoord.x/256.-.5)*.6,0.));
   float b=dot(cameraPosition,ray),c=dot(cameraPosition,cameraPosition);
   float radius=1.+blocked*12./6371.;
   float ground=-b-sqrt(b*b-c+radius*radius);
   gl_FragColor=vec4(cityHaze(ray,ground)*50.,1.);
 }`;
 const uplight=haze.slice(0,haze.indexOf(' void main(){'))+`
 uniform float sampleHeight;
 void main(){
   vec3 n=normalize(vec3(1.,(gl_FragCoord.x/256.-.5)*.06,0.));
   float direct=cityLightEnergy(texture2D(nightMap,earthUV(n)).r);
   float scattered=cityUplightEnergy(n*(1.+sampleHeight/6371.));
   float energy=mix(direct,scattered,step(1.,gl_FragCoord.y));
   gl_FragColor=vec4(vec3(energy*2.),1.);
 }`;
 const storm=`precision highp float;
 uniform sampler2D cloudMap;uniform float blocked;uniform float gap;uniform float cloudRegime;
 const vec3 cameraPosition=vec3(1.06,0.,0.),sunDirection=vec3(-1.,0.,0.);
 const vec2 resolution=vec2(256.,2.);
 const vec3 airExtinction=vec3(0.);
 const float time=0.;
 mat2 rotate(float a){return mat2(1.);}
 float noise(vec3 p){return cloudRegime;}
 vec2 earthUV(vec3 n){return vec2(atan(n.y,n.x)/6.283185307+.5,asin(n.z)/3.141592654+.5);}
 float detailedCloud(vec2 uv,float footprint,float fallback){return gap>.5&&abs(uv.x-.5)<.003?0.:fallback;}
 vec3 cityCloudLight(vec3 p){return vec3(0.);}
 vec3 moonlightAt(vec3 p){return vec3(0.);}
 vec3 moonDirectionAt(vec3 p){return vec3(1.,0.,0.);}
 vec3 airglowIrradiance(vec3 p){return vec3(0.);}
 vec3 galacticIrradiance(vec3 p){return vec3(0.);}
 vec3 nightSkyTransmission(vec3 p){return vec3(1.);}
 float airColumn(vec3 p,vec3 r,float d){return 0.;}
 ${cloudShader}
 void main(){
   vec3 ray=normalize(vec3(-1.,(gl_FragCoord.x/256.-.5)*.65,0.));
   float b=dot(cameraPosition,ray),c=dot(cameraPosition,cameraPosition);
   float radius=1.+blocked*12./6371.;
   float ground=-b-sqrt(b*b-c+radius*radius),distance;
   gl_FragColor=vec4(cloudVolume(ray,ground,vec3(0.),distance)*8.,1.);
 }`;
 const activation=`precision highp float;
 uniform float district;
 vec3 sunDirection;
 float noise(vec3 p){return district;}
 ${cityLightShader.slice(0,cityLightShader.indexOf('float blurredCitySample('))}
 void main(){sunDirection=vec3(-.12+gl_FragCoord.x/256.*.16,0.,0.);gl_FragColor=vec4(vec3(cityActivation(vec3(1.,0.,0.))),1.);}`;
 const result=await evaluate(`(()=>{
 const canvas=document.createElement('canvas');canvas.width=256;canvas.height=2;
 const gl=canvas.getContext('webgl');gl.disable(gl.DITHER);gl.getExtension('EXT_shader_texture_lod');
 const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
 const program=source=>{const p=gl.createProgram();for(const [type,text] of [[gl.VERTEX_SHADER,'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}'],[gl.FRAGMENT_SHADER,source]]){const s=gl.createShader(type);gl.shaderSource(s,text);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));gl.attachShader(p,s);}gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));gl.useProgram(p);const a=gl.getAttribLocation(p,'p');gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,2,gl.FLOAT,false,0,0);return p;};
 const draw=()=>{gl.drawArrays(gl.TRIANGLES,0,3);const bytes=new Uint8Array(256*2*4);gl.readPixels(0,0,256,2,gl.RGBA,gl.UNSIGNED_BYTE,bytes);return Array.from(bytes);};
 const p=program(${JSON.stringify(transfer)});
 const linear=draw(),p3=(()=>{gl.uniform1f(gl.getUniformLocation(p,'displayP3'),1);return draw();})();
 const h=program(${JSON.stringify(haze)}),texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);
 gl.uniform1f(gl.getUniformLocation(h,'aerosolField'),.5);
 const pixels=new Uint8Array(2048*1024);for(let y=510;y<514;y++)for(let x=1022;x<1026;x++)pixels[y*2048+x]=255;
 const upload=()=>{gl.texImage2D(gl.TEXTURE_2D,0,gl.LUMINANCE,2048,1024,0,gl.LUMINANCE,gl.UNSIGNED_BYTE,pixels);gl.generateMipmap(gl.TEXTURE_2D);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);};upload();
 const sample=(sun,blocked)=>{gl.uniform3f(gl.getUniformLocation(h,'sunDirection'),sun,0,0);gl.uniform1f(gl.getUniformLocation(h,'blocked'),blocked);return draw().slice(0,1024).filter((_,i)=>i%4===0);};
 const city=sample(-1,0),day=sample(1,0),cloud=sample(-1,1);
 gl.uniform1f(gl.getUniformLocation(h,'aerosolField'),0);const clearHaze=sample(-1,0);
 gl.uniform1f(gl.getUniformLocation(h,'aerosolField'),1);const denseHaze=sample(-1,0);
 pixels.fill(0);upload();const empty=sample(-1,0);
 const u=program(${JSON.stringify(uplight)});
 const field=height=>{gl.uniform1f(gl.getUniformLocation(u,'sampleHeight'),height);return draw().filter((_,i)=>i%4===0);};
 pixels.fill(0);pixels[512*2048+1024]=255;upload();
 const lowUplight=field(.5).slice(256),highUplight=field(8).slice(256);
 const calibration=[0,32,128,255].map(value=>{pixels.fill(value);upload();return field(3);});
 const stormProgram=program(${JSON.stringify(storm)});
 gl.uniform1f(gl.getUniformLocation(stormProgram,'cloudRegime'),.75);
 gl.uniform1f(gl.getUniformLocation(stormProgram,'cloudMapWidth'),2048);
 pixels.fill(255);upload();
 const flash=(energy,blocked)=>{const sources=new Float32Array(32);sources.set([1+3.6/6371,0,0,energy]);gl.uniform4fv(gl.getUniformLocation(stormProgram,'stormSources[0]'),sources);gl.uniform1f(gl.getUniformLocation(stormProgram,'blocked'),blocked);return draw().slice(0,1024);};
 const lit=flash(.02,0),off=flash(0,0),occluded=flash(.02,1);
 gl.uniform1f(gl.getUniformLocation(stormProgram,'cloudRegime'),.25);const lowDeck=flash(.02,0);
 gl.uniform1f(gl.getUniformLocation(stormProgram,'cloudRegime'),.75);
 gl.uniform1f(gl.getUniformLocation(stormProgram,'gap'),1);const detailedGap=flash(.02,0);
 gl.uniform1f(gl.getUniformLocation(stormProgram,'gap'),0);
 pixels.fill(140);upload();const thin=flash(.02,0);
 pixels.fill(0);upload();const clear=flash(.02,0);
 const activationProgram=program(${JSON.stringify(activation)});
 const district=value=>{gl.uniform1f(gl.getUniformLocation(activationProgram,'district'),value);return draw().slice(0,1024).filter((_,i)=>i%4===0);};
 const early=district(.1),late=district(.9);
 const result={linear,p3,city,day,cloud,empty,clearHaze,denseHaze,lowUplight,highUplight,calibration,early,late,storm:{lit,off,occluded,clear,thin,detailedGap,lowDeck},error:gl.getError()};gl.getExtension('WEBGL_lose_context').loseContext();return result;
 })()`);
 assert.equal(result.error,0);
 for(const samples of [result.linear,result.p3]){
   for(let x=0;x<256;x++)for(let c=0;c<3;c++){
     assert.ok(Math.abs(samples[x*4+c]-samples[c])<=1,'linear radiance retains faint-to-bright ratios');
     assert.ok(Math.abs(samples[x*4+c]-samples[(256+x)*4+c])<=1,'emission sources add before the display transfer');
   }
 }
 assert.deepEqual(result.linear.slice(0,3),[51,102,153]);
 const peak=Math.max(...result.city);
 assert.ok(peak>5&&peak<255,'city atmosphere is visible without saturating the diagnostic');
 assert.ok(Math.max(...result.city.slice(0,32),...result.city.slice(-32))<peak*.02,'unlit ground does not grow a global luminous shell');
 assert.equal(Math.max(...result.day),0);assert.equal(Math.max(...result.empty),0);
 assert.equal(Math.max(...result.cloud),0,'opaque cloud tops hide the low haze beneath them');
 assert.ok(Math.max(...result.clearHaze)>0,'clear air retains a faint local scattering signal');
 assert.ok(Math.max(...result.denseHaze)>Math.max(...result.clearHaze)*1.5,'aerosol patches vary the surround instead of giving every city the same halo');
 for(const values of result.calibration)for(let x=0;x<256;x++)assert.ok(Math.abs(values[x]-values[x+256])<=1,'direct emission and integrated uplight use the same energy calibration for a uniform field');
 const levels=result.calibration.map(values=>values[0]);
 assert.equal(levels[0],0);assert.ok(levels[1]>0&&levels[1]<levels[2]&&levels[2]<levels[3],'dim roads survive and source energy remains monotonic');
 assert.ok(levels[1]/levels[3]>.05&&levels[1]/levels[3]<.09,'dim connecting lights keep a visible share of peak emission');
 assert.ok(levels[2]/levels[3]>.38&&levels[2]/levels[3]<.45,'midtones retain contrast without crushing the light network');
 assert.ok(levels[3]>150&&levels[3]<180,'bright detail sources retain their calibrated peak');
 const width=values=>values.filter(v=>v>Math.max(...values)*.1).length;
 assert.ok(width(result.highUplight)>width(result.lowUplight),'uplight spreads farther at cloud altitude');
 assert.ok(Math.max(...result.highUplight)<Math.max(...result.lowUplight),'spreading light does not retain the compact source peak');
 const channels=bytes=>bytes.filter((_,i)=>i%4!==3);
 const flash=channels(result.storm.lit),flashPeak=Math.max(...flash);
 assert.ok(flashPeak>20&&flashPeak<255,'cloud flash is visible without diagnostic clipping');
 assert.ok(Math.max(...flash.slice(0,48),...flash.slice(-48))<flashPeak*.03,'flash stays local to its storm cell');
 for(const key of ['off','clear','occluded','thin','detailedGap','lowDeck'])assert.equal(Math.max(...channels(result.storm[key])),0,`no flash for ${key}`);
 assert.ok(result.storm.lit[128*4+2]>result.storm.lit[128*4],'flash has a cool cloud-scattered surround');
 for(const values of [result.early,result.late]){
   assert.equal(values[0],255);assert.equal(values.at(-1),0);
   assert.ok(values.every((v,i)=>i===0||v<=values[i-1]),'district lights change monotonically through twilight');
 }
 assert.ok(result.early.findIndex(v=>v<128)-result.late.findIndex(v=>v<128)>30,'districts activate at different local twilight thresholds');
 const proof={linear:result.linear.slice(0,3),p3:result.p3.slice(0,3),cityPeak:peak,cityWidth:result.city.filter(v=>v>peak*.1).length,uplightWidths:[width(result.lowUplight),width(result.highUplight)],sourceLevels:levels,dark:Math.max(...result.empty),blocked:Math.max(...result.cloud),flashPeak};
 return explicitLod?{...proof,fallback:await verifyNightLight(evaluate,false)}:proof;
}
