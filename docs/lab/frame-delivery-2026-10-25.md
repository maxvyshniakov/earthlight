# Frame delivery on the Intel hardware lab

## Result and scope

The October 25 renderer is faster than the October 11 renderer at matched
buffer sizes. The poor normal-playback result was nevertheless real. Two
independent product defects explain much of it: unbounded GPU submission
bursts, and a geometric resolution boost that defeats the adaptive floor.

The candidate bounds WebGL2's in-flight frame queue to two using nonblocking
fences. It skips obsolete animation poses while the GPU is busy and renders
the current pose when a slot opens. Paused input remains pending until it can
render. Forced resize draws retain bounded fence ownership; context release
clears it. WebGL1 retains the previous pacing path. Background rendering does
not install this explorer queue.

Long callbacks now advance the frame clock without entering its display-rate
estimate. Previously callbacks over 250 ms could never make a steady frame due.

The coverage multiplier is now opt-in (`viewScale=.1`) rather than default.
In the measured sky-heavy view it doubled the adaptive .45 floor to .90,
keeping the actual buffer at 1728 × 830 despite sustained 9 FPS. Cadence-based
upward probes now own detail recovery. This change permits a smaller animated
buffer; it is not a shader speedup. Paused inspection still uses full detail.

## Controlled historical comparison

Host: Intel UHD 630, Mesa 25.2.8, Chrome 155, native Wayland under Weston;
CT 106, two CPU cores and 8 GiB memory ceiling. Hardware WebGL is asserted.
No software renderer, Chrome headless mode, or CPU throttling was used.
No Plex transcoder was present before the initial series. These are submitted
frames and GPU elapsed measurements, not physical display latency.

Old revision `040b7c012e608e3d2aa4ce022d7266886659bb3b`; current baseline
`2fc8bedc2d423a772fb0d98927080712303af43c`. Both use the same immutable assets
(`76add0714c798c49`), WebGL2, 1248 × 615 buffer, DPR 1, fixed quality, original
clouds, coarse terrain, manual exposure and matching camera/time parameters.
Fresh browser per case, old/current/old order. Each GPU median uses 12 whole
frame queries after four discarded samples. Screenshots were checked for
matching scene framing; UI and renderer features differ between revisions.

| Scene | Old A GPU ms | Current GPU ms | Old B GPU ms |
| --- | ---: | ---: | ---: |
| Day | 89.87 | 58.31 | 90.23 |
| Clouds | 226.24 | 139.44 | 226.69 |
| Night | 68.26 | 58.40 | 67.86 |

This does not establish that every feature or camera is faster. It rules out
an across-the-board GPU regression in these controlled scenes. Historical
adaptive FPS numbers used different buffers and cannot establish a regression.

## Normal animated playback

Same production assets, fresh browser per case, CSS viewport 1536 × 738 at
DPR 1.25, t=2488.1, epoch=2026-10-06T01:32:27Z. No diagnostic mode, GPU timer
queries, forced GPU waits, or test-only render loop. A passive wrapper records
submission of the final canvas pass. GPU completion fences are product code.

The first experiment ran 25 seconds per case, after sharp focus:

| Version | Quality | Buffer | Submitted FPS | Gap p95 ms | Max gap ms |
| --- | --- | --- | ---: | ---: | ---: |
| Baseline | Fixed | 1920 × 923 | 7.76 | 517.6 | 851.5 |
| Queue fix | Fixed | 1920 × 923 | 7.48 | 151.8 | 153.3 |
| Queue fix | Adaptive, old boost | 1728 × 830 | 9.40 | 127.8 | 255.9 |
| Baseline | Adaptive, old boost | 1728 × 830 | 9.28 | 442.4 | 860.6 |

The queue trades a small throughput difference for substantially more even
submission, at unchanged resolution and shader work. This is not proof of
which submitted frames the physical display presents.

A second experiment disabled only the coverage boost on both versions, for
45 seconds per case, candidate first (reversing the initial fixed comparison):

| Version | Final buffer | FPS | Gap p95 ms | Max gap ms |
| --- | --- | ---: | ---: | ---: |
| Queue fix, no boost | 864 × 415 | 35.60 | 50.6 | 225.3 |
| Baseline, no boost | 864 × 415 | 34.76 | 35.6 | 780.0 |

Last 15 seconds: candidate 38.4 FPS, max gap 51.4 ms; baseline 38.3 FPS,
max gap 182 ms. Resolution explains the FPS increase; the queue explains the
reduction in long bursts. The candidate's overall p95 is worse in this second
pair, so the benefit must not be described as an improvement to every metric.

Cold first frame remained approximately 19 seconds in every case. Startup
shader compilation is unresolved. Windows/D3D11 and the user's RTX 2080 are
not validated by this Intel/OpenGL result.

## Reproduce and inspect

From the Proxmox repository:

```sh
uv run --locked python files/browser-lab/run.py chrome \
  http://<preview-host>:<port> /tmp/earthlight-delivery-new \
  --script ../earthlight/scripts/profile-linux-delivery.py \
  --scenes fixed,adaptive --api webgl2
```

Use the same URL parameters, browser profile policy, assets and viewport for
baseline and candidate. URL camera parameters can override the default scene.
The runner serializes jobs and stops CT 106 even on failure. The script only
collects local artifacts; it does not send reports anywhere.

Repository evidence: `evidence/earthlight-delivery-2026-10-25.json`, including
raw frame timestamps and buffer histories. Full local screenshot artifacts:
`/tmp/earthlight-linux-history-compare2`, `/tmp/earthlight-linux-queue-compare`,
`/tmp/earthlight-linux-no-boost`, and `/tmp/earthlight-linux-final-scenes`.
Each directory includes its host recovery job path. These temporary paths
are not permanent archival storage.

Validation: `bun run verify` passed 402 tests, type checks and production build.
`bun run verify:scene` also passed, including controls, context recovery,
paused inspection detail, slow loading and reduced-data behavior.

Final candidate default settings (no viewScale override), fresh profiles,
45-second normal playback windows:

| Scene | Submitted FPS | Gap p95 ms | Max gap ms | Final buffer |
| --- | ---: | ---: | ---: | --- |
| Day | 35.78 | 50.4 | 267.4 | 864 × 415 |
| Clouds | 13.24 | 100.0 | 676.2 | 864 × 415 |
| Night | 31.36 | 51.0 | 215.0 | 864 × 415 |

The cloud-heavy view is still GPU-bound at the existing .45 floor. This is a
meaningful improvement to ordinary playback and queue stalls, not completion
of all performance work. Optimizing volume shader work without losing cloud
boundaries remains necessary for that view. The final hardware job completed
successfully, reported zero memory pressure/OOM events and stopped CT 106.
No publication was performed for this candidate.
