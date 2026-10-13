# Regional terrain bound and lean shading, 2026-10-13

Two opt-in candidates reduce shader work without changing sampling density,
texture detail or the adaptation controller. Defaults are unchanged.

| Candidate | Switch | Change |
| --- | --- | --- |
| Regional terrain bound | `terrainBound=regional` | Start terrain intersection at the highest terrain near the ray instead of the 9 km shell; stop sunlit terrain-shadow rays once they clear that height. |
| Lean shading | `shaderWork=lean` | Skip ocean glints and lamp tints that add exactly zero, share the three sea-state noise fields between the solar and lunar glints, share one cloud-map projection per volume sample, and pass the aurora's solar azimuth as a uniform. |

## How the bound stays conservative

`terrain-bound.ts` keeps a 720 × 360 grid (half-degree cells) of maximum
heights, quantised upwards to 40 m. Every source a terrain sample can read
raises it before that source becomes visible:

- the decoded global map, reduced in the existing decode worker
  (31 ms for 4K, 95 ms for 8K on M2 Max);
- every ETOPO tile, per half-degree cell with one pixel of filter reach, read
  back from the decoded PNG through a 2D canvas;
- every DEM90 patch, as one maximum over its full-resolution square and gutters.

Values only rise. Mip levels are averages, so they never exceed level 0.
A tile whose pixels cannot be read raises its cells to "no bound". Nothing is
published until the global maxima arrive, because the global map is the
fallback under every tile fade.

Five max-pyramid levels (0.5° to 8° cells) are stored after a 3 × 3 dilation
in the unused first row of the terrain atlas, beside the page tables. No
sampler or texture is added. The shader chooses the level whose cells cover
the ground track, including filter reach and a quarter-cell allowance, then
reads one texel. Near the poles (above 78.5°), for tracks longer than 8°,
or when the atlas is released, it falls back to the 9 km shell. A unit test
checks a JavaScript mirror of this level and cell selection against brute-force
sampling of random great-circle tracks.

Intersection steps keep the existing half-DEM-texel spacing over a shorter
interval, so sample positions shift. The bound cannot change the first
crossing by itself; the shifted samples can. Shadow rays stop only once every
remaining clearance is positive, which leaves the visibility minimum unchanged.

## Measurements

Apple M2 Max, ANGLE/Metal, Chromium 149. 1248 × 615, DPR 1, fixed quality,
manual exposure 0, zero grain. `compare-ray-work.mjs` retains two renderers
and measures 40 AB/BA pairs per case, discarding the first eight. The reference
uses the default work settings. Values are medians of paired GPU-time ratios
(below 1 is faster). Raw pairs are in the
[evidence file](evidence/terrain-bound-2026-10-13.json).

| Scene | `t`, pitch | Reference | Bound | Lean | Both |
| --- | --- | ---: | ---: | ---: | ---: |
| Day, horizon | 3235.65, 0 | 14.3 ms | 0.904 | 0.943 | 0.885 |
| Night | 610.87, 0 | 11.3 ms | 0.935 | 0.945 | 0.939 |
| Clouds, Mongolian plateau | 3235.65, -25 | 21.4 ms | 0.863 | 1.011 | 0.888 |
| North Pacific | 3900, -25 | 23.3 ms | 0.938 | 0.989 | 0.873 |
| Eastern India, lowland | 2650, -40 | 23.8 ms | 0.864 | 1.002 | 0.857 |
| Tibet and Himalaya | 2780, -40 | 20.9 ms | 0.987 | 1.018 | 0.968 |

The bound saves 6–14% of the GPU frame except over the Himalaya, where the
regional maximum is close to the 9 km shell. Lean shading ratios bracket 1
(0.943 to 1.018). The Metal compiler probably removes most of this work
already, so no M2 improvement is claimed. Both columns come from separate
pairs, not from multiplying the single-candidate ratios.

| Scene, bound | Mean abs. channel diff. | Max | Changed channels |
| --- | ---: | ---: | ---: |
| Day | 0.0014 | 22 | 0.13% |
| Night | 0 | 1 | 0.00% |
| Clouds | 0.084 | 14 | 7.6% |
| North Pacific | 0.008 | 1 | 0.77% |
| Lowland | 0.049 | 63 | 4.4% |
| Himalaya | 0.155 | 111 | 12.6% |

Differences are subpixel texture changes across rugged terrain, consistent
with shifted march samples. A 1:1 crop of the clouds view shows no visible
change. Temporal differences above four levels stayed below 0.32% of channels.
Lean shading changed at most 0.023% of channels, by at most 10 levels.

## Limits

- On Intel UHD 630, terrain and the world draw took about 113 of 275 ms in the
  clouds view ([Linux GPU profile](orbital-linux-gpu-2026-10-11.md)). The
  relative saving there may be larger, but it has not been measured.
- Lean shading is unmeasured on Mali and Mesa compilers, where it may matter.
- Tile maxima use canvas readback of untagged numeric PNGs. This was checked in
  Chromium only. Firefox and Safari still need a residency and image check.
- The bound applies only to the streamed-terrain path. `terrainDetail=coarse`,
  Save-Data and devices without sixteen texture units keep the 9 km shell.

## Reproduce

With a built preview on port 4362 (`bun scripts/preview.mjs --port 4362`):

```sh
bun scripts/compare-ray-work.mjs http://127.0.0.1:4362 /tmp/terrain-bound bound,leanBound,lean day,night,clouds,ocean,lowland,himalaya
```

The settle wait now asks for DEM90 residency only where such tiles are
selected. Horizon and ocean views may select none.
