import { equatorialFrame } from './celestial-sky.ts';
import { dot, normalize, type issFrame } from './iss-orbit.ts';

const DAY=86400_000;
export const utcDay=(date:Date)=>Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate());
export const dayOfYear=(date:Date)=>Math.round((utcDay(date)-Date.UTC(date.getUTCFullYear(),0,1))/DAY);
export const daysInYear=(year:number)=>(Date.UTC(year+1,0,1)-Date.UTC(year,0,1))/DAY;

/** Calendar and orbit time share a rate, but changing lighting never moves the camera. */
export class SceneCalendar {
  private epoch:number;
  constructor(params:URLSearchParams,seconds:number,now=Date.now()){
    const raw=params.get('epoch'),saved=raw?Date.parse(raw):NaN;
    this.epoch=Number.isFinite(saved)&&saved>=Date.UTC(1900,0,1)&&saved<Date.UTC(2101,0,1)?saved:now-seconds*1000;
  }
  date(seconds:number){return new Date(this.epoch+seconds*1000);}
  set(date:Date,seconds:number){this.epoch=date.getTime()-seconds*1000;}
  reset(seconds:number,now=Date.now()){this.epoch=now-seconds*1000;}
  setDay(day:number,seconds:number){
    const date=this.date(seconds),time=date.getTime()-utcDay(date);
    this.set(new Date(Date.UTC(date.getUTCFullYear(),0,1)+Math.max(0,Math.min(daysInYear(date.getUTCFullYear())-1,day))*DAY+time),seconds);
  }
  setMinute(minute:number,seconds:number){this.set(new Date(utcDay(this.date(seconds))+Math.max(0,Math.min(1439,minute))*60_000),seconds);}
  write(params:URLSearchParams){params.set('epoch',new Date(this.epoch).toISOString());}
}

/** Retain the recorded ground track; recompute all celestial lighting for the chosen date. */
export function calendarFrame(frame:ReturnType<typeof issFrame>,date:Date):ReturnType<typeof issFrame>{
  const {sun}=equatorialFrame(date),normal=normalize(frame.camera),solar=dot(normal,sun);
  const distance=Math.hypot(...frame.camera);
  const phase=solar>.08?'Day':solar<-.12?'Night':dot(normal,equatorialFrame(new Date(date.getTime()+10_000)).sun)>solar?'Dawn':'Dusk';
  return {...frame,date,sun,solar,shadow:solar<-Math.sqrt(1-1/(distance*distance))?1:0,phase};
}
