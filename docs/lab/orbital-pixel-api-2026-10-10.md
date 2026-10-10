# Pixel API comparison, 2026-10-10

This comparison isolates the API change from half-resolution clouds. It uses
Pixel 9 Pro XL, Mali-G715, native Chrome 154, and the previously validated
`BDaYREJa` client (SHA-256
`bfe1f9387eb4e32053fa157bff121d0fbac7d5f981bc29e939fcbf3cbbf98a15`).
It measures the baseline before the RAF-aware quality-controller changes and
cloud-edge experiments in the subsequent work.

## Method

[`benchmark-device-api.mjs`](../../scripts/benchmark-device-api.mjs) opens its own
visible Android Chrome tab. Assets, exposure, and focus settle before Play.
Every run starts at `t=3235.65`, `pitch=-25`, epoch
`2026-10-06T01:32:27Z`, zero grain, manual exposure 0 EV, native 10x playback.
The canvas CSS size is fixed at 412×832 to prevent Android address-bar changes
from altering the buffer between runs. Full resolution is 618×1248.

The first stage uses `quality=fixed&aurora=0` for Compact/WebGL1,
Compact/WebGL2, and half-cloud/WebGL2, then repeats in reverse order. Each run
lasts 30 seconds. Summaries omit its first 10 seconds. The second stage runs
each variant with adaptation for 60 seconds, still with `aurora=0`. The final
stage enables aurora separately on both WebGL2 variants at fixed resolution.

The metric is final canvas draw submission cadence. Both APIs lack GPU timer
queries on this Pixel. The renderer caps output at 24 fps; no readback, `finish`,
or GPU wait runs during timing. These numbers are not GPU execution times.
They do not establish visual equivalence between Compact and reconstructed
clouds. Battery temperature and Android thermal state accompany every run;
this is a paired practical comparison, not a thermally normalized benchmark.

## Fixed resolution, aurora disabled

| Variant | Forward fps | Reverse fps | Mean fps |
| --- | ---: | ---: | ---: |
| Compact / WebGL1 | 10.95 | 10.80 | 10.87 |
| Compact / WebGL2 | 10.85 | 10.75 | 10.80 |
| Half-cloud / WebGL2 | 17.85 | 17.84 | 17.85 |

Changing only the API showed no speed benefit here: the means differ by 0.7%,
less than the drift between Compact repeats. Half-cloud rendering raised the
observed cadence by about 65% relative to Compact/WebGL2 at the same resolution.
It still did not reach 24 fps at full resolution. This supports keeping Compact
as the default while treating half-cloud reconstruction as a separate image and
performance trade-off.

The benchmark checks the actual `data-render-api`, `data-render-profile`,
`data-cloud-pass`, and `data-aurora` values. Both fixed repeats used identical
618×1248 buffers and stayed visible, with no WebGL or asset errors.

## Adaptive and aurora runs

With the baseline controller and aurora disabled, the 60-second adaptive runs
had the following cadence and scale ranges after the first 10 seconds:

| Variant | fps | Scale range |
| --- | ---: | ---: |
| Compact / WebGL1 | 23.80 | 45–55% |
| Compact / WebGL2 | 23.78 | 46–56% |
| Half-cloud / WebGL2 | 23.99 | 65–80% |

This again shows no useful API-only gain. It does not measure the new controller.
The common fixed viewport is larger than the older 593×1196 Pixel captures,
so these scale ranges must not be substituted into those acceptance results.

Enabling aurora on WebGL2 in the same scene gave 9.85 fps for Compact and
14.24 fps for half-cloud at full resolution. Both selected `aurora=volume` and
completed without errors. These runs came last, without a matched warm
control, so the difference is not an isolated measurement of aurora cost.

All 11 runs remained foregrounded and had zero GL/asset errors. Android thermal
status stayed 0; battery temperature rose from 27.1 to 36.1°C during the run.
The phone was charging. No energy or sustained thermal performance claim follows.
[Raw samples, capability checks, temperatures, and client hashes](evidence/orbital-pixel-api-2026-10-10.json)
include every interval, including the startup periods omitted from summaries.

## Reproduction

Build the intended revision and serve its immutable output. Forward the chosen
port to the phone and Chrome's debugging socket to localhost:9223, unlock the
phone, and leave Chrome foregrounded:

```sh
bun scripts/benchmark-device-api.mjs http://127.0.0.1:4350 /tmp/orbit-device-api
```

`DEVICE_API_CASES` selects comma-separated case names, for example
`adaptive-compact-webgl,adaptive-clouds-half-webgl2`. `DEVICE_API_SECONDS` can
override run length in 5-second steps from 15 to 180 seconds. The script checks actual
API/profile/half-pass selection, records loaded client hashes, rejects hidden
runs or fixed-buffer changes, and restores the original keep-awake setting.
