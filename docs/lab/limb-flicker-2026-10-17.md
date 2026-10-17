# Limb flicker and anisotropic cloud footprints, 2026-10-17

Follows the owner's report in [cloud calibration](cloud-calibration-2026-10-17.md):
pixels near the limb flicker while the globe turns. Numbers are in the
[evidence file](evidence/limb-flicker-2026-10-17.json); paired crops and
instability maps are in [this sheet](evidence/limb-flicker-2026-10-17.jpg).

## Measurement

`scripts/measure-limb-flicker.mjs <base-url> <out-dir> <label> [query]`
renders each view five times at 1280 × 800 in fresh agent-browser sessions,
turned by about 0.3 px per frame. Grain is off and exposure fixed at −0.6 EV.
Two numbers per band, in 8-bit levels averaged over RGB:

- **Turn difference**: mean |frame 2 − frame 0|, a 0.6 px turn. It matches
  the owner's measurement and includes honest motion of sharp detail.
- **Instability**: mean |I(k−1) − 2 I(k) + I(k+1)|. A band-limited image moving
  this little changes almost linearly at each pixel; aliasing does not.

Bands come from the renderer's camera: μ is the cosine between the view ray
and the ground normal. Two views were measured:

- **Polar**: the owner's pose at 6,490 km. The turn is a step in orientation x.
- **Horizon**: 420 km over the Bay of Bengal's monsoon cloud, looking north.
  The turn is a step in elevation.

Repeat runs agree within 2%. `SUPERSAMPLE=2` renders 2560 × 1600 and
box-filters it to 1280 × 800: a reference for what an ideally filtered frame
would still show.

## Which layer flickers

Baseline instability, limb (μ < 0.1) / grazing (0.1–0.25):

| Variant | Polar | Horizon |
|---|---|---|
| Baseline | 2.32 / 1.61 | 2.49 / 1.75 |
| `clouds=off` | 0.83 / 0.58 | 0.43 / 0.25 |
| `terrain=0` | 2.49 / 1.55 | 2.34 / 1.75 |
| `clouds=off&dayDetail=0&nightDetail=0` | 0.83 / 0.58 | 0.43 / 0.16 |
| `cloudDetail=0` | 2.31 / 1.63 | 2.23 / 1.32 |
| `look-chromatic=0` | 4.24 / 2.78 | 3.03 / 2.24 |

Clouds cause most of it. Terrain does not. Day tiles add a little at the
horizon; the polar view uses none. Lateral chromatic fringing does not cause
flicker. It smears the colour channels apart and hides some, so turning it off
makes the limb worse. The disc (μ > 0.5) is 0.44 (polar) and 0.13 (horizon).

## Cause

Ground surfaces already filter the major axis of the pixel's ground ellipse:
the day and night tile footprints, terrain normals and ocean glint all divide
by the view cosine. The base albedo uses hardware gradients with up to 8×
anisotropy. The cloud view integral used `max(pixelFootprint, stepLength/2)`,
with no 1/cos term.

An opaque cloud top behaves as a surface. Transmission falls within one or
two kilometres of the entry point, much less than the 10–100 km major axis
near the limb, so the march does not average along it. The coverage map was
sampled for the minor axis alone, and foreshortened streaks aliased.

## Fix

`cloudIntegral` passes each sample's ellipse to a view-only density. Its major
axis is `pixelFootprint / max(.05, |cos|)`, along the ray's horizontal
direction. Up to 3:1 anisotropy, one tap keeps the isotropic filter. Beyond
that, two taps at ±¼ of the major axis each filter half of it, so the minor
axis keeps its detail. The neighbourhood envelope and the unresolved relief
noise use the major axis. Shadow rays, lens transmission and storms keep the
isotropic density.

At nadir the ellipse is a circle and the result is unchanged.

## Results

Instability, before → after [2× supersampled reference]:

| Band | Polar | Horizon |
|---|---|---|
| Limb μ < 0.1 | 2.32 → 1.40 [1.10] | 2.49 → 1.25 [1.24] |
| Grazing 0.1–0.25 | 1.61 → 0.92 [0.84] | 1.75 → 0.94 [1.10] |
| Oblique 0.25–0.5 | 0.67 → 0.57 [0.73] | 0.22 → 0.21 [0.19] |
| Disc μ > 0.5 | 0.44 → 0.44 [0.56] | 0.13 → 0.13 [0.10] |
| Air above the limb | 1.11 → 0.76 [0.61] | 1.03 → 0.98 [0.69] |

The owner's turn difference over 0.6 px at the limb falls from 2.38 to 1.75
(polar) and from 4.26 to 2.88 (horizon). On the disc it stays at 1.46 and 0.54.
At the horizon both bands now match the supersampled reference. What remains
there is sharp foreshortened edges moving, not aliasing. In the polar view
the limb is still 27% above the reference.

Sharpness is the mean gradient magnitude of frame 0:

- **Disc, unchanged.** Polar 3.513 → 3.513; horizon 1.937 → 1.935.
- **Horizon grazing rows, −18%.** 6.57 → 5.39. Part of that energy was alias.
  The isotropic major axis lost 31%, and the crops show it as blur along the
  horizon.

### After merging the Calibrated preset

Measured again on top of main's seam blend, terminator fade and Calibrated
preset. Instability before → after:

| Band | Balanced, polar | Balanced, horizon | Calibrated, polar | Calibrated, horizon |
|---|---|---|---|---|
| Limb μ < 0.1 | 2.25 → 1.41 | 2.49 → 1.25 | 2.41 → 1.71 | 2.06 → 1.40 |
| Grazing 0.1–0.25 | 1.55 → 0.91 | 1.75 → 0.94 | 1.74 → 1.22 | 1.88 → 1.03 |
| Disc μ > 0.5 | 0.43 → 0.43 | 0.13 → 0.13 | 0.48 → 0.48 | 0.28 → 0.27 |

At the polar limb Calibrated falls less than Balanced (−29% against −37%);
the reason was not isolated.

## Cost

`scripts/compare-cloud-footprint.mjs` times whole frames on one GPU. Two fresh
clones of the explorer run side by side; the reference is compiled with the
HEAD cloud module, and frames alternate AB/BA. The machine was shared and
heavily loaded (load average 10–36).

An A/A run is the noise floor: paired medians 1.045 (polar), 1.015 (horizon)
and 1.003 (nadir). An earlier harness compared a clone against the page's own
explorer and read 10–17% in A/A; that design was replaced.

Final paired medians over two runs:

| View | Change | Frame time |
|---|---|---|
| Horizon | +9% and +5% | about 23 → 25 ms |
| Polar | +1% and +12% | quartiles span ±20% |
| Nadir | +2% and +2% | inside the A/A floor |

## Rejected

- **Isotropic major axis.** One coarser tap. Limb 1.36 / 1.16 and close to
  free, but horizon clouds blurred along the limb.
- **Four taps from 1.5:1 or 3:1.** From 3:1 they were less stable than two
  taps (limb 1.46 / 1.37), about 4% sharper in the grazing rows and cost +27%
  at the horizon. A loop around the texture-heavy coverage call cost 5% at
  nadir even when it ran once, so a single tap takes a straight path.
- **Base-map-only extra taps.** Removed most of the cost, but with detail tiles
  the base cloud map is 4096 wide (9.8 km texels). Horizon clouds would lose
  their detail.
- **Clear-air gate** on the ellipse mean: no measurable saving.
- **Height ramps widened** by the pixel's vertical extent: no change.
- **Cloud lighting atlas, temporal reuse.** `cloudLighting=raymarch` and
  `cloudReuse=off` changed nothing.

## Limits

- The remaining polar limb gap and the clear-air residual come from the
  surface. Hardware anisotropy stops at 8:1, and day/night tiles select their
  level from half the footprint. Neither was changed here.
- The 3:1 switch changes the along-view filter from one pixel to three. The
  difference image shows no contour.
