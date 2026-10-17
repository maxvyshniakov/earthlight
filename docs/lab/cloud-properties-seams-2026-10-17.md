# Measured clouds, third iteration: date, seams and thin cirrus, 2026-10-17

The [second iteration](cloud-properties-iteration-2026-10-17.md) left three
items before the measured clouds (`cloudStudy=global`, NOAA-20 VIIRS for
22 September 2026) could replace the plates: choosing the day from the scene's
`epoch`, a review of swath edges and the date-line seam in motion, and thin
high cloud rendering 10 to 16 levels brighter than DSCOVR EPIC. This note takes
each in turn, after a regression found on the way. Nothing was published and
the study stays opt-in.

Frames are 1,200 × 800, manual exposure 0 EV, raymarched self-shadows, viewed
and not committed. EPIC registration and binning are those of the second
iteration (EPIC `epic_1b_20260922112448`, 11:20 UTC; within 40° of the
sub-observer point; median 8-bit luma per bin of stored opacity, split by
measured top: low < 3.2 km, high ≥ 6.5 km).

## 0. Regression: measured clouds drawn through the plates' column

**Before.** On main after the merge of the second iteration (1dadc8d), the
disc came out about half a stop darker than at fbb1bb3, clear ocean included:
median linear ratio 0.69 to 0.73 in the mid-tones. The ellipse-filtered view
ray (`cloudIntegratedDensity(…, ellipse)`, 12ef25d, written on main while the
study was on its branch) had no `CLOUD_PROPERTIES` branch. Since the merge the
view ray drew the measured opacity through the plates' Balanced column
(`pow(coverage, 1.35)` and the photographic profile), while shadows and the
lighting atlas still used the measured column. The existing test checked only
the older entry point.

**After.** The overload returns `cloudPropertiesDensity` like the others; the
test now checks every `cloudIntegratedDensity` body. The disc render matches
fbb1bb3 pixel for pixel (linear ratio 1.000 in every brightness bin). Against
EPIC:

| | Mean \|render − EPIC\|, opacity ≥ 0.1 | Opacity ≥ 0.6 |
| --- | --- | --- |
| main at 390e13b | 15.0 | −23.9 |
| Fixed (equal to fbb1bb3) | 8.0 | −5.7 |

All numbers below are on the fixed renderer.

## 1. The measured day follows the scene's epoch

**Before.** The overview and tiles were always `cloud-properties/2026-09-22`,
whatever the scene's date.

**After.** `cloudPropertiesDate` (`src/scripts/cloud-properties.ts`) takes the
scene's date the way `SceneCalendar` does, `epoch` at the scene time `t`, and
returns its UTC day when that day is listed in `CLOUD_PROPERTIES_DATES`. Any
other date falls back to the default, 22 September 2026, never to a
neighbouring day: weather a day away is another sky, and a nearest-day rule
would present it as the scene's own. The renderer loads the overview and tiles
of that day and reports `cloudDate` and `cloudDateSource` (`epoch` or
`default`). The study panel names the day drawn and adds "на дату сцены данных
нет" on a fallback; its source link follows the day. The renderer chooses at
load. A calendar change later keeps the sky and the panel says the scene's date
changed. The build script takes the day as an argument
(`bun scripts/prepare-cloud-properties.mjs <cache> <YYYY-MM-DD>`); a new day
renders once its directory exists and it is added to the list.

Checked: the four comparison views report `2026-09-22 / epoch`; the explorer
without `epoch` (today, 17 October) reports `default` and the panel reads
"22 сентября 2026 · на дату сцены данных нет". Tests cover the UTC day edges,
`t` moving the date across midnight, and missing dates.

Why the UTC day: GIBS composites each day by local date and cuts it at the
date line (section 2). Its 22 September holds passes from about 01:30 UTC on
the 22nd, just west of the date line, to about 01:30 UTC on the 23rd, just
east of it, so it is the composite with the most passes on the UTC day of the
22nd. Only one day is built; matching a scene time to the nearest pass waits
for a second day (section 2).

## 2. Swath edges and the date-line seam in motion

**Where the seams are.** GIBS builds a polar orbiter's day by local date and
cuts it at the date line: in the NOAA-20 true colour and in every cloud layer
the 22nd ends in a straight pole-to-pole line at 180°. West of it the pass was
at about 01:30 UTC on the 22nd, east of it at about 01:30 UTC on the 23rd: the
same local afternoon, 24 hours apart. Within the day, adjacent swaths are one
orbit, 101 minutes, apart. Near the equator they barely overlap. Towards the
poles the later swath is drawn over the earlier one along a straight edge.

**Method.** The explorer at 1,200 × 800, `cloudStudy=global` and the
diagnostic (`cloudStudyView=quality`), settled frames in nine steps across each
seam, and a live glide (one 0.25 s flight key tap, 35 frames over 10 s) across
the date line at 40° N:

| Scene | Camera | Steps |
| --- | --- | --- |
| Date line, tropics | 2,000 km, nadir, 5° N | 176° E to 176° W |
| Date line, tropics | 420 km, 35° down, looking east, 7° N | 179.0° E to 178.4° W |
| Date line, North Pacific front | 2,000 km, nadir, 40° N | 176° E to 176° W |
| Date line, North Pacific front | 420 km, 35° down, looking east, 38° N | 179.0° E to 178.4° W |
| Swath edge, Southern Ocean | 2,000 km, nadir | 50° S 10° W to 56° S 4° E |
| Swath edge, Southern Ocean | 420 km, 35° down, looking south-east | 51.5° S 8° W to 54.5° S 0° |

Scene time is local noon at the date line (00:30 UTC) and 11:20 UTC for the
Southern Ocean, both on the 22nd.

**What is visible.**

- *North Pacific, 2,000 km.* The date line is a ruler-straight north-south cut
  across the frontal cloud band and the dry slot beside it; low stratocumulus
  (green in the diagnostic) ends on it. In motion it slides with the ground
  like a painted line. Along it runs a one-pixel darker line: in the 1.2 km
  opacity grid the column at 180° W averages 0.273 against 0.31 on both sides
  (tile column 0, first interior texel), probably a partial column at the
  antimeridian edge of the GIBS request. The other request edges (90° W, 0°, 90° E) show no such column,
  and the 4.9 km footprint and the overview have none.
- *North Pacific, 420 km.* Looking east across the line, broken cloud hides
  the cut: the cloud texture changes along a horizontal band, but no line
  stands out.
- *Tropics, 2,000 and 420 km.* The date line itself is hard to see between
  scattered cumulus. What draws the eye is next to it: a grey sheet with holes,
  about 200 × 1,300 km, at 178° W, 0 to 12° N, and a fainter slab with
  straight block edges at 178° E. Both lie on sun-glint stripes. On the two
  swaths that meet at the date line the VIIRS cloud mask flags the brightest
  glint as low cloud, with a top height and no optical thickness: partly
  cloudy pixels. Their 157 km clear-sky blocks then have too few clear pixels
  and take the dark ocean of their neighbours, so the reflectance inversion
  turns glint into opacity: 0.141 mean over the stripe against 0.084 just
  east of it. The diagnostic draws it as a low deck; at 420 km it is a blotchy
  grey foreground with pixel-sized steps. Glint stripes away from the seam
  (150° E, 150° W) are not flagged and add no opacity (0.041 in the stripe
  against 0.091 beside it).
- *Southern Ocean, 2,000 km.* A swath edge is a straight diagonal about
  600 km long: a frontal high-cloud shield (violet) on one swath ends on it.
  South of it, over sea ice, the partly cloudy pixels keep the median
  thickness (the reflectance inversion is off over bright surfaces) and form
  flat grey veils whose borders step along the 157 km clear-sky blocks.
- *Southern Ocean, 420 km.* The worst view: the swath edge and the block-edged
  veils make flat grey polygons with straight sides that slide across the
  foreground.
- *In motion.* Nothing pops or flickers as a seam passes: tiles had settled
  (no pending requests, no fading at the end of the glide), and the seams are
  data edges fixed to the ground. Their straightness, not any change over
  time, is what gives them away.

**Is a blend honest?** Not a cross-fade, at either kind of seam.

- Across the date line a blend would superimpose two skies 24 hours apart, a
  double exposure of weather that never coexisted. The honest fix moves the
  seam instead of hiding it. The 23 September composite saw the west side of
  the date line at about 01:34 UTC on the 23rd, minutes from the 22nd's pass
  on the east side. Choosing, per longitude, the composite whose pass is
  closest to the scene's time leaves one unavoidable 24-hour discontinuity
  where the pass is 12 hours from the scene: at about 01:30 local time, on
  the night side, where clouds return little light. That needs the
  neighbouring days built and loaded: about twice the data per scene.
- Across a swath edge, a blend over the overlap would double clouds displaced
  by 101 minutes of wind, 30 to 180 km in a midlatitude flow. GIBS already
  draws one swath. Only a motion-compensated interpolation could remove the
  edge, and that would be a model, not a measurement. The edges stay and are
  documented; in the tropics they are hard to find.
- The artefacts that are not time seams should be removed at the source, and
  doing so is honest because they are not observations of cloud: glint
  flagged as cloud (screen the partly cloudy inversion by sun-glint
  geometry), the dark column at 180° W (replace it by its neighbour in the
  build), and the block-edged polar veils (interpolate the switch between
  inverted and median opacity rather than thresholding it per pixel against
  block-interpolated clear sky). Each needs a rebuild of the tiles; none was
  made here.

**Before and after.** Before, the seams were known only from the build
(observations about 24 h apart). After: located (date line, 101-minute swath
edges), seen in motion at 2,000 and 420 km, and three source artefacts found
next to them, the glint slab, the dark 180° W column and the block-edged polar
veils. These are more visible than the seams themselves.

## 3. Thin high cloud brighter than EPIC

**Before** (second iteration, reproduced): opacity 0.1 to 0.3, median render
minus EPIC: low +12.3, middle +5.5, high +14.2 levels; thick high (≥ 0.6)
−9.0.

Two candidate causes were named: the ice albedo coefficient (c = 0.2165, from
asymmetry g = 0.75) applied to thin cirrus, or EPIC's ~16 km pixels averaging
cirrus with the sea. Three tests separate them.

**EPIC's pixels: not the cause.** Blurring both images to a common resolution
barely moves the excess: thin high +14.2 at native resolution, +12.0 at 40 km,
+10.8 at 80 km. Averaging with the sea would matter at cloud edges; restricted
to uniform sheets (opacity spread ≤ 0.2 over the surrounding ~50 km), the
excess grows instead: thin high +19.1, thin low +26.2.

**The surface splits the picture.** Over ocean (dark, BMNG), high cloud is too
bright at every opacity, not only when thin; over land, thin cloud is too
bright and thick cores too dim:

| Opacity bins | Ocean: thin high | Ocean: high ≥ 0.6 | Land: thin high | Land: high ≥ 0.6 |
| --- | --- | --- | --- | --- |
| Ice c = 0.2165 (current) | +21.3 | +15.8 | +12.5 | −15.7 |
| Liquid c = 0.13 for ice too | +14.3 | +8.6 | +5.3 | −26.6 |

Over ocean, the render's light per unit opacity, (L − (1 − A)·L_clear)/A in
linear units, is 0.74 to 0.75 for thin high cloud (opacity 0.1 to 0.3) and
0.64 to 0.65 for thick (0.6 to 0.9); EPIC's is 0.44 to 0.46 and 0.54 to 0.58.
The render is 1.6 times EPIC when thin and 1.1 to 1.2 times when thick, close
to the ratio of the ice to the liquid albedo at those optical thicknesses
(τ = 2: 0.301 / 0.205 = 1.47; τ = 20: 0.81 / 0.72 = 1.13). An overstated
albedo has exactly this signature: the stored opacity, which sets both the bin
and the render, is too high by a factor that shrinks as the cloud thickens.

**The ice coefficient lost its support.** The second iteration chose
c = 0.2165 because NOAA-20's own reflectance, split by MODIS phase, showed ice
brighter than liquid at the same retrieved τ. Split by cloud-top height as
well (4.9 km, dark surfaces, within 50° of the equator, raw inversion before
calibration), the difference is height, not phase:

| Retrieved τ | 1.0 | 2.0 | 3.0 | 6.2 | 16 | 27 |
| --- | --- | --- | --- | --- | --- | --- |
| Ice, top ≥ 6.5 km | 0.140 | 0.214 | 0.279 | 0.434 | 0.663 | 0.771 |
| Liquid, top ≥ 6.5 km | 0.142 | 0.205 | 0.262 | 0.397 | 0.613 | 0.714 |
| Liquid, top < 3.2 km | 0.105 | 0.146 | 0.189 | 0.304 | 0.491 | 0.584 |
| Ice, top < 3.2 km | 0.092 | 0.129 | 0.166 | 0.264 | 0.438 | 0.513 |
| 0.13τ / (1 + 0.13τ) | 0.117 | 0.205 | 0.280 | 0.445 | 0.677 | 0.777 |
| 0.2165τ / (1 + 0.2165τ) | 0.181 | 0.301 | 0.393 | 0.570 | 0.777 | 0.852 |

High ice cloud follows the liquid relation within 0.03 at every thickness and
is 4 to 9% brighter than high liquid cloud, not the 47% the ice coefficient
gives at τ = 2. Low cloud of either phase is darker per retrieved τ, as broken
low cloud should be in a 4.9 km mean. Most liquid cloud is low and most ice is
high, so a split by phase alone mistook height for phase. GIBS publishes no
VIIRS phase, so the phase VIIRS assumed when it retrieved each τ cannot be
read; MODIS phase, 1 to 1.5 hours away, is a proxy.

**The test.** Rendering with the liquid relation for ice too (a temporary
shader change; the asset is unchanged, binning remapped to match):

| | Mean \|d\| ≥ 0.1 | Thin low | Thin middle | Thin high | High ≥ 0.6 | All ≥ 0.6 |
| --- | --- | --- | --- | --- | --- | --- |
| Ice c = 0.2165 (current) | 8.0 | +12.3 | +5.5 | +14.2 | −9.0 | −5.7 |
| c = 0.13 for ice too | 7.7 | +10.5 | +2.9 | +7.1 | −19.7 | −12.9 |

**Result.** The ice coefficient accounts for about half of the thin-cirrus
excess (+14.2 → +7.1). The other half is common to thin cloud of every type:
thin low liquid cloud is +10 to +12 either way. EPIC's resolution accounts for
2 to 3 levels at most. The liquid relation for ice also takes back the
improvement in thick high cloud over land (−15.7 → −26.6), which the ice
coefficient had covered.

**Not changed in this iteration.** The evidence removes the reason for the ice
coefficient but does not yet give a better relation: switching trades +7
levels of thin cirrus for −11 of thick cores. Next steps:

- Read VIIRS's own retrieval phase from CLDPROP_L2_VIIRS_NOAA20
  (`Cloud_Phase_Optical_Properties`, LAADS, needs an Earthdata login) to learn
  which scattering model each τ came from, then fit c per VIIRS phase on the
  overpass's own reflectance, as above.
- Treat thick land cores separately: they are short of EPIC with either
  coefficient and are the lighting of tall columns, not their albedo.
- The thin-cloud excess common to all phases is strongest in uniform sheets.
  Candidates: the solar-zenith dependence of thin-cloud albedo (EPIC sees the
  sub-solar disc, where thin clouds reflect least; the stored albedo is a
  diffuse-light value) and the calibration of partly cloudy pixels, which
  fills most thin bins with the retrieval's own scale.

## Go / no-go

**Still opt-in; one regression fixed.**

0. Since the merge of the second iteration, main had drawn measured clouds
   through the plates' column on the view ray. Fixed; the render equals fbb1bb3
   again and a test guards every density entry point.
1. The measured day now follows the scene's `epoch` (UTC day at scene time
   `t`) and falls back to 22 September 2026, labelled, when the date has no
   data. Only one day is built.
2. The date-line seam is a straight 24-hour cut, most visible across
   midlatitude fronts at 2,000 km; swath edges are 101-minute cuts, most
   visible over the Southern Ocean and sea ice. Neither should be cross-faded.
   The date line can be moved to the night side with the neighbouring days
   built. Three build artefacts sit next to the seams and are worse than they
   are: glint inverted into cloud on the two swaths at the date line, a dark
   column at 180° W, and block-edged median veils over sea ice.
3. Thin cirrus is too bright mainly because of the ice coefficient (about
   half of the excess) and a thin-cloud excess common to all phases (the
   rest); EPIC's resolution contributes 2 to 3 levels. The coefficient's
   evidence was confounded by cloud height. Switching it alone would trade
   thin cirrus for thick land cores, so it waits for VIIRS's own phase.

Before a default: rebuild with the glint screen, the 180° W column and the
polar veils fixed; settle the ice relation on VIIRS phase; build a neighbouring
day so the date line can move; and the owner's comparison on desktop and
phone.

## Reproduce

```bash
bun scripts/prepare-cloud-properties.mjs /tmp/earthlight-cloud-properties-cache 2026-09-22
```

```bash
CLOUD_VIEWS=disc CLOUD_VARIANTS=global bun scripts/compare-cloud-properties.mjs http://127.0.0.1:4431 /tmp/cloud-properties
```

The photometry above registers `disc-global.png` against the EPIC frame and
the overview as in the second iteration, adding a land/ocean split from the
BMNG day map, a common Gaussian blur and a 5 × 5 overview homogeneity filter.
The comparison script now also asserts that measured variants report
`cloudDate=2026-09-22` from the epoch.
