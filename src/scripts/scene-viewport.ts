import { EARTH_RADIUS_KM } from './iss-orbit.ts';

/** Keep the first-screen horizon relative to the small viewport, while the
 * render surface covers the large viewport behind retractable browser bars. */
export function sceneComposition(scrollY:number, smallHeight:number, renderHeight:number, page:boolean) {
  if(!page)return {limb:.138,offset:0,altitudeLift:0};
  const progress=Math.max(0,Math.min(1,scrollY/Math.max(1,smallHeight*.75)));
  const eased=progress*progress*(3-2*progress);
  const initialLimb=1-.78*Math.min(1,smallHeight/Math.max(1,renderHeight));
  // Raise the camera radially, keeping its opening pitch. Solve the lift at
  // a representative ISS altitude so the limb ends 16% below the frame.
  const distance=1+420/EARTH_RADIUS_KM;
  const depression=Math.acos(1/distance);
  const targetDepression=depression+Math.atan(.66/1.25)-Math.atan((.5-initialLimb)/1.25);
  const lift=(1/Math.cos(targetDepression)-distance)*EARTH_RADIUS_KM;
  return {limb:initialLimb,offset:90*eased,altitudeLift:lift*eased};
}

export function sceneBufferSize(width:number,height:number,dpr:number,quality:number,inspection=false) {
  const scale=Math.min(dpr||1,inspection?2:1.5,Math.sqrt((inspection?4_800_000:1_800_000)/Math.max(1,width*height)))*quality;
  return {width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale))};
}

// A tested overview tier; fine ground detail still follows projected texel
// footprints in SurfaceTiles. Without streamed detail keep the 4K fallback.
export function compactSurfaceOverview(width:number,height:number,streamDetail:boolean) {
  return streamDetail&&Math.max(width,height)<=1280;
}


/** Buffer pixels per CSS pixel for a viewport at a settled quality. */
export function bufferDensity(width:number,height:number,dpr:number,quality:number) {
  return sceneBufferSize(width,height,dpr,quality).width/Math.max(1,width);
}

/** A defocused image needs only enough pixels to resolve its blur. Pick the
 * smallest tier whose blur radius still spans FOCUS_BLUR_PIXELS buffer pixels
 * (density: buffer pixels per CSS pixel when settled). Below 0.8 CSS px of
 * blur, before the image reads as sharp, the full buffer returns. */
export const FOCUS_SCALES=[.35,.5,.6,.7,1],FOCUS_BLUR_PIXELS=2.5;
export function focusRenderScale(radius:number,density=1.5) {
  if(radius<=.8)return 1;
  const needed=FOCUS_BLUR_PIXELS/(radius*Math.max(.1,density));
  return FOCUS_SCALES.find(scale=>scale>=needed)??1;
}
/** Grain cells are one CSS pixel, or one buffer pixel when those are larger.
 * Keep the settled noise per CSS area on a reduced loading buffer. */
export function focusGrainScale(radius:number,density=1.5) {
  const cell=(d:number)=>Math.max(1,1/Math.max(.01,d));
  return cell(density)/cell(density*focusRenderScale(radius,density));
}
