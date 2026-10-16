# Smaller startup, 2026-10-16

Follows the [load baseline](load-baseline-2026-10-15.md). Numbers are in the
[evidence file](evidence/startup-diet-2026-10-16.json).

## Changes

| Startup asset | Before | After | How |
| --- | ---: | ---: | --- |
| `earth-terrain-8192` (explorer, desktop) | 8.43 MB | 3.39 MB | DEM3 |
| `earth-terrain-4096` (explorer, mobile) | 2.54 MB | 1.11 MB | DEM3 |
| `stars-hyg` (every scene, preview priority) | 499 KB | 231 KB | STR1 + gzip |
| `optical-psf` (every scene, preview priority) | 590 KB | 84 KB | gzip |

**DEM3.** Streamed 1.85 km and 92 m terrain tiles replace global heights
wherever a pixel spans less than about 59 km. The global map's level-0
heights were therefore 5 MB of data almost never shown.

DEM3 keeps the full-resolution coastline mask and every mip byte-identical,
and the decoder repeats level-1 heights into level 0. Repeating values,
rather than interpolating them, keeps every level-1 peak in level 0, so the
regional terrain bound taken from level 0 stays an upper bound.

The mask matters. Plain 4096 maps blurred fjord coastlines visibly under sun
glint, which is why that option was rejected. The explorer uses DEM3 only
when terrain streaming is active; `terrainMap=v2` restores the old file for
comparisons.

Paired renders against DEM2 (coast glint at 1× and 4×, fjords at 3×,
Himalaya, high orbit at 1× and 8×, a 900-pixel-wide viewport) differ by a
mean of at most 0.008 levels. The only larger difference is 0.0001% of
pixels in the Himalaya view.

**Stars.** STR1 stores columns: 24-bit longitude and latitude, velocities as
half floats of value × 2^20, magnitude and B−V in thousandths. It unpacks to
the same eight floats. Errors stay under 0.1 arcsec in direction, 0.2 arcsec
of drift over 50 years, and 0.0006 in photometry
(`scripts/star-pack.test.mjs`).

**PSF.** Same bytes, gzipped. Both files decompress through
`DecompressionStream`, like the DEM.

**Main-thread stalls.**

- After each map upload, the renderer asked `getParameter` for the maximum
  anisotropy. The call waits for the GPU to finish that upload's mipmaps.
  Under software GL these waits added up to 4.5 s, plus 0.6 s for the first
  `getExtension`, both measured at 4× CPU slowdown. Both are now queried once,
  at initialization.
- The background now refuses software renderers: SwiftShader, llvmpipe,
  softpipe and similar. It requests `failIfMajorPerformanceCaveat` and reads
  the renderer name in the WebGL1 probe that already existed, so the check
  costs nothing extra. On such machines the poster stays, and no scene
  assets load. The explorer is unchanged.

## Lighthouse

Before: personal site with the vendored Earthlight `7563f27`, explorer built
from `HEAD`. After: the working tree. Both were served locally, with assets
from local servers holding the same files (the previous galaxy pyramid for
before). Medians of two runs.

**Hardware GL** (local Chrome on Apple M2 Max):

| Page | Profile | Score | TBT | Bytes |
| --- | --- | --- | --- | --- |
| Site | mobile | 89 → 87 | 78 → 101 ms | 3.41 → 2.63 MB |
| Site | desktop | 94 → 100 | 5 → 0 ms | 3.41 → 2.63 MB |
| Explorer | mobile | 69 → 49 | 130 → 156 ms | 7.39 → 5.15 MB |
| Explorer | desktop | 85 → 90 | 11 → 0 ms | 15.09 → 9.47 MB |

Mobile scores varied by up to 24 points between runs of the same build (the
explorer: 49 and 72), mostly through LCP. Read these rows for bytes, not
scores.

**Software GL**, closer to PageSpeed Insights servers:

| Page, mode | Score | TBT | Bytes |
| --- | --- | --- | --- |
| Site, GPU disabled (software fallback) | 50–54 → 89 | 155 s → 0 ms | 3.41 → 0.87 MB |
| Site, SwiftShader selected explicitly | 37–50 → 59 | 21.2 → 4.7 s | 3.41 → 0.87 MB |
| Explorer, SwiftShader selected explicitly | 34 → 34 | 47.2 → 26.5 s | 8.22 → 5.15 MB |

When SwiftShader is selected explicitly, browsers do not report it as a
performance caveat. The background then pays for one probe context before
refusing it, which is the remaining 4.7 s.

On real GPUs, the background's long tasks at 4× CPU slowdown total 137 ms
beyond the 50 ms threshold. Most of that is `initialize`, at 123 ms.
Per-frame CPU work does not reach long tasks, so caching it would not change
the score; it was left as is.

## Limits

- The baseline's 60 points and 2.9 s TBT did not reproduce today with the
  same build under hardware GL (89 points, 78 ms). That run most likely went
  through software GL. PageSpeed's own environment cannot be reproduced here.
  The deployed personal site behind Access, or after release, is the real test.
- The remaining site LCP (3.3 s, the page heading) comes from the site's own
  fonts and images, not from Earthlight.
- Software-rendered explorer sessions stay expensive by design: the explorer
  is opened deliberately and keeps rendering.
- `verify:scene` passed up to the calendar fixture. That fixture failed
  because a parallel edit to `orbital-sky.ts` in this working tree no longer
  sets `data-moon-phase`.
- New files (`*-v3.dem`, `*-v2.bin`) must be published with the asset
  manifest before deployment. Otherwise the explorer and background would
  request files that do not exist on the asset origin.
