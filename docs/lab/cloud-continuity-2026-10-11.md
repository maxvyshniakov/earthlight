# Continuous optical cloud structure — 2026-10-11

The user accepted the first improvement to cloud rims but still saw rough white
crowns over grey lower clouds. This follow-up compares against that reviewed
iteration, not against the original renderer.

## Evidence and diagnosis

The [MODIS view of the Southern Indian Ocean](https://science.nasa.gov/earth/earth-observatory/clouds-over-the-southern-indian-ocean-80661/)
shows both smooth shields and cellular texture. Its extensive bright cloud
fields are predominantly shallow: brightness does not identify deep convection.
The [ISS view over the Philippine Sea](https://www.nasa.gov/image-article/cloudscape-over-philippine-sea/)
describes real high anvils and strong depth under backlighting. The objective
is not to eliminate every visible cloud boundary or every difference in texture.

In the reviewed shader, an unrelated large-scale noise field selected cloud
families. Its convection weight increased height, restored stronger fine relief,
and increased integrated optical depth. The same arbitrary mask therefore
changed shape, texture and whiteness together. Merely damping relief and
normalizing opacity left the mask visible as smooth contour bands in Antarctica;
that intermediate candidate was discarded.

## Implementation

The photographic coverage and its filtered neighbourhood now shape a single
continuous vertical envelope. A small, footprint-filtered relief contribution
remains, attenuated over connected cloud shields. The independent regional mask,
separate deck/body mixture, noise-dependent density multiplier and invented ice
veil are removed. The opt-in texture variant uses the same envelope without the
fine procedural relief.

Density is normalized by the analytic integral of its vertical profile. A taller
column preserves optical thickness at the same local coverage. Base and top
ramps remain disjoint even at thin edges, making that normalization valid there
too. All view, cached lighting, traced shadow and lens paths share this density.
No screen blur, extra noise octaves or integration samples were introduced.

This remains an illustrative extrusion of optical coverage. The envelope reaches
roughly 2–9 km, but those heights are not satellite retrievals. This change does
not establish physically correct cloud genera or measured weather evolution.

## Reproduction and regression coverage

The reviewed density function is retained as
[evidence/cloud-morphology-v1-density-2026-10-11.glsl](evidence/cloud-morphology-v1-density-2026-10-11.glsl).
The comparison harness accepts either a complete saved source or that function:

```sh
bun scripts/compare-cloud-tops.mjs http://127.0.0.1:4362 /tmp/cloud-continuity-final docs/lab/evidence/cloud-morphology-v1-density-2026-10-11.glsl cells,north,south
```

The harness shares camera, time, resolution, exposure and assets across both
renderers and replaces only the reference density. It records 32 retained AB/BA
GPU timing pairs after eight warmup pairs. `CLOUD_TOPS_CAPTURE_ONLY=1` skips timing.
Additional views are `nadir`, `low` and `sunset`. All screenshots use 1440 × 954,
fixed quality, manual −0.5 EV and no grain. The two high views reconstruct rounded
screenshot telemetry; `cells` uses the supplied exact URL pose.

GPU fixtures now check that fine relief and changing broad-envelope height do
not repaint local opacity, that the former noise mask cannot create deep islands,
and that photo-driven vertical relief remains bounded. The new envelope test
fails against the reviewed density (opacity span about 0.055 at 25% coverage)
and passes against the new density (no difference at its 8-bit readback precision).
Both cloud variants retain the independent 512-sample shadow comparison.

The shallow-cloud lightning fixture now creates dense local detail inside a
sparse photographic overview. Previously it selected a shallow deck by changing
the removed noise mask. The requirement that shallow clouds cannot host a deep
cloud flash is unchanged; clear air, thin cloud, detailed gaps and occlusion are
still checked independently.

## Validation

`bun run verify` passed: 210 tests, Astro check with zero errors/warnings
and five existing hints, and a production build. The first attempt hit the
existing five-second terrain-predictor timeout under concurrent load; the same
unchanged test passed on the repeat.

`bun run verify:scene` passed against that production build (45 result records).
This includes both density variants, profile continuity, shadows, night lighting,
lightning, seven scene frames, fallback assets/capabilities, context restoration,
optics, camera/flight, touch/swipes and calendar. The motion sample delivered
23.83 fps at scale 1 with zero WebGL errors. This is not a mobile benchmark.
The peak error against the independent shadow integral was 0.0392; varying the
height envelope at fixed coverage produced no opacity difference at 8-bit
readback precision in either variant.

The first browser run caught the obsolete noise-selected shallow-cloud fixture;
it passed after the fixture was changed to exercise an actual shallow envelope.
All flash exclusion assertions remain in place.

Six before/after pairs were inspected, including a nadir view. The local viewer
loads all pairs and its slider at desktop and 390 px widths without horizontal
overflow. Screenshots are review artifacts, not shipped image assets.

The initial timing attempt was rejected: both renderers submitted 85 frames
instead of the requested 40. The harness now holds the original seek input value
constant; round-tripping that value through the displayed slider could drift
scene time and restart exposure settling. The strict frame-count assertion is
retained, and rejected timings are not reported.

All three final timing comparisons passed matching-camera, zero-asset-failure,
valid-query and exactly-40-frames-per-renderer checks.

| View | Reviewed v1 GPU ms | New GPU ms | Median paired ratio |
| --- | ---: | ---: | ---: |
| cells | 56.35 | 44.97 | 0.777 |
| north | 47.39 | 37.08 | 0.740 |
| south | 58.64 | 45.34 | 0.724 |

The paired medians show 22–28% less GPU time on these three views. These are
local desktop comparisons, not presentation FPS or mobile/thermal results.
Unrelated machine activity was not controlled. Marginal time medians and median
per-pair ratios need not agree under variable load. Retained pairs, screenshot
hashes and fixture results are in
[evidence/cloud-continuity-2026-10-11.json](evidence/cloud-continuity-2026-10-11.json).

No commit, push or deployment was performed.
