// The adaptive controller starts at full resolution and needs several slow
// frames to find a sustainable size. Remember the settled size per device and
// viewport so a return visit starts there; adaptation continues from it.
const KEY='earthlight.renderScale.v1';
const MAX_AGE=30*86400_000;
type Entry={scale:number;width:number;height:number;dpr:number;profile:string;at:number};

function close(a:number,b:number,tolerance:number){return Math.abs(a-b)<=Math.max(1,b)*tolerance;}

export function rememberedScale(width:number,height:number,dpr:number,profile:string,now=Date.now()):number|null{
 try{
  const entry=JSON.parse(localStorage.getItem(KEY)??'null') as Entry|null;
  if(!entry||!Number.isFinite(entry.scale)||entry.profile!==profile||!close(entry.dpr,dpr,.01)
   ||!close(entry.width,width,.15)||!close(entry.height,height,.15)||!(now-entry.at<MAX_AGE))return null;
  return Math.max(.45,Math.min(1,entry.scale));
 }catch{return null;}
}

export function rememberScale(scale:number,width:number,height:number,dpr:number,profile:string,now=Date.now()){
 try{localStorage.setItem(KEY,JSON.stringify({scale,width,height,dpr,profile,at:now} satisfies Entry));}catch{/* storage unavailable */}
}
