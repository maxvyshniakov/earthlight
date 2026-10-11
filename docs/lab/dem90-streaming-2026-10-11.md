# DEM90 streaming, 2026-10-11

The confirmed fix is a Firefox terrain texture upload failure. A bounded
cache of decoded source DEMs is also available for comparison: it reduces
repeated decoding during motion without changing height samples, but the
benefit varies and no noticeable frame-rate gain is established. Keep the
cache experimental; the repeat does not justify enabling it as a stall fix.

Both performance candidates remain opt-in. Their defaults are unchanged.
A separate Firefox texture-crop compatibility fix applies to both paths locally:

| Candidate | URL parameter | Change |
| --- | --- | --- |
| Working cache | `terrainCache=working` | Keep up to six decoded source files on desktop, four on the mobile layout; evict non-visible parents first. The baseline is `terrainCache=small`, two files. |
| Whole tile upload | `terrainUpload=tile` | Submit the decoder's existing 1264×632 RGBA buffer once instead of twenty separately copied strips. The baseline is `terrainUpload=strips`. |

Neither candidate lowers DEM90 resolution, changes mip generation, modifies
terrain intersections or touches the quality controller. The cache increases
the desktop decoded-data ceiling from 24.4 to 73.1 MiB; the mobile ceiling is
48.8 MiB. GPU atlas storage stays 54.9 MiB on desktop. Decoder workers and
in-flight responses are additional transient allocations, not part of that
cache ceiling.

## What actually stalls

The earlier attribution of seconds of stalls specifically to `texSubImage2D`
is not a causal diagnosis. On the current renderer, moving cases submit fine
DEM uploads in milliseconds while the longest frame gaps persist. A controlled
replay writes **the same bytes into the same resident tile** on a fixed view.
It also measures controls without any new DEM writes. Those controls still
have roughly one-second gaps in frame submission under full fixed quality.

This points to the overloaded rendering/presentation pipeline, rather than
DEM writes alone. It does not identify a particular driver defect. Submitted
frames and physical monitor presentations are different measurements.
The ordinary adaptive mode is substantially smoother in this fixture.

The replay captures the terrain texture during its owning draw: texture unit
15 is reused for cloud lighting later in the frame. It reads one tile back
before measurement, then never waits for GPU completion during the measured
interval. Twenty writes are scheduled at one tile per second. Camera, heights,
resolution and shaders stay fixed. The initial framebuffer readback is excluded.

The corrected replay measured:

| Replay order | No writes | 400 strips | 20 whole tiles | No writes |
| --- | ---: | ---: | ---: | ---: |
| Submitted fps | 5.15 | 5.13 | 5.15 | 5.15 |
| Maximum frame gap (ms) | 1037 | 1141 | 1042 | 1088 |
| Total time inside upload calls (ms) | 0 | 9.4 | 5.4 | 0 |

All cases retain ten fine DEM residents and finish without new GL errors.
The controls make a large upload-specific speedup implausible for this fixture.

## Chrome on Intel UHD 630

Ubuntu/Wayland CT 106, two CPU cores, 8 GiB ceiling, Chrome 155. No Plex
transcoder was active when testing began. Each case uses a fresh browser.
The source starts at Earthlight `9ee5f153811a864401bae7ffc2b50baf3a1e8935`,
including the previously accepted terrain and cloud work reductions.

The moving fixture starts at `t=3235.65`, pitch −25°, epoch
`2026-10-06T01:32:27Z`, manual exposure 0, zero grain and 10× replay speed.
Initial assets and tile queues settle before 24 seconds of motion. A/B/A/B
ordering checks drift. No GPU timer queries or `finish` calls are inserted
into motion. Costs of a fully loaded paused frame are not substituted for
streaming performance.

### Whole tile uploads

| Quality / order | Strips | Whole tile | Strips | Whole tile |
| --- | ---: | ---: | ---: | ---: |
| Fixed, submitted fps | 4.04 | 4.33 | 4.08 | 4.08 |
| Fixed, max gap (ms) | 1721 | 1668 | 1603 | 1532 |

The fixed buffer is 1248×615. The adaptive order is whole/strips/whole/strips:
19.87 / 19.92 / 19.71 / 19.62 submitted fps, all at scale 0.45. The maximum
gaps are 338 / 376 / 380 / 356 ms. This does not show a useful repeatable
frame-rate gain from larger uploads. Fewer API calls do not prove less GPU
work or less time waiting for presentation.

### Working cache

All four cases adapt to the same 562×277 buffer. Counts below cover initial
load plus motion; the motion-only decode counts are shown separately.

| Metric | Small A | Working B | Small A2 | Working B2 |
| --- | ---: | ---: | ---: | ---: |
| Decoder invocations, total | 40 | 23 | 28 | 19 |
| Decoder invocations during motion | 25 | 12 | 13 | 8 |
| Observed repeat DEM URLs | 13 | 7 | 12 | 7 |
| Retained decoded data (MiB) | 24.4 | 73.1 | 24.4 | 73.1 |
| Submitted fps | 19.96 | 19.54 | 19.75 | 19.75 |
| p95 frame gap (ms) | 60.1 | 63.2 | 57.6 | 58.0 |
| Maximum frame gap (ms) | 356.0 | 341.7 | 364.8 | 349.9 |

Total decoder invocations fall by 42.5% and 32.1% in the adjacent pairs.
FPS and tail gaps do not show a meaningful improvement. Requests can hit
HTTP cache; the renderer's received-byte counter includes cached responses.
It must not be presented as network transfer volume. Resource Timing records
repeat URLs separately. Small differences in submission timing change which
moving tiles finish loading, so this is not an identical-request microbenchmark.

### Repeat after the bitmap fix

A fresh Chrome A/B/A/B run on the final code gives:

| Metric | Small A | Working B | Small A2 | Working B2 |
| --- | ---: | ---: | ---: | ---: |
| Decoder invocations, total | 27 | 23 | 26 | 27 |
| Decoder invocations during motion | 14 | 11 | 13 | 11 |
| Submitted fps | 19.50 | 19.71 | 19.83 | 19.79 |
| p95 frame gap (ms) | 58.2 | 61.2 | 58.1 | 58.3 |
| Maximum frame gap (ms) | 399.1 | 391.2 | 394.2 | 367.4 |

All buffers are 562×277; all prior/new GL errors and asset failures are zero.
This shows no obvious Chrome frame-rate regression from the compatibility
fix, though it is a sequential rerun rather than a paired fix/no-fix benchmark.
The cache reduces motion decoding by 21.4% and 15.4%. Initial-load timing
varies enough that total decoding does not improve in the second pair.
The first 32–43% total-count result must not be generalized to every load.
A larger cache remains an optional memory/work tradeoff, not a demonstrated
frame-stall fix. CT 106 stopped after the final run with no memory-pressure
or OOM events recorded.

## Firefox texture upload failure

Firefox 157 on this lab rejected a valid coarse terrain upload near the atlas
edge with `GL_INVALID_VALUE` (1281). This is separate from the DEM90 cache
experiment. An isolated test with an actual terrain PNG reproduced it:

| Source | Bitmap size | Atlas x / y | Result |
| --- | --- | --- | --- |
| `createImageBitmap(source, crop)` | 572×572 | 0 / 1896 | No error |
| Same cropped bitmap | 572×572 | 3160 / 1896 | Error 1281 |
| Crop copied 1:1 into its own bitmap | 572×572 | 3160 / 1896 | No error |

The atlas is 3792×3792; both valid crops fit. Both halves of the original
1144×572 PNG reproduce the failure. The behavior is consistent with Firefox
validating against the larger backing image, although the internal cause
has not been proved. This is not proof of the reported MacBook Firefox crash.

`cropTextureBitmap` materializes each crop at its actual dimensions using a
2D canvas without scaling or smoothing, then transfers its bitmap to WebGL.
It covers shared terrain tiles, the coarse-only path, and overview strips.
Temporary canvases and uploaded bitmaps are released. The helper also has a
HTML canvas fallback when OffscreenCanvas is unavailable.

After the fix, both small/working-cache Firefox motion runs completed with
no prior or new GL errors and no asset failures. Submitted fps was 16.75 /
17.00, with maximum gaps 341 / 345 ms. These are correctness checks, not a
controlled speedup over the broken baseline. Firefox's page-level renderer
string is sanitized; `about:support` confirms Mesa Intel UHD Graphics 630.

A separate real Firefox GPU readback test uploads both halves and a vertical
strip at atlas edges. All three crops match the synthetic numeric RGBA bytes
exactly, with zero GL errors. This same fixture is part of `verify:scene`.

## Image and correctness checks

An atlas test reconstructs every byte from both upload paths, including all
mipmaps, the mobile and desktop layouts, and the last atlas slot. Entries only
become visible after all writes complete. A cache test verifies reuse of
visible parents, memory bounds and release on disposal.

On M2 Max, eight identical camera poses per pair retain full DEM detail. For
the cache, mean absolute channel difference is 0.0000192/255, maximum 2/255;
for whole uploads it is 0.0000232/255, maximum 2/255. There are no temporal
channel differences above 4/255. These tiny differences are not evidence of a
new approximation: both algorithms retain the same decoded height bytes.
Stream arrival and fade timing can still differ during actual motion.

Repeating the eight cache poses with the bitmap fix gives mean absolute
channel difference 0.0000286/255 and maximum 2/255. Comparing the reference
frames before/after the fix also stays within 2/255, with no differences
above 4/255. The crop workaround does not introduce visible loss here.

The interactive review at `http://127.0.0.1:4354` has a divider, eight-frame
sequences, frame-gap timelines and live links. Its files are under
`/Users/maxwish/.codex/visualizations/2026/10/11/earthlight-dem90`.

## Reproduce

Build and serve Earthlight on LAN port 4351. From the Proxmox checkout:

```sh
uv run --locked python files/browser-lab/run.py chrome http://192.168.0.200:4351 /tmp/dem-cache-run \
  --script ../earthlight/scripts/profile-dem-stream.py --scenes adaptive --variants strips,cache,strips,cache
uv run --locked python files/browser-lab/run.py chrome http://192.168.0.200:4351 /tmp/dem-upload-run \
  --script ../earthlight/scripts/profile-dem-stream.py --scenes fixed --variants strips,tile,strips,tile
uv run --locked python files/browser-lab/run.py chrome http://192.168.0.200:4351 /tmp/dem-replay-run \
  --script ../earthlight/scripts/profile-dem-replay.py --scenes fixed --variants none,strips,tile,none
```

`--scenes` names the quality mode in these specialized profilers. The wrapper
stops CT 106 on success or failure. Do not overlap GPU tests on the same device.
For matched image sequences, from Earthlight:

```sh
bun scripts/compare-ray-work.mjs http://127.0.0.1:4351 /tmp/dem-images cache,uploads clouds
SCENE_TERRAIN_CACHE=working bun run verify:scene http://127.0.0.1:4351 /tmp/dem-scene-proof
```

The `clouds` fixture actually has resident fine DEMs. A horizon-only fixture
without fine residents cannot validate the DEM candidates; the harness rejects it.

## Validation

- `bun run verify`: 199 tests, no Astro errors/warnings, production build passed.
- `SCENE_TERRAIN_CACHE=working bun run verify:scene`: complete pass, including
  lighting, seven frames, asset failures, context restoration, mobile rotation,
  motion, constrained WebGL capabilities, focus/optics, free flight, touch and
  calendar. Context restoration also recreates the working cache correctly. The full
  suite passed again with the Firefox bitmap fix and exact GPU crop readback.
- Whole-tile uploads passed rendered frames, context restoration, optical and
  flight checks. A touch startup wait timed out on the first run; the focused
  touch and calendar retries passed. The final complete browser pass above
  tests the recommended cache with the original strip uploader.
- Matched eight-pose visual sequences passed for both candidates, with actual
  fine DEM residents, matching cameras/buffers and no asset failures.
- Desktop and 390 px review checks passed with both images loaded, four cache
  result rows, and no horizontal page overflow.

The performance candidates are not enabled by default. The Firefox fix is
applied locally; none of these changes has been published.

The candidate patch and compact measurement record are stored beside this
report in `evidence/dem90-streaming-2026-10-11.patch` and
`evidence/dem90-streaming-2026-10-11.json`. The record preserves raw artifact
paths and hashes, source base, measurements and crop probes.

## Accepted defaults

After reviewing these results, the owner accepted the Firefox fix and working
cache. The working cache is now the local default (six desktop / four mobile
parents); `terrainCache=small` restores the two-parent baseline. Strip uploads
remain the default. The measurements and candidate patch above describe the
preceding experiment; acceptance changes selection, not measured performance.
This acceptance has not yet been published.
