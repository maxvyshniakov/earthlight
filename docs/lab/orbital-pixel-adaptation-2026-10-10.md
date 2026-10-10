# Pixel adaptation and autoplay, 2026-10-10

The final controller reaches a useful resolution sooner in the measured cloud
view. It also preserves more resolution in the half-cloud case. This is a short
Pixel check; the iPhone and sustained acceptance checks remain open.

Both tests loaded the final `CsvWCxgp` client, SHA-256
`f68d30f37509d39d60fbb80a37b2a236b973f5072905998efa0a9187fd14ef4b`.
The cloud-edge experiment had already been removed. Compact remains the default
WebGL1 profile; half-cloud selects WebGL2. The physical Pixel has no GPU timer
extension, so these runs exercise the cadence controller.

## Controlled playback

The same script, camera, epoch, manual exposure, `aurora=0`, and 412×832 CSS
viewport as [the API baseline](orbital-pixel-api-2026-10-10.md) were used.
Full resolution is 618×1248. Assets settle with playback paused, then each final
run plays for 30 seconds. Scale is sampled at the end of each 5-second window.

| Variant | Baseline first 5 s fps / ending scale | Final first 5 s fps / ending scale | Final 10–30 s fps / scale range |
| --- | ---: | ---: | ---: |
| Compact / WebGL1 | 9.6 / 100% | 17.4 / 59% | 23.39 / 59–64% |
| Half-cloud / WebGL2 | 19.8 / 60% | 19.4 / 87% | 23.50 / 78–83% |

Compact starts reducing the overloaded buffer sooner. Half-cloud keeps more
pixels at a similar initial cadence. Both final runs attempted one increase
and rolled it back: Compact 59→64→59%, half-cloud 78→83→78%. The API baseline
used the previous controller; this is a practical before/after check, with
single final runs and no thermal normalization.

Cadence remained imperfect: after the first 10 seconds, Compact had 8 intervals
above 100 ms and half-cloud had 4. These short runs do not establish sustained
24 fps, a 75% minimum scale, or zero long frames.

## Ordinary autoplay

[`verify-device-startup.mjs`](../../scripts/verify-device-startup.mjs) installs its
measurement before the page's scripts. It then navigates without `motion=0`,
records final framebuffer draw submissions, and observes the first 20 seconds
after sharp focus. It keeps the native viewport, normal automatic exposure,
and existing browser cache. It neither throttles the network nor waits for
assets before starting the measurement.

| Navigation | First draw submission | First sharp draw | First 5 s after sharp | Following 15 s |
| --- | ---: | ---: | --- | --- |
| `/` | 0.46 s | 2.97 s | 23.8 fps, 100% | 24 fps, 100% |
| Cloud fixture, autoplay | 0.49 s | 3.66 s | 18 fps, 100→57% | 24 fps, 57→62% |

The cloud fixture uses `t=3235.65`, `pitch=-25`, epoch
`2026-10-06T01:32:27Z`, and `aurora=0`. It first reduces the buffer 1.54 seconds
after the first sharp draw. This verifies the startup path as well as Play
from an already settled scene. The default view retained full resolution.
These draw timestamps do not measure when the compositor presents an image,
and they are not cold 4G startup measurements.

Both autoplay runs stayed visible and used Compact/WebGL1 without asset or GL
errors. The default Pixel aurora path was `unsupported`; the fixture explicitly
disabled it. Final controlled runs also stayed visible and error-free.

[Raw intervals, scale samples, focus transitions, client hashes, and the excluded run](evidence/orbital-pixel-adaptation-2026-10-10.json)
preserve the evidence. An earlier 60-second run was excluded after Chrome became
hidden at 29.35 seconds. Its no-frame period is not renderer performance data.

## Reproduction and remaining checks

```sh
DEVICE_API_CASES=adaptive-compact-webgl,adaptive-clouds-half-webgl2 DEVICE_API_SECONDS=30 bun scripts/benchmark-device-api.mjs http://127.0.0.1:4351 /tmp/orbit-device-adaptation
bun scripts/verify-device-startup.mjs http://127.0.0.1:4351 /tmp/orbit-device-startup
```

Both scripts restore the phone's original keep-awake setting and close only
their own native Chrome tab. A real iPhone was unavailable. Simulation covers
the 30/50/60/120 Hz controller behavior, but iOS low-power mode and Safari's
actual scheduling still need a device check before final threshold tuning.
