# Pixel load-transition check — 2026-10-10

The corrected controller reacts sooner in the Compact cloud transition: the first draw at a reduced backing size moved from 5.272 s to 1.112 s. Compact remains the default. Half-resolution clouds preserve more fine detail at their observed larger working buffer, but their cloud edges still need visual review. This is a short engineering check, not sustained device acceptance.

Implementation and simulator contract: [quality transitions](orbital-quality-transitions-2026-10-10.md). The simulator's response-time assertions and the physical draw-cadence window below are different measurements.

## Recorded builds and conditions

| Run | Loaded client | SHA-256 | Raw evidence |
| --- | --- | --- | --- |
| Baseline at `5ea0646` | `CsvWCxgp` | `f68d30f37509d39d60fbb80a37b2a236b973f5072905998efa0a9187fd14ef4b` | [baseline](evidence/orbital-pixel-transitions-baseline-2026-10-10.json) |
| Rejected first candidate | `DEiRGvhB` | `972544d46ca51d32bb2cee231cc9031a04a410d1e6bc413b58562a12f8fa3b27` | [rejected v1](evidence/orbital-pixel-transitions-rejected-v1-2026-10-10.json) |
| Final corrected candidate | `F2XlptCx` | `db7cbedc630d787d3a3c0b3dec7d96d6755dd32fcf795560866ddb00679430cc` | [final v2](evidence/orbital-pixel-transitions-final-v2-2026-10-10.json) |

Pixel 9 Pro XL, Chrome 154, Mali-G715; foreground native Chrome tab. CSS canvas 395×797, initial actual backing 592×1195, native DPR 3.400000095. Compact explicitly used WebGL1; half explicitly used WebGL2 and the half cloud pass. This comparison includes both the rendering profile and API; it does not isolate API performance.

Both profiles used `aurora=0`, grain 0, manual exposure 0, epoch `2026-10-06T01:32:27Z`, phase start `t=3235.65`, continuous 10× playback. Pitch changes between +60° sky and −25° clouds; each phase seeks back to the same time without pausing or resetting adaptation. Assets, exposure and focus settled before timing. Cache was not cleared. This is neither a cold-start nor network test.

Baseline: sky 10 s → clouds 20 s → sky 20 s. Final: sky 12 s → clouds 30 s → sky 20 s. Each ran Compact then half, once; the comparison uses the common first 20 cloud seconds. Battery temperature rose from 28.9 to 30.2°C over baseline and 31.9 to 34.9°C over final timing, images and UI checks. Thermal-service snapshots are retained. Order and temperature were not counterbalanced, so there is no statistical gain estimate.

All accepted timed sections stayed visible; both profiles ended with GL error 0 and asset failures 0. Final corrected code received one transition cycle per profile. Only the rejected candidate completed two cycles, so repeated-cycle acceptance is still open.

## Common cloud window

Intervals are differences between successive final-framebuffer draw submission timestamps. They are not GPU durations or compositor presentation times. The 3–8 s mean includes only intervals whose start and end are both inside that window. The engineering criterion is ≤46 ms; it is not a strict 24 fps assertion. The raw summary's `firstNearTarget5sWindowStart` uses another FPS heuristic and is not this criterion.

| Profile / build | First 5 s, fps | Next 5 s, fps | Mean interval, cloud 3–8 s | Actual buffer at 20 s | Intervals >100 ms in first 20 s |
| --- | ---: | ---: | ---: | --- | ---: |
| Compact baseline | 10.0 | 23.0 | 58.379 ms (84 intervals) | 305×616 | 21 |
| Compact final | 15.4 | 24.0 | 44.341 ms (112 intervals) | 360×727 | 14 |
| Half baseline | 19.6 | 21.4 | 47.648 ms (104 intervals) | 533×1076 | 17 |
| Half final | 19.6 | 22.8 | 45.991 ms (108 intervals) | 504×1016 | 14 |

Compact passes this short transition criterion. Half is a single borderline result, only 0.009 ms below the threshold: it has no demonstrated reliable margin.

At final cloud 30 s, Compact was still 360×727 (~60.8% by width) and half 504×1016 (~85.1%). These sizes covered all draws in the last 10 s; cadence there was 24.0 and 23.8 fps respectively. This does not establish sustained 75% quality acceptance across day, night and clouds. After the following 20 s of sky, Compact reached 419×846 (~70.8%) and half 533×1076 (~90.0%), both approximately 24 fps. Neither had returned to full resolution yet.

## Exact resize timeline

`device-scene-timeline.mjs` runs before the application. It records native canvas width/height setter **entry** timestamps, then stores their resulting actual sizes. Width and height writes can be separated by a blocking resize. Scale timestamps are **MutationObserver delivery times**, not synchronous attribute-write times. Final-draw timestamps are sampled immediately after the final `drawArrays` call returns. None proves when a frame became visible on screen.

The table is relative to the recorded cloud phase command, not a rounded phase duration.

| Profile / build | First scale observation | Width setter entry | Height setter entry | First draw at new size | New size |
| --- | ---: | ---: | ---: | ---: | --- |
| Compact baseline | 4.886 s | 4.893 s | 5.168 s | 5.272 s | 275×556 |
| Compact final | 0.830 s | 0.833 s | 1.008 s | 1.112 s | 533×1076 |
| Half baseline | 2.506 s | 2.561 s | 2.741 s | 2.794 s | 533×1076 |
| Half final | 2.550 s | 2.559 s | 2.657 s | 2.721 s | 533×1076 |

Compact final then observed 0.56 at +3.005 s and first drew 331×667 at +3.361 s; it drew 360×727 at +17.518 s. Half final observed 0.80 at +6.300 s, first drew 474×956 at +6.403 s, then drew 504×1016 at +16.846 s. Raw data retains every observation, resize and draw rather than a five-second scale sample.

Among the >100 ms intervals in the common first 20 s, intervals overlapping ±500 ms around the first draw at any changed size numbered 2/21 for baseline Compact, 1/17 for baseline half, and 7/14 for each final profile. This is temporal association. The log cannot attribute a long interval to resizing rather than preceding GPU work, scheduling or another cause. Long intervals remain, so a requirement of no intervals longer than 100 ms has not passed.

The rejected v1 detector missed alternating long/short callbacks; its Compact first reduction stayed near five seconds. Its complete timing logs remain in git, explicitly rejected. Final v2 was rebuilt after the correction and its loaded client hash was checked on the phone.

## Matched image and motion replay

Captures are separate from timing. No readback, screenshot, GPU wait or offline image operation ran during the timed phases.

The replay locks the actual observed final cloud buffers: Compact 360×727 and half 504×1016. Both replay the same epoch, camera, exposure, grain and aurora settings. It starts at `t=3435.65`, the start of the final ten-second cloud selection window, with 32 frames spaced by 10/24 simulated seconds: 1.33 seconds of 24 fps, 10× playback. Camera position and basis equality were asserted for every matched pair. This replays sizes selected during moving scenes; it does not claim that a frozen pose independently establishes those sizes.

Primary images are real Chrome compositor PNGs (`Page.captureScreenshot`, `fromSurface`) after two RAFs on each paused frame. The fixed 395×700 CSS clip at native DPR produced 1343×2380 pixels. Controls were hidden by test-only CSS. Primary PNGs were not reconstructed from raw backing images or resampled offline; raw backing PNGs are retained only as diagnostics. Fixed replay metadata reports `renderScale=1`, because the test locks canvas dimensions directly; actual dimensions above are authoritative.

Local review artifacts in `/tmp/orbit-transitions-v2-20261010/`:

- `comparison.png`: native side-by-side frame 00 with labels, Compact left and half right.
- `comparison.mp4`: 32 paired compositor frames encoded at 24 fps, Compact left and half right. This reconstructs matched visual motion; it is not a screen recording or proof of real-time playback smoothness.
- `motion-contact-sheet.png`: labelled, downsampled overview of frames 00/08/16/24/31. Use original compositor PNGs to judge native edges.
- `compact-360x727-00-composited.png` through `-31-composited.png` and `clouds-half-504x1016-00-composited.png` through `-31-composited.png`: original primary images.

Each original image hash and exact pose/time are in final-v2 evidence; [artifact manifest](evidence/orbital-pixel-transition-artifacts-2026-10-10.json) records derived artifact hashes. Large local image/video files are not committed. Persistent copies of the paired PNG, MP4 and contact sheet are also available at `[local artifact directory]`. The visible tradeoff is sharper fine structure with half, but more stepped edges on the long cloud near the horizon. Frame inspection does not establish absence of flicker. Keep Compact default pending a broader visual decision.

## Aurora UI and remaining scope

On the same Pixel, the actual `#sky-aurora` control passed Auto → On → Off: touch media matched; all three used WebGL2 and the half cloud pass; the selected aurora path was off → volume → off; all GL errors were zero. These checks were outside timing and are retained under `auroraControls` in final-v2 evidence.

The owned browser tab was closed. Original Android keep-awake was restored and read back as 0; only task reverse ports 4350/4352 and forward 9223 were removed. Baseline preview was stopped. No additional physical runs followed.

Open: iPhone/Safari and its low-power mode; sustained day/night/cloud quality; repeated final transition cycles and temperature-controlled repeats; true presentation/filmstrip timing; cold-cache/network startup; long-frame elimination; visual acceptance of cloud edges and real-time motion.

To repeat, use the Node 24 device driver setup and `DEVICE_TRANSITION_ONCE=1 DEVICE_TRANSITION_AURORA_SMOKE=1 node scripts/verify-device-transitions.mjs <preview-url> <output-dir>`. Without `ONCE`, the harness records two cloud transitions. Reserve the unlocked foreground phone first; the harness changes scene controls only in its owned tab.
