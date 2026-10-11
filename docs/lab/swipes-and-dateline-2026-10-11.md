# Fast flight and the two date-line seams

Baseline: Earthlight `c9a826b480c17b3b885e891ab035bf761433bf65`.
The reported links were reproduced locally, including the phone's cloud cut.
The earlier tile-residency fix did not fix either of these separate artifacts.

## Image causes and changes

The night overview sampled longitude with implicit derivatives. Across atan's
branch cut at ±180°, adjacent pixels appeared to span an entire map. The GPU
selected a coarse mip containing distant cities, drawing a bright dotted line
across an otherwise dark ocean. Night emission now uses the albedo sampler's
wrapped longitude derivatives, including its older-driver fallback.

The southern cloud photograph also has a real discontinuity between its east
and west edges. At the reported cut, ground rays mapped to approximately
180° longitude, 66–70° south. Disabling cloud tiles, cached lighting, terrain,
and the compact pass did not remove it. The existing narrow photographic
join repair at Greenwich now also covers the date line, with the same latitude
and width limits. Coverage, shadows, and source transmission use the same
corrected map. The rest of the map retains its original sampling and detail.

The browser shader fixtures now exercise both cloud joins and the production
night sampler with/without explicit gradients. They complement actual scene
screenshots; a residency fixture alone cannot catch a photographic source join.

## Motion changes

- Flight interaction requests up to 60 FPS while passive playback stays at
  24 FPS. Already downscaled scenes use 30 FPS during interaction to avoid
  overfilling the GPU queue. Upscale probes wait for eight seconds without
  interaction; downward adaptation stays enabled. Actual delivery remains
  limited by the GPU. Paused gestures now use
  the same fractional frame deadlines as playback, avoiding a fresh full
  interval after every render.
- During fast camera travel/turns, optional network, decode and atlas writes
  wait until 500 ms after the last fast movement. Resident tiles and the
  complete overview remain visible; newly visited detail arrives after slowing
  down. Preview work is exempt, so a fresh page can still become usable.
- Large dormant atlases are neither allocated nor discarded during a swipe.
  Optional cloud-lighting baking waits too. This avoids restarting expensive
  work for geography already leaving the viewport.
- Once paused inspection reaches full resolution, texture notifications can
  refresh exposure without dropping back to the adaptive size. This closes
  a weak-GPU loop that repeatedly allocated and discarded galaxy tiles while
  the camera was stationary. A new gesture or playback still exits inspection.
- Surface selection stays on its 180 ms interval instead of bypassing it on
  every moving frame. A final paused pose is explicitly revisited. Motion
  release requests a draw and fresh selection even with no pending uploads.

This preserves settled texture resolution and terrain precision. During rapid
travel, new geography can retain its overview for longer; that is the intended
tradeoff. Atlas capacities and the decoded DEM cache ceiling are unchanged.

## Measurement conditions

The gesture uses the user's free-flight link and time-scaled synthetic DOM
trackpad wheel events through the actual controls. Frame timestamps count
final-canvas draw submissions, not compositor presentation or GPU elapsed time.
No readPixels, finish, or synchronous GPU waits occur inside the measured path.

Local pairs use an isolated Chromium session on Apple M2 Max, 1440×956, fixed
quality, grain disabled, with both autoplay and paused controls. Separate
baseline/candidate previews serve the same local immutable assets. Linux runs
use the existing GUI browser lab, Intel UHD 630, Chrome and Firefox, two CPU cores and an
8 GiB ceiling. Fixed and adaptive quality are reported separately.

Raising the input cap alone was insufficient: local throughput improved but
long-tail gaps worsened; the weak GPU still stalled. A 180 ms streaming hold
could expire during a slow frame and resume uploads mid-gesture. The retained
500 ms hold is measured separately below.

## Validation and results

Local fixed-quality results ([raw timing evidence](evidence/swipe-local-2026-10-11.json)):

| Mode | Baseline FPS | Candidate FPS | Baseline p95 gap | Candidate p95 gap |
|---|---:|---:|---:|---:|
| Autoplay, ABBA | 23.32 / 23.65 | 42.79 / 43.64 | 58.5 / 56.0 ms | 37.6 / 39.8 ms |
| Paused gesture | 19.57 | 42.19 | 59.0 ms | 39.9 ms |

All buffers were 1440×956 at scale 1.00. The candidate had no gaps over
100 ms; its longest gaps were 62.0, 53.9 and 61.1 ms respectively. These
numbers describe this particular stress gesture, not all views or devices.
The subsequent inspection fix changes paused settling, not the measured
moving render path. The isolated recovery fixture also verifies that a
paused swipe finishes with resumed streaming, zero pending terrain requests,
resident fine DEM, and no GL/asset failures.

Before/after scene captures:

- [Cloud cut before](evidence/cloud-date-line-before.png), [after](evidence/cloud-date-line-after.png).
- [Night line before](evidence/night-date-line-before.png), [after](evidence/night-date-line-after.png).

The local comparison page has sliders for both image pairs and links to the
live scene. The original physical phone was not used for these captures.

Source verification: 210 tests, Astro checking, and a production build.
The first Linux adaptive comparison exposed two additional problems. A paused
scene repeatedly switched inspection size while loading galaxy tiles; its
settlement timed out with 268 requests for unchanged geography. After fixing
that, allowing 60 FPS on an already downscaled Chrome scene also encouraged
an upscale from 0.45 to 0.50 during the swipe: throughput rose but the p95 gap
worsened. That version was not retained. The final policy holds off upscale
probes during interaction and uses 30 FPS on an already reduced buffer.

Full-resolution fixed-quality stress on UHD 630 remains GPU-bound (about
5–6 FPS in this fast globe-wide gesture). Deferring downloads does not make
that mode viable on this GPU. The shipped default uses adaptive quality.

Final adaptive Linux measurements:

| Browser | Baseline FPS | Candidate FPS | Baseline p95 / p99 | Candidate p95 / p99 |
|---|---:|---:|---:|---:|
| Chrome | 21.14 | 24.64 | 59.8 / 265.0 ms | 53.2 / 308.9 ms |
| Firefox | 17.94 | 21.65 | 102 / 266 ms | 81 / 226 ms |

Chrome retained the same 562×277 buffer at scale 0.45. Upload calls fell from
5,906 to 68 and observed long tasks from three to zero. However, gaps over
100 ms were 13 versus 14, and the longest gap grew from 297.6 to 597.1 ms.
This is a throughput improvement, not a claim that weak-GPU stutter is solved.
The remaining tail needs GPU/compositor investigation separately from streaming.
See [Chrome timing evidence](evidence/swipe-linux-chrome-2026-10-11.json).


The historical `verify:motion` profile-comparison threshold also fails on the
unchanged baseline, at the experimental `lighting` profile. Baseline temporal
mean / fraction over four are 0.68335 / 0.034981; candidate 0.68340 / 0.034979.
This is not a green gate and is retained as a known baseline failure. The
production `compact` profile is checked separately against that same baseline.

The same check restricted to production `compact` also has the same existing
failure: baseline 0.635265 / 0.02253946; candidate 0.635274 / 0.02253987.
These paired results do not indicate a new temporal regression, but the
historical cross-profile threshold is not satisfied by either version.

`bun run verify:scene` passes on the final build, including context loss,
resize, failure fallback, touch controls, both date-line shader fixtures,
paused gesture recovery and calendar restoration. `bun run verify` passes
all 210 tests, Astro checking and the production build. The six-preview upload
fixture also covers startup batches larger than one upload budget while detail
is held. Its final scheduling adjustment does not affect settled motion timing.

Firefox 157.0.1 retained its 553×298 buffer at scale 0.45. Gaps over 100 ms
fell from 18 to 12, although the longest gap was 440 ms versus 366 ms.
`about:support` confirmed Mesa Intel UHD 630; JavaScript's sanitized renderer
string alone was not used as hardware proof.
See [Firefox timing evidence](evidence/swipe-linux-firefox-2026-10-11.json).
An earlier attempt navigated during the local build's replacement of `dist`
and loaded no scene; that incomplete run is excluded. The completed repeat
used the stable final build. CT 106 was confirmed stopped after testing.
