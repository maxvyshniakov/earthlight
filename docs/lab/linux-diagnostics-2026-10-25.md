# Current production on the Linux hardware lab

Fresh measurement of production `2fc8bedc2d423a772fb0d98927080712303af43c`,
job `20261025T193636Z-b8e84c66`. Chrome 155, WebGL2, ANGLE OpenGL ES over
Mesa 25.2.8 Intel UHD 630. Chrome GPU diagnostics confirm hardware WebGL and
compositing. CT 106 has two CPU cores and an 8 GiB ceiling; no Plex transcoder
was found before the run. No memory-pressure or OOM events were reported.
The bounded lab job exited successfully and stopped CT 106.

This is the actual deployed explorer, fresh browser profile, normal adaptive
quality, guided 60-second protocol and another 20 seconds of playback. CSS
viewport 1536 × 738 and DPR 1.25 match the Windows report through Chrome device
metrics emulation. The Weston virtual output is still 1280 × 800; this does
not reproduce physical 144 Hz presentation or the Windows D3D11 driver.

| Phase | Median of one-second submitted FPS windows | Median of window GPU p50, ms |
| --- | ---: | ---: |
| Day | 7.03 | 247.95 |
| Surface | 6.00 | 109.35 |
| Night turn | 8.50 | 97.89 |

These phases include changing buffer sizes and initialization. They are not
fixed-work GPU benchmarks. Day stayed at quality 1.0; surface fell from 1.0
to .46; night reached .45. Even at that floor the night phase was not smooth.
Day/surface submission gaps reached 2.84/3.01 seconds, night 717 ms. CPU render
submission medians were below 1 ms, which excludes other main-thread work.
The sparse stage samples are insufficient for a new per-stage ranking.

First frame: 19.515 s. Shader compiling/ready milestones: 1.023/19.463 s.
Initial assets settled: 25.516 s; sharp focus: 26.773 s. Unlike the Windows
repeat visits, this is a fresh browser profile, so startup differences cannot
be attributed solely to the GPU or OS. The Windows report on the same commit
has about 24 FPS in all phases, a remembered .45 starting quality, first frame
1.719 s and sharp focus 8.190 s. Both configurations reproduce a product
performance problem; the lab is a separate weak-GPU target, not an RTX proxy.

## Repeat without a human tester

From the Proxmox checkout:

```sh
uv run --locked python files/browser-lab/run.py chrome \
  https://earthlight.maxvyshniakov.com /tmp/earthlight-linux-new-run \
  --script ../earthlight/scripts/profile-linux-diagnostics.py --api webgl2
```

Use a fresh output directory. A reachable local production preview URL can
replace the deployed URL to test a candidate before publication. The lab runner
serializes jobs, retrieves reports/screenshots/browser GPU diagnostics, and
stops its container even on failure. The capture rejects software rendering.
Current raw artifacts: `/tmp/earthlight-linux-20261025-current/artifacts/`;
host recovery directory is recorded in the adjacent `job.txt`. Temporary
artifacts are not permanent archival storage.

Use this end-to-end run for loading, adaptive resolution and cadence symptoms.
Use the existing fixed-quality Linux profiler for controlled baseline/candidate
render costs; keep viewport, API, camera, epoch and assets matched. Browser
profiles, shader/cache warmth and remembered quality must also be controlled.
Existing scripted gesture fixtures cover input; the new capture only runs the
guided scene protocol and playback. Neither proves physical display latency.
