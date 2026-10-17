# Orbital scene data and imagery

The renderer uses these local, reduced-resolution maps. No shader
code or assets from Julien Sulpis's GPL repository are included.

## Night lights

`night-tiles/` contains the global 500 m Black Marble 2016 grayscale imagery
(86,400 × 43,200 source pixels), encoded as sparse AVIF quality 80 tiles.
Its independent samples are 30″ (about 1 km): each value repeats in a 2 × 2
block aligned to the tiles, and the renderer interpolates that grid. The
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

### Lab: measured night radiance (`night-vnp46-tiles/`)

Regional only, loaded with `nightDetail=vnp46`, and not part of the release
(`assets:prepare` skips it). It has 24 tiles: Cleveland and Lake Erie (h09v04)
and Delhi (h25v06). See `docs/lab/night-vnp46-2026-10-17.md`.

- Source: NASA Black Marble VNP46A4 (Suomi NPP) and VJ146A4 (NOAA-20),
  Collection 2, lunar-BRDF-adjusted annual nighttime lights,
  `AllAngle_Composite_Snow_Free`, from LAADS DAAC (collection 5200).
  DOIs 10.5067/VIIRS/VNP46A4.002 and 10.5067/VIIRS/VJ146A4.002.
- Credit: NASA Black Marble, Román, M. O. et al. (2018), Remote Sensing of
  Environment 210, 113–143, doi:10.1016/j.rse.2018.03.017.
- Access: Earthdata login. LAADS asks each account to accept the product's
  terms once; record them before any release.
- Changes: the median of the 2022, 2023 and 2024 annual composites of both
  satellites. Radiance below 0.5 nW cm⁻² sr⁻¹ is set to 0. Over open water the
  shore's stray-light halo is subtracted. The result is stored as
  `255 ln(1 + L/0.25) / ln(1 + 20000)` in 8-bit single-channel AVIF q80.
  The originals (12 HDF5 granules, 1.82 GB) are kept outside the repository;
  their SHA-256 sums are in the tile manifest.

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
- Grade: flux normalized to the 4K pixel area, then graded in linear RGB:
  luminance black point 0.0015, soft shadow toe 0.012, brightness anchor 0.12,
  saturation 1.2. A source-luminance guide blurred by 0.7 degrees selects
  extended galactic structure with a smooth 0.004–0.020 threshold. This
  suppresses faint background speckles before baking in the former 500%
  exposure (texture gain 5^(2/3), matching shader contrast 1.5). Highlights
  roll off above 0.65 instead of clipping abruptly. Texels store displayed
  radiance R as R^(1/3.3); the shader decodes pow(texel, 3.3).
- Pyramid (since October 2026): `bun scripts/build-galaxy-tiles.mjs
  /path/to/milkyway_2020_16k_gal.exr` builds `milky-way.avif` (4096 × 2048,
  482,827 bytes), `milky-way-8k.avif` (2,259,084 bytes) and `galaxy-tiles/`
  (411 tiles, 26,909,001 bytes) from the 16K file alone. The grade is applied
  to the 16K flux averaged to 4K, where it was tuned. Its result is a local
  linear gain (radiance per unit flux), interpolated onto the 16K flux, so
  resolved detail keeps its true contrast. Every 4K and 8K texel is then the
  box average of that one 16K radiance field. Applied per 16K pixel instead,
  the toe erases faint light that the 4K grade keeps.
- Tiles: 512-pixel interiors with 16-pixel true-neighbor gutters, wrapped in
  longitude. Each file is 1088 × 544: level 0 on the left, and 272, 136, 68
  and 34 pixel box-averaged mip levels side by side at the top right, in atlas
  layout. The runtime uploads these levels as they are; manifest version 2
  (`mipmaps: "packed"`). Level 2 coincides with the 4K overview texels. Only
  tiles that are entirely black are omitted; the overview is black there too.
- Encoding: AVIF 4:4:4 via sharp 0.35.5, quality 50 and effort 4 for the
  overviews, quality 65 and effort 2 for tiles. Lossy coding smooths encoded
  texels, which pow(texel, 3.3) turns into lost radiance: plain q50 dims 10%
  of 16-texel blocks by half. Each image is therefore encoded up to four
  times. Before each new encode, the input is scaled by the locally lost
  radiance (5-pixel smoothing, damped). The build keeps the encode with the
  smallest mean log error over 8 × 8 blocks: 0.075 (4K) and 0.082 (8K), and
  a median of 0.061 for tiles.
- Earlier versions graded the NASA 4K/8K files directly
  (`scripts/build-milky-way.mjs`) and matched tile detail to them in encoded
  values. In displayed radiance, those tiles were 0.4–2.6 times as bright as
  the overview they replaced.
  See `docs/lab/galaxy-pyramid-2026-10-15.md`.
- Decoding uses a temporary disk-backed float image, removed after conversion.

## Moon surface

`moon/moon-{1024,2048,4096}.webp` are equirectangular lunar maps derived from
NASA SVS's **CGI Moon Kit**. The explorer loads one only while a resolved Moon
(at least 5 CSS px in radius) is on screen. The tier is the smallest giving one
texel per device pixel at the disk centre: 1K at 20× on DPR 1, 2K at 20× on
DPR 2 in an 800 px tall view, and 4K only on very tall high-DPR views. At the
50× limit the same view takes 2K on DPR 1 and 4K on DPR 2; 4K stays at or
above one texel per pixel up to about 2,300 device pixels of height. These
maps never join the startup plan or the background package.

- Credit: NASA's Scientific Visualization Studio (Ernie Wright, USRA; Noah
  Petro, NASA/GSFC). Colour: LRO LROC WAC colour mosaic, Arizona State
  University. Elevation: LRO LOLA.
- Collection: https://svs.gsfc.nasa.gov/4720/
- Colour source: https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_16bit_srgb_4k.tif
  (2025 version, 4096 × 2048, 16-bit sRGB). SHA-256
  `9731fa8af425b6c2f88f277ecca82bf8c603f3743894f64ed7b25c5bfefa22ff`.
- Elevation source: https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/ldem_16_uint.tif
  (5760 × 2880, unsigned half-metres offset by +10 km). SHA-256
  `45a2b32d56e81ed30db07fead8abc842b249b6511219d9ca2c53f81bc2dc5d62`.
- Usage terms: https://svs.gsfc.nasa.gov/help/ and
  https://www.nasa.gov/nasa-brand-center/images-and-media/
- Projection: longitude −180°…180°, east-positive, left to right; latitude +90°
  at the top; 0° at the mean sub-Earth point. Checked against Mare Crisium
  (+59°, +17°) and Tycho (−11°, −43°). The renderer orients it with
  astronomy-engine's IAU rotation model (`RotationAxis(Body.Moon)`), whose
  sub-Earth point matches `Libration()` to within 0.03°.
- RGB: the colour map decoded to linear light, chroma reduced to 40%,
  area-averaged to each tier, then stored with a pure 2.2 gamma. WebP quality
  86, lossy. SVS describes the map as "optimized for aesthetics, not science"
  and its maria are bluer than the Moon looks to a camera; the chroma reduction
  is our photographic choice. The renderer divides by the global mean colour,
  so the average lunar colour stays neutral.
- Alpha: LOLA height, area-averaged in kilometres, 8-bit linear over
  −9…+11 km (78 m steps), stored losslessly (`alphaQuality` 100, verified
  byte for byte by the build). Decode with `premultiplyAlpha: 'none'`.
- `moon/moon.json`: tiers, height range, mean linear colour, a 128 × 64
  relative-luminance table for the renderer's flux normalization, and the
  source hashes.
- Polar latitudes beyond ±70° come from SVS's lower-resolution fill, as
  described on the collection page.

Rebuild (about 2.5 minutes): `bun scripts/build-moon-maps.mjs
lroc_color_16bit_srgb_4k.tif ldem_16_uint.tif`. Keep the sources outside the
repository. Rendering and measurements: `docs/lab/lunar-surface-2026-10-16.md`.

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
  `preview/clouds-512.avif` (AVIF Q55, about 18 KB) is the first light's cloud
  layer, from the same script and source.
  resampled to a 16,384 × 8192 scalar field, split into 32 × 16 tiles with
  512-square interiors and 16-pixel true-neighbor gutters. AVIF Q65, effort 5.
  `bun scripts/build-cloud-tiles.mjs /path/to/orbital-reference` rebuilds them;
- `posters/<n>.webp`: 840 × 360 captures of our renderer's background opening
  frame at the loading defocus and first light, without the celestial sky, for
  subsolar points every 5° of longitude at five latitudes. Alike posters share a file;
  `src/data/background-posters.json` maps grid cells to files.
  `bun scripts/render-posters.mjs <base-url>` renders them through `/lab/poster`
  of a running build. They derive from the credited maps above.
  `--resume` reuses existing tile files when continuing the same source/settings.
  The manifest records original source SHA-256 hashes. Only visible tiles load.
- `earth-terrain-{4096,8192}-v2.dem`: lossless re-encoding of the DEM1 containers
  described above. DEM2 keeps the same numeric mip chain and uses channel byte
  planes with row-wise horizontal prediction before gzip. Rebuild with
  `bun scripts/repack-terrain.mjs`; tests compare every decoded byte with DEM1.
  Heights, coast mask, and geographic alignment are unchanged.
- `earth-terrain-{4096,8192}-v3.dem` (DEM3, 1,108,060 and 3,385,488 bytes): the
  DEM2 bytes with empty level-0 height planes; `bun scripts/sparse-terrain.mjs`
  derives them from the published DEM2 files. The decoder repeats level-1
  heights into level 0, so maxima taken from level 0 still bound every mip.
  The coastline mask and all mip levels are byte-identical to DEM2. The
  explorer uses DEM3 only with terrain streaming, whose 1.85 km and 92 m tiles
  replace global heights wherever level 0 would resolve. Paired renders
  (coast glint, fjords, Himalaya, high orbit, narrow viewport) differ in at
  most 0.0001% of pixels.
- `stars-hyg-v2.bin` (230,911 bytes) and `optical-psf-v2.bin` (84,259 bytes):
  gzipped transfer copies of `stars-hyg.bin` and `optical-psf.bin`, made by
  `bun scripts/pack-startup-assets.mjs`. The PSF decompresses to identical
  bytes. The catalog uses the STR1 column format of `src/scripts/star-pack.ts`:
  24-bit longitude and latitude (under 0.1 arcsec), velocities as half floats
  of value × 2^20, and magnitude and colour index in thousandths. It unpacks
  to the same eight-float layout; `scripts/star-pack.test.mjs` bounds the
  errors. `stars-hyg-m5-v2.bin` (25,158 bytes) holds the 1,637 stars to
  magnitude 5 in the same format, for the first light.

See [the optimization report](../../../docs/scene-optimization.md) for codec
measurements, runtime budgets, limitations and reproduction commands.


`mobile/galaxy-2048.avif` is the optional `texture=compact` overview derived from
`milky-way.avif` with `scripts/prepare-galaxy-overview.mjs`: 2 × 2 averages of
displayed radiance, AVIF quality 80. It keeps the existing source attribution
and grading; it reduces global diffuse-sky detail and nominal texture storage.
Catalog stars and streamed galaxy tiles are unchanged.

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

`cloud-properties/2026-09-22/` holds measured cloud properties for the opt-in
lab study `cloudStudy=global`: `overview.avif` (4,096 × 2,048 RGBA: opacity,
cloud-top height / 16 km, ice fraction, observed fraction), `tiles/` (2.4 km
opacity in the cloud-atlas layout) and `manifest.json` (every GIBS layer, URL,
palette, encoding, coverage and byte count). Opacity is the albedo
cτ / (1 + cτ) of NOAA-20 VIIRS optical thickness
(`VIIRS_NOAA20_Cloud_Optical_Thickness`), c = 0.13 for liquid and 0.2165 for
ice, with top heights from `VIIRS_NOAA20_Cloud_Top_Height_Day` and phase from
Aqua and Terra MODIS (`MODIS_*_Cloud_Phase_Optical_Properties`), all NASA GIBS
for that date and decoded from the published palettes. Clouds with a height
but no retrieved thickness take an albedo inverted from the same overpass's
true colour (`VIIRS_NOAA20_CorrectedReflectance_TrueColor`) against the local
clear sky, calibrated on the retrieved pixels, over dark surfaces within 60° of
the equator; elsewhere that day's median MODIS Aqua partly cloudy thickness.
Nothing fills unobserved areas. Credit: NASA GIBS (ESDIS) and the NASA Atmosphere SIPS
cloud products; NASA data carry no restriction on use. Build with
`bun scripts/prepare-cloud-properties.mjs [cache]`. `assets:prepare` skips
this directory; it is not part of a release.
