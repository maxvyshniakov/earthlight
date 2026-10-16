# Orbital asset compression experiment

Measured 6 October 2026 against the then-current JPEG textures. After reviewing
the comparison, AVIF quality 50 was selected for both production sizes.
The full star catalog remains unchanged. Tables below preserve the experiment's
original JPEG baseline and recommendations.
Full measurements: [orbital-asset-benchmark.json](evidence/orbital-asset-benchmark.json).
Local comparison: http://127.0.0.1:4339/bench/comparison.html (requires the
benchmark server and generated files; not a published site route).

## Recommendation

AVIF quality 65, effort 4, 8-bit, 4:4:4 is the best tested compromise for this
scene's fine detail and transfer size: 7.05 MB at 8K, 1.26 MB at 4K, roughly
half the current JPEG sizes. Quality 80 is the conservative choice for closer
fidelity, but saves only 20% at 8K. Quality 50 saves 72% at 8K but visibly
softens the finest texture when enlarged. These are scene-specific conclusions,
not equivalent quality scores across codecs or an exhaustive optimum.

Keep the full star catalog. A prototype 16-byte record saves more than cutting
at magnitude 6.5 while preserving every star. It needs a versioned asset and
loader change before adoption; no production loader changes were made here.

## Texture method and results

Input: original NASA galactic EXR, not the existing JPEG. Normalize 8K pixel
flux by 4, clamp to [0,1], encode gamma 1/2.2 into RGB8 exactly as the current
converter does. Lossless PNG of these bytes is the comparison reference.
This comparison isolates delivery-codec loss, not the earlier EXR-to-RGB8 loss.
No rescaling, denoising or sharpening. AVIF uses 8-bit because the shared
reference is RGB8; higher-bit-depth EXR delivery was not evaluated.

Encoders: sharp 0.35.5, libwebp 1.6.0, libaom 3.15.1, libheif 1.23.5.
WebP uses effort 6 and smartSubsample; JPEG candidates use mozjpeg and 4:4:4;
AVIF uses effort 4 and 4:4:4 except the explicitly marked 4:2:0 candidate.
Current JPEG uses FFmpeg mjpeg `-q:v 2 -pix_fmt yuvj444p`.
See [sharp options](https://sharp.pixelplumbing.com/api-output/),
[WebP options](https://developers.google.com/speed/webp/docs/cwebp), and
[AVIF encoding options](https://aomedia.googlesource.com/libavif/+/e3caeeeac4afc6befa437ee54474e257021274e4/doc/avifenc.1.md).

| 8K format | File MB | Saving vs current | Night frame RGB RMSE, 0–255 |
|---|---:|---:|---:|
| Current JPEG | 13.46 | — | 0.486 |
| JPEG q80 | 6.52 | 52% | 0.860 |
| JPEG q90 | 11.11 | 17% | 0.628 |
| WebP q80 | 8.87 | 34% | 0.655 |
| WebP q90 | 13.44 | <1% | 0.518 |
| WebP q95 | 17.73 | −32% | 0.448 |
| AVIF q50 4:4:4 | 3.76 | 72% | 0.960 |
| AVIF q65 4:4:4 | 7.05 | 48% | 0.632 |
| AVIF q80 4:4:4 | 10.78 | 20% | 0.496 |
| AVIF q65 4:2:0 | 7.00 | 48% | 0.635 |

4:2:0 saves only 43,956 bytes versus 4:4:4 at AVIF q65. Keep 4:4:4.
At 4K: current JPEG 2.49 MB, WebP q80 1.39 MB, AVIF q50 0.54 MB,
AVIF q65 1.26 MB. All are encoded from the native 4K EXR, not downscaled JPEG.

Image-space analysis measures three fixed patches (core, dust, faint disk),
after the shader's nighttime exposure/contrast curve. AVIF q65 retains about
90% of the reference's one-pixel luma-gradient energy, q80 about 96%, q50 about
71%. This metric also counts fine source grain; it is not a standalone measure
of perceived sharpness. Visual comparison includes a 2× nearest-neighbor crop
with 3× inspection brightness so dust edges and small points can be inspected.

Rendered comparisons use the actual compiled WebGL scene at 1440×966,
`t=610.87` (night) and `t=3235.65` (day/core), with identical grain, stars,
camera and exposure. Sky metrics cover the top 77% to exclude the ground.
For night AVIF q65, only 0.043% of sky pixels differ by more than 3/255 in any
channel from the lossless reference. Low average error alone is insufficient:
use the enlarged crop to assess fine-detail loss. Day errors are in the JSON.

Browser decoding (Headless Chromium 149 on this Mac), excluding fetch/upload:
median of three samples after one warm-up, approximately 296 ms JPEG,
699 ms WebP q80, 388 ms AVIF q50, 734 ms AVIF q65, 629 ms AVIF q80.
These short local measurements are noisy and are not mobile benchmarks.
Network savings trade against slower decode. GPU texture storage is unchanged:
the current renderer expands all these formats to RGBA with mipmaps.

## Star catalog

Each current record is eight float32 values (32 bytes). Larger magnitude means
fainter. The full catalog is 15,598 stars / 499,136 bytes.

| Faintest retained magnitude | Stars | Removed | Raw KB | Raw KB saved | gzip KB |
|---|---:|---:|---:|---:|---:|
| 7.00 | 15,598 | 0 | 499.1 | 0 | 444.1 |
| 6.75 | 11,848 | 3,750 | 379.1 | 120.0 | 337.5 |
| 6.50 | 8,920 | 6,678 | 285.4 | 213.7 | 254.3 |
| 6.25 | 6,681 | 8,917 | 213.8 | 285.3 | 190.7 |
| 6.00 | 5,070 | 10,528 | 162.2 | 336.9 | 144.9 |
| 5.50 | 2,865 | 12,733 | 91.7 | 407.5 | 82.2 |

At the night frame `t=610.87`, cutting at 6.5 removes 489 catalog directions
inside the measured sky. In a five-pixel-wide neighborhood of those directions,
485 lose more than 3/255 of peak channel intensity, and 365 lose more than
8/255. At the other night frame, 312/312 removed directions exceed 3/255.
These are screenshot signal differences, not a human-visibility threshold.
They show that the removed stars are not simply absent from the rendered image.
Source positions for these neighborhood measurements omit the very small
proper-motion offset; the actual renderer includes it. See the interactive
comparison for the effect on perceived density. No frame-time speedup claimed.

The packing prototype preserves all 15,598 stars in 249,568 bytes (232,473 gzip,
220,949 Brotli). Record: int16 normalized xyz, int16 xyz velocity with 1e-9
units/year, uint16 magnitude mapped from [−2,16], uint16 B−V from [−0.5,4.5].
Overflow is checked. At the replay epoch, maximum direction error is 5.231
arcseconds, about 0.031 CSS pixels at screen center at this viewport; maximum
magnitude error 0.000138, B−V error 0.000039. This is lossy numerical packing,
not a claim of bit-identical output. No runtime decoding or visual prototype
of this packed format was implemented; it is an estimate to guide the next change.

## Reproduction

All generated images remain outside public assets. The experiments use sharp
already installed through Astro; versions are recorded in the JSON.

```sh
bun scripts/scene-asset-benchmark.mjs encode /path/to/milkyway_2020_8k_gal.exr /tmp/orbit-codecs
bun scripts/scene-asset-benchmark.mjs encode4k /path/to/milkyway_2020_4k_gal.exr /tmp/orbit-codecs-4k
bun scripts/scene-asset-benchmark.mjs serve /tmp/orbit-codecs 4339
# Set agent-browser session sky-codecs to a 1440x966 viewport first.
bun scripts/capture-scene-benchmark.mjs stars /tmp/orbit-codecs
bun scripts/capture-scene-benchmark.mjs textures /tmp/orbit-codecs
bun scripts/analyze-scene-benchmark.mjs /tmp/orbit-codecs
bun scripts/estimate-star-packing.mjs
bun scripts/build-scene-comparison.mjs /tmp/orbit-codecs
```

The server substitutes assets only in its own pages, using query parameters.
The ordinary site on port 4322 retains the existing assets and full catalog.
