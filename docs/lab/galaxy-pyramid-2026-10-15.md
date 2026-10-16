# Milky Way tiles without seams, 2026-10-15

Raising the exposure made the streamed galaxy tiles glow against the overview
around them. Numbers are in the [evidence file](evidence/galaxy-pyramid-2026-10-15.json);
the [comparison image](evidence/galaxy-pyramid-2026-10-15.jpg) shows one view
before and after.

## Cause

The shader displays `pow(texel, 3.3)`. Three steps averaged *encoded* texels,
and by Jensen's inequality each one moved displayed brightness:

1. **Tile builder.** It matched tile detail to the overview with a Laplacian
   residual in encoded values. Encoded means agreed within 0.1 of a byte, but
   displayed radiance at full tile resolution ranged from 0.43 to 2.64 times
   the overview (p10–p90, median 1.58).
2. **Runtime mipmaps.** Tile levels came from `createImageBitmap` resizing,
   which averages encoded bytes. Brightness therefore depended on the lens
   zoom: at level 2, where the tiles fade in, the median dropped to 0.81.
3. **AVIF compression.** The codec smooths encoded texels. At quality 50 it
   dimmed 10% of 16-texel blocks of the 4K overview by more than half.

On top of that, 166 regions had no tile at all (`maximum < 8`), so the
overview showed there.

## Change

`scripts/build-galaxy-tiles.mjs` now builds the whole pyramid from the NASA
16K file:

- **Grade.** It is applied once, to flux averaged to 4K, where it was tuned.
  Applied per 16K pixel, the toe erased faint light that the 4K plate keeps.
  The graded result becomes a local gain (radiance per unit flux), which is
  interpolated onto the 16K flux.
- **Overviews and mipmaps.** The 4K and 8K overviews and all four tile mip
  levels are box averages of that one radiance field. Tile cells start at
  multiples of 16, so mip level 2 of a tile is the overview texel.
- **Tile format.** Mipmaps ship inside each tile (1088 × 544, atlas layout).
  `SurfaceTiles` uploads them without resizing, as it already does for
  terrain. The manifest version is now 2, so mismatched assets fall back to
  the overview.
- **Compression.** AVIF encoding compensates its own radiance loss. Each
  image is encoded up to four times. Before each new encode, the input is
  scaled by the locally lost radiance (damped), and the build keeps the best
  encode. For the 4K overview at q50, this costs 472 KB against 431 KB
  without compensation. Reaching similar block accuracy by raising quality
  alone needs q90, which is 2.2 MB.
- **Coverage.** Only tiles that are entirely black are omitted (411 tiles
  remain instead of 346).
- **Compact overview.** `mobile/galaxy-2048.avif` is now made from 2 × 2
  radiance averages.

## Result

Displayed radiance of tile levels over the 4K overview, p10 / median / p90
across tiles:

| Level | Before | After |
| --- | --- | --- |
| 0 (closest zoom) | 0.43 / 1.58 / 2.64 | 0.97 / 1.000 / 1.05 |
| 1 | 0.43 / 1.04 / 1.25 | 0.95 / 1.000 / 1.04 |
| 2 (fade-in) | 0.43 / 0.81 / 1.00 | 0.94 / 1.000 / 1.02 |

The broad look is unchanged. New over old overview radiance in 16 × 16
blocks: median 1.006, p10 0.91, p90 1.18; the whole sky is 0.987.

Rendered with tiles on versus `galaxyDetail=0`, same view, headless Chrome on
ANGLE/Metal, linear light (frame mean, then p10 / p50 / p90):

| View | Before | After |
| --- | --- | --- |
| Lens 1×, +4 EV, Galactic centre | 1.007 (0.98 / 1.01 / 1.07) | 0.996 (0.97 / 1.00 / 1.01) |
| Lens 3×, +2 EV, l = −25°, b = −4° | 1.056 (1.01 / 1.08 / 1.20) | 0.968 (0.92 / 0.96 / 0.99) |

Before the change, the tiles formed bright patches up to 40% above their
surroundings. Afterwards there is no tile-shaped structure.

At 3×, a uniform 3–4% difference remains. The nine tiles in view match the
overview within 0.2% at asset level, and the difference does not change with
exposure. It is the camera and display chain responding to four times more
resolved detail than the magnified 4K overview, not a brightness mismatch.

**Bytes:**

- Tiles grow from 21.6 MB to 26.9 MB, because of the packed mip levels and
  the 65 added faint tiles.
- The 4K overview shrinks from 569 KB to 483 KB, and the compact overview is
  303 KB (was 308 KB).
- What a view downloads is unchanged in structure: the bounded atlas holds
  at most 17 tiles. At 1× toward the Galactic centre, 2.0 MB against 1.8 MB
  before.

## Limits

- Exactness holds per 4 × 4 block of the 16K field before compression. AVIF
  still adds per-texel noise (median per-texel radiance error about 50% at
  level 2), which compensation only removes on average over 8 × 8 blocks.
- `verify:scene` passed through the texture-crop checks. The later flight
  step failed in `flight-browser-fixture.mjs`, which another change in this
  working tree was editing at the time. It does not involve galaxy tiles.
- The new assets need a published manifest before the explorer or the
  personal site can use them. Publishing is separate from this change.
