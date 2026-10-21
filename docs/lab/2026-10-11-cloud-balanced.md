# Balanced cloud density, 2026-10-11

The owner rejected Scattered on a phone at approximately 25,955 km altitude,
30.6° N, 162.3° W: there were too few clouds and only dense, cumulus-like cores
remained. The earlier decision had been made mainly from lower-altitude views.
The .32 coverage cutoff removed exactly the faint sheets and soft transitions
needed to connect cloud systems at full-disc scale.

## Reference and visual decision

- [Galileo: Earth, Pacific Ocean](https://science.nasa.gov/photojournal/earth-pacific-ocean/),
  PIA00123, December 12, 1990. A full globe with broad connected cloud bands,
  thin veils and dense embedded cores.
- [DSCOVR EPIC: Keeping on the Sunny Side of Earth](https://science.nasa.gov/earth/earth-observatory/keeping-on-the-sunny-side-of-earth-87167/),
  August 26, 2015. Full-disc structure, diffuse edges and clear gaps between
  weather systems. This image includes three tropical cyclones; it is not a
  target for the position or number of storms in our static composite.

References were viewed in the browser at full-disc scale. The comparison is
morphological, not a match of exposure, cloud date, viewing phase or palette.
NASA's 2001 optical composite remains the actual source. No meteorological
cloud-type classification or new cirrus layer was invented from that image.

## Selected revision

The original `smoothstep(.025,.94,mapped)` coverage and its height envelope are
restored everywhere. Only column density changes in Balanced:

```glsl
density *= mix(.72, 1., smoothstep(.2, .8, coverage));
```

Thus faint columns retain at least 72% of their original optical thickness;
coverage .8 and above is unchanged. No camera-distance switch, cutoff or extra
noise mask is applied. Sheets retain their geographic extent as the globe is
zoomed out. The same density drives camera transmission, scattering, source
attenuation, ground shadows and the self-lighting cache. MODIS studies retain
their separate input by default.

The new default and UI label are Balanced. `clouds=original` and `clouds=off`
remain available; old `clouds=broken` links resolve to Balanced. The rejected
Scattered variant is retained only in diagnostic screenshots, not as an option.

Candidates compared on the full globe: original, two gentle coverage scalings
(.8 and .65 at the weak end), and the selected density scaling. Density scaling
was selected because it retains both the photograph's extent and the existing
height profile. Review also includes the earlier India and islands/glint views.
The globe pose is reconstructed from the screenshot coordinates/altitude, not
claimed to reproduce the user's exact orientation.

## Validation

`bun run verify` passed: 210 tests, Astro check (0 errors/warnings, 5 existing
hints), and production build. `bun run verify:scene` passed after this revision.
`verify-cloud-presets.mjs` passed for WebGL 1/2 selector changes, exact camera
preservation, context loss/restoration, narrow settings layout, and Off → Reset.
Matched captures cover the full globe, India, islands/glint and night. The
phone handoff globe was then centred and rolled to resemble the supplied
screenshot; its refreshed captures include actual renderer state.

The old `clouds=broken` URL was separately opened through Tailscale and verified
to select/render Balanced. The comparison page at
`http://<tailnet-host>:4396/clouds-balanced/` loaded all three images (including
both remote NASA references) without horizontal overflow at 390 px.

No new texture, sample, loop or render pass is introduced. A smoothstep and
multiply adjust the column density. The 9–10% GPU improvement reported for
Scattered does not apply to this revision.

## Linux

Job `20261011T130637Z-3ea874cc` succeeded in 5m07s. Intel UHD 630, Chrome
Wayland / ANGLE Mesa, WebGL2, fixed 1248×615. Each case uses 24 GPU elapsed
whole-frame queries after 8 warmups and the accepted advected ocean. The globe
benchmark uses the same screenshot coordinates/altitude but a different roll
and pitch from the centred phone comparison; raw URLs/states are preserved.

| View | Original before | Balanced | Original after | Balanced vs control mean |
| --- | ---: | ---: | ---: | ---: |
| Full globe, 25,955 km | 36.04 ms | 35.65 ms | 35.97 ms | −1.00% |
| India, 8,234 km | 79.54 ms | 79.62 ms | 77.68 ms | +1.29% |
| Oblique ocean, 420 km | 213.19 ms | 212.40 ms | 212.91 ms | −0.31% |

Cost is close to Original in these views. Do not carry forward the rejected
Scattered version's ~10% reduction or claim an equivalent phone FPS change.
The India baseline drift was 2.34%, larger than the candidate/control-mean
difference. No memory allocation was added. No asset/GL errors, OOM events,
limit hits or memory pressure were recorded. No other GPU workload was active at
preflight, midpoint or completion. The lab container was confirmed stopped.

Artifacts:
`~/.codex/visualizations/2026/10/11/01a12a81-c208-7563-88aa-79cb253024ad/cloud-balanced/`.
Includes captures, actual scene states, browser logs, Linux raw measurements,
reference browser screenshots and source snapshot. The rejected variant is
recreated only by browser-local shader substitution for the before screenshot.
No commit or production publication was performed.
