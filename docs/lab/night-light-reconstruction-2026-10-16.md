# Night-light reconstruction and the 50× lens, 2026-10-16

At long focal lengths city lights broke into squares and stepped shorelines
long before the Earth's day surface showed its texels. The lens also stopped at
20×, where the resolved Moon still had map detail to spare.

![Cleveland at 8×, +2 EV: before left, after right](evidence/night-light-reconstruction-2026-10-16.jpg)

`/?epoch=2026-10-08T04:00:00Z&t=305.83&flight=free&position=.115,-.7875,.704&heading=0,0,1&elevation=0&roll=0&pitch=-90&motion=0&lens=8&look-exposure=2`,
398 km above Cleveland with Lake Erie at the top. The squares are 1 km
blocks, two of the tile's 500 m texels; shoreline steps span one or two.

## Findings

- **The night plates are 30″ data on a 15″ grid.** The horizontal and vertical
  gradient energy between neighbouring tile texels was split by the parity of
  the texel column or row (cell coordinates, with the 16 px gutter). In 13 of 14
  night tiles sampled across the set, 82–95% of it falls on even block edges,
  on both axes. The fourteenth (2177, sparse lights in northern Russia) is mostly
  codec noise. Each Black Marble 2016 value repeats in a 2 × 2 block aligned to
  the tiles; AVIF only perturbs the copies. Day tiles (BMNG) split 47–51%:
  genuine 15″ samples.
- **Bilinear magnification draws the blocks.** A linear ramp across a block
  edge, through the city curve (`encoded^1.3`) and the camera's clip, reads as
  a square with a hard rim. `nightDetail=0` (the 3 km overview, mipmapped) was
  smooth, and clouds, terrain and terrain detail switched off left the squares
  unchanged.
- **The cooler-district tint drew boxes too.** `cityLampColor` thresholds one
  octave of lattice value noise with 2.8 km cells (`smoothstep(.72,.94,…)`). Once
  resolved, each maximum appears as a pale rectangle aligned to the lattice.

## What changed

- **B-spline magnification** (`src/scripts/night-tiles.ts`): night, day and
  galaxy tiles sample a cubic B-spline of the source grid from four bilinear
  taps whenever a source sample covers more than a pixel. The weight is full at
  two pixels per sample (`1 − smoothstep(½s, s, footprint)`, where s is the
  number of tile texels per source sample). The kernel is positive and sums to
  one: it does not ring around clipped city cores, conserves the local mean and
  adds no detail. Night lights interpolate level 1 (286 px), which is the 30″
  grid itself; day and galaxy interpolate level 0. The 16 px (level 1: 8 px)
  gutters hold the taps. The tap formula is tested against the direct 16-texel
  spline (`scripts/night-tiles.test.mjs`).
- **Cost.** Magnified pixels make four atlas fetches per layer instead of two;
  the second mip fetch is now skipped when the level is integral, so minified
  views fetch the same or less. Terrain (packed height bytes) and clouds
  (sampled along every view ray) keep bilinear filtering.
- **Warped lamp tint** (`src/scripts/city-light.ts`): the 2.8 km tint noise is
  sampled at a position displaced by up to 0.8 cells by a slower noise. The
  field's value distribution, and so the share of cooler districts, is
  unchanged; the edges no longer follow the lattice.
- **50× lens** (`LENS_MAX`, `src/components/FlightHud.astro`): a 1500 mm
  equivalent. The tape gains 20×–50× with eight short ticks, keeping one pitch
  of about a sixth of an octave (40 gaps). At 50× the resolved Moon takes the
  2K map on DPR 1 and 4K on DPR 2 in an 800 px tall view; the existing 4K map
  stays at one texel per pixel or better up to about 2,300 device pixels of
  height. Nothing joins the startup plan.

## Limits

The renderer now shows the night-light data at its own resolution, and no
finer: at 50× from 400 km a 30″ sample spans about 60 pixels of an 800 px tall view, so a city is a
soft glow. That is the source's limit, not the camera's: with focus at infinity
the depth of field of a 1500 mm lens at f/8 begins about ten kilometres out, and real
long-lens frames from the ISS resolve streets. Dark lanes and exact
shorelines below 1 km cannot be recovered by filtering.

Candidates beyond this, not attempted here:

- **Built-up redistribution.** Spread each 30″ sample's flux over a fine
  built-up raster (for example GHSL built surface, 10–100 m) so lamps follow
  streets and stop at the shore, preserving every sample's total. It is a model
  of where the measured light originates and must be labelled as such.
- **Black Marble VNP46 annual composites** are gridded at 15″ from 742 m VIIRS
  pixels; whether their 15″ samples are independent has to be measured the same
  way before preferring them.
- **Clouds** stream from a 16,384 × 8,192 field; the NASA plates are 43,200 ×
  21,600 (about 2.6× finer). Rebuilding needs the source plates and a separate
  asset publication.
- **Day surface** is already the full 500 m BMNG; finer colour needs a new,
  deeper pyramid level (for example Sentinel-2 mosaics at 10 m), with
  BMNG keeping the low frequencies and photometry.

## Reproduce

`bun run verify`, then capture the URL above at 1280 × 800 with
`agent-browser`. The parity measure runs on any tile with `sharp`: sum
`|a − b|` over horizontal and vertical neighbours, split by
`(coordinate − 16) mod 2`.
