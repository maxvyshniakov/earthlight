# Streaming night lights

The homepage renders NASA Black Marble 2016 grayscale imagery at its native
500 m source resolution. The existing 4K/8K night map remains available during
loading, for the distant limb, and after a network or decoding failure.

## Data

- Source: [NASA Earth at Night maps](https://science.nasa.gov/earth/earth-observatory/earth-at-night/maps/).
- Eight grayscale JPEG plates, A1 through D2, each 21,600 × 21,600. Combined:
  86,400 × 43,200, equirectangular longitude/latitude, north at the top.
- Grayscale is emitted-light intensity. Color is supplied by the shader;
  no alpha channel, terrain backdrop, palette reduction or faint-light cutoff.
- Tiles have 540 × 540 interiors and 16 source pixels of real neighboring
  imagery on each edge (572 × 572 files). Gutters cross source-plate boundaries
  and wrap at the dateline; the polar rows clamp.
- AVIF quality 80, effort 4, 8-bit, 4:4:4, using Sharp. The source is already a
  tone-mapped JPEG composite; clipped city centers are not recovered by tiling.
- Exactly empty tiles, including their gutters, have no file or manifest entry.
  Individual source checksums and the encoded byte total are in the manifest.

The built set has 3,801 tiles totaling 20,429,109 bytes (19.48 MiB), plus a
20,133-byte JSON manifest before HTTP compression. The other 8,999 grid cells
are omitted. This is the server-side world coverage, not the page download.

The codec comparison and its limitations are in `night-lights-benchmark.md`.

## Renderer

WebGL 1 guarantees eight fragment samplers. The scene already uses seven, so
all detailed lights use one additional single-channel LUMINANCE atlas on unit 7.
Slot zero contains a 160 × 80 page table and an equally sized fade table. Each
resident tile occupies two other slots: the original tile and four separately
filtered mip levels packed beside one another (286, 143, 72 and 36 pixels).
Mip levels retain the neighboring geography in their gutters. The shader
interpolates between levels explicitly; atlas-wide mip generation would mix
unrelated regions and is not used.

- Desktop: 8 × 8 slots, 4,576 × 4,576 scalar texels, up to 31 resident tiles.
- Below 1,000 CSS pixels: 4 × 4 slots, 2,288 × 2,288 texels, up to 7 tiles.
- Smaller GPU texture limits reduce the slot count. Logical atlas storage is
  about 20 MiB desktop / 5 MiB mobile; driver allocation can differ.
- Three concurrent requests maximum. Decoded base/mip ImageBitmaps close after
  upload; there is no unbounded decoded-image cache. Normal HTTP caching remains.
- Selection samples the shared orbital camera, excludes daylight and empty
  regions, adds a neighboring-tile guard and prioritizes the nearest detail.
  Leaving the Earth behind while scrolling stops new requests.
- Seeks abort obsolete requests. Non-visible resident tiles are evicted first.
  Fetches time out after 12 seconds and failures back off for 30 seconds.
- New detail fades in over 650 ms, including while paused. Unloaded neighboring
  tiles receive a spatial blend to avoid a hard resolution boundary.
- Texture footprint selects the mip level; the distant limb blends back to the
  global map. Clouds, sunlight and atmospheric extinction still affect the lights.
- City emission is combined with the surface in approximate linear light after
  cloud/background compositing. Cloud extinction is applied once; the separate
  atmospheric ray integral supplies view-dependent extinction. There is no extra
  screen-depth fade or inverse-square factor on resolved surface radiance.
  A monotonic photographic curve lifts faint networks and rolls off city cores
  before camera exposure: p = encoded^1.45, energy = 1.8p / (1 + 2p). It maps
  zero to zero and introduces no artificial connections. The old encoded^2.2 × 6
  curve lost faint detail and saturated city centers at night exposure. The
  coarse local halo is also reduced. These are scene-specific choices; NASA's tone-mapped JPEG
  is not a calibrated radiance map, and the cloud cover is illustrative.
- Context restoration creates a new cache. Disconnecting the component aborts
  requests and releases its atlas. The detail layer never delays initial display.

For a repeatable A/B, compare `/?t=0&motion=0` with
`/?t=0&motion=0&nightDetail=0`. The component's `data-night-tiles` contains cache,
request and byte counters for local inspection. These do not include the rest
of the scene's assets or GPU allocations.

## Rebuild

Download all eight `BlackMarble_2016_{A,B,C,D}{1,2}_gray.jpg` files from NASA's
maps page into a directory outside the repository, then run:

```sh
node scripts/build-night-tiles.mjs /tmp/orbital-reference
npm run verify
```

The builder processes source plates sequentially, copies the true border strips
from adjacent plates, drops exactly black tiles and writes the manifest last.
Original 21,600-pixel maps and benchmark intermediates are not shipped.

## Verification

`npm run verify` passes 20 tests, Astro check and the static build. Tile tests
cover polar/dateline coordinates, visibility and empty-region exclusion, cache
capacity, request concurrency, eviction, decoded-image release and disposal.

Local Chromium checks at 1,440 × 966, paused at `t=0`, loaded 31 tiles totaling
180,377 bytes (176.2 KiB), excluding the manifest and the rest of the scene.
At 390 × 844, the same frame loaded 7 tiles / 44,155 bytes (43.1 KiB).
The desktop cache stayed at 31 after seeks through `t=120`, `3000`, `5000`
and back to zero. The daytime frame and scrolling past Earth requested no new
tiles. All checked draws returned WebGL error 0.

After Resume, a four-second browser sample rendered 92 frames and advanced
the displayed orbit time by 40 seconds at 10×. Forced context loss/restoration
returned to a populated atlas and a ready scene. Blocking the tile manifest
left the fallback scene ready with zero tile requests. These are local checks,
not a performance guarantee for other GPUs or networks.

## Faint networks and source limits

Three native tiles (Harare 7613, Johannesburg 8252, Paris 2961) were compared
against the original NASA grayscale plates. For source values 4–64/255, AVIF
RMSE was 2.25–2.38 levels; 1.1–4.1% fell below 2/255 after decoding. The codec
retains the main faint-light structure. The shader curve, camera shoulder and
the source's already-clipped cores account for larger visible losses. The
revised curve improves surviving detail without regenerating tiles or increasing
the network/GPU budget. It cannot restore already-clipped pixels or streets
below the approximately 500 m source resolution.

NASA's [ISS city-light examples](https://science.nasa.gov/earth/earth-observatory/cities-at-night-the-view-from-space/)
show connected illuminated roads in some regions, with substantial regional
differences. A sparse region is not filled with a procedural road network.
