# Clouds from measured properties for one day, 2026-10-17

Every cloud in the scene is reconstructed from one coverage image, NASA's Blue
Marble cloud plates of July 2001, under a synthetic vertical profile. Cirrus,
stratocumulus decks and deep convection all get the same shape. This study
replaces the plates, opt-in, with measured cloud-top height, optical thickness
and phase for the whole globe on one date, and compares the result with
whole-disc and ISS photographs of that date.

`cloudStudy=global` turns it on. The explorer's study panel switches between
the measured clouds and the calibrated plates, jumps to the three comparison
views, and toggles a diagnostic (`cloudStudyView=quality`).

## Date and sources

**22 September 2026.** At the equinox both poles are lit, so daytime
retrievals reach almost pole to pole. DSCOVR EPIC imaged Africa at 11:20 UTC,
and the ISS crew photographed Chad, Egypt and the Levant between 11:13 and
11:21 UTC on the same day, at the same time as the EPIC frame.

| Use | GIBS layer | Product |
| --- | --- | --- |
| Optical thickness | `VIIRS_NOAA20_Cloud_Optical_Thickness` | CLDPROP_L2_VIIRS_NOAA20, 1 km |
| Cloud-top height | `VIIRS_NOAA20_Cloud_Top_Height_Day` | CLDPROP_L2_VIIRS_NOAA20, 1 km |
| Observed area | `VIIRS_NOAA20_CorrectedReflectance_TrueColor` | VIIRS corrected reflectance |
| Phase (ice fraction) | `MODIS_Aqua_Cloud_Phase_Optical_Properties`, then `MODIS_Terra_…` | MYD06/MOD06, 1 km |
| Thickness of partly cloudy pixels | `MODIS_Aqua_Cloud_Optical_Thickness_PCL` | MYD06 partly cloudy retrieval |

All layers come from NASA GIBS for `TIME=2026-09-22`, read through its WMS in
EPSG:4326 and decoded through the published palettes
(`MODIS_VIIRS_Cloud_Top_Height`, `MODIS_VIIRS_Cloud_Optical_Thickness`,
`MODIS_Cloud_Phase_Optical_Properties`). They are quantized palette values,
not raw Level-2 files: optical thickness in about 250 logarithmic steps, top
height in 50 m steps up to a single 12 km+ class. NASA data carry no
restriction on use; credit NASA GIBS (ESDIS) and the NASA Atmosphere SIPS
cloud products. `cloud-properties/2026-09-22/manifest.json` lists every layer,
URL pattern, palette and encoding.

**One sensor draws every cloud.** NOAA-20 alone covers the daytime globe in
one day: its 3,040 km swath leaves no gaps at the equator, and only 0.34% of
the globe (both poles beyond the daytime swaths) stays unobserved. Filling from
Suomi NPP would add 0.07% and Aqua MODIS 0.18%, both near the poles and at
other times of day, so they were left out. GIBS keeps geostationary infrared
(GOES, Himawari Band 13) for about two days only, so it cannot fill a date this
old. Every place is therefore seen once, at about 13:30 local solar time. The
picture is a mosaic of local afternoons. Along the date line, observations
about 24 hours apart meet.

MODIS supplies only phase. Aqua (afternoon, 1 to 1.5 hours from NOAA-20)
covers 76% of the cloudy phase pixels, Terra (morning) the remaining 24%.
Where neither saw a cloud, the nearest measured phase is used.

## What the data says

Of the globe (area-weighted, 1.2 km pixels):

- 40.0% cloud with retrieved optical thickness and top height;
- 24.5% cloud that VIIRS detected and placed (top height) without an optical
  thickness, mostly partly cloudy pixels at broken-cloud edges and in trade
  cumulus, and the low Sun near the poles;
- 35.5% clear; 0.34% not observed.

Measured clouds by type (ISCCP-style: top below 3.2 / 6.5 km, optical
thickness below 3.6 / 23), percent of the globe:

| Top | Thin | Medium | Thick |
| --- | --- | --- | --- |
| High | 4.2 cirrus | 8.6 cirrostratus | 3.3 deep convection |
| Middle | 1.0 altocumulus | 4.1 altostratus | 1.9 nimbostratus |
| Low | 4.1 cumulus | 10.4 stratocumulus | 2.4 stratus |

## Encoding and shape

`scripts/prepare-cloud-properties.mjs` fetches the 1.2 km grid
(32,768 × 16,384) in 16 chunks and writes:

- **Opacity**, the plane-parallel albedo of the retrieved optical thickness
  for a conservative cloud with asymmetry 0.85 and two-stream diffusivity:
  R = 0.13τ / (1 + 0.13τ). It averages linearly over area, unlike τ, so a pixel
  that is half cloud stores half the albedo. The renderer's column optical
  depth is −ln(1 − R) = ln(1 + 0.13τ), so a nadir view hides the ground by the
  measured albedo. Detected clouds without a thickness take τ = 1.32, the same
  day's median MODIS Aqua partly cloudy retrieval within 60° of the equator.
- **Tiles**: opacity at 2.4 km in the cloud-atlas layout (32 × 16 tiles,
  AVIF quality 65), streamed like the plates' tiles.
- **Overview**: 4,096 × 2,048 RGBA AVIF: opacity, top height (opacity
  weighted), ice fraction and the observed fraction. Height and phase extend
  from the nearest cloud into clear texels so filtering never pulls a cloud
  edge toward the ground; opacity alone decides where cloud exists.

The shader (`src/scripts/cloud-properties.ts`) infers what is not measured:
the base. Liquid decks are 0.25 km thick, growing to 2.5 km at τ ≈ 56. Ice is a
1.5 km sheet, deepening down to a 1.5 km base when the cloud is both thick
(τ 6 to 30) and high (top 6 to 9 km): deep convection. Mass follows a 6z(1−z)
profile between base and top, integrated over each ray interval, so thin decks
keep their column however coarsely a ray steps. The clouds do not drift: they
stay where they were measured. There is no procedural shape noise. Unobserved
places render without cloud; the diagnostic hatches them and colours clouds
low (green), middle (amber) and high (violet).

## Comparison

Views (`cloudPropertiesURL` in `cloud-properties.ts`): **disc**, EPIC's
11:20 UTC frame from 50,000 km with a 2.9× lens; **2,000 km** over the Angola
coast at 11:20 UTC; **ISS**, 420 km over Chad, looking north as in
ISS075-E-150512 (11:13:13 UTC, Nikon Z 9, 50 mm). Each was rendered with
the measured clouds, `clouds=calibrated` and the default Balanced, at
1,200 × 800, manual exposure 0 EV, raymarched self-shadows for every variant.
Frames were viewed in the browser and are not committed; reproduce them with
the command below.

- **Disc against EPIC.** The measured clouds draw this day's weather: the
  convective clusters across the Sahel and Congo basin, the stratocumulus deck
  off Angola and Namibia, the Southern Ocean frontal bands, cloud over the
  Mediterranean. The plates draw a July 2001 pattern, with an ITCZ band across
  the Sahel that EPIC does not show. The measured clouds are softer: more
  grey veil, fewer brilliant cores. EPIC's convective cores are whiter.
- **2,000 km against the NOAA-20 true colour of the same overpass.** Deck
  edges, the clear coastal strip and the clear Namibian desert sit where the
  photograph has them. The diagnostic separates the low stratocumulus over the
  ocean from high cloud over land. Thin cirrus and the partly cloudy pixels
  render as flat grey veils with pixel-sharp edges where the photograph shows
  bright, broken cumulus fields.
- **ISS against ISS075-E-150512.** The Tibesti massif lines up; the line of
  cumulus to the south-east and the cloud on the northern horizon appear where
  the photograph has them. The plates put almost nothing there. The small
  cumulus cells in the foreground of the photograph are missing: they are
  below the 1 km retrieval or grew in the hour before the overpass. The dust
  plume is aerosol, which the scene does not draw.

**Opacity budget.** The latitude-weighted mean nadir opacity of the measured
overview is 0.243. The calibrated plates give 0.233 and Balanced 0.128.
Two independent routes, the radiative-transfer albedo of measured optical
thickness and the composite NASA made from the plates, agree within 4%; this
supports the calibrated magnitude. The distributions differ: 20% of the
measured globe sits at opacity 0.1 to 0.2 (partly cloudy pixels and thin
cirrus) against 9% for Calibrated, and 3% exceeds 0.8 against 6%.

## Storage and GPU

| | Plates (Balanced, Calibrated) | Measured, one day |
| --- | --- | --- |
| Overview file | 0.79 MB (4K luminance AVIF) | 4.20 MB (4K RGBA AVIF) |
| Tiles, all | 14 MB | 26.7 MB (512 tiles) |
| Startup transfer, all assets | 5.50 MB | 8.91 MB |
| Tiles streamed, disc / 2,000 km / ISS | 0.87 / 0.79 / 0.37 MB | 1.78 / 1.55 / 0.74 MB |
| Overview GPU, with mips | 11 MB | 45 MB |
| Tile atlas GPU, desktop | 19 MB | 19 MB |

Measured opacity is noisier than the smooth plates, so each tile costs twice as
many bytes at the same AVIF quality; quality 50 would cut tiles by a third with
6/255 more error. The RGBA overview is lossy AVIF 4:4:4 at quality 80 (lossless
was 17 MB): opacity RMS error 6/255, height 230 m, and tiles replace its
opacity below about 10 km per pixel. A year of daily data would be about
11 GB. GPU time is not higher: in interleaved runs the measured clouds were
faster than Calibrated in 8 of 9 back-to-back pairs (one map read per sample
instead of two), but other sessions shared the GPU and absolute times ranged
from 10 to 92 ms, so no figure is quoted. The measured study turns off the
cached self-shadow atlas, which assumes the plates' drift; all comparison
frames therefore raymarched shadows.

## Go / no-go

**Go for measured properties as the source of cloud types; no-go for making
this build the default.** It is the first version of the scene whose clouds
match a photograph of the same day at every scale tested, with distinct low
decks, high sheets and deep convection placed by data. Before it can replace
the plates:

1. Partly cloudy pixels (a quarter of the globe) need a better treatment than
   one median thickness: they make the grey veils. MODIS partly cloudy
   retrievals exist per pixel, and the VIIRS cloud mask distinguishes probably
   cloudy from cloudy; neither is in GIBS for VIIRS.
2. Bright cores are under-represented next to EPIC. Check whether that is
   EPIC's display stretch or the scene's lighting of tall columns before
   changing the albedo relation.
3. Tiles should be about 15 MB: a lower AVIF quality or a dedicated encoding.
4. The self-shadow atlas needs a no-drift mode so measured clouds can use it.
5. Choosing the date should follow the scene's `epoch`, with this day as the
   default, and swath edges and the date-line seam need a review in motion.

Items 1 to 4 are taken up in the
[second iteration](cloud-properties-iteration-2026-10-17.md).

## Reproduce

```bash
bun scripts/prepare-cloud-properties.mjs /tmp/earthlight-cloud-properties-cache
```

```bash
CLOUD_VARIANTS=global,calibrated,balanced,quality bun scripts/compare-cloud-properties.mjs http://127.0.0.1:4411 /tmp/cloud-properties
```

The first downloads about 550 MB of GIBS PNGs into the cache and writes
`public/media/earthlight/cloud-properties/2026-09-22/`; nothing is published.
References: EPIC `epic_1b_20260922112448` (epic.gsfc.nasa.gov, natural
colour), ISS075-E-150512 and -150529 from the Gateway to Astronaut Photography
of Earth (eol.jsc.nasa.gov), and the NOAA-20 true colour of the same day.
