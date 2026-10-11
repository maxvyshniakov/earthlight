# Pixel ocean reflection discontinuities

Persistent rectangular cuts in ocean sunglint reproduced in Chrome on a USB-connected Pixel 9 Pro XL, using its Mali-G715 GPU. All code and assets were served locally with caching disabled. Three reported free-flight poses were tested at the fixed epoch `2026-10-11T09:26:38.071Z`, at times 1237.92, 1627.37 and 1782.26 seconds.

## Isolation

The cut remained after independently disabling photographic day tiles, cloud detail tiles, terrain, ground shadows and incoming solar extinction. Selecting WebGL 2 did not remove it. Replacing the procedural wind heading with a constant did remove it.

A standalone GPU fixture then evaluated the production 3D noise immediately on either side of shared lattice boundaries. It found large discontinuities on Mali in both WebGL 1 and WebGL 2. The fractional hash used for jitter did not yield consistent shared-corner values in the interpolated noise. This explains straight boundaries in the synthetic wind direction and therefore in anisotropic ocean reflection. It was not a pending asset or CDN update.

## Change

The interpolated noise now hashes lattice coordinates through a bounded integer-valued permutation. Its intermediates remain below the exact-integer limit of highp float, with normalization only after the permutation. The separate jitter hash is unchanged. Noise interpolation, frequencies, footprint filtering, ocean reflection, texture resolution and sampling budgets are unchanged. The synthetic noise realization changes, including cloud relief and airglow consumers of the shared noise function.

`noise-continuity-browser-fixture.mjs` tests 4608 boundary pairs per API, covering all three axes and positive/negative coordinates at ocean and cloud scales. It checks continuity, variation and mean, and runs as part of `verify:scene`. Readback uses two 8-bit channels, so a reported zero means below that quantization, not mathematical zero.

| Pixel measurement | Previous noise | Corrected noise |
| --- | ---: | ---: |
| Largest adjacent-boundary jump, WebGL 1 | 0.763897 | 0 |
| Largest adjacent-boundary jump, WebGL 2 | 0.763897 | 0 |
| Mean of sampled noise | 0.497759 | 0.498200 |

All three reported ocean poses lost their rectangular reflection cuts in native device screenshots. Six alternating touch swipes changed the camera without GL errors, context loss or asset failures; inspection of the resulting screenshots showed no returning ocean cuts.

## Cost and validation

An A/B/A device check replaced only the noise implementation, retaining the same current cloud code, pose, compact profile, fixed quality and 593 x 1196 render buffer. Each run discarded eight frames and measured 32. This measures CPU submission plus GPU completion plus a synchronous one-pixel readback; it is not a hardware GPU timer or presented FPS.

| Run | Median frame completion | P90 |
| --- | ---: | ---: |
| Previous noise A | 67.5 ms | 72.7 ms |
| Corrected noise B | 68.6 ms | 71.4 ms |
| Previous noise A2 | 68.0 ms | 71.2 ms |

The correction adds less than 1.1 ms in this small sequential sample; this is a correctness fix, not a performance gain. It does not establish smooth real-time performance at fixed full inspection resolution.

Validation: `bun run verify` passed 210 tests, Astro checking and the build. `bun run verify:scene` passed on the isolated local candidate, including the new GPU fixture, rendering, failed-asset fallbacks, resize, context recovery, navigation, touch and swipe recovery. The desktop GPU boundary test's maximum residual was 0.00001526 in both APIs.

The first clean-worktree test attempt lacked generated media assets; installing the existing local assets resolved it. The first browser run timed out during initial loading while the build was being replaced; the completed build passed the subsequent full run.

The local screenshot comparison uses published e56cbeb as its before image and current 430c020 plus this correction as its after image. Those full-scene pairs also include the pre-existing cloud morphology change. The shader isolation and A/B/A cost measurements above hold that cloud change constant. No push or deployment was performed for this fix.
