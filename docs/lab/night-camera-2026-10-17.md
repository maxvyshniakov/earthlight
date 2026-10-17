# Night camera, 2026-10-17

The [physical-night lab](physical-night-2026-10-17.md) put the missing night
stops back into the camera, and [pre-exposure](pre-exposure-2026-10-17.md)
let half floats hold them. The owner's verdict on the result: useless as it
is, because the picture is extremely noisy. This lab makes `night=video` and
`night=still` a camera that a real lens and sensor could be, and judges it
against ISS frames. Without the parameter every shader source is
byte-identical to the parent: 19 programs in a daylight view and 21 with the
resolved Moon, compared by hash after `shaderSource`.

## The night lens

The explorer zooms from 0.5× to 50×, 15 to 1 500 mm full-frame equivalent.
The lab's single f/1.4 ceiling held at every focal length, so a 1 500 mm lens
had a 1.07 m entrance pupil. Real lenses:

| Lens | f-number | Entrance pupil |
| --- | --- | ---: |
| Sigma 14 mm f/1.4, Nikkor 24 and 50 mm f/1.4 (ISS030-E-102292) | f/1.4 | 10–36 mm |
| Nikkor 400 mm f/2.8 (ISS030-E-99324, Dubai) | f/2.8 | 143 mm |
| Nikkor 800 mm f/5.6E, carried on the ISS ([DIY Photography](https://www.diyphotography.net/camera-gear-nasa-use-international-space-station/)) | f/5.6 | 143 mm |
| The same with its 1.4× converter, 1 120 mm | f/8 | 140 mm |

So the night lens (`NIGHT_LENS` in `camera-model.ts`) is the widest of fast
primes, limited by a 143 mm front element:

  f_min = max(f/1.4, focal / 143 mm)

which is f/1.4 to 200 mm, f/1.68 at 8× (240 mm), f/2.8 at 400 mm and f/10.5 at
1 500 mm. It is optimistic by up to a stop between 85 and 200 mm, where real
primes stop at 60–100 mm pupils (85 mm f/1.4, 200 mm f/2).

The base program (f/16 to f/3.18, ISO 100–543) is unchanged at every focal
length, so daylight is unchanged. The night lens stage opens from f/3.18 to
f_min after the ND filter and before ISO. From 455 mm on f/3.18 is already
wider than f_min; there the night program stops down to f_min while the ND
filter comes out, with ISO making up the difference, so f-number and ISO stay
continuous in EV (`scripts/physical-night.test.mjs`). ISO ends at the camera's
limit, 409 600 for the α7S-class video and 102 400 (Hi 3) for the D3S-class
still, so the ceiling now falls with focal length (`exposureCeiling`,
`cameraCeilingEV()` in GLSL), and the meter and manual EV stop there:

| Focal length | f_min | Video ceiling (EV100) | Still ceiling (EV100) |
| ---: | ---: | ---: | ---: |
| 15–200 mm | 1.4 | −6.44 | −6.48 |
| 240 mm (8×) | 1.68 | −5.92 | −6.48 |
| 400 mm | 2.8 | −4.45 | −6.48 |
| 800 mm | 5.6 | −2.45 | −5.41 |
| 1 500 mm | 10.5 | −0.64 | −3.60 |

Shaders read the focal length through `FOCAL` where it is defined before the
camera model. The loading defocus and the PSF tile use 1×; both are the same
from f/1.4 to f/3.2.

## Grain from photosites

The grain cell is one CSS pixel. At the default grain it collected
17 600 e⁻ at white at ISO 400, one photosite of half an α7S's well. A 12 MP
sensor (2 832 rows of 8.4 µm) shown 800 CSS pixels high puts
(2 832 / 800)² = 12.5 photosites into each. In the lab a cell now bins
N = max(1, (2 832 / CSS height)²) photosites of 36 000 e⁻ at white at ISO
400, the α7S's ~1.5 × 10⁵ e⁻ full well at ISO 100, with the read noise of
each (`sensor-noise.ts`, `camera-finish.ts`). Shot and read noise fall by √N.

Daylight grain is the default program's photographic look, far above what a
binned sensor shows. To keep it, the old cell's variance stays as a look
grain where it exceeds the binned sensor's, at ISO gains up to the base
program's top (ISO 543). Daylight variance is therefore exactly the default's
(measured SNR 31.3 in both); above ISO 543 the look stays at that level and
the sensor's own noise takes over. Zero grain is still clean.

SNR of a grain cell at metered mid-grey, green channel, measured from each
frame against the same frame at the same EV with `look-grain=0`
(`scripts/night-views.mjs`), 1200 × 800:

| View | Mode | Before | After | Model after |
| --- | --- | ---: | ---: | ---: |
| Full Moon nadir | video | 3.1 | 13.6 | 13.8 |
| | still | 17.3 | 24.8 | 26.1 |
| Quarter Moon nadir | video | 0.8 | 4.0 | 4.1 |
| | still | 5.2 | 18.3 | 19.2 |
| Limb (ceiling, ISO 409 600) | video | 0.8 | 3.9 | 4.1 |
| Daylit nadir | default and video | 31.3 | 31.3 | |

## Emitters, moonlight and the meter

Cities, airglow, the sky floor, stars, the Milky Way and aurora keep their
physical-night divisors. The Krisciunas–Schaefer phase law, albedo/π moonlight
on clouds and airglow on the sea are in place. Checked end to end with
`bun scripts/radiance-ledger.mjs <base> <out> night=video`:

| Source | Lab before | Now | Physical |
| --- | ---: | ---: | --- |
| Lunar surface, lit part, 115° (p50) | ×2.8 | 579 cd/m², ×1.1 | 400–750 |
| City lights, bright core (p99) | ×0.2 | 0.56 cd/m², ×0.2 | 0.5–16 |
| Airglow at the limb (p99) | ×1.0 | 4.9 × 10⁻³ cd/m², ×1.1 | 3–7 × 10⁻³ |
| Dark sky above the airglow (p50) | ×1.0 | 1.3 × 10⁻⁴ cd/m², ×1.0 | 0.5–3 × 10⁻⁴ |

Changes:

- **The lunar disk is tied to moonlight.** Its gain on cos(incidence) was 18
  over a ledger divisor of 200. Now (`lunarDiskGain`, `earth-light.ts`) the
  disk's flux is `FULL_MOON_IRRADIANCE` times the phase law: a full disk is
  E/(πr²) = 0.086 scene units, 5 200 cd/m² against 4 900–5 400 measured. The
  same gain drives the resolved disk and the Moon's lens ghost, which had
  kept the factor 200 in the lab. `NIGHT_EXCESS.moonDisk` is gone.
- **Airglow layers.** The default palette put 86% of the light into an
  amber layer 19 km wide; against ISS030-E-7397 and ISS030-E-10008 it read as
  a thick orange band. The lab layers are OI 557.7 nm at 97 km (σ 4 km, 60%
  of the visible light) and Na/OH at 90 km (σ 5 km, 40%), with the same zenith
  column luminance. The limb is a thin yellow-green band, and airglow-lit
  clouds turn olive-green, as in ISS030-E-7397.
- **Meter subjects relative to exposure.** `METER_LIT` and the subject
  bound hold in scene units up to EV 5.1, the default program's ceiling, and
  scale with 2^−(ev − 5.1) above it: at night a subject is what stands 4–6
  stops over metered mid-grey. With that alone the full-Moon frame metered
  1.4 stops darker and the new-Moon frame 4.8 stops darker, both for the city
  lights at their edge, which is the default program's fault the earlier lab
  named. So at night (`1 − subject` in the meter) a subject pulls exposure by
  its share of the frame, a plain light mix: a city that fills an 8× frame
  sets the exposure, lights at the edge of a 1× frame clip as in ISS video, and
  a Moon on black sky, 25 EV from it, still sets it from a fraction of a
  percent. Daylight metering is unchanged (ev −0.73 in the daylit nadir).

## Judged like a camera

`bun scripts/night-views.mjs <base> <out>` against the production build
(`scripts/preview.mjs`), 1200 × 800, 12 s settle. The references were viewed
in a browser from `images-assets.nasa.gov`; frames are not committed.

| View | Mode | EV100 | Shutter | f | ISO | SNR |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Full Moon nadir (2026-10-26 04:12, 12° N 67° W) | video | −3.0 | 1/24 | 1.4 | 37 000 | 13.6 |
| | still | −3.0 | 1.3 s | 1.4 | 1 190 | 24.8 |
| Quarter Moon nadir (2026-10-18 22:00, 5° N 20° W) | video | −6.4 | 1/24 | 1.4 | 409 600 | 4.0 |
| | still | −6.5 | 1.3 s | 1.4 | 13 400 | 18.3 |
| New Moon nadir (2026-10-10 04:12) | video | −5.0 | 1/24 | 1.4 | 154 000 | 7.2* |
| | still | −5.0 | 1.3 s | 1.4 | 4 970 | 23.3* |
| Dubai 1× (2012-02-22 19:24, as ISS030-E-99324) | video | −1.7 | 1/24 | 1.4 | 15 300 | 18.1 |
| | still | −1.7 | 1.2 s | 1.4 | 543 | 25.1 |
| Dubai 8×, 240 mm | video | +1.3 | 1/24 | 1.68 | 2 670 | 24.0 |
| | still | +1.3 | 1/5 s | 1.68 | 543 | 25.6 |
| Limb, 20 mm, looking west at 41.5° N 180° (as ISS030-E-7397) | video | −6.4 | 1/24 | 1.4 | 409 600 | 3.9 |
| | still | −6.5 | 1.3 s | 1.4 | 13 400 | 18.0 |
| Iberia, oblique (as ISS030-E-10008) | video | −2.7 | 1/24 | 1.4 | 29 700 | 14.8 |
| | still | −2.7 | 1.3 s | 1.4 | 950 | 25.3 |
| Daylit nadir | default, video | +16.4 | 1/48 | 5.3 | 301 (ND 7.5) | 31.3 |

\* No mid-grey area in the frame; the model's value at mid-grey.

What is visible:

- **Full Moon.** Clouds clearly lit and grey, the Moon's glint a broad haze
  on the sea, Caracas clipped at the edge. Grain is visible only in the dark
  sea. ISS moonlit video at ISO 25 600, f/1.4, 1/25 s would be EV100 −2.4.
- **Quarter Moon.** Video runs at its ceiling. The cloud field reads well
  through a fine, visible grain; it was noise before. The still is clean.
- **New Moon.** Practically black in video: faint olive clouds can be made out
  only knowing where they are. The coastal lights pull the meter 1.4 stops
  below the ceiling. A moonless surface needs the limb's long still.
- **Dubai 1×.** The exposure is plausible, but the lights are white cores
  with broad bloom where ISS frames show amber points.
- **Dubai 8×.** The meter lands at EV100 +1.3 against the frame's +2.0 at
  400 mm (f/2.8, 1/40 s, ISO 8 000; the lab's video gives f/2.8, 1/24 s,
  ISO 4 700 there). The picture is not: a soft tan glow, because the 500 m
  night map cannot resolve the street grid the 400 mm frame shows.
- **Limb.** A thin yellow-green airglow band over olive-lit clouds, stars,
  close to ISS030-E-7397 (1.3 s, f/3.2, ISO 12 800, EV100 −4.0; ours meters
  2.5 stops more). A lightning flash sits on the limb. The cloud-free sea is
  a neutral grey of 3 × 10⁻⁴ cd/m² that stays with the surface, clouds, glare,
  galaxy, lightning and aurora switched off; probably the glint of the
  near-new Moon, not traced.
- **Iberia.** Automatic video at −2.7 against the frame's −3.7; towns are
  whiter and moonlit cloud fainter than in the frame.
- **Day** is unchanged.

## Verdict

Moonlit video is now a usable picture: SNR 14 at full Moon and 4 at quarter
Moon, from 3 and 0.8. It could be the default for moonlit and twilight
nights. Moonless video stays near black, which is physical but not
attractive; the still shows it. Before a default: the city lamp colour and
bloom, night map detail at 8× and beyond, the grey night sea, and the
optimistic 85–200 mm apertures.

## Verification

`bun run verify`: `astro check` and the build pass; its 282 tests pass with a
60 s per-test timeout, while at the default 5 s one to three terrain and GPU
fixture tests time out on this machine (load average 50–110 from other
sessions). `bun run verify:scene` against the preview of this build passed
its first checks (noise, seams, textures, flight) and then failed on a
timing check in three runs, each at a different one: the passive cadence at
22.9 fps, then at 40.0 fps, then a loop over the top during flight. Default
shader sources are byte-identical to the parent (19 and 21 programs), so the
default program is not what changed there; rerun it on an idle machine.
