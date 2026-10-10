# Orbital architecture candidates

## Current status

Compact is the default. The current runtime retains `reference`, `compact`,
`clouds-half`, `split` and `lighting`. The rejected `density`, `atmosphere`,
`combined`, `optimized`, `shadows`, `balanced` and `eco` profiles, their shader
branches and the atmosphere-table asset were removed. Old `render` URLs now
resolve to Compact. Common cloud, atmospheric integration and lighting helpers
remain; the `split` and `lighting` controls still support comparison.

The local tag `orbit-experiments-2026-10-10` pins commit `f205884`, before this
cleanup. Check out that tag in a separate worktree to reproduce the retired
profiles, their generators and the historical commands below. Raw measurements
remain in [evidence/](evidence/). Current acceptance is tracked in
[the performance plan](orbital-performance-targets.md).

## Cleanup validation — 2026-10-10

The retained profile selector, API choices, camera/pause/look/speed preservation,
context restoration, 390 px mobile layout, homepage link and retired-URL fallback
passed [the browser suite](evidence/orbital-profile-cleanup-2026-10-10.json).
Its headless motion sample recorded 23.989 fps and zero idle draws; this is
behavioral validation with background/frame throttling disabled, not physical
display acceptance.

[Matched WebGL2 cloud snapshots](evidence/orbital-cleanup-images-2026-10-10.json)
compare the pre-cleanup and cleaned Reference/Compact renderers at 1440×900,
fixed resolution, manual EV 0, grain 0 and aurora off. They are **not
byte-identical**: Reference differs in 103 RGB channels and Compact in 96 of
3,888,000, each by one 8-bit level. Poses, buffer sizes and assets matched; GL
errors were zero. No same-build reload control was measured, so these differences
are recorded without attributing them to a specific rounding mechanism.

The cleaned client `CsvWCxgp` is 301,765 bytes (106,473 gzip), compared with
306,818 (107,907 gzip) before cleanup: about 1.3% less gzip data. This is a modest
bundle reduction, not a demonstrated frame-time improvement. Removing the unused
512 KiB atmosphere table also removes that deployable asset; it was not part of
the default scene's network requests. The final client SHA-256 is
`f68d30f37509d39d60fbb80a37b2a236b973f5072905998efa0a9187fd14ef4b`.

## Historical experiment report

These experiments keep the original output resolution and 24 fps target. They
change the organization of calculations. The original renderer stays selected
without a `render` parameter; the comparison selector preserves camera and controls.

## Candidates and decisions

| Variant | Implementation | Image / resource trade-off | Decision |
| --- | --- | --- | --- |
| `compact` | Separate ground/sky from clouds/atmosphere, with an RGBA16F buffer carrying radiance and a small terrain-distance residual rather than full orbital distance. | Extra 9.9 MiB at 1440×900. Half the buffer bandwidth; small radiance/depth rounding. No resolution reduction or frame history. | Preferred split-pass candidate. |
| `split` | Separate ground/sky from clouds/atmosphere into two independently compiled programs. Carry linear radiance and ray distance in a full-resolution RGBA32F buffer. | No sampling reduction or temporal history. Extra 19.8 MiB at 1440×900, plus buffer bandwidth. Falls back to inline rendering without float targets or enough texture units. | Finalist: broad GPU improvement in the measured views. |
| `lighting` | Compute a shadow integral once for four neighboring density samples and interpolate from the previous endpoint. Keep all 16–96 density samples and four samples inside each shadow integral. | Approximates variation of illumination within a few kilometres; cloud density, filtering and contours retain their original sampling. No frame history. | Finalist for sunlit clouds; check motion and fine shadow detail. |
| `density` | Share rotation, normalization and geographic coordinates between coverage samples; skip neighborhood coverage when convection is exactly zero. | Mathematically equivalent apart from floating-point rounding. | Do not promote: worse daytime cost and no consistent overall gain. |
| `atmosphere` | Replace repeated solar-path integration with a precomputed height/zenith lookup, retaining both original quadratures in separate channels. | A 512 KiB table, log-encoded 16-bit columns with bilinear interpolation. Maximum measured transmission error 0.22%. Falls back to quadrature while loading, after failure, with limited capabilities or save-data. | Do not promote alone: numerical accuracy is good, measured GPU benefit is insufficient. |
| `combined` | Combine density factoring, atmospheric lookup and shared cloud lighting. | Combines their resource costs and lighting approximation. | Do not promote: individual improvements do not add up; compare finalists independently. |

The first shared-lighting prototype duplicated the large shadow helper inside the
view loop. It was slower despite fewer logical integrations. A second version
uses one integration call site and reuses its endpoint. This result, and the gain
from splitting programs, suggest that shader compilation/register pressure matters
here; register occupancy was not directly measured.

The shared-lighting cache is local to a fragment invocation. It cannot leave
reprojection trails after camera changes or retain lighting from a previous frame.
It can still change small spatial/temporal shadow details, which are measured below.

## Method

Apple M2 Max, Chromium / ANGLE Metal, 1440×900, DPR 1. Camera, calendar, grain seed
and image controls are fixed. All assets, tiles and exposure settle before sampling;
adaptive resolution is disabled. Hardware GPU queries span the entire frame,
including the extra pass in `split`. Each entry is the median of 36 samples after
six warmups. A fresh browser session is used per case/profile, with explicit viewport checks.
Reference is measured both before and after the candidates in each
view to expose clock/scheduling drift. These are GPU timings, not watt measurements.

Pixel comparisons exclude the comparison panel. Timing alone does not qualify a
candidate: cloud density, source optics, fallback paths, context restoration and
motion also need to pass. The default remains Original so selection is reviewable.

Standalone night controls drifted substantially, so final ranking uses a second
measurement: two settled renderers in one page, AB/BA frame order alternating on
each pair, eight warmup pairs discarded, then 32 measured pairs. Only one renderer
submits a frame at a time. Report the median of pairwise candidate/reference ratios;
it need not equal the ratio of the two separately reported medians. Both renderers
retain their own resources, so these paired numbers describe that benchmark setup.

The compact buffer stores the terrain correction to the analytic sphere hit.
A numerical sweep of 12,524 rays over 0–9 km terrain and camera radii 1.07–9 Earth
radii bounded half-float quantization to 68.3 m; storing the full distance directly
reached 24.9 km error in the same sweep. This is a sampled precision check, not a
bound for every possible ray. Image and high-orbit checks validate the actual pass.

## Paired GPU results

Values are reference → candidate milliseconds; parentheses show the median
paired reduction in GPU time, not an increase in FPS.

| View | Compact pass | Float32 pass | Shared lighting |
| --- | ---: | ---: | ---: |
| Day | 22.48 → 17.84 (+17.6%) | 22.01 → 18.01 (+23.3%) | 19.09 → 15.12 (+15.0%) |
| Night | 10.27 → 8.48 (+18.6%) | 10.22 → 8.42 (+15.6%) | 9.93 → 10.65 (-3.6%) |
| Clouds | 36.44 → 30.91 (+14.3%) | 36.03 → 30.79 (+13.8%) | 36.87 → 32.41 (+14.4%) |

Compact is the first choice for further review: a 14–19% reduction across all
three measured views with half the intermediate memory of Float32. The Float32
variant reduced time by 14–23% and remains useful when minimizing rounding is
more important than buffer memory. Shared lighting reduced time by about 14–15%
in sunlit views; its night result does not show an improvement.

The standalone run also found the finalists faster in the day/cloud scenes, but
its night references varied from 11.59 to 30.95 ms. Those standalone night numbers
are not used for ranking. [Raw pairs, quartiles, frame comparisons and standalone
controls](evidence/orbital-architecture-results.json) preserve the evidence and variation.

## Image checks

Full-resolution still comparisons cover day, night and dense clouds. Float32
differs by at most one 8-bit channel level and shared lighting by at most two.
Compact differs by at most one level in day/cloud views; the night image has one
channel above two levels (maximum six). An additional moonlit view has two such
channels (maximum nine); the 20,000 km orbit view has none and a maximum of two.
These are measured differences, not a claim of exact equivalence.

The deterministic motion check captures eight consecutive simulated frame times
at the default 10× playback speed, with settled exposure and no sensor grain.
It compares both frames and changes between frames to catch extra shimmer.
This is a short controlled sequence; visual selection on dev remains useful.

| Motion metric, channel levels out of 255 | Compact | Float32 | Shared lighting |
| --- | ---: | ---: | ---: |
| Mean spatial difference | 0.00583 | 0.000216 | 0.00658 |
| Largest spatial difference | 4 | 4 | 2 |
| Mean added interframe difference | 0.01139 | 0.000433 | 0.01271 |

No channel had an added interframe difference above four levels. The test also
asserts eight distinct camera poses, identical poses across profiles, nonblank
captures and no WebGL errors.

`bun run verify` passed all 76 tests, Astro checking (zero errors, warnings or
hints) and the static build. The compact renderer passed the complete scene
browser suite, including source optics, missing assets, context restoration,
rotation, capability fallback, save-data, drag, flight, touch and calendar state.
Motion ran at 23.83 fps against the unchanged 24 fps target in that behavior check.
All ten alternative profiles passed switching checks with camera, pause, image
settings and speed preserved. Additional checks passed for atmosphere-table and
low-power context restoration, a 390 px comparison panel, the homepage link,
default profile, zero idle draws and the failed-table integration fallback.

## Safari and physical Android validation

The same deployed build (`b302b809-426f-49e7-b904-61107c4b0760`, client `D4oo02ZN`)
was served locally to Safari 27.0.1 on the Mac and Chrome 154 on a physical
Pixel 9 Pro XL (Mali-G715). Android used ADB over Wi-Fi and a reverse tunnel;
there was no mobile emulation. The source still matched the built snapshot.

Each scene ran Original → Compact → Compact → Original. Resolution stayed fixed:
1805×997 in Safari and 593×1196 on Pixel, with the same 24 fps target. Each cadence
sample covered ten seconds of normal playback without synchronization hooks.

| Browser / scene | Original fps | Compact fps |
| --- | ---: | ---: |
| Safari / day | 23.9 | 23.8–23.9 |
| Safari / night | 23.9 | 23.9 |
| Safari / clouds | 19.0–19.1 | 21.8–23.3 |
| Pixel / day | 22.9–23.0 | 23.8–23.9 |
| Pixel / night | 23.9 | 23.9 |
| Pixel / clouds | 11.1–11.2 | 12.3 |

Neither browser exposed hardware GPU timers. A separate 32-pair AB/BA test used
synchronous one-pixel readback to wait for completion. This includes CPU submission
and readback cost, so it is not the GPU-only metric from the original Chromium
benchmark. Safari's initial `gl.finish()` timings did not force synchronization;
those values are retained only as ignored submission diagnostics in the raw data.

| Browser / scene | Original → Compact completion, ms | Median paired time reduction |
| --- | ---: | ---: |
| Safari / day | 27 → 23 | 11.5% |
| Safari / night | 16 → 14 | 17.6% |
| Safari / clouds | 61 → 49 | 14.8% |
| Pixel / day | 49.9 → 47.5 | 5.0% |
| Pixel / night | 30.8 → 29.5 | -2.0%; no consistent gain |
| Pixel / clouds | 94.8 → 84.4 | 10.1% |

The paired median is computed from individual ratios, not from the two marginal
medians. Pixel's cloud candidate was faster in all 32 pairs; its night candidate
was faster in only 14. Both renderers retain resources during this measurement.

Compact's still-frame difference was at most one 8-bit channel level on Pixel.
Safari's maximum was two in day/cloud views and three in one night channel.
All 24 standalone runs had zero WebGL errors, zero failed assets and zero idle
draws after settling on pause. Camera control and context loss/restoration passed
in both browsers; Android also passed a Chrome-injected touch drag on the device.

The Pixel uses the existing fallback without `EXT_shader_texture_lod`, including
disabled aurora, in both profiles. This test does not establish iPhone behavior
or performance on lower-end Android GPUs. The phone was charging; these are not
battery-drain measurements.

Production-style adaptive resolution was then tested separately for 30 seconds
in the cloud view, one renderer at a time, with no timing/readback hooks:

| Browser | Original steady buffer / fps | Compact steady buffer / fps |
| --- | --- | --- |
| Safari | 80%, 1444×798, about 24 fps | 90%, 1624×898, about 24 fps |
| Pixel | 53%, 316×638, about 24 fps | 53%, 316×638, about 24 fps |

Safari retained about 27% more rendered pixels with Compact. On Pixel the
governor chose the same conservative scale for both variants. The lower buffer
resolution is a substantial image-quality compromise, not free performance;
Compact alone does not solve the cost of full-resolution mobile cloud rendering.
The recommendation remains Compact with adaptive resolution and capability
fallback. The next architectural target on Android is cloud rendering cost.

Safari's REST WebDriver could not start an automation session in the running
browser. Its [built-in MCP interface](https://webkit.org/blog/18136/introducing-the-safari-mcp-server-for-web-developers/)
worked and isolated the test tabs. On Android, use an actual Chrome tab opened
through an intent: `Target.createTarget` produced a WebContents without a visible
native tab, where `visibilityState` said visible but RAF did not run.

## Reproduce

```sh
bun run verify
bun run benchmark:scene http://127.0.0.1:4347 /tmp/orbit-candidates day,night,clouds reference,density,atmosphere,lighting,combined,split,compact,reference
bun run benchmark:pairs http://127.0.0.1:4347 /tmp/orbit-pairs
bun scripts/verify-candidate-motion.mjs http://127.0.0.1:4347 /tmp/orbit-motion
SCENE_PROFILE=compact bun run verify:scene http://127.0.0.1:4347 /tmp/orbit-compact-proof
bun run verify:profiles http://127.0.0.1:4347 /tmp/orbit-profile-proof
bun scripts/verify-scene-device.mjs safari-mcp http://127.0.0.1:4347 /tmp/orbit-safari
bun scripts/verify-scene-device.mjs android http://127.0.0.1:4347 /tmp/orbit-android
bun scripts/benchmark-device-pairs.mjs android http://127.0.0.1:4347 /tmp/orbit-android-pairs
bun scripts/verify-device-adaptive.mjs android http://127.0.0.1:4347 /tmp/orbit-android-adaptive
```

For Android, keep the device unlocked, authorize ADB, reverse device TCP 4347 to
host TCP 4347 and forward host TCP 9223 to `localabstract:chrome_devtools_remote`.
Restore any temporary keep-awake setting and remove those forwards afterward.

`bun run prepare:atmosphere` regenerates the committed table. Its test checks the
artifact against the generator and evaluates 26,466 transmission values, including
low altitude and grazing rays. A failed download retains the original integration.

## Review on dev

Published dev version `b302b809-426f-49e7-b904-61107c4b0760` serves client
`OrbitalSky.astro_astro_type_script_index_0_lang.D4oo02ZN.js`. Authenticated Chrome
confirmed the compact pass at scale 1.00, zero failed assets and zero WebGL errors.
Switching to shared lighting preserved camera position and orientation. The page
and client asset both redirect anonymous requests to the deployment access gate;
workers.dev and preview URLs remain disabled.

These links fix resolution for comparison. Ordinary scene URLs retain the existing
adaptive resolution behavior. Results above describe one GPU/browser combination;
they do not establish battery or power savings on other devices.

- [Compact volume pass](http://localhost:4321/?compare=1&quality=fixed&render=compact)
- [Separate volume pass](http://localhost:4321/?compare=1&quality=fixed&render=split)
- [Shared cloud lighting](http://localhost:4321/?compare=1&quality=fixed&render=lighting)
- [Atmosphere lookup](http://localhost:4321/?compare=1&quality=fixed&render=atmosphere)
- [Factored cloud density](http://localhost:4321/?compare=1&quality=fixed&render=density)
- [Combined architecture](http://localhost:4321/?compare=1&quality=fixed&render=combined)

Pause before switching if comparing a particular cloud or star. For reproducible
sunlit clouds add `motion=0&t=3235.65&pitch=-25&epoch=2026-10-06T01:32:27Z`.


## Texture audit and archived comparisons (2026-10-10)

At the time of this audit, the comparison menu offered `reference`, `compact`,
`clouds-half`, and the `split`/`lighting` controls. Other profiles were reachable
by their original `render` URLs; their shader branches were still bundled and
`reference` was the default. This historical state is available at the archive
tag above; it does not describe the current runtime.

The current day and galaxy overviews decode to 4096×2048 textures, uploaded as
RGBA8 with mipmaps. Each requires approximately 42.67 MiB of nominal texel
storage. The existing mobile day overview already reduces this to 10.67 MiB.
Night/cloud overviews use scalar storage, and DEM textures hold packed numbers.
These are different compression problems and were excluded from this experiment.
The streamed day/galaxy atlases also carry exact page-table bytes and manually
packed mip subrectangles. Compressing those complete atlases would need a layout
change; their metadata cannot pass through a lossy image codec.

`texture=compact` is an independent, opt-in experiment that reduces only the
global galaxy overview to 2048×1024. It preserves the catalog stars, streamed
16K galaxy tiles, day textures and cloud integration. The diffuse irradiance
lookup adjusts its mip level to retain the original 64-texel-wide angular
footprint: level 6 for 4096 pixels, level 5 for 2048. Save-Data continues to use
previews without requesting either refinement.

| Measure | Existing 4K overview | Experimental 2K overview |
| --- | ---: | ---: |
| Encoded AVIF bytes | 569,480 | 307,627 |
| Nominal RGBA8 storage including mips | 42.67 MiB | 10.67 MiB |

The new asset is derived from the existing graded map using Lanczos3 and AVIF
quality 80, 4:4:4, effort 4. Regenerate it with
`bun scripts/prepare-galaxy-overview.mjs`; this adds no runtime dependency.

Offline comparisons are a quality screen, not an in-scene acceptance result.
At 4096×2048, the resampled candidate differs by 4.22 byte levels on average
(maximum 144); the summed absolute difference after the shader's power-3.3
radiance conversion is 19.13% of the original radiance sum. Fine detail is lost.
After both inputs are filtered to the 64×32 irradiance footprint, the maximum
channel difference is one byte level, mean 0.129, and radiance difference 0.45%.
The star catalog is independent, but the visible diffuse sky and tile fade
still need actual browser comparisons. The 32 MiB saving is a format/storage
calculation, not a measured process-memory or frame-time improvement.

KTX2 was not added. It remains a possible follow-up for the color overviews if
memory/upload measurements justify an encoder, a transcoder and fallback assets.
Runtime transcoding is part of that cost, and an AVIF-to-KTX2 change is not a
promise of a smaller download. See the
[Khronos developer guide](https://github.com/KhronosGroup/3D-Formats-Guidelines/blob/main/KTXDeveloperGuide.md).
No new atmospheric LUT was added either: the existing 512 KiB table is already
numerically accurate, while the saved GPU measurements do not support promoting
that profile. Expanding the table approach needs a measured expensive atmospheric
path first.
