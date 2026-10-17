import optics from '../data/optical-psf.json' with {type:'json'};
import {nightScale,nightScaleGlsl,perNightMode,type NightMode} from './physical-night.ts';
// Same scene-relative Pogson scale for point images and their lens reflections.
// The PSF is expressed in CSS pixels; a reflection kernel uses viewport-height
// coordinates, so its input is the integral divided by CSS height squared.
export const pointBrightness=(magnitude:number,mode:NightMode='current')=>.018*nightScale('stars',mode)*10**((5-magnitude)*.4);
export const pointImageFlux=(magnitude:number,cssHeight:number,mode:NightMode='current')=>pointBrightness(magnitude,mode)*optics.integral/Math.max(1,cssHeight*cssHeight);
export const pointBrightnessShaderFor=perNightMode(mode=>`float pointBrightness(float magnitude){return .018*${nightScaleGlsl('stars',mode)}*pow(10.,(5.-magnitude)*.4);}`);
