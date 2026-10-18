# Night switch, 2026-10-17

The Night mode key (N, or the latched key under the exposure tape) reloaded the
page: `physical-night.ts` read `night=video|still` from the address once, at
import, and about twenty modules built shader strings and constants from it.
A reload meant seconds of dark space and every asset, tile and decoded map
fetched again. Night mode is now a value of the scene renderer, and N switches
it in place.

## Design

- **A mode, not a page setting.** `createSceneRenderer` reads the mode from
  its parameters (`readNightMode(params)`; the background passes none, so it
  stays in the default program). Every source and constant that depends on it
  is built from that value: `sceneShadersFor(mode)`, `temporalShadersFor`,
  `cameraModelShaderFor`, `opticalPsfSourceFor`, `cloudShaderFor`,
  `cityLightShaderFor`, `airglowLightShaderFor`, `galacticLightShaderFor`,
  `pointBrightnessShaderFor`, `cloudReconstructionShaderFor`,
  `moonFragmentSourceFor`, `preExposureShaderFor`, and `prepare(batch, mode)`
  on the catalog, camera finish, exposure, defocus, glare, Moon, cloud
  lighting and ocean passes. `perNightMode` builds each once per mode. JS
  constants became functions of the mode: `exposureMaxEV(mode)`,
  `preExposure(mode)`, `nightScale(emitter, mode)`, `lunarPhaseIrradiance`,
  `lunarDiskGain`, `stormLights` and the point photometry of lens ghosts.
  The old names (`fragmentSource`, `cloudShader`, `EXPOSURE_MAX_EV`, …) remain
  as the default program's values for fixtures and tests.
- **Byte identity.** `scripts/night-mode.test.mjs` builds all 39 program
  sources the renderer can compile (scene passes, temporal clouds, catalog,
  camera finish, exposure, defocus, glare, four Moon variants, cloud lighting,
  three ocean bakes) for each of the three modes and compares their SHA-256
  with `scripts/fixtures/night-mode-sources.json`, captured from ac56a17 with
  the mode read at import. All 117 match: the default program and both night
  programs compile exactly what they did before.
- **Background compile.** `switchNight(mode)` adds the next mode's programs to
  a `ShaderProgramBatch` (parallel compile where `KHR_parallel_shader_compile`
  exists) while the current programs keep drawing. A Moon already resolved
  gets its program in the same batch.
- **Hand-over.** Once linked, the next frame is still drawn in the old mode
  and reported as the hand-over; the explorer copies it into
  `.explorer-crossfade`, a 2D canvas over the scene, in the same task as the
  draw. The frame after that swaps: the scene, source, volume and resolve
  programs are replaced and their samplers, fixed values and the values the
  asset uploads had set (`mapsReady`, map widths, `terrainReady`,
  `modisReady`, …, kept in `sceneValues`/`passValues`) are set again. The
  catalog, camera finish, exposure, defocus, glare, cloud-lighting bake and
  Moon replace their programs in place. Nothing is reallocated: maps, tile
  caches, terrain, the star buffer, render targets, the glare pyramid and the
  exposure state all stay. Temporal cloud history is dropped, since it is
  pre-exposed with the old encoding.
- **Exposure.** The meter's range changes from −5.5…5.1 to −5.5…22.1 EV, and
  physical night divides night emitters by up to 2 × 10⁴. A one-texel pass
  (`CameraExposure.handOver`) re-encodes the state into the new range on the
  GPU, without a readback, shifted by log₂(`NIGHT_EXCESS.city`) × (1 −
  daylight), +14.3 EV at night towards physical night and −14.3 back, 0 in
  daylight, and clamped to the new range. The new meter then takes its
  target at once for three updates, as on a first frame, and adapts at its
  usual rate after. Since 2026-10-18 a switch into physical night first
  meters one update without moving and then takes four
  ([night meter](night-meter-2026-10-18.md)). The camera, scene time, compensation and manual exposure
  carry over; a manual EV above 5.1 clamps to the default program's ceiling.
- **Dissolve.** The crossfade holds until the meter has settled and six frames
  have kept their pace (a gap over 200 ms restarts the count; 4 s at most),
  then fades out over 0.45 s. The poster and dark space never appear.
- **Address and key.** The key latches at once; the address follows with
  `history.replaceState` when the new mode draws (`night=video`, or none).
  `night=still` links still open the stills program, and N from there goes to
  the default program. A superseded, failed or lost switch unlatches the key
  and keeps the current mode.
- **Context loss.** The renderer keeps its mode across loss and restoration;
  a switch still compiling when the context is lost is abandoned and the
  restored context rebuilds the current mode.
- **Quality.** Frames from the start of a switch to the end of settling are
  left out of the adaptive scale's timing; the first frames build GPU
  pipelines and say nothing about the settled scene.

## Equivalence

In an isolated agent-browser session (1280 × 800, DPR 1) a paused night view
(`t=1500&motion=0&epoch=2026-10-17T20:00:00Z`) was switched to `night=video`
and, once its exposure settled, compared with the same address loaded with
`night=video`: identical screenshots (mean absolute difference 0). Switching
back matched the original default frame exactly, and so did the video view
after a `WEBGL_lose_context` loss and restoration. Losing the context while
the next mode compiled left the default mode, the address and the key as
they were.

## Timing

Apple M2 Max, Chrome (ANGLE Metal, WebGL 1, parallel compile), 1280 × 800,
playing at the explorer's 30 FPS, recorded with requestAnimationFrame, the
camera finish's draws to the canvas and long animation frames. Other jobs
kept the machine at a load average of 13–26; the warm row is from a run at
about 13 (four switches after one warm-up round trip), the cold rows from
fresh browser profiles at 20–26.

| | Warm (programs built before in this browser) | Cold (fresh browser profile) |
| --- | --- | --- |
| Submit programs (main thread) | 1.6–1.8 ms | 2–6 ms |
| Compile (background) | 37–52 ms | 0.36–1.08 s |
| Press → first frame of the new mode | 87–116 ms | 0.42–1.16 s |
| Swap on the main thread | 0.3 ms | 0.4–0.8 ms |
| First frame in the new mode (CPU) | 0.3–1.0 ms | 0.4–0.9 ms |
| Dropped frames, press to end of dissolve | none: worst refresh gap 25 ms, worst scene frame 41 ms at 30 FPS, no long tasks | one stall of 1.2–2.0 s |

On a cold cache the GPU process builds Metal pipelines for the new programs
on their first draw, 1.2–2.2 s, the same stall as a cold page load's first
frame (2.3 s measured with `night=video`). It reaches the page a few frames
after the swap; the crossfade holds the last frame of the old mode through
it, and the dissolve starts only after frames keep their pace again. Warm,
the compile is the only noticeable cost and runs while the old mode draws.

The first version recreated the camera finish and read the exposure state
back with `readPixels`. Its framebuffer checks and readback waited for the
GPU: 13–170 ms of swap, and on a cold cache the whole pipeline build (1.4–2.2
s) blocked inside the first frame. Replacing programs in place and handing the
exposure over on the GPU removed every wait from the swap.
