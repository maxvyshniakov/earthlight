# Render experiments

This is a historical report. Reproduce retired profiles from the local tag
`orbit-experiments-2026-10-10` (`f205884`) in a separate worktree. Their URLs
resolve to Compact in current builds. See the [current plan](orbital-performance-targets.md)
for active profiles and acceptance results.

The newer [architecture candidate report](orbital-architecture-candidates.md)
compares cloud-light reuse, atmospheric lookup and separate rendering passes.
The earlier storm CPU numbers below refer to the previous 4096-cell model. A
concurrent change now uses selected cloud complexes, so that historical 24.35x
comparison is not a current speedup claim. The CPU benchmark reports non-equivalent
outputs rather than a speedup when comparing different storm models.

## Architecture candidate

[Optimized pipeline](http://localhost:4321/?compare=1&render=optimized)
keeps the original resolution, 24 fps, texture assets, cloud integration and four
shadow samples. It changes where work happens:

- Cull invisible storm cells before pulse evaluation and cache deterministic
  event timing per cell/cycle. The 224 KiB cache is bounded; seeks replace entries.
- Project planet and lunar samples once per frame on CPU and upload the same
  four-float uniform layout, instead of repeating projection per fragment.
- Skip sky-source shading behind opaque ground and lighting terms whose final
  material weight is exactly zero. Keep panorama derivatives outside the visibility
  branch and preserve cloud footprint filtering.
- Reset point-reflection slots when the star catalog arrives. Previously, paused
  scenes could retain zero-weight reflections depending on asset loading order.

Storm optimization and the catalog-state fix apply to every profile because they
retain the intended output. GPU changes remain opt-in for visual comparison.

The CPU microbenchmark compares directly with published revision `815ede7`:
240 camera/time/rate states have byte-identical source output. Five batches gave
median 586.42 ms before and 24.08 ms after (24.35x for this function, about
2.44 ms to 0.10 ms per invocation). A separate 480-state regression includes
18/24 fps, reverse playback, cycle boundaries and seeking. These are function
measurements, not whole-frame speedups or battery estimates.

Whole-frame GPU ablation identified the main world shader as the bottleneck:
a cloud-heavy frame was approximately 36 ms with all passes and 1.7 ms with the
world draw omitted. Omitting exposure or finish alone saved little. This diagnostic
changes the image and is only attribution evidence, not an optimization result.
Per-pass queries on this Metal backend did not provide additive timings, so all
reported comparison timings span the complete frame.

A candidate for further GPU work is reuse of expensive volumetric lighting
across samples/frames. It needs explicit error bounds around moving clouds,
limbs, lightning and camera changes; it is not implemented by these exact-work
eliminations.

## Architecture measurements

Same 1440 × 900 output, 24 fps target, Apple M2 Max / ANGLE Metal. Each timing
uses 36 whole-frame GPU samples after six warmup frames, with assets and exposure
settled, camera paused and adaptive quality disabled.

| View | Original GPU | Optimized GPU | Max channel difference (0–255) |
| --- | ---: | ---: | ---: |
| Day | 16.56 ms | 15.89 ms | 1 |
| Night | 19.24 ms | 9.28 ms | 0 |
| Horizon | 8.50 ms | 8.80 ms | 0 |
| Clouds | 29.21 ms | 32.29 ms | 1 |
| Moon | 9.68 ms | 9.76 ms | 1 |

The GPU candidate is not a universal improvement: the cloud-heavy view regressed
about 11% in this run, while the night view improved. GPU scheduling/clock variance
limits a single paired run; the small day/horizon/moon differences do not establish
a reliable speedup. It remains opt-in rather than replacing the reference path.
The storm CPU optimization applies to both sides of this GPU comparison.

All five image comparisons passed without reducing resolution, cadence or sampling
budgets. Night and horizon matched exactly; other differences were at most one
channel level. Raw timings, p90, hardware identity and image differences are in
[orbital-pipeline-performance.json](evidence/orbital-pipeline-performance.json). These
measurements do not establish battery savings.

## Quality trade-off candidates

The demo has an opt-in [comparison selector](http://localhost:4321/?compare=1&render=balanced).
It switches one renderer at a time and preserves the camera, date, playback
state, speed and image controls across reloads. Pause before switching to compare
the same frame. Without `render`, the original renderer remains selected.

| Profile | Resolution relative to original | Cadence | Cloud shadows |
| --- | --- | --- | --- |
| Optimized pipeline (`optimized`) | 100% per axis | 24 fps | Four samples |
| Original (`reference`) | 100% per axis | 24 fps | Four samples |
| Lean clouds (`shadows`) | 100% per axis | 24 fps | Two samples |
| Balanced (`balanced`) | 80% per axis, 64% of pixels | 24 fps | Four samples |
| Low power (`eco`) | 70% per axis, 49% of pixels | 18 fps | Two samples |

These scales multiply the existing adaptive resolution. `quality=fixed`
disables adaptation for repeatable measurements; it does not disable the selected
profile. Texture assets and the 16–96 step visible cloud integral remain intact.
Lean clouds skips neighborhood sampling where convection is zero and integrates
shadows over the same 25.5 km support using two intervals. This changes shadow
depth; it is an approximation to compare visually, not an equivalent calculation.

Low power normalizes the cadence feedback so intentional 18 fps does not look
like missed 24 fps deadlines. Lightning integrates over the selected frame period
to retain short pulse energy. Paused scenes stop drawing after exposure settles.

## Earlier quality trade-off measurements

Measured on 2026-10-09 in isolated Chromium on Apple M2 Max / ANGLE Metal,
1440 × 900 CSS pixels, DPR 1, all assets settled. Asynchronous WebGL GPU timer
queries span all rendering passes. Each row uses the median of 36 frames after
six warmup frames. The camera is paused and adaptive quality disabled. Full
results, including p90 and WebGL status, are in [orbital-performance.json](evidence/orbital-performance.json).

| View | Original | Lean clouds | Balanced | Low power |
| --- | ---: | ---: | ---: | ---: |
| Day | 16.76 ms | 18.04 ms | 12.81 ms | 12.65 ms |
| Night / aurora | 16.65 ms | 16.29 ms | 13.09 ms | 12.22 ms |
| Mostly sky / horizon | 9.13 ms | 8.60 ms | 7.64 ms | 7.09 ms |
| Clouds filling the frame | 28.59 ms | 22.02 ms | 20.54 ms | 17.48 ms |

Balanced reduced GPU time per frame by 16–28% in these views. Lean clouds saved
23% on the cloud-heavy view but regressed 8% on the first day view; it is not a
general replacement yet. Low power reduced per-frame time by 22–39%. Multiplying
by its 18 fps cap gives an estimated 42–54% reduction in GPU work per second
relative to Original at 24 fps. This estimate is not a measurement of watts or
battery life. GPU clocks, other applications and different devices affect results.

Start visual review with [daytime clouds](http://localhost:4321/?compare=1&render=balanced&motion=0&t=3235.65&pitch=-25&epoch=2026-10-06T01:32:27Z),
then inspect [night and aurora](http://localhost:4321/?compare=1&render=balanced&motion=0&t=610.87&epoch=2026-10-06T01:32:27Z).
Balanced is the most consistent candidate in this run; Low power trades fine
detail and motion cadence for the largest reduction.

## Reproduce

Serve the static build locally, then run:

```sh
bun scripts/benchmark-storm-light.mjs
bun run benchmark:scene http://127.0.0.1:4347 /tmp/orbit-pipeline all reference,optimized
bun run benchmark:scene http://127.0.0.1:4347 /tmp/orbit-profiles
bun run verify:profiles http://127.0.0.1:4347 /tmp/orbit-profile-checks
```

The benchmark requires hardware timer queries, rejects disjoint samples and
WebGL errors, and saves one screenshot per view/profile. It never substitutes
JavaScript submission duration for GPU timing. An optional third argument selects
`day`, `night`, `horizon`, `clouds`, `moon` or `all`. A fourth argument is the
comma-separated profile list, starting with `reference`. Optimized screenshots
are compared pixel-by-pixel, excluding the different selector labels.
`SCENE_PROFILE=optimized bun run verify:scene <base> <output>` runs the
existing WebGL/interaction regression suite against this candidate.

The browser checks cover selection, camera and control preservation, actual
18 fps playback, zero draws after pause settles, context restoration, mobile
layout, page-mode links and the unchanged default selection.

## Validation

- `bun run verify`: 73 tests passed; Astro check reported no errors, warnings
  or hints; dev-URL static build passed.
- `SCENE_PROFILE=optimized bun run verify:scene`: complete browser suite passed,
  including lighting/optical fixtures, seven scene frames, failed assets, context
  restoration, viewport rotation, capability fallbacks, focus, flight, touch and
  calendar. Motion measured 23.83 fps at scale 1.0 with WebGL error 0.
- `bun run verify:profiles`: all five profiles, camera/settings preservation,
  context restoration, 390px layout and page-mode links passed. Low-power playback
  measured 17.80 fps; settled pause produced zero frames.
- Five full-resolution reference/optimized image comparisons passed.

