# Orbital release validation — 2026-10-10

Historical report for commit `3d7f406` (client `BC9j4Ypf`). The defaults and
acceptance status below describe that release only. For the current renderer,
see [the performance and acceptance record](orbital-performance-targets.md).

The release combines the half-resolution cloud prototype with asynchronous shader
startup, optional native WebGL2, an optional 2048-wide galaxy overview and an
essential-preview network priority fix. The default remains Reference on WebGL1;
experimental choices use `render=clouds-half`, `api=webgl2` and `texture=compact`.
The comparison menu shows current candidates and controls. Archived profile URLs
still reproduce their original experiments.

## Build and scope

The release was assembled in an isolated checkout from the original renderer
snapshot plus the scoped changes. Concurrent camera-control and HUD work was
excluded. Node 24.19.0: `npm run verify` passed 115 tests, Astro checking and the
build. A test-only unused-parameter cleanup was followed by an Astro check with
zero errors, warnings and hints. The deployment dry-run also passed with 11,881
static files and the expected `ASSETS` binding.

Measured release client: `OrbitalSky.astro_astro_type_script_index_0_lang.BC9j4Ypf.js`,
SHA-256 `492d8f759084426d16e3cf3dc6ef94f68c77e82ab7e2a8ed9b0b6f9154182932`.

## Startup and loading

Both WebGL1 and WebGL2 startup suites passed on M2 Max Chromium: batched submission,
pending-compilation poster, no early blocking status queries or asset setup,
missing-extension fallback, cancellation, actual compilation failure, loss before
the first asset request, successful restoration and failed restoration diagnostics.
See [WebGL1 evidence](evidence/orbital-shader-startup-webgl1-2026-10-10.json) and
[WebGL2 evidence](evidence/orbital-shader-startup-webgl2-2026-10-10.json). The WebGL2
suite was repeated on the final isolated bundle after the preview priority fix;
it passed. The [URL verifier](evidence/orbital-url-results-2026-10-10.json) also passed all
four live-calendar/replay/exposure cases on that same build.

The general browser suite exposed a separate loading defect: four optional
manifest requests could occupy every network slot before the previews were
submitted. A queued preview could then exhaust its five-second fetch timeout
without ever starting a request. Optional network jobs now wait for essential
previews, and each request timeout starts when that request leaves the queue.
Four regression tests cover ordering, queue waiting, disposal and active timeouts.
With optional detail artificially delayed, all six previews arrived first,
no assets failed, and focus became sharp at 7.426 seconds while detail was still
pending. This injected case is not a cold-4G benchmark.

## General browser coverage

All numerical GPU fixtures, seven reference views, asset-failure fallbacks,
context restoration during uploads, mobile resize, viewport overview promotion,
playback, limited WebGL capabilities, Save-Data, slow-detail focus, both defocus
target formats, camera drag, keyboard, flight, touch and calendar checks passed
on the isolated release build.

Coverage completed across the initial run and a continuation from Save-Data.
The initial run stopped because resource timing entries for two requests from
the disposed scene arrived after the fixture cleared its timing buffer. The
fixture now counts only requests whose start time belongs to the new scene;
a fetch-level diagnostic independently confirmed exactly six preview requests.
No production Save-Data behavior or assertion threshold was relaxed. See the
[coverage record](evidence/orbital-browser-coverage-2026-10-10.json) and
[lifecycle results](evidence/orbital-browser-lifecycle-2026-10-10.json).

The profile pause test also needed an evidence-based settling condition. After
camera motion, fine terrain was still downloading seven seconds after pause and
exposure was still adapting during the old fixed eight-second wait. Those
updates legitimately drew frames. The test now waits for all five tile queues,
assets, focus and exposure to settle before testing idle rendering; see the
[diagnostic](evidence/orbital-profile-idle-2026-10-10.json). The corrected
[profile suite](evidence/orbital-profile-results-2026-10-10.json) passed: 23.796 fps on this
Mac, then zero idle frames after 13.02 seconds of actual settling. All five
visible profiles preserved camera and settings. Compact restoration, 390-pixel
layout, archived links, Reference defaults and atmosphere-table failure/restore
also passed.

## Image and performance evidence

[The original cloud prototype](orbital-cloud-prototype.md) includes five image
pairs, eight motion frames, resize, context restoration, four fallback injections
and paired GPU measurements. M2 Max paired frame-time reductions were about 21%
(day), 12% (night) and 34% (cloud-heavy), relative to Compact. These measurements
belong to the earlier prototype snapshot, not the final release bundle.

[The WebGL2 comparison](../orbital-webgl2.md) covers five API pairs, odd-size resize
and restoration. Night was identical. Other pairs differed in at most 64 of
1,728,000 RGB samples, each by one 8-bit level. Overall it is not bit-identical,
and this evidence alone does not justify changing the default API.

[Texture comparisons](evidence/orbital-texture-results-2026-10-10.json) verified the
actual 4096/2048 uploads and requested assets in three matched views, plus a
503-injected fallback retaining the 1024 preview through context restoration.
An additional [boosted Milky Way view](evidence/orbital-texture-boosted-2026-10-10.json) made the trade-off visible: the smaller
overview softened regions outside resident detailed tiles; catalog stars and
aurora stayed aligned. Its mean channel difference was 0.188 levels, maximum 26;
3.71% of channels differed by more than one level. This supports an optional
memory trade-off, not promotion to the default.

Headless Chromium checks use native RAF with background/frame throttling disabled
to avoid a local headless scheduling stall. They establish rendering and lifecycle
behavior, not normal display cadence, device power use or thermal stability.

## Remaining acceptance

Physical Pixel, iPhone, MacBook Air and Windows checks remain open, including
24 fps at a buffer scale of at least 75% on phones. Cold-network N-second and
X-MB limits need product values; the draft is in
[the acceptance plan](orbital-performance-targets.md).

KTX2 and another atmospheric lookup table were not added: the asset/layout audit
and existing lookup coverage did not establish a useful next implementation.
See [the candidate decisions](orbital-architecture-candidates.md). The compact
galaxy overview remains optional because fine sky detail is measurably reduced.
