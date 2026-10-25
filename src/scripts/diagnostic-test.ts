import type {ObserverFrame} from './flight-navigation';
import {issFrame} from './iss-orbit';
/** Fixed dates/poses make the guided test comparable; rendering settings remain
 * the user's and are recorded. It never writes navigation or URL state. */
export function diagnosticTestFrame(seconds:number):(ObserverFrame&{focal:number})|null{
 if(seconds<0||seconds>=60)return null;
 const segment=Math.floor(seconds/20),within=seconds%20;
 const pose=issFrame([2488.1,4156.13,1000][segment],.45,{yaw:segment===2?(within/20-.5)*90:0,pitch:segment===1?-35:0},0);
 return {...pose,focal:1.25};
}
export function diagnosticTestPhase(seconds:number){return seconds<20?'day · 1/3':seconds<40?'surface · 2/3':seconds<60?'night turn · 3/3':'free';}
