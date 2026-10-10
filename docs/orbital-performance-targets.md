# Orbital performance targets

The latest [scene-transition checks and explicit aurora policy](orbital-quality-transitions-2026-10-10.md)
extend the initial acquisition correction below. The latest physical results are
in the [Pixel transition report](orbital-pixel-transitions-2026-10-10.md).
Compact remains the default.

This is the working acceptance plan for the cloud-resolution experiment. The
24 fps and resolution targets below are provisional engineering targets from
the review. Startup, transfer and tail-latency limits still need a baseline and
a decision; an empty limit does not mean a pass.

## Devices and target behavior

| Class | Device evidence available | Working target | Missing acceptance |
| --- | --- | --- | --- |
| Android | Physical Pixel 9 Pro XL, Mali-G715, Chrome 154; controlled API comparison and final-controller/autoplay checks on 2026-10-10 | 24 fps target; settled buffer scale at least 0.75 in day, night and dense clouds | Three-repeat sustained acceptance across all scenes; 75% floor and frame tails remain open |
| iPhone | No measured model or browser version | Same phone target | Choose one concrete model and iOS/Safari version, then measure |
| Mac | Local Mac14,5, Apple M2 Max, 30 GPU cores, 32 GB RAM; historical Chromium/ANGLE Metal and Safari 27.0.1 measurements | MacBook Air: at least 0.90 scale with a 1.8 MP base buffer, at the existing 24 fps target | Select Air generation/RAM; M2 Max is diagnostic evidence only |
| Windows | No measured GPU or driver | Integrated GPU: same desktop target | Select machine, GPU, driver and browser versions |

Scale means the settled `data-render-scale` relative to the existing base buffer,
after its DPR and pixel-count caps. Record CSS viewport, DPR, base buffer and
actual buffer dimensions too. A 0.75 scale retains 56.25% of base pixels. A 0.90
scale at a 1.8 MP base retains approximately 1.458 MP. A phone CSS viewport does
not identify its physical pixel workload by itself.

Raising scale from 0.53 to 0.75 roughly doubles pixels (`(0.75 / 0.53)^2 = 2.00`).
Treat that as the size of the desired improvement, not proof that halving cloud
resolution can achieve it.

## What the existing measurements establish

[Architecture candidates](orbital-architecture-candidates.md) contains the
method and [raw results](evidence/orbital-architecture-results.json) for the earlier
snapshot. Those measurements are not acceptance of the current source tree.

| Physical Pixel cloud test | Reference | Compact | Meaning |
| --- | ---: | ---: | --- |
| Fixed 593×1196 buffer, normal playback | 11.1–11.2 fps | 12.3 fps | Actual cadence at fixed resolution |
| Adaptive, 30 seconds | About 24 fps at 316×638, 53% | About 24 fps at 316×638, 53% | Resolution falls to meet cadence |
| Paired synchronous completion | 94.8 ms | 84.4 ms | CPU submission + GPU + one-pixel readback; two retained renderers |

The last row is not normal frame duration or GPU-only time. Its median paired
reduction is 10.1%; the ratio of the two marginal medians is a different statistic.
Safari's adaptive cloud test retained 90% scale with Compact versus 80% with
Reference. iPhone, MacBook Air and Windows acceptance remain open.

## Repeatable scenes and timing

Use epoch `2026-10-06T01:32:27Z`, ISS route, grain zero and the same image settings.
Compare identical camera poses before comparing images or timings.

| Scene | `t` | `pitch` | Purpose |
| --- | ---: | ---: | --- |
| Day | 3235.65 | 0 | Surface clarity and sunlit clouds |
| Night | 610.87 | 0 | City lights, cloud glow and dark gradients |
| Clouds | 3235.65 | -25 | Main performance target and dense cloud detail |
| Horizon | 3235.65 | 5 | Thin cloud edges and atmosphere composition |
| Moonlit | 1338.89 | 0 | Weak illumination and cloud transmission |
| High orbit | 3235.65 | 0, `route=high` | Depth precision and small cloud features |

Keep GPU cost, delivered cadence and startup measurements separate:

- GPU diagnostics use fixed output resolution and
  `EXT_disjoint_timer_query`, excluding disjoint samples. Include every pass.
  Run one benchmark job at a time. For paired tests report retained renderer
  count, warmups, sample count and the median of per-pair ratios.
- Adaptive playback uses one renderer and no GPU timing, `finish()` or readback
  hooks. Warm for 30 seconds, then record 60 seconds. Repeat three times per
  scene in alternating profile order. Report every 5-second window's FPS and
  scale, plus minimum settled scale; preserve the raw samples.
- Count final canvas draws and their intervals, not all RAF callbacks. Report
  median, p95, p99, maximum and the number of intervals over 100 ms. The 24 fps
  target has a 41.7 ms average interval; display scheduling can produce uneven
  intervals even when that target is met. Exact cadence tolerance and p95/p99
  limits remain undecided.
- Run stationary settled playback separately from camera motion, seeking,
  tile arrival and context restoration. Report long pauses during those actions
  separately; do not discard them as warmup or merge them into a steady-state
  average.

Record power source, battery/low-power mode, thermal state if observable, display
refresh rate and foreground visibility. The earlier charging-phone result does
not establish battery use or sustained thermal behavior.

## Cloud experiment acceptance

Start from `compact`, preserve `reference`, and leave atmosphere evaluation at
full output resolution. The low-resolution cloud result needs scattered RGB,
transmission and weighted cloud distance. WebGL1 support depends on the actual
chosen target formats/extensions; keep the established fallback when unavailable.

Terrain distance and weighted cloud distance describe different geometry.
Upsampling must handle cloud edges, sky/ground transitions and transparent wisps
without using surface depth as a substitute for cloud depth. Review these cases
at native display size and with enlarged crops:

- Thin cloud silhouettes over the horizon and against dark space.
- Terrain visible through wisps; no halos or leaking ground/sky color.
- Day/night terminator, moonlight and city haze under clouds.
- Camera drag, playback at the normal 10× speed, seeking and tile replacement;
  no new shimmer, popping or persistent trails.
- Sharp surface detail and stars while cloud resolution changes.

Reuse deterministic motion captures and image-difference metrics as diagnostics.
An average image error alone cannot accept a cloud edge artifact. Record the
reviewed sequences and still crops alongside raw timing. Do not promote the
prototype solely because one screenshot or the cloud-heavy GPU timing improves.

If visible-cloud integration takes fraction `f` of the original frame, the ideal
half-width/half-height cost is `1 - 0.75f` of the original, before reconstruction
and extra buffers. A 2× speedup requires `f >= 2/3`. Shader ablation changes
compiler work and the atmosphere path, so use it as an optimistic diagnostic;
the completed prototype must supply the real cost and visual result.

## Homepage scroll baseline

Measure the homepage at 0, 0.375, 0.75 and 1 viewport heights, then in reverse
order. The current composition finishes raising the camera after 0.75 small
viewport heights. Record actual scroll offsets: a short page may clamp them.
Use fixed resolution, a paused deterministic scene and the same viewport for
GPU comparison. Separately measure ordinary playback at those positions.

The background continues behind transparent content. Decide whether to change
that behavior only after measuring its cost at the final camera position and
reviewing the page composition.

`scripts/benchmark-orbit-costs.mjs` performs whole-frame GPU cloud ablation and
the scroll-position diagnostic in an isolated agent-browser session:

```sh
rtk node scripts/benchmark-orbit-costs.mjs http://127.0.0.1:4347 /tmp/orbit-costs
```

The optional third argument is `clouds` or `scroll` to measure only that part.

Serve a stable built snapshot while it runs. Cloud ablation uses two retained
renderers with alternating AB/BA frame order, eight warmup pairs and 32 measured
pairs. Only the test page's shader source is changed: `cloudVolume` returns its
background and ground distance. Surface shadows and source attenuation remain.
This also changes atmosphere/haze distance and compiler optimization, so the
result is not a pure isolated timing of the original cloud function. Scroll
timings use one renderer, six warmups and 36 measured samples per position.
Use an unchanged seek to request measured frames after priming slider precision
and waiting for exposure to settle. The paired test requires zero draws during
1.2 seconds of idle time and exactly 40 final-canvas draws per renderer during
sampling. A grain input restarts exposure adaptation and can make both retained
renderers draw continuously; reject timings from that trigger.

On the local 2026-10-10 headless runs, Chrome 148 and 149 could expose a visible
document yet stop delivering native RAF callbacks. A fresh browser with these
launch flags resumed RAF:

```text
--disable-frame-rate-limit,--disable-gpu-vsync,--disable-background-timer-throttling,--disable-renderer-backgrounding
```

Pass them with `AGENT_BROWSER_ARGS` when reproducing image or GPU diagnostics
affected by that problem. Record the override with the result. Disabling frame
limits and vsync changes scheduling, so those runs cannot establish normal
display cadence, p95/p99 delivery, or the phone's 24 fps acceptance. Keep them
separate from unmodified foreground browser/device runs.

## Local baseline on 2026-10-10

[Raw GPU samples, frame counters, browser metadata and built-client hashes](evidence/orbital-cost-baseline-2026-10-10.json)
record the successful run on the M2 Max at 1440×900, scale 1.00, Chrome 149 /
ANGLE Metal. The client was `D1o694kz`; the artifact includes its SHA-256. The
unthrottled launch flags above were active. These are local GPU diagnostics,
not normal-display cadence or target-phone acceptance.

| Dense-cloud ablation | Full frame median | Without visible cloud integration | Median paired remaining cost | Remaining cost p25–p75 |
| --- | ---: | ---: | ---: | ---: |
| Reference | 46.85 ms | 16.42 ms | 35.4% | 33.0–36.9% |
| Compact | 35.44 ms | 15.24 ms | 44.1% | 40.4–45.9% |

Both pairs passed the zero-idle-draw check and exactly 40 draws per renderer.
Asset failure counts and WebGL errors were zero. Removing visible clouds saved
about 56% of Compact's paired diagnostic cost. Applying the ideal quarter-pixel
model to that fraction gives roughly 1.72× before reconstruction and extra
buffers, below 2×. This is only an estimate: the ablation changes the compiled
shader and atmosphere/haze path, and the measured GPU is not the Pixel's GPU.
Measure the actual low-resolution implementation before accepting or rejecting it.

The homepage run used the fixed day view and the same 1440×900 buffer. Each cell
below gives the two medians from forward and reverse scroll order, as a range.

| Actual scroll offset | Reference GPU time | Compact GPU time |
| --- | ---: | ---: |
| 0 px, hero | 37.08–38.25 ms | 23.38–24.05 ms |
| 338 px | 5.29–5.34 ms | 5.07–5.49 ms |
| 675 px, composition reaches final altitude | 3.94–3.95 ms | 3.54–3.96 ms |
| 900 px | 3.38–3.90 ms | 2.54–3.89 ms |

All 16 scroll measurements passed zero idle draws, exactly 42 requested draws,
zero failed assets and zero WebGL errors. Cost falls sharply as Earth leaves the
frame. Keep the background behind page content; these measurements give no
reason to remove it to solve the dense-cloud bottleneck. They do not measure
power draw or scroll-time frame delivery.

An earlier grain-trigger run was rejected because it restarted metering in both
retained renderers. Its numbers are excluded from the saved artifact and
these conclusions.

## Cold startup and transfer

For each target device measure an empty HTTP cache and a warm-cache reload
separately. Fix viewport, route, scene, network and CPU throttling settings.
Store downlink, uplink, RTT, cache policy and tool version; the label "4G" alone
is insufficient. Network profile and numeric budgets are still open.

| Milestone | Definition | Limit |
| --- | --- | --- |
| Poster visible | First paint containing the scene placeholder | Undecided |
| First live frame | First nonblank scene frame presented on canvas | Undecided |
| Controls usable | First successful input reflected in the scene | Undecided |
| Settled quality | Assets and exposure settled, focus sharp, tile queues empty | Undecided |
| Transfer before usable controls | Encoded bytes transferred up to the controls milestone | Undecided |
| Transfer through settled quality | Encoded bytes transferred through the settlement milestone | Undecided |

Use a trace or filmstrip to verify visible milestones. Dataset state is a useful
marker, but does not prove when a frame reached the display. Record blocking
tasks, shader compilation and texture decode/upload separately when diagnosing
startup. Parallel shader compilation is a responsiveness experiment; it does not
establish a frame-rate gain or a shorter total compile time.

The [shader startup implementation](orbital-shader-startup.md) now batches the
renderer, catalog, camera finish, exposure, defocus and aurora programs. With KHR,
program-dependent setup follows completion polling, with cancellation/generation
handling across context loss or disposal. The extension-absent path remains
synchronous. This change is independent of half-resolution clouds and WebGL2.
Counting static status-check call sites does not count the checks executed for a
particular profile and capability set. Measure runtime behavior before assigning
a startup saving.

## Promotion decision

The independent calendar initialization defect is fixed. Keep `compact` as the
baseline for the cloud experiment and retain
capability fallback. Promote a candidate only after its rendered motion, normal
cadence and resolution pass on the selected devices. Unavailable physical tests
stay explicitly open.

The [WebGL2 migration](orbital-webgl2.md) has a separate image comparison.
Compact retains WebGL1; selecting half-cloud rendering prefers WebGL2.
Any newly enabled aurora is a deliberate visual and performance
change and needs its own measurement. Texture storage experiments and the reasons
for retaining the current atmosphere integration are recorded in
[the candidate audit](orbital-architecture-candidates.md).


## Cadence recovery and Compact default

Compact is now the default for absent or unknown `render` values. Reference
remains explicitly available as `render=reference`. The half-cloud profile
prefers WebGL2; `api=webgl` preserves explicit WebGL1 comparisons and fallback.

Without GPU timer queries, the cadence controller observes every active RAF
callback before the 24 FPS limiter and measures the intervals between rendered
frames after focus becomes sharp. These are two different streams. On a 30 Hz
RAF schedule, healthy 24 FPS includes 33/33/33/67 ms intervals; the old fixed
58 ms p90 overload threshold incorrectly reduced that stream to minimum scale.

The corrected controller uses mean delivery above 46 ms as the ordinary overload
signal. Its recovery-only tail allowance is
`ceil((1000 / 24) / RAF_period) * RAF_period + 8 ms`, using the lower 20th percentile
of the latest 60 callback intervals. A load-degraded callback rate can increase
this tail allowance but never relaxes the mean delivery budget: sustained 20 FPS
still lowers resolution. A large tail without a mean deficit can delay a probe,
but cannot lower established quality by itself.

Initial acquisition uses 12 rendered samples, excluding one largest interval so
one isolated upload or scheduler stall does not blur the scene. Sustained
slow delivery reduces scale proportionally, with a normal step limited to
5–30% and a 300 ms resize cooldown. Six consecutive intervals above 120 ms retain
the bounded emergency reduction. After three stable seconds, the controller
switches to the established-size policy: 24-sample windows and two consecutive
mean deficits for small overloads. The later scene-transition correction adds
an earlier response when the last eight intervals, excluding their largest
value, average over 62.5 ms: one 0.1 scale
step, then a proportional reduction only if overload survives the 1.5-second
settling interval. Established emergency reduction requires six intervals above
120 ms with at least 2.4 seconds of accumulated delay. The initial full-resolution frame is preserved when the
device already meets the target. GPU-timer behavior is unchanged.

Stable capped FPS cannot prove GPU headroom. The controller therefore probes
resolution upward in 0.05 steps after eight seconds of stable samples. A probe
needs three stable seconds to be accepted; one overloaded window rolls it back,
with repeated failures backing off from 15 to 60 seconds. Playback synchronization
clears partial delivery windows, RAF estimates and stable-time evidence without
resetting scale. A pending probe keeps its previous size for rollback after
resume. Invalid samples and long gaps do not count as stable delivery. Paused
rendering does not run cadence probes.

`scripts/scene-quality.test.mjs` simulates the actual remainder-carrying limiter
at 30, 50, 60 and 120 Hz. Healthy two-minute runs retain full resolution; simulated
load reduces scale and removal of that load restores it. Separate cases cover
60→30→60 Hz transitions, low-refresh recovery, pause/resume during recovery and
an unaccepted probe, isolated startup stalls, sustained 20 FPS, and fast initial
acquisition. In the synthetic model of a 100 ms full-size workload proportional
to pixel count, acquisition finds near-target delivery within five seconds on
all four schedules. This verifies controller behavior, not real GPU throughput,
physical display timing or iPhone low-power behavior.

`scripts/verify-device-quality.mjs` checks the default and automatic WebGL2 on a
physical Android Chrome tab, logs every five-second cadence/scale window, turns
from clouds to sky to exercise recovery, and restores the half-cloud WebGL2
context. Forward Chrome CDP to localhost:9223 and reverse the preview's port with
ADB before running it. The script restores the phone's original stay-awake
setting and closes only its own native Chrome tab. Results count final canvas
draw submissions, not OS compositor presentation; image comparisons are separate.


### First-appearance evidence and remaining iPhone checks

The settled-scene script starts with `motion=0` and presses Play after assets,
focus and exposure settle. Its initial playback windows are not a cold-load
measurement. [Final Pixel adaptation and autoplay](orbital-pixel-adaptation-2026-10-10.md)
now records ordinary autoplay navigation for the default Compact view and the
dense-cloud pose using the existing browser cache. Instrumentation starts before
page scripts; it does not wait for settlement. It records draw submissions,
focus transitions, API/cloud/aurora state, scale and visibility through the first
20 seconds after sharp focus, without dropping an adaptation warmup.

Empty-cache navigation, a defined network profile, separate RAF traces and a
filmstrip remain required. A filmstrip must confirm when the sharp image actually
appears; dataset and draw-submission timestamps do not prove presentation.

Compare old and new controllers with the same viewport, assets, network, camera,
power state and foreground conditions. Report time to a sustained five-second
window near 24 FPS, minimum scale, number of reductions, and intervals above
100 ms. No fixed physical-device startup improvement is accepted from the
synthetic tests alone.

Before final threshold tuning, run the same short checks on an identified iPhone
and iOS/Safari version, in normal and low-power modes. Record actual RAF delivery
instead of assuming that low-power mode selected 30 Hz. Check settled scale and
recovery when returning to normal mode, plus the actual API, cloud path and aurora
state. The lack of an iPhone run remains an explicit acceptance gap.


### Previous Pixel acquisition and API checks (5ea0646)

The [controlled API comparison](orbital-pixel-api-2026-10-10.md) used the baseline
client with identical 618×1248 buffers and `aurora=0`, in forward/reverse order.
Compact/WebGL1 averaged 10.87 FPS, Compact/WebGL2 10.80 FPS, and half-cloud/WebGL2
17.85 FPS. The API-only change showed no useful gain; the improvement came from
the half-cloud path. Separate aurora runs and thermal records are retained, with
no claim that their late-run timing isolates aurora cost.

[Final-controller evidence](evidence/orbital-pixel-adaptation-2026-10-10.json)
records client `CsvWCxgp`, SHA-256
`f68d30f37509d39d60fbb80a37b2a236b973f5072905998efa0a9187fd14ef4b`.
Two clean 30-second controlled runs used the same viewport and scene as the API
baseline. Compact's first five seconds improved from 9.6 FPS at a final 100%
scale to 17.4 FPS at 59%. Its 10–30-second interval averaged 23.39 FPS at 59–64%.
Half-cloud's corresponding interval averaged 23.50 FPS at 78–83%. Both rolled
back an unsuccessful upward probe. Compact had eight intervals over 100 ms and
half-cloud had four in those latter intervals; zero-stall acceptance is open.

With ordinary autoplay and the native viewport, the default view held 100%
scale and approximately 24 FPS for all 20 seconds after sharp focus. The cloud
view delivered 18 FPS in the first five seconds after sharp focus, reducing
from 100% to 57%, then 24 FPS for the following 15 seconds while recovering to
62%. Its first reduction occurred 1.54 seconds after the first sharp draw.
These are warm-cache draw-submission observations, not compositor presentation
or cold-network startup measurements. All accepted runs remained visible and
had zero GL/asset errors. A hidden-tab run was explicitly excluded and repeated.

These short engineering checks validate the correction on Pixel. They do not
replace the three-repeat device protocol, establish a sustained 75% scale floor,
or validate iPhone low-power scheduling. No physical iPhone was available.


### Historical Pixel result before the RAF/acquisition correction

[Raw samples, client hashes, visibility and restoration checks](evidence/orbital-pixel-quality-2026-10-10.json)
record Pixel 9 Pro XL / Mali-G715 / Chrome 154.0.8037.126 on the earlier
Compact/recovery build (`3f32bb1`, with storage evidence added in `f205884`).
These results do not validate the later RAF/acquisition correction above.
The client is `BDaYREJa`, SHA-256
`bfe1f9387eb4e32053fa157bff121d0fbac7d5f981bc29e939fcbf3cbbf98a15`.
The phone was charging. These are short engineering checks, not the full
three-repeat device acceptance protocol above.

- The unqualified URL selected Compact/WebGL1. Its 90-second cloud run recovered
  from 46% toward 56%, reducing again when delivery deteriorated.
- Turning the same live scene from clouds toward empty sky recovered from 51%
  to 100% without reload. It reached full size by the 135-second sample, staying
  around 24 FPS throughout recovery.
- The clean 90-second half-cloud run selected WebGL2 automatically and used the
  actual half-cloud path. After the first 15 seconds, its mean five-second-window
  cadence was 23.92 FPS and scale ranged from 70% to 85%. A drop to 70% recovered
  through 75% and 80% to 85%. The tab remained visible and focused.
- That interval had p95 53.4 ms, p99 68.6 ms and maximum 119.3 ms, including two
  intervals above 100 ms. Initial adaptation is recorded separately in the raw
  samples; it also missed deadlines. Neither the 75% floor nor the no-100-ms
  target is accepted yet.
- WebGL2 context loss/restoration recreated real RG16F metadata targets, retained
  half-cloud rendering and produced no WebGL error. A settled paused scene made
  zero draws during the 1.2-second idle check.

One earlier half-cloud run was interrupted while the owner used the phone. It is
retained as excluded evidence and was repeated with visibility recording and
frame intervals spanning measurement-window boundaries. Half-day and half-night
also reached 24 FPS at full scale in the initial implementation run, but that
preceded the final cadence-threshold adjustment and is not final-build acceptance.

The local profile browser check also passed: default/API selection, camera and
settings preservation across all five profiles, context restoration, 390 px
layout and failed-table fallback. It counted 23.77 FPS and zero settled idle
draws. Chromium used the unthrottled headless flags documented in the cloud
prototype, so this is a behavior check rather than Mac cadence acceptance.

The additional Pixel RG16F/RGBA16F image comparison is complete. The
[raw measurements and PNG hashes](evidence/orbital-pixel-cloud-storage-2026-10-10.json) record
593×1196 output, fixed CSS dimensions, frozen pose/time, zero grain and manual
exposure (0 EV for daylight, +4.1 EV for dark ocean/airglow). Each comparison
covers 2,127,684 RGB channel samples.

| View | RG16F vs RGBA16F differences | Same-format reset control differences | Largest difference |
| --- | ---: | ---: | ---: |
| Dense clouds | 6 | 3 | 1/255 |
| Horizon | 7 | 34 | 1/255 |
| Dark ocean/airglow | 8 | 0 | 1/255 |

Every capture retained actual WebGL2 half-cloud rendering, with no GL errors or
failed assets. The storage change is within the existing one-output-code WebGL
migration tolerance; it is not byte-identical. The first strict comparison
found 244 differing samples, also at most 1/255, and motivated the same-format
reset control. The measured control drift prevents attributing every changed
byte solely to the storage format.

`scripts/verify-device-cloud-storage.mjs` reproduces the comparison and restores
the phone's stay-awake setting. `DEVICE_CLOUD_CASES=night` selects only that view.
Unlock the phone and keep Chrome foregrounded. These still images do not close
the outstanding motion, minimum-scale or frame-stall acceptance targets.
