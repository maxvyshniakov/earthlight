import {createSceneRenderer} from './scene-renderer';
import {sceneLook} from './scene-defaults';
import {SceneCalendar,calendarFrame} from './scene-calendar';
import {issFrame,initialSceneSeconds} from './iss-orbit';
import {FOCUS_RADIUS,firstLightAssets} from './scene-assets';
import {sceneBufferSize,sceneComposition} from './scene-viewport';
import {sceneContext} from './webgl-context';

/** Poster capture: the background's opening frame at one date, held at the
 * loading defocus, without grain or the celestial sky. scripts/render-posters.mjs
 * drives it; `epoch` sets the Sun, `focus` the blur radius and `sky=1` keeps the sky.
 * Only the first light loads, as when the live canvas replaces the poster.
 * When the frame is ready, data-poster holds it as a PNG data URL.
 * `bench=<scale,...>` instead times defocused frames at those buffer scales of
 * the background's settled buffer (devicePixelRatio, quality 0.75), each frame
 * synchronised by a one-pixel read, and writes data-bench. */
const params=new URLSearchParams(location.search);
const canvas=document.querySelector('canvas')!;
const radius=Number(params.get('focus')??FOCUS_RADIUS);
const seconds=initialSceneSeconds(new URLSearchParams());
const calendar=new SceneCalendar(new URLSearchParams(params.get('epoch')?{epoch:params.get('epoch')!}:{}),seconds);
const rendererParams=new URLSearchParams({texture:'compact',aurora:'0',lightning:'0'});
const gl=sceneContext(canvas,rendererParams,{alpha:false,antialias:false,depth:false,preserveDrawingBuffer:true});
if(!gl)throw Error('WebGL unavailable');
const bounds=canvas.getBoundingClientRect();
const bench=params.get('bench')?.split(',').map(Number).filter(x=>x>0&&x<=1)??null;
const resize=(dpr:number,quality:number)=>{
  const size=sceneBufferSize(bounds.width,bounds.height,dpr,quality);
  canvas.width=size.width;canvas.height=size.height;gl.viewport(0,0,size.width,size.height);
};
resize(1,1);
const base=document.body.dataset.assetBase??'/media/earthlight/';
const firstLight=new Set(firstLightAssets(new URL(base.replace(/\/+$/,'')+'/',location.href).href).map(asset=>asset.url));
const load=window.fetch.bind(window);
// Refinements stay pending: never answered, never failed.
window.fetch=(input,init)=>firstLight.has(new URL(String(input instanceof Request?input.url:input),location.href).href)?load(input,init):new Promise(()=>{});
const renderer=createSceneRenderer(gl,canvas,rendererParams,()=>{},{background:true,sky:params.get('sky')==='1',assetBaseURL:base});
renderer.load();
const look={...sceneLook,grain:0};
let frames=0;
const composition=sceneComposition(0,bounds.height,bounds.height,true);
const observer=calendarFrame(issFrame(seconds+composition.offset,composition.limb,{yaw:0,pitch:0},composition.altitudeLift),calendar.date(seconds+composition.offset));
const draw=()=>renderer.render(observer,canvas.width,canvas.height,bounds.height,seconds,frames,look,radius,0);
const measure=()=>{
  const pixel=new Uint8Array(4),results:Record<string,{width:number;height:number;ms:number}>={};
  for(const scale of bench!){
    resize(devicePixelRatio,.75*scale);
    for(let i=0;i<8;i++){draw();gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);}
    const times:number[]=[];
    for(let i=0;i<40;i++){const start=performance.now();draw();gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);times.push(performance.now()-start);}
    times.sort((a,b)=>a-b);
    results[scale]={width:canvas.width,height:canvas.height,ms:times[times.length>>1]};
  }
  document.body.dataset.bench=JSON.stringify(results);
};
const tick=()=>{
  const result=draw();
  if(result&&bench&&renderer.assets.previewSettled&&++frames>=24)return measure();
  if(result&&!bench&&renderer.assets.previewSettled&&++frames>=24){
    document.body.dataset.phase=observer.phase;
    document.body.dataset.poster=canvas.toDataURL('image/png');
    return;
  }
  requestAnimationFrame(tick);
};
requestAnimationFrame(tick);
