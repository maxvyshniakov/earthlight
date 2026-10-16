import { galaxyOverview } from './texture-profile.ts';
import { SceneWork, scenePriority } from './scene-work.ts';
export type ImageLayer='day'|'night'|'clouds'|'galaxy';
export type AssetKey=ImageLayer|'stars'|'psf'|'terrain'|'modis';
export type AssetPlan={key:AssetKey;url:string;preview?:boolean};
export type AssetUpload=(asset:AssetPlan,blob:Blob)=>Promise<void>;

export function sceneAssetPlan(desktop:boolean,maxTexture:number,terrain:boolean,saveData=false,compactSurface=false,compactTextures=false,assetBaseURL='/media/earthlight/'):AssetPlan[]{
 saveData ||= maxTexture<4096;
 const root=assetBaseURL.replace(/\/+$/, '')+'/';
 const large=desktop&&!saveData&&maxTexture>=8192;
 return [
  ...(['day','night','clouds','galaxy'] as ImageLayer[]).map(key=>({key,url:`${root}preview/${key}.webp`,preview:true})),
  // Gzipped transfer copies (scripts/pack-startup-assets.mjs): 590 -> 84 KB
  // and 499 -> 231 KB; both decode to the original bytes and float layout.
  {key:'psf',url:root+'optical-psf-v2.bin',preview:true},
  {key:'stars',url:root+'stars-hyg-v2.bin',preview:true},
  ...(saveData?[]:[
   {key:'galaxy' as const,url:galaxyOverview(compactTextures,assetBaseURL)},
   {key:'day' as const,url:root+(compactSurface?'mobile/day-2048.avif':'earth-day-bmng.avif')},
   {key:'night' as const,url:root+`earth-night${large?'-8k':''}.avif`},
   {key:'clouds' as const,url:root+`earth-clouds-nasa-${large?8192:4096}.avif`},
   ...(terrain?[{key:'terrain' as const,url:root+`earth-terrain-${large?8192:4096}-v2.dem`}]:[]),
  ]),
 ];
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
  finally{this.abort.signal.removeEventListener('abort',cancel);this.notify();}
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

/** Focus is a one-way reveal. Slow/failed optional detail never holds it forever. */
export class SceneFocus {
 private start=NaN;
 private released=NaN;
 value(now:number,ready:boolean,detailSettled:boolean,tilesSettled:boolean){
  if(!ready)return 6;
  if(!Number.isFinite(this.start))this.start=now;
  if(!Number.isFinite(this.released)&&((detailSettled&&tilesSettled&&now-this.start>=450)||now-this.start>=6000))this.released=now;
  const t=Number.isFinite(this.released)?Math.min(1,(now-this.released)/1300):0;
  return 6*(1-t*t*(3-2*t));
 }
}
