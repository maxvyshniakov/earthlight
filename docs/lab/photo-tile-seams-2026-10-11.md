# Photographic tile borders visible through clouds

Baseline: `da2fb183e272ac935070226ec7b8e4b0df9c6b68`.

The three reported camera links were checked on the published source. The
third view reproduced a persistent border at longitude 76.5 degrees. Turning
off cloud detail, cached cloud lighting, terrain, or the compact pass retained
it. Turning off day detail removed it. A ground-ray calculation placed the
edge exactly between day tiles 3633 and 3634. A GPU atlas read confirmed both
tiles were fully resident; this was not a loading timeout or a stale slot.

Separately encoded AVIF tiles do not reproduce identical colors in their
shared photographic gutters. The old residency fade became one when both
tiles finished loading, exposing that difference. Existing seam tests filled
all tiles with the same color, so they could not detect this case.

Day and cloud samplers now blend the same geographic overlap from adjacent
photos. Both sides use the same mixture at a border; four tiles agree at a
corner. The band fits inside the existing 16-source-pixel gutter, reduced to
allow for the coarsest mip filter radius. Latitude does not wrap at a pole.
Interior samples, source resolution, downloads, atlas sizes, terrain and cloud
morphology are unchanged. Night emission and galaxy sampling are unchanged.
An earlier prototype faded edges to the coarse overview; it was discarded
because overlap blending preserves the existing photographic detail.

## Evidence

The regression fixture uses deliberately different neighboring photo colors,
including fractional mip levels and four-tile corners. The original shader
fails with a 64/255 border jump. The retained shader passes the continuity
bounds while preserving the photographic mixture. It also passes the earlier
partial-residency fixture. Actual GPU samples at the reported ground border
show a maximum channel step of 0–1/255 with overlap blending.

The original phone was not available. Local captures use Chromium, a 430×810
CSS viewport, fixed quality, paused time and no grain. The first phone image's
full pattern was not reproduced in the settled local frame. Its exact appearance
remains unverified on that device. High-density baseline captures were also
checked. The new continuity rule applies to both day and cloud photographs.

| Reported view | Before | After |
|---|---|---|
| Southern ocean, 638 km | [Before](evidence/photo-seams-2026-10-11/1-before.png) | [After](evidence/photo-seams-2026-10-11/1-after.png) |
| Northern ocean, 638 km | [Before](evidence/photo-seams-2026-10-11/2-before.png) | [After](evidence/photo-seams-2026-10-11/2-after.png) |
| Mountains, 168 km | [Before](evidence/photo-seams-2026-10-11/3-before.png) | [After](evidence/photo-seams-2026-10-11/3-after.png) |

`bun run verify` passes 210 tests, Astro checking and the production build.
`bun run verify:scene` passes all scene, loss/restore, loading, touch and
swipe-recovery checks. The photographic fixture additionally asserts the
expected mixture of the four photos, preventing a flat overview from passing
as a seam fix. [Raw browser evidence](evidence/photo-seams-2026-10-11/scene-verification.json)
and [shader checks](evidence/photo-seams-2026-10-11/shader-fixtures.json).

Separate A/B/B/A GPU runs were rejected: baseline medians drifted from 12.71
to 36.89 ms. An attempted paired benchmark also failed its execution checks
and is excluded from the evidence. GPU cost remains unquantified; this change
makes no performance claim. Extra neighbor reads are limited to the overlap
band, but their cost still needs a controlled hardware measurement.
