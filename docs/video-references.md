# Orbital video references

The first five videos in [NASA's South America collection](https://eol.jsc.nasa.gov/videos/crewearthobservationsvideos/SouthAmerica.htm)
are the selected references for clouds, cities, twilight and lightning.
These notes distinguish sampled visual evidence from proposed renderer work.
The renderer remains photographically tuned rather than calibrated photometry.
The subsequent [storm and twilight implementation](scene.md#storm-flashes-and-city-twilight)
records which parts of this direction are now implemented and their limits.

## Reviewed frames

Reviewed on 8 October 2026 by seeking the embedded videos in a browser.
Times below are playback seconds in the linked files, including any titles.
This is a sampled-frame review, not a measurement of every frame or flash.

| Video | Useful playback times | Visual evidence / purpose |
| --- | --- | --- |
| [City Lights of North and South America](https://eol.jsc.nasa.gov/videos/crewearthobservationsvideos/videos/NandSALights_ISS028_2011-08/NandSALights_ISS028_2011-08.mp4) | 10, 14, 16, 18 s | Warm city clusters remain visible around and through clouds. At 10 s a broad cloud deck covers part of the city field; at 14 s a compact cold-white/violet flash lights a cloud on the right. Sheets, gaps and finer broken cloud coexist. |
| [From Night to Day to Night Again](https://eol.jsc.nasa.gov/videos/crewearthobservationsvideos/videos/term3_iss_20130103/term3_iss_20130103HD_web.mp4) | 40, 46, 52, 58 s; 110–120 s | Daylit cloud/terrain gives way to a dark foreground and narrow blue limb. Late-night frames can be nearly black. Use for the transition and exposure balance; these samples do not demonstrate neighborhoods switching their lights on. |
| [From North to South America at Night](https://eol.jsc.nasa.gov/videos/crewearthobservationsvideos/videos/nsamerica_iss_20121216/nsamerica_iss_20121216HD_web.mp4) | 10, 30, 50 s | Separated warm settlements, connecting light patterns and extensive dark gaps. Some city cores saturate. Match their distribution and surrounding darkness, rather than making every source white. |
| [Storms over Caribbean and South America](https://eol.jsc.nasa.gov/videos/crewearthobservationsvideos/videos/caribbeanstorms_iss_20120629/caribbeanstorms_iss_20120629HD_web.mp4) | 4, 15 s; 25.8–26.3 s sampled every 0.1 s | Several compact cool-white flashes illuminate separate parts of one cloud field. Bright patches change between samples; the whole deck does not brighten uniformly. No resolved zigzag channel is needed to reproduce this distant appearance. |
| [Stars and the Milky Way over the Atlantic](https://eol.jsc.nasa.gov/videos/crewearthobservationsvideos/videos/milkywaystars_iss_20120624/milkywaystars_iss_20120624HD_web.mp4) | 4, 12, 20 s | Bright, noisy star field and atmospheric limb. Keep this as a separate explorer-exposure reference, not a universal brightness target for Earth-facing shots. |

The source sequences are timelapses with different acquisition intervals and
exposures. Playback seconds are not physical flash durations. Adjacent bright
patches do not establish repeated strokes of the same discharge. Titles and
end cards also make total file duration unsuitable for inferring speed.

## Renderer direction

These are proposed acceptance criteria for subsequent implementation:

- Clouds need broad quiet sheets as well as locally broken and turbulent regions.
  Judge both sunlit structure and night transmission at the same locations.
- City emission must preserve dark gaps and source detail before the camera's
  highlight shoulder. Optical bloom alone cannot supply atmospheric depth.
- City light transmitted through a cloud and light scattered inside that cloud
  should share the same source, with different spatial spread and attenuation.
  A sharp duplicate of the city footprint on the cloud top is not sufficient.
- Model any gradual city activation by local twilight and stable geographic
  districts. A camera entering the night hemisphere must not trigger a new
  activation event. These videos do not justify random city flicker.
- Add lightning as sparse emission events inside selected storm volumes. Shape
  the illuminated patch with cloud density and optical depth; retain dark cloud
  between flashes and allow several independent active cells.
- A bright flash can have a small white core and a softer cool surround, subject
  to the same exposure and highlight response as other scene light. Avoid a
  screen-wide flash or an unoccluded glow drawn over foreground clouds.
- Use a deterministic event timeline in simulation time. Pause, seeking and URL
  replay must reproduce the events; 10x playback must advance that same clock.
  Integrate sub-frame event energy over the camera exposure interval so short
  events are not randomly missed at the renderer's frame-rate cap. Do not obtain
  visibility by stretching every discharge into a multi-second glowing cloud.
- Keep a bounded number of nearby active storm sources and skip inactive ones.
  Compare frame cost with lightning disabled at identical cloud-heavy views.

## Lightning timing evidence

[NOAA's lightning overview](https://www.noaa.gov/jetstream/lightning/how-lightning-is-created)
describes most lightning as occurring within the storm cloud. Its
[lightning types guide](https://www.nssl.noaa.gov/education/svrwx101/lightning/types/)
describes embedded flashes lighting a cloud as a sheet of luminosity.
[NOAA's stroke description](https://www.noaa.gov/jetstream/lightning/how-lightning-is-created/jetstream-max-lightning-process-keeping-in-step)
explains that one flash may contain multiple strokes. That supports irregular
pulse groups, but does not supply a universal duration or justify transferring
cloud-to-ground stroke timings unchanged to every intracloud event.

Before tuning frequency and pulse widths, choose an explicit illustrative storm
activity preset and document it. Our coverage map does not identify real active
thunderstorms, and the selected scene date is not a weather reconstruction.

## Lightning review, 9 October 2026

Revisited the actual embedded NASA videos in a browser, seeking adjacent frames:

- **Storms over Caribbean and South America**, 25.6–26.7 s at 0.1 s intervals:
  recurring bright patches occupy a common cloud band. Several adjacent pockets
  can light independently while the intervening deck remains dark. At
  10.0–12.2 s (0.2 s steps), much of the visible cloud field remains quiet.
- **City Lights of North and South America**, 13.5–14.6 s at 0.1 s intervals:
  a compact cool flash on the right at 13.6 s and again near 14.0 s contrasts
  with steady warm city emission. These frames support spatially persistent
  activity, not an independently randomized location for every flash.

The sampling does not resolve physical return-stroke timing. A nearby repeated
patch may represent another discharge, rather than another stroke of one flash.
The implemented pulse durations below are illustrative, not measurements from
these accelerated videos.

The revised preset selects 64 separated dense cloud complexes from the existing
NASA cloud atlas, with 3–5 nearby cells per complex. This is an artistic activity
mask, not a claim that bright optical clouds identify thunderstorms. Most cloud
is unselected; selected complexes also have multi-minute quiet intervals.
Episodes visit 1–3 neighbouring cells with 0.8–4.2 s between them. Each discharge
contains 1–4 unequal strokes, 35–100 ms wide, separated by 25–115 ms dark gaps.
Compact connected light pockets are scattered through local cloud density;
resolved clear gaps and thin cloud cannot host a discharge. All timing follows
simulation time with integrated energy at accelerated playback.
