# First light and a focus that follows detail, 2026-10-17

Follows the [smaller startup](startup-diet-2026-10-16.md). Numbers are in the
[evidence file](evidence/first-light-2026-10-17.json); paired filmstrip frames
are in [this sheet](evidence/first-light-2026-10-17.jpg).

## Problem

On the personal site, a slow connection showed the static poster for about
four seconds: a stale capture with a red limb across the middle of the
screen. The live scene then faded in with a golden limb lower down, so the
picture jumped. Focus was released by a six-second timer, often before the
cloud map arrived. That map was then swapped in plain sight.

## Changes

1. **Posters keyed to the Sun.** The background opens at a fixed point of
   the recorded ground track, so its Earth and atmosphere depend only on the
   subsolar point. `/lab/poster` renders the opening frame at the loading
   defocus, with first-light data and without the celestial sky, for every
   5° of subsolar longitude at five latitudes. Alike frames share a file:
   166 WebP posters for 360 cells, 1.5 to 4.6 KB each, about 491 KiB in
   all. A page loads one. An inline script in `Background.astro` picks the
   poster before any module loads. The canvas then fades in over the same
   picture and brings in the stars.
2. **First light.** The defocused frame needs three map previews, a 512-wide
   cloud map (18 KB AVIF instead of the 87 KB WebP) and the 1,637 stars to
   magnitude 5 (25 KB). That is 75 KiB in all, against 495 KiB of preview
   data before. The full catalog and PSF become refinements. The page preloads
   the first light at low priority, so it downloads beside the scene script.
   Before, it waited for shader startup.
3. **Focus follows detail.** After a 450 ms hold, the blur closes towards
   6 × √(share of refinements still missing). It pulls in with the last
   refinement, in about 1.3 s. From five seconds the allowed blur shrinks;
   by ten seconds focus is sharp, whatever is still loading.
4. **Loading buffer sized to the blur.** The smallest of 35, 50, 60 and 70%
   at which the blur still spans 2.5 buffer pixels. Grain is compensated.

## Results

Slow 4G (1.6 Mbps, 150 ms) with 4× CPU throttling. Assets came from a local
server. Each "before" and "after" pair was recorded back to back.

| Desktop, 1440 × 900 | Before | After |
| --- | ---: | ---: |
| Scene-like picture on screen | 0.76 s, wrong scene | 0.98 s, matching poster |
| First-light data complete | 4.90 s | 1.08 s |
| Live canvas | 4.19 s | 3.89 s |
| Sharp focus | 10.95 s | 13.77 s |
| Last refinement | 13.14 s | 13.32 s |
| Earth change, poster → canvas | 13.5 levels | 6.8 levels |

Before, focus came 2.2 s ahead of the last refinement. After, it came 0.45 s
after it, so no map was replaced in sharp view. On the phone emulation, the
change in the Earth region at handoff fell from 6.8 to 2.0 grey levels. What
remains is mostly the stars fading in, and a slightly brighter limb from the
first frame's metering.

**Lighthouse** (12.6.1, hardware GL, medians of six interleaved runs, mobile):

| | Score | LCP | TBT | Speed Index | Bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| Before | 83 (59–97) | 3.54 s | 532 ms | 2.52 s | 2.73 MB |
| After | 81 (77–96) | 3.52 s | 330 ms | 2.26 s | 2.68 MB |

Desktop stayed at 96–100. All the differences are inside the spread between
identical runs. The page's LCP element is still the heading.

High-priority preloads were tried first. The heading's LCP moved from
3.55 s to 3.98 s, because the first light took bandwidth from the heading's
font. Low priority removed that delay.

**Loading frame cost.** On an M2 Max, a defocused background frame costs
3–5 ms below 60% scale; most of that is fixed per-frame work. Phones at 3×
now render 31% fewer pixels while blurred (50% scale instead of 60%). The
explorer renders 66% fewer (35% instead of 60%). A 1× display keeps 60%. This
saving should matter on phone GPUs; this machine cannot show it.

## Limits

- The posters, `stars-hyg-m5-v2.bin` and `preview/clouds-512.avif` must be
  published with a new asset manifest before deployment. Until then, the
  background requests files the asset origin does not have.
- A poster is chosen from the nearest grid cell. Near sunrise and sunset, a
  2.5° error in longitude is still visible, but it is small next to the
  canvas fade.
- Posters assume the desktop composition. On mobile Safari, where the small
  viewport is shorter than the large one, the live limb sits slightly lower
  than in the poster. Not measured on a device.
- When detail is slow, the scene now stays defocused longer: up to ten
  seconds, against six before.
- A page with a Content Security Policy must allow the inline poster script.
- `verify:scene` passes the startup fixtures: failed refinements, Save-Data,
  detail slower than the focus limit, optical defocus. It stops at the swipe
  fixture, whose 25 s wait for inspection mode times out. The build from
  before these changes stops at the same point. Inspection follows exposure
  settling, which took 11–20 s in both builds.
- The site's own below-the-fold case images, about 600 KB, load eagerly. They
  compete with the scene script for bandwidth. That is a personal-site change.
