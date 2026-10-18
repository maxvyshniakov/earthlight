---
name: earthlight-rendering-optimization
description: Optimize Earthlight frame cost, cloud passes and asset loading using its paired benchmarks, render-state diagnostics and motion checks.
---

# Earthlight rendering optimization

Paths below are relative to the Earthlight repository.

- Read `src/scripts/scene-profile.ts` before choosing controls. `compact` is currently the default; `clouds-half` can fall back. Check `dataset.renderProfile`, `cloudPass`, `cloudBuffer`, canvas dimensions and zero asset failures before attributing a speedup.
- Use `quality=fixed` for controlled cost comparisons, then verify adaptive behavior separately. GPU time, CPU submission, RAF cadence and presented frames are different measurements. Paused inspection also differs from sustained motion.
- Reuse `scripts/benchmark-candidate-pairs.mjs`: alternating AB/BA, discarded warmup pairs, disjoint-timer rejection and counted submissions control scheduling drift. Inspect supported candidates first. CLI: `bun run benchmark:pairs <base-url> <output-dir> <candidates> <views> <baseline>`.
- Remove empty ray intervals, invisible effects and repeated work before shader arithmetic tuning. Inspect the whole pass chain in `orbit-renderer.ts`: a cheaper cloud pass can add reconstruction, buffer or shadow cost elsewhere.
- Preserve footprint-aware filtering in `earth-clouds.ts`, including shadows. Implicit texture derivatives in divergent branches can shimmer; retain explicit LOD or conservative fallback and fade unresolved noise to its mean. Whole-scene blur sacrifices unrelated detail.
- Keep density consistent across view, shadows and source transmission. Inspect silhouette/alpha boundaries when reducing cloud resolution. Use `bun run verify:motion <base-url> <output-dir>` for retained profiles, adapting its profile list when necessary; stills miss temporal artifacts.
- Separate compressed bytes, decoded images, GPU mipmaps and transient uploads. `scene-assets.ts` and `scene-work.ts` own loading/scheduling; a smaller download does not prove lower GPU memory.
- Desktop timings do not establish phone performance. Existing `scripts/benchmark-device-pairs.mjs` provides device checks when a device is available. Report measurement limits with the gain and visible loss in `docs/lab`.

For exported A/B/A samples, run `python3 .agents/skills/earthlight-rendering-optimization/scripts/compare_aba.py samples.json`:

```json
{"metric":"gpu-frame","unit":"ms","a":[20,21,19],"b":[15,16,14],"a2":[21,20,22]}
```

This reports control drift and savings against both controls, not statistical significance or visual acceptance.
