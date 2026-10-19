import type { WheelDevice } from './flight-controls.ts';

export type InputDevicePreference='auto'|WheelDevice;
const COOKIE='earthlight-input-device';

const stored=():WheelDevice|null=>{
  try{
    const value=document.cookie.split('; ').find(part=>part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length+1);
    return value==='mouse'||value==='trackpad'?value:null;
  }catch{return null;}
};

/** Mouse or trackpad: detected from wheel events until the viewer chooses one,
 * which a cookie keeps for a year. Choosing Auto forgets it. */
export function createInputDevice(change:(device:WheelDevice,preference:InputDevicePreference)=>void,guess:WheelDevice='mouse'){
  let preference:InputDevicePreference=stored()??'auto',detected=guess;
  const device=()=>preference==='auto'?detected:preference;
  const notify=()=>change(device(),preference);
  const choose=(next:InputDevicePreference)=>{
    if(next===preference)return;
    preference=next;
    try{document.cookie=next==='auto'?`${COOKIE}=; path=/; max-age=0; samesite=lax`:`${COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;}catch{}
    notify();
  };
  return {
    get device(){return device();},
    get detected(){return detected;},
    get preference(){return preference;},
    /** The chosen device, which every wheel event is taken from; null while detecting. */
    forced:():WheelDevice|null=>preference==='auto'?null:preference,
    detect(next:WheelDevice){if(next!==detected){detected=next;notify();}},
    /** Choose a device; choosing the chosen one again goes back to detecting. */
    toggle:(next:WheelDevice)=>choose(preference===next?'auto':next),
    choose,
    notify,
  };
}
export type InputDevice=ReturnType<typeof createInputDevice>;
