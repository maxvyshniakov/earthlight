# Third-party notices

Earthlight's code is licensed under the [MIT License](LICENSE). That license
covers the code only. The imagery, catalogs, terrain and dependencies below
keep their own terms, and anyone reusing the scene data must follow them.

## Stars

`stars-hyg.bin` is an adapted subset of HYG v4.1, copyright David Nash,
distributed under [Creative Commons Attribution-ShareAlike 4.0 International](https://creativecommons.org/licenses/by-sa/4.0/).
[Source and license](https://github.com/astronexus/HYG-Database).
The adaptation excludes Sol and stars fainter than magnitude 7, converts
distance-normalized positions and velocities to float32, and retains visual
magnitude and B−V color. This binary adaptation remains under CC BY-SA 4.0.

## Inter

`public/fonts/inter-subset.woff2` is a subset of [Inter](https://rsms.me/inter/)
4.1, copyright The Inter Project Authors, under the SIL Open Font License 1.1
(`public/fonts/Inter-LICENSE.txt`). It keeps printable ASCII, a few quotes and
dashes, arrows and the ⇧ ⌥ ⌘ ⌃ ⌫ key symbols, weights 400–700 at the text optical
size, for the explorer's controls panel and key caps.

## NASA imagery

Night lights: NASA Earth Observatory / Joshua Stevens, using Suomi NPP VIIRS
data from Miguel Roman, NASA Goddard Space Flight Center. Black Marble 2016
imagery is resized, tiled, encoded and adjusted for emitted-light rendering.

Surface and clouds: NASA Earth Observatory / Reto Stöckli and the Blue Marble
team. Surface detail uses Blue Marble Next Generation October 2004 imagery;
cloud coverage uses the July 2001 composite. Derivatives are resized, tiled
and encoded. Cloud volumes are illustrative, not historical weather data.

Milky Way: NASA/Goddard Space Flight Center Scientific Visualization Studio,
Ernie Wright, [Deep Star Maps 2020](https://svs.gsfc.nasa.gov/4851/).
Gaia DR2: ESA/Gaia/DPAC. Maps are converted, graded and tiled.

See [NASA media usage guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/)
and [SVS usage terms](https://svs.gsfc.nasa.gov/help/). NASA, ESA and the named
contributors do not endorse Earthlight. Previews and the rendered poster
contain derivatives of these credited scene inputs.

## Terrain

Nearby relief uses Copernicus GLO-90 via a fixed-origin proxy. The complete
dataset is not bundled.

Produced using Copernicus WorldDEM-90 © DLR e.V. 2010-2014 and © Airbus Defence
and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and
ESA; all rights reserved.

[Copernicus DEM terms and attribution](https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM).

Global elevations: NOAA NCEI ETOPO 2022, ice-surface elevation, resampled and
quantized for rendering. [Dataset metadata and CC0-1.0 terms](https://www.ncei.noaa.gov/metadata/geoportal/rest/metadata/item/gov.noaa.ngdc.mgg.dem%3Aetopo_2022/html).
Ocean mask: Natural Earth 1:10m land polygons,
[public domain](https://www.naturalearthdata.com/about/terms-of-use/).

## Magnetic model and orbit

WMM2025: NOAA NCEI Geomagnetic Modeling Team and British Geological Survey,
DOI [10.25921/aqfd-sd83](https://doi.org/10.25921/aqfd-sd83).
Earthlight uses degree-one coefficients for an illustrative magnetic dipole,
not the complete model. [World Magnetic Model](https://www.ncei.noaa.gov/products/world-magnetic-model).

ISS orbital elements: [CelesTrak](https://celestrak.org/), snapshot saved
6 October 2026. This is a replay using saved elements, not a live tracking feed.

## Libraries

- Astronomy Engine, copyright Don Cross, MIT:
  [license](public/media/orbit/ASTRONOMY-ENGINE-LICENSE.txt).
- satellite.js, MIT:
  [license](public/media/orbit/SATELLITE-JS-LICENSE.txt).
- GeoTIFF.js, MIT:
  [license](public/media/orbit/GEOTIFF-LICENSE.txt).

Other installed dependencies retain the license notices distributed with them.

## Other data

The lens PSF is generated analytically by project scripts without third-party
lens imagery. Four legacy Solar System Scope day/cloud images are omitted
from the asset archive; historical rebuild scripts still describe their
separate CC BY 4.0 provenance.

Detailed source URLs, transformations and formats are recorded in
[the asset README](public/media/orbit/README.md).
