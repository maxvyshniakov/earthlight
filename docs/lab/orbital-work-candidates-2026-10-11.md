# Small rendering work reductions, 2026-10-11

The first useful candidates are less terrain intersection refinement and
a larger cloud integration step. They were measured as opt-in candidates.
After image review, the owner approved the combined settings as the default:
`terrainWork=bounded`, `terrainRefinement=pixel`, `cloudSteps=balanced`.
Surface resolution, DEM90 detail and the adaptation controller are unchanged.
The historical renderer remains available with
`terrainWork=legacy&terrainRefinement=full&cloudSteps=full`. Comparison scripts
and review links explicitly select those settings for their reference side.

The review is available locally at `http://127.0.0.1:4352`, with a divider,
full-size display, matched camera sequences and links to live scenes on port
4351. Its files are in
`~/.codex/visualizations/2026/10/11/earthlight-optimization`.
Run `bun serve.ts` there to restart the review. The Earthlight production
preview supplies the live scene links. This is a local review, not a deployment.

## Candidates

| Candidate | URL parameters | Change |
| --- | --- | --- |
| Terrain refinement | `terrainWork=bounded&terrainRefinement=pixel&cloudSteps=full` | Stop binary refinement once its interval is at most a quarter pixel cone, with a 2 m floor; terminate fully occluded or escaped terrain shadow rays. |
| Cloud integration | `terrainWork=legacy&terrainRefinement=full&cloudSteps=balanced` | Integrate at 1 km intervals instead of 650 m, retaining the 16–96 sample limits and footprint filtering. |
| Combined | Default, no override required | Apply the two candidates together. |
| Coarse terrain control | `terrainWork=legacy&terrainRefinement=full&cloudSteps=full&terrainDetail=coarse` | Existing alternative that retains coarse terrain tiles and skips DEM90 streaming. It is a quality trade-off, not a new algorithm. |

The cloud candidate retains full scene resolution. It changes the volume
integral and therefore changes the image; it must not be described as lossless.
Terrain refinement also changes sampled positions slightly. The selected image sequences do not establish visual equivalence for every
close flight, polar terrain or lighting condition. The UI's live links let the owner inspect
those cases rather than limiting inspection to selected screenshots.

## Measurements

Source starts at `040b7c012e608e3d2aa4ce022d7266886659bb3b`. The experiment
patch and compact evidence are in the adjacent `evidence` directory. The
rejected upload experiment is preserved in the patch for reproduction but
removed from the working renderer.

UHD 630 uses the established Ubuntu/Wayland lab with an 8 GiB ceiling and
Chrome 155. Each case gets a fresh process/profile. Paused cases use 1248×615,
fixed quality, manual exposure 0, zero grain and matching camera states.
Assets, terrain queues and the cloud lighting cache settle before sampling.
Whole-frame GPU queries discard eight samples and retain sixteen; controls
repeat around candidates. The script records prior GL errors separately and
rejects new errors/disjoint queries. These costs exclude cold startup and
are not presented-frame rates.

| UHD 630, heavy clouds view | Median GPU frame |
| --- | ---: |
| Terrain series baseline | 275.33 ms |
| Bounded rays alone | 275.77 ms |
| Control | 275.60 ms |
| Terrain refinement candidate | 258.16 ms |
| Control | 276.61 ms |

Terrain refinement saves 6.3–6.7% against its adjacent controls. Its world
draw median falls from about 114 ms to 94 ms. Bounded rays alone do not give
a useful whole-frame improvement alone; they remain part of the measured
combined bundle selected as the default.

Cloud integration measured approximately 275 → 239 ms, about 13% less whole
frame time. The compact evidence retains the exact medians and repeated
controls. Shared GPU work and other applications can change absolute timing.

The final UHD series measured 275.42 ms baseline, **220.64 ms combined**,
237.79 ms with coarse terrain, then 275.57 ms for the repeated baseline.
Combined work saves 19.9% against both controls; coarse terrain saves 13.7%.
These retain full 1248×615 rendering. The combined option preserves DEM90;
the coarse control does not. All cases have zero asset failures and a ready
cloud lighting cache. The final source patch is
[`orbital-work-retained-2026-10-11.patch`](evidence/orbital-work-retained-2026-10-11.patch).

The second device is an M2 Max using ANGLE/Metal. On that device the harness
reuses the repository's paired AB/BA technique: 40 pairs, the first eight
discarded, exactly 40 final-canvas submissions per side, matched camera/buffer
state and zero asset failures. The median of paired ratios is authoritative;
ratios of separately computed medians can differ. Absolute baseline costs
vary between sessions, so do not rank candidates using different sessions'
unpaired medians.

| M2 Max, paired reduction in GPU time | Day | Night | Clouds |
| --- | ---: | ---: | ---: |
| Terrain refinement | 9.8% | 2.4% | 10.2% |
| Cloud integration | 18.5% | 6.9% | 11.6% |

The existing coarse-terrain control saves 19.4% in the M2 clouds comparison.
Its loss of fine terrain can matter much more in a close, unobscured mountain
view. The cloud-heavy fixture alone cannot establish acceptable terrain quality.
Combined work also saves 19.4% in its M2 paired comparison.

## Image and motion evidence

`compare-ray-work.mjs` captures eight identical camera poses per side after
measurement. Manual exposure and zero grain isolate the renderer differences.
PNG capture occurs inside the final canvas draw. The sequence advances by
10/24 simulated seconds per frame, and replay in the review uses a common
8 fps; neither number represents live delivery performance.

| Clouds view, M2 Max | Mean absolute channel difference (0–255) | Maximum | Mean temporal difference |
| --- | ---: | ---: | ---: |
| Terrain refinement | 0.0341 | 11 | 0.0635 |
| Cloud integration | 0.1642 | 16 | 0.1968 |
| Coarse terrain | 0.0090 | 32 | 0.0142 |
| Combined | 0.1724 | 16 | 0.2160 |

Means include the whole image, including empty sky, and can hide a localized
defect. Inspect the images at 1:1 and in motion. The cloud candidate changes
small cloud structures more than the terrain refinement candidate. The coarse
terrain control's small mean does not mean terrain detail is preserved.

## Rejected upload change and next bottleneck

Batching one-texel terrain page-table writes into row spans reduced their count
from 306/319 in the controls to 211. But these writes cost just 3.4/4.0 ms over
20 seconds, versus 2.4 ms with batching. Fixed submitted cadence was 3.05,
3.25 and 3.20 fps in A/B/A order: not a convincing improvement beyond control
drift. The change and its temporary test were removed.

The expensive uploads are the DEM90 atlas strips: 632×64 pixels, about 933
calls in 20 seconds. They consumed 3.5–3.9 seconds, with individual calls up
to 1.5 seconds. Tiny page-table writes are not responsible. The next useful
investigation is synchronization when rewriting an atlas that queued GPU work
still samples, and whether fine DEM streaming is justified by the pixel
footprint. Smaller downloads alone will not remove these driver stalls.

## Reproduce

From Earthlight, with a built preview on port 4351:

```sh
bun scripts/compare-ray-work.mjs http://127.0.0.1:4351 /tmp/work-review pixel,clouds clouds,day,night
bun scripts/compare-ray-work.mjs http://127.0.0.1:4351 /tmp/work-combined combined clouds
```

From the lab host:

```sh
uv run --locked python files/browser-lab/run.py chrome http://<lab-host>:4351 /tmp/work-terrain \
  --script ../earthlight/scripts/profile-linux-gpu.py --scenes clouds --variants baseline,bounded,control,pixel,control2 --no-motion
uv run --locked python files/browser-lab/run.py chrome http://<lab-host>:4351 /tmp/work-clouds \
  --script ../earthlight/scripts/profile-linux-gpu.py --scenes clouds --variants baseline,balanced,control3 --no-motion
```

The wrapper stops the lab container after every run and preserves results. Do not run
two GPU benchmarks on the same device at once. Source checks, steady-state
GPU costs, image comparison and normal browser behavior are separate evidence.

## Validation

- `bun run verify`: 197 tests passed, no Astro errors/warnings and four existing
  import hints; production build passed.
- `bun run verify:scene`: passed lighting, seven reference frames, asset
  failures, context restoration, viewport rotation, motion, constrained
  capabilities, save-data, focus, optics, camera, flight, touch and calendar.
- Eight M2 paired comparisons completed with matching poses and buffers;
  matched image sequences contain eight camera poses per side.
- Firefox 157 on UHD 630 completed the combined paused, fixed-motion and
  adaptive-motion cases. Fixed motion submitted 3.00 fps; adaptive motion
  submitted 14.15 fps. This is a smoke/cadence observation, not a paired
  Firefox speedup claim. Its synchronized completion measurements are not
  isolated GPU timings. The known startup GL error is recorded separately;
  measured draws had no new GL errors, and assets had no failures.
- The review loaded its images and divider/frame controls at desktop and
  390 px widths without horizontal overflow. Fixed-quality live links use
  the same resolution policy on both sides.
- Each host job finished successfully and stopped the lab container. The final Firefox
  run had no parent-cgroup memory pressure or OOM events. The Mac preview
  and review server remain available for interactive inspection.

[Raw timings, states and image-difference measurements](evidence/orbital-work-candidates-2026-10-11.json)
retain the controls, shader hashes and per-upload timings. No package or site
deployment was made for these review candidates.
