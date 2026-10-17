import { visibleSourceDisk } from './lens-reflections.ts';
import { pointImageFlux } from './point-photometry.ts';
import type { NightMode } from './physical-night.ts';

type Candidate={id:number;x:number;y:number;energy:number;bv:number};
const dot=(a:number[],b:number[])=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const smooth=(a:number,b:number,x:number)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};

/** Keep the work bounded: a bright catalog subset on CPU, three ghosts per
 * selected point source on GPU, at most three simultaneous point sources.
 */
export class PointReflections {
  private stars:number[][]=[];
  private slots:({id:number;weight:number}|null)[]=[null,null,null];
  private previousTime=NaN;
  private previousAspect=NaN;
  /** The night mode whose point photometry the ghosts follow. */
  mode:NightMode='current';
  upload(data:Float32Array){
    this.stars=[];
    // A newly loaded catalog changes source identity even in a paused frame.
    // Rebuild slot weights instead of waiting for simulation time to advance.
    this.slots=[null,null,null];
    this.previousTime=NaN;
    for(let i=0;i<data.length;i+=8)if(data[i+6]<.75)this.stars.push(Array.from(data.slice(i,i+8)));
  }
  update(starToFixed:number[],basis:number[],camera:number[],years:number,planets:number[],
         aspect:number,pixelHeight:number,sceneTime:number,cssHeight=pixelHeight,focal=1.25):Float32Array {
    const candidates:Candidate[]=[];
    const add=(id:number,direction:number[],magnitude:number,bv:number)=>{
      if(magnitude>=.75)return;
      const z=dot(direction,basis.slice(6,9));
      if(z<=0.)return;
      const x=focal*dot(direction,basis.slice(0,3))/z,y=focal*dot(direction,basis.slice(3,6))/z;
      const edge=1-smooth(.92,1.35,Math.max(Math.abs(x)/(aspect*.5),Math.abs(y)/.5));
      if(edge<=0.)return;
      const visible=visibleSourceDisk(camera,direction,1/(pixelHeight*focal));
      // Atmospheric/cloud transmission is applied once by sourceAttenuation.
      // No saturation curve or independent boost for dim sources.
      const energy=pointImageFlux(magnitude,cssHeight,this.mode)*edge*visible;
      if(energy>0)candidates.push({id,x,y,energy,bv});
    };
    this.stars.forEach((star,id)=>{
      let direction=star.slice(0,3).map((x,i)=>x+star[i+3]*years);
      const length=Math.hypot(...direction);direction=direction.map(x=>x/length);
      const fixed=[0,1,2].map(i=>starToFixed[i]*direction[0]+starToFixed[i+3]*direction[1]+starToFixed[i+6]*direction[2]);
      add(id,fixed,star[6],star[7]);
    });
    for(let i=0;i<planets.length;i+=4)add(-1-i/4,planets.slice(i,i+3),planets[i+3],.45);
    candidates.sort((a,b)=>b.energy-a.energy);
    const desired=new Set(candidates.slice(0,3).map(c=>c.id));
    const delta=Math.abs(sceneTime-this.previousTime);
    const seek=!Number.isFinite(delta)||delta>15||aspect!==this.previousAspect;
    const step=seek?1:Math.min(1,delta/3); // 0.3 s at the default 10x playback.
    if(seek)this.slots=candidates.slice(0,3).map(c=>({id:c.id,weight:1}));
    while(this.slots.length<3)this.slots.push(null);
    for(let i=0;i<3;i++){
      const slot=this.slots[i];
      if(slot){
        slot.weight=Math.max(0,Math.min(1,slot.weight+(desired.has(slot.id)?step:-step)));
        if(!candidates.some(c=>c.id===slot.id)||slot.weight===0)this.slots[i]=null;
      }
    }
    for(let i=0;i<3;i++)if(!this.slots[i]){
      const next=candidates.find(c=>desired.has(c.id)&&!this.slots.some(s=>s?.id===c.id));
      if(next)this.slots[i]={id:next.id,weight:seek?1:step};
    }
    this.previousTime=sceneTime;
    this.previousAspect=aspect;
    const output=new Float32Array(12);
    this.slots.forEach((slot,i)=>{
      const source=candidates.find(c=>c.id===slot?.id);
      if(source&&slot)output.set([source.x,source.y,source.energy*slot.weight,source.bv],i*4);
    });
    return output;
  }
}
