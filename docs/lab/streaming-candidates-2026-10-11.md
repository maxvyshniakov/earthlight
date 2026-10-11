# Streaming candidates, 2026-10-11

Three independent candidates follow the accepted working DEM cache and Firefox
bitmap fix. The accepted cache stays enabled. These new switches remain opt-in
while comparing cost, motion and image quality.

| Candidate | Switch | Control | Data or scheduling change |
| --- | --- | --- | --- |
| Reuse decoders | `terrainDecoder=pool` | `single` | Retain up to two workers per input format; abort/error destroys the affected worker. |
| Prepared DEMs | `terrainSource=packed` | `tiff` | Read a versioned gzip container of the existing four packed RGBA patches. |
| Smaller lighting stripes | `cloudBake=budget` | `fixed` | Submit 16/32/64 atlas rows based on recent frame submission cadence; retain full atlas dimensions and all height slices. |

`terrainUpload=strips`, `terrainCache=working`, and the accepted bounded ray /
pixel refinement / balanced cloud settings are common to these comparisons.
No shader sample count or terrain height resolution changes in these candidates.

## Prepared terrain

`bun run terrain:prepare --ids-file ids.json` accepts an explicit JSON array of
one-degree Copernicus parent IDs. It uses the same `packTerrainPatch` function
as the live worker. It retains the current height quantization, slope gutters,
interpolation and mip construction; the container introduces no new loss.
It does not download the world by default.

The expanded test region's 52 sources occupy 250,328,463 bytes as TIFF and
40,768,488 bytes prepared: 83.7% smaller. The first motion comparison used
41 parents (198,475,321 to 34,161,446 bytes); the combined DEM rerun used 52. Individual ratios vary with terrain. This is a
regional sample, not a projection of the entire world's storage requirement.
Each output is gzip round-trip checked and records source / compressed /
decoded SHA-256 hashes in its manifest. Original Copernicus credits accompany
the prepared assets.

The `ELDEM001` header validates parent identity and exact patch byte length.
Decompression is bounded to the expected output size. Four independent
transferable buffers keep ownership the same as the TIFF decoder. Missing
coverage uses TIFF directly. Missing/bad prepared data falls back to TIFF and
disables further prepared requests for that parent in the current scene.
A missing or stalled optional manifest cannot disable the original source.

Prepared files use `.dem`, not `.gz`. The initial `.gz` prototype exposed a
real delivery trap: Astro returned `Content-Encoding: gzip`, the browser
expanded the body, and the worker's second decompression failed. Those
prepared-file measurements are excluded. The corrected runs assert actual
prepared decodes and zero error fallbacks. Partial coverage outside the test
region is intentional.

The runtime decoded cache ceiling and GPU atlas size are unchanged. Smaller
network files do not mean a smaller decoded atlas. Decompression and buffer
transfer still use temporary memory.

## Decoder lifecycle

The pool reuses completed workers. Cancellation terminates a running worker,
removes queued work and detaches handlers. A late callback cannot satisfy a
new task. Errors discard a worker; disposal rejects queued/running tasks and
terminates idle workers. There are at most two per format, so fallback across
both formats can retain up to four; the normal single-format route uses at
most two. The shared scene decode queue still limits concurrent decoding to two.

The isolated lab benchmark fetches all input buffers before timing. Six real
source tiles run in alternating mode order for three measured rounds, with
module warmup excluded. Every output byte is compared with the TIFF decoder.
Timings include Worker creation for single-use modes, and exclude network
and the byte-comparison loop. They are input processing wall times, not GPU
frame times or physical presentation rate.

## Cloud atlas budget

The cadence policy changes only the number of rows submitted on an update.
Each atlas row is written exactly once, including when the row budget changes
partway through a tile. Publication still requires a complete replacement.
The prior valid atlas remains usable; existing movement, relighting and polar
fallback rules are retained.

This trades the duration of one bake draw against the time until a new atlas
is ready. A smaller stripe can prolong fallback raymarching or retain older
lighting for longer. It is therefore not automatically an improvement even
though final atlas resolution is unchanged. No nested GPU timers or blocking
GPU waits were added to the renderer.

## Measurement setup

Ubuntu/Wayland CT 106, two CPU cores, 8 GiB ceiling, hardware Intel UHD 630.
The wrapper shuts down the container after each job; interrupted jobs are
checked explicitly. No Plex transcoder was active at the initial check.

The preview's optional `--terrain-cache .media/dem90` serves the original TIFF
fixtures from the same machine/connection as the prepared assets. This avoids
crediting S3 latency to the format change. Uncovered fixture files retain the
normal upstream fallback.

The motion test starts settled at `t=3235.65`, pitch -25 degrees, epoch
`2026-10-06T01:32:27Z`, manual exposure 0 and no grain. It measures 24 seconds
at 10x replay speed in a fresh browser per case. Adaptive and fixed quality
must be analyzed separately. It records fine terrain residency, worker starts,
decode durations, prepared fallback counts, atlas bake progress, submitted
frames and frame gaps. GPU completion calls are absent during motion.

Matched visual tests use eight identical poses on M2 Max. These test completed
atlases; they do not replace motion/tail-gap checks or establish weak-device FPS.

## Reproduce

```sh
bun run terrain:prepare --ids-file ids.json
bun run verify
bun run preview --host 0.0.0.0 --port 4355 --terrain-cache .media/dem90
bun scripts/prepare-dem-benchmark.mjs
```

From the Proxmox checkout, one job at a time:

```sh
uv run --locked python files/browser-lab/run.py chrome http://HOST:4355 /tmp/decoder-proof \
  --script ../earthlight/scripts/profile-dem-decoders.py --scenes adaptive
uv run --locked python files/browser-lab/run.py chrome http://HOST:4355 /tmp/stream-proof \
  --script ../earthlight/scripts/profile-dem-stream.py --scenes adaptive --variants base,pool,packed,bake,all,base
```

From Earthlight, on a separate GPU from the active lab job:

```sh
bun scripts/compare-ray-work.mjs http://127.0.0.1:4355 /tmp/stream-images pool,packed,bake,streaming clouds
SCENE_TERRAIN_CACHE=working SCENE_TERRAIN_DECODER=pool SCENE_TERRAIN_SOURCE=packed SCENE_CLOUD_BAKE=budget \
  bun run verify:scene http://127.0.0.1:4355 /tmp/stream-scene-proof
```

The local review is `http://127.0.0.1:4356`; the measurements below are completed
from retained raw artifacts rather than estimates.

## Completed results

On hardware UHD 630 in Chrome, median processing times over 18 samples per
mode were 389.85 ms for TIFF/new worker, 320.30 ms for TIFF/pool, 34.95 ms for
prepared/new worker and 29.90 ms for prepared/pool. All decoded output bytes
matched. Pool reuse alone saved 17.8%; the combined prepared/pool path was
13 times faster at this isolated operation. Network and byte verification
are excluded from those times.

The 24-second adaptive motion comparison did **not** show a material FPS gain:

| Mode | Submitted FPS | Frame gap p95 (ms) |
| --- | ---: | ---: |
| Control before | 19.54 | 63.4 |
| Worker pool | 19.54 | 59.9 |
| Prepared DEM | 19.17 | 67.3 |
| Budgeted cloud bake | 18.83 | 212.6 |
| All three | 18.83 | 174.6 |
| Control after | 19.50 | 60.4 |

The prepared DEM plus worker-pool rerun, with the cloud budget disabled,
measured 19.25 FPS / 63.9 ms p95, between controls of 19.78 / 65.0 and
19.71 / 62.3. Initial settling took 38.39 seconds versus 42.79 and 42.18.
This is one bracketed run, not a statistically established loading-time gain.
Its summed completed decode wall times during motion fell from 20.95 / 19.36
seconds to 2.45 seconds. These sums can overlap and exclude cancelled jobs;
they are not main-thread stalls or CPU busy time. Prepared coverage remained
partial (59 prepared decodes out of 63 attempts, zero error fallbacks).

Every adaptive run ended at a 562 x 277 canvas, scale 0.45, with eight fine
terrain cells resident, no new GL errors and no asset failures. Cloud atlas
generations advanced from 1 to 3 in each case. Smaller stripes required more
updates and worsened the observed tail gaps. Keep that candidate disabled.

All four candidates passed eight matched M2 poses. Maximum image difference
was 2/255 in any channel; no pixels differed by more than 4/255. The prepared
height bytes matched exactly; the tiny rendered differences are within the
control rerender variation. This does not establish temporal quality while
an atlas is still baking. The motion measurements above remain necessary.

The 205-test source gate and complete browser scene suite passed on the
corrected `.dem` route, including actual prepared decoding with fine terrain,
context restoration, texture crop readback, motion, optics and interactions.
New candidate switches remain opt-in. Assets cover a test region and are
local; no publication or site package update was made in this experiment.

## Startup rectangle report

The reported upper-left black rectangle has not yet been reproduced. Cold
Chrome reloads at DPR 1 and 2 and an independent WebKit DPR 2 startup were
captured. Instrumented Chrome default-framebuffer draws all used the complete
canvas viewport with scissoring disabled; no unexpected default-buffer clear
was recorded. WebKit reported no page errors. These checks do not disprove
an artifact in the user's embedded browser. Direct inspection of that browser
was unavailable because its installed browser plugin referenced a missing
service file. A separate, reproducible resize defect was found: changing the canvas dimensions
cleared the visible buffer, while both playback and paused redraw paths could
wait for a later frame. The explorer now redraws synchronously after a size
change. A browser regression fixture failed before this change and passed afterward:
four resizes across playing and paused modes, zero unpainted buffers when
returning to the browser. The final source check and build passed, together
with 31 runtime tests. This removes a confirmed blank-frame window;
it does not yet prove that the reported quarter-screen artifact is the same bug.

Firefox on the same UHD 630 lab also matched every decoded byte. Medians were
408.0 ms (TIFF/new), 364.0 ms (TIFF/pool), 30.0 ms (prepared/new), and 24.5 ms
(prepared/pool), 18 samples per mode. The benchmark runs in the page realm;
Firefox's WebDriver cross-realm byte-array accesses made the earlier harness
unusably slow. That interrupted harness run is excluded. Inputs and workers
are the same six fixtures as Chrome; no GPU scene runs during this CPU test.

Firefox's adaptive motion check measured 15.58 FPS / 123 ms p95 for the
control and 15.08 FPS / 125 ms for prepared DEM plus pool. Settling was
35.97 / 35.50 seconds; maximum frame gaps were 479 / 351 ms. This single
pair does not establish an FPS or tail-latency improvement. Both completed
with no GL/shader errors or asset failures, ending with seven/eight resident
fine terrain cells. Completed decode wall-time sums fell from 15.94 to 1.90
seconds. The remaining frame cost is not explained by TIFF decoding alone.
CT 106 was verified stopped after this run.

Chrome candidate comparisons and M2 matched frames predate the synchronous
resize fix. Firefox motion and the final browser regression suite include it.
Each comparison uses one common renderer version for both variants.

The final complete browser suite passed after the resize fix, including its
new regression fixture, context restoration, fallback assets, rendered motion,
optics, flight, touch and calendar behavior. Raw results and source hashes are
retained in `evidence/streaming-candidates-2026-10-11.json`; its sibling patch
captures the tested source and tooling against the recorded base commit.
