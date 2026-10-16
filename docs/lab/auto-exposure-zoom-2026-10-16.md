# Automatic exposure and zoom, 2026-10-16

Zooming onto the Moon left it clipped white over a grey Milky Way: automatic
exposure stayed at its +4.1 EV ceiling, as for an empty black sky.

## Measurement

The metered EV was read from the meter's 1 × 1 state targets by a page init
script in an isolated agent-browser session (1200 × 800, paused, 9 s
settle), without changes to the renderer. The same script replayed the
meter's 32 × 32 samples on the scene texture.

| Subject | Lens | Before | After |
| --- | ---: | ---: | ---: |
| Moon (Earth limb in frame at 1–2×) | 1× | +0.12 | +0.12 |
| | 2× | +0.45 | +0.45 |
| | 5× | +4.10 | +4.10 |
| | 10× | +4.10 | +4.10 |
| | 20× | +4.10 | +3.77 |
| Distant Earth, lit half | 0.758× | +4.10 | +3.07 |
| | 1.5× | +0.06 | +0.06 |
| | 3× | +0.10 | +0.10 |
| | 6× (night side fills frame) | +4.10 | +4.10 |
| Sunlit Earth from 955 km, nadir | 1–20× | −0.62 to −0.91 | unchanged |

"Before" is fc442fb, before the lens work of this date; the meter was the
same in its successors. Over a uniform subject the meter does not depend on
zoom. It failed for bright subjects smaller than the frame.

## Cause

The meter blends two targets by the share of samples that are lit:
a trimmed log mean (target 0.055) and a highlight target (0.25), with full
weight for the highlight from 2.5% of samples and none below 0.6%. It
clamped only after blending. A black sky asks for about +15 EV, so even at
half weight the blend stayed far above the +4.1 ceiling: the distant Earth
lit 1.3% of samples (weight 0.3), and mix(+15, +0.5, 0.3) ≈ +11. Both targets
are now limited to the automatic range before blending. A GPU regression in
`scripts/exposure-browser-fixture.mjs` meters a 14 × 14 block covering 1.2%
of a black frame: +1.5 EV now; the old blend gave +4.1.

## What remains

- **Moon at 5–20×.** A half-lit Moon at 20× lights 7 of the 1024 samples
  (0.47% of the frame is brighter than 0.1), far below the 2.5% where the
  highlight target counts in full; its weight stays under 0.1. The meter
  still exposes for the sky, as an average-metering camera does with a
  small Moon. Fixing that is a metering decision: lower the coverage ramp,
  or meter from an area-averaged level of the glare pyramid so every pixel
  counts and coverage stops depending on where samples fall.
- **Sun at zoom.** The meter asks for −4 EV at 1× and below −12 EV at 15×,
  and the automatic floor holds it at −1.5 EV. With the angular veil, the
  zoomed Sun therefore fills the frame. The floor is deliberate (Earth stays
  visible with the Sun in frame); lowering it is also a look decision.
