# Streamed tile seams, 2026-10-11

Mobile screenshots from the deployed preview showed rectangular cloud boundaries
and a dark wedge. The deployed consumer pinned Earthlight 9ee5f153811a; it did
not yet contain the accepted DEM working cache, bitmap crop or resize fixes.
The exact phone/GPU and free-camera attitude were not available. Reconstructed
views use the screenshots' coordinates, altitude and UTC, with an approximate
heading; they are not exact screenshot reproductions.

## Confirmed defects and changes

- Cloud/coarse-terrain edge fading packed a tile's own readiness and the minimum
  of all four neighbours into one byte. Opposite sides of a shared edge could
  therefore have different weights when an unrelated neighbour was missing.
  Fades now use the actual adjacent tile per edge. Corners include the diagonal
  neighbour so all four quadrants agree. The tile interior, image resolution,
  numeric terrain encoding and atlas allocation are unchanged.
- Cloud lighting used request/resident counts as the input identity. Those
  counts can stay unchanged while a reserved tile completes its upload and
  fades in. Lighting now follows the uploaded page-table revision and waits
  for both requests and fades to finish. A changing revision invalidates an
  unfinished bake; an unchanged table does not continually restart it.
- The previously validated crop materialization and synchronous canvas resize
  redraw are included in this delivery. Decoder-pool, prepared-DEM and cloud
  bake-budget experiments remain opt-in. The accepted working DEM cache is
  enabled. Regional prepared files are excluded from release manifests; the
  existing immutable asset version remains 63adb471724e3223.

## Evidence

The production cloud tile shader is tested against a constant detail image
and dark overview with asymmetric residency. The old code has a 102/255
single-pixel jump in the failing fade/corner case. The corrected shader has
zero edge jumps in all 18 cases: empty/partial/full neighbour readiness,
interior/near-corner/corner crossings, and the dateline wrap. Smooth transition
steps are at most 6/255 at the chosen sample spacing; fully resident edge
interiors remain uniformly bright. Raw logs: `/tmp/tile-seams-before.log` and
`/tmp/tile-seams-after.log`.

The summit-height fixture now supplies explicit neighbouring fade entries,
preserving its original assumption of fully resident terrain. Its independent
checks against actual ETOPO bytes and radial ray intersections remain intact.
Atlas lifecycle tests also assert that new uploads are still fading after the
network completes, that a completed fade updates the input revision, and that
stable pages leave that revision unchanged.

Source verification: `bun run verify` (205 tests, Astro check, production build).
Rendered verification: `bun run verify:scene http://127.0.0.1:4355
/tmp/cloud-fix-final-scene`, including the new production-shader seam fixture.
The original Android hardware was not available for direct verification.
