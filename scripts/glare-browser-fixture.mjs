import assert from 'node:assert/strict';
import {browserModule} from './browser-module.mjs';
import {FRAME_VEIL_COMPONENTS} from '../src/scripts/solar-light.ts';
import {GLARE_SOLAR_CAP} from '../src/scripts/camera-glare.ts';

// Run the production glare pyramid on a point source in a float target. It
// returns the normalized kernel: its integral must be one and its radial
// profile the analytic Moffat kernels of FRAME_VEIL_COMPONENTS: the solar
// veil's kernels without the broad contamination one, which only the Sun's
// analytic veil draws.
export async function verifyGlare(evaluate){
 const glareModule=await browserModule('camera-glare');
 const size=512;
 const result=await evaluate(`(()=>{
  const exports=${glareModule};
  const size=${size},canvas=document.createElement('canvas');canvas.width=canvas.height=size;
  const gl=canvas.getContext('webgl2');
  if(!gl?.getExtension('EXT_color_buffer_float'))throw Error('Float glare integration unavailable');
  const scene=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,scene);
  for(const f of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,f,gl.LINEAR);
  for(const a of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,a,gl.CLAMP_TO_EDGE);
  const glare=new exports.CameraGlare(gl,gl.HALF_FLOAT);
  const read=(texture,w,h)=>{const fb=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
   gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
   const pixels=new Float32Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.FLOAT,pixels);gl.deleteFramebuffer(fb);return pixels;};
  const run=(value,mask,focal=1.25)=>{
   // A 2x2 block centred on the frame: exact under bilinear reads.
   const data=new Float32Array(size*size*4);
   for(const y of [size/2-1,size/2])for(const x of [size/2-1,size/2])data.set([value,value,value,1],(y*size+x)*4);
   gl.bindTexture(gl.TEXTURE_2D,scene);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA16F,size,size,0,gl.RGBA,gl.FLOAT,data);
   const out=glare.render(scene,size,size,mask,focal);
   const half=size/2,pixels=read(out,half,half);
   let energy=0;const rings=new Map();
   for(let y=0;y<half;y++)for(let x=0;x<half;x++){
    const v=pixels[(y*half+x)*4+1];energy+=4*v;
    // Distance in full-resolution pixels from the source centre.
    const r=Math.hypot((x+.5)*2-size/2,(y+.5)*2-size/2);
    for(const ring of [4,8,16,32,64,128,200])if(Math.abs(r-ring)<Math.max(1.5,ring*.06)){const s=rings.get(ring)??[0,0];s[0]+=v;s[1]++;rings.set(ring,s);}
   }
   return {energy:energy/(4*value),profile:[...rings].map(([r,[s,n]])=>[r,s/n/(4*value)])};
  };
  const point=run(100,[0,0,0,0]);
  // The same source inside the Sun's footprint is capped, outside it is not.
  const solar=run(1000,[0,0,.05,1]),open=run(1000,[.3,.3,.05,1]);
  // At 4x the halo is four times wider in the frame and as bright per angle.
  const zoomed=run(100,[0,0,0,0],5);
  const error=gl.getError();glare.dispose();gl.getExtension('WEBGL_lose_context').loseContext();
  return {error,point,solar,open,zoomed};
 })()`);
 assert.equal(result.error,0);
 // Light beyond the frame edge is lost; at 512 px that is about 0.3%.
 assert.ok(Math.abs(result.point.energy-1)<.02,`glare integral ${result.point.energy}`);
 const moffat=r=>FRAME_VEIL_COMPONENTS.reduce((sum,{share,scale})=>{const a=scale*1.25*size;return sum+share/(Math.PI*a*a)*(1+r*r/(a*a))**-2;},0);
 const ratios=result.point.profile.map(([r,v])=>[r,v/moffat(r)]);
 for(const [r,ratio] of ratios)if(r>=8)assert.ok(ratio>.85&&ratio<1.15,`glare profile at ${r}px is ${ratio.toFixed(2)} of the Moffat veil`);
 assert.ok(Math.abs(result.open.energy-1)<.02,'a bright source outside the solar footprint scatters fully');
 assert.ok(result.solar.energy<=GLARE_SOLAR_CAP/1000*1.05,'the Sun is capped; its veil stays analytic');
 // Light the wider kernel would carry past the edge stays in frame: the
 // coarsest level is the frame mean.
 assert.ok(Math.abs(result.zoomed.energy-1)<.02,'zooming keeps the glare integral');
 const at=(run,r)=>run.profile.find(([ring])=>ring===r)[1];
 assert.ok(Math.abs(at(result.zoomed,64)/at(result.point,16)*16-1)<.25,'a 4x focal length scales the halo 4x in the frame');
 return {...result,ratios};
}
