# Night meter, 2026-10-18

On a phone, switching physical night on (`night=video`, the N key) while
looking at the Moon at 33× made the exposure pump. The picture grew brighter,
then darker, back and forth for seconds before it settled. The cause was the
meter itself: in physical night it chose its subjects relative to the
camera's own EV, so its request could jump as a step function of that EV.
The physical-night meter now works the way a camera's automatic exposure
does. It meters in scene units, finds subjects relative to the frame,
weighs them by their share of the frame, and holds within a dead band. The
default program is unchanged byte for byte, and so is the daylit frame of
physical night.

## Cause

The view: free flight at 1,972 km on 2026-12-31 23:25 UTC, the camera faced
to the Moon, lens 33×, paused, 412 × 860. The Moon covers about a tenth of the
frame. In physical night its scene radiance is 0.012 at the median and
0.04–0.05 at the brightest. That is below the daytime subject threshold
(`METER_LIT`, 0.025–0.10).

Above EV 5.1 (`METER_SUBJECT_EV`), the thresholds were scaled by
2^(5.1 − ev), where ev was the exposure the frame had just been rendered
with. The scaling was applied in the glare pyramid's `lit()`, the meter's
point samples, its subject bound and its weight mix. Two consequences
followed:

- **The Moon was a subject only while the exposure lifted it.** At ev 5.8 the
  Moon counted and asked for about ev 0.3. At ev 5.3 it no longer counted, and
  the frame asked for the black sky's ev, the 17.45 ceiling.
- **The request was a step.** It fell by 17 EV within 0.4 EV of exposure.

No exposure was consistent with both requests, so the controller cycled
around the edge. Each darkening step moved 0.4 EV after the 0.12 s flash
gate, and each brightening step moved 0.47 EV. Both steps grow with the frame
time.

The traces below read the exposure state every animation frame, after an
in-place switch from ev −2.97 in the default program.

| Frames per second | Trace (ev) |
| --- | --- |
| 20 | the hand-over's three settle frames take the request at once: 11.3 → 5.37 → **15.27**; a 2.7 s descent to 5.7, then 5.70 → 5.29 → 5.77 → 5.38 → 5.73 …, requests alternating between 0.0–0.8 and 14–17.45, about 4 Hz |
| 5–7 (CPU throttled) | the same, with a 1.4–2 EV swing: 5.70 → 4.52 → 5.92 → 4.31 → 5.73 → 4.58 → 6.60 |

A paused view stops drawing 7 s after the switch, so the cycle froze at
whatever exposure it had reached by then. A cold start with `night=video`
happened to land inside the narrow band, at 5.48–5.65.

## Camera principles adopted

1. **Scene-referred metering.** A camera turns pixel values into scene
   brightness with the exposure it knows. The meter divides the
   pre-exposure out and then decides nothing on the camera's EV.
2. **Subjects are relative to the frame.** A cell is a subject when it
   stands 4–6 stops over the frame's metered mid-grey. The thresholds are
   the old `METER_LIT` ratio, never above the daytime absolute values.
3. **Evaluative weighting.** A subject pulls by its share of the frame. A
   small bright subject on a black sky clips, as on matrix or multi-segment
   exposure. A subject that fills a meaningful share of the frame is exposed
   for.
4. **Video AE stability.** At night the exposure holds within a dead band.

## Change

- **Frame EV.** The meter now keeps the frame EV in a second pair of 1 × 1
  state targets (`CameraExposure.frameTexture`), written by a second draw of
  the meter program. The frame EV is the exposure the frame's mean
  luminance asks for before subjects pull, clamped to the camera's range.
  It is a value of the scene: the histogram is taken in scene units. The
  glare pyramid's `lit()` and the meter's point samples scale their
  thresholds by min(1, 2^(5.1 − frame EV)) from the previous update.
  - Below EV 5.1 the thresholds are the day's, so daylight is metered
    exactly as before.
  - Above it, a subject must stand 15.6–62 times, 4–6 stops, over the
    frame's mid-grey.
- **The ratio follows the evidence.** The table below gives each view's
  frame quantiles in stops over the settled mid-grey (`night=video`,
  1200 × 800). Moonlit cloud and land fill the frame up to its p90 at +1.0 to
  +1.6, and only the brightest cloud edges reach +4.2. City cores sit at
  +4.9 to +6.6, and the Moon at 33× sits at +15. The 4–6 stop window
  separates moonlit ground from lamps and the Moon.

  | View | p50 | p90 | p99 |
  | --- | ---: | ---: | ---: |
  | Full Moon (moonlit) | −0.5 | +1.6 | +4.2 |
  | Iberia | −3.3 | +1.0 | +5.4 |
  | City 1× | −6.1 | +3.1 | +4.9 |
  | New Moon (moonless, cities) | −3.8 | −2.8 | +6.6 |
- **The bound is the day's.** A cell's subject radiance is bounded at 2
  scene units. Night radiance never reaches that value, so at night the
  bound does nothing.
- **Weight by share.** At night a subject's weight is its share of the
  frame up to 5%, a light mix as in average metering. From 5% it rises
  smoothly to 1 at 15%. The 5% knee comes from the calibrated views: city
  lights hold 2.8–4.2% of their frames and keep the average metering they
  were calibrated with. Below EV 5.1 the weight is the day's, (share /
  0.025%)².
- **Dead band.** At night the exposure starts to move only for a request
  0.3 EV away, and once moving it stops within 0.1 EV. The flag is stored
  in the frame state, and the tau and flash-gate behaviour are unchanged.
  Frames below EV 5.1 adapt as before.
- **Hand-over.** On a switch into physical night, and on a cold start, the
  meter first spends one update metering the frame EV without moving the
  exposure. It then takes its request at once for four updates instead of
  three, still behind the crossfade. No settle step can jump the wrong way
  any more: the request no longer depends on the exposure.

## Results

### Moon at 33×

These runs are the in-place switch from ev −2.97 unless noted. "Drawing"
means the view kept rendering for at least 15 s after it settled.

| Run | Trace (ev) | Afterwards |
| --- | --- | --- |
| 20 fps, paused | 11.32 kept → 4.76 → 5.04 → **5.02** | flat for 19.5 s of drawing |
| About 1–3 updates/s (throttled), paused | the same steps | **5.02**, flat |
| Cold start, `night=video` | — | **5.06** |
| Playing at 10×, about 30 and 9 updates/s | from 5.4, a smooth climb as the Moon drifts out and its share falls from 10% to 7% | no reversal |

At 5.02 the Moon's median is 0.39 of white, a Moon exposed for its own
surface. That is EV100 10.6. Under the old meter the exposure cycled
around 5.3–5.8.

### Moon at 3×

The Moon covers 0.2% of the frame. The meter settles at **14.47** after a
switch, and a cold start gives 14.71 at the playing scene time. The request
does not change with the exposure, so it is flat while drawing. The Moon
clips there, as intended for a small bright subject on a black sky. The old
meter held 7.4 at its classification edge.

### Calibrated views

Each view is at 1200 × 800 with `night=video`. "Before" is HEAD with the same
hook and views; "after" is from `scripts/night-views.mjs`. EV100 is 15.62 −
ev.

| View | Before ev | After ev | After EV100 | Reference |
| --- | ---: | ---: | ---: | --- |
| Full Moon | 18.07 | 18.03 | −2.40 | ISS moonlit video −2.4 |
| Quarter Moon | 22.07 | 22.07 | −6.44 | ceiling |
| New Moon | 20.92 | 20.52 | −4.90 | — |
| City 1× | 17.32 | 17.07 | −1.45 | — |
| City 8× | 14.29 | 14.19 | +1.43 | Dubai frame +2.0 |
| Limb | 22.07 | 22.07 | −6.44 | ceiling |
| Iberia | 18.33 | 18.44 | −2.82 | frame −3.7 |
| Daylit nadir | −1.05 | −1.05 | 16.67 | unchanged |

Only the new-Moon view moves by more than 0.3 EV, by −0.40. Its frame EV is
at the ceiling, 22.07, while the old exposure sat at 20.92. Lamps are now
classified against the frame's mid-grey rather than against that exposure,
so the thresholds fall by 1.15 stops. A few more city cells then count and
pull the frame 0.4 EV darker. The moonless ISS reference, ISS030-E-7397 at
EV100 −4.0, is a still and not this view, but the view moves towards it,
from −5.3 to −4.9. Iberia moves by +0.1, towards its reference.

The dead band makes the settled value depend on the path by up to 0.3 EV.
City 8× settled 0.1–0.3 EV short of its request on a cold start, because the
last assets arrived after the hand-over.

### Other effects

- **Ledger Moon view at 20×.** The radiance ledger's Moon view at 20×
  (1200 × 800) covers 1% of the frame and now clips: ev 6.61 before, 11.56
  after.
- **33× in landscape.** The Moon at 33× in a 1200 × 800 frame holds 3.5% and
  meters at ev 9.2, with the Moon clipped.
- **Tall frames.** A phone in portrait holds the same Moon at 10% and
  exposes it.

This follows principle 3: how much a subject pulls depends on its share of
the frame, not on what it is. Moving the 5% knee lower would expose these
Moons for their surface. It would also raise the weight of city lights,
which hold 3–4% of their frames, and darken the city views by 2–3 EV.

## Verification

- `bun run verify` passes.
- `scripts/night-mode.test.mjs` still finds every default-program source
  byte-identical. Only the night programs' exposure and glare-down fragments
  have new hashes.
- The traces were recorded in an isolated agent-browser session. An init
  script hooked the 1 × 1 meter targets: the exposure state, and the frame
  state that the second meter draw writes. `scripts/night-views.mjs` now
  reads the exposure state, not the frame state.
