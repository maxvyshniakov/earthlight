// One radiometric scale for the solar disk, atmosphere, ground and optics.
// Scene-relative irradiance; the camera grade is not an absolute lux calibration.
export const SOLAR_IRRADIANCE=2.2;
export const SOLAR_RADIUS=.00465;
export const SOLAR_RADIANCE=SOLAR_IRRADIANCE/(Math.PI*SOLAR_RADIUS**2);
export const SOLAR_SCATTER_FRACTION=.015;
// Veiling glare: two normalized Moffat (beta 2) kernels sharing the scatter
// fraction. Scale is the Moffat core radius in radians; in the frame it is
// scale x focal length, since the light scatters before it is focused.
export const VEIL_COMPONENTS=[{share:.8,scale:.015},{share:.2,scale:.08}] as const;
