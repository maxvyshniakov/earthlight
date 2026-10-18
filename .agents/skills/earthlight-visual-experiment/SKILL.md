---
name: earthlight-visual-experiment
description: Evaluate visual changes in Earthlight with controlled scene comparisons, including cloud, terrain, aurora and camera experiments.
---

# Earthlight visual experiment

Paths below are relative to the Earthlight repository.

- State the visible prediction and stopping condition before extending a prototype. Verify it in the explorer at `/`; `/lab/` isolates mechanisms but does not establish product value.
- Freeze `epoch`, `t`, free-flight `position`/`orientation`, lens and look settings. Use `motion=0`, `quality=fixed` and manual exposure for an isolated comparison; then check normal adaptation when relevant. Compare actual `cameraPosition`, `cameraBasis` and canvas dimensions, not URLs alone.
- Wait for `orbital-sky` readiness: `assetPhase=settled`, `focus=sharp`, zero `assetFailures` and pending tile counts. Check experiment-specific readiness too (`modisReady=1` for MODIS). A settled failed download is not a valid baseline.
- Change imagery and shading separately. The MODIS trial showed how easily photographic detail can be credited to coarse property guidance. Its patch is only 91–79 W / 32–20 S; outside that region an identical A/B says nothing.
- Capture A/B/A at the user's failing view and a contrasting angle/light. A changed control invalidates small differences. Show aligned images at useful scale; difference metrics locate changes, not improvements.
- Reuse `scripts/compare-cloud-shape.mjs` or `scripts/compare-modis-orbit.mjs` where applicable; inspect their current presets and arguments before use. Browser checks use isolated agent-browser sessions.
- Store a concise decision under `docs/lab`: prediction, reproduction URL + revision, visible gain/regression, cost, adopt/revise/stop. The user should not need to interpret an unexplained laboratory scene.

Earthlight owns the renderer. Verify the consumer separately when package delivery is in scope; editing the personal site's installed copy does not fix this project.
