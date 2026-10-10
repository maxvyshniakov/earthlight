# Cloud edge refinement experiment — 2026-10-10

## Decision

Archive the refinement on `codex/cloud-edge-refinement-experiment`. It improves
some image differences, but its measured GPU cost removes the benefit of
half-resolution clouds. The main renderer keeps its existing half-cloud
reconstruction; `cloudEdges` is not an active option there. Compact remains the
default. This experiment does not qualify image quality or performance on phones.

## What was tested

The prototype detects disagreement among the four half-resolution cloud samples
and blends their reconstruction with a full-resolution cloud integral. It blends
both radiance and the endpoint used by atmosphere and city haze. Any positive
blend weight pays for the complete integral. The debug view marks those pixels
in red and displays their blend weight in green.

V1 used the transmission range of samples whose reconstruction weight exceeded
0.0001. It introduced dark dots at the Earth limb. Two problems were identified:
interpolating the negative “whole atmosphere” sentinel as a physical distance,
and discontinuous sample membership despite a smooth final blend. Its duplicated
full-integral call sites could also affect shader compilation; register pressure
was not measured.

V2 uses weighted transmission variance, converts the atmosphere sentinel to the
physical far endpoint before blending, and shares one full-integral call site.
The V1 dots were absent from the inspected V2 cloud and horizon frames. These
fixes improved the image metrics but did not make the pass inexpensive.

## Method

Apple M2 Max, headless Chromium 149, WebGL2, 1440×900, fixed resolution, manual
EV 0, no grain, `aurora=0`. Every variant settles assets, tiles and exposure before
capture. Compact, half clouds and refined half clouds use matching camera poses.
The cloud view uses `t=3235.65&pitch=-25`; horizon uses `pitch=5`, both at
`epoch=2026-10-06T01:32:27Z`.

V2 captures 32 deterministic frames at simulation increments of 10/24 seconds.
That spans about 12.9 simulation seconds, equivalent to 1.29 seconds of 10×
playback; it is not a long physical-device motion test. Spatial metrics compare
8-bit RGB channels to Compact. Temporal metrics compare changes between adjacent
frames to Compact's changes. The horizon view is mostly sky, so whole-frame
averages dilute differences near its narrow visible limb.

The diagnostic fraction comes from Float32 readback of the volume attachment,
before camera processing, at the initial pose. It is not estimated from the
finished screenshot. The saved JSON contains aggregate counts, not the raw binary
mask. Existing mask PNGs include camera processing, so they cannot establish
which individual pixels executed the full integral. Counting occupied 8×4
blocks from those PNGs would therefore not test the branching hypothesis. Even
a raw-mask occupancy count would be a spatial diagnostic, not a measurement of
GPU execution-group layout or proof of the measured timing cause. GPU measurements alternate AB/BA with two resident
renderers, discard eight warmup pairs and retain 32 whole-frame hardware-query
pairs. Headless background/frame throttling is disabled; these checks establish
rendering and GPU cost, not ordinary display cadence or power use.

## V2 results

| View / metric | Half clouds | Refined half clouds |
| --- | ---: | ---: |
| Clouds: mean spatial difference | 0.43717 | 0.36760 |
| Clouds: maximum spatial difference | 66 | 59 |
| Clouds: mean added temporal difference | 0.46881 | 0.42538 |
| Clouds: temporal channels differing by more than four levels | 1.2041% | 0.7979% |
| Horizon: mean spatial difference | 0.01481 | 0.00936 |
| Horizon: maximum spatial difference | 49 | 49 |
| Horizon: mean added temporal difference | 0.005045 | 0.004437 |

In the cloud view, 14.118% of pixels invoke the full integral; the mean blend
weight is only 2.847%. At the horizon these figures are 0.2182% and 0.1336%.
A small average blend does not imply a small execution cost.

| Cloud GPU comparison | Half clouds | Candidate | Median paired ratio |
| --- | ---: | ---: | ---: |
| Compact control | 24.011 ms | 39.000 ms | 1.599 |
| Refined half clouds | 23.848 ms | 40.891 ms | 1.666 |

Refinement increases GPU time by 66.6% in its paired comparison. Its cost is
comparable to the full-resolution Compact control measured separately. Ratios
are medians of individual pairs, not quotients of the marginal medians. Horizon
GPU sampling was omitted after this cloud result; tuning was stopped rather than
promoting the prototype based on improved image averages.

V1 was worse: 15.226% of cloud-view pixels invoked the full integral, GPU time
rose from 24.090 to 42.338 ms (paired ratio 1.773), and maximum spatial error
increased from 65 to 81 with visible limb artifacts.

Raw evidence, paired samples, client identifiers, image metrics and PNG hashes:
[V1](evidence/orbital-cloud-edges-v1-2026-10-10.json),
[V2](evidence/orbital-cloud-edges-v2-2026-10-10.json). Local V2 captures were saved
under `/tmp/orbit-cloud-edges-v2-20261010/`; PNGs themselves are not tracked.

## Reproduce the archived prototype

Use a separate worktree for `codex/cloud-edge-refinement-experiment`, install
with Bun, build, and serve that checkout. Then run:

```sh
EDGE_FRAMES=32 EDGE_GPU_VIEWS=clouds \
AGENT_BROWSER_ARGS=--disable-frame-rate-limit,--disable-gpu-vsync,--disable-background-timer-throttling,--disable-renderer-backgrounding \
bun scripts/verify-cloud-edges.mjs http://127.0.0.1:4351 /tmp/orbit-cloud-edges
```

The archived branch accepts `render=clouds-half&cloudEdges=1` and
`render=clouds-half&cloudEdges=mask`. The harness asserts that those modes are
active, so running it against the main renderer must fail instead of silently
measuring unchanged half clouds. A reproduction has a new bundle hash and must
record its own environment and measurements.
