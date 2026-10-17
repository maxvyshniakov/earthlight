# Measured clouds, second iteration, 2026-10-17

[The first study](cloud-properties-2026-10-17.md) drew 22 September 2026
from NOAA-20 VIIRS optical thickness and top height (`cloudStudy=global`). It
was a go for the measured route and a no-go for the default, with four work
items: grey veils from partly cloudy pixels, dim convective cores next to
DSCOVR EPIC, 26.7 MB of tiles, and no cached self-shadows. This note takes
each in turn, with before and after numbers. Nothing was published and the
study stays opt-in.

Comparison frames use `scripts/compare-cloud-properties.mjs` at 1,200 × 800,
manual exposure 0 EV, against EPIC `epic_1b_20260922112448` (11:20 UTC) and
the NOAA-20 true colour of the same overpass. Frames were viewed and are not
committed.

## 1. Partly cloudy pixels

**Before.** 24.5% of the globe is cloud that VIIRS detected and placed (a top
height) without retrieving an optical thickness. All of it took τ = 1.32, an
opacity of 0.146: flat grey plateaus with pixel-sharp edges. 20.2% of the
globe sat at opacity 0.1 to 0.2 (Calibrated plates: 9%).

**What those pixels are.** In the 4.9 km maps (latitude-weighted):

- the polar caps beyond about 65°, where the Sun is low and the surface is ice;
- broken cumulus and deck edges in the subtropics;
- bright desert, and the Saharan dust plume off West Africa, which the cloud
  mask flags as cloud (the cloud-top height exists, the thickness does not).

Their cloud tops are not only low: the median is 3.6 km and a quarter are
above 7.9 km.

**MODIS at the same place is rare.** Of the 24.5%, MODIS Aqua has a partly
cloudy thickness (`MODIS_Aqua_Cloud_Optical_Thickness_PCL`) at the same 4.9 km
sample for 1.4% of the globe, a standard Aqua thickness for 6.8%, a Terra
partly cloudy thickness for 0.7%, and nothing for 15.3%. Aqua passes 1 to
1.5 hours after NOAA-20, longer than a cumulus cell lives, so even a matching
pixel describes another cloud. GIBS publishes no partly cloudy retrieval or
cloud mask class for VIIRS. MODIS cannot supply these pixels.

**The overpass's own reflectance can.** The Corrected Reflectance true colour
of the same NOAA-20 overpass (`VIIRS_NOAA20_CorrectedReflectance_TrueColor`,
fetched at the same 1.2 km grid as JPEG, 128 MB) is a published piecewise
linear enhancement of Rayleigh-corrected reflectance. Its red band (VIIRS I1,
0.64 µm) is inverted to reflectance r. A cloud of albedo A over a surface of
reflectance s reflects s + A(1 − s)²/(1 − As), so

A = d / ((1 − s)² + d·s), d = max(0, r − s).

The clear sky s is the median red reflectance of observed, cloud-free 4.9 km
pixels in 157 km blocks, extended into overcast blocks and interpolated.

The inversion was checked against the 40% of pixels that do have a retrieved
thickness, over dark surfaces (s ≤ 0.12) within 50° of the equator, at 1.2 km:

| Retrieved τ | 1.0 | 2.0 | 3.0 | 4.9 | 7.9 | 12.4 | 20.3 | 31.7 | 50.7 | 86.5 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Albedo from reflectance | 0.12 | 0.17 | 0.21 | 0.29 | 0.40 | 0.50 | 0.62 | 0.72 | 0.79 | 0.86 |
| Albedo 0.13τ/(1 + 0.13τ) | 0.12 | 0.21 | 0.28 | 0.39 | 0.50 | 0.61 | 0.72 | 0.80 | 0.87 | 0.92 |

It tracks the retrieval monotonically, 0.06 to 0.11 low in the middle of the
range. The build therefore calibrates it on the day's own retrieved pixels
(mean inverted albedo against mean stored albedo per thickness bin, interpolated)
and uses it only where it was checked: over dark surfaces (s ≤ 0.15) within 60°
of the equator. Deserts, snow, sea ice and the polar caps keep the median
τ = 1.32. In the dust plume the clear-sky reference is dusty too, so the dust
gains almost no opacity: most of its pixels invert below 0.03.

**After.** 18.2% of the globe now takes its opacity from reflectance and
6.3% keeps the median, now with the phase-aware coefficient (section 2), so
mostly polar ice cloud at 0.18. The reflectance-based pixels average 0.148,
almost exactly the old flat 0.146: two independent routes agree on the mean,
and the change is in the distribution. In the South Atlantic and southern
African chunks the 10th, 50th and 90th percentiles are 0.00, 0.06 and 0.44:
mostly faint, with bright broken cells, instead of one veil. Over the globe:

| | Mean nadir opacity | Opacity 0.1–0.2 | Opacity > 0.8 |
| --- | --- | --- | --- |
| Before | 0.243 | 20.2% | 3.0% |
| After | 0.259 | 10.6% | 5.3% |
| Calibrated plates | 0.233 | 9% | 6% |

(4K overview, latitude-weighted.) The mean rises by 0.016, almost all of it from
the ice relation (measured cloud 0.221 against 0.206 with the liquid relation
throughout); the manifest's `budget` records the split. In the disc the grey
veil over the Atlantic off West Africa is mostly gone. At 2,000 km the flat
grey plateaus at deck edges and over the Congo break into structured cloud.
Pixel-sharp edges remain where the cloud mask itself is sharp.

## 2. Dim convective cores against EPIC

Method: the EPIC frame (orthographic from L1, north up, disc found by
threshold) and the disc render (perspective, 50,000 km, lens 2.9) were
registered to latitude and longitude. Within 40° of the sub-observer point,
the median 8-bit luma of each was taken per bin of stored opacity, split by
measured top: low (< 3.2 km), middle and high (≥ 6.5 km).

**Not the display.** These cloud values sit below the camera's highlight
shoulder (linear 0.8, about level 231), where the output is plain sRGB. In
linear terms EPIC's brightness grows with the measured albedo, ×2.0 from
albedo 0.45 to 0.85 (the albedo grows ×1.9); the render grew ×1.32.

**Not the 10 km columns.** At equal opacity, high cloud rendered slightly
brighter than low cloud, never dimmer. Low decks were short of EPIC as well:
−17 levels at opacity ≥ 0.6, against −37 for high cloud.

**The volume integral.** Each step adds `transmission·opacity·light`, with
`light` scaled by a self-shadow `0.2 + 0.8·exp(−depth toward the Sun)`. For
measured clouds the column's pseudo optical depth ln(1 + cτ) is defined so that
its nadir opacity equals the plane-parallel albedo R, which already contains
all multiple scattering inside the column. Attenuating the sunlight by that
depth again, and the view ray by it too, without the reflections between
layers, takes a thick column toward half its albedo: with the Sun overhead,
(1 − e^{−2D})/2 instead of 1 − e^{−D}. The test was to switch the self-shadow
off for measured clouds. Low and middle cloud then followed EPIC up to opacity
0.7.

**Fix.** `cloudPropertiesIllumination` (in `src/scripts/cloud-properties.ts`)
divides out, after the self-shadow, the attenuation that a horizontally
uniform layer of the point's own column would cause along the sun path:
`min(1, T·exp(D_above/μ₀))`, with D_above from the column's 6z(1 − z) profile.
Gaps, towers and other clouds still shade. The ISS view keeps its shadowed
flanks and ground shadows. The plates are unchanged.

**The ice relation.** High cloud remained short (−22 levels). At the same
retrieved τ, EPIC shows high cloud much brighter than low cloud (172 against
149 levels at opacity 0.5 to 0.6). VIIRS and MODIS retrieve ice τ with the
Collection 6 rough aggregate, asymmetry g ≈ 0.75, and liquid with g ≈ 0.85; the
same τ of ice reflects more. NOAA-20's own reflectance agrees, by MODIS Aqua
phase, over dark surfaces (4.9 km):

| Retrieved τ | 2.0 | 4.9 | 7.9 | 12.5 | 20.4 | 32 |
| --- | --- | --- | --- | --- | --- | --- |
| Albedo from reflectance, ice | 0.19 | 0.33 | 0.43 | 0.53 | 0.64 | 0.73 |
| Albedo from reflectance, liquid | 0.15 | 0.27 | 0.36 | 0.45 | 0.56 | 0.63 |

So the albedo relation changes only by phase: R = cτ/(1 + cτ) with
c = (1 − g)·√3/2, 0.13 for liquid (unchanged) and 0.2165 for ice, mixed by the
MODIS ice fraction. The shader infers τ for bases with the same coefficient.

**Result.** Median render minus EPIC, in 8-bit levels, over cloud bins:

| | Mean \|difference\|, opacity ≥ 0.1 | Opacity ≥ 0.6: low | middle | high | all |
| --- | --- | --- | --- | --- | --- |
| Before | 11.9 | −16.9 | −19.5 | −37.3 | −28.6 |
| Column lighting | 9.0 | −5.6 | −5.8 | −22.2 | −14.8 |
| Column lighting, ice relation, partly cloudy pixels | 8.0 | −2.8 | +1.2 | −9.0 | −5.7 |

Thin high cloud (opacity < 0.3) now renders 10 to 16 levels brighter than EPIC.
That is the next thing to look at: it may be the ice coefficient applied to
thin cirrus, or EPIC's 18 km pixels averaging cirrus with the sea.

## 3. Tile size

**Before.** 512 tiles at AVIF quality 65: 26.7 MB (25.4 MB for the new
opacity), against 14 MB for the plates.

Encodings of the raw 2.4 km grid (`CLOUD_PROPERTIES_GRID`), every eighth tile,
latitude-weighted interior error in 8-bit opacity levels:

| AVIF | Size, scaled to all tiles | RMS | p99 | Thin cloud (< 0.25) RMS |
| --- | --- | --- | --- | --- |
| q65, effort 5 | 25.4 MB | 4.2 | 13 | 3.2 |
| q55, effort 5 | 19.0 MB | 6.0 | 20 | 4.6 |
| q50, effort 5 | 16.2 MB | 7.0 | 23 | 5.4 |
| q50, effort 7 | 16.4 MB | 6.7 | 22 | 5.1 |
| q45, effort 5 | 13.6 MB | 8.2 | 28 | 6.4 |
| q40, effort 5 | 10.8 MB | 10.0 | 35 | 7.7 |

Effort 7 buys 0.4 levels for much longer encoding, and effort 9 did not finish
a 64-tile sample in 37 minutes on a shared machine. The bias stays below 0.2
levels at every setting.

**After.** Quality 48, effort 5: **14.75 MB** for all 512 tiles. The error
over all of them is 7.5 levels RMS (0.029 opacity), 4.5 mean absolute,
p99 26, bias +0.17. Rendered against quality 65: 2.2 levels mean difference
at 2,000 km (2.2% of pixels above 8 levels; small cumulus over land is
slightly softer), 0.15 in the ISS view. Tiles streamed per view: disc
0.97 MB, 2,000 km 0.84 MB, ISS 0.42 MB, against 1.78, 1.55 and 0.74 MB
before. The 4.24 MB overview is unchanged.

## 4. Cloud lighting atlas without drift

The atlas (`src/scripts/cloud-lighting.ts`) caches self-shadow transmission
in a 30° patch in the frame of the drifting plates. Its schedule now takes a
drift rate (`CLOUD_DRIFT`, 8·10⁻⁶ rad/ms for the plates). The renderer passes
0 for measured clouds, matching `cloudCoordinates`, which leaves them in
place. The study no longer forces raymarched shadows. The atlas covers views
below about 1,500 km, so the disc and 2,000 km views still trace.

| View, 1,200 × 800 | Atlas against raymarched: mean / p99 difference | Pixels > 8/255 | Median GPU ms, raymarched / atlas |
| --- | --- | --- | --- |
| ISS, 420 km over Chad | 0.03 / 1.0 levels | 0% | 20.2 / 19.8 |
| 420 km over the Angola deck, 35° down (`deck` view) | 0.4 / 4.3 levels | 0.06% | 18.3–18.9 / 18.9–19.3 |

The atlas reproduces the traced light; differences sit at cloud edges, where
the 6.5 km bake grid is coarser than the trace. Frame time did not change
measurably. Other sessions shared the GPU: a later run of the same views
measured 10 to 61 ms, so no speed-up is claimed.
`scripts/cloud-lighting.test.mjs` checks that a no-drift atlas stays valid as
scene time passes while a drifting one is replaced.

## Go / no-go

**Go for the measured route as the candidate default for this date; not yet
the default.** All four work items are done:

1. Partly cloudy pixels have a per-pixel source, the overpass's own
   reflectance, over 74% of them. The rest (polar caps, deserts, snow) still
   take one median thickness, and appear as flat veils near the poles.
2. Bright cores were the scene's lighting of every thick column, not EPIC's
   stretch and not the tall columns. Measured columns no longer re-shadow
   their own albedo, and ice uses its own albedo coefficient. Opacity ≥ 0.6
   now renders 5.7 levels below EPIC instead of 28.6.
3. Tiles are 14.75 MB at 0.029 RMS opacity error.
4. The lighting atlas runs without drift and matches the traced light within
   0.4 levels.

Still open before a default: the date should follow the scene's `epoch`;
swath edges and the date-line seam need a review in motion; thin cirrus may now
be too bright; and the owner should compare the measured clouds with
Calibrated on desktop and phone. The mean opacity, 0.259, is 11% above
Calibrated's 0.233.

These are taken up in the [third iteration](cloud-properties-seams-2026-10-17.md).

## Reproduce

```bash
bun scripts/prepare-cloud-properties.mjs /tmp/earthlight-cloud-properties-cache
```

```bash
CLOUD_VIEWS=disc,region,iss,deck CLOUD_VARIANTS=global,atlas,quality bun scripts/compare-cloud-properties.mjs http://127.0.0.1:4421 /tmp/cloud-properties
```

The build downloads about 680 MB from NASA GIBS (the first study's 550 MB and
128 MB of true colour), reads it twice (calibration, then opacity), and writes
`public/media/earthlight/cloud-properties/2026-09-22/`, whose manifest records
the calibration table, the opacity budget by source and the encoding.
`CLOUD_PROPERTIES_GRID=<file>` also writes the raw 2.4 km opacity grid used for
the encoding measurements above.
