# Measured clouds: glint, the 180° column and polar veils, 2026-10-17

The [third iteration](cloud-properties-seams-2026-10-17.md) found three build
artefacts next to the seams of the measured clouds (`cloudStudy=global`,
NOAA-20 VIIRS for 22 September 2026), all in
`scripts/prepare-cloud-properties.mjs`: sun glint inverted into cloud on the
two swaths at the date line, a dark grid column at 180° W, and median veils
over the Southern Ocean whose edges step along the 157 km clear-sky blocks.
This note fixes each at the source and rebuilds the day locally from the same
GIBS cache. Nothing was published and the study stays opt-in.

Grid numbers are area-weighted means of the raw 2.4 km opacity grid
(`CLOUD_PROPERTIES_GRID`). Frames are 1,200 × 800 at the third iteration's
scenes and settings (manual exposure 0 EV, raymarched self-shadows), the
middle step of each, before and after rendered on the same renderer (ba81352)
by swapping the asset directory. They were viewed, not committed.

## 1. Sun glint inverted into cloud

**What the data show.** The glint is not confined to the two date-line swaths.
With a glint angle for every pixel (below), the cloud mask of every swath flags
part of the glint over water as partly cloudy, with a top height and no
optical thickness. On the date-line swaths it flags more, and in their
brightest glint VIIRS also *retrieved* the glint as cloud. Observed water
within 30° of the equator at 1.2 km:

| Glint angle | < 5° | 5–10° | 10–15° | 15–20° | 20–25° | 25–30° |
| --- | --- | --- | --- | --- | --- | --- |
| Partly cloudy, other swaths | 0.50 | 0.37 | 0.28 | 0.21 | 0.19 | 0.19 |
| Partly cloudy, date-line swaths | 0.57 | 0.53 | 0.40 | 0.31 | 0.26 | 0.22 |
| Retrieved, top < 400 m, other swaths | 0.016 | 0.012 | 0.002 | 0.000 | 0.000 | 0.000 |
| Retrieved, top < 400 m, date-line swaths | 0.21 | 0.08 | 0.014 | 0.000 | 0.000 | 0.000 |

The excess flags have tops below 1 km (below 400 m: +0.11 of the water within
5°; 0.4 to 1 km: +0.05). Their red reflectance is only 0.03 to 0.04 above the
clear glint beside them. At 178° W, 3 to 9° N, 36% of the pixels carry a
retrieved τ (median 9) under a 75 m top. That is the white core of the slab,
which no screen of partly cloudy pixels alone could remove. Around it the
157 km clear-sky blocks are short of clear pixels and take darker values, so
the inversion turned the flagged glint into opacity. Where the glint raised a
block's clear sky above 0.15, the median thickness drew a flat grey square
instead (171° E, 12° N).

**Geometry.** A circular sun-synchronous orbit for NOAA-20 (824 km, 98.74°,
101.44 min, ascending node 13:25 local mean time) with one free parameter, the
time of the day's first ascending node. It is fitted to the day's own glint:
the phase at which clear water within 15° of the specular direction is
brightest against the rest of the swaths (30° S to 30° N). The fit is 83.0 min
after 00:00 UTC, with a contrast of 3.73, and its 10°, 20° and 30° contours
follow the glint stripes in the true colour. Each pixel takes the latest
ascending pass of its local day whose 3,040 km swath covers it; the date-line
swaths are the passes at 01:24 UTC on the 22nd (west) and 01:04 UTC on the
23rd (east). Water is the Natural Earth mask in the terrain map
(`earth-terrain-8192-v2.dem`). Glint angles are on 20 km cells.

**Screen.** Within the glint over water (full weight below 15°, none beyond
30°), weighted by the glint weight:

- retrieved clouds with a top below 400 m count as partly cloudy, and the
  calibration leaves them out;
- partly cloudy pixels are inverted against the glint: the mean red
  reflectance of the 20 km cell's observed water that is clear, flagged with a
  top below 1 km, or retrieved glint, wherever it exceeds the clear sky.
  Higher flagged tops stay out of the reference, so cloud edges in the glint
  (the ITCZ lies under the equinox glint) do not raise their own reference;
- the dark-surface test does not apply, so glint never falls back to the
  median thickness.

**Before and after.** Mean opacity, 0 to 12° N:

| Box | Before | After |
| --- | --- | --- |
| Glint, 179.5° W to 176.5° W | 0.134 | 0.031 |
| East of it, 176° W to 173° W | 0.044 | 0.044 |
| Glint, 176.5° E to 179.5° E | 0.109 | 0.064 |
| West of it, 173° E to 176° E | 0.198 | 0.192 |

By glint angle over water, 5° S to 15° N, where the glint lies:

| Glint angle | < 5° | 5–10° | 10–15° | 15–20° | 20–25° | 25–30° | 30–40° | 40–50° |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Passes 1–13, before | 0.182 | 0.192 | 0.189 | 0.184 | 0.170 | 0.161 | 0.180 | 0.190 |
| Passes 1–13, after | 0.150 | 0.171 | 0.182 | 0.182 | 0.170 | 0.161 | 0.180 | 0.190 |
| Date-line passes, before | 0.191 | 0.151 | 0.138 | 0.130 | 0.134 | 0.172 | 0.209 | 0.237 |
| Date-line passes, after | 0.050 | 0.078 | 0.119 | 0.127 | 0.135 | 0.172 | 0.209 | 0.238 |

**The other glint stripes moved too, and should have.** The third iteration
read the stripes at 150° E and 150° W as unaffected (0.041 in the stripe
against 0.091 beside it). Taken over all thirteen other passes, their glint
cores carried 0.01 to 0.02 of false opacity before. After the screen the
profile is flat from 5° to 50° within the spread of the outer bins, with a dip
of about 0.015 within 5°. On the 150° E pass the core falls from 0.099 to
0.061 (< 5°) and 0.072 to 0.052 (5–10°), level with 0.05 to 0.06 beside it.
Under the ITCZ on the 150° W pass it falls from 0.421 to 0.394 (< 5°): flagged
low glint lies there too. Beyond 20° nothing changes. On the date-line passes
the core is now darker than the swath average. It lies on a nearly clear sea
(0.044 just east of it), probably the calm that made the glint bright enough
to be flagged; the 0.05 that remains is cumulus and the inverted residue of
the glint.

In the frames the grey sheet at 178° W and the block-edged slab at 178° E are
gone at 2,000 km; the renderer's own ocean glint shows where they were. At
420 km the blotchy grey foreground is gone. A faint ripple of inverted glint
noise remains at 178.7° W, 6° N, just visible at 2,000 km.

## 2. The dark column at 180°

**Cause.** GIBS returns damaged outer columns wherever a request ends at the
antimeridian, on both sides. The true-colour JPEG's outermost column is dark
in every request (red byte 54 against 96 beside it at 180° W, 0 to 45° N; 52
against 121 at 180° E, 45 to 90° N). In the polar requests the PNG layers also
lose pixels in their two or three outer columns (cloud-top height present in
0.63 and 0.67 of the first two columns at 180° W, 45 to 90° N, against 0.75 to
0.80 further in). The global 4.9 km layers lose their first column (MODIS
phase 0.36 against 0.61). The inner request edges (90° W, 0°, 90° E) are clean.

**Fix.** Columns within 0.03° of 180° copy the nearest intact column on their
own side of the date line (three at 1.2 km, one at 4.9 km), not an average
across it, where the sky is a day apart.

| Grid column | 180° E − 2 | 180° E − 1 | 180° W | 180° W + 1 | 180° W + 2 |
| --- | --- | --- | --- | --- | --- |
| Before, 60° S to 60° N | 0.271 | 0.263 | 0.264 | 0.278 | 0.277 |
| After, 60° S to 60° N | 0.270 | 0.271 | 0.278 | 0.277 | 0.276 |
| Before, 60 to 90° N | 0.223 | 0.172 | 0.194 | 0.255 | 0.269 |
| After, 60 to 90° N | 0.226 | 0.226 | 0.262 | 0.262 | 0.269 |

The one-texel line is too thin to resolve in the 2,000 km frames of either
build; the date-line cut beside it remains, as it should.

## 3. Stepped polar veils

**Cause.** Not the sea ice itself but the clear-sky extension. On 22 September
the Southern Ocean from 46° to 62° S and 16° W to 6° E has not one clear
pixel. The extension copies the nearest clear block into such areas, and here
the nearest were bright blocks at the sea-ice edge (57° S, 1° to 5° E). Their
clear sky reached some 600 km north over open ocean, and where it met the dark
ocean's flood fill the field jumped along a staircase of blocks. The per-pixel
switch at s = 0.15 traced that staircase, and every partly cloudy pixel inside
took the median thickness, flat grey, over a sea the overpass saw dark. In
those blocks the darkest 5% of observed pixels have a red reflectance of 0.04
to 0.13.

**Fix.**

- A cloud only brightens its surface in the inversion's model
  (s + A (1 − s)² / (1 − A s) ≥ s), so a block without clear pixels is now no
  brighter than the 5th percentile of its own observed pixels. Blocks with
  clear pixels are unchanged.
- The switch is a blend. The weight of the inversion is a ramp over the
  block's clear sky from 0.12 to 0.2, blurred over about one block (binomial,
  5 taps) and interpolated, times a ramp over latitude from 57° to 63° (before:
  a hard cut at 60°). In the glint the glint weight takes over (section 1).

**Before and after.** The trust field's staircase becomes a smooth band about
300 km wide. Inside the formerly flooded area the partly cloudy pixels now
follow the overpass's reflectance instead of a flat 0.18. Mean opacity barely
moves, because most of that area carries retrieved thickness: 0.683 → 0.682 at
46° to 56° S, 16° W to 6° E, and 0.474 → 0.476 in the 57° to 63° S band.

**What remains.** In the swath frames at 2,000 and 420 km the change is small.
The flat grey polygons that stay have other edges: swath edges (101-minute
cuts, kept, see the third iteration) and granule-shaped rectangles over sea
ice where VIIRS retrieved no thickness at all (56° to 58° S, 4° W to 0°: 46%
partly cloudy at red reflectance 0.68, against retrieved τ 11 beside them).
There the clear pixels are bright (0.8), so the median thickness is the right
branch. The veil reads as grey because the renderer's day map has no sea ice
under it. Neither is a build artefact of the kind fixed here.

## Everything else

**Global.** Changes are confined to glint over water on every swath, the two
latitude ramps, blocks without clear pixels, and the edges of bright deserts,
where the blurred weight now inverts a little more. Mean change of the grid by
latitude band is at most 0.0008 (tropics −0.0008, 30 to 60° N +0.0006); the
global mean opacity goes from 0.2581 to 0.2579. The calibration table moves by
at most 0.006 in inverted albedo.

| Manifest | Before | After |
| --- | --- | --- |
| Area measured / partly cloudy / of which inverted | 0.3996 / 0.2451 / 0.1818 | 0.3993 / 0.2455 / 0.1847 |
| Budget measured / inverted / median | 0.2203 / 0.0269 / 0.0114 | 0.2201 / 0.0272 / 0.0110 |
| Overview / tiles (bytes) | 4,243,134 / 14,745,720 | 4,240,859 / 14,653,224 |

**EPIC.** The disc against EPIC (`epic_1b_20260922112448`), binning and
registration as in the third iteration, each build binned by its own
overview:

| | Mean \|render − EPIC\|, opacity ≥ 0.1 | Opacity ≥ 0.6 | Thin low (0.1–0.2) |
| --- | --- | --- | --- |
| Before | 8.0 | −5.7 | +13 |
| After | 7.3 | −5.8 | +9 |

The disc render moves by 0.49 levels on average (0.6% of channels by more than
8). The improvement comes from the Atlantic glint stripes inside EPIC's
disc, which had carried the same false thin cloud as the Pacific ones. Thick
cores and the thin-cirrus question of the third iteration are unchanged.

## Go / no-go

**Still opt-in; the three build artefacts are fixed.** The glint screen covers
every swath, and the other stripes had a smaller share of the same false cloud.
The 180° column now matches its neighbours, and the polar switch is a blend
without the extension's staircase. Left for the default: settle the ice
relation on VIIRS phase, build a neighbouring day so the date line can move to
the night side, and the owner's comparison on desktop and phone. The
rebuilt asset is local; publishing it to R2 is a separate step.

## Reproduce

```bash
bun scripts/prepare-cloud-properties.mjs /tmp/earthlight-cloud-properties-cache 2026-09-22
```

```bash
CLOUD_VIEWS=disc CLOUD_VARIANTS=global bun scripts/compare-cloud-properties.mjs http://127.0.0.1:4451 /tmp/cloud-properties
```

The build prints the glint fit (`glint 83.0 min, contrast 3.73`) and writes it
to the manifest under `sources.partial.glint`. The grid comparisons use
`CLOUD_PROPERTIES_GRID=<file>` from both builds.
