# Orbital scene data and imagery

The renderer uses these local, reduced-resolution maps. No shader
code or assets from Julien Sulpis's GPL repository are included.

## Night lights

`night-tiles/` contains the global 500 m Black Marble 2016 grayscale imagery
(86,400 × 43,200 source pixels), encoded as sparse AVIF quality 80 tiles. The
renderer loads only visible night-side regions. See `docs/night-lights-streaming.md`
for the atlas layout, cache limits, filtering, verification and build command.
The grayscale source already isolates emitted light; no terrain-removal threshold
or reduced palette is applied. City color and exposure are set in the shader.

`earth-night.avif` and `earth-night-8k.avif` are derived from NASA's Black Marble
2016 global 3 km color map (13,500 x 6750). They remain as a mipmapped fallback
at the distant horizon, during tile loading, and when a tile cannot be fetched.

- Credit: NASA Earth Observatory / Joshua Stevens, using Suomi NPP VIIRS data
  from Miguel Roman, NASA Goddard Space Flight Center.
- Original: https://assets.science.nasa.gov/content/dam/science/esd/eo/images/imagerecords/144000/144898/BlackMarble_2016_3km.jpg
- Collection: https://science.nasa.gov/earth/earth-observatory/earth-at-night/
- Usage terms: https://www.nasa.gov/nasa-brand-center/images-and-media/
- Changes: isolated warm and bright neutral lights from the blue terrain
  backdrop at the source resolution, then downsampled to 8192 x 4096 and
  4096 x 2048. Grayscale emission, AVIF quality 65 to retain small light sources,
  effort 4, 8-bit, 4:4:4. Emission is isolated before mip generation so
  filtering does not cause a runtime color threshold to erase distant lights.

## Surface color and clouds

The renderer uses NASA sources directly:

The compact day-color overview at `mobile/day-2048.avif` is 2048 × 1024,
AVIF Q60, 4:4:4, 122,426 bytes, rebuilt from the original BMNG October plates.
It is used when the capped render target's longer edge is at most 1280 px and
detail tiles are enabled. Larger targets keep the 4K overview; expanding past
1408 px upgrades an already loaded 2K map. Night/cloud 2K candidates were rejected
after connected-phone comparisons. Their 4K maps, galaxy and terrain remain
unchanged. Build with `scripts/build-mobile-overviews.mjs`; comparison results
and nominal memory savings are in `docs/scene-optimization.md`.

- `earth-day-bmng.avif`: a 4096 × 2048 overview, AVIF quality 60, 4:4:4.
- `day-tiles/`: native 500 m detail from Blue Marble Next Generation, October
  2004. Eight 21600-square source plates form an 86400 × 43200 map. AVIF quality
  50, effort 2, 4:4:4; only nonuniform tiles are retained. The browser streams
  visible sunlit detail into a bounded cache. Full data: 6615 tiles, 70.68 MiB;
  this is not a page-load download.
- `earth-clouds-nasa-{4096,8192,16384}.avif`: single-channel coverage, AVIF quality
  55, effort 4. The source is a 43200 × 21600 mosaic of two 21600-square NASA
  cloud plates. Legacy comparison assets: 16K on desktop with a 16K-capable GPU, 8K on other desktop
  GPUs, 4K on mobile. The full-resolution sources have no polar observations;
  no synthetic polar coverage is invented.

Sources and credits:

- NASA Earth Observatory / Reto Stöckli and the Blue Marble team.
- Surface collection: https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/base-map/
- Surface plates: `https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-base/october/world.200410.3x21600x21600.{A1..D2}.jpg`
- Cloud collection: https://visibleearth.nasa.gov/images/57747/blue-marble-clouds
- Cloud plates: `https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57747/cloud.{W,E}.2001210.21600x21600.png`
- NASA media usage: https://www.nasa.gov/nasa-brand-center/images-and-media/

Build: `bun scripts/build-day-tiles.mjs /path/to/day` and
`bun scripts/build-day-cloud-maps.mjs /path/to/orbital-reference` (with `day/`
and `clouds/` subdirectories). Originals remain outside the repository.

The cloud map supplies optical coverage only. A synthetic 0.6–12 km vertical
profile, density erosion, solar shadow samples and view-ray integration produce
parallax, illuminated tops and internal shadows. This is illustrative weather,
not reconstructed weather for the replay date. Airglow is a separate emissive
shell around 90 km; the daytime atmosphere uses single Rayleigh scattering.
Exposure, source colors and highlight desaturation are photographic choices.
See `docs/earth-surface-rendering.md` for limitations and browser checks.

Legacy `earth-day[-8k].avif` and `earth-clouds[-8k].avif` are retained for the
comparison lab in the original repository; Earthlight does not include them. They derive from Solar System
Scope (https://www.solarsystemscope.com/textures/), CC BY 4.0
(https://creativecommons.org/licenses/by/4.0/), resized to 4K/8K and AVIF Q50.
Originals: `8k_earth_daymap.jpg` and `8k_earth_clouds.jpg` from that site's texture
download directory. `scripts/build-earth-maps.mjs` still rebuilds those legacy
maps and the current global night-light fallback.

## Star catalog

`stars-hyg.bin` is an adapted subset of **HYG v4.1**, copyright David Nash,
licensed under **Creative Commons Attribution-ShareAlike 4.0 International**.
This binary adaptation is distributed under the same CC BY-SA 4.0 license.

- Source: https://github.com/astronexus/HYG-Database
- CSV: https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/CURRENT/hygdata_v41.csv
- Field definitions: https://github.com/astronexus/HYG-Database/blob/main/hyg/README.md
- License: https://creativecommons.org/licenses/by-sa/4.0/
- Changes: excluded Sol and stars fainter than magnitude 7; converted Cartesian
  positions and velocities to distance-normalized float32; retained magnitude
  and B−V color index (missing color defaults to 0.65). No other data is retained.
- Rebuild: `python3 scripts/build-star-catalog.py /path/to/hyg_v41.csv`.
- Format: 15,598 records of eight little-endian float32 values: J2000 unit x/y/z,
  Cartesian vx/vy/vz divided by catalog distance (per Julian year), V magnitude,
  B−V. GPU positions advance by velocity times years since J2000 and normalize.

## Celestial calculations

Astronomy Engine 2.1.19, copyright Don Cross, MIT license. Used for precession,
nutation, apparent sidereal time, solar/lunar/planetary positions and magnitudes.
https://github.com/cosinekitty/astronomy
See `ASTRONOMY-ENGINE-LICENSE.txt` for the full license notice.


## Synthetic lens response

`optical-psf.bin` is generated by `bun scripts/build-optical-psf.mjs` from an
analytic iris at three openings using an FFT. It contains three 256 × 256 RGB8
log-encoded profiles in a 256 × 768 atlas, 589,824 bytes. Profiles share equal
radiant flux and interpolate in linear light; no third-party image or lens
data is used.
`src/data/optical-psf.json` records dimensions, display support, and integrated
energy for lunar convolution. Values decode as `max(0, 2^(24*v-24)-2^-24)`,
where `v` is a normalized byte. Rows increase with the shader's upward Y axis.

## Milky Way background

`milky-way.avif` and `milky-way-8k.avif` are derived from **NASA SVS Deep Star Maps 2020** by Ernie Wright.
It is a visualization of stellar catalog observations, not a generated nebula
or an individual photograph. The separate background excludes the bright
Hipparcos/Tycho stars, which the scene renders from HYG instead.

- Credit: NASA/Goddard Space Flight Center Scientific Visualization Studio.
  Gaia DR2: ESA/Gaia/DPAC.
- Collection and coordinate description: https://svs.gsfc.nasa.gov/4851/
- Source: https://svs.gsfc.nasa.gov/vis/a000000/a004800/a004851/milkyway_2020_4k_gal.exr
- 8K source: https://svs.gsfc.nasa.gov/vis/a000000/a004800/a004851/milkyway_2020_8k_gal.exr
- 16K detail source: https://svs.gsfc.nasa.gov/vis/a000000/a004800/a004851/milkyway_2020_16k_gal.exr
- Source SHA-256: `fad63b36aa632c691d521cd9d8b828de9d29b4c2784276eec44e54c6cb159a49`
- 8K source SHA-256: `d319113f35e45f7f66f2844f088639cc07cda74a5049299a6098d41e2ade3d28`
- 16K source SHA-256: `ee023f03e99466b3829117c15a001269ba32a3fecb6012d0b2d41f201c955351`
- Usage: public domain unless otherwise noted, per https://svs.gsfc.nasa.gov/help/.
  The source asset carries no separate restriction.
- Projection: 4096 × 2048 or 8192 × 4096 plate carrée, galactic coordinates. Longitude zero
  at the center, longitude increases leftward, north at the top. This is the
  galactic file corrected by NASA on 4 January 2021.
- Conversion: normalize EXR flux per pixel to the 4K pixel area (8K RGB × 4),
  then grade in linear RGB: luminance black point 0.0015, soft shadow toe
  0.012, brightness anchor 0.12, saturation 1.2. A source-luminance guide blurred
  by 0.7 degrees selects extended galactic structure with a smooth 0.004–0.020
  threshold. This suppresses faint background speckles before baking in the
  former 500% exposure (texture gain 5^(2/3), matching shader contrast 1.5).
  Highlights roll off above 0.65 instead of clipping abruptly. Clamp to
  [0, 1], gamma encode with exponent 1/2.2,
  AVIF quality 50, effort 4, 8-bit, 4:4:4 sampling via sharp 0.35.5; no resizing
  or invented structure. Output is 569,480 bytes for 4K and 2,797,831 bytes for
  8K. The shader applies display contrast/exposure separately.
  The 8K version uses the higher-resolution source, not an enlarged 4K image.
- Rebuild (requires ffmpeg/ffprobe):
  `bun scripts/build-milky-way.mjs /path/to/milkyway_2020_4k_gal.exr`
  or `bun scripts/build-milky-way.mjs /path/to/milkyway_2020_8k_gal.exr`.
- Streamed detail: `galaxy-tiles/` contains 346 AVIF tiles (21,634,563 bytes),
  cut from the 16384 × 8192 Galactic EXR, not upscaled. Each tile has a 512-pixel
  interior and 16-pixel gutters; the manifest omits empty regions. Source RGB
  is multiplied by 16 for the same 4K pixel-area normalization and grade above.
  Wrapped longitude and neighbouring source rows preserve the blurred guide
  across tile boundaries. A Laplacian detail residual (32-source-pixel blur)
  retains the overview's broad brightness and colour while adding 16K detail;
  this avoids resolution-dependent brightness shifts from the nonlinear grade.
  AVIF quality 65, effort 2, 4:4:4. Only visible tiles
  are fetched into a bounded atlas; the 4K image remains the overview.
  Rebuild: `bun scripts/build-galaxy-tiles.mjs /path/to/milkyway_2020_16k_gal.exr`.
  Decoding uses a temporary disk-backed float image, removed after conversion.

## Terrain and ocean mask

Copernicus GLO-90 supplies nearby 90 m relief through the fixed-origin
`/media/orbit/dem90/` route; the whole dataset is never bundled or resident.
`terrain-tiles/copernicus.json` lists available one-degree sources. Rebuild with
`bun scripts/build-terrain-availability.mjs`. GeoTIFF.js (MIT) decodes COGs in a
worker. Source: https://copernicus-dem-90m.s3.amazonaws.com/ (product guide:
https://copernicus-dem-30m.s3.amazonaws.com/readme.html).

Produced using Copernicus WorldDEM-90 © DLR e.V. 2010-2014 and
© Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by
the European Union and ESA; all rights reserved.

`terrain-tiles/` streams the native 21600 × 10800 ETOPO 60-arcsecond source
listed below. The sparse set contains 537 lossless PNG files (74,580,884 bytes),
fetched only for nearby visible land. Each 1144 × 572 image packs a 540-pixel
interior with 16-pixel gutters on the left and four numeric height mips on the
right. Heights are clamped to 0–9000 m and quantized to 8 m in RG; mip heights
are averaged before byte encoding. The ocean mask stays in the global DEM.
There is no vertical exaggeration. Rebuild:
`bun scripts/build-terrain-tiles.mjs /path/to/ETOPO_2022_v1_60s_N90W180_surface.tif`.

`earth-terrain-{4096,8192}.dem` are lossless gzip containers of numeric RGB mip
levels, **not color images**. Avoid a `.gz` extension: static servers may decode
it automatically before the renderer's explicit DecompressionStream.

- Elevations: [NOAA NCEI ETOPO 2022](https://www.ncei.noaa.gov/products/etopo-global-relief-model), ice surface, 60 arc seconds, 21600 × 10800 Float32 GeoTIFF.
  Source: https://www.ngdc.noaa.gov/mgg/global/relief/ETOPO2022/data/60s/60s_surface_elev_gtif/ETOPO_2022_v1_60s_N90W180_surface.tif
  SHA-256: `9d27d4b8ea8e76977e2988bca667d7c8fa68b927355feffcddd6b4875a7fd08e`.
- Coastline: Natural Earth 1:10m land, public domain.
  https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_10m_land.geojson
  SHA-256 of input: `1ac90796408bc6ad6911d69448485d3c4dbf2190370080368a09976e1c9f7416`.
- Resampled to 8192 × 4096 desktop / 4096 × 2048 mobile. Elevations clamp to
  0–9000 m, quantize in 8 m steps, and occupy two bytes. The third byte stores
  ocean fraction, rasterized separately so below-sea-level land stays land.
  Inland lakes are not modeled. Rows run south to north; longitude starts at −180°.
- Each mip level averages physical height **before** packing bytes. Ordinary
  generateMipmap on split height bytes would introduce elevation errors.
- Header: `DEM1`, uint32 little-endian width, height, level count; successive
  RGB byte levels follow. Packed height = `(R*256 + G)*8` metres; B/255 = ocean.
- Transfer: 13,626,978 bytes desktop; 3,952,126 bytes mobile. GPU storage is
  approximately 128/32 MiB if RGB is promoted to RGBA, including mipmaps.
- Build: `bun scripts/build-terrain-map.mjs /path/to/ETOPO.tif /path/to/ne_10m_land.geojson`.
  Full source files stay outside the repository.


## Progressive runtime assets (October 2026)

- `preview/{day,night,clouds,galaxy}.webp`: small derivatives of the credited
  runtime maps above; generated by `bun scripts/build-scene-previews.mjs`.
  These are loading previews, never the input for full-detail encodes.
- `preview/poster.webp`: 1280 × 859 capture of our orbital renderer near the
  opening moonrise, with page content hidden, resized/encoded as WebP. This
  avoids a gradient placeholder when WebGL or image requests are unavailable.
- `cloud-tiles/*.avif`: the same NASA western/eastern July 2001 cloud plates,
  resampled to a 16,384 × 8192 scalar field, split into 32 × 16 tiles with
  512-square interiors and 16-pixel true-neighbor gutters. AVIF Q65, effort 5.
  `bun scripts/build-cloud-tiles.mjs /path/to/orbital-reference` rebuilds them;
  `--resume` reuses existing tile files when continuing the same source/settings.
  The manifest records original source SHA-256 hashes. Only visible tiles load.
- `earth-terrain-{4096,8192}-v2.dem`: lossless re-encoding of the DEM1 containers
  described above. DEM2 keeps the same numeric mip chain and uses channel byte
  planes with row-wise horizontal prediction before gzip. Rebuild with
  `bun scripts/repack-terrain.mjs`; tests compare every decoded byte with DEM1.
  Heights, coast mask, and geographic alignment are unchanged.

See [the optimization report](../../../docs/scene-optimization.md) for codec
measurements, runtime budgets, limitations and reproduction commands.


`mobile/galaxy-2048.avif` is the optional `texture=compact` overview derived from
`milky-way.avif` with `scripts/prepare-galaxy-overview.mjs`. It keeps the existing
source attribution and grading; it reduces global diffuse-sky detail and nominal
texture storage. Catalog stars and streamed galaxy tiles are unchanged.

`modis-demo/` contains an isolated regional research dataset for
`/orbit/modis-demo/`, not production Orbit textures. Source: NASA GIBS Aqua MODIS
daily maps for June 1–3, 2025, 91–79 W / 32–20 S. The manifest records every WMS
URL, bounds, encoding and reconstruction assumptions. Rebuild with
`bun scripts/prepare-modis-demo.mjs` (download cache: `/tmp/orbit-modis-cache`).

The PNG numerical channels are decoded from the published GIBS palettes, not raw
Level-2 retrievals. Low/middle/high top-height groups are separate before height
filtering. Quality masks preserve missing retrievals and clear flags. Optional
`*-reconstructed.png` assets use an illumination-dependent ocean mask inferred
from the visible photograph, and nearest cloud properties within 24 pixels.
They may override conflicting coarse clear flags and must not be described as
measurements. The visible RGB photograph is only displayed as a reference.
Its intensity contributes to the optional mask, not directly to rendered color.
See the manifest for the inferred height relief and minimum-height assumptions.

[MODIS cloud algorithms](https://atmosphere-imager.gsfc.nasa.gov/products/cloud/algorithm-overview)
describe the retrieved quantities and limitations. NASA imagery credit applies
to the source references; these derived demonstration assets are not a forecast.


`modis-demo/orbit-patch.png` is a co-registered 2048² regional research texture
for the opt-in Orbit A/B (`cloudStudy=photo|modis`). See `orbit-patch.json` for
exact NASA GIBS URLs and channel encoding. The photo-derived coverage is
illumination-dependent; height/tau are broadly filtered quantized retrieval
previews. Missing properties are not interpreted as clear sky. Vertical layers
are illustrative. Generate with `scripts/prepare-modis-orbit.mjs` after the
MODIS demo importer. This texture is not part of default Orbit loading.
