# Black Marble night-light experiment

This experiment compares NASA's real 500 m imagery with the site's global 8K
night map. Production rendering and assets are unchanged. The lab includes
interactive image comparisons and a regional overlay using the site's Earth
fragment shader and SGP4 camera.

## Source and scope

[NASA Black Marble maps](https://science.nasa.gov/earth/earth-observatory/earth-at-night/maps/)
include a grayscale light-only layer and a color visualization.
The experiment uses 2016 B2: 90°W–0°, equator–90°S, 21600×21600.
Source URLs, SHA-256 and encoder versions are in [the raw evidence](evidence/night-lights-benchmark.json).
These are published JPEG composites, not raw radiance: source compression
and clipped city-center highlights are already present. “Lossless” below
means lossless relative to that decoded JPEG.

Four 1024×1024 patches form one 2048×2048 test atlas: Buenos Aires / Montevideo,
São Paulo, Santiago and empty South Atlantic. No sharpening, added lights or
terrain extraction is applied to the grayscale source.

## Formats and quantization

| Encoding | Bytes | Active-pixel RMSE (0–255) | Relative edge error |
| --- | ---: | ---: | ---: |
| Grayscale PNG | 520,712 | 0 | 0% |
| PNG, 16 levels | 145,102 | 4.95 | 18.6% |
| PNG, 32 levels | 225,582 | 2.48 | 10.3% |
| PNG, 64 levels | 316,488 | 1.16 | 5.4% |
| WebP lossless | 392,786 | 0 | 0% |
| WebP near-lossless Q80 | 338,372 | 0.64 | 3.0% |
| WebP Q90 | 173,872 | 2.34 | 10.9% |
| AVIF Q50 | 77,150 | 6.40 | 27.2% |
| AVIF Q65 | 105,846 | 3.87 | 17.6% |
| AVIF Q80 | 152,805 | 2.23 | 10.6% |
| AVIF Q65, half dimensions | 37,022 | 25.88 | 92.1% |

RMSE includes only reference pixels ≥4/255, so black space does not overwhelm
the score. Edge error is the RMS difference of neighboring pixel gradients
divided by reference gradient RMS, not a perceptual score. Smaller variants
are bilinearly reconstructed before measurement. PNG explicitly quantizes
uniform brightness levels without dithering; AVIF uses 8-bit 4:4:4.

AVIF 80 is the best tested size/detail compromise. WebP near-lossless preserves
subtle light structure better. Reducing spatial resolution loses much more
fine detail than moderate compression. A 32-level PNG is larger than AVIF 80
at similar measured edge error.

A constant-color RGBA WebP-lossless overlay, with intensity in alpha, costs
485,178 bytes versus 392,786 for scalar WebP. Alpha is unnecessary for additive
emission: black already contributes no light. Color AVIF 50 costs 104,599 bytes
versus 77,150 for grayscale, but includes terrain and different tone processing;
these are not equivalent reference images.

In this renderer an 8-bit scalar GPU texture occupies one byte per texel.
Palette PNG or compressed file size does not reduce decoded texture storage.
Warm light color can remain in the shader.

## Empty space and tile budgets

For the entire B2 tile:

- Exactly black: 456,971,725 / 466,560,000 pixels (97.94%).
- Exactly empty 512px blocks: 1464 / 1849 (79.18%); edge blocks are smaller.
- A ≤3/255 threshold only skips four additional blocks. Their discarded
  brightness is 268 / 223,345,788 (0.00012%). Prefer exact-empty skipping.

The test overlay covers 34.13°×34.13° of southern South America, starting at
77°W, 14°S, at 8192×8192 native pixels. It contains 172 nonempty 512px tiles:

| Layout | AVIF 80 | WebP near-lossless |
| --- | ---: | ---: |
| Whole regional image | 981,473 B | 2,480,298 B |
| All 172 nonempty tiles | 889,032 B | 2,293,562 B |
| Estimated view t=0, 75 tiles | 333,218 B | 852,132 B |
| Estimated view t=120, 69 tiles | 296,979 B | 745,298 B |
| Estimated view t=180, 42 tiles | 157,259 B | 401,086 B |

Estimates sample real camera/Earth intersections plus a one-tile guard band;
they are not a production visibility algorithm. Sizes exclude gutters,
manifests, HTTP overhead and prefetch. These results describe this region,
not every view or the whole Earth. A 75-tile scalar working set would occupy
25 MiB including mipmaps, versus 85.3 MiB for the entire regional texture,
before atlas padding.

## Rendering and limits

Both views use the same surface shader, camera, sunlight, clouds and atmosphere.
The right view substitutes regional emission inside its geographic bounds with
a narrow edge blend. The sky, grain and camera postprocessing are omitted so
surface detail is easier to compare. Clouds can be disabled for inspection.
The grayscale exposure is adjustable (default 0.55) because NASA gray/color
products have different tone curves; this is not a radiometric calibration.

At t=0 Santiago resolves into smaller connected structures instead of broad
blobs. Oblique viewing and distance still limit horizon detail.

The preview loads the whole regional texture, not the generated sparse tiles.
Production integration still needs geographic selection, a bounded GPU cache,
request scheduling, gutters for filtered seams, mip transitions and the global
low-resolution fallback. The experiment does not change the main page.

## Reproduce

Requires Node 24, project dependencies and both NASA B2 source JPEGs.
Keep large source and comparison assets outside the repository.

1. Run node scripts/night-lights-benchmark.mjs /path/to/BlackMarble_2016_B2_gray.jpg /path/to/BlackMarble_2016_B2.jpg /tmp/night-lights-lab
2. Run node scripts/tile-night-lights-lab.mjs /tmp/night-lights-lab
3. Run node scripts/serve-night-lights-lab.mjs /tmp/night-lights-lab 4340
4. Open http://127.0.0.1:4340/. Measurements are available at /bench/results.json.

The server binds to loopback and does not publish the experiment.
