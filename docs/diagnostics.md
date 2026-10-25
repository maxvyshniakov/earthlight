# Downloadable diagnostics

Open the explorer with `?diagnostics=1` (or append `&diagnostics=1` to an
existing scene URL). No upload endpoint, analytics service or account is
required. The recorder starts in the HTML head before the scene module.
Ordinary visits do not install observers, diagnostic timers or the panel.

1. Wait for the scene, or download immediately if it never appears.
2. Choose **Run 60-second test**. The three 20-second views cover daylight,
   the surface and a turning night view. Date, positions and camera movement
   come from the fixed ISS snapshot. Rendering settings and adaptive quality
   remain active and are recorded; this is not a fixed-resolution GPU benchmark.
3. Explore freely. **It stuttered** adds a timestamp to correlate with the
   surrounding one-second windows. Interacting with the scene or hiding the
   tab cancels the guided test and restores the prior playback state.
4. Choose **Download report** and share the JSON file. **Stop recording** ends
   measurement but leaves downloading available.

Test the first visit and a reload separately. Do not label a first visit
"cold cache" without verifying that assumption. After reloading, **Previous
report** downloads the previous recording from this tab. A best-effort snapshot
is saved to sessionStorage every five seconds and on pagehide. Recovery copies
are marked `recoverySnapshot: true` and keep only the last 90 windows, 200 resources
and 100 events, plus milestones and problem marks, to bound synchronous storage
work. Explicit downloads retain the full bounded history. Unavailable
storage, a browser crash or a hard kill can lose this recovery copy.

## Reading the report

`schema: earthlight-diagnostics/v2` and `testProtocol: guided-v1-60s` identify
formats. Build revision, dirty-source flag, build time and immutable asset
version distinguish deliveries. A dirty build is not an exact commit artifact.

- `milestones`: recorder start, shader states, first-light resources, first
  submitted frame, settled assets and sharp focus. Times are relative to
  navigation, not to the start of the scene module.
- `windows`: one-second summaries of submitted frames, RAF intervals, CPU
  submission time, sparse GPU timings when available, viewport/buffer sizes,
  scale, phase, paused/hidden status, camera and tile diagnostics.
- `jobs`: network/decode queue wait and execution totals/maxima. Network work
  includes reading the body. Decode queue ownership includes upload lifetime,
  so its duration is not pure CPU decode time. Upload-submission time measures
  the synchronous callback, not GPU execution. Cancelled queued jobs are not
  completed-job samples.
- `resources`: Resource Timing entries with path-only names. Cross-origin
  timing/byte fields may be restricted. Zero transfer bytes alone do not prove
  a cache hit; browsers may hide these fields.
- `events`: problem marks, long frames/tasks, context losses, visibility and
  test phases. Exception kinds are retained without messages or URLs.

GPU timings are optional asynchronous measurements, not presentation latency.
Every 12th eligible animated frame is sampled. Samples alternate between the whole render and one rotating group:

| Group | Work covered |
| --- | --- |
| `sky` | Star catalogue, aurora and camera target setup |
| `resources-and-lighting` | Resource bindings/updates and cloud lighting bake |
| `source-attenuation` | Attenuation of the Sun, Moon and reflection sources |
| `world` | World pass and resolved Moon (inline profiles can include volumes here) |
| `volumes` | Temporal cloud rendering/reconstruction and atmosphere/cloud composition |
| `camera-finish` | Exposure, glare, lens effects and final image processing |

`gpuPassSamples` retains one group per sampled frame, with its submission
timestamp and buffer size. Results arrive asynchronously; associate
them with the phase at that timestamp, not the later delivery window. Do not
add medians from different frames or compare different buffer sizes as equal
work. Query boundaries can change GPU scheduling or include deferred work from
earlier draws; a group duration is not proof of that shader alone being slow.
Validate a suspected bottleneck with a controlled rendering change. Whole-frame
`gpuMs` summaries exclude the grouped samples. These are
render groups, not individual shader functions, and their boundaries depend
on the render profile. Unsupported paths may have near-zero group duration.

Queries share one owner, never nest, never wait for completion and hold at most
two sampled frames. Each frame has at most one query: multiple timing boundaries
proved costly on the local GPU. Disjoint results are discarded. Grouped samples do
not drive adaptive quality. With fixed quality or while loading/inspecting,
GPU samples may be absent even on supported devices. Do not substitute CPU
submission time for missing GPU measurements.

The window state now separates `qualityScale`, `viewScale`, `viewCoverage` and
`refreshPeriodMs`; `renderScale` still includes loading defocus. `buffer-resize`
events record old/new dimensions and the scale factors at the change. A lower
buffer scale alone cannot identify whether quality adaptation, view coverage or
loading caused it. The guided test's first phase cannot be overwritten by the
start button, even if a frame is submitted synchronously.

The recorder retains at most 900 windows, 500 events and 2,000 resource entries;
`dropped` reports overwritten entries. The last 50 problem marks are also kept
separately in `markers`, so long-frame events cannot evict them; `droppedMarkers`
counts older marks. Per-window samples are bounded as well. `gpuPassSamples` retains at most 600
frames; `droppedGpuPassSamples` counts overwritten samples. Recovery copies
retain only the last 60 grouped samples.
The report contains technical device/rendering data and an allowlist of scene
settings, not cookies, arbitrary query parameters, URL fragments or user actions
as text. Nothing is transmitted by the diagnostic feature.

Compare matched versions, guided phases, buffer sizes and quality histories.
A steady FPS with a collapsing render scale is not a performance success.
Exclude hidden intervals and intentional pauses from smoothness conclusions.
The recorder itself adds sparse queries, observers and local snapshots: compare
with an ordinary visit if a marginal performance difference matters.

Validation: `bun test scripts/diagnostics.test.mjs`, `bun run verify`, and
`bun run verify:scene <base-url> <output-directory>`. `bun scripts/verify-diagnostics-browser.mjs <base-url> <output-directory>`
checks actual downloads, early module failure, recovery, the complete guided test
and mobile panel layout.
