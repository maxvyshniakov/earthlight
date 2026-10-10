# Orbital scene optimization — 7 October 2026

This pass preserves the accepted image-control baseline and 96 cloud-march
samples. It changes loading, texture residency and ownership before reducing
render quality. It does not claim a calibrated physical camera.

## Initial optimization measurements

Chromium / ANGLE Metal on Apple M2 Max; desktop 1440 × 966, DPR 1, adaptation
disabled for comparisons. Mobile means a 390 × 844 viewport on the same machine,
not measurements on a phone. Network figures sum response-body sizes for scene
resources, excluding page HTML, application JS, fonts and portrait. They include
initial overviews, manifests and the visible detail tiles, not an entire orbit.

| Measurement | Before | After |
| --- | ---: | ---: |
| Desktop scene transfer, representative loaded frame | about 26.2 MB | 14.3 MB night / 14.8 MB day |
| Nominal GPU texture storage, desktop | 675.9 MiB | 455.1 MiB night / 515.0 MiB day |
| Mobile scene transfer | about 6.6 MB | 5.65 MB day |
| Nominal GPU texture storage, mobile day | — | 169.4 MiB |
| Open decoded ImageBitmaps after settling | full maps retained | 0 |
| Retained compressed global inputs, desktop | — | 13.45 MB |
| Retained compressed global inputs, mobile | — | 5.11 MB |

Night frame: `t=0`; day frame: `t=2488.10`. Nominal texture storage is the sum of
requested dimensions, channels, element widths and mip levels observed at the
WebGL API. Driver padding, internal conversion, browser buffers and transient
allocations are **not** included; this is not a VRAM/process-memory measurement.
Peak simultaneously open bitmap storage in these samples was nominally 128 MiB
desktop / 32 MiB mobile, then zero. Decoded DEM arrays are also no longer retained.

There are three screen-sized rendering passes (catalog, scene, camera finish)
and, where supported, a five-pixel source-transmission pass. Rendering remains
capped at 24 FPS. Short playback checks reached roughly 24 FPS on the test
machine; these are correctness/smoke checks, not a low-end performance guarantee.
A separate 12-second daytime GPU probe of the accepted tiled renderer reported
26.1 ms median / 32.2 ms p90 at full resolution. The old global-map renderer
measured about 18.2 / 28.4 ms in a short baseline probe. These are indicative
single-machine samples, not an isolated benchmark: other browser activity can
interfere. Tiling reduces network/working-set cost but adds shader lookups; this
pass should not be described as a universal GPU speedup. Expensive intermediate
tile implementations were rejected or revised before retaining this version.

## Loading and ownership

1. A 5.1 KiB WebP renderer capture provides a static fallback.
2. Four tiny map previews total about 119 KiB. The compact star catalog and PSF
   load alongside them. The live canvas appears with 6 CSS pixels of defocus.
3. Global refinements and visible tile caches share four network slots, two
   decode slots and one upload budget (`scene-work.ts`). Decode slots cover the
   complete decoded-input lifetime through upload. Preview work comes first,
   followed by visible tiles and overview refinements. Waiting work ages to
   prevent starvation. Each upload turn submits at most four jobs / 3 ms, then
   yields for 16 ms. Large individual driver allocations are not preemptible.
4. After detail has settled, focus eases to sharp over 1.3 seconds. A six-second
   waiting deadline prevents slow optional maps from leaving permanent blur.
   Failed refinements preserve working previews. Reduced motion skips defocus.

Focus runs in a temporary optical prepass, not a CSS canvas filter.
Forty-eight fixed area samples approximate a rounded six-blade aperture with
a maximum radius of 6 CSS pixels, averaging linear light. Half-float scene
targets now store linear values, so hardware interpolation also preserves
highlight energy. RGBA8 retains encoded storage and decodes four texels before
manual bilinear interpolation. The distant
Earth and sky share this focus distance. Lens ghosts are added afterward with
small per-path changes in radius and edge softness; sensor noise is last and
stays crisp. This is a photographic focus-pull approximation, not ray tracing
of a measured lens. One 48-sample convolution supplies all three chromatic channels instead of
repeating it per channel. The temporary target uses the current scene resolution
and is freed when focus settles; sharp rendering has no defocus pass or target.
Loading-only work is excluded from settled-scene adaptive-quality samples. Paused replay still completes the
focus pull without advancing orbital time.

Before this prepass change, a warmed Pixel 9 Pro XL comparison measured 23.97 FPS sharp, 22.63 FPS
with a forced 6-pixel focus radius, then 24.00 FPS sharp again (4.5 s each).
Adaptive resolution changed from 100% to 90% during that forced-uniform probe;
it is not a fixed-resolution GPU benchmark. Normal loading defocus is excluded
from adaptive-quality sampling. This is a local night-scene measurement;
startup uploads still caused slower frames in a separate loading sample.

The browser suite renders an isolated 8 × 8 bright fixture through the actual
optical prepass. It checks spreading, integrated linear energy within 8% and
sensor grain after blur, with both half-float and RGBE targets. These are GPU
readback checks, not a calibration against a particular physical lens.

Decoded bitmaps close immediately after upload. Numeric DEM mip arrays become
collectible after upload. Context restoration reconstructs GPU resources from
compressed inputs, one global layer at a time. A corrupt late refinement cannot
discard the last working preview. Component disposal aborts pending requests and
releases GPU resources. Save-Data suppresses full maps **and** detail tiles.

Ownership is explicit:

- `orbital-sky.ts`: input state, replay clock, scrolling and reveal.
- `scene-panels.ts`: popover placement, dragging and event lifecycle.
- `scene-work.ts`: shared network, decode and upload scheduling.
- `orbit-renderer.ts`: GPU resources, passes and capability selection.
- `orbital-shader.ts`: scene shader assembly.
- `scene-assets.ts`: progressive fetch/cache/restore and focus policy.
- `night-tiles.ts`: shared bounded day/night/cloud tile residency.
- `scene-quality.ts`: sparse asynchronous GPU measurements and hysteresis.
- `camera-defocus.ts`: temporary pupil convolution in linear light.
- `camera-finish.ts` / `sensor-noise.ts`: camera response and sensor sampling.

## Full-detail texture decisions

| Layer | Runtime choice | Decision |
| --- | --- | --- |
| Milky Way | AVIF Q50, 4K | Retain the diffuse band and separate catalog stars; save 128 MiB nominal mipmapped RGBA storage versus 8K. |
| Day surface | AVIF Q60 2K/4K overview + Q50 geographic tiles | Preserve fine coastline/terrain tiles; no second lossy encode. Overview: 122,426 / 405,435 bytes. |
| Night lights | Scalar AVIF Q65 overview + existing Q80 sparse tiles | Keep isolated emission and bright fine lights. 8K overview: 334,722 bytes. |
| Clouds | Scalar AVIF Q65 16K-equivalent tiles + 4K overview | Stream detail instead of retaining a full 16K GPU map. |
| Terrain | Lossless DEM2, 8K / 4K | Byte-plane horizontal prediction before gzip; every decoded byte is unchanged. |

### Connected-phone overview comparison

On Pixel 9 Pro XL, 2K candidates were generated directly from the same original
NASA plates, at AVIF Q60 for day color and Q65 for cloud/night scalar maps.
The comparison used paused identical orbital times, fixed render resolution,
zero sensor grain and fully loaded tiles. Phone screenshot dimensions were
1344 × 2793, with a 593 × 1232 scene buffer.

| Overview | 4K file | 2K candidate | Decision |
| --- | ---: | ---: | --- |
| Day color | 405,435 B | 122,426 B | Accept for render targets up to 1280 px on the longer edge, with detail tiles available. |
| Night emission | 107,045 B | 33,536 B | Reject: nonresident cities become larger blurred patches. Keep 4K. |
| Cloud coverage | 792,817 B | 312,732 B | Reject: changes cloud shape and shading through the coarse density/shadow samples. Keep 4K. |

Frames covered `t=0, 1950, 2488.10, 3000, 3882.78, 4156.13, 4594.06`.
In the 1344 × 700 ground crop at `t=3000`, day-only reduction had a mean absolute
RGB channel difference of 0.27/255; 0.13% of channels differed by more than 5/255.
At `t=2488.10`, the mean was 0.046/255 and the maximum was 5/255. These support
the visual comparisons, not a claim of pixel identity. Night/cloud changes were
visible despite relatively low whole-crop average errors.

Day-only reduction saves 32 MiB of nominal mipmapped GPU texture storage and
283,009 download bytes. The connected-phone day sample at `t=3000` changed from
175.5 to 143.5 MiB, and 5.73 to 5.45 MB transferred. Actual driver memory is not
measured. Galaxy, terrain and all detail tiles keep their existing resolution.

Tier selection uses capped render-buffer dimensions, not CSS width or the
phone's native DPR alone. Surface tile selection already uses the projected
ground footprint. Expanding a compact render target beyond 1408 px promotes
the day overview to 4K once, retaining 2K until the upload succeeds. Shrinking
or adaptive scaling does not churn downloads, and upgrade failure retains the
working overview. The small/large margin prevents boundary oscillation.

Rebuild with `node scripts/build-mobile-overviews.mjs /path/to/originals`.
Only the accepted day map is written under `public/media/orbit/mobile/`;
rejected candidates go to `/tmp/orbit-mobile-candidates` (optional second path).

The former full 16K cloud map costs 8,393,584 transfer bytes and 170.7 MiB of
nominal scalar GPU storage with mips. A plain 8K replacement was inspected and
rejected because small cumulus clouds disappeared. The replacement keeps the
16K coverage field but divides it into 512-square interiors with 16-pixel
neighbor gutters and isolated mip levels. At the day sample, 19 tiles cost
675,553 bytes, plus the 792,817-byte overview. The desktop cloud atlas is 18.1 MiB;
mobile is 4.5 MiB. Its entire 512-tile library is about 13.5 MB on disk and is
never loaded wholesale. Day/night/cloud caches hold at most 31 tiles each on
desktop or seven each on mobile.

Cloud tile fades and their minimum neighbor fade share one byte (two four-bit
values). A 650 ms fade spans about sixteen animation frames, so this avoids four
neighbor texture reads in each cloud-density lookup without adding a texture.
A native-mipmap atlas was also tested and discarded: its extra padding/storage
did not produce a useful GPU timing improvement in this scene.

Inactive atlases start as one texel; during rendering they return to that state
after two seconds without visible demand. Active atlas page tables upload only
when residency or fade values change.

Terrain 8K: **13,626,978 → 8,427,008 bytes (−38.2%)**.
Terrain 4K: **3,952,126 → 2,540,298 bytes (−35.7%)**.
There is no quantization change, geographic resampling or loss of height detail.
DEM1 assets remain as regression references; the browser requests DEM2.

## Codec experiment

`node scripts/benchmark-scene-maps.mjs /tmp/orbital-reference /tmp/orbit-optimization`
reconstructs lossless references from original NASA plates and tests three
768-square regions of each map. This measures relevant regional detail, not
whole-image compression ratios. Mean results:

| Input | Codec | Mean bytes | PSNR dB | Vertical edge error ↓ |
| --- | --- | ---: | ---: | ---: |
| Clouds | AVIF 50 | 22,173 | 24.98 | 2.23 |
| Clouds | AVIF 60 | 32,890 | 26.76 | 1.76 |
| Clouds | AVIF 65 | 37,241 | 27.38 | 1.60 |
| Clouds | WebP 85 | 54,269 | 27.63 | 1.39 |
| Clouds | WebP 95 | 89,749 | 31.37 | 0.72 |
| Clouds | PNG | 276,343 | lossless | 0 |
| Land | AVIF 50 | 45,887 | 33.70 | 4.38 |
| Land | AVIF 60 | 70,502 | 36.07 | 3.51 |
| Land | AVIF 65 | 80,056 | 36.90 | 3.24 |
| Land | WebP 85 | 105,659 | 37.21 | 2.95 |
| Land | WebP 95 | 205,273 | 40.97 | 1.88 |
| Land | PNG | 1,153,965 | lossless | 0 |

Edge error is mean absolute error of vertical first differences in 8-bit channel
values. It complements pixel error but is not a perceptual sharpness score.
AVIF 65 is a useful cloud compromise here; the renderer comparison matters more
than a single metric. Cloud tiles use effort 5; benchmark AVIF crops use effort 6.
No palette reduction is applied to RGB color maps; clouds/lights already carry
scalar data. Previous high-resolution day/night experiments remain documented
in `earth-surface-rendering.md` and the asset README.

## Rendering work

- Dark Poisson sensor noise uses a generated 1024-square inverse-CDF table,
  replacing up to 48 inversion iterations per channel per pixel. Statistical
  tests bound its mean/variance error; the CSS-pixel grain grid is unchanged.
- Cloud lookups switch back to the 4K overview once their integration/pixel
  footprint spans four 16K texels. This avoids repeated atlas/page-table reads
  for coarse density samples; detailed nearby samples keep tiles. Broad cloud
  depth and distant shadow integration use the overview, while the first local
  self-shadow sample retains detail. This is a lighting approximation; coverage
  and the visible 96-step cloud boundary keep their original resolution.
- Empty cloud samples skip procedural density detail; fully unlit samples avoid
  sunlight-shadow integration. Unresolved noise octaves return their existing
  filtered mean without evaluating lattice noise. Samples outside the vertical
  profile skip erosion. The 96 view samples and four shadow samples are unchanged.
- Cloud/atmosphere/airglow composition stays in linear light between layers.
  The accepted photographic grade remains at the output boundary.
- A 5 × 1 prepass attenuates lunar, solar and bright-point lens ghosts by clouds
  and air along the source ray. It does not ray-trace a real lens prescription.
- GPU queries initially sample one in three frames; six valid measurements give
  the first decision in roughly one second at 24 FPS. Steady-state sampling uses
  one in twelve frames and twelve samples, asynchronously, with at most two
  pending queries. Cooldowns prevent oscillation.
  Scale reduces in 10% steps to 60% when cost exceeds 34 ms, recovers in 5% steps
  below 17 ms. Texture detail and cloud march steps are preserved.
- Browsers without GPU timer queries use 24 animated frame intervals instead.
  A 90th-percentile interval above 58 ms reduces scale by 10%, with a five-second
  cooldown and the same 60% floor. Pauses and background time are excluded.
  This fallback only reduces scale: presentation cadence cannot establish GPU
  headroom for recovery. `?quality=fixed` disables both controllers.

## Mobile browser toolbars

The fixed background uses `100lvh`, with a hidden `100svh` reference for opening
composition and scroll distance. Browser bars reveal more of the same rendered
surface. They do not change camera aspect or resize the GPU targets. The initial
horizon stays at 78% of the small viewport; Earth leaves the complete background
after scrolling 75% of that small viewport. Rotation and desktop window resizing
still update both dimensions. Redundant resize notifications do not clear the
canvas, and animated resize draws stay within the 24 FPS scheduler.

This follows the [stable small/large viewport definitions](https://web.dev/blog/viewport-units).
The prior `position: fixed; height: 100%` surface changed size with browser bars.
On a connected Pixel 9 Pro XL (Chrome 154), a swipe changed it from 395 × 741 to
395 × 821 CSS pixels and reallocated both full-frame render targets. With stable
viewport sizing, three swipe pairs produced 30 visual-viewport resize events,
one initial canvas size observation, and zero GPU allocations in the day test.
The surface includes the toolbar-covered area, so it costs about 11% more pixels
than the old collapsed canvas on this phone.

The same phone also passed landscape → portrait rotation (821 × 371 and
395 × 821 CSS-pixel surfaces) and forced WebGL context loss/restoration, with
zero WebGL errors. Its system rotation setting was restored after the check.

At `t=2488.10`, three up/down swipe pairs with fixed full resolution averaged
15.9 submitted scene frames/s (95th-percentile interval 145 ms, maximum 234 ms).
After the cadence controller warmed up, seeking back to the same orbital time
and repeating the gestures averaged 23.8 frames/s at 70% linear render scale
(95th percentile 58 ms, maximum 67 ms). All 66 visual-viewport resize events
left the canvas and GPU allocations unchanged. This is one connected-device
run, not a cross-device performance guarantee; it counts scene submissions,
not hardware presentation timestamps. Texture resolution is unchanged.

## Verification and remaining limits

Run `npm run verify` for unit tests, Astro diagnostics and build. Run
`npm run verify:scene -- http://127.0.0.1:4322 /tmp/orbit-browser-proof`
against the built site for seven scene frames, failed assets, context restore,
mobile playback after seeking, viewport rotation, Save-Data and delayed-detail focus. The browser
suite writes screenshots/results to the requested directory and closes its own
isolated session.

Remaining costs include the 8K numeric terrain and visible detail atlases, which
still occupy large GPU textures. GPU-native block compression or terrain paging needs
its own visual/data-error experiment; AVIF reduces transfer, not GPU storage.
No such conversion is silently substituted here. Tile traffic accumulates over
a long orbit, even though residency stays bounded. Cloud height/density remains
an illustrative reconstruction of a coverage photograph. The connected Pixel's
Chrome does not expose GPU timer queries; it uses the cadence fallback. Real
iPhone/Safari and lower-end Android profiling remains necessary before claiming
those performance budgets. P3 matrix behavior is tested, but screenshot measurements here used the
sRGB path of the isolated browser.

The 24 FPS cap is retained after comparing uncapped scrolling. Telemetry is
always white, so the synchronous background-color GPU readback has been removed.

During loading, render dimensions use 60% scale above 3 CSS px defocus and 80%
above 1 px; full resolution returns before focus settles. These two target
upgrades are independent of sustained GPU quality and do not lower settled
texture detail. This avoids paying full-resolution optical convolution cost
while the preview is deliberately blurred.

Large overview refinements upload into replacement textures in 256-row strips,
yielding between strips and swapping only after mipmaps are complete. Context
loss or disposal cancels the replacement without exposing partial data. Terrain
decompression and predictive decoding run in a dedicated worker with transferred
level buffers; workers terminate on completion, failure, or renderer release.

A local 1440×1000 loading comparison with the 24 FPS cap measured roughly
57 ms average frame intervals before these changes and 43 ms afterward;
settled intervals remained about 42 ms. Individual loading stalls remain
possible (the improved sample peaked at 122 ms), so this is not a guarantee
of uninterrupted 24 FPS on every device or a cold network.


## Follow-up across loading, memory and render work

The 4K diffuse Milky Way replaces the desktop 8K runtime map; the point-star
catalog is unchanged. On the same 1440 × 966, DPR 1, fixed-quality frame at
`t=4532.69`, nominal settled texture storage changed from 455.49 to 327.49 MiB.
The new loading-only blur target raised the transient peak to 338.10 MiB and
was released at sharp focus. Retained compressed inputs changed from
13,846,773 to 11,618,422 bytes. These are API allocation/response sizes, not
measurements of driver VRAM or process RSS.

With grain disabled, the 390 × 580 sky crop differed by 0.047/255 per channel on
average (maximum 3/255). At `t=2488.10`, a 990 × 216 ground crop differed by less
than 0.00004/255 on average (maximum 1/255), after skipping unresolved cloud
noise and zero-profile erosion. The unchanged 96-step integration, shadow
samples and footprint filters preserve the existing motion sampling.

A 12-second local reload probe on the fixed night/twilight frame reduced the
loading interval p95 from 74.1 to 61.3 ms and maximum from 125.3 to 75.1 ms.
Mean loading intervals changed only from 57.8 to 54.5 ms; this paused fixture's
exposure/focus invalidations are not a playback-FPS measurement. A single driver
allocation still reached 32 ms, so the upload queue's 3 ms target cannot promise
a strict frame budget. The scene playback test separately reached 23.82 FPS.

Repeated whole-frame GPU probes of the daytime scene overlapped substantially
(roughly 25–39 ms medians), so no settled GPU/FPS speedup is claimed. The clear
wins are lower memory, fewer repeated blur samples and bounded shared work.
The new pass has not been remeasured on the physical phone. Browser checks cover
both HDR storage paths, Save-Data, failed/slow assets, context loss during queued
uploads and after settling, rotation, and desktop/touch popover dragging.
