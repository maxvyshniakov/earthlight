# Measured clouds: the grey rectangles are sea ice, 2026-10-17

After the [glint, 180° and polar-veil rebuild](cloud-properties-artefacts-2026-10-17.md),
flat grey polygons with straight edges remained in the measured clouds
(`cloudStudy=global`, NOAA-20 VIIRS, 22 September 2026) over the Southern Ocean
around 56 to 58° S, 4° W to 0°. They are granule-shaped areas where the GIBS
VIIRS optical-thickness layer has no retrieval. Their pixels carry a top height
but no τ, are bright (red reflectance about 0.68) and sit next to retrieved
τ ≈ 11. With the clear sky of their blocks above 0.2 they take the median MODIS
partly cloudy thickness (opacity about 0.18), drawn as a thin grey veil over
the renderer's dark open sea. This note asks whether the build can fill them
more honestly, or whether the gap is the surface under them.

**Answer: the surface.** Every one of these areas lies on pack ice. No build
option separates cloud from ice there. The day map (Blue Marble, October 2004)
has no sea ice at all, so the study now lays that day's sea-ice concentration
on the sea under its clouds. The clouds are unchanged: the 2.4 km opacity grid
of the new build is byte-identical to the old one.

Grid numbers come from the raw grid (`CLOUD_PROPERTIES_GRID`) and the 1.2 km
GIBS layers of the same cache. Frames are 1,200 × 800 at the third iteration's
scenes and settings (manual exposure 0 EV, raymarched self-shadows), steps 4
and 8 of the two Southern Ocean scenes in
[the seams note](cloud-properties-seams-2026-10-17.md#2-swath-edges-and-the-date-line-seam-in-motion)
(2,000 km nadir, 53° S 3° W and 56° S 4° E; 420 km looking south-east,
53° S 4° W and 54.5° S 0°). Before is 4a3d9f1 and after is this change, both on
the same media. The frames were viewed, not committed.

## 1. Where the rectangles are

The day's sea ice comes from GHRSST MUR L4 sea-ice concentration
(`GHRSST_L4_MUR_Sea_Ice_Concentration`, passive microwave, so independent of
cloud). AMSR2 on GIBS ends on 1 September 2025. On 22 September the ice edge at
the Greenwich meridian lies at about 56.3° S.

Over 15° W to 10° E, 50 to 65° S, VIIRS retrieves τ almost everywhere north of
the edge. Along the marginal ice zone a 50 to 150 km band still carries τ.
Inside the pack the layer flags nearly every pixel with a top but no τ. The
straight edges of the "rectangles" are where that band ends: granule and swath
boundaries inside the pack (vertical steps at 3° W and 2.5° W, a run along
56.5 to 57.1° S, and the 101-minute swath diagonal). Other granules over the
same ice call large areas clear. Before this change those clear areas rendered
as dark-blue open sea.

Observed pixels from 50 to 75° S, by MUR concentration (area-weighted):

| Sea ice | Retrieved τ | Top, no τ | Clear | Red refl. τ / no τ / clear | Mean τ |
| --- | --- | --- | --- | --- | --- |
| None (open sea, coast) | 0.740 | 0.219 | 0.041 | 0.48 / 0.43 / 0.30 | 16.3 |
| 15–50% | 0.810 | 0.179 | 0.011 | 0.61 / 0.41 / 0.33 | 18.4 |
| 50–80% | 0.641 | 0.336 | 0.023 | 0.68 / 0.57 / 0.54 | 20.8 |
| 80–100% | 0.536 | 0.414 | 0.049 | 0.80 / 0.76 / 0.82 | 21.9 |

Over pack ice, two fifths of the observed pixels have a top and no τ, and their
red reflectance (0.76) is *below* that of clear ice (0.82). Their tops do not
settle it either: 23% are below 1 km, where snow-covered ice flagged as cloud
would sit, and 29% are above 7 km, where real thin cirrus would be.

## 2. Build options, and why none is honest

Grid crops of 8° W to 4° E, 60 to 54° S (shared notes: `sea-ice-region-options.jpg`,
in reading order: true colour; classes over sea ice, with retrieved τ orange,
top without τ blue, clear white and open sea black; A; B; C):

| Option | Mean opacity of the crop | What it says |
| --- | --- | --- |
| A, as built: median thickness | 0.407 | "some thin cloud", flat 0.18 |
| B, nearest retrieved τ | 0.505 | invents a deck: Voronoi patches of τ ~ 4 (median) over 40% of the crop |
| C, nothing | 0.344 | removes the veil, leaves black sea where the overpass saw ice |

- **Inversion against the surface** is no option. The pixels are no brighter
  than clear ice, so the excess over the surface is zero or negative, and the
  inversion would return no cloud. It cannot tell ice from cloud over ice.
- **MODIS τ from another sensor** covers only 23% (Aqua) or 19% (Terra) of
  these pixels, and from another hour. MODIS also stops retrieving over the pack.
- **Nearest τ (B)** paints cloud where the overpass shows ice and floes.
- **Zero (C)** is honest about the cloud but keeps the false surface.

All three keep the dark sea under the ice edge. Whatever the cloud value, the
picture was wrong because the surface was wrong, so A stays.

## 3. Fix: the day's sea ice under the measured clouds

**Build.** `prepare-cloud-properties.mjs` fetches the MUR layer at 4.9 km
(`sea-ice-8192`) and averages the concentration c over the water pixels of
each overview texel (Natural Earth mask of `earth-terrain-8192-v2.dem`).
Open water is transparent in the layer. The overview's alpha used to hold the
observed fraction, which only the diagnostic reads (0.34% of the globe is
unobserved, at the poles). It now holds both:

- 0.3 + 0.7 c where NOAA-20 observed at least half the texel;
- 0.15 c where it did not.

The gap keeps AVIF error from flipping the branch. Decoded, the open sea of
the tropics reads exactly 77/255 (0.3), with no texel off. Sea-ice edges are
within ±1 level. The unobserved Arctic pack reads 31 to 38. A unit test
mirrors the encoding and checks that ±18/255 never flips the branch. The file
is `overview-v2.avif`: a version-1 overview would read as ice on every sea.
Sea ice covers 3.6% of the globe by area (about 18 million km²). The overview
grows from 4,240,859 to 4,281,390 bytes.

**Albedo.** The ice albedo comes from the same overpass, scaled to the day
map's own snow:

| | Red | Green | Blue |
| --- | --- | --- | --- |
| VIIRS clear sea ice (MUR 90–100%), Rayleigh-corrected | 0.85 | 0.86 | 0.86 |
| VIIRS clear Antarctic plateau, 72–80° S | 1.01 | 1.01 | 0.99 |
| Blue Marble plateau, linear | 0.81 | 0.85 | 0.89 |
| Sea ice in the renderer, linear | 0.68 | 0.73 | 0.78 |

Clear-sky reflectance over the ice falls roughly linearly with concentration
(red 0.38 at 50–60%, 0.58 at 70–80%, 0.85 at 90–100%). The shader therefore
mixes ocean and ice albedo in linear light by c, and the glint (`water`) gives
way to the same fraction.

**Renderer.** Inside `#ifdef CLOUD_PROPERTIES`, the world pass reads c from
the cloud map it already samples for shadows, so no texture unit is added. The
default renderer and the background are unchanged.

**Before and after.** At 2,000 km (shared notes:
`sea-ice-swath-2000-before-after.jpg`, before left) the dark-blue clear
granules and the flat grey veils south of the ice edge become one grey-white
field of ice. The straight edges inside the pack are gone, except where
retrieved τ ends (below). At 420 km (`sea-ice-swath-420-before-after.jpg`) the
dark slab and its straight sides become ice under a faint veil. One straight
edge remains to the far right: the 101-minute swath edge of the third
iteration.

Rendered linear luminance in the 2,000 km nadir frame at 56° S, 4° E, against
VIIRS red reflectance at the same places:

| Pixels | VIIRS | Before | After |
| --- | --- | --- | --- |
| Thick cloud on open sea (τ ≥ 16) | 0.699 | 0.468 | 0.468 |
| Top without τ on ice (MUR ≥ 90%) | 0.894 | 0.124 | 0.211 |
| Clear ice (MUR ≥ 90%) | 0.894 | 0.084 | 0.204 |
| Retrieved τ ≥ 16 on ice | 0.820 | 0.262 | 0.294 |

The veil and the clear granules beside it now differ by 3% (before: 48%;
VIIRS: none), which is what removes the polygons. The EPIC disc
(`epic_1b_20260922112448`) sees this ice only near its limb (μ 0.3–0.6). There,
ice under opacity below 0.3 moves from 151 to 157 levels against EPIC's 163.
Ice under any cloud moves from 167 to 169 against 162.

## What remains

- **Ice against cloud.** Clear ice renders at 0.44 of thick sea cloud;
  VIIRS has it at 1.28. The sea ice follows the day map's snow (Blue Marble's
  plateau is 0.81 of VIIRS's), and the surface is Lambertian in cos θ₀ while
  the measured columns are raymarched. VIIRS corrected reflectance divides
  both by cos θ₀. The balance of surface and cloud light at low Sun is
  renderer-wide (Antarctic snow presumably shares it, not checked) and
  not this study's to retune.
- **Retrieved τ over ice.** Where the τ band reaches into the pack (mean τ 22,
  red reflectance no brighter than the ice), it renders 1.39 times the veil
  beside it against VIIRS's 0.92. Those retrievals probably count ice into the
  cloud, and their granule edges remain the faint straight lines inside the
  pack. Screening them needs the retrieval's own quality flags (CLDPROP L2),
  not GIBS.
- **The default renderer** has no sea ice; a daily or climatological layer for
  it is a separate decision.
- **Publishing.** `overview-v2.avif` exists only locally. Until the day is
  republished with it, a deployed explorer with this change loads no measured
  overview for the study. The old overview, read by the new shader, would
  have drawn ice on every sea.

## Reproduce

```bash
bun scripts/prepare-cloud-properties.mjs /tmp/earthlight-cloud-properties-cache 2026-09-22
```

The build fetches `sea-ice-8192` into the cache. Its log line gains
`area.seaIce` (0.0361). The manifest records the layer, palette and example
URL under `sources.seaIce`.
