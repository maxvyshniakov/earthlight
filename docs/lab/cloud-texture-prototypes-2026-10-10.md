# Cloud texture prototypes — 2026-10-10

The experiment started at `28bc009`. Three opt-in prototypes shared the
existing cloud coverage map and density model. The owner selected texture
lighting; the density-atlas and sheet variants were removed before delivery.
The tables below record the original experiment, not the final implementation.

## Predictions and decisions

- `cloudPrototype=light-atlas`: retain procedural density and replace cloud
  self-shadow integration with a baked transmission field. Expected to preserve
  silhouettes while reducing the dominant grazing-view lighting cost. Adopt: the closest appearance to the control in this experiment.
- `cloudPrototype=volume-atlas`: read both density and transmission from that
  field. Expected to be faster, with detail limited by the spatial grid. Do not ship: visibly softer than the procedural volume.
- `cloudPrototype=layers`: integrate density, lighting and mean height into four
  spherical sheets. Expected to be cheapest, but potentially flat and unstable
  at intersections. Stop this version: hard discontinuities near terrain and
  grazing edges outweigh the relatively small gain over the volume atlas.

The stopping condition is visible loss of cloud structure or discontinuities in
the explorer, including a contrasting view and light. A faster laboratory draw
alone is insufficient.

## Representation and scope

The field covers a fixed 30 by 30 degree Earth-fixed patch centered at the initial
observer. The volume has 512 by 512 horizontal cells and 32 heights from 0.6 to
12 km. A one-texel border separates atlas slices; hardware bilinear filtering
within a slice and interpolation between heights reconstruct the field.
RGBA8 stores density and solar transmission. The four-sheet representation
stores square-root-encoded optical depth, density-weighted transmission and
height. It occupies four tiles rather than 32.

These are cloud rendering alternatives, not different weather imagery. Ground,
atmosphere, terrain, lens attenuation and cloud shadows on the surface retain
their original rendering. Leaving the patch uses the original volume integral.
Lightning is not represented by the four-sheet path. This is not a global
streaming or all-weather implementation.

The first two prototypes each use 33,817,088 GPU bytes for the atlas; the sheet
atlas uses 4,227,136 bytes. The first two have identical baked payloads and could
share one stored file. The low-view gzip payloads are 4,095,707 bytes each; the
sheet payload is 1,405,154 bytes. GPU storage and compressed transfer size are
different quantities.

`cloudBake=low` loads a generated `.rgba.gz` and JSON descriptor from
`/media/orbit/cloud-prototypes/low-<prototype>.*`. Browser verification confirmed
zero runtime bakes and SHA-256-identical GPU bytes after export, compression,
download, inflation and texture upload. The loader handles both HTTP
Content-Encoding inflation and static hosts returning the compressed body.
The generated files are local artifacts, outside the tracked source tree.

Without that parameter, the prototype bakes after cloud assets settle. A change
of more than 60 simulated seconds or sufficiently changed sunlight invalidates
the snapshot and permits another bake. Bake scheduling, global tile streaming,
cache filtering across viewing scales and memory reduction remain open work.

## Controlled comparisons

The failing view was reconstructed at 150 km, latitude 5 N, longitude 76.9 W,
heading 142 degrees, pitch -14 degrees, roll zero and the wide lens. Daylight is
2026-10-10 18:57:59 UTC. The contrasting downward view uses pitch -70 degrees;
the low-sun view uses 22:35:00 UTC. Every capture uses manual -0.5 EV and zero
grain, with fixed quality and a 1600 by 1076 canvas.

Apple M2 Max / ANGLE Metal / WebGL1, asynchronous whole-frame GPU queries:
eight warmup AB/BA pairs discarded, 32 retained. The harness asserts exactly 40
submitted final-canvas draws per side, identical camera/basis/dimensions, settled
assets and zero asset failures. Disjoint queries and GL errors reject the run.
The baked atlas must actually be ready. Preparation and readback occur outside
the timing window. This is GPU frame cost, not measured compositor presentation.

| View | Paired control range | Light atlas | Volume atlas | Four sheets |
| --- | ---: | ---: | ---: | ---: |
| Low horizon | 93.62–99.58 ms | 44.80 ms | 32.38 ms | 27.80 ms |
| Downward | 74.69–76.67 ms | 62.86 ms | 56.45 ms | 53.03 ms |
| Low sun | 95.75–103.05 ms | 56.19 ms | 42.09 ms | 35.42 ms |

Median paired speedups in the failing view are 2.19, 3.03 and 3.36 respectively.
The downward case shows that removing cloud cost does not remove the underlying
world/terrain cost. These observations do not establish mobile performance,
sustained thermal behavior or battery savings.

The motion comparison replays the same 25 camera poses, yawing through six
degrees, with stored atlases. Each actual camera basis is asserted against the
requested pose, with zero GL errors. The video uses a common 12 fps playback
rate and reverses the sequence to loop: it examines appearance in motion, not
the renderers' live frame rates. The imagery and GPU results are separate.

## Prototype archive

The comparison commands and opt-in parameters in this section belong to the
archived prototype sources, not the shipping renderer.

The local review artifact contains the nine comparisons, full-size images,
an A/B divider, matched motion, stored atlases, source hashes and the export/replay
script. The links to live explorers preserve each view's camera, time and look.
`cloudLab=1` enables pose replay and texture export only for this experiment.

## Validation

- `bun run verify`: 181 tests passed; Astro check reported no errors or warnings
  and four existing unused-import hints in `scripts/fetch-assets.mjs`; build passed.
- Nine controlled GPU comparisons completed with valid dimensions, camera state,
  readiness and GL checks. The final four-sheet encoding was remeasured separately
  for the low view; superseded measurements are not used in the table.
- All three stored textures round-tripped exactly and replayed 25 matched poses.
- `bun run verify:scene`: the ordinary scene browser suite passed, including
  lighting, seven scene frames, asset fallbacks, context restoration, motion,
  camera/flight/touch and calendar checks. Its motion sample submitted 23.83 fps
  at scale 1 with zero GL errors. This is the unchanged default, separate from
  the prototype costs above.
- The review page loaded every variant and played the matched-pose video at
  1280px and 390px layouts, without horizontal overflow or browser errors.


## Selected implementation

Compact now defaults to cached cloud self-lighting. `cloudLighting=raymarch`
retains the exact previous lighting path for controlled comparisons. Other
render profiles remain controls. No prototype pose/export hooks or hardcoded
stored scene files are installed in the product.

The cache keeps the original 32 heights but packs four adjacent heights in
RGBA. Eight 512 by 512 guttered tiles form a 2048 by 1024 texture. Two buffers
occupy 16 MiB together; only the completed buffer is sampled. A replacement
bakes in 64 bounded draws, one 512 by 64 stripe per scene frame. The paused
explorer schedules those frames too and stops once the atlas is complete.

The 30-degree patch follows the camera with margin for preparing its successor.
Coordinates rotate with the cloud material, so cloud drift does not require a
fresh bake every simulated minute. Changes in cloud assets or sunlight request
a replacement. Large jumps invalidate the old light immediately. Patch edges
blend into the traced fallback. Above 1,529 km and within 15 degrees of the
poles the renderer uses traced lighting. Unsupported texture limits, too few
samplers or failed atlas allocations also retain traced lighting.

Density, silhouette, ground shadows, lens transmission, exposure and scene
resolution keep the existing paths. Cached self-light is approximate and can
soften fine shadow structure. The cache is generated locally from the existing
cloud map and current sunlight; no additional downloaded dataset is required.

Reproduce the selected pair with:

```sh
bun scripts/compare-cloud-lighting.mjs http://127.0.0.1:4339 /tmp/cloud-lighting texture low,nadir,sunset
```


Selected implementation measurements, same hardware and fixed 1600 by 1076
canvas (32 retained AB/BA pairs):

| View | Traced lighting | Texture lighting | Median paired ratio |
| --- | ---: | ---: | ---: |
| Low horizon | 88.07 ms | 42.84 ms | 0.500 |
| Downward | 69.38 ms | 59.72 ms | 0.849 |
| Low sun | 86.50 ms | 51.20 ms | 0.571 |

These steady-state timings exclude cache preparation. The selected path's
lifecycle check measures individual bake stripes separately and checks paused
completion, idle draw count, relighting, playback and context restoration on
WebGL1 and WebGL2:

```sh
bun scripts/verify-cloud-lighting.mjs http://127.0.0.1:4339 /tmp/cloud-lighting-lifecycle
```


The complete scene browser suite passed on the selected renderer: seven
reference frames, missing assets, queued uploads/context restoration, viewport
rotation, constrained capabilities, save-data, focus, optics, camera, flight,
touch and calendar. Its ordinary motion sample submitted 23.83 fps at scale 1
with zero GL errors. This is distinct from the fixed-resolution horizon pairs.
The final verification includes 190 passing tests, no Astro errors or warnings,
the four pre-existing import hints, and a successful production build.


The final WebGL1 relighting probe recorded 64 bake stripes, 14.77 ms median
and 78.91 ms maximum GPU time per stripe at the low-sun fixture. This cache
therefore does not eliminate every update-time spike; the twofold horizon gain
is the warmed steady-state result. Further bake-cost work should preserve the
accepted image and measure the update frames, not only cached draws.

WebGL1 and WebGL2 both passed the final cache lifecycle check. After explicit
context loss each rebuilt generation 1, then advanced to generation 2 during
playback. Settled paused scenes submitted zero draws over the idle probe.
Raw paired and lifecycle measurements are in the adjacent `evidence` folder.
