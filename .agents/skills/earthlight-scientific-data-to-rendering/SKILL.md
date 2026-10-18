---
name: earthlight-scientific-data-to-rendering
description: Assess and integrate scientific raster data into Earthlight, especially terrain DEMs and satellite cloud properties, with explicit validity and reconstruction limits.
---

# Earthlight scientific data to rendering

Paths below are relative to the Earthlight repository.

- Identify the exact product: numeric retrieval, derived grid, palette visualization or photograph. Record units, projection, acquisition time, effective resolution and validity semantics from primary documentation.
- Missing, clear and zero are distinct. Preserve validity through reprojection and packing; smooth only over valid samples with normalized weights. Matching bounds does not prove co-registration: inspect recognizable features and image orientation.
- Keep numeric channels out of color transforms, premultiplication and lossy color compression. Verify sample values after GPU upload, not just in the exported image.
- In the MODIS trial, GIBS palette inversion supplied quantized previews, not raw Level-2 precision. Cloud-top height did not supply independent layers or thickness; photo brightness was illumination-dependent coverage. Label every fallback and inferred vertical profile.
- Reuse `scripts/prepare-modis-demo.mjs` and `scripts/prepare-modis-orbit.mjs` as documented experiments, not validated reconstruction algorithms. Compare the same co-registered photo with and without numeric guidance before expanding coverage. Smoothing can remove both artifacts and the added value.
- For DEMs, verify encoding/heights with `scripts/terrain-height-browser-fixture.mjs`, then compare ridge sharpness, silhouettes and shadows at matched footprint. Correct summit height alone does not demonstrate useful detail.
- Keep provenance/channel encoding with assets and the decision under `docs/lab`. Large generated assets belong under `public/media/orbit`; follow the project's checksummed asset pipeline rather than adding raw datasets to Git. Asset publication is separate from application deployment.

Minimum manifest: product/source URLs, time, bounds/projection, channel units/encoding, validity, resampling, inferred values, rebuild command, limitations.

A failed integration is evidence about that implementation, not proof that the dataset is useless.
