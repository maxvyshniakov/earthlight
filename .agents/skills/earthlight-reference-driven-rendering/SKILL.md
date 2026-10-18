---
name: earthlight-reference-driven-rendering
description: Diagnose Earthlight clouds, water, terrain and auroras against real imagery, separating physical structure from texture and camera artifacts.
---

# Earthlight reference-driven rendering

Paths below are relative to the Earthlight repository.

- Collect references that could contradict the model: orbital versus grazing views, day versus night, different spatial scales. Keep original source and known capture conditions. Exposure, bloom and white balance are not properties of the atmosphere.
- Describe boundary and body separately. Aurora filaments must not replace diffuse emission; irregularity must not reduce to recognizable repeated spirals. Cloud detail must not punch holes through every connected deck.
- Trace the complaint through source imagery, field/geometry, illumination, integration and camera processing. Inspect the relevant module under `src/scripts`: `earth-clouds.ts`, `earth-terrain.ts`, `aurora.ts`, or the camera modules; locate the actual owner before editing.
- Use diagnostic separation before brightness tuning. For terrain, inspect `terrainView` modes in `orbit-renderer.ts` to distinguish texture shading from geometric shading. For water, isolate incident cloud shadows from roughness variation; both can look like matte/gloss patches.
- Check geographic support and occlusion independently of local shape. View-dependent brightening should be traced through shared exposure before adding per-object compensation.
- Reuse the shader fixtures in `scripts`: `weather-browser-fixture.mjs`, `terrain-browser-fixture.mjs`, `aurora-browser-fixture.mjs`, `exposure-browser-fixture.mjs` and `lens-energy-browser-fixture.mjs`. They test mechanisms; the real scene still decides appearance.

Keep a small table in the relevant `docs/lab` note:

```text
Observed feature | original reference + capture context | suspected mechanism | discriminating render
```

Distinguish observed features, inferred causes and artistic choices. Realistic-looking output alone does not validate a physical model.
