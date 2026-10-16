import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {galacticLightShader} from '../src/scripts/galactic-light.ts';
import {airglowLightShader} from '../src/scripts/airglow-light.ts';
import {lunarLightShader} from '../src/scripts/earth-light.ts';
import {atmosphericLightShader} from '../src/scripts/atmospheric-light.ts';
import {visibleSourceDisk} from '../src/scripts/lens-reflections.ts';
import {SOLAR_RADIUS,SOLAR_RADIANCE,SOLAR_SCATTER_FRACTION} from '../src/scripts/solar-light.ts';
import {SOLAR_RESOLVED_PX} from '../src/scripts/solar-disk.ts';

// Exercise the production eclipse convolution with a known broad PSF so its
// masked energy and support boundary can be measured without sensor clipping.
export async function verifyLighting(evaluate){
 const raw=readFileSync(new URL('../src/scripts/orbital-shader.ts',import.meta.url),'utf8');
 const convolution=raw.slice(raw.indexOf('  vec2 solarCenter='),raw.indexOf('  if (skyMask < 1.) {'))
  .replaceAll('${SOLAR_RADIUS}',String(SOLAR_RADIUS))
  .replaceAll('${optics.integral.toFixed(8)}','1.')
  .replaceAll('${SOLAR_RESOLVED_PX[0].toFixed(1)}',SOLAR_RESOLVED_PX[0].toFixed(1))
  .replaceAll('${SOLAR_RESOLVED_PX[1].toFixed(1)}',SOLAR_RESOLVED_PX[1].toFixed(1))
  .replaceAll('${(SOLAR_RADIANCE*(1-SOLAR_SCATTER_FRACTION)).toFixed(5)}',String(SOLAR_RADIANCE*(1-SOLAR_SCATTER_FRACTION)));
 const solar=`precision highp float;
 #define FOCAL 1.25
 uniform vec3 sunDirection;uniform mat3 cameraBasis;uniform float solarVisibility;
 const vec3 cameraPosition=vec3(0.,0.,2.);
 vec2 screenPosition(vec3 d){return 1.25*vec2(dot(d,cameraBasis[0]),dot(d,cameraBasis[1]))/dot(d,cameraBasis[2]);}
 vec3 lensPsf(vec2 delta,vec2 center){return vec3(.000001);}
 // This 3 px Sun stays on the sampled path; the resolved disk and its rays
 // have their own fixture (solar-disk-browser-fixture.mjs).
 vec4 solarCameraState(){return vec4(4.,1.,1.,0.);}
 vec3 solarRayShare(float opening){return vec3(0.);}
 vec3 solarRays(vec2 delta,float radius,vec4 camera){return vec3(0.);}
 vec3 resolvedSolarDisk(vec2 delta,float radius,float limb,vec4 camera){return vec3(0.);}
 void main(){float cssHeight=512.;vec2 p=vec2((gl_FragCoord.x-160.)/512.,0.);vec3 earthRay=vec3(0.,0.,1.);
 ${convolution}
 gl_FragColor=vec4(solarDisk,1.);}`;
 const lunar=`precision highp float;
 uniform vec4 moon;const vec3 cameraPosition=vec3(0.,0.,2.);
 ${atmosphericLightShader}
 ${lunarLightShader}
 void main(){gl_FragColor=vec4(moonlightAt(vec3(0.,0.,1.))*100000.,1.);}`;
 const glow=`precision highp float;
 uniform vec3 sunDirection;uniform float sourceScale;
 const float time=0.;float noise(vec3 p){return .5;}
 ${airglowLightShader}
 void main(){
   vec3 point=vec3(0.,0.,1.+(gl_FragCoord.x<160.?0.:5./6371.));
   gl_FragColor=vec4(airglowIrradiance(point)*sourceScale*500.,1.);
 }`;
 const galaxy=`precision highp float;
 uniform sampler2D milkyWayMap;uniform float galaxyAmount;
 const mat3 galacticBasis=mat3(1.);
 ${galacticLightShader}
 void main(){gl_FragColor=vec4(galacticIrradiance(normalize(vec3(1.,gl_FragCoord.x/320.,.5)))*100.,1.);}`;
 const limb=-Math.sqrt(.75),positions=[limb-.01,limb,limb+.01];
 const cases=positions.map(z=>{const direction=[Math.sqrt(1-z*z),0,z];return {direction,visibility:visibleSourceDisk([0,0,2],direction,SOLAR_RADIUS)};});
 const result=await evaluate(`(()=>{
 const canvas=document.createElement('canvas');canvas.width=320;canvas.height=1;
 const gl=canvas.getContext('webgl');gl.disable(gl.DITHER);
 const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
 const program=source=>{const p=gl.createProgram();for(const [type,text] of [[gl.VERTEX_SHADER,'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}'],[gl.FRAGMENT_SHADER,source]]){const s=gl.createShader(type);gl.shaderSource(s,text);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));gl.attachShader(p,s);}gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));gl.useProgram(p);const a=gl.getAttribLocation(p,'p');gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,2,gl.FLOAT,false,0,0);return p;};
 const draw=()=>{gl.drawArrays(gl.TRIANGLES,0,3);const bytes=new Uint8Array(320*4);gl.readPixels(0,0,320,1,gl.RGBA,gl.UNSIGNED_BYTE,bytes);return Array.from(bytes).filter((_,i)=>i%4===0);};
 const s=program(${JSON.stringify(solar)});
 const eclipse=${JSON.stringify(cases)}.map(({direction:d,visibility})=>{gl.uniform3fv(gl.getUniformLocation(s,'sunDirection'),d);gl.uniformMatrix3fv(gl.getUniformLocation(s,'cameraBasis'),false,[d[2],0,-d[0],0,1,0,...d]);gl.uniform1f(gl.getUniformLocation(s,'solarVisibility'),visibility);const pixels=draw();return {visibility,peak:Math.max(...pixels),energy:pixels.reduce((a,b)=>a+b,0),edge:pixels.slice(250,300)};});
 const m=program(${JSON.stringify(lunar)});
 const moon=(z,phase)=>{gl.uniform4f(gl.getUniformLocation(m,'moon'),0,0,z,.0045);gl.uniform1f(gl.getUniformLocation(m,'lunarIrradiance'),phase);return draw()[0];};
 const g=program(${JSON.stringify(glow)});
 const glow=(sun,scale)=>{gl.uniform3f(gl.getUniformLocation(g,'sunDirection'),0,0,sun);gl.uniform1f(gl.getUniformLocation(g,'sourceScale'),scale);const bytes=draw();return [bytes[0],bytes[200]];};
 const nightglow=glow(-1,1),halfGlow=glow(-1,.5),disabledGlow=glow(-1,0),dayglow=glow(1,1);
 const sky=program(${JSON.stringify(galaxy)}),texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);
 gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,1,1,0,gl.RGB,gl.UNSIGNED_BYTE,new Uint8Array([128,128,128]));
 gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
 const starlight=amount=>{gl.uniform1f(gl.getUniformLocation(sky,'galaxyAmount'),amount);return draw();};
 const uniformSky=starlight(1),darkSky=starlight(0),twiceSky=starlight(2);
 const galactic={min:Math.min(...uniformSky),max:Math.max(...uniformSky),dark:Math.max(...darkSky),twice:twiceSky[0]};
 gl.useProgram(m);
 const result={galactic,nightglow,halfGlow,disabledGlow,dayglow,eclipse,fullMoon:moon(1,1),quarterFlux:moon(1,.25),newMoon:moon(1,0),belowHorizon:moon(-1,1),error:gl.getError()};
 gl.getExtension('WEBGL_lose_context').loseContext();return result;
 })()`);
 assert.equal(result.error,0);
 assert.equal(result.galactic.dark,0,'disabled galactic source cannot illuminate Earth');
 assert.ok(result.galactic.max-result.galactic.min<=1,'uniform sky illumination is independent of surface orientation');
 assert.ok(Math.abs(result.galactic.twice/result.galactic.max-2)<.03,'diffuse sky reflection follows visible sky brightness');
 assert.deepEqual(result.disabledGlow,[0,0],'no illumination when atmospheric emission is absent');
 for(let i=0;i<2;i++){
  assert.ok(result.nightglow[i]>10&&result.nightglow[i]<254,'nightglow reaches both ground and cloud heights');
  assert.ok(Math.abs(result.halfGlow[i]/result.nightglow[i]-.5)<.03,'reflected illumination follows the same source strength');
  assert.ok(result.dayglow[i]<result.nightglow[i]*.05,'local daylight suppresses the night source');
 }
 assert.ok(result.nightglow[1]>=result.nightglow[0],'cloud tops receive less extinguished downwelling light');
 assert.equal(result.eclipse[0].energy,0,'fully eclipsed Sun has no optical halo');
 assert.ok(result.eclipse[2].energy>0);
 assert.ok(Math.abs(result.eclipse[1].energy/result.eclipse[2].energy-.5)<.04,'partial eclipse conserves visible source energy');
 const edge=result.eclipse[2].edge;
 assert.equal(edge.at(-1),0);assert.ok(edge[0]>0);
 assert.ok(Math.max(...edge.slice(1).map((x,i)=>Math.abs(x-edge[i])))<=Math.ceil(result.eclipse[2].peak*1.5/35)+1,'finite convolution support fades smoothly');
 assert.equal(result.newMoon,0);assert.equal(result.belowHorizon,0);
 assert.ok(result.fullMoon>50);assert.ok(Math.abs(result.quarterFlux/result.fullMoon-.25)<.02);
 return result;
}
