# Continuous cloud crowns and photographic coverage — 2026-10-11

This records the first iteration. The follow-up review and current implementation
are in [Cloud continuity](cloud-continuity-2026-10-11.md).

Two user views exposed different procedural artifacts in the orbital cloud
volume: high smooth lids with closed rims, and a digital-camouflage pattern
inside otherwise continuous cloud fields.

## Change

The broad regional field previously added a separate tower and a Gaussian anvil
centred at 9.3 km. Even a small regional weight could become opaque along a long
view ray, outlining the mask instead of continuing the lower cloud structure.
Deep clouds now extend the existing cumulus profile continuously. Coverage and
the same filtered cells determine the crown height; its density and vertical
feathering grow with it. The thin ice veil remains a separate translucent layer.
The opt-in texture-shaped path uses the same continuous growth rule.

The second artifact came from thresholding value noise into whole-column
opacity. Rotation of the sampling domain did not remove the lattice pattern.
Horizontal cloud breaks now come from the photographic coverage. Procedural
noise still shapes the top and contributes mild density detail; it no longer
cuts clear columns through partially covered areas. The lower edge is feathered
over 0.5 km to keep the vertical density transition smooth after removing the
opacity masks. The dense cumulus base gains up to another 0.1 km of feathering.

Both changes use the shared density function, including view integration,
self-lighting cache, traced shadows, surface shadows and lens transmission.
No new textures, noise octaves, samples, screen blur or temporal jitter are added.
This remains an illustrative reconstruction from optical coverage, not retrieved
cloud heights or a weather simulation.

## Reproduction

Save the baseline source before starting the comparison:

```sh
git show da2fb18:src/scripts/earth-clouds.ts > /tmp/cloud-tops-before.ts
bun scripts/compare-cloud-tops.mjs http://127.0.0.1:4361 /tmp/cloud-tops-final /tmp/cloud-tops-before.ts cells,north,south,low,sunset
```

The harness creates two isolated renderers with the same camera, time, assets,
resolution and exposure. Only the reference renderer receives the saved density
function. It verifies matching camera matrices, frame dimensions, zero asset
failures and valid hardware queries. Eight warmup pairs precede 32 retained
AB/BA pairs. Each side must submit exactly the requested 40 frames. Screenshot
capture and cloud-cache preparation happen outside the timing window.

`north` and `south` reconstruct the rounded screenshot telemetry at 2,616 km.
`cells` preserves the user's exact free-flight URL pose and time at about 429 km.
`low` and `sunset` check the existing 150 km fixture with cached self-lighting.
All captures use WebGL1, 1440 × 954, fixed quality, manual −0.5 EV and zero grain.
The high/polar views use the normal traced-light fallback.

`CLOUD_TOPS_CAPTURE_ONLY=1` skips timing. `CLOUD_TOPS_SHAPE=texture` checks the
opt-in texture-shaped variant; it is not the default selected by this change.

## Regression checks

The GPU density fixture sweeps a dense column across the regional transition:
the crown must grow from below 6 km to above 9 km without appearing as a detached
high shelf. Consecutive 0.01 regime increments must move its visible upper bound
by less than 0.5 km. Existing optical-depth and vertical-smoothness checks remain. The saved baseline
jumps 5.414 km in one increment; the new maximum increment is 0.422 km.

The shadow fixture compares both density variants with an independent
512-sample integral. At partial coverage, fine-noise minima must retain the
observed column, with less than 0.1 absolute opacity variation across the noise
sweep. The old requirement that noise split partially covered columns was
replaced because it required the artifact reported by the user.

## Validation

`bun run verify`: 210 tests passed, Astro check reported zero errors and
warnings (five pre-existing unused-variable hints), and the production build
passed. The first run hit the existing five-second DEM test timeout under
concurrent machine load; the unchanged test passed on the repeat.

All five visual comparisons completed with matching matrices and dimensions,
zero asset failures and valid GPU queries. Screenshots were inspected at both
reported high-altitude views, the supplied close view, 150 km and low sunlight.

| View | Before GPU ms | After GPU ms | Median paired ratio |
| --- | ---: | ---: | ---: |
| cells | 39.99 | 40.65 | 1.101 |
| north | 39.83 | 40.78 | 1.011 |
| south | 49.63 | 49.01 | 1.010 |
| low | 30.36 | 30.11 | 1.011 |
| sunset | 37.27 | 37.67 | 1.004 |

These are desktop steady-state GPU measurements, not presentation FPS or
mobile/thermal results. Unrelated work was running on the machine. Four paired
medians are within 1.2% of the reference; the close cloud view is 10.1% higher.
This change improves morphology; it does not establish a rendering speedup.
Marginal medians and the median of per-pair ratios need not agree under variable
load. Retained pairs and screenshot hashes are in
[evidence/cloud-morphology-2026-10-11.json](evidence/cloud-morphology-2026-10-11.json).

`bun run verify:scene` passed against the production build, including both
cloud density variants, the crown regression, seven scene frames, shadow and
night-light fixtures, asset fallbacks, WebGL restoration, constrained samplers,
viewport changes, exposure/focus, free flight, touch, swipes and calendar.
The motion sample submitted 23.66 fps at scale 1 with zero WebGL errors; it is
separate from the fixed-frame GPU comparisons above.

The local before/after viewer loaded all five image pairs and its slider at
desktop and 390 px widths without horizontal overflow. Images are local review
artifacts, not new shipped assets. No commit, push or deployment was performed.
