# Windows startup and lost passive cadence

Baseline production revision: `55bccab9987eea7a503cee840d211ca9b598d9bd`.
Asset release: `76add0714c798c49`.

## User-device evidence

Reports exported from Opera 137 / Chromium 153 and Chrome 155 on the same
Windows RTX 2080, ANGLE D3D11, 12 logical cores, approximately 144 Hz:

| Metric | Opera | Chrome |
| --- | ---: | ---: |
| HTML response end | 444.1 ms | 153.9 ms |
| Shader preparation | 47172.0 ms | 46275.8 ms |
| Main-thread first-render stall | 26081 ms | 28679 ms |
| First submitted frame since navigation | 74552.4 ms | 75459.2 ms |
| Settled day / night submissions | about 24 / 21 FPS | about 24 / 21 FPS |

These runs do not reproduce the previous Opera pre-recorder navigation delay.
Both stall inside the first render after shader readiness. This is not evidence
that texture downloads took 75 seconds. Queue-block counters do not increase
in the night test: the earlier GPU-fence hypothesis is not supported by these
reports. No claim about audible fan noise can be derived from these counters.

## Research and its limits

- [ANGLE dynamic compilation](https://chromium.googlesource.com/angle/angle/+/0099562106d4c58995701156a6f528dc8174558c/doc/DynamicShaderCompilation.md)
  documents draw-time HLSL specialization, including render-target layouts.
- [KHR_parallel_shader_compile](https://registry.khronos.org/webgl/extensions/KHR_parallel_shader_compile/)
  provides a nonblocking completion query. Our batch already follows the
  recommended compile-all, link-all, poll-completion pattern. It cannot promise
  that a driver will have no work left at the first draw.
- [Chromium issue 366375489](https://issues.chromium.org/issues/366375489)
  records a Windows first-draw recompilation stall with large nested shader
  loops and a gradient/unrolling error. This is a relevant failure mechanism,
  **not proof that Earthlight encounters that exact bug**.
- [Microsoft's HLSL loop documentation](https://learn.microsoft.com/en-us/windows/win32/direct3dhlsl/dx-graphics-hlsl-for)
  describes loop simulation/unrolling and compile-time tradeoffs. HLSL loop
  attributes are not a portable WebGL application control.

The shader candidate reads the one-level noise table and cloud-lighting atlas
at explicit LOD zero when supported. They already use non-mipmapped NEAREST
and LINEAR filters respectively. Coordinates, texture data, integration steps,
resolution and lighting remain the same. WebGL1 without explicit LOD retains
its prior sampling. This removes unnecessary implicit gradients in divergent
cloud loops, but is **not yet a demonstrated Windows startup optimization**.

## Passive frame clock

The clock previously cleared every accumulated refresh after a draw. When a
callback arrived one refresh late, it moved all subsequent deadlines. A fixed
144 Hz timeline dropping the sixth callback in each seven-refresh group
reproduces 206 submitted frames in ten seconds despite the reported target
remaining 24 FPS. The corrected clock retains at most two refreshes of passive
lateness, always less than a full frame interval. It delivers 240 frames in
that reproduction and cannot submit a second frame at the same timestamp.
Long stalls reset phase, and fast adaptive gestures retain their previous
behavior. This proves the scheduling defect, not the precise missing-callback
sequence of the user's Windows browser: reports contain interval aggregates.

## Startup instrumentation

Diagnostic reports now record each program's observed completion time relative
to batch linking, plus CPU spans of the first render: catalog, aurora, camera
target, resources/lighting, source attenuation, world, temporal cloud, temporal
resolve, volume composite and camera finish. No extra GL status queries,
finish(), uploads or network reporting are added. CPU spans can include waits
for previously submitted GPU work; completion observations are not isolated
compiler CPU times, and completion is not itself link success.

`scripts/profile-linux-startup.py` adds an external GL-call probe to ordinary
GUI Chrome in the existing hardware lab. It records source/program identity,
first draw calls, slow submission calls and fresh-profile versus reload
behavior without inserting GPU waits. Fresh profiles do not erase OS/driver
caches. Run it via the Proxmox browser-lab wrapper, which stops CT106 on exit.

## Measurements

Intel UHD 630 / Mesa 25.2.8 / Chrome 155, ordinary Wayland browser, 2 CPUs,
8 GiB limit, CSS 1536 x 738 at DPR 1.25. No Plex transcoder active.
Noise-table-only candidate, baseline/candidate/baseline with a new profile for
each, then one reload in that profile:

| Version | Fresh first frame | Reload first frame |
| --- | ---: | ---: |
| Baseline A | 19147.7 ms | 8376.6 ms |
| Explicit noise LOD | 19133.6 ms | 8340.8 ms |
| Baseline B | 19231.9 ms | 8405.1 ms |

There is no meaningful startup gain on this backend and no 26-second first
render block. Linux cannot validate the Windows D3D11 path. Raw startup probe:
`/tmp/earthlight-explicit-lod-startup`; fixed-work visual/GPU comparison:
`/tmp/earthlight-explicit-lod-gpu`. Sanitized numerical evidence is saved beside
this note; source files and original browser recordings remain in the raw
artifacts. The remaining Windows question is which first-render span blocks,
and whether explicit one-level sampling changes cold compilation and first
draw on D3D11. Do not report this as fixed from Linux results alone.

The complete explicit-LOD candidate (noise plus lighting atlas) also passed
fixed-work A/B/A comparisons at 1248 x 615, paused, WebGL2, manual exposure,
zero grain and coarse terrain. Twelve GPU samples after four warm-up draws:

| View | Baseline A | Candidate | Baseline B |
| --- | ---: | ---: | ---: |
| Clouds, t=3235.65, pitch=-25 | 117.67 ms | 117.39 ms | 117.65 ms |
| Day, t=4500 | 37.70 ms | 38.05 ms | 38.10 ms |
| Night, t=1000 | 47.42 ms | 50.56 ms | 50.40 ms |

Day and night screenshots were byte-identical to baseline A. Cloud mean byte
error was 0.000430/255, below repeated-baseline error 0.000496/255; maximum
channel difference was 3 in both. No meaningful GPU improvement is established;
night baseline drift prevents attributing its difference to the candidate.

**Decision:** keep this shader experiment only as
`evidence/explicit-lod-candidate-2026-10-25.patch`, based on `55bccab`. Restore
production shader sources unchanged. Without Windows benefit evidence, making
all users pay a new shader-cache miss is not warranted. The implementation
retains the passive-clock correction and opt-in startup instrumentation.
The full scene/browser suite and diagnostic-download suite passed on the
experimental tree; final-tree source and browser checks are recorded below.

Final implementation, normal animated night playback (diagnostics disabled),
45 seconds each, same 1536 x 738 CSS viewport / DPR 1.25, adaptive quality,
`t=1000`, pitch 0, fixed October 6 epoch: baseline 34.511 FPS, candidate
34.422 FPS; interval p95 50.7 / 50.8 ms, maximum 211.9 / 186.5 ms. Both end at
864 x 415 pixels. This is unchanged throughput on the virtual Linux output,
not evidence of Windows 144 Hz improvement. First submitted frames were
19.211 / 19.117 seconds. CT106 stopped cleanly, with no OOM or pressure events.

Final source checks: 408 tests pass, zero failures; Astro zero errors/warnings;
build passes. The final diagnostic browser suite verifies real JSON downloads,
program timings, first-render spans, all guided phases, ordinary-visit isolation
and playback restoration. Shader-source hashes remain identical to baseline.
The final `verify:scene` suite also passed, including rendered frames, fallback
paths, optical fixtures, flight/touch controls and calendar restoration.
