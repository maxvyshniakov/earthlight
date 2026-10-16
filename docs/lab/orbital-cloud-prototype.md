# Half-resolution cloud experiment

`render=clouds-half` is an opt-in experiment built on `compact`. The default
is `compact`. Add `compare=1` to expose the existing comparison control.
This experiment does not establish the phone performance target in
[performance targets](orbital-performance-targets.md).

## Edge refinement decision

[Full-resolution edge refinement was tested and archived](orbital-cloud-edges-2026-10-10.md).
The corrected prototype improved cloud image metrics but added 66.6% GPU time
in the paired cloud view, losing the half-resolution speed benefit. The current
half-cloud reconstruction remains unchanged; `cloudEdges` is available only on
the experiment branch documented in that report.

## Rendering and fallback

The world pass keeps surface detail and stars at the output resolution. A
separate cloud pass integrates at `ceil(width / 2) × ceil(height / 2)`. An
RGBA16F attachment contains scattered RGB and transmittance. Cloud and compact
ground-depth residuals occupy RG16F on WebGL2, or RGBA16F on WebGL1. Atmosphere, city haze and camera
composition still run at full output resolution. There is no frame history.

The cloud ray uses the matching full-resolution world texel centre. Reconstruction
weights follow that sampled lattice, including odd target sizes. Ground/sky
rejection and terrain-depth weights prevent interpolation across incompatible
surface samples. When no compatible sample survives, the pixel evaluates the
original cloud integral. This fallback limits artifacts but reduces the possible
speedup near discontinuities.

The extra attachments cost about 3.71 MiB on WebGL2 or 4.94 MiB on WebGL1 at 1440×900, in addition to Compact's
world buffer and the existing camera targets. The experiment also compiles a
full-resolution volume fallback, increasing startup work. It is not a startup
optimization.

Selecting `render=clouds-half` now requests WebGL2 automatically, unless
`api=webgl` explicitly selects WebGL1. Failed WebGL2 context creation still falls
back to WebGL1. Ordinary Compact uses WebGL1 unless `api=webgl2` is explicit.

The WebGL1 path requires `WEBGL_draw_buffers`, two color attachments and renderable
half-float targets. Missing support, a failed probe, failed experimental shader
compilation or a later target-allocation failure retains Compact. Without Compact
capabilities, it retains inline rendering. The profile reports its actual path as
`data-cloud-pass`; timing checks reject a fallback masquerading as the experiment.

During integration, `WorldBuffer.begin` was corrected to preserve texture unit 14
while allocating its target. Galaxy tiles use that unit during the world pass;
replacing their binding with the render target caused framebuffer feedback.

## Reconstruction decision

The first prototype weighted each cloud sample against the nearest low-resolution
sample's opacity and depth. That guide changed abruptly at sample boundaries and
produced visible steps in sunlit clouds. Its dense-cloud sequence had mean spatial
error 0.648 and mean added interframe difference 0.603 on the 0–255 channel scale,
relative to Compact. These diagnostics do not measure perceptual quality by
themselves; the visible steps were the reason to revise the reconstruction.

The next variant uses continuous interpolation with ground/sky and terrain-depth
rejection. It deliberately trades some cloud sharpness for smoother transitions.
It cannot recover thin detail absent from the half-resolution samples. Surface
and star rendering retain their original resolution.

The continuous variant passed the five-view image and lifecycle run on the
development Mac. [Recorded image metrics and failure-path checks](evidence/orbital-cloud-images-2026-10-10.json)
use a 1440×900 buffer, fixed exposure and no sensor grain:

| View | Mean absolute channel difference from Compact | Maximum |
| --- | ---: | ---: |
| Day | 0.141 | 53 |
| Night | 0.00013 | 1 |
| Dense clouds, eight frames | 0.446 | 65 |
| Horizon | 0.014 | 37 |
| Dawn terminator | 0.125 | 35 |

For the cloud sequence, mean added interframe difference was 0.476; 1.27% of
channel samples differed by more than four levels. Whole-image averages include
unchanged sky and surface pixels, so they understate localized cloud differences.
Visual comparison still shows softer small cloud features and steps on thin
sunlit edges near the horizon. The experiment is not visually equivalent to
Compact and stays opt-in.

The PNG pairs remain in `/tmp/orbit-half-clouds-20261010-smooth/` on the test
machine; rerun the script below to regenerate them. Resize to 801×601, context
loss/restoration, missing MRT support, failed probe, failed actual-size allocation
and experimental shader compilation failure all passed without WebGL errors.

## Measured cost and decision

[Raw paired GPU timings](evidence/orbital-cloud-timings-2026-10-10.json) compare Compact
with the continuous reconstruction on the same M2 Max / ANGLE Metal snapshot as
the [cost baseline](orbital-performance-targets.md#local-baseline-on-2026-10-10).
The output buffer is 1440×900 and the cloud attachments are 720×450. Each view
contains 32 measured pairs after eight warmup pairs, with alternating order.

| View | Compact median | Half-cloud median | Median paired time ratio | Paired speedup |
| --- | ---: | ---: | ---: | ---: |
| Day | 21.23 ms | 16.11 ms | 0.788 | 1.27× |
| Night | 14.36 ms | 12.29 ms | 0.884 | 1.13× |
| Dense clouds | 37.32 ms | 24.74 ms | 0.664 | 1.51× |

Speedup is the inverse of the median per-pair ratio, not the ratio of the two
marginal medians. The cloud ratio's middle 50% was 0.632–0.689. All three views
used the actual half-cloud path, matched camera/buffer state and exactly 40 final
draws per renderer; no assets failed and GPU queries had no disjoint or GL error.

The measured cloud saving is about 34%, below the roughly 50% reduction that
would double throughput. Together with the remaining cloud-edge differences,
this supports keeping the prototype available for comparison, not promoting it
to the default. At that checkpoint `reference` was the default; Compact is now
the main renderer and remains the experiment's baseline. The run does not establish 24 fps at 75% scale on Pixel or iPhone.

## Reproduction

Build first and serve the built snapshot. Do not run GPU measurements concurrently.

```sh
bun run verify
bun run preview --port 4347 --host 127.0.0.1
bun scripts/verify-scene-url.mjs http://127.0.0.1:4347
bun scripts/verify-half-clouds.mjs http://127.0.0.1:4347 /tmp/orbit-half-clouds
bun scripts/benchmark-candidate-pairs.mjs http://127.0.0.1:4347 /tmp/orbit-half-pairs clouds-half day,night,clouds compact
bun scripts/benchmark-scene-costs.mjs http://127.0.0.1:4347 /tmp/orbit-costs
```

The half-cloud check fixes manual exposure and grain, captures five views and an
eight-frame moving-cloud sequence, and checks resize, context restoration and
four injected failure paths. PNGs and numerical differences are review artifacts;
passing lifecycle checks does not accept image quality.

Paired timing primes an unchanged seek and waits for exposure and every tile queue
to settle. A look-slider event must not trigger the measured frame: it restarts
exposure settling and causes unrequested background draws. Both retained renderers
must submit exactly 40 final frames (eight warmups and 32 measured pairs).

On the development Mac, headless Chromium 148 and 149 sometimes loaded the scene
without delivering native animation callbacks. The following local launch override
restored callbacks without changing application scheduling:

```sh
export AGENT_BROWSER_ARGS=--disable-frame-rate-limit,--disable-gpu-vsync,--disable-background-timer-throttling,--disable-renderer-backgrounding
```

Results with those flags are image/GPU diagnostics. They do not establish normal
display cadence, phone behavior, thermal stability or battery use. The initial
grain-trigger timings were rejected, and runs without animation callbacks were
not interpreted as scene performance.

## Initial prototype validation (before startup/API work)

- `bun run verify`: 92 tests passed; Astro reported no errors, warnings or hints;
  build passed. The measured client bundle retained SHA-256
  `8aa94cfc3494b3b71e0ed1ca617874a9fa6e108f26332d7d79016c9bbffa4aea`,
  matching the measured snapshot.
- `verify-scene-url.mjs`: fresh page-mode and standalone URLs keep their live calendar;
  exposure edits, explicit replay links and calendar edits survive reload.
- `verify-half-clouds.mjs`: five views, eight cloud-motion frames, resize,
  context restoration and all four injected fallback cases passed.
- Paired timing: all three views completed with the requested frame counts.
- At this prototype checkpoint, `verify-scene-browser.mjs` was **not green**. Two outdated fixture
  imports were repaired (Node's galaxy import and the catalog's point-brightness
  dependency). A subsequent stable-build run passed lighting, night scattering,
  aurora, terrain, lens and catalog checks, then stopped at
  `faint native networks must survive` in the city-radiance fixture. Its city
  curve and threshold both match the pre-task source snapshot. Neither was
  changed to obtain a pass. Later checks in that suite remain unverified.

The numerical image checks have no perceptual acceptance threshold. Physical
Pixel, iPhone, MacBook Air and Windows acceptance remains open. Subsequent startup/API work and the final release checks are tracked in
[the release validation report](orbital-release-validation-2026-10-10.md).
