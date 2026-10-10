// One radiometric scale for the solar disk, atmosphere, ground and optics.
// Scene-relative irradiance; the camera grade is not an absolute lux calibration.
export const SOLAR_IRRADIANCE=2.2;
export const SOLAR_RADIUS=.00465;
export const SOLAR_RADIANCE=SOLAR_IRRADIANCE/(Math.PI*SOLAR_RADIUS**2);
export const SOLAR_SCATTER_FRACTION=.015;
