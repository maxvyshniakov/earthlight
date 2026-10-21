# Linux hardware GPU profile, 2026-10-11

Earthlight's expensive work on Intel UHD 630 is the cloud/atmosphere volume
and terrain rendering. Increasing the lab's RAM ceiling to 8 GiB removes an
artificial memory constraint, but does not make the heavy view reach 24 fps.
This investigation changes profiling tools and infrastructure, not the renderer.

## Environment and method

Renderer revision: `040b7c012e608e3d2aa4ce022d7266886659bb3b`, served from a
local production build. Unprivileged Ubuntu 24.04 LXC, two CPU cores,
Intel UHD 630 shared render node, Mesa 25.2.8, Weston 13 GL compositor.
Browsers open ordinary Wayland windows; neither browser uses headless mode
or software rendering. No other GPU workload was active during these runs.

Chrome 155.0.8059.39 reports ANGLE over Mesa Intel UHD 630. Firefox 157.0.1
sanitizes its WebGL renderer string; its saved `about:support` confirms
Mesa Intel UHD 630 and WebRender. The final resource configuration is an
8 GiB ceiling, 512 MiB swap, and autostart disabled. LXC memory is allocated
on demand. This is a weak-GPU test target, not a model of every 8 GB laptop.

[`profile-linux-gpu.py`](../../scripts/profile-linux-gpu.py) uses Selenium
against the stock browsers. Each case gets a fresh browser process/profile.
Paused cases wait for assets, tile queues, exposure and focus to settle.
They use fixed quality, zero grain and a fixed epoch/camera. Whole-frame and
per-draw measurements each discard eight samples and retain sixteen.
All quoted medians average the two middle samples.

Chrome provides GPU elapsed queries. Firefox does not expose the timer
extension: its values measure synchronous CPU+GPU completion using readback
and `finish`. Per-pass synchronization perturbs scheduling. Do not interpret
Firefox's numbers as isolated GPU time or directly rank the browsers.

Motion runs warm for 35 seconds and count final canvas draw submissions
for 20 seconds without readback or GPU timers. They follow the moving orbit,
so fixed/adaptive runs are practical observations, not a matched-camera
speedup measurement. These are submitted frames, not monitor presentation.

## Chrome paused costs

Canvas: 1248×615, DPR 1. Default Compact/WebGL1; aurora is unsupported on
this API because Chrome does not expose `EXT_shader_texture_lod` here.

| View / variant | Whole GPU frame, ms |
| --- | ---: |
| Day, exploratory baseline | 109.07 |
| Clouds, baseline A | 274.89 |
| Clouds, half-resolution clouds B | 204.61 |
| Clouds, baseline A2 | 274.40 |
| Clouds, terrain disabled C | 196.21 |
| Clouds, baseline A3 | 276.38 |
| Night, baseline | 65.40 |

The clouds A/B/A sequence used identical camera positions/bases, dimensions,
zero asset failures and the recorded actual cloud pass. Half-resolution
clouds saved 25.4–25.6% against both adjacent controls. The screenshots show
coarser, jagged cloud boundaries, so this is not an accepted default change.
Terrain removal saved 28.5–29.0% against its adjacent controls, but removes
terrain appearance and occlusion. It only estimates an optimization opportunity.

Baseline clouds draw medians were 113.37 ms for world/terrain and 157.23 ms
for clouds/atmosphere. Catalog/sources, exposure and final optics together
accounted for only a few milliseconds. Per-pass medians do not sum exactly
to the independently measured whole frame. With half clouds, the reduced
cloud draw costs 65.40 ms, but the following full-resolution draw still costs
20.95 ms. Evaluate the complete pass chain, not just the reduced buffer.

The day measurement predates process isolation and is exploratory. The
fresh Chrome series began with a 4 GiB ceiling; it was raised to 8 GiB near
the terrain/control cases. Parent-cgroup pressure counters did not increase
during the fresh series, and the baseline repeats stayed within 0.8%.
Do not use this series to estimate a RAM-size performance gain.

## Motion and Firefox

| Browser / view | Fixed submitted fps | Adaptive submitted fps | Final adaptive scale |
| --- | ---: | ---: | ---: |
| Chrome / day, exploratory | 7.70 | 23.20 | 0.55 |
| Chrome / clouds | 2.96 | 13.65 | 0.45 |
| Chrome / night | 15.95 | 23.55 | 0.80 |
| Firefox / clouds | 2.25 | 10.85 | 0.45 |

Firefox's clouds canvas is 1228×663, and aurora is enabled (`volume`). Its
paused whole-frame completion median is 293 ms; world/terrain and volume
draw completion medians are 122.5 and 163.5 ms. The different pixel count,
feature state and timing method prevent an API/browser speedup claim.
The 8 GiB Firefox run finished without cgroup memory pressure or OOM events.

A Firefox startup left WebGL error 1281 pending before measurement. The
profiler records and clears pre-existing errors, then rejects new errors
during samples. The first profiler attempt rejected that stale error; a
separate diagnostic navigation also lacked Firefox's system-access flag.
The corrected run completed, but the startup GL error still needs attribution.
The original friend's Mac Firefox crash is not reproduced or explained here.

A final Chrome WebGL2 smoke profile at the 8 GiB ceiling measured 272.66 ms
for the paused clouds frame, with aurora enabled and no pending/new GL errors.
This is close to the WebGL1 controls, but changes feature state and lacks an
API-matched A/B/A sequence. It establishes that WebGL2 works on the lab;
it does not justify changing the default API for performance.

## Highest-value follow-up work

1. **Cloud density and lighting integration.** The volume pass costs about
   157 ms in the heavy view. Inspect empty intervals, repeated density/shadow
   lookups and work outside visible cloud support in `earth-clouds.ts`.
   Preserve footprint filtering and compare motion and silhouettes before
   retaining any reduced sampling or reconstruction change.
2. **Terrain intersection and shadows.** Disabling terrain removes about
   79 ms from the world draw. `earth-terrain.ts` allows 96 intersection steps,
   11 binary refinements and 24 light-ray samples. Candidate experiments
   include stopping an already-zero shadow visibility accumulator and
   footprint-bounded intersection refinement. These are hypotheses, not
   measured improvements; preserve ridge occlusion and polar behavior.
3. **Texture upload stalls during motion.** In the fixed clouds CPU profile,
   `texSubImage2D` accounts for 4.26 seconds of a 20.29-second sample window
   (21%). The sampled main thread is idle for 73%; this does not imply the
   entire machine is idle. Driver synchronization with a busy GPU may explain
   part of that call time. Identify the atlas/source and batch the one-texel
   terrain page-table updates before changing the global upload budget.
   Day's fixed profile is 97% idle, supporting GPU work as the first priority.
4. **Repeated-navigation memory and startup.** A reused-browser experiment
   filled the old 4 GiB cap and 512 MiB swap after several full navigations;
   host RAM remained available. Parent-cgroup PSI showed severe stalls but
   no OOM kill. Fresh processes avoided that accumulation. Retained documents,
   renderer resources and driver caches need separate attribution; this is
   not proof of a single-page leak. Initial shader setup was about 6.5 seconds
   in Chrome and 8.7 seconds in Firefox, where compilation was synchronous.
   These are one-off startup observations, not a controlled cold-cache study.

Lowering the adaptation floor further would trade away more image detail.
Changing UI frameworks or rewriting ordinary JavaScript is not the first
response to the measured shader costs.

## Evidence and reproduction

[Compact raw samples and states](evidence/orbital-linux-gpu-2026-10-11.json)
retain frame/pass timings, camera states, capabilities, shader hashes and
CPU-profile summaries. Full shaders, profiles and screenshots are retained
locally under `/tmp/browser-lab-20261011`; that directory is not permanent
storage. No large asset datasets are included in this report.

From the lab host checkout, with the production preview reachable over LAN:

```sh
uv run --locked python files/browser-lab/run.py chrome http://<lab-host>:4351 /tmp/earthlight-chrome-run \
  --script ../earthlight/scripts/profile-linux-gpu.py --scenes clouds,day,night
uv run --locked python files/browser-lab/run.py firefox http://<lab-host>:4351 /tmp/earthlight-firefox-run \
  --script ../earthlight/scripts/profile-linux-gpu.py --scenes clouds --variants baseline
```

Run browsers sequentially. The wrapper starts the lab container, collects artifacts and
shuts it down, including failures, Ctrl-C and the host's 30-minute deadline.
An injected exit-7 failure and the successful Firefox run both stopped the
container and preserved artifacts. The host GPU driver and other guests
were not reconfigured.
