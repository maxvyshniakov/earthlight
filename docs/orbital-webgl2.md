# WebGL2 migration

`api=webgl2` opts into a native WebGL2 context. The default Compact renderer uses
WebGL1. Selecting `render=clouds-half` prefers WebGL2 automatically; use
`api=webgl` to reproduce the explicit WebGL1 path.
If creating the requested context fails, the scene requests WebGL1. The actual
backend is exposed as `data-render-api`; this must be checked before accepting
a comparison. The homepage's Orbit link preserves the API and texture choices.

The migration keeps the existing lighting model, transfer functions, ray steps,
tile layouts and camera processing. It does not introduce sRGB texture decoding,
array textures, a new cloud noise field or an atmospheric approximation.

## API differences

The shared shader submission path converts the owned GLSL sources to GLSL ES
3.00: attributes/varyings, texture functions and explicit fragment outputs.
It removes directives for extensions that moved into the core API. The original
WebGL1 source is returned unchanged. Explicit LOD and derivatives use core
WebGL2 functionality, including the aurora path.

Uploads use sized formats: scalar maps become R8/RED, byte color maps RGB8 or
RGBA8, and render targets RGBA16F/RGBA32F (RG16F for two-channel cloud metadata). All scalar samplers already read `.r`.
No byte heights are block-compressed. Renderable floating-point targets still
require `EXT_color_buffer_float`; missing support keeps the existing byte or
inline fallback. Half-cloud MRT uses native `drawBuffers`.

GPU quality control uses native query objects with
`EXT_disjoint_timer_query_webgl2`. Without it, the existing cadence estimate is
used, including small recovery probes with rollback and retry backoff. No `finish()` or readback is added to normal playback.

These API choices follow the [WebGL2 specification](https://registry.khronos.org/webgl/specs/2.0/),
[floating-point render-target extension](https://registry.khronos.org/webgl/extensions/EXT_color_buffer_float/)
and [WebGL2 timer extension](https://registry.khronos.org/webgl/extensions/EXT_disjoint_timer_query_webgl2/).

## Validation

`scripts/webgl-context.test.mjs` checks unchanged WebGL1 uploads/source, scalar
storage and subimage offsets, sized float targets, fragment outputs and core MRT.
`scripts/verify-webgl2.mjs` compares fixed day/night/cloud images for Reference,
then Compact and half-cloud rendering, before resize and context restoration.
It records pixel differences separately from capability/lifecycle assertions.

Run against a stable build, with exclusive GPU use:

```sh
node scripts/verify-webgl2.mjs http://127.0.0.1:4347 /tmp/orbit-webgl2
```

The local headless launch flags and their limitations are documented in
[the cloud experiment](orbital-cloud-prototype.md#reproduction). A numerical
comparison on the development Mac cannot establish Pixel, iPhone or Windows
compatibility. Enabling aurora on a device whose WebGL1 backend omits it also
changes that device's image and workload; it needs a separate device measurement.

## Local result on 2026-10-10

[Raw comparisons and lifecycle state](evidence/orbital-webgl2-results-2026-10-10.json)
record the native WebGL1/WebGL2 run on the development M2 Max, Chromium, at
960×600 with fixed manual exposure, zero grain and matching poses.

| Profile/view | Different RGB channel samples, out of 1,728,000 | Maximum difference |
| --- | ---: | ---: |
| Reference day | 4 | 1/255 |
| Reference night | 0 | 0 |
| Reference dense clouds | 64 | 1/255 |
| Compact dense clouds | 25 | 1/255 |
| Half-cloud dense clouds | 35 | 1/255 |

No sample differed by more than one output code. These results are close but
are not bit-identical rendering. Resizing half-cloud rendering to 801×601 and
restoring its WebGL2 context retained the 401×301 cloud target, with no failed
assets or WebGL errors. These were the original opt-in migration results. Compact still defaults to
WebGL1; the half-cloud profile now prefers WebGL2 so core MRT is available on
devices such as the measured Pixel.
