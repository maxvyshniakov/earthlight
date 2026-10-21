# Cloud openings, 2026-10-11

**Superseded after owner review.** The .32 cutoff removed too many faint clouds
and made the full globe look sparse and dominated by dense cores. Its 9–10%
performance improvement below belongs only to that rejected version. See the
[balanced-density revision](2026-10-11-cloud-balanced.md).

The owner accepted the advected ocean and asked for more surface visibility.
In the supplied India/Sri Lanka view, the blue shape was land seen through
Rayleigh scattering. Removing clouds and their shadows did not remove it;
removing the atmosphere restored green/brown land. The atmosphere and accepted
ocean are unchanged by this experiment.

## Source and choice

The existing NASA Blue Marble plates `cloud.{W,E}.2001210.21600x21600.png`
provide photographic brightness, not measured optical thickness. The source
is unchanged; this is a revised interpretation of its coverage, not another
weather snapshot. No cloud systems were cut out and moved, and no procedural
holes were added. Existing streamed tiles and global overview remain in use.

Three lower endpoints (.20, .32, .42) were compared against .025, retaining
.94 as the upper endpoint of the smooth coverage ramp. .20 left much of the
veil; .42 removed too much intermediate structure. .32 exposes connected gaps
and retains the bright cloud cores. It does reduce intermediate cloud density,
not only binary area. The existing illustrative height profile is driven by
that revised coverage as well. This is not a claim that this preset reproduces
the globally observed cloud fraction or weather on the UI date.

A plane-parallel column audit of the 4K overview, weighted by latitude, found
that areas below 5% opacity increased from 58.9% to 81.2% at nadir and from
51.4% to 77.6% at view cosine .3. These are model estimates, not pixel counts
from the rendered scenes or measured real-world cloud cover. Missing polar
observations and mip filtering limit that audit. The dramatic opacity growth
along slanted rays explains why low photographic values can veil the surface.

## Implementation

- `clouds=broken` is the default; the user-facing name is Scattered.
- `clouds=original` retains the previous coverage exactly.
- `clouds=off` removes view extinction, scattering, ground and self shadows,
  and cloud attenuation of astronomical sources. Atmospheric attenuation stays.
- A shared shader define reaches the surface, volume, source and cached-light
  programs; the cloud-lighting cache and cloud-detail tiles are omitted in Off.
- No additional lookup, texture, render pass or loop is added to Scattered.
- The settings selector reloads the renderer through the existing scene reload
  path, preserving pose, calendar, pause and ocean mode. Reset returns to the
  default. The photo/MODIS study retains its original input and hides the selector.

## Validation

`bun run verify`: 210 tests, Astro check (0 errors/warnings, 5 existing hints),
and production build passed. `bun run verify:scene` passed, including lighting,
cloud column profiles, photographic tile seams, Mali-safe noise continuity,
WebGL fallback, asset failures, context restoration, navigation and touch.

`bun scripts/verify-cloud-presets.mjs BASE OUTPUT` captures matched Original,
Scattered and Off views for India (412×797), islands/ocean and the night side
(1200×800). WebGL 1 and 2 checks cover actual selector changes, exact camera
preservation, context loss/restoration, 390 px settings layout and reset.
An additional Off → Reset browser check passed through the Tailscale preview.
The served preview at port 4397 was checked for `clouds=broken`, active
`ocean=advected`, matching UI value and zero asset failures.

Phone comparison: `http://<tailnet-host>:4396/clouds/`. Its live links omit
fixed quality, allowing normal adaptive rendering on the phone. Screenshots
and Linux measurements use fixed quality for matched comparisons.

## Linux GPU measurements

Job `20261011T125454Z-f7fa061c` completed successfully in 4m54s. Chrome on
Wayland, ANGLE/Mesa Intel UHD 630, WebGL2, fixed 1248×615 render target,
24 measured whole-frame GPU elapsed queries after 8 warmups per case. Every
variant used the accepted advected ocean. Independent browser processes;
Original was repeated after the candidates to bound drift.

| View | Original before | Scattered | Off | Original after |
| --- | ---: | ---: | ---: | ---: |
| India, high orbit | 77.12 ms | 69.98 ms | 39.45 ms | 78.10 ms |
| Ocean, oblique 420 km | 213.92 ms | 195.20 ms | 112.85 ms | 217.17 ms |

Against the mean of the surrounding controls, Scattered reduces frame GPU time
by 9.83% and 9.44%; Off by 49.17% and 47.65%. Control drift was 1.27% and 1.52%.
This establishes improvement in these two views, not a universal frame-rate
claim or a physical-phone measurement. The full fixed-resolution scenes are
still expensive; normal live links retain adaptive quality.

No new texture memory is required by Scattered. Off avoids the 16 MiB cloud
lighting cache and cloud-detail atlas. Asset/GL errors were absent. No other
GPU workload was active at preflight, midpoint or completion. The guest reported
no OOM/limit events and zero pressure averages. After the wrapper completed,
the lab container was confirmed stopped.

Artifacts (local):
`~/.codex/visualizations/2026/10/11/01a12a81-c208-7563-88aa-79cb253024ad/cloud-openings/`.
Includes matched captures, coverage audit, Linux result JSON, profiling script,
and a source snapshot. Nothing was published or committed.
