// One radiometric scale for the solar disk, atmosphere, ground and optics.
// Scene-relative irradiance; the camera grade is not an absolute lux calibration.
export const SOLAR_IRRADIANCE=2.2;
export const SOLAR_RADIUS=.00465;
export const SOLAR_RADIANCE=SOLAR_IRRADIANCE/(Math.PI*SOLAR_RADIUS**2);
export const SOLAR_SCATTER_FRACTION=.03;
// Veiling glare: normalized Moffat (beta 2) kernels sharing the scatter
// fraction. Scale is the Moffat core radius in radians; in the frame it is
// scale x focal length, since the light scatters before it is focused. The
// broad third kernel is contamination on the lens and the window in front of
// it: its scatter falls slowly with angle, so a heavily overexposed Sun sits
// in a haze a quarter of the frame across (docs/lab/lens-dirt-2026-10-16.md).
export const VEIL_COMPONENTS=[{share:.45,scale:.015},{share:.2,scale:.08},{share:.35,scale:.3}] as const;
// The rest of the frame scatters through the glare pyramid, whose coarsest
// level is narrower than the frame. It keeps the kernels it can draw; the
// broad contamination kernel, mostly beyond the frame and a near-uniform
// haze for anything fainter than the Sun, is left unmoved.
const FRAME_KERNELS=VEIL_COMPONENTS.filter(({scale})=>scale<.2);
const FRAME_SHARE=FRAME_KERNELS.reduce((sum,{share})=>sum+share,0);
export const FRAME_VEIL_COMPONENTS=FRAME_KERNELS.map(({share,scale})=>({share:share/FRAME_SHARE,scale}));
export const FRAME_SCATTER_FRACTION=SOLAR_SCATTER_FRACTION*FRAME_SHARE;
