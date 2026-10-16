# Where the frame goes, and two more reductions, 2026-10-13

Follows [the regional terrain bound](terrain-bound-2026-10-13.md). Every
switch below is opt-in; defaults are unchanged. Raw pairs, image differences
and the bake probe are in the [evidence file](evidence/scene-work-2026-10-13.json).
Rejected candidates and the temporary ablation switch are preserved in
[a patch](evidence/rejected-cloud-work-2026-10-13.patch) against this working tree.

## Ablation

Apple M2 Max, ANGLE/Metal, 1248 × 615, the same paired method as before.
Each candidate removes one feature, so ratios estimate an upper bound for its
cost. Removing code also changes compiler work; treat these as a ranking.

| Removed | Clouds view | Night view |
| --- | ---: | ---: |
| Clouds (`clouds=off`) | 0.342 | 0.634 |
| Terrain (`terrain=0`) | 0.717 | 0.895 |
| Cloud relief noise | 0.736 | 0.882 |
| Surface cloud shadows | 0.818 | 1.035 |
| Terrain sun shadows | 0.892 | 0.983 |
| Airglow | 0.952 | 0.937 |
| Atmosphere sunlight loop | 0.983 | 1.008 |
| Whole Rayleigh atmosphere | 1.009 | 1.055 |
| City haze | 1.001 | 1.000 |

The cloud volume dominates. Atmosphere scattering is close to free on this
GPU, so a transmittance table was not built. `lowland` without clouds measured
0.356 before the run was stopped.

## Candidates

| Candidate | Switch | Change |
| --- | --- | --- |
| Noise table | `noise=table` | Value noise reads its lattice from a 289 × 289 RGBA8 table, four corners per texel: two nearest reads instead of eight permutation hashes. Lattice values are rounded to 8 bits (at most 0.5/255). Applies to clouds, airglow, ocean and city tint. Off for the half-resolution cloud profile, which uses unit 13. |
| Shared terrain entries | `terrainFetch=shared` | Each streamed height sample reads the fine and coarse page tables once and shares them between the sampling width, coarse tile and fine tile. Same arithmetic. |
| Tight cloud shell (rejected) | — | March 0.8–9.3 km, where the density envelope can be non-zero, at the same step length. |
| Nine-slice surface shadows (rejected) | — | Same ~0.95 km slice spacing over 0.8–9.3 km instead of twelve slices over 0.6–12 km. |

| Paired ratio | Noise table | Shared entries | Tight shell | Nine slices |
| --- | ---: | ---: | ---: | ---: |
| Clouds | 0.964 | 0.945 | 0.935 | 0.984 |
| North Pacific | 0.951 | 0.952 | 1.020 | 1.032 |
| Eastern India | 0.984 | 0.971 | 0.996 | — |
| Night | 0.945 | 0.979 | 0.993 | — |

Shared entries are image-identical (maximum difference 1/255 in 0.01% of
channels). The noise table changed at most 10 levels in 0.64% of channels.
The tight shell shifts every march sample: it changed 42% of channels in the
lowland view (mean 0.9/255), while its timing stayed within noise. Nine slices
did not save time either. Both were removed from the renderer.

## Combined

`terrainBound=regional&shaderWork=lean&noise=table&terrainFetch=shared`
against the defaults, measured as one candidate:

| Scene | Reference | Paired ratio |
| --- | ---: | ---: |
| Day, horizon | 14.5 ms | 0.865 |
| Night | 33.6 ms* | 0.899 |
| Clouds, Mongolian plateau | 21.2 ms | 0.803 |
| North Pacific | 24.9 ms | 0.828 |
| Eastern India | 22.9 ms | 0.808 |
| Tibet and Himalaya | 22.0 ms | 0.898 |

\* The same night view measured about 11 ms in other runs. Absolute times
varied between sessions; the paired ratio is the comparable value.
Image differences come from the terrain bound alone, as reported before.

A Pixel owner comparing the bound and lean links on a phone estimated about 15%,
consistent with these measurements. That is an observation, not a benchmark.

## Cloud lighting bake

Thirty seconds of 10× playback at 360 × 740 with fixed quality: 343 of 720
frames carried a bake stripe, with five complete rebakes. Bake frames took
14.1 ms against 12.0 ms (median), about 5% of total GPU time; the existing
`cloudBake=budget` mode halved that share by spreading rows. The bake is not the
main phone cost. Its 6.5 km texels probably explain blocky self-shadows near
a low-sun horizon. This is a visible quality limit, not a speed issue.

## Device-facing switches (not yet measured on a phone)

- `startScale=remembered`: the explorer stores a render scale that held for
  ten seconds of sharp, animated frames, keyed by CSS viewport (±15%), DPR,
  profile and a 30-day lifetime. A return visit starts there, and adaptation
  continues from that point. This targets the slow first seconds while the
  controller descends from full resolution.
- `swipeFps=24`: downscaled devices keep the 24 FPS passive cadence during
  gestures instead of requesting 30, so intervals do not alternate between
  roughly 33 and 42 ms when 30 FPS is not sustainable.
- `perf=1`: an on-page readout of submitted scene frames per second, render
  scale and buffer size, plus the active work switches.

## Date line on WebGL1 without explicit LOD

The Pixel's WebGL1 context has no `EXT_shader_texture_lod`, so its cloud,
terrain, night and surface samples use implicit levels. Across atan's branch
cut adjacent pixels appear to span the whole map and read its coarsest mip.
The phone showed a one-pixel line at 180° that removed clouds and darkened
land; the explicit-LOD path on M2 had none. A lab mode, `api=webgl-nolod`,
hides the extension and reproduced the line from the reported link.

`continuousLongitude` now moves pixels on the far side of the cut by one period
when the quad's longitude derivative exceeds half the map. Repeat wrapping reads
the same texels with continuous derivatives. It applies only to implicit-LOD
fallbacks, including the surface map's negative-bias path, and needs
`OES_standard_derivatives`. The reported view then matched the explicit-LOD
render. Explicit-LOD rendering is unchanged.

The browser suite renders the production cloud sampler across the date line
with mipmaps. With derivatives and with explicit LOD the minimum stays 255; the
control without derivatives reads 64, so the fixture detects the fault.

## Deferred ground shading: rejected

Shading ground only where the view survives the clouds would need a third pass
and MRT. An estimate first marked ground pixels whose cloud transmission ends
below 0.015, the march's own cutoff. They were 4.1% of ground pixels in the
clouds view, 2.5% (Pacific), 2.9% (India), 0.8% (Himalaya) and 29% of a small
ground area in the horizon view. Clouds are mostly translucent at that
threshold. The possible saving is around one percent of the frame, so this
was not built.

## Motion: cadence, shutter, headroom and input

The owner reported that swipes stuttered while the frame counter looked fine.
`perf=1` gained a readout of late refreshes (animation frames more than 1.5
display refreshes apart), the longest gap and long animation frames.

**Cadence.** 24 FPS on a 60 Hz display alternates 33 and 50 ms. Flight
gestures also switched the target to 60 FPS (30 when downscaled) and back.
`cadence=steady` counts display refreshes and renders every k-th one: the
largest k that keeps at least 24 FPS (24 at 120/144 Hz, 30 at 60/90 Hz). The
same cadence applies during gestures. The refresh estimate uses the fast end
of recent intervals and accepts a slower display only after three seconds,
so GPU backpressure cannot slow it. Unit tests cover 60, 90, 120 and 144 Hz,
timestamp jitter, backpressure and a genuine 120 → 60 Hz change.

**GPU headroom.** The adaptive controller lowered resolution only when the
mean interval exceeded 46 ms, so it settled where the GPU was just saturated.
Heavier frames then missed their refresh. On M2 at 1600 × 1000, fixed full
scale gave 2 late of 83 refreshes, an 83 ms gap and long animation frames
with no script time (the main thread waiting on the GPU). Scale 0.5 gave
0 of 180 and a 21 ms maximum. `headroom=1` treats three late frames in the
last 24 as overload and steps scale down by 0.06. It waits until a gesture
ends, because a reallocation is itself a stall, and late frames block
upward probes. The same page settled at 0.88 with 0 of 181 late and a 17 ms
maximum. A later upward probe to 0.93 produced late frames and rolled back.

**Shutter blur.** `motionBlur=<fraction>` integrates the scene along each
pixel's motion between consecutive frames, in the camera finish pass.
Rotation and flight parallax use Earth's sphere; the sky is at infinity.
Lens ghosts and sensor noise stay per-frame. Up to twelve taps per pixel,
capped at 64 pixels, are taken only while the camera moves. At 360 × 740 on
M2 it added about 0.5–0.8 ms during playback. The owner preferred 0.75.

**Input.** A screen recording of a trackpad swipe showed frames that did not
move followed by double steps, mostly near the end of the gesture. Wheel
deltas were applied to the camera inside the event handler: Chromium delivers
them in bursts while the main thread submits a frame, and macOS momentum ends
in small, irregular deltas. `inputSmoothing=<ms>` releases trackpad deltas and
a grabbed Earth point over that time constant on every display refresh. A
released grab still lands under the lifted pointer. A synthetic bursty swipe
with a momentum tail moved 62, 185, 62, 123, 123, 185, 62 km between frames
without it. With 60 ms the tail was monotonic: 150, 112, 117, 119, 121, 122,
95, 54, 31 km. The owner preferred 90 ms on device; the cost is a short
ease-in at the start of a swipe.

**Touch.** A grabbed Earth point stays under the finger, so a long swipe
runs out at the limb and feels slow on a phone; amplifying the grab
(`touchGain`) lets the point drift away from the finger. `touchMode=spin`
treats one finger like the desktop trackpad scroll: the globe turns about
its centre, the surface at the pressed point following the finger
(times `touchGain`), with no limit at the limb. Android sends no momentum,
so the release velocity of the last 100 ms starts a capped coast
(`flingLimit` rad/s, `flingCoast` s). In a 390×844 emulated phone with the
whole disc in view, a 400 px swipe from the disc centre turned the globe
63° by grab (stopping at the limb), 38° by spin and 57° by spin at gain 1.5;
a 120 px flick coasted 35–48° in each mode. Two-finger gestures are
unchanged.

On 2026-10-13 the owner accepted the configuration with `viewScale=0.1`
on the phone; it became the explorer default, each switch keeping a way back
to the old path (see `docs/scene.md`).

## Resolution by view

On a phone at 60 Hz (30 FPS steady target) the adaptive scale settled at
its 0.45 floor, which on a 1.5× base buffer is about a quarter of the
display's linear resolution. Because one scale serves every view and is
remembered across visits, a distant planet stayed as soft as the heaviest
close view. With fixed scales on the phone, 1.0 held a distant view but
stuttered while turning close to the surface.

Frame work follows the pixels whose rays meet the atmosphere; open sky is
cheap. `viewScale=<sky cost>` estimates that fraction on the CPU from a
24×24 grid of camera rays against the 120 km shell and multiplies the
adaptive scale by `1/sqrt(sky + (1 - sky) × coverage)`, at most 2 and never
above a full buffer, so a frame costs about what a fully covered view does
at the adaptive scale. The factor moves in 0.05 steps: a heavier view
shrinks the buffer at most four times a second, also mid-gesture; a
lighter one grows only after 600 ms of quiet. In a 390×844 frame with sky
cost 0.2, the distant view of 44,600 km (coverage 0.17) rose from 0.45 to
0.77; looking down near the surface stayed at 0.45.

GPU timer queries on the M2 (ANGLE over Metal) were not usable for this
question: one frame timed 10.8 ms at 1248×615 and at 2496×1230, and
splitting a frame into per-pass queries inflated it fourfold. Paired
comparisons at one size remain valid; absolute per-pixel cost needs the
device.
