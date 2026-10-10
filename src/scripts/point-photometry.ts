import optics from '../data/optical-psf.json' with {type:'json'};
// Same scene-relative Pogson scale for point images and their lens reflections.
// The PSF is expressed in CSS pixels; a reflection kernel uses viewport-height
// coordinates, so its input is the integral divided by CSS height squared.
export const pointBrightness=(magnitude:number)=>.018*10**((5-magnitude)*.4);
export const pointImageFlux=(magnitude:number,cssHeight:number)=>pointBrightness(magnitude)*optics.integral/Math.max(1,cssHeight*cssHeight);
export const pointBrightnessShader='float pointBrightness(float magnitude){return .018*pow(10.,(5.-magnitude)*.4);}';
