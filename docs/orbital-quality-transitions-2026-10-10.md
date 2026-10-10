# Quality adaptation through scene changes

Compact remains the default. This iteration changes how established playback
responds to a new load; initial acquisition and the GPU-timer controller retain
their previous policy. Pixel measurements use `aurora=0` to separate effects
from the cloud reconstruction trade-off.

## Simulation acceptance

The tests run the real `SceneQuality` class with the scene's remainder-carrying
24 fps limiter. Simulated GPU work delays callbacks to the next refresh-grid
boundary. The full-size cost is multiplied by the square of render scale.
This is a controller model, not a prediction of physical GPU timing.

Each scenario starts with established 12 ms full-size work. The new transition
tests cover 30, 60 and 120 Hz; existing healthy runs also cover 50 Hz.

| Scenario | Required result |
| --- | --- |
| Abrupt 12 → 92 ms work | Mean delivered interval ≤46 ms in the five-second window from 3 to 8 seconds after the change; at most two resizes during those eight seconds |
| Linear 12 → 92 ms growth over 60 seconds | Every tested overlapping five-second window ≤52 ms; settled window from 61 to 66 seconds ≤46 ms; at most eight resizes |
| One 400 ms stall | No resize |
| Two-second size-independent upload burst, 67/100/160/250/334 ms per draw | At most one resize, and scale stays ≥0.9 through five seconds after the burst |
| Three light → heavy → light cycles | At most two downward and eleven upward changes per cycle, thirteen total; full resolution restored within 160 seconds of light work |
| Healthy 30/50/60/120 Hz | Full resolution throughout two minutes |

The ramp allows a brief deficit near 19.2 fps while requiring near-target
delivery after the load stops increasing. This is deliberately a weaker
criterion than uninterrupted 24 fps. The cycle limit counts actual scale
changes, including upward probes; it does not require fast recovery to full
resolution. Keeping upward recovery cautious prevents repeated expensive
buffer reallocations near the performance limit.

## Established-load response

Material overload uses the last eight delivered intervals, dropping the largest
value and requiring the remaining mean to exceed 62.5 ms (1.5× the frame budget).
This catches alternating long/short delivery while ignoring a single outlier.
Healthy 24 fps on a 30 Hz display does not cross that threshold. The first
response reduces scale by only 0.1 and allows 1.5 seconds for the new size to
settle. Repeated material overload then permits a bounded proportional drop.
Healthy windows, pause/reset and invalid samples clear that confirmation.
Smaller sustained deficits still require two windows. Upward probes retain
their previous delay, rollback and backoff.

The established emergency path requires six consecutive intervals above 120 ms
totaling at least 2.4 seconds. Its history continues through resize cooldowns,
so a genuine emergency can still interrupt a failed upward probe. This prevents
a two-second burst from bypassing the small first step, while retaining emergency
recovery for six 400 ms frames. Initial
acquisition retains its previous six-stall emergency behavior.

The 46 focused quality tests pass. In the abrupt-load simulations, the two
changes occur at 0.47–0.83 and 2.67–3.00 seconds; the measured mean in the 3–8 second
window is 41.67–41.74 ms. The worst five-second window during the gradual ramp
is 51.74 ms on 30 Hz. Its settled window passes the 46 ms criterion. These
numbers establish the stated simulation contract, not uninterrupted device
cadence or acceptable image quality at the resulting scale.

[Simulation outputs and source hashes](evidence/orbital-quality-simulation-2026-10-10.json)
preserve these measurements. A separate test replays the recorded Pixel RAF
timestamps through the actual frame limiter. Its first reduction occurs 690.5 ms
after the cloud transition. That test checks the first decision only: recorded
timestamps cannot predict delivery after a counterfactual resize.

The first physical candidate was rejected. Requiring eight consecutive slow
intervals missed the Pixel's alternating long/short callback delivery and did
not improve the first cloud transition. This led to the trimmed-mean signal
above and the recorded-timestamp regression fixture. The previous large-p90
shortcut was also removed; it must not bypass the emergency duration guard.

Without GPU timers, a short CPU/upload stall and expensive rendering can have
the same delivery intervals. The small first response is intentional: it
limits the damage when lowering resolution cannot fix the cause.

## Explicit aurora policy

The Aurora setting offers Auto, Off and On. Auto disables the effect when the
primary input is coarse and cannot hover, covering the normal phone/tablet
configuration. A touch-capable laptop with a fine primary pointer keeps the
desktop behavior. This decision does not depend on WebGL1 versus WebGL2.

Off prevents aurora program creation and rendering. On requests the effect and
prefers WebGL2 when no explicit API override was supplied. Hardware capability
checks still apply; an unsupported path is reported in the settings panel.
Legacy `aurora=0` and `aurora=1` links stay valid; `off`, `on` and `auto` are also
accepted. Removing the parameter selects Auto. Profile changes and the homepage
Orbit link preserve the choice; Reset all restores Auto.

The phone default is a product choice, not a measurement of saved energy or a
claim of iPhone validation. A physical iPhone remains unavailable.

[Browser evidence](evidence/orbital-effects-policy-2026-10-10.json) checks actual
program creation and draw calls: Off and touch Auto compile and draw no aurora
passes; explicit On enables the effect when supported. The controls preserve
camera, exposure, speed and pause state; unsupported fallback, the homepage link
and Reset all pass. Desktop and 390 px panel screenshots were inspected. Touch
emulation uses Chromium, not a physical iPhone. These checks preceded the final
controller-only correction; the effect policy and controls did not change.

## Physical Pixel transition check

The [Pixel transition report](orbital-pixel-transitions-2026-10-10.md) compares
the previous controller with the final candidate, using the same 592×1195 base
buffer, camera path, time and manual exposure. Compact stays the default.

Compact's first five seconds after turning toward clouds improved from 10.0
to 15.4 fps. Its first reduced-size draw occurred at 1.11 seconds, followed by
a second reduction at 3.36 seconds. Mean delivered interval in the fully
contained 3–8 second window was 44.34 ms, passing the chosen ≤46 ms transition
criterion. The old controller measured 58.38 ms in that window.

Half-cloud rendering measured 45.991 ms against 47.648 ms previously. That is
a borderline pass in one short run, without a demonstrated repeatability margin.
Its first-five-second cadence stayed at 19.6 fps; the next five seconds improved
from 21.4 to 22.8 fps.

Within the common first 20 seconds, intervals over 100 ms fell from 21 to 14
for Compact and from 17 to 14 for half-cloud rendering. Both still fail the
zero-long-frame target. At 20 seconds the actual buffers were 360×727 for
Compact and 504×1016 for half-cloud rendering. These are individual transition
observations, not sustained minimum-scale acceptance. Draw submission timing
does not measure compositor presentation or GPU duration.

The final build's physical Pixel controls also passed Auto → On → Off: WebGL2
and half-cloud rendering remained selected, Auto/Off reported no aurora, and
On reported the supported volume effect. Each state retained the same paused
pose/time and had zero GL or asset errors. This validates the explicit policy
on Pixel, not the effect's battery cost or iPhone support.

At the observed sizes, the inspected compositor captures show sharper fine
cloud texture in half-cloud rendering, together with more visible steps on
extended cloud edges near the horizon. The short sampled motion sequence does
not establish a clear visual winner or validate flicker-free live playback.
The replay covers this cloud view only; it does not accept day, night or all
horizon silhouettes. Compact therefore remains the default, and cloud edge
code is unchanged.
