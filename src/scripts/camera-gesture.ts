/** Intent thresholds for two-finger touch and browser trackpad gestures.
 * Inputs are displacement from this gesture's start, in pixels, log scale and
 * radians. Once another channel is active, a larger movement is deliberate.
 * Activation rebases that channel: the dead zone never jumps into the camera. */
export function createCameraGesture({looking=false}:{looking?:boolean}={}){
  let lensing=false,rolling=false,previousScale=0,previousRotation=0;
  return {
    update({travel=0,scale=0,rotation=0,allowRoll=true}:{travel?:number;scale?:number;rotation?:number;allowRoll?:boolean}){
      looking||=travel>((lensing||rolling)?30:12);
      const lens=lensing?scale-previousScale:0,roll=rolling&&allowRoll?rotation-previousRotation:0;
      lensing||=Math.abs(scale)>((looking||rolling)?0.30:0.14);
      rolling||=allowRoll&&Math.abs(rotation)>((looking||lensing)?0.30:0.18);
      previousScale=scale;previousRotation=rotation;
      return {look:looking,lens,roll,lensActive:lensing,rollActive:rolling};
    },
  };
}
