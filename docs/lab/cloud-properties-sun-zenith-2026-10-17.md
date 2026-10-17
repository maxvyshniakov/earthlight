# Measured clouds: surfaces against clouds at low Sun, 2026-10-17

The [sea-ice note](cloud-properties-sea-ice-2026-10-17.md) left one
imbalance in the measured clouds (`cloudStudy=global`, NOAA-20 VIIRS,
22 September 2026). In the 2,000 km nadir frame at 56° S, 4° E (11:20 UTC,
manual exposure 0 EV, raymarched self-shadows), clear sea ice renders at
0.44 of the linear luminance of thick cloud over open sea (τ ≥ 16). VIIRS
corrected reflectance has 1.28 (0.894 against 0.699). This note asks which
side is wrong: the surface (Lambertian in cos θ₀, Blue Marble albedo) or the
measured columns (raymarched), and whether snow and other bright surfaces
share the ratio at every Sun zenith.

**Answer: the clouds, at low Sun.** Every surface renders at a constant
fraction of its VIIRS reflectance at any Sun zenith, as a lit Lambertian
surface should. Thick cloud does not: against VIIRS it brightens 1.14 to
2.0 times over land as cos θ₀ falls from 0.97 to 0.33, and reaches
2.7 times over the Southern Ocean at 0.30. The cloud light shared by every
cloud mode falls as 0.48 + 0.38 cos θ₀, only to 0.78 of its overhead value
at cos θ₀ = 0.5, while a plane-parallel cloud's radiance falls as
cos θ₀^1.19. EPIC sees the same: its thick cloud dims from 164 to 120 levels
across the disc while the render's brightened from 171 to 183. The study now
gives its columns that law. The default renderer and the background are
unchanged. The part of the ice gap that remains is the ice's own albedo
(Blue Marble's snow is 0.81 to 0.86 of VIIRS's) and mid-thickness Southern
Ocean cloud, which is 1.3 times VIIRS at every Sun zenith.

## Method

**Frames.** The explorer at 1,200 × 800, manual 0 EV, `cloudStudy=global`,
as in the [seams note](cloud-properties-seams-2026-10-17.md): nadir views
from 2,000 km at three places, each at several scene times on the 22nd,
so that one cloud field is seen under several Suns:

| Scene | Centre | Times (UTC) | cos θ₀ of its clouds |
| --- | --- | --- | --- |
| Southern Ocean | 56° S, 4° E | 07:40, 09:00, 10:20, 11:20, 12:40, 14:00 | 0.30 to 0.59 |
| Sahel and Sahara | 15° N, 10° E | 07:00, 08:20, 09:40, 11:20, 13:00, 14:20, 15:40 | 0.33 to 0.97 |
| Antarctic coast | 70° S, 15° E | 09:40, 11:20, 13:00 | 0.28 to 0.49 |

**Rendered reflectance.** Each pixel is traced to the ground, its class taken
from the 1.2 km VIIRS layers of the GIBS cache (optical thickness, top height,
corrected-reflectance true colour with GIBS's stretch inverted), the
overview's opacity and sea ice, and the Blue Marble day map. Pixels viewed
more than 60° from nadir and pixels VIIRS did not observe are dropped. Linear
luminance L is divided by the camera finish's vignette (coefficient 0.24 of
0.20 to 0.28) and by cos θ₀ at the scene time. A white Lambertian surface
before any air would read L / cos θ₀ = 2.2 / π = 0.70 at 0 EV. That unit
turns L / cos θ₀ into a reflectance comparable with VIIRS (here
R<sub>r</sub>/R<sub>v</sub>). VIIRS corrected reflectance divides by cos θ₀ and
removes Rayleigh scattering. The render keeps its air, which accounts for
roughly 10 to 15% on surfaces at low Sun and less on cloud tops. For real
radiance at the scene's Sun, multiply the VIIRS ratio by the ratio of the
classes' cos θ₀ (the "VIIRS-implied" column below). Clear classes require
VIIRS clear and stored opacity below 0.05.

**EPIC.** The disc view (50,000 km over 5.9° N 7.3° E, long lens) against
`epic_1b_20260922112448`, registered as in the earlier notes. Median display
level per class and cos θ₀ bin. At L1, EPIC sees the Earth near backscatter,
so its view zenith follows the Sun's.

**Monte Carlo.** Nadir bidirectional reflectance R(μ₀) of conservative
Henyey-Greenstein slabs over a black sea, g = 0.85 (liquid) and 0.75 (ice),
τ 1 to 64, 150,000 photons per cell, with a local estimate at every scattering.
The tables are in the evidence file.

## 1. Surfaces stay put; clouds brighten

R<sub>r</sub>/R<sub>v</sub> before this change (render at 653002f):

| Class | cos θ₀ | R<sub>r</sub>/R<sub>v</sub> |
| --- | --- | --- |
| Sea ice, 56° S (MUR ≥ 90%) | 0.27 to 0.51 | 0.69 to 0.71 |
| Sea ice, 70° S | 0.32 to 0.40 | 0.65 |
| Antarctic plateau (Blue Marble ≥ 0.5) | 0.26 to 0.31 | 0.72 to 0.73 |
| Desert (Blue Marble 0.2 to 0.5) | 0.37 to 0.94 | 1.30 to 1.33 |
| Bright sand (Blue Marble ≥ 0.5) | 0.32 to 0.95 | 1.19 to 1.23 |
| Darker land (Blue Marble < 0.2) | 0.40 to 0.97 | 1.35 to 1.67 (air's share grows at low Sun) |
| Thick cloud over land, Sahel (τ ≥ 16) | 0.97 / 0.85 / 0.76 / 0.63 / 0.50 / 0.33 | 1.14 / 1.21 / 1.37 / 1.40 / 1.84 / 2.00 |
| Thick cloud over sea, 56° S (τ ≥ 16) | 0.59 / 0.49 / 0.47 / 0.30 | 1.84 / 2.05 / 2.10 / 2.66 |
| Mid cloud over sea, 70° S (τ 6 to 16) | 0.49 / 0.43 / 0.28 | 1.93 / 2.12 / 2.89 |

Lambertian shading in cos θ₀ is right: no surface class moves with the Sun.
Their levels differ by the day map. Blue Marble's desert is 1.3 times VIIRS
and its snow 0.81 to 0.86. The Antarctic plateau and the study's sea ice
(scaled to that plateau) sit at 0.65 to 0.73 once two passes through the air
at low Sun are counted. So snow shares the sea ice's ratio against clouds.
Desert does not, because Blue Marble lifts mid-tones and compresses
highlights.

## 2. Where the excess comes from

The raymarch lights each measured sample with the term every cloud mode
shares (`earth-clouds.ts`), unchanged since the extraction from the personal
site:

`sunColor · (0.20 + 0.80 shadow) · (0.48 + 0.38 cos θ₀) · (0.8 + 0.3 forward)`

A thick column scatters its stored opacity (the plane-parallel albedo) times
that light toward the camera. Measured columns are not self-shadowed along
the Sun's path (the stored albedo already counts their own multiple
scattering). So nothing else dims them as the Sun drops. Their radiance
relative to an overhead Sun, against slabs of the same optical thickness
(liquid / ice):

| τ | cos θ₀ 0.8 | 0.5 | 0.3 | 0.2 |
| --- | --- | --- | --- | --- |
| 2 | 1.17 / 1.05 | 1.20 / 0.94 | 0.96 / 0.65 | 0.64 / 0.42 |
| 4 | 1.02 / 0.94 | 0.86 / 0.67 | 0.52 / 0.40 | 0.33 / 0.25 |
| 8 | 0.88 / 0.83 | 0.60 / 0.52 | 0.34 / 0.29 | 0.21 / 0.18 |
| 16 | 0.82 / 0.81 | 0.50 / 0.47 | 0.27 / 0.25 | 0.16 / 0.15 |
| 32 | 0.79 / 0.78 | 0.45 / 0.44 | 0.24 / 0.23 | 0.14 / 0.14 |
| 64 | 0.78 / 0.77 | 0.44 / 0.44 | 0.23 / 0.23 | 0.13 / 0.14 |
| Shared term | 0.91 | 0.78 | 0.69 | 0.65 |
| cos θ₀^1.19 | 0.77 | 0.44 | 0.24 | 0.15 |

Thick slabs follow cos θ₀^1.19. Their nadir reflectance factor itself falls
slightly at low Sun, so radiance falls a little faster than cos θ₀. At
cos θ₀ = 0.5 the shared term is 1.8 times too bright, and at 0.3 it is 2.9
times. That is the excess of section 1.

Thin Henyey-Greenstein slabs brighten at low Sun, because the nadir view
leaves exact backscatter for side scattering. Real droplets have a glory at
backscatter, which this phase function lacks. EPIC answers the question
instead (section 3): thin and mid columns gain the same excess at low Sun as
thick ones.

## 3. EPIC

Render minus EPIC, median display level, before → after this change:

| Class | cos θ₀ ≥ 0.9 | 0.7 to 0.8 | 0.5 to 0.6 | 0.4 to 0.5 | 0.3 to 0.4 | 0.2 to 0.3 |
| --- | --- | --- | --- | --- | --- | --- |
| Thick cloud, sea (opacity ≥ 0.6) | +7 → +5 | +16 → +3 | +46 → +16 | +52 → +13 | +63 → +13 | +67 → +14 |
| Mid cloud, sea (0.3 to 0.6) | +9 → +7 | +16 → +5 | +40 → +14 | +48 → +15 | +63 → +17 | +64 → +17 |
| Thin cloud, sea (0.1 to 0.3) | +13 → +12 | +11 → +4 | +28 → +10 | +47 → +21 | +63 → +25 | +62 → +20 |
| Thick cloud, land | −15 → −17 | +10 → −6 | +41 → +7 | +48 → +8 | +64 → +17 | +60 → +9 |
| Clear desert (Blue Marble 0.2 to 0.5) | +13 → +13 | +4 → +3 | −6 → −6 | −5 → −6 | +2 → −1 | +58 → +23 |
| Sea ice ≥ 80%, opacity < 0.3 | – | – | +14 → −13 | +3 → −20 | +11 → −15 | +54 → +16 |
| Clear sea | +6 → +6 | +5 → +3 | +7 → +2 | +7 → +0 | +12 → +2 | +27 → +9 |

In EPIC, thick sea cloud falls from 164 to 120 levels across these bins and
thin cloud stays near 95. In the render before this change, thick cloud rose
from 171 to 183 and thin cloud from 119 to 161. Clear surfaces track EPIC
within about ten levels at every Sun until the limb (0.2 to 0.3), where the
render's air is brighter.

The earlier notes' photometry (median by stored opacity and top height,
clouds ≥ 0.1), by ring around the sub-observer point:

| Ring | Mean \|render − EPIC\|, before → after | Opacity ≥ 0.6, before → after |
| --- | --- | --- |
| Within 40° (the earlier notes' ring) | 7.3 → 6.0 | −5.7 → −10.1 |
| 40° to 60° | 20.8 → 3.1 | +25.2 → +0.5 |
| 60° to 72.5° | 48.4 → 11.4 | +46.5 → +8.6 |

The only loss is thick high cloud near the sub-solar point (−9.4 → −14.1),
the convective cores over land that were already short of EPIC with either
ice coefficient. The seams note attributes them to the lighting of tall
columns.

## 4. The change

`cloudPropertiesSolarLaw` (`cloud-properties.ts`) multiplies the sunlit term
of measured columns by

f(cos θ₀) = 0.86 · m^1.19 / (0.48 + 0.38 m), m = clamp(cos θ₀, 0.1, 1),

so the columns' sunlight falls as cos θ₀^1.19 and is unchanged overhead,
where the EPIC comparison was made. One law serves every opacity. A variant
that kept thin columns on the shared term (exponent rising with opacity,
fitted to the slabs, rms 7%) left thin cloud 28 to 47 levels above EPIC at
low Sun. It also flattened cloud texture: the slope of ln(L/cos θ₀) on ln R
over cloudy sea at 56° S fell from 0.26 to 0.19 at cos θ₀ = 0.59, and from
0.37 to 0.15 at 0.30. The single law keeps it at 0.25 to 0.27 (VIIRS: 1).
Below cos θ₀ = 0.1 the law holds its value (0.11): the relief of real tops
catches grazing light that a plane would not. Ambient sky light, the
shadowing of other clouds and the forward-scattering term are untouched.

Everything is inside `#ifdef CLOUD_PROPERTIES`. The default renderer
compiles `solarLaw = 1`. A default-clouds frame at 56° S, rendered before and
after, is byte-identical (run-to-run noise between two renders of the same
code is 0 to 34 bytes of 3.84 million).

**After**, against VIIRS:

| Scene | Cloud R<sub>r</sub>/R<sub>v</sub>, before → after | Surface / cloud, relative to VIIRS, before → after |
| --- | --- | --- |
| Southern Ocean, thick sea cloud, cos θ₀ 0.30 to 0.59 | 1.84–2.66 → 1.30–1.37 | sea ice 0.26–0.39 → 0.49–0.54 |
| Sahel, thick land cloud, cos θ₀ 0.33 to 0.97 | 1.14–2.00 → 1.08–1.12 | desert 0.66–1.15 → 1.17–1.20; sand 0.61–1.08 → 1.07–1.13 |
| Antarctic coast, mid sea cloud, cos θ₀ 0.28 to 0.49 | 1.93–2.89 → 1.18–1.26 | plateau 0.25–0.38 → 0.56–0.60; sea ice 0.22–0.34 → 0.51–0.54 |

In the 2,000 km frame of the sea-ice note, clear ice against thick sea cloud
moves from 0.44 to 0.56 of luminance (VIIRS reflectance 1.28; the radiance
VIIRS implies at these Suns is about 1.04). The surface-to-cloud balance no
longer depends on the Sun. What remains is a constant factor, split between
the ice (0.70 of VIIRS) and the cloud (1.30 of VIIRS) below.

The look (shared notes; before left, after right):
`sun-zenith-so56-1120.jpg` and `-0740.jpg` show the ice and cloud
of the 2,000 km frame approaching each other, with the straight veil edges less
prominent. `sun-zenith-sahel-1540.jpg` shows evening cumulus that no longer glares over
the desert. `sun-zenith-oblique-420.jpg` shows the 420 km view looking south-east:
texture kept, the deck slightly dimmer. `sun-zenith-disc-epic.jpg` shows EPIC, before and after: the
bright warm rim of limb cloud becomes EPIC's dimmer, bluish limb.
`sun-zenith-disc-dusk.jpg` shows a 20,000 km disc with the terminator: clouds now fade toward
it with the ground.

## Recommendation and what remains

- **Keep the law for the study** (this commit). It is the cause the
  frames, VIIRS and EPIC agree on, and it does not touch the default.
- **Sea ice and snow are 0.65 to 0.73 of VIIRS**, now the larger part of the
  ice gap and 13 to 20 levels under EPIC. The study scaled its ice to Blue
  Marble's plateau so that ice and continent keep VIIRS's contrast. Raising
  the ice alone would break that. Blue Marble's tone is not linear
  reflectance: desert 1.3 times VIIRS, snow 0.81 to 0.86. A tone correction
  of the day map, fitted against VIIRS clear sky across albedo, would fix
  both and is a renderer-wide decision.
- **Mid-thickness cloud stays 1.3 times VIIRS** over the Southern Ocean
  (deeper Sahel cloud is 1.1). The stored opacity is the plane albedo, but the
  render shows it as nadir brightness. At τ 16 the slabs' nadir reflectance
  is 0.84 of that albedo, and at τ 64 it is 1.04, which is the observed
  spread. This is the same signature as the thin-cirrus excess in the seams
  note. Lighting columns by their bidirectional reflectance needs a droplet
  phase function with a glory to be honest near backscatter. That is the
  next study of the cloud level, after VIIRS phase.
- **The default renderer** lights the plates with the same shared term, so
  its clouds presumably share the low-Sun excess. Its clouds have no measured
  albedo, though. Porting the law there changes the accepted photographic
  look near the terminator. It needs the owner's comparison, starting with
  the same EPIC bins on `clouds=balanced` and `calibrated`.
- **Thick convective cores near the sub-solar point** lose about 5 levels
  (−9.4 → −14.1 for high cloud within 40°); separate, as above.
- Not checked: the ISS photo view, Greenland, and phones.

## Reproduce

Frames came from a scratch copy of the seams note's step tool that takes a
scene list (centre, altitude, epoch); the class, μ₀ and EPIC binning
scripts and the Monte Carlo are local and not committed. Their outputs
(Monte Carlo tables, per-class medians of every frame, EPIC bins before and
after) are in
[the evidence file](evidence/cloud-properties-sun-zenith-2026-10-17.json).

```bash
CLOUD_VIEWS=disc CLOUD_VARIANTS=global bun scripts/compare-cloud-properties.mjs http://127.0.0.1:4491 /tmp/cloud-properties
```
