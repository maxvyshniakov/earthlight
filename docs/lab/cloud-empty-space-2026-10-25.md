# Cloud empty-space work and frame scheduling

Baseline: `25c035b6fe8f80852a0b2e4dfb3b7dd2e89be33d`, asset release
`76add0714c798c49`. Candidate changes three independent areas:

- Photographic cloud density rejects only analytically empty parts of the
  volume before expensive texture/noise work. The global bounds are .8 to
  9.275 km; the per-column bound retains the maximum possible noise relief
  and upper feather. Resolution, density inside the envelope, integration
  steps and temporal reconstruction are unchanged. Measured-cloud models
  keep their existing independent density functions.
- GPU readiness is queried only when the frame clock reaches a deadline.
  A blocked slot retains that deadline. The queue permits three in-flight
  frames instead of two to tolerate browser-delayed fence notifications.
  It remains bounded and uses zero-timeout waits; WebGL1 is unchanged.
- Local reports include allowlisted navigation/paint timings from before
  recorder startup, plus cumulative GPU queue polls, blocked polls and the
  longest observed completion notification. No URLs, auth redirects, referrer
  or server-timing descriptions are copied into navigation diagnostics.

## Why these changes

The Windows reports on `25c035b` show Chrome 155 dropping from 24 to about
21 FPS on the guided night turn at scale .45; Opera 137 / Chromium 153 holds
24 FPS at much larger buffers on the same RTX 2080 / ANGLE D3D11. A 48.6 ms
cadence on a roughly 144 Hz display is one refresh longer than the intended
41.7 ms. They do not measure fence notification latency, so the queue remains
a hypothesis for that specific Windows regression, not a confirmed diagnosis.
A deterministic scheduling test shows that 90 ms completion-notification
latency must not reduce sustainable 24 FPS throughput; three slots retain it.

Opera's resource requests and inline recorder start at about 14.9 s after
navigation; first frame is 16.6 s, shader compilation approximately 1.4 s.
The old report cannot distinguish waiting for HTML from redirects or other
navigation delays. New navigation timings cover that gap. This does not itself
fix slow HTML delivery or make a page visible before the response arrives.

## Hardware measurements

Intel UHD 630, Mesa 25.2.8, Chrome 155, native Wayland browser, CT106 with
2 CPU cores and an 8 GiB ceiling. No Plex transcoder found during this series.
Fresh browser profiles; no software rendering. The wrapper serializes jobs
and stops CT106 on exit. Linux is not a substitute for Windows driver proof.

Cloud benchmark: paused fixed-quality 1248 × 615 buffer, WebGL2, calibrated
clouds, coarse terrain, manual exposure, no grain, t=3235.65, pitch=-25,
epoch=2026-10-06T01:32:27Z. Twelve whole-frame GPU samples after four discarded
warm-up samples. Baseline/candidate/baseline order:

| Version | Median GPU time |
| --- | ---: |
| Baseline A | 134.50 ms |
| Empty-space bounds | 117.56 ms |
| Baseline B | 138.30 ms |

This saves 12.6–15.0% of whole-frame GPU time without changing resolution.
Screenshot mean absolute byte difference: candidate vs baseline A 0.000538
(0–255 scale), versus 0.000869 for baseline B vs baseline A. Only 0.053% of
channels differ in the candidate, maximum difference 5; repeated baseline
maximum difference is 12. Cloud boundaries were also visually inspected.
These measurements prove the tested view, not every possible cloud appearance.

Polling-at-deadline alone, normal animated night playback at 1920 × 923:
7.543 FPS baseline and candidate, gap p95 151.4/151.7 ms. Adaptive:
32.085 FPS both, gap p95 51 ms both. It reduces unnecessary polling but does
not establish a throughput gain on Intel. Diagnostic collection was disabled.

## Evidence and verification

Raw artifacts are under `/tmp/earthlight-linux-cloud-bounds`,
`/tmp/earthlight-linux-deadline`, `/tmp/earthlight-linux-queue3` and
`/tmp/earthlight-linux-cloud-control`. Each includes a host recovery job path.
Repository evidence is saved beside this note after the complete series.

Navigation diagnostics were browser-tested with scene modules blocked: the
inline recorder still downloaded a real report containing navigation timings.
The full guided test, download, previous-report recovery and ordinary visits
also passed. Source tests cover zero-density boundaries, bounded queues,
delayed fence notification, pending deadlines, and private navigation fields.
Shader-source fixtures were refreshed for the deliberate source change after
GPU and image comparison; they do not replace rendered verification.


Additional fixed-work controls: day 54.98 → 49.41 ms (-10.1%); night
57.59 → 50.82 ms (-11.7%). Mean byte image differences are 0.0000165 and
0.00000695 respectively. All cases retain the same buffer and shader budgets.

Three-slot queue, without the shader change, normal playback: fixed-buffer
candidate/baseline 7.60/7.57 FPS, gap p95 151.8/152.2 ms, max 178.3/154.7 ms;
adaptive 32.06/32.80 FPS, gap p95 50.9/51.0 ms. This does not establish an
Intel FPS improvement; the extra slot slightly increases worst-case queue
latency. It addresses delayed browser notifications while remaining bounded.

Full source verification passed 406 tests, type checks and production build.
Full rendered scene/control verification passed on retry. The first run timed
out at a paused scene's asset/focus settling wait; the complete isolated retry
passed without changing the timeout. Navigation-report browser verification
passed, including real downloads with scene modules blocked.


Final combined candidate in ordinary animated cloud playback (no diagnostic
mode or GPU timer queries), fresh profiles, 1536 × 738 CSS at DPR 1.25,
t=3235.65, pitch=-25, epoch=2026-10-06T01:32:27Z, 45 seconds after sharp focus:

| Version | FPS | Gap p95 | Max gap | Final buffer |
| --- | ---: | ---: | ---: | --- |
| Baseline | 12.87 | 98.9 ms | 676.4 ms | 864 × 415 |
| Combined candidate | 14.71 | 81.7 ms | 602.6 ms | 864 × 415 |

The application gains 14.3% FPS at the same final resolution. The cold first
frame remains 18.7/18.9 seconds; startup compilation has not been accelerated.
This weakest-GPU cloud view is still below smooth-playback targets. Windows
Chrome's specific 21 FPS regression remains unverified on D3D11; the bounded
queue fix is covered by the delayed-notification test and Linux comparisons.
All hardware jobs completed and stopped CT106 with no OOM/memory-pressure
flags. Full frame histories, buffers and fixed-work samples are archived in
`evidence/cloud-empty-space-2026-10-25.json`.
