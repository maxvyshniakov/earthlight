import { galaxyOverview } from './texture-profile.ts';
import { SceneWork, scenePriority } from './scene-work.ts';
export type ImageLayer='day'|'night'|'clouds'|'galaxy';
export type AssetKey=ImageLayer|'stars'|'psf'|'terrain'|'modis';
export type AssetPlan={key:AssetKey;url:string;preview?:boolean};
export type AssetUpload=(asset:AssetPlan,blob:Blob)=>Promise<void>;

/** Stars to magnitude 5 (scripts/pack-startup-assets.mjs): 25 KB of the
 * 231 KB catalog, and every star that reads as a distinct disc under the
 * loading defocus. The fainter ones arrive as a haze while it is still wide. */
export const FIRST_LIGHT_STARS='stars-hyg-m5-v2.bin';
export function firstLightAssets(root:string):AssetPlan[]{
 return [
  ...(['day','night','galaxy'] as ImageLayer[]).map(key=>({key,url:`${root}preview/${key}.webp`,preview:true})),
  // Clouds are the costliest overview to compress; 18 KB instead of 87 KB.
  {key:'clouds',url:root+'preview/clouds-512.avif',preview:true},
  {key:'stars',url:root+FIRST_LIGHT_STARS,preview:true},
 ];
}

export function sceneAssetPlan(desktop:boolean,maxTexture:number,terrain:boolean,saveData=false,compactSurface=false,compactTextures=false,assetBaseURL='/media/earthlight/'):AssetPlan[]{
 saveData ||= maxTexture<4096;
 const root=assetBaseURL.replace(/\/+$/, '')+'/';
 const large=desktop&&!saveData&&maxTexture>=8192;
 return [
  // First light: everything a defocused frame needs, about 77 KB. Pages
  // preload these URLs (firstLightAssets) while the scene script downloads.
  ...firstLightAssets(root),
  // Gzipped transfer copies (scripts/pack-startup-assets.mjs). Defocus hides
  // faint stars and the PSF's fine structure, so both refine the first light:
  // the full catalog replaces the bright stars, the PSF its analytic stand-in.
  {key:'stars',url:root+'stars-hyg-v2.bin'},
  {key:'psf',url:root+'optical-psf-v3.bin'},
  ...(saveData?[{key:'clouds' as const,url:root+'preview/clouds.webp'}]:[
   {key:'galaxy' as const,url:galaxyOverview(compactTextures,assetBaseURL)},
   {key:'day' as const,url:root+(compactSurface?'mobile/day-2048.avif':'earth-day-bmng.avif')},
   {key:'night' as const,url:root+`earth-night${large?'-8k':''}.avif`},
   {key:'clouds' as const,url:root+`earth-clouds-nasa-${large?8192:4096}.avif`},
   ...(terrain?[{key:'terrain' as const,url:root+`earth-terrain-${large?8192:4096}-v2.dem`}]:[]),
  ]),
 ];
}

/** nightDetail=vnp46 (lab): the overview, its first light and the tiles come
 * from one VNP46A4 composite, so the fade, uplight and haze see the same lights. */
export function vnp46NightOverview(plan:AssetPlan[]){
 for(const asset of plan)if(asset.key==='night')asset.url=asset.url.replace(/(?:preview\/night\.webp|earth-night(?:-8k)?\.avif)$/,file=>'night-vnp46-tiles/'+file.replace('preview/','preview-'));
 return plan;
}

/** Fetches preview first, then two refinements at a time. Only compressed blobs
 * survive upload; decoded bitmaps and DEM buffers belong to the upload callback.
 * A context generation prevents late decodes from touching a restored renderer.
 */
export class SceneAssets {
 private abort=new AbortController();
 private compressed=new Map<AssetKey,{asset:AssetPlan;blob:Blob}>();
 private waiting=new Map<AssetKey,{asset:AssetPlan;blob:Blob}>();
 private generation=0;
 private active=true;
 private disposed=false;
 private refinements=new Set<string>();
 previewSettled=false;
 settled=false;
 failures:string[]=[];
 /** Every first-light asset failed: the scene has nothing to draw. */
 get firstLightFailed(){const preview=this.plan.filter(x=>x.preview);return this.previewSettled&&preview.length>0&&preview.every(x=>this.failures.includes(x.url));}
 private detailDone=0;
 private work:SceneWork;
 private plan:AssetPlan[];private upload:AssetUpload;private notify:()=>void;
 constructor(plan:AssetPlan[],upload:AssetUpload,notify:()=>void,work=new SceneWork()){this.work=work;this.plan=plan;this.upload=upload;this.notify=notify;}
 private async deliver(asset:AssetPlan,blob:Blob,generation=this.generation){
  if(this.disposed||!this.active||generation!==this.generation)return;
  await this.upload(asset,blob);
 }
 private async accept(asset:AssetPlan,blob:Blob){
  while(!this.disposed){
   if(!this.active){this.waiting.set(asset.key,{asset,blob});return;}
   const generation=this.generation;
   await this.deliver(asset,blob,generation);
   if(this.disposed)return;
   // Context restoration may finish while an older bitmap is still decoding.
   // Retry its compressed input against the new context before committing it.
   if(generation!==this.generation)continue;
   this.compressed.set(asset.key,{asset,blob});return;
  }
 }
 private async load(asset:AssetPlan){
  const controller=new AbortController();
  const cancel=()=>controller.abort();this.abort.signal.addEventListener('abort',cancel,{once:true});
  try {
   const blob=await this.work.network.run(asset.preview?scenePriority.preview:scenePriority.overview,controller.signal,async()=>{
    // Queued work has not made a network request yet. Its waiting time must
    // not consume the request's timeout, especially during initial loading.
    const timer=setTimeout(cancel,asset.preview?5000:15000);
    try{
     const response=await fetch(asset.url,{signal:controller.signal,priority:asset.preview?'high':'low'});
     if(!response.ok)throw Error(`${asset.url}: ${response.status}`);
     return await response.blob();
    }finally{clearTimeout(timer);}
   });
   if(this.disposed)return;
   // Decode/upload before committing the replacement; a corrupt refinement
   // must not discard the working preview used on context restoration.
   await this.accept(asset,blob);
  }catch(error){if(!this.disposed){this.failures.push(asset.url);console.warn('Scene layer unavailable; retaining available detail.',asset.key,error);}}
  finally{this.abort.signal.removeEventListener('abort',cancel);if(!asset.preview&&!this.settled)this.detailDone++;this.notify();}
 }
 /** Share of the initial refinements that have arrived or failed, 0..1. */
 get detailProgress(){
  if(this.settled)return 1;
  const total=this.plan.filter(x=>!x.preview).length;
  return this.previewSettled?total?Math.min(1,this.detailDone/total):1:0;
 }
 async start(){
  await Promise.all(this.plan.filter(x=>x.preview).map(x=>this.load(x)));
  if(this.disposed)return;
  this.previewSettled=true;this.notify();
  const detail=this.plan.filter(x=>!x.preview);
  const worker=async()=>{while(detail.length&&!this.disposed)await this.load(detail.shift()!);};
  await Promise.all([worker(),worker()]);
  if(!this.disposed){this.settled=true;this.notify();}
 }
 /** A larger viewport may need a higher overview after initial loading.
  * Keep the existing image through upload/failure, and never restart focus. */
 async refine(asset:AssetPlan){
  if(!this.settled||this.disposed||this.refinements.has(asset.url))return;
  this.refinements.add(asset.url);await this.load(asset);
 }
 suspend(){this.active=false;this.generation++;}
 async restore(){
  this.active=true;const generation=++this.generation;
  // Sequential replay bounds peak decoded memory after context loss.
  for(const {asset,blob} of this.compressed.values()){
   if(this.disposed||generation!==this.generation)return;
   try{await this.deliver(asset,blob,generation);}catch(error){console.warn('Scene restore layer failed.',asset.key,error);}
  }
  for(const [key,{asset,blob}] of this.waiting){
   if(this.disposed||generation!==this.generation)return;
   try{await this.accept(asset,blob);}
   catch(error){this.failures.push(asset.url);console.warn('Scene restore refinement failed.',asset.key,error);}
   if(this.disposed||generation!==this.generation)return;
   this.waiting.delete(key);
  }
  this.notify();
 }
 get bytes(){return [...this.compressed.values()].reduce((sum,x)=>sum+x.blob.size,0);}
 dispose(){this.disposed=true;this.active=false;this.generation++;this.abort.abort();this.compressed.clear();this.waiting.clear();}
}

/** Loading defocus that follows the detail on screen. The lens holds its
 * widest blur over the first light, closes as refinements arrive and pulls
 * into focus with the last one, so a texture is never replaced in sharp view.
 * It never refocuses; slow or failed detail cannot hold it past FOCUS_LIMIT_MS.
 */
export const FOCUS_RADIUS=6,FOCUS_HOLD_MS=450,FOCUS_LIMIT_MS=10000;
export function focusTarget(elapsed:number,progress:number){
 if(elapsed<FOCUS_HOLD_MS)return FOCUS_RADIUS;
 // A refinement shrinks the blur that hides the missing detail; the square
 // root keeps the last missing layer at 40% of the blur, not 17%.
 const detail=FOCUS_RADIUS*Math.sqrt(Math.max(0,1-progress));
 const limit=FOCUS_RADIUS*Math.max(0,Math.min(1,(FOCUS_LIMIT_MS-elapsed)/(FOCUS_LIMIT_MS/2)));
 return Math.min(detail,limit);
}
export class SceneFocus {
 private start=NaN;
 private at=NaN;
 private radius=FOCUS_RADIUS;
 /** progress: refinements arrived (SceneAssets.detailProgress); tiles: whether
  * the first visible tiles are resident. Pending tiles keep a residual blur. */
 value(now:number,ready:boolean,progress:number,tilesSettled=true){
  if(!ready)return FOCUS_RADIUS;
  if(!Number.isFinite(this.start))this.start=this.at=now;
  const target=focusTarget(now-this.start,tilesSettled?progress:Math.min(progress,.9));
  const dt=Math.max(0,Math.min(250,now-this.at));this.at=now;
  // A focus ring: eases out towards each new target, at most a full pull in 0.9 s.
  const step=Math.min((this.radius-target)*(1-Math.exp(-dt/250)),FOCUS_RADIUS*dt/900);
  if(step>0)this.radius-=step;
  if(target===0&&this.radius<.15)this.radius=0;
  return this.radius;
 }
}
