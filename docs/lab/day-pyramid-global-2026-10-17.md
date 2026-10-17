# Day pyramid, worldwide to 62.5 m, 2026-10-17

The [Cairo experiment](day-pyramid-2026-10-17.md) went to 15 m for one
region. Global 15 m was rejected as too costly, so this build takes only the
three levels below BMNG's 500 m (250, 125 and 62.5 m) over all land that the
ESA WorldCover 2021 Sentinel-2 composite covers, 60° S to 83° N. The day
colour then matches the 90 m Copernicus relief that the explorer already
streams. Everything is packaged and wired into the asset release behind
`dayDetail=sentinel`; nothing is published.

![Amsterdam from 420 km at 4×, 8× and 20×: BMNG only left, day pyramid right](evidence/day-pyramid-global-netherlands-2026-10-17.jpg)

## Verdict

**Release-ready; propose it as the default once the owner accepts about
0.3–1.9 MB per zoomed view.** Frame time shows no cost above the shared
GPU's noise. The media host answers range requests with the whole object
(checked below), so the release is repacked into single-level packs that a
view downloads whole (Whole packs, below): over the Netherlands, the Alps,
Cairo and the Himalaya a view at 2×–50× fetches 0.27–1.91 MB for
0.10–0.32 MB of tiles it draws, against 0.88–9.9 MB with the first build's
one pack per day tile. Until the owner accepts that, `dayDetail=sentinel`
stays opt-in. North of about 60° N, BMNG's own October 2004 snow removes most of
the detail (below).

## Totals

| | |
| --- | --- |
| Packs | 5,646 single-level packs (524 / 1,814 / 3,308 at levels 1–3), repacked from 4,266 day tile packs (one per day tile with detail; 155 more touched the composite and kept BMNG throughout) |
| Tiles | 259,740: 14,839 at level 1, 52,855 at level 2, 192,046 at level 3 |
| Bytes | 3,119,421,934 in packs (2.905 GiB; the day tile packs were 3,117,658,150), 11.7 KiB per tile at Q50; largest pack 1.63 MiB |
| Index | `index.bin` 68 KiB; `provenance.json`; `sources.json` 2.8 MB (every object read, its ETag and byte range) |
| Release | 5,649 files for the pyramid; 17,770 files and 3.18 GiB with this checkout's other assets (not pinned, not published), under the 19,000-file and 25 MiB limits. The first build's release had 16,381 files |
| Bytes read | 173.0 GiB of Sentinel-2 overviews (all 19,359 files, 2.1% of their 8.35 TiB), 0.98 GiB of land-cover overviews (2,651 files); 194.8 GiB with re-reads |
| Requests | 25,472 overview reads, each a 64 KiB header and one byte range |
| Build | 2.56 h of row builds (3.23 h with the rows rebuilt below); 3 h 42 min wall clock, fetching overlapped |

The owner's estimate was about 320k tiles and 4.7–7.1 GiB. Fewer tiles exist
because a deep tile is only written where some of it is trusted, and they are
smaller than Cairo's (14–17 KiB) because snow, water and fallback areas
compress to almost nothing. Reads came to 173 GiB rather than 1/64 of the
files (130 GiB): each 1500 px overview is stored as four padded 1024 px
tiles, about 2.1% of a file.

The build ran on a shared 12-core M2 Max whose load average stayed between
50 and 150 from other sessions, with eight build processes and 24 concurrent
range requests (21–23 MiB/s from `eu-central-1`). Rows 3–9 (83.25–67.5° N)
were built first with the gain alone and rebuilt with the final method;
their sources were read twice.

## Sources

- **Sentinel-2:** ESA WorldCover 10m 2021 v200 S2RGBNIR, 1° COGs in
  `s3://esa-worldcover-s2/rgbnir/2021/`, CC BY 4.0. Only the 1500 px internal
  overview (2.4″, about 72 m) is read: the header with one range request, then
  the overview's four compressed tiles with a second. The files are never
  downloaded whole.
- **Land cover:** ESA WorldCover 10m 2021 v200 map, 3° COGs in
  `s3://esa-worldcover/v200/2021/map/`, CC BY 4.0, read the same way at its
  2250 px overview (4.8″, about 144 m).
- **Attribution** (both): "ESA WorldCover project 2021 / Contains modified
  Copernicus Sentinel data (2021) processed by ESA WorldCover consortium",
  DOI [10.5281/zenodo.7254221](https://doi.org/10.5281/zenodo.7254221). It is
  in the explorer's Image credits (also in Info), in
  `public/media/earthlight/README.md` and in `provenance.json`, with the
  changes made (resampled, colour-matched, blended, AVIF-encoded). Nothing in
  the licence blocks publication.

**The overviews are nearest-neighbour decimations, not averages.** In
N46E007, every sample of the 1500 px overview equals full-resolution pixel
8k exactly (mean |Δ| 0 against 236 for the 8 × 8 mean). A 72 m overview
sample is therefore a 10 m point sample: fine texture aliases (fields,
streets), and the sample sits 1/16 of an overview pixel from the cell
corner, not at the pixel's centre. The builder places samples where they
were taken, which keeps the imagery registered to within a few metres of
the GLO-90 relief. Level 3 (58 m) is a bilinear upsampling of the 72 m
samples by 1.28; levels 2 and 1 are 2 × 2 means of level 3. The 3000 px
overview (36 m) would allow a real area average at about 3.5 times the reads.

**Disk.** Sources went to `~/earthlight-sources/worldcover`, one row of day
tiles (2.25°) at a time: the next row was fetched while the current one was
built, and every overview no later row needed was deleted after its row. The
largest row held 7.4 GiB of compressed overviews. Free space never fell below
200 GB (the build pauses under 60 GB). The sources are all deleted.

## Method

`scripts/fetch-worldcover.mjs` lists both buckets and reads one row's
overviews; `scripts/build-day-pyramid.mjs all` runs the rows, `index`
writes `index.bin` and the provenance. Per day tile, on its 572² window of
BMNG texels (the tile and its 16-texel gutters):

```
tile   = mix(BMNG, S2 · gain + offset, trust)
gain   = (low(BMNG) + ε) / (low(S2) + ε),   clamped to [1/8, 8]
offset = low(BMNG) − low(S2) · gain
low(x) = blur(q · x) / blur(q),  Gaussian σ = 1 texel (463 m), ε = 0.005
```

in linear light per channel. This is the Cairo lab's detail transfer with
two changes. The **offset** makes the low-pass exactly BMNG's even where ε
and the clamp bend the gain: over dark water the gain alone left the
composite's sea up to twice BMNG's brightness, and holes in it showed as
dark rectangles. **q**, the trust before smoothing, keeps snow, cloud and
holes from bending the gain of their neighbours. BMNG under a deep texel is
its cubic B-spline, the renderer's own magnification, so a texel without
trust is the picture the renderer would draw anyway, and a deep tile whose
interior has no trust is not written at all. BMNG is read from the release's
own day tiles, interiors first, so both sides of a pack edge share one
reference.

### Where BMNG stays

Trust is zero on the 500 m grid where any of these holds, then the bad
texels are dilated by two texels and blurred (σ = 1): the fallback is smooth
and at least a kilometre wide.

| Test | Rule | Land texels |
| --- | --- | --- |
| Snow and ice | land-cover class 70 covers 2–12% of the texel or more (ramp), dilated by one texel | 5.25% |
| BMNG snow over the composite | BMNG bright (luminance 0.12–0.25) and the composite at 0.4–0.6 of its usual ratio to BMNG or less | 14.47% |
| Open water | no land (any class but 80, or outside the map) within 3 km | 3.00% |
| Cloud or snow left in the median | the composite 2–3 times brighter than usual relative to BMNG and grey, or 12–35% of its samples cloud-like (blue ≥ 0.15, flat in visible and near-infrared) where BMNG is dark; built-up land (class 50) exempt | 0.44% |
| Empty composite | fewer than 60–90% of the samples hold data | 0.10% |

"Usual" is the local ratio of composite to BMNG luminance: medians of clean
texels in 16 km blocks, interpolated and held within [0.5, 2.5], the range
of snow-free tiles (Sahara 0.85, Himalaya 1.5, Alps 1.8, Amazon 1.9). Without
the hold, a tile where BMNG is snow-covered reads as normal and the summer
forest gets BMNG's snow colour: the first Siberian test showed pastel
forest texture under a white gain.

**BMNG's October snow is the largest fallback.** From 60° N to 75° N it
covers 40–70% of the land texels of each row (Scandinavia, Russia, Canada
and Alaska), and the land-cover snow class adds Greenland, the Alps, the
Himalaya and Patagonia. In the tropics the cloud tests remove 0.05–0.4%;
the WorldCover median is clean there at this scale. Built-up land had to be
exempt: before that, the cloud test removed central Manaus.

## Seams and photometry

`scripts/measure-day-pyramid.mjs`, 300 packs sampled evenly across the
index, in 8-bit sRGB steps per channel:

| Comparison | Mean | Median | 99th percentile |
| --- | --- | --- | --- |
| Level 1 averaged to 500 m against BMNG | 2.27 | 1.24 | 16.0 |
| Level 2 against BMNG | 2.49 | 1.37 | 16.7 |
| Level 3 against BMNG | 2.67 | 1.53 | 17.1 |
| Level 1 against level 2 averaged 2 × 2 | 1.84 | 1.25 | 8.7 |
| Level 2 against level 3 averaged | 1.83 | 1.25 | 8.7 |
| Level-3 gutter against the neighbouring pack | 2.38 | 2 | 10 |
| The same across 180° (8 pairs of packs) | 2.43–2.63 | 2 | 11 |
| Level-1 gutter against a BMNG-only neighbour | 0.29 | 0 | 2.2 |

Cairo's level 5 gave 3.7 / 2.1 / 21.0 against BMNG with the gain alone. The
99th percentiles sit at sharp edges (coasts, river banks, the snow line),
where 2004 and 2021 disagree by more than σ = 1 can carry.

Pack edges differ by compression (median 2) and, in about 1% of edge
samples, by up to 10 steps where the per-pack statistics (block medians)
put a trust boundary differently on the two sides. The renderer does not
average deep tiles across edges, so such a step can show as a faint line at
a 2.25° boundary near snow or cloud fallbacks. Aligning the block medians to
a global grid would remove it on a rebuild. No seam was visible in the
renders: Amsterdam's view crosses a pack edge at 4.5° E and the Fiji view
crosses 180°.

![Vanua Levu and Taveuni across 180°, 4×, 8× and 20×](evidence/day-pyramid-global-dateline-2026-10-17.jpg)

**Poles.** At 83° N (Peary Land) deep tiles load and match BMNG, which is
mostly ice there; the composite ends at 83° N with a smooth fallback.
WorldCover stops at 60° S: South Orkney (60.6° S) loads no deep tile and
draws BMNG as before.

## Renders

Straight down from 420 km at local solar noon on 8 October 2026, clouds off,
1280 × 800, centre crops of 480 × 300; BMNG only left, with the day pyramid
right; 4×, 8× and 20× from top to bottom.
`bun scripts/measure-day-pyramid-views.mjs <base> <dir> <regions> 4,8,20 --frames --compose`
reproduces them.

![Alps at the Matterhorn: snow and ice keep BMNG](evidence/day-pyramid-global-alps-2026-10-17.jpg)

The Matterhorn's snowfields keep BMNG entirely, as intended: the composite's
grey blobs and holes there (Cairo note) no longer show. Valleys gain detail.

![Sahara, Tassili n'Ajjer](evidence/day-pyramid-global-sahara-2026-10-17.jpg)

![Amazon at Manaus](evidence/day-pyramid-global-amazon-2026-10-17.jpg)

Manaus resolves its blocks, the Rio Negro shore and the meeting of the
waters; BMNG shows one blur.

![Himalaya, Khumbu below Everest](evidence/day-pyramid-global-himalaya-2026-10-17.jpg)

BMNG's October snow covers most of the Khumbu, so most of this view keeps
BMNG; the forested valley floors gain detail at 8× and 20×.

![San Francisco Bay](evidence/day-pyramid-global-coast-2026-10-17.jpg)

The coast keeps the composite's water within 3 km of land, so the shoreline,
the Golden Gate and the city grid are sharp; the open Pacific is BMNG.

At 20× and 50× a level-3 texel spans several pixels and the renderer
magnifies it with the BMNG tiles' B-spline. The 72 m point samples show as
a slightly crunchy texture in towns and fields, not as blocks.

## Runtime

`src/scripts/day-pyramid.ts` caps the pyramid at three levels
(`PYRAMID_DEPTH = 3`, an 8 × 8 cell block per day tile in the page table).
Deep tiles still share the day atlas and fill at most half of its wanted
list. The renderer loads `day-pyramid/index.bin` (68 KiB) only with
`dayDetail=sentinel`. The first build read a pack's 688-byte header with one
range request and then each tile with one more; the release now fetches
single-level packs whole (Whole packs, below). Deep tiles now use the
B-spline when magnified, like the BMNG tiles.

**Default renderer unchanged.** Without the switch the shader compiles the
same `pyramidDay` pass-through as before and no index or pack is requested;
the only change on that path is a refactored `fetch` call with the same URL.
Four views (Sahara and Amazon at 1× and 20×) rendered with the base and with
this branch differ in at most 1.1% of samples by one 8-bit step, the same as
two renders of one build (up to 1.1%, one step).

**Range reads (first build).** The Astro dev server answers 206, and so do R2
and S3 (the build's 51,000 range reads from S3 all came back 206). The
current media host, Workers Static Assets on `media.maxvyshniakov.com`,
returned 200 with the whole body to `Range: bytes=0-99` for four release
files of 0.5–107 KB.

### Frame time and bytes per view

GPU timer queries around every frame, 42 frames per view, median of the
last 36, as `bun run benchmark:scene` does, Amsterdam at nadir, three
interleaved rounds of BMNG only and with the pyramid. Bytes are the first
build's, with range reads; Whole packs, below, has the release's:

| Lens | BMNG only (ms) | Day pyramid (ms) | Paired Δ, median (range) | Day bytes, BMNG only | Day bytes, pyramid (deep) | Ranges in packs | Whole packs instead |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1× | 12.8–13.4 | 13.0–15.7 | +0.33 (−0.22 … +2.88) | 504,939 | 706,922 (201,983) | 22 in 7 | 7.4 MB |
| 4× | 12.6–13.4 | 12.6–13.3 | +0.03 (−0.11 … +0.05) | 161,561 | 477,326 (315,765) | 30 in 6 | 6.8 MB |
| 8× | 13.4–14.5 | 12.8–14.2 | −0.31 (−0.64 … +0.04) | 161,561 | 473,470 (311,909) | 27 in 3 | 2.5 MB |
| 20× | 13.2–14.4 | 12.6–14.8 | +0.42 (−0.73 … +0.62) | 128,394 | 338,475 (210,081) | 17 in 2 | 0.97 MB |
| 50× | 13.4–14.2 | 11.7–15.7 | +1.24 (−2.20 … +1.58) | 128,394 | 278,140 (149,746) | 11 in 1 | 0.88 MB |

The other regions, one round each, at 4×, 8× and 20×: 0.04–0.50 MB of deep
tiles per view (Alps 4×: 0.50 MB in 8 packs), 0.24–11.0 MB as whole packs,
and paired differences from −2.4 to +3.4 ms on 12–24 ms frames. No cost is
detectable above the ±1–3 ms that other sessions' GPU work adds; the
analytic cost is the Cairo note's 3–4 fetches per deep pixel. During part
of the session headless Chrome delivered no animation frames, so these
views ran with `AGENT_BROWSER_ARGS="--disable-gpu-vsync,--disable-frame-rate-limit"`;
the timer queries measure GPU time, not cadence.

## Whole packs

The owner keeps the media host, Workers Static Assets, which ignores
`Range` and has a file budget: `media:prepare` refuses more than 19,000
files or a file above 25 MiB, and the release has 12,112 files without the
pyramid. So the pyramid is now laid out for whole-file downloads in at most
about 6,000 files. `scripts/build-day-pyramid-packs.mjs repack` rewrites the
4,266 day tile packs (the build output, now kept in `day-pyramid-build/`
outside the release) without reading Sentinel-2 again or re-encoding a
tile, and checks every tile's SHA-256 against its source: all 259,740 tiles
are byte-identical (digest `a594e02c…3d5a` over level, position and hash, in
`provenance.json`).

**Layout.** A pack holds one level: an aligned block of 2^k × 2^k tiles of
that level, `day-pyramid/<level>/<x>-<y>.pack`, with a 12-byte header and
an offset table, tiles in row order. The smallest blocks are 2 × 2 day
tiles at level 1 (16 tiles) and one day tile at levels 2 and 3 (16 and 64
tiles). Four sibling blocks merge into one while the merged pack stays
within 0.9 MB, up to 32 tiles a side, so snow, desert edges and coasts do
not spend the file budget on small packs. `index.bin` keeps its 16-byte
entry per day tile; its three spare bytes now hold each level's k there.

| | Packs | Bytes | Largest |
| --- | --- | --- | --- |
| Level 1 (250 m) | 524 | 174,333,572 | |
| Level 2 (125 m) | 1,814 | 627,028,289 | |
| Level 3 (62.5 m) | 3,308 | 2,318,060,073 | 1.63 MiB |
| With `index.bin`, `provenance.json`, `sources.json` | 5,649 files | 3,119,421,934 + 2.9 MB | |

**Choosing it.** `scripts/measure-day-pyramid-packs.mjs` runs the
renderer's own `DayPyramid.select` on 1280 × 800 views straight down from
420 km over the Netherlands, the Alps, Cairo and the Himalaya, and over 300
random points on land, and adds up the packs each view touches. A view
draws one level: level 1 at 2×, level 2 at 4× (Amsterdam mixes 1 and 2),
level 3 from 8× up, at most 15 deep tiles (half the desktop atlas), a patch
of about 4 × 4 tiles. Candidates, all with the selection below: mean MB
per view over the four regions, and the random views' whole-pack bytes over
their tiles' own bytes:

| Layout | Files | 2× | 4× | 8× | 20× | 50× | Random, × ideal (2×–50×) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| One pack per day tile, three levels (first build) | 4,266 | 7.41 | 3.23 | 1.55 | 1.23 | 1.23 | 23.6 / 13.2 / 8.6 / 8.3 / 9.3 |
| Level 3 per day tile, levels 1 + 2 per 2 × 2 day tiles | 5,554 | 2.67 | 1.83 | 1.15 | 0.91 | 0.91 | 11.8 / 8.6 / 6.8 / 6.5 / 7.1 |
| 8 × 8 tiles of one level (L1 4 × 4, L2 2 × 2, L3 1 day tile) | 5,965 | 1.32 | 1.72 | 1.15 | 0.91 | 0.91 | 7.7 / 7.2 / 6.6 / 6.4 / 6.9 |
| As released: L1 2 × 2, L2 and L3 1 day tile, merged to 0.9 MB | 5,646 | 0.57 | 0.62 | 1.15 | 0.91 | 0.91 | 5.9 / 6.0 / 7.1 / 7.0 / 7.5 |
| Same without merging | 9,820 | 0.54 | 0.35 | 1.15 | 0.91 | 0.91 | 3.0 / 4.1 / 5.9 / 5.9 / 6.5 |

Level 3 holds 74% of the bytes and decides 8×–50×. Finer level-3 packs
(a quarter day tile, 16 tiles) would bring those views to about 0.6–0.8 MB
but need 10,000–11,600 level-3 files even with merging, so one day tile is
the finest the budget allows there. Merging is what fits finer levels 1 and
2 in the budget (they halve 2× and 4× over the four regions against 8 × 8
tiles); merging level 3 too saves 958 files and costs random views at most
0.05 MB at 8×–50×.

**Selection.** The first build loaded each view's coarser parents first and
a one-tile guard band around it; by range that cost a few kilobytes, as whole
packs it costs a second pack of another level. Now a view wants the tiles
it draws, centre first, and adds a parent or guard tile only when its pack
costs nothing more: already cached or loading, or needed by a drawn tile.
Zooming in from 4× still fades level 3 in over cached level 2. The explorer
also renders a smaller buffer while it focuses at startup, which drew one
level coarser and fetched that level's pack before the sharp view replaced
it; deep tiles now wait for a sharp frame and one selection interval
(180 ms) after it.

**Runtime.** A pack is one plain `GET`, read as a stream: each tile resolves
as soon as its own bytes have arrived. Completed packs stay in an LRU cache
bounded by bytes (48 MiB, 16 MiB on mobile); a loading pack that no wanted
tile needs any more is aborted. The atlas still uploads only the tiles it
draws, so a cached pack is what makes panning and zooming back free. Deep
tiles allow 30 s for their pack instead of 12 s.

### Bytes and latency per view

Browser runs (`measure-day-pyramid-views.mjs --modes=deep --throttle=20,50`)
through a local proxy that holds each pyramid response for 50 ms and paces
it at 20 Mbit/s; byte counts equal `measure-day-pyramid-packs.mjs` exactly.
"Ranges" is the first build's runtime reading its own selection by range;
"day packs" is that runtime on this host, fetching each touched day tile
pack whole. MB:

| View | Tiles drawn (ideal) | Release packs (n) | × ideal | First build, ranges | First build, day packs (n) | First detail |
| --- | --- | --- | --- | --- | --- | --- |
| Netherlands 2× | 0.23 | 0.43 (2) | 1.9 | 0.23 | 6.76 (6) | 83 ms |
| Netherlands 4× | 0.18 | 0.96 (3) | 5.3 | 0.18 | 2.49 (3) | 123 ms |
| Netherlands 8× | 0.21 | 0.72 (2) | 3.4 | 0.21 | 0.97 (2) | 180 ms |
| Netherlands 20× | 0.22 | 0.65 (1) | 3.0 | 0.21 | 0.97 (2) | 196 ms |
| Netherlands 50× | 0.13 | 0.65 (1) | 4.9 | 0.15 | 0.88 (1) | 147 ms |
| Alps 2× | 0.32 | 0.68 (2) | 2.1 | 0.32 | 9.92 (7) | 393 ms |
| Alps 4× | 0.27 | 0.29 (1) | 1.1 | 0.28 | 1.40 (1) | 106 ms |
| Alps 8× | 0.20 | 1.03 (1) | 5.3 | 0.20 | 1.40 (1) | 307 ms |
| Alps 20× | 0.15 | 1.03 (1) | 7.1 | 0.16 | 1.40 (1) | 245 ms |
| Alps 50× | 0.15 | 1.03 (1) | 7.1 | 0.16 | 1.40 (1) | 246 ms |
| Cairo 2× | 0.18 | 0.56 (1) | 3.1 | 0.19 | 5.56 (7) | 131 ms |
| Cairo 4× | 0.26 | 0.98 (2) | 3.8 | 0.29 | 2.53 (2) | 134 ms |
| Cairo 8× | 0.30 | 1.91 (2) | 6.4 | 0.31 | 2.53 (2) | 381 ms |
| Cairo 20× | 0.24 | 1.00 (1) | 4.2 | 0.29 | 2.53 (2) | 374 ms |
| Cairo 50× | 0.17 | 1.00 (1) | 5.8 | 0.25 | 2.53 (2) | 386 ms |
| Himalaya 2× | 0.28 | 0.61 (2) | 2.2 | 0.26 | 6.89 (6) | 147 ms |
| Himalaya 4× | 0.25 | 0.27 (1) | 1.1 | 0.26 | 1.30 (1) | 134 ms |
| Himalaya 8× | 0.18 | 0.96 (1) | 5.2 | 0.18 | 1.30 (1) | 315 ms |
| Himalaya 20× | 0.19 | 0.96 (1) | 5.1 | 0.18 | 1.30 (1) | 311 ms |
| Himalaya 50× | 0.10 | 0.96 (1) | 9.3 | 0.12 | 1.30 (1) | 313 ms |

Whole packs cost 1.1–9.3 times what ranges would; the first build's packs
on this host cost 4.6–31 times its ranges. Summed over the 20 views:
16.7 MB against 55.4 MB. A session that zooms 2× → 50× in one place with
the cache kept fetches 1.8–3.5 MB (2.8–5.2 times its 0.6–0.7 MB of distinct tiles;
day packs 5.6–9.3 MB). Over the 300 random land views the release costs
0.8–1.1 MB per view, 5.9–7.5 times the tiles' own bytes.

First detail, from the first pack request to the first deep tile in the
atlas, took 83–393 ms (median 245 ms) on the 20 Mbit/s, 50 ms link: one
round trip, the bytes before the centre tile in its pack, then decode and
upload. Ranges needed two sequential round trips (header, then tile), about
130 ms on the same link; the first build's whole day packs were only usable
once complete, 0.4–1.1 s for 0.9–2.5 MB.

**Default renderer unchanged.** Without the switch no index or pack is
requested and the shader is the same pass-through; the day atlas gets one
more argument it ignores without the pyramid. Day bytes for Sahara, Amazon
and Amsterdam at 1× and 20× are identical to the base's (270,443 to
504,939 B), and their renders differ from the base's by at most one 8-bit
step in up to 4.4% of samples, as two renders of this branch do (up to
6.1%).

## Before making it the default

- **Accept whole packs.** The owner keeps Workers Static Assets, which
  ignores `Range`; the release packs (Whole packs) bring a zoomed view to
  0.3–1.9 MB of packs for 0.1–0.3 MB of tiles drawn. Whether that is cheap
  enough for every visitor is the owner's call.
- **Publishing budgets.** `scripts/publish-assets.mjs` refuses archives over
  512 MiB and a bucket over 2 GB; this release is 3.18 GiB. Raising them is
  the owner's decision; nothing was changed.
- **A snow-free reference north of 60° N** (another BMNG month, for
  example) if detail is wanted where October 2004 is white.
- **Pack-edge statistics** on a global grid at the next rebuild, and the
  3000 px overview if the point-sample texture shows.

## Verification

`bun run verify`: 283 tests (eight for the day pyramid: keys and pack slots,
the three-level cap, pack and index round trips, selection with fallback,
the date line and the poles, the page table, and loading from a 206 host and
from a host without ranges), Astro check and build pass.
`bun run verify:scene` against this branch's dev server passes. A first
`bun run verify` run timed out two terrain tests at 5 s under the load
average of about 100; they pass alone and in the full run that followed.

## Reproduce

```bash
bun scripts/fetch-worldcover.mjs inventory ~/earthlight-sources/worldcover
```

```bash
bun scripts/build-day-pyramid.mjs all ~/earthlight-sources/worldcover public/media/earthlight/day-tiles public/media/earthlight/day-pyramid-build
```

```bash
bun scripts/build-day-pyramid.mjs provenance ~/earthlight-sources/worldcover public/media/earthlight/day-pyramid-build
```

```bash
bun scripts/build-day-pyramid-packs.mjs repack public/media/earthlight/day-pyramid-build public/media/earthlight/day-pyramid
```

```bash
bun scripts/measure-day-pyramid.mjs public/media/earthlight/day-pyramid public/media/earthlight/day-tiles --sample=300
```

```bash
bun scripts/measure-day-pyramid-packs.mjs public/media/earthlight/day-pyramid public/media/earthlight/day-pyramid-build
```

`day-pyramid-build/` holds the day tile packs and stays out of the release.
`bun run assets:prepare` then lists the release packs, the index and the
provenance in the release manifest, and refuses a release whose index and
packs disagree. `pack … --tiles=<id> --debug=<dir>` writes a day
tile's masks (trust, snow, valid, cloudy, ratio) beside BMNG and the
composite.
