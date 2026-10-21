# Ocean sea-state prototypes

The original Cox–Munk reflection produces a broad, smooth highlight. These
opt-in experiments change its spatial slope variance, retaining the existing
Fresnel, masking, solar/lunar geometry, atmosphere, cloud shadows and exposure.
They are visual prototypes, not observed wind or current data. No default
ocean appearance is changed.

## Reference targets

- [Sunglint Around Milos and Antimilos](https://eol.jsc.nasa.gov/Collections/EarthObservatory/articles/SunglintAroundMilosandAntimilos.htm):
  ISS067-E-153817, 25 June 2022, Nikon D5, 400 mm. Curved filaments, gyres and
  internal-wave packets. The published image is cropped and contrast-enhanced;
  its close framing must not be copied literally into a wide orbital view.
- [The Subtleties of Sunglint](https://science.nasa.gov/earth/earth-observatory/the-subtleties-of-sunglint-151456/):
  MODIS, 6 May 2023. Broad dark low-wind water inside the bright glint. Calm
  water can be bright or dark according to source/view geometry.
- [Mediterranean Sunglint](https://science.nasa.gov/earth/earth-observatory/mediterranean-sunglint/):
  ISS062-E-44814, 21 February 2020, Nikon D5, 58 mm. An oblique view of Corsica
  and Sardinia, including sheltered bright coastal water. Used to assess
  perspective, regional scale and separation from cloud shadows.
- [Internal Waves in the Indian Ocean](https://science.nasa.gov/earth/earth-observatory/internal-waves-in-the-indian-ocean-44567/):
  EO-1, 6 March 2007. Local packets of curved parallel bands. These are not
  justification for coating the entire ocean with regular rings.

The retained `advected` candidate follows three visual observations: strong
calm regions are sparse, boundaries have different widths, and smaller
structures have lower contrast than the main transition. The photos contain
several causes of roughness differences, including wind, currents and surface
films. This experiment copies their spatial character, not those mechanisms.

The initial `regions`, `fronts` and `combined` trials are retained for comparison.
Their broad blobs and uniformly elongated corridors were not convincing.
Subsequent transport trials were rejected for large vortices, fractured edges,
and marble-like stripes across the entire ocean. A sharper multi-octave
boundary trial also looked like a surface coating. The retained version reduces
transport, separates regional variation from fine structure, varies transition
width, and limits strong calm patches to larger, irregular envelopes.

## Variants

| Query | Character | Field |
| --- | --- | --- |
| no `ocean`, or `ocean=original` | Existing water | Existing procedural wind |
| `ocean=regions` | Broad calm patches | Global Earth-fixed field |
| `ocean=fronts` | Elongated calm corridors | Seamless periodic material field |
| `ocean=combined` | Stronger mixture of patches and corridors | Same periodic field |
| `ocean=advected` | Sparse calm areas with transported boundaries and weak fine structure | Periodic material field |
| `ocean=advected&oceanResolution=1024` | Smaller memory comparison | Same model, quarter-size atlas |

The field is baked on the GPU once at renderer initialization and rebuilt on
context restoration. Per reflection evaluation, a footprint-filtered texture
lookup replaces three procedural noise evaluations. The field stores speed
and double-angle direction; it does not store the final highlight, so changing
the camera or Sun still changes the reflected light. This uses the same general
caching approach as cloud lighting, but a static sea-state field needs no
continuous or camera-following rebake.

Default experimental atlas: 2048×1024 RGBA8 with mips, 11,184,812 bytes
(10.67 MiB). Optional 1024×512 atlas: 2,796,204 bytes (2.67 MiB). No additional
network asset is required. Fronts/combined repeat about every 10,000×5,000 km
at the equator; advected repeats every 5,000×2,500 km. Repetition and direction
are synthetic, not climatology.

The advected bake backtraces a scalar field through a smooth synthetic curl
field using 20 midpoint steps. This is a static construction, not a running
fluid simulation. Periodic gradient noise with analytical derivatives avoids
lattice discontinuities. Separate frequencies control the regional envelope,
calm-area boundaries and weak fine variation. Three fine octaves reduce the
single-frequency, wood-grain appearance of an earlier trial. No painted
brightness is applied to the ocean color.

Sampler 14 is borrowed from the detailed galaxy atlas in these opt-in
experiments; the global galaxy overview remains. Matched comparisons disable
galaxy detail on the control too. An eventual production implementation needs
a sampler allocation that preserves all enabled features. Missing explicit
LOD, fewer than 15 fragment texture units, or insufficient texture size keeps
the original ocean. Failed allocation follows the renderer's existing startup
failure path; this prototype has not introduced an allocation-retry policy.

## Reproduce

Use Bun 1.3.14 and the normal local asset installation:

```sh
bun run verify
bun run preview --host 0.0.0.0 --port 4395
bun scripts/compare-ocean-prototypes.mjs http://127.0.0.1:4395 /tmp/ocean-captures wide,oblique
OCEAN_VARIANTS=original,advected,advected-1024 bun scripts/compare-ocean-prototypes.mjs http://127.0.0.1:4395 /tmp/ocean-small wide,oblique
OCEAN_VARIANTS=advected bun scripts/compare-ocean-prototypes.mjs http://127.0.0.1:4395 /tmp/ocean-angles angle--3,angle--1.5,angle-0,angle-1.5,angle-3
OCEAN_VARIANTS=original,advected bun scripts/compare-ocean-prototypes.mjs http://127.0.0.1:4395 /tmp/ocean-aegean aegean
bun scripts/verify-ocean-prototypes.mjs http://127.0.0.1:4395 /tmp/ocean-lifecycle
```

Captures use 1200×800, compact rendering, fixed quality, manual +0.5 EV and
zero sensor grain. Time, camera, lighting and exposure match within each pair.
The cloudless pairs replace cloud density with zero in the isolated browser;
normal application controls and shader defaults are unchanged.

The wide view is 10° S, 150° E, altitude 1531 km, nadir, at
2026-10-06 01:32:27 UTC. The oblique view is at the same latitude/longitude,
420 km, heading 270°, elevation −50°, at 04:30 UTC. They test image behavior,
not a reconstruction of the NASA photographs. The angle series keeps the same
surface target (10° S, 150° E), altitude 600 km and 01:32:27 UTC lighting, with
camera longitude offsets −3°, −1.5°, 0°, +1.5°, +3°. Roll keeps north oriented
consistently. The Aegean view uses 37.2° N, 24° E, altitude 420 km, heading
180°, elevation −72°, at 2026-06-25 10:25 UTC. It is an additional geography,
not a match to the photographed Milos footprint or lens.

Set `OCEAN_FIELD_CAPTURE=1` to save the actual baked red channel with an
explicit display range of 1–8 equivalent m/s (dark to light). This image is a
diagnostic of the field, not the final reflected brightness. The view-angle
series uses actual rendered frames, without generated interpolation.

## Validation

`bun run verify` passed, including tests, Astro checking and the build.
The normal `verify:scene` passed including GPU noise continuity, asset
fallbacks, context recovery, navigation and touch. The additional advected prototype
check passed WebGL 1 and WebGL 2 startup, 1024 atlas selection, context recovery,
resize and camera movement without GL errors. Prototype captures have no asset
failures. The source baseline includes the independently completed Pixel
lattice-noise correction at `c128f5f`.

The retained candidate removes the dominant broad stripes of the earlier
prototypes. In the tested views, lower-contrast internal structure sits between
rarer calm regions, and the same feature changes visibility as the camera
moves through the glint. This is a visual judgment, not calibrated agreement
with measured ocean roughness. Island wind shadows, observed currents,
surfactant films and evolving weather remain outside this material model.
The fine filaments in the telephoto Milos photograph are not reproduced at
that photograph's resolution. Cloud-covered views naturally hide much of the
change; both normal and cloudless diagnostic captures are kept.

The additional lifecycle check initially caught a GLSL ES 3 reserved identifier
(`patch`) in the bake. Renaming it to `calmSeed` fixes WebGL 2 compilation
without changing any arithmetic. The repeated check passed startup, context
recovery, resize and movement on both APIs. Capture waits include shader
startup completion, and performance checks must assert the active ocean mode.

## Linux measurements

The lab is a Linux container: Ubuntu, Intel UHD 630, two CPU cores, 8 GiB
memory ceiling. Chrome uses hardware ANGLE/Mesa on a Weston Wayland output.
The host-owned runner serializes jobs and stops the container after completion.
Competing GPU work is checked independently before and during measurement.

**Correction to the initial report:** the previous Chrome/WebGL 1 matrix did
not enable any ocean candidate. UHD 630's WebGL 1 context did not expose
`EXT_shader_texture_lod`, so the capability gate correctly kept the original
water. The measurement script failed to assert `dataset.ocean`; all those rows
have `ocean=original` and `oceanBytes=0`. The earlier "within 0.82%" conclusion
is withdrawn. A first advected WebGL 1 run made the same fallback visible when
its state and missing bake timer were audited. Raw results are retained as
fallback evidence, not candidate performance measurements.

The corrected run uses WebGL 2 (core explicit LOD), asserts the requested
active mode, rejects missing bake timing, and brackets candidates with
original controls. API, resolution, exposure, camera and lighting are matched.
Each variant starts a fresh browser. Whole-frame timings use 24 samples after
eight warmups; surface timings use eight separate samples after eight warmups.
The bake timer covers the field draw and mip generation. Shader compilation,
asset acquisition and first-focus delay are outside that GPU timer.

The reproducible standalone job is `scripts/profile-ocean-linux.py`, intended
for the lab host's `files/browser-lab/run.py` wrapper. Pass
`--api webgl2 --scenes wide,oblique --no-motion`. The script requires Chrome
CDP to install the bake timer before application startup. A direct WebGL 1 run
on this machine fails the active-mode assertion instead of accepting fallback.

| View | Variant | Frame median, ms | Surface median, ms | Bake + mips, ms |
| --- | --- | ---: | ---: | ---: |
| wide | original | 189.81 | 86.41 | — |
| wide | advected | 189.67 | 85.44 | 141.33 |
| wide | advected-1024 | 196.12 | 86.94 | 40.57 |
| wide | control | 195.51 | 92.93 | — |
| oblique | original | 212.87 | 124.39 | — |
| oblique | advected | 212.49 | 119.81 | 141.24 |
| oblique | advected-1024 | 208.69 | 123.28 | 41.31 |
| oblique | control | 210.48 | 119.20 | — |

Chrome 155.0.8059.39, WebGL 2, 1248×615. Candidate whole-frame medians differed by −1.55% to +1.79% from the
mean of their two controls. The controls themselves shifted by 3.00% in the
wide view and −1.13% in the oblique view. This short series shows no consistent
slowdown; it does not establish a speedup, exact cost parity or 24 FPS.
The scene is still expensive at fixed inspection resolution. The 2048 atlas
costs 10.67 MiB and roughly 141 ms for its one-time GPU bake; the 1024 atlas
costs 2.67 MiB and roughly 40 ms. Initialization also includes shader compilation
and assets, so bake time must not be called total startup latency.

The completed corrected job left the lab container stopped, with autostart off. Its cgroup
reported zero memory limit/OOM events; cumulative memory pressure was 120 µs
and the reported 10/60/300-second averages were zero. No other GPU workload
was active in checks before and during the run. These remain virtual-output
GPU measurements, not physical display presentation timings.


## Phone handoff correction

The initial Tailscale live link used port 4361. That port had two listeners:
a loopback dev server in the current Earthlight checkout and a wildcard preview
server in an older temporary cloud-test checkout. Local captures reached the
former; the phone reached the latter. The external bundle contained neither
`advected` nor the `latticePermute` noise correction from `c128f5f`. Thus the
phone was displaying the old ocean and pre-fix noise, not this prototype.

The corrected handoff uses a dedicated preview bound to the Tailscale address
on port 4397. Its served bundle was checked for both changes, and a browser
loaded through that exact address reported `ocean=advected`, WebGL 2, a 2048
atlas (11,184,812 bytes), zero asset failures and zero GL errors. Paired phone
links now freeze the same camera, date and exposure. The comparison gallery's
live links were corrected too. This verifies delivery of the fix; physical
Mali rendering after the corrected handoff still requires the phone view.
The earlier Linux measurements used the separate current-checkout port 4395
and are unaffected by this port-4361 routing mistake.
