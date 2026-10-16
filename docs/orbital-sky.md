# Orbital sky

`OrbitalSky.astro` wraps the `<orbital-sky>` custom element. It has two
compositions: standalone (the demo page, with flight controls) and page (a
scroll-driven background behind other content).
Its renderer is a standalone WebGL shader, with no React,
Three.js or remote runtime services. The bundled satellite.js 6.0.2 library
(MIT) propagates the saved ISS orbit. This version avoids the optional WASM
worker exports in version 7, which the current Astro build cannot bundle.

## Reference

For moving clouds, city illumination, twilight and proposed lightning, see the
[NASA video reference notes](orbital-video-references.md), including
reviewed playback timestamps and the distinction between observations and
planned renderer changes.

The original visual reference is a cropped and color-adjusted version of NASA
photograph **ISS044-E-020823**, taken by Scott Kelly on 19 July 2015.

- [NASA image record](https://images.nasa.gov/details/iss044e020823)
- [NASA record metadata](https://images-api.nasa.gov/search?q=iss044e020823)
- [NASA photograph](https://images-assets.nasa.gov/image/iss044e020823/iss044e020823~orig.jpg)
- [NASA's description of Kelly's Moon, Venus, Jupiter and Earth series](https://www.nasa.gov/image-article/moon-venus-jupiter-earth-good-night/)
- [NASA explanation of airglow](https://science.nasa.gov/earth/earth-observatory/iconic-views-of-the-atmosphere-146079/)

The foreground is Earth. The reference's orange and green atmospheric limb,
dark surface, small stars, exposure bloom and sensor grain guide the rendering.
The photograph itself is not included in the build.

## ISS trajectory and lighting

`src/data/iss-orbit.json` is the CelesTrak GP/OMM snapshot for NORAD 25544,
retrieved on 6 October 2026. Its element epoch is
**2026-10-06 00:20:47.860512 UTC**, inclination 51.6314 degrees and mean motion
15.48747543 revolutions/day (92.98 minutes/revolution).

- Source: https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=JSON
- GP format: https://celestrak.org/NORAD/documentation/gp-data-formats.php
- Propagator: https://github.com/shashwatak/satellite-js
- License: ../public/media/orbit/SATELLITE-JS-LICENSE.txt

Opening a page without `t` starts at route offset `t=1000`. The calendar starts
at the device’s current date and time; sunrise and moonrise therefore vary with
the date. Route position and lighting date can be adjusted independently.
A small captured scene poster covers startup. Lightweight overview maps reveal
an initially defocused live scene; detailed maps and visible tiles then load in
the background. Focus settles over 1.3 seconds once detail is available, or after
a six-second wait limit. A failed refinement retains the working overview;
complete failure retains the poster. Reduced-motion preferences skip defocus.
Every page entry starts at 10x; speed adjustments apply to the current page.
The displayed calendar uses UTC. Its initial instant comes from the device clock.
Explicit `t` links override the opening position and `motion=0` pauses motion.
Legacy `still` links autoplay. Empty or invalid `t` values use the default position.

The reference origin (`t=0`) remains 55 minutes after the element epoch, at
01:15:47.860 UTC, above the Pacific west of Chile in the reference recording. Links and the orbit
slider retain offsets beyond the first day. The model uses SGP4 position and velocity;
this is a dated prediction from a real ISS element set, not live telemetry,
a reconstruction of the 2015 reference flight, or a record of station attitude.
The visible camera is an artistic, forward-looking local orbital frame (LVLH).
In page composition, the limb starts at 22% from the bottom and smoothly moves
below the frame over the first 0.75 viewport of scrolling. The virtual camera
rises radially above Earth, preserving its opening attitude rather than tilting.
The lift is calibrated at 420 km so the limb ends approximately 16% below the
bottom, hiding the airglow too. Telemetry continues to describe the ISS position. Scroll also adds up to 90 seconds
along the same SGP4 trajectory as playback, with no separate camera yaw. The
offset drives Earth, clouds, sky and the status together and reverses on upward
scroll. Pausing freezes the playback clock while scroll still changes this offset.
Every scene pass receives the elevated camera origin; it does not translate or stretch the canvas.
Sections and the footer are transparent so the scene remains visible below them.

Camera position, geographic texture lookup and Sun direction share Earth-fixed
coordinates via Greenwich sidereal rotation. Earth is rendered as a 6371 km
sphere; the status uses the propagator's ellipsoidal geodetic altitude. Sun
position uses Astronomy Engine, also used for the Moon and planets. SGP4's
TEME frame rotates by GMST; the J2000 celestial frame goes through precession
and nutation to the true equator/equinox of date, then GAST to Earth-fixed.
Polar motion and stellar aberration are omitted; this is not a navigation tool.

Ground illumination follows its surface-normal/Sun angle. Daylight suppresses
city emission. Sky radiance has no observer-daylight multiplier; the common
camera exposure determines visibility against bright ground and atmosphere.
Cloud cover attenuates city lights
and receives sunlight. Earth uses separate overview and detail layers: a 4K
NASA daytime overview, 4K/8K night emission, and a 4K cloud overview. Day/night
surface tiles retain 86,400 × 43,200 source geography; cloud tiles retain a
16,384 × 8192 coverage map. Only visible detail occupies bounded GPU atlases.
Clouds and lights use scalar texture storage. See
[the surface model](earth-surface-rendering.md) and
[optimization measurements](scene-optimization.md) for compression and budgets.
The replay's initial night arc is mostly ocean; `t=0` includes Santiago and
`t=7200` includes southern Africa, while `t=610.87` looks over the South Atlantic.

Daytime atmospheric color uses single Rayleigh scattering
through an exponential 8 km scale-height atmosphere: 12 view samples and 6
sunlight samples, with geometric Earth shadow and wavelength-dependent
extinction. Multiple scattering, aerosols, ozone, refraction, and measured
weather are omitted. Airglow uses fixed Gaussian emission profiles centered at
90 km (warm, 8 km standard deviation) and 98 km (green, 4 km). View rays integrate
16 midpoint samples per visible shell segment between 50 and 130 km; the ground
occludes the far side. Smooth local solar illumination reduces visibility to a
2.5% daytime residual. This visibility curve, emission colors and strengths are
photographic approximations, not calibrated chemistry or radiance. The altitude
profiles do not crossfade or move with the observer's day/night state. Limb path
length supplies the soft warm night halo. An analytic grazing Rayleigh column
attenuates the far half, preventing a brightness jump at the solid limb. A fixed
quadratic contrast factor from the unlit emission column suppresses foreground
haze; this photographic grading does not depend on sunrise or observer daylight.
Twilight fill and exposure remain art-directed; the dark surface has no constant ambient fill.

## Auroras and structured airglow

`aurora.ts` adds transparent emission curtains above both magnetic poles.
The oval uses a centered dipole from the WMM2025 degree-one coefficients, with
its main footprint around 64–65 degrees magnetic latitude in this active preset.
Continuous shears at several scales create unequal folds, branches and quiet
gaps, without repeated spiral cells. The oval expands toward magnetic midnight
and contracts toward noon, using solar azimuth in the dipole equatorial plane.
This replaces a local solar-elevation offset with magnetic-local-time geometry.
Field-line mapping inclines the curtains with altitude. Slow advection and
folding use the replay clock, so pause, seek and shared frame URLs are repeatable.
The activity pattern is an artistic active-aurora preset. It is not an OVATION
forecast or a reconstruction of geomagnetic conditions at the ISS replay date.

Green emission has a varying lower boundary around 99–137 km and fades upward;
independent diffuse red emission peaks around 245–330 km. The red upper layer
extends over the sheet bodies with a weaker contribution over diffuse patches;
its strength is adjusted independently of the green rays and field. Bright green cores
are localized near the lower boundary, with a faint violet contribution.
A soft body follows each discrete sheet, while a separate diffuse green field
covers an equatorward band beside and between the sheets. Its width changes
with longitude, with broad unequal patches and darker channels instead of a
uniform fill. Diffuse activity is stronger on the magnetic night side. Its slow
variation is independent of the fine-ray mask, so overhead views retain a
translucent luminous area rather than only outlines. This volume peaks near
145 km and fades out by 270 km; it is self-emission, not a screen-space glow
or an implementation of aurora-lit clouds. The footprint stores discrete rays,
sheet body, lower-height variation and diffuse precipitation in RGBA.

A broad activity mask preserves quiet reaches and confines sharp folds and
fine rays to active sectors. Travelling folds and precipitation waves evolve
in simulated seconds, so 10× playback accelerates both shape and brightness. The bounded volume spans
85–420 km. Local sunlight suppresses visibility rather than moving its altitude.
Earth blocks the far side, and a grazing Rayleigh column attenuates far-limb
emission. This is a photographic RGB emission model, not a spectral chemistry
simulation. Brightness and activity are chosen for the scene, not calibrated
against the contrast-enhanced photographs. The existing warm airglow remains a
separate, lower-altitude layer; seamless world-space waves now vary its green
component and density slightly.

A one-time GPU pass creates a 2048 × 1024 two-hemisphere footprint with mipmaps;
the cross-oval sampling is about 7 km instead of 27 km. The volume pass searches
128 intervals per shell/cone segment and refines intervals containing discrete
sheets with eight midpoint samples. The smooth diffuse field uses the coarse
integral, so adding a broad luminous area does not trigger eightfold refinement
everywhere. Empty footprint samples exit before the emission profiles.
Explicit mip selection uses the magnetic-coordinate Jacobian, field inclination,
animated folding, pixel footprint and integration step. Fine lower boundaries
remain stable during orbital camera motion without broadening every curtain.
Conservative polar-cap/frustum/occlusion bounds can skip the pass; magnetic-cone
and sunlight intersections trim empty ray segments. The square-root encoded
target is at most half the drawing-buffer dimensions and 280,000 pixels.
It therefore follows adaptive scene quality on small/mobile drawing buffers.
Both footprint and emission target use RGBA16F when renderable, linearly
filterable half-float textures are available. This preserves faint gradients
before exposure; RGBA8 fallback uses deterministic dither in encoded space.
The half-float footprint with mipmaps occupies about 21.3 MiB; the target adds
at most 2.2 MiB. RGBA8 needs half those amounts. There are no new downloads,
history buffers or stochastic frame jitter.
The main shader adds emission before camera exposure, defocus and sensor noise,
using the same sRGB/Display-P3 output conversion as the atmosphere.

The optional pass requires 12 fragment texture units, 2K textures and explicit
texture LOD support; basic WebGL
retains the Earth, sky and airglow. Context restoration recreates the layer.
`aurora=0` disables it for comparison. A useful view is
`/?t=900&yaw=79&pitch=-10&motion=0`; a normal forward view can miss the oval.
`verify:scene` checks emission heights/colors, daylight suppression, solid-Earth
occlusion, deterministic pause, small-step temporal stability, and agreement
with a 384-interval reference using the same eight substeps. It also checks
multiple sheet crossings, the footprint seam and diffuse coverage away from
every discrete ray, HDR gradient precision and the actual RGBA8 fallback. It then captures aurora and
no-aurora views. GPU timings
are recorded as diagnostics, not a hardware-independent frame-rate guarantee.

The photographic balance follows Seán Doran's
[ISS – Light Of Aurora](https://www.youtube.com/watch?v=om-6v_gGtbs): independent,
interrupted folds rather than equally spaced parallel arcs, weaker diffuse red,
and a readable cool cloud layer beneath the emission. The reference is graded,
denoised and motion-interpolated ISS imagery at 3× speed, not raw camera footage.
The square-root emission target now represents radiance up to 1.0, so bright
curtains reach the shared camera highlight shoulder without clipping in this pass.

Cloud optical coverage controls extinction, not a solid height-map surface.
A smooth vertical density profile and broad regional variation form translucent
sheets: near-vertical views retain surface detail, while grazing rays accumulate
opacity. Sparse convection thickens selected regions without embossing rounded
bumps across every sheet. View, shadow and source-occlusion paths use the same
filtered density. View integration uses 16–96 samples according to the physical
path through the shell (about 650 m between samples), retaining the full budget
at grazing angles. Terrain intersections similarly use 8–96 steps based on
horizontal DEM texel spacing, followed by the same seven binary refinements.
A narrow symmetric blend repairs the source W/E plate
discontinuity south of 50 degrees at the zero meridian, including the overview,
detail, shadows and lens transmission. It is a visual repair of the photographic
composite, not recovered weather data. Lunar and urban illumination reveal the cloud layer
and ground.

City lights retain the measured scalar geography. An illustrative mixture of
warm, cool and greenish lamp colors varies by region and district; bright cores
approach white. The former city-shaped ground halo is removed. Seven filtered
samples estimate broad upward city illumination once per cloud view ray, with
height falloff and volume transmittance controlling its contribution. This is
an inexpensive single-scattering approximation, not measured lamp spectra.
Reduced sensor grain, weaker stellar scattering wings (with conserved flux),
and lower diffuse Milky Way radiance keep the night surface legible.

On `/`, dragging the scene turns the camera, sharing fractional yaw/pitch
state with the sliders and URL. Pointer capture keeps a drag coherent outside
the starting area, while controls and popovers remain interactive. Movement
is coalesced once per animation frame and does not pause the replay. Space
toggles playback on this page; repeats and focused interactive controls are
excluded so native keyboard behavior remains available.

References (no external code or imagery copied into the renderer):

- [NASA Heliopedia: diffuse and discrete aurora](https://science.nasa.gov/reference/the-heliopedia/), broad diffuse emission typically equatorward of the thin discrete curtains.
- [NASA: Flying Through the Aurora’s Green Fog](https://www.nasa.gov/image-article/flying-through-auroras-green-fog/), orbital reference for extended translucent emission.
- [NASA: Purple Haze Aurora](https://science.nasa.gov/earth/earth-observatory/purple-haze-aurora/), ISS photograph and emission colors; the published image is contrast-enhanced.
- [NASA: Red and Green Aurora Move Through Earth's Atmosphere](https://www.nasa.gov/image-article/red-and-green-aurora-move-through-earths-atmosphere/), orbital curtain structure.
- [NASA SVS: Earth's Airglow](https://svs.gsfc.nasa.gov/12963/), the distinction between global airglow and polar auroras.
- [Lawlor and Genetti: Interactive Volume Rendering Aurora on the GPU](https://www.cs.uaf.edu/~olawlor/papers/2010/aurora/lawlor_aurora_2010.pdf), footprint-plus-height volume rendering.
- [NOAA WMM2025 technical report](https://library.oarcloud.noaa.gov/noaa_documents.lib/NESDIS/NCEI/WWM_Report_2025.pdf), degree-one magnetic coefficients.

## Catalog sky

The sky contains 15,598 HYG v4.1 stars through visual magnitude 7. Their J2000
Cartesian positions and space velocities are advanced to the replay date,
then projected through the same Earth-fixed camera as the ground. B−V color
indices set restrained warm/cool tints. Stars and planets use the same flux
scale (`10^(-0.4 magnitude)`), lens PSF, and display transfer. A smooth pixel
footprint avoids procedural twinkling; stars have no independent animation.

The local catalog is 499,136 bytes, rendered as GPU points into a screen-sized
half-float HDR target so faint optical wings survive. GPUs without a renderable
half-float texture use a display-encoded RGBA8 fallback (overlapping stellar
sources are approximate there). Earth's occlusion, atmospheric extinction and
exposure are applied in the scene pass. The catalog remains in memory for
WebGL context restoration.

### Optical response

`bun scripts/build-optical-psf.mjs` generates three 256 × 256 RGB diffraction
profiles packed vertically into one 256 × 768 atlas (589,824 bytes). Each is the
squared Fourier transform of a different iris opening: rounded six blades,
partly withdrawn blades, and a nearly circular wider pupil. The widest state
still has short blade edges: f/3.18 is not an entirely unobstructed aperture. A 512 × 512 pupil grid
reduces blade rasterization artifacts; the central 256 × 256 focal region is
retained at the original display scale. Wavelengths from 420–680 nm are integrated
in 5 nm steps with approximate RGB sensitivities, small fixed wavefront errors,
and a pixel-response blur. The finite Fourier window fades gradually before
its boundary. At runtime, 4% of the energy goes into a normalized analytic
Moffat scattering tail rather than circular wings cropped into the texture.
This removes the visible disc-shaped support edge around bright sources. Every tile/channel has the same radiant integral; log radiance spans
2^-24 to 2^2. The shader decodes the two adjacent openings before interpolating
linear light, clamps sampling inside each tile, and scales area by f-number.
No extra sampler or render pass is needed; each PSF evaluation uses two atlas
reads instead of one. Catalog stars put 96% of their flux in a compact Gaussian
core integrated over each pixel, with 4% in this optical profile. Both components
retain the same integral. The true projected center preserves subpixel motion;
there is no brightness threshold switching halos on. Weak wings become visible
only as source brightness increases. Planets and 128 samples of the illuminated
lunar disk use the full optical profile. Light adds before display conversion and clipping; the Moon has no
separate decorative rays. Samples hidden by Earth emit no lunar light.

The shader adds a mild field-dependent comatic/astigmatic wing. Its contribution
grows with squared off-axis angle (projected ray slope), stretching radially
and shifting outward. The main aperture pattern retains its sensor orientation.
The wing's stretch is compensated by its area, and its energy is taken from
the original PSF rather than added. At the optical center the original PSF is
unchanged. This is continuous with source motion, with no time-based twinkling
or rotation. All sources use the same camera coordinates; portrait cropping
does not strengthen the aberration. Point sprites and lunar convolution bounds
include extra space for the wing.

This is a physically motivated synthetic lens, not a calibration of a particular
camera. Exposure, PSF display scale, scattering fraction, and sensor clipping
are chosen for the scene. The field-dependent wing is an approximation; lens
ghosts use an illustrative seven-element aperture preset. The Moon uses a Lambertian sphere without terrain or earthshine.

References for the method (no code or assets copied):
- [GalSim optical PSFs, pupils and wavefront aberrations](https://galsim-developers.github.io/GalSim/_build/html/psf.html)
- [STScI: convolving sources with a PSF](https://jwst-docs.stsci.edu/jwst-exposure-time-calculator-overview/jwst-etc-scenes-and-sources-page-overview/jwst-etc-point-spread-functions)

### Milky Way

The independent raster check is reproducible with
`bun scripts/audit-nasa-stars.mjs /path/to/hiptyc_2020_8k_gal.exr`.
It projects J2000 HYG directions into NASA's galactic image and measures nearby
RGB peaks and aperture flux, correcting pixel solid angle by cos(latitude).
Of 523 stars with V ≤ 4, 500 have no other such star within 0.6 degrees.
Their median peak offset is 1.35 arcminutes and the 95th percentile is 2.76
arcminutes (NASA pixels span 2.64 arcminutes). This supports the orientation
and catalog registration; it does not make the raster a precision astrometric
reference. Multiple stars, catalog epochs and sampling limit the comparison.

RGB aperture flux vs V magnitude has a measured log10 slope near −0.2 in B−V
bins, rather than the photometric −0.4 law, also with a wider 16-pixel aperture.
That suggests compressed brightness in this visualization; image aperture
measurements are not calibrated V-band photometry. Keep HYG magnitudes and the
linear-light Pogson law rather than overwrite them with image pixel values.

The background uses [NASA SVS Deep Star Maps 2020](https://svs.gsfc.nasa.gov/4851/),
an observation-based catalog visualization, rather than procedural dust or a
single photograph. The separate Milky Way map omits bright Hipparcos/Tycho stars;
our HYG catalog supplies the bright point sources. The corrected galactic EXRs
provide a 4096 × 2048 AVIF (0.58 MB) overview for every viewport. Visible sky
also streams detail from the 16384 × 8192 source: 512-pixel interiors with
16-pixel gutters, sparse coverage, and individually filtered mip levels.
Selection follows the galactic camera direction, excludes Earth-occluded sky,
and prioritizes the centre before neighbouring tiles. The bounded atlas holds
17 tiles on desktop (40.6 MiB) or 7 on narrow/coarse-pointer devices (18.1 MiB).
It shares the existing decode/upload scheduler and releases unused storage.
Unavailable or undersampled detail falls back to the overview; arriving tiles
fade in over 650 ms. Reflected galactic illumination keeps using the overview,
so tile arrivals do not change surface lighting. Bright point sources remain
in the separate star catalog. The 8K conversion remains a comparison asset.
The complete sparse detail set is 21.6 MB; it is not an initial download.
See the asset README for credit and conversion commands. Overviews use quality
50, effort 4; detail tiles use quality 65, effort 2. Both are 8-bit 4:4:4.
The former JPEG files are no longer shipped. GPU storage remains RGBA.
The 8K source distributes flux over four times as many pixels: its measured
mean linear RGB is approximately one quarter of the 4K map. Conversion scales
8K by four and 16K by sixteen before gamma encoding to preserve surface
brightness across sizes.
The streamed tiles retain the overview's low-frequency grade and add the
16K high-frequency residual (32-source-pixel blur). This avoids a brightness
step when more finely resolved catalog structure meets the nonlinear shadow
mask, without adding a runtime correction or extra GPU sampling.
The source conversion also bakes in saturation 1.2 and a smooth luminance
shadow toe (black 0.0015, toe 0.012, anchor 0.12). This reduces faint background
haze at high slider values without adding or moving astronomical structure.
A 0.7-degree blurred source-luminance guide suppresses background speckles
with a smooth 0.004–0.020 threshold before applying a fivefold exposure boost.
This brings the extended band toward the previous 500% setting at the new
100% default, with a highlight shoulder above linear 0.65. The guide affects
only the diffuse texture, never the independent foreground star catalog.
For paused inspection on desktop, after exposure settles, the render budget
rises from 1.8 to 4.8 megapixels (DPR capped at 2). Camera movement restores the
normal budget. Phones retain the normal budget. Inspection frames do not feed
the adaptive motion-quality controller.

The current diffuse radiance gain is 0.006 in linear light, with the brightness
slider at 100% of its current baseline. The shared night-illumination section
below describes how this source also contributes reflected light.

The plate carrée map centers galactic longitude zero, with longitude increasing
leftward. Its sampling uses Astronomy Engine's J2000 ↔ galactic transform, so
dust lanes stay aligned with the catalog through Earth rotation and the orbital
camera. Display contrast and exposure are artistic; this is not a photometric
calibration. Diffuse emission is kept below the catalog points; daytime
visibility follows the common camera exposure. The map adds in linear light; its dark dust lanes
never attenuate foreground catalog stars. `t=719.65` shows the nighttime band.
The map shares the sky's Earth
occlusion and atmospheric extinction. It loads asynchronously, restores after
WebGL context loss, and falls back to the catalog alone if unavailable.

Rayleigh scattering applies `background × transmittance + scattered light` in
linear light. Night airglow also adds as linear emission. Adding it directly to
gamma-encoded RGB would spuriously amplify background radiance and preserve too
much galactic contrast through the glow. Daytime scattering and night emission
occupy different altitudes and can coexist at dawn, as in NASA's
[Aurora, Meet Airglow](https://eol.jsc.nasa.gov/Collections/EarthObservatory/articles/AuroraMeetAirglow.htm).
The former broad tangent-height halo and its observer-daylight crossfade are
removed: sunrise changes emission visibility rather than replacing its shape.
The observer is not a calibrated camera.

Astronomy Engine supplies the Moon and five naked-eye planets (Mercury, Venus,
Mars, Jupiter, Saturn), including light-time/aberration as supported by its
GeoVector API. Subtracting the ISS position gives the topocentric direction:
lunar parallax is not discarded. Ephemerides are sampled once per simulated
second; camera position and terrestrial rotation update every frame. The Moon
has its date-dependent angular radius and a spherical illuminated disk convolved
with the shared lens PSF, and no surface map. Its automatic illumination and
waxing/waning orientation use the same selected scene date as the Sun, Moon
position, planets and stars. The illumination vector is cached per simulated
minute. Pausing freezes this date; changing Date or Time updates the sky while
retaining the camera position. Planet brightness derives from
apparent magnitude. Refraction, lunar terrain, eclipsing the Moon, and resolved
planetary disks are omitted. Clouds remain illustrative maps from another
observation period.

No fixed bright lights are copied from the reference photograph. Celestial objects
enter or leave the view according to the replay, with no mobile-only relocation.
For this flight, `t=1200` shows the Moon, Jupiter and Mars at night.

## Controls and rendering

Page composition has a four-line telemetry block: ISS Orbit Replay, UTC replay
date/time, hemispheric coordinates and altitude, then Image Credits.
All four rows use compact uppercase type at a uniform line spacing. Time and coordinates use tabular numerals. The title links to the standalone scene, carrying the displayed replay
time, yaw, pitch and paused state. An 8 px arrow appears on hover or keyboard
focus, separated by one monospace character (1ch). A separate 16 px settings gear
has a circular 32 px button in the lower-right corner and is always visible
alongside the telemetry. Touch devices also show the link arrow without hover. The standalone Orbit
page has no site header/footer, retains telemetry and credits, and includes a
Home link. It shares the renderer/assets and disables scroll composition.
Credits and settings use native auto popovers with Escape, light dismiss and
focus restoration. They are positioned beside the telemetry and constrained to
the viewport. Home telemetry is part of the hero rather than a fixed overlay.

Since 2026-10-15 the explorer (`/`) has no telemetry block. Time sits top
centre. On a HUD at least 960 px wide it is Space, named Time, then three tapes
hung 6 px lower so their short ticks share an axis with that name
along the top edge, plain like the side ones: the time scale, the date and the
time of day in UTC; there is no play button, since stopped time is simply 0×.
The time scale runs from 0× to 1000× in five equal stretches, 160 px in all:
linear from 0 to 0.1×, then four logarithmic decades, each end labelled (0×,
0.1×, 1×, 10×, 100×, 1000×) and a tick every sixth of a stretch, so labels and
ticks fall evenly. Speeds keep two significant figures, so 1× is exact. Pausing is 0×: Space, the tape or Settings' Time scale at 0 stop time and
keep the speed it had, which any non-zero setting or Space brings back. Settings'
slider runs over the same scale (positions 0–1000, 10× by default); a link with
`rate=0` starts stopped at 10×. The date runs over a common year, shorter than
the others: month starts long, the 11th and 21st short, January to January,
labelled every third month about evenly (Jan, Apr, Jul, Oct, Jan). The time
of day has a tick every half hour, labelled every three hours. Ticks hang from
the edge, labels sit under them and the reading (10×, 15 OCT 2026, 14:41:13
UTC) under the labels, joined by a rule; 48 px between the tapes clears their
end labels. Press or drag along a tape, scroll over it or use the arrow keys (a
hundredth of the time scale, a day, five minutes); a press near a labelled mark
takes the mark. The tapes drive Settings' Time scale, Date and Time, so both
stay in step. Narrower, they would run into the camera presets, and the one-line
clock stays, with its play button. Camera presets (Free, ISS, Polar, High) stack top left without a
plate, keys flush with the edge and names to their right, keys 1 to 4; the active one's key looks pressed, like a held
key, rather than the button filling like a segmented control. The HUD stays visible; it no longer fades when idle. Every HUD element keeps
12 px from the screen edges. Settings, a gear, stands alone top right; Info and,
under it, Help stack in the lower-right corner, set like the presets with their
keys i and ?. On a phone the presets and Settings sit below the clock. Settings
on the explorer leaves out what the HUD carries (camera direction and tilt, date,
time, time scale, exposure compensation, play); those inputs stay as the HUD's
state, and the personal site, which has no HUD, keeps them all. Help opens a
controls panel docked along the bottom, like an editor's shortcut sheet, which
stays open while you fly; a tab centred on its top edge, a chevron pointing
down, closes it, as do ? and Escape. It slides up and back in 0.3 s and shrinks
the scene above it as it goes, frame by frame to its moving edge, canvas and HUD
alike, as a phone's browser bars do, so the explorer itself
exercises the resize path the embedded scene meets on the personal site; the HUD
is a size container, so its tape and short layout follow its own height. The
panel has no tabs: a column per action (Fly, Look, Closer and farther, Lens,
Roll, Orbits, Time), scrolling sideways, and a lane per input (Keyboard, Mouse,
Trackpad, Touch) labelled at the left, so each input sits at the same height
under every action. Lanes for inputs the device lacks go, every lane reads alike
whatever input is in use, and a column with nothing left hides. Keys come as rows of key and
effect: a cluster laid out as on the keyboard (W over A S D, the arrows
likewise), alternatives joined by "or", and ⇧ as Faster wherever it applies.
Obvious taps and clicks are left out, and the cards' own gesture lines hide
while it is open. The panel's text and key caps share one size and a 16 KB
subset of Inter (`public/fonts`, OFL, weights 400–700) for its arrows and ⇧ ⌥;
inline keys sit on the text baseline. Info and
Settings are centred dialogs that scroll inside: Info carries a short note on
what the scene shows and the image credits. Diagnostics (`compare=1`, the MODIS study, `perf=1`) stack in
the top-left corner, under the presets. The altitude tape stands alone at the middle of the right
edge, without a card and without an axis line: the right ends of its ticks form
the line. Long ticks sit at 1, 2, 3 and 5 of each decade from the 150 km floor
to 50K, each labelled with its number only. Short ticks split each gap evenly, so
spacing changes only at a long tick; a gap gets as many as its round steps (25 km
from 200 to 300, 200 km from 1K to 2K), so each sits near a round value. Short
screens show only the long ticks and drop the 200, 3K and 30K labels. The reading sits beyond the labels, plain text
joined to the tape by a rule that passes under them; on hover or focus it turns
black on opaque orange. The lens tape mirrors it at the middle of the left edge:
0.5× to 20×, a 15 mm wide angle to 600 mm, logarithmic, long ticks on the 1-2-5
series (0.5×, 1×, 2×, 5×, 10×, 20×),
nearly even on that scale and labelled at both ends, short ticks at one pitch
along the whole tape (about a sixth of an octave). It is
0.7 of the altitude tape's height, so its 32 tick gaps fall about as close as
the altitude tape's 46; the two need not match in length, the reading (2.5×) beyond its labels. On
both tapes the reading stands the same gap past the longest label, so it
follows the label length (50K, 0.5×). A
press eases to its point, a drag follows, and near a labelled mark either takes
the mark exactly; it replaced the 1×/3×/10× presets. A press or drag on any
tape, side or top, leaves focus on the scene, so the flight keys keep working;
Tab still reaches the tapes. Over the lens tape, 44 px
up, a short exposure compensation tape: −3 to +4 EV, linear, whole stops
labelled and thirds between, 0.45 of the altitude tape so its ticks fall about
as close. It drives Settings' Exposure compensation, to a tenth of a stop or a
whole stop near its mark, and hides under manual exposure. Each tape's keys sit
together under it, 20 px off and on the presets' 24 px pitch, with their names on
the inner side of the caps: Farther R and Closer F under the altitude tape; Zoom
in +, Zoom out − and Reset zoom 0 (back to 1×) under the lens tape. + and −
replaced Z and X for the lens and no longer move the camera closer or farther;
R, F and the wheel do. 0, − and + sit side by side on the keyboard, so 0 left
Free, which is now 1, with the orbits on 2 to 4. The horizon gauge sits at the
bottom centre, plain like the tapes and presets, between Roll left Q and Roll
right E, down on the row's bottom edge level with the crosses' bottom keys, each
key against the dial and a turning arrow outside (anticlockwise,
clockwise), the gear's size, dim like the names they replace and white under
the pointer or while held. The wings sit on the dial's centre (they used to
lean 2 units left). WASD and the arrows stand along the bottom as
crosses at a quarter and three quarters of the width, rows on the presets'
24 px pitch: in the middle of WASD a small Earth, the size of a key, seen from
straight above the camera with north up, so it turns as you fly and as Earth
turns under the orbit. Land is filled the colour of the tapes' ticks and the sea
left clear; only the near hemisphere shows, so it reads as solid. A canvas traces
each device pixel back to a latitude and longitude, four samples a pixel, in a
128 × 64 land mask (`src/scripts/globe-land.ts`, 1 KB, built by
`scripts/build-globe-land.mjs` from the terrain map's Natural Earth water
channel), and repaints when the camera moves a tenth of a degree. \\ (reset the camera) sits
in the middle of the arrows'. \\ resets the camera: a followed
orbit eases its look-around back to ahead, free flight turns to face Earth's
centre. Without a keyboard the crosses go and the
roll buttons keep their icons. On a phone the gauge centres in the room the
corner buttons leave. The camera's latitude and longitude sit in the lower-left
corner; on a phone they stand above the gauge row. Heading, pitch and roll
readouts (HDG/PIT/ROL) used to sit above them; the gauge shows the view's
attitude, and from high up the pitch against the local horizontal disagreed
with its horizon, so they went on 2026-10-16. Only the round dial takes the pointer; the masked sky and ground,
twice its size, used to catch it far outside. Cards have no borders and no backdrop blur,
which cost frames over the live canvas and smeared at their edges; keyboard
focus shows as a fill or glow, never an outline.

The horizon gauge's dial has no outline: a faint white sky and a brighter white ground,
radius 16.33 in its 48-unit drawing (8 px narrower than at first, the arc and
Sun ring keeping their radii),
parted by 1 px of empty space at the horizon, with a pitch ladder over the whole
±90° (a rung every 6°, long every 30°) cut out of them the same way. The
ground used to be the accent's orange; it is now monochrome like the rest of
the HUD, white at the accent's brightness (68 %). Sky and ground stay faint
(45 %) until the pointer or focus is on the dial itself. The wings,
the Sun and Moon markers and the Earth arc are 1 px at any dial size. The Sun is
a ten-pointed star whose rays meet at right angles, outside the arc, the Moon a full crescent
opening up and to the right with blunt horns, riding on it; both are pictograms that only mark a direction and never turn.
The star's radius is 4.2 units, flying at 29.3 so it clears the arc with a
little room; the crescent's is 3.3. Both cut their own
shape, with 1 px clear round the outline, out of all they cross (the dial's
fill and ladder, the Earth arc and the wings), so their insides are holes onto
the scene rather than dark discs, and turn the camera to face them on a click. The gauge is
64 px (50 px on phones and short screens); the wings are white,
and the markers and arc match the tapes' ticks, half-white. Each part answers
the pointer alone, only when the pointer is on it: the dial brightens its fill,
the arc turns white and 2 px, and the Sun or Moon fills in white. The gauge has four targets, each only where it is drawn: the
dial levels or flips, as H does; the Earth arc turns the camera to face Earth's
centre, the Sun and Moon markers to face them, each thickening to 2 px under the
pointer over a wider invisible target. Following an orbit, the look-around eases
there (450 ms) and the orbit stays followed; where the orbit cannot look (the
high orbit sees nothing above its horizon) the camera flies free and turns.
Outside the
dial the Sun's and Moon's markers sit at their directions across the image (in
frame each flies inside the dial, as far out as the pitch ladder would place
it; they no longer dim behind the camera, which read as an unexplained grey) and an arc
marks Earth's: centred on the ground side, as long as the share of Earth's
surface in frame against what looking straight at Earth would show from there,
and never under 8 px. A sliver at the edge of the frame is a short arc, the
surface's edge across the middle of the frame about half a ring; it closes
once Earth fills the frame or its whole disk is in it (all four corners on
Earth, or the disk's edge all in frame), and stays closed while flying
straight away. It used to reach where the dial's horizon line meets the dial,
which, from high up, closed it with Earth a sliver at the edge of the frame;
capping that by the raw share of the frame Earth fills opened it while flying
away from a planet shrinking into view, then closed it again. A frame centre on Earth used to count too, which closed
the ring with half the frame still sky. The arc eases to each new extent, about
0.3 s, so it closes and opens visibly instead of snapping.

Since 2026-10-16 the dial's horizon is the one in the picture: Earth's surface
edge, which sinks below the local horizontal as the camera climbs (12° at
150 km, 30° at 1,000 km, 71° at 13,000 km), so the edge across the middle of
the frame puts the line across the middle of the dial at any height, and the
ladder counts degrees from it. It used to be the local horizontal, as on an
aircraft's attitude indicator, which from 1,000 km showed the dial nearly all
ground with the edge of Earth at the centre of the frame. Once Earth's disk is
narrower than the dial's reach (±39°, above about 3,800 km), its ground side
stretches so a view straight down still fills the dial and the line never swings
about the nadir.
H, or a click on the dial, levels a tilted view; on a level one it turns the
view upside down, and back. Long turns run clockwise. Following an orbit, H first clears the look-around
and then flies free to turn over. The gauge and H measure roll against the local
vertical right down to the nadir; north up stands in only for an exactly
vertical view. It used to take over within about 6° of straight down, which
flipped the gauge by the heading as the view passed that cone. The dial's roll
runs on past ±180° instead of wrapping, so its short transition never spins it
the long way round when the view turns over.

The flight path marker shows only during WASD flight, and for 1.5 s after.
Dragging or flinging the globe moves the camera too, but there it only drew a
stray marker high above Earth; R and F, from the keyboard or their caps, climb
or descend straight up or down, where it only marked the ground below.

There is no tutorial and no hints on the instruments; every key and gesture is
in the controls panel. Shift and Option show as their
key-cap symbols (Alt off Apple keyboards). Key caps keep 3 px inner corners all
round; the 2 px bottom edge gets a taller outer curve. Every single-glyph cap
is square, 18 px either way. The caps on the main screen are buttons too: hold
R, F, +, −, Q, E, WASD or the arrows as you would the key (Shift still speeds
it up); Space stops or starts time, 0 takes the lens to 1× and \\ resets the
camera. A cap that is a button takes a faint fill
under the pointer and lights while held, and focus returns to the scene.
Nothing else changes on hover. Key caps appear only once a keyboard is likely (a fine pointer) or used;
the controls panel's lanes follow the same detection, and Safari alone is told
that a trackpad rotation rolls.

`SceneCalendar` anchors simulation seconds to an independent UTC epoch. A fresh
page uses now, including links that specify only the old route offset `t`.
Saved interactions and links include `epoch` (ISO UTC) so the chosen lighting
survives reload. Date scrubs the selected calendar year, including February 29;
Time (UTC) scrubs 00:00–23:59. Each preserves the other component. Their reset
buttons restore today's date or the current time respectively. Both are positional
tracks with no fill. Time scale advances calendar and route time at the same rate.
Date changes re-evaluate celestial lighting, solar visibility and lunar phase,
but do not extrapolate the recorded ISS elements to another season or move the
camera. Thus ISS remains a replay ground track with selectable lighting, not a
live station-location prediction. Browser visual fixtures explicitly pin the
reference epoch; production has no frozen October date.

On `/`, Route selects the propagated ISS replay or an illustrative
circular orbit: Polar orbit (800 km, 90° inclination) or High orbit (20,000 km,
25° inclination). Model orbit periods follow Kepler's law; they are not replayed
spacecraft tracks. High orbit starts looking at Earth's center. Page composition
keeps the ISS route and normal page scrolling.

Free flight detaches at the exact current camera pose. Its orientation is stored
independently of position: local yaw/pitch gestures can cross either pole without
an angle clamp, and translation never aligns the camera with Earth's vertical.
The Earth-relative direction/tilt sliders belong only to Follow orbit. Legacy
links with tangent heading/elevation are converted once to the new orientation. Two-finger scrolling or
left-button dragging looks around; Shift with either gesture pans in the image
plane without rotating the camera. Pinch (Ctrl-wheel in Chromium) or Ctrl/Command
plus wheel dollies along the viewing direction, rather than changing the field
of view. Pan and zoom detach a following camera automatically. Gesture deltas
are coalesced per animation frame, retaining fractional motion.

On a touchscreen, one finger looks, two fingers pan, and pinch dollies. Touch
capture belongs to a separate full-scene layer with `touch-action: none`; settings
and links sit above it and retain native scrolling and taps. Adding or lifting a
finger rebases the gesture without jumping, and cancellation discards pending input.

Since 2026-10-13 one finger on Earth turns the globe about its centre like a
trackpad scroll, 2.5 times faster than the finger and without running out at
the limb. A flick coasts for about a second, at most 8 rad/s; Android sends no
momentum of its own. `touchMode=grab` holds the touched point instead, and
`touchGain`, `flingLimit` and `flingCoast` tune the feel. Trackpad deltas are
released over about two frames on each display refresh, 90 ms at 24 FPS
(`inputSmoothing=<ms>` fixes it, 0 applies them at once), which removes uneven
steps at the end of a momentum swipe. A trackpad scroll keeps the modifiers it
started with while its events, momentum included, keep arriving: Shift or
Control pressed as the globe coasts neither looks nor zooms, and the sideways
deltas macOS sends while Shift is held keep the swipe's axis. A pinch, which
Chromium reports with Ctrl but without the key, still zooms. A wheel that has
shown its clicks (deltas in multiples of 4.000244140625 px, or legacy 120s)
stays a wheel until a plain trackpad scroll: macOS turns Shift-wheel into a
sideways scroll whose deltas can lose that signature, and it used to pass for a
Shift trackpad scroll and look instead of zooming the lens. A Shift-wheel before
any plain wheel click still needs the signature.

Since 2026-10-15 the plain gesture moves over Earth wherever it starts, and
Shift turns it into the camera's: a left drag, a trackpad scroll or one finger
holds the Earth point under it, and off the planet, where there is none, turns
the globe like a scroll. The sky used to turn the camera instead, which read as
a second meaning for the same drag. The camera turns with a middle drag (as
it pans in design tools such as Figma), a Shift drag, a Shift scroll or two
fingers; Shift-wheel and Shift-pinch zoom the lens, the camera's own glass.
Option/Alt drag or a twist rolls. The right button, which rarely drags
anything else, circles the Earth point under the pointer, which keeps its place
on screen. The pointer works round it like a turntable: its angle about the
point is the camera's turn about the point's vertical, one for one, so a full
circle of the pointer flies a full circle round the point, and the ground under
the pointer follows it; moving away from the point raises the camera over it,
moving in lowers it. Within 16 px of the point the angle is ignored. (Mapping
across to turn and up to tilt broke down once the pointer went round to the
point's other side.) The camera stays above 5° of the point's horizon, short of
overhead and inside 150–50,000 km, and a step goes only the way asked; off the planet it
circles the horizon point toward the pointer, and straight overhead the
camera's up sets the tilt. While it circles, a ground pin marks the point: a
lit spot and a ring lying on the ground round it and a stalk standing up from
it, all in perspective so they tilt with the land, with ripples spreading over
the ground as it lands, like rings on water; it keeps its size on screen and
hides on Earth's far side. A double-click on Earth drops the same pin where the
flight heads, ripples and all, then lets it fade; on the sky the flat pulse
stays. The middle button's browser autoscroll is suppressed over the scene. Moving
over Earth, rolling or circling starts free flight from a followed orbit; only
looking keeps the orbit. Free flight waits for the first movement, so a click,
or the first of two fingers landing, leaves the orbit followed.

W/S move along the view, A/D strafe, Q/E move along the camera’s own up axis,
and Shift multiplies speed by four. Speed grows with altitude. The altitude
slider spans 150–50,000 km logarithmically. Gesture movement clips its entire
path against these bounds to prevent crossing Earth. A short damping interval
softens keyboard starts and stops. Movement uses elapsed real time, independently
of replay pause or Time scale. Blur, hidden documents and focus entering controls
clear held movement keys and queued gestures. Scrolling and pinch over controls
retain browser behavior; only the scene consumes them.

Follow orbit returns over 1.2 seconds, interpolating position along a great
circle and orientation with quaternions. Reduced-motion preferences skip that
transition. Free-flight position, quaternion orientation and selected route
are encoded in the URL; invalid coordinates fall back to following the selected route. Reset all
also restores ISS following. A dismissible, once-per-session hint explains the
controls. The ground track scrubber appears only while following a route.

Settings include pause/resume, orbit scrub, playback speed, Milky Way brightness,
film-grain intensity, color fringing, and lens reflections. Image controls
range from off to 200%, except Milky Way which reaches 1000%. All four default
to 100%, normalized to the accepted grade. Current renderer gains are galaxy
0.2625, grain 1.1, fringing 0.625, and lens reflections 1.0. The Milky Way baseline
is 75% of the preceding 0.35 gain; this new default is labeled 100%.
The Milky Way grade is also baked into its source maps.
Reset Image restores only
these four image controls to their individual defaults. Adjustments redraw paused frames too; values last for the
current page visit. The grain control changes photon counts, preserving the
signal-dependent noise model, and zero bypasses sensor noise.

A temporary optical pass handles aperture-shaped loading defocus once. The final
camera pass reuses that image for radial red/blue magnification differences,
then adds lens reflections and sensor noise. The temporary target is freed when
focus settles. Optical
defocus averages linear light with a rounded six-blade pupil; it does not blur
sensor grain. Ghosts change size and softness independently per path during the
focus pull instead of receiving the scene blur. This remains a photographic
approximation. The separation grows smoothly toward the frame edges; text and
UI are outside this pass. It uses a half-float scene target where filtering and
rendering are supported (up to 14.4 MB at the pixel cap), otherwise RGBE in RGBA8. The fallback decodes each texel before bilinear
filtering, so HDR light survives until sensor processing in both paths.
The Color fringing baseline is half its previous strength: the former 50% is
now labeled 100%. Separation still falls to zero at the optical center.

The camera meters every texel of a 37 × 25-texel level of the glare pyramid
(the finest no larger than 64 × 64), each a box average of its 32–64 px
square, with a gentle center weight. RGBE scenes, which have no pyramid, and
`meter=points` use 1024 point samples of the scene instead.
A 24-bin log-luminance histogram spans -16 to +8 stops of scene radiance.
It trims the lowest 10% and highest 2% by weighted area, then uses the retained
log mean to target 0.055 linear radiance. Within-bin log sums avoid rounding
uniform scenes to a stop boundary. A coverage-weighted strongest-channel
measurement protects extended coloured highlights; isolated stars may clip.
The pyramid's alpha marks subjects: blocks about 1/70 of the frame height
that are mostly lit. A star never fills one, so a lit region counts from
0.005% of the frame and fully from 0.025%, and a 40 px Moon is metered
wherever it falls; its radiance is the cell's light over its subject share.
Point samples cannot tell a star's core from a subject and need 0.6–2.5% of
samples. Both targets are limited to the automatic range before coverage
blends them: blended unbounded, a black sky's +15 EV outweighed any smaller
bright subject. See [the zoom metering lab note](lab/auto-exposure-zoom-2026-10-16.md)
and [the pyramid metering lab note](lab/pyramid-metering-2026-10-16.md).
An analytic disk-area measurement catches the Sun between taps, including
occultation and atmospheric transmission. The meter does not receive Earth
position or object labels. All automatic views use one -3.0 to +5.1 EV range; manual exposure retains -5.5 to +5.1 EV.
Two one-pixel RGBA8 targets store EV at 16-bit precision; no GPU readback or
additional render pass is needed. Adaptation uses real elapsed time, with a
1.25 s time constant when brightening and 0.4 s when darkening. Darkening waits
for a target sustained for 120 ms, rejecting short lightning flashes. Initial
load starts at its metered target; a paused seek continues settling for seven
seconds without advancing
the orbit or grain. Context restoration reconstructs the meter. Shared exposure
includes internal reflections; a highlight shoulder starts at 0.8 linear
intensity after sensor sampling and before output transfer. Its peak-energy
curve is preserved, while overexposed colors progressively approach neutral
white by linear intensity 2. Dim lights retain their chroma. City cores also
reach neutral white in the source palette rather than stopping at cream.

The Milky Way sampler wraps longitude derivatives before mip selection so
crossing the panorama seam cannot produce a dark diagonal strip. WebGL
implementations without explicit gradients use the base level for this plate.
The Earth albedo overview uses the same wrapped-gradient treatment. Otherwise
the longitude branch cut selects a global-average mip, drawing a dotted line
across Antarctica and the ocean. The browser fixture covers the diagonal seam
with and without explicit gradients; the Antarctic free-flight view is also
checked visually.

The virtual 24 fps camera holds a 180-degree shutter (1/48 s). Of the metered
correction above +0.5 EV, 60% opens the aperture and 40% increases ISO. This moves
smoothly from f/4, ISO 400 to approximately f/3.18, ISO 543; the optical throughput
times ISO gain exactly preserves the accepted total exposure. Beyond +1.6 EV
the aperture stays at f/3.18 and ISO continues to approximately 6150 at +5.1 EV. It is a chosen
video exposure program, not a claim about every camera's auto mode. Below the day
baseline, two thirds of the correction closes the iris and one third lowers
ISO, reaching f/16 and ISO 100 at −5.5 EV. The shutter remains 1/48 s.

The same GPU exposure state drives ghost radius, rounded-blade shape, off-axis
coma, vignetting and loading defocus. Ghost area normalization avoids adding
energy merely because the footprint grows. Diffraction footprints scale with
f-number; opening the iris interpolates equal-flux wave-optical profiles and
increases the off-axis comatic wing. The iris geometry is a synthetic preset;
the field-dependent wing remains an approximation, not a named objective.
Stars and the Moon read the previous frame's exposure state, while final sensor
processing uses the current one; the normal lag is one rendered frame. On devices
with fewer than eleven fragment samplers, the Moon/planet PSF keeps its baseline
pupil to preserve the surface texture budget; star PSFs and final lens/sensor
processing still adapt. Lateral color fringing retains the newly halved baseline;
it is not arbitrarily multiplied by aperture. No shutter-motion blur is added.

References: [Nikon on auto ISO and exposure controls](https://www.nikonusa.com/learn-and-explore/c/tips-and-techniques/understanding-auto-iso),
[Nikon on aperture and diffraction starbursts](https://www.nikonusa.com/learn-and-explore/c/tips-and-techniques/bright-idea-adding-star-power),
and [Martinec's measured sensor-noise analysis](https://www.photonstophotos.net/Emil%20Martinec/noise.html).

Source color maps remain sRGB and are converted into the output primaries.
Relabeling an sRGB map as Display P3 would change its colors, not recover extra
source gamut. The atmospheric scattering and airglow receive separate 25% and
40% chroma increments at constant output luminance. These procedural colors can
extend beyond sRGB on a P3 canvas. Unsupported screens use luminance-preserving
chroma compression into sRGB. Clouds, terrain maps, stars and the portrait do not
receive that saturation grade. These choices are photographic, not a calibrated
sensor or spectral atmosphere model. See the browser's
[canvas color-space contract](https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/drawingBufferColorSpace)
and [exposure adaptation reference](https://dev.epicgames.com/documentation/en-us/unreal-engine/auto-exposure-in-unreal-engine).

Seven tinted lens-reflection elements follow conjugate positions on the
source-to-optical-center line: compact aperture images, softer broad ghosts and
a thin aperture rim. The outline matches the PSF's rounded six-blade pupil
(blade-normal orientation 0.27 radians). Pixel-width edge filtering prevents
hard polygon edges from aliasing. Radial stretch and barrel clipping grow
continuously off-axis; the pupil orientation stays fixed to the camera. Smooth
blade joins and a broad asymmetric illumination profile
avoid uniformly filled geometric stamps. Edge softness varies by element and
field angle. A three-wavelength thin-film-inspired tint varies with source angle
and gently across each ghost; its phase differs for each reflection path. This
is an artistic coating approximation, not measured multilayer coating data.
Sources just outside the picture can still contribute, fading with field angle.
Energy follows the integrated illuminated, Earth-unoccluded lunar disk. The Sun
uses its circular disk's visible area above the spherical limb, rather than
popping on at its center's sunrise. Tests compare this area approximation to
independent ray/sphere disk samples. Ghosts can overlay Earth because they form
inside the lens after scene compositing. Each path receives a fraction of the
source's integrated image-plane flux, divided by a conservative bound on its
elliptical support integral. The strongest path returns 2.5 × 10⁻⁵ of the
source flux, two reflections at about 0.5% from multicoated surfaces; the seven
paths together return about 6.9 × 10⁻⁵ at the default slider. This efficiency
and the path shapes are chosen parameters, not a calibrated lens prescription.
Each path's kernel scales with the entrance pupil, focal length over f-number,
so zooming in on the Sun or Moon widens their reflections as their flux grows
and keeps reflection surface brightness constant. Stars and planets use
the same Pogson brightness and PSF integral as their direct images, converted
from CSS-pixel area to viewport-height area. The Moon uses its rendered disk
area and integrated illumination; the Sun uses its shared irradiance and the
projection Jacobian. Exposure acts on direct and reflected light together.
Solar and lunar ghosts include the finite source radius in their footprint and
edge softness. This is a variance-matched convolution approximation. Increasing
ghost size cannot multiply integrated energy. A float-buffer GPU regression
integrates the actual kernels for multiple pupils, focal lengths, disk sizes
and chain types. The calibration is recorded in
[the lens reflection lab note](lab/lens-reflections-2026-10-16.md).
Everything else in the picture reflects through the same seven paths from the
glare pyramid: path i reads the scene at p / c_i, at the level whose spread
matches its aperture, with 1/c² preserving flux. The Moon's and the selected
points' stamps keep only their share outside the picture, so nothing reflects
twice. At coated-lens reflectance these reflections of Earth and the Moon stay
a few output levels at most; their glare dominates. `fieldReflections=off`
disables them. See [the field reflection lab note](lab/field-reflections-2026-10-16.md).
The visual reference is [Don Pettit's spacewalk photograph](https://svs.gsfc.nasa.gov/31347/):
bright white source scatter with weaker colored reflections through which scene
detail remains visible; it does not calibrate this preset to that camera.
On devices with at least eleven fragment samplers, a 5 × 1 prepass integrates
cloud and air transmission toward the Moon, Sun and three selected point sources.
Its result attenuates each ghost chain. This samples disk centers for extinction;
partial Earth occultation still uses disk area/samples. Lower-capability devices
retain the Earth-occultation approximation. Up to three bright catalog stars or planets also generate
shorter three-element chains. CPU selection uses catalog magnitudes below 0.75,
proper motion, the same Earth-fixed projection and limb visibility. Cloud and
atmosphere extinction are applied once by the shared transmission prepass.
There is no separate magnitude boost or saturating planetary brightness curve.
Selection changes crossfade over three replay seconds; seeks and aspect changes
reselect immediately. Jupiter next to the Moon is included. At zero the
reflections control removes lunar, solar and point-source ghosts.

On P3 displays with WebGL color-space support, the drawing buffer is tagged
Display-P3. Source texture uploads stay sRGB. Immediately before lens compositing,
the scene is decoded with the sRGB transfer and converted from linear sRGB to
linear P3; ghost colors are authored in linear P3 and added there. The shared
camera finish receives encoded colors in the selected gamut. sRGB displays use
the inverse transform for ghosts and fit negative channels toward an
equal-luminance neutral. This uses the wider gamut for colored ghosts without
reinterpreting the existing Earth/sky textures as P3. Matrix tests preserve
neutral colors and round-trip source colors. Display-P3 is SDR, not HDR.

This is a data-driven photographic preset, not a named lens calibration or an
implementation of the full paraxial ray-transfer method. Positions, sizes and
tints are chosen for the scene; the count is not a measured property of a lens.
The tint/pupil model needs no network asset. Source transmission adds only a
five-pixel RGBA8 texture and framebuffer on supported devices.
References (no code or assets copied):
- [Lee and Eisemann: Practical Real-Time Lens-Flare Rendering](https://publications.graphics.tudelft.nl/papers/335), aperture images and source-dependent ghost placement.
- [Unity Lens Flare Data Asset](https://docs.unity.com/en-us/engine/6000.7/manual/visual-effects/lens-flares/lens-flare/asset), individually configured aperture, ring and soft elements.

The orbit scrubber seeks within the current revolution and pauses playback.
The phase label describes sunlight at the subsatellite point; the visible
horizon can already be in daylight while the ground directly below is dark.
A URL with `t` and `motion=0` records the chosen replay time. Speed spans
0.25–120 times real time, defaults to 10 on each page entry. Playback advances
the same clock for SGP4, Earth rotation and sunlight, without resetting the
geographic track after each revolution. The clock is anchored to monotonic
`performance.now()`, independent of rendering and without truncating delayed
frames. Seek reanchors the clock and preserves the current pause state.
The UTC readout has a separate timer aligned to displayed second boundaries
(including the fractional replay epoch), independently of the display frame rate.
Browser/main-thread scheduling can still delay presentation under load.

Rendering is capped at 24 frames per second, 1.5 device pixel ratio and 1.8
million pixels. Animation stops when paused or when the document is hidden.
In page composition, below the first viewport only the controls hide: the background remains
visible and animated. Scrolling a paused page redraws the camera at up to
24 FPS without advancing the playback clock or grain. Motion is on by default,
including under reduced-motion preferences, by design for this
scene. The pause button and `motion=0` provide manual control. Context loss reveals a CSS fallback;
restoration rebuilds the scene and catalog passes. Disconnecting the component releases its
resources and listeners.

Sensor noise is sampled independently per RGB channel on a 1 CSS-pixel grid,
with a fresh pattern on each rendered animation frame. Linear optical
radiance, including aperture throughput and vignetting, determines collected
electrons before ISO gain. The baseline is 36,000 electrons at linear white,
scaled by the grain control. Read noise combines 0.9 electrons upstream with
0.8 electrons downstream referred through ISO gain (about 1.2 electrons RMS at
the baseline ISO). Shot noise
uses an inverse-CDF lookup below 16 expected electrons and a Gaussian
approximation above that. The generated 1024-square scalar lookup removes the
former 48-step per-channel inversion loop; tests bound mean/variance error. Vignetting precedes noise; full-well clipping, ISO amplification, the highlight
shoulder and display encoding follow it. There is no day/night noise multiplier. Increasing electrons at white reduces
grain while retaining the signal-dependent variance. Pausing freezes the pattern;
orbital acceleration does not speed it up.

`grainSizeCss` sets the grain cell size; the shader converts framebuffer
coordinates using the actual render-to-CSS pixel ratio. When the render budget
reduces the buffer below CSS resolution, cells smaller than a rendered pixel
cannot be resolved individually.

This is an equivalent sensor model applied to the scene's existing photographic
exposure, not a calibrated camera or absolute radiometric simulation. It omits
Bayer sampling/demosaicing, dark current, fixed-pattern noise and quantization.

The controller, renderer, asset loading/focus state, shaders, and adaptive quality
policy have separate owners. `scene-panels.ts` owns popover placement, dragging
and event cleanup. `scene-work.ts` gives all maps and tile layers a shared budget:
four network jobs, two decoded inputs alive, and at most four upload submissions
or 3 ms per 16 ms opportunity. Preview work has priority, then visible tiles,
then overviews; waiting jobs age to prevent starvation. Large image/terrain
uploads are split into strips. Only compressed image/DEM blobs survive upload;
decoded bitmaps close immediately and DEM arrays become collectible. The compact
star catalog and PSF are retained. Context restoration rebuilds GPU resources
and decodes compressed inputs sequentially. Optional layers fail independently.

Texture atlases allocate on first use and return to a one-texel placeholder after
two seconds without visible demand. Page tables upload only when residency or
fade values change. Cloud detail has true neighbor gutters and isolated mip
levels, matching the day/night cache. Save-Data requests and devices below a 4K
texture limit use only previews and compact sky inputs, without streaming tiles.

Playback uses delivered frame intervals on every browser, including those with
GPU timer extensions. GPU duration alone misses browser/compositor delays, and
an available extension need not yield usable query results. Playback releases
pending queries and keeps GPU costs out of its frame-interval sample windows.
Sustained mean delivery above 46 ms lowers buffer dimensions toward a 45% floor;
startup and severe overload use shorter windows. Stable delivery allows small
upward probes, with rollback and retry backoff when the larger size is too slow.
Pauses and background time are excluded.

Since 2026-10-13 the explorer renders on whole display refreshes, every k-th
refresh nearest to 24 FPS (30 FPS at 60 Hz, 24 at 120 Hz), so frames are evenly
spaced; `cadence=timer` restores the old timer. Above 0.75 scale a gesture
and its coast render at up to 60 FPS, also on whole refreshes; three frames in
24 that miss one or two refreshes slow that by one refresh, and a long clean
run tries faster again, each failed attempt waiting twice as long. A gesture
after a pause starts fast again unless one was slowed in the last 20 s. A
downscaled device keeps its passive cadence during gestures. A longer stall,
from garbage collection, the compositor or another app, is not overload and
changes neither cadence nor scale. Three late frames in 24 at the passive
cadence lower
the scale once the view is quiet (`headroom=0` disables), and the last
sustained scale is remembered per screen (`startScale=fresh` ignores it). The
buffer grows when Earth and its atmosphere cover less of the frame, assuming a
sky pixel costs a tenth of a planet pixel (`viewScale`, 0 to disable), so a
distant planet is sharper at the same cost. A 0.75 shutter blurs camera
motion (`motionBlur=0`): Earth and its air up to 120 km with their parallax,
the sky above the limb with the camera's turn alone (`skyBlur=0` keeps it
sharp). Since 2026-10-15 the background uses the
same whole-refresh cadence, repaints in the same frame after a buffer resize
(a resize clears the opaque buffer and showed as a black frame), and pauses
while the first ancestor with a box is off screen, since its fixed canvas
always intersects the viewport. It gets none of the other adaptations. Both
share the accepted work reductions:
regional terrain bounds, lean shading, the noise lattice table, shared terrain
page entries and temporal cloud reuse (`terrainBound=off`, `shaderWork=legacy`,
`noise=hash`, `terrainFetch=separate`, `cloudReuse=off`). See
[the lab notes](lab/scene-work-2026-10-13.md).

Paused interactive draws retain asynchronous GPU timing where supported: six
samples for the first decision, then twelve, with at most two pending queries.
Cloud integration steps and texture detail remain unchanged. `quality=fixed`
disables adaptation for comparisons.

Mobile day/cloud atlases hold up to 17 tiles (six cells across); the cheaper
single-channel night atlas holds up to 31, bounded by the device texture limit,
rather than seven. Visible geography is selected before speculative neighbors.
Shader texture samplers explicitly use
high precision, including HDR scene/exposure buffers and packed DEM values.
The GLSL ES default sampler precision is low even when float precision is high;
desktop GPUs can hide that difference. See the [GLSL ES specification](https://www.khronos.org/files/opengles_shading_language.pdf).

Sunlit ground includes a bounded approximation of downward scattered skylight,
using half of the sunlight removed from the incident beam. This returns part of
the missing blue illumination to snow and terrain. It vanishes with local solar
elevation at night; low-angle direct sunlight can still tint snow warmly.

The background covers `100lvh`; a `100svh` reference keeps the opening horizon
and 0.75-screen scroll distance stable while mobile browser toolbars move.
Only actual viewport-size or quality changes resize the drawing buffers.

Cloud, atmosphere and airglow composition share linear light. The photographic
surface/sky grade and camera transfer remain deliberate approximations, not an
absolute radiometric or calibrated HDR pipeline.

Repeatable frames: `/?motion=0&t=0` (night), `t=1950` (dawn), `t=3000`
(day), and `t=4800` (dusk). `surface=0` disables the image maps for debugging;
it does not restore the previous orbital or atmospheric model.

`bun run verify` checks the orbit's altitude/inclination, westward ground-track
shift, camera basis and horizon, consistent solar coordinates, and eclipse/day
phase sequence. It also checks catalog anchors/proper motion, celestial frame
agreement with an independent horizon projection, and topocentric Moon/planet
directions, the Galactic pole/center, lunar phase flux/occultation, and the optical
LUT energy and boundary, then runs Astro diagnostics and the production build.

`bun run verify:scene http://127.0.0.1:4322 /tmp/orbit-browser-proof`
uses an isolated agent-browser session to capture seven orbital positions,
inject failed asset requests, restore a lost context, and exercise playback.
Build first when the local server serves `dist`. Browser tooling must already be
installed; the command does not attach to an existing browser tab.

[Image sources, licenses and modifications](../public/media/orbit/README.md).


### Camera direction controls

The settings panel provides Direction (−180° to +180°) and Tilt (−90° to +90°)
with individual reset actions. Direction rotates around the local Earth
vertical, so turning to look aft preserves the horizon rather than rolling it.
Tilt offsets the opening camera attitude and clamps at zenith/nadir; scroll
elevation does not modify this angle.
All scene passes and surface tile selection receive the same rotated camera
basis. The ISS position, replay time, phase and playback state are unaffected.
`yaw` and `pitch` URL parameters retain the view on reload and shared links;
reset removes them. Camera changes also restart paused exposure settling.

## Solar HDR and ocean-facing exposure

The solar angular radius is 0.00465 radians. Scene-relative irradiance 2.2
determines disk radiance through E / (pi radius²), rather than an unrelated
low display brightness. Twenty-four disk samples convolve the shared lens PSF;
the work is restricted to the source neighborhood. A normalized two-scale
Moffat veil redirects 1.5% of incident solar energy into broad optical scatter
after atmospheric compositing. It remains when the ghost slider is zero. The
kernel is angular: scatter at the window and front element precedes focusing,
so the halo grows with focal length at constant surface brightness. The rest
of the frame scatters with the same kernel and fraction through a half-float
image pyramid whose level weights decompose the Moffat into Gaussians; the
Sun's footprint is capped out of it. Glare moves light, L + η(L ⊛ V − L), so
sunlit limbs, the Moon and planets get halos at no energy cost. RGBE scene
buffers keep only the solar veil. `glare=off` disables the frame glare for
comparison. See [the veiling glare lab note](lab/veiling-glare-2026-10-16.md).
Solar disk, veil and ghost paths all receive the shared camera response; UI
and the portrait do not. The sensor has four times baseline-white full-well
headroom before ISO amplification, retaining white at the new ISO 100 endpoint.

The exposure weights, scatter fraction, ghost efficiencies and display shoulder
are photographic choices. The scene still compresses the real Sun-to-star
dynamic range; it is not calibrated in lux or to a measured camera. Looking
at the Sun now substantially dims stars rather than leaving night exposure.

## Orbit controls

The popover is titled **Your view**, with a 30% black background, no border,
section captions or dividers. Only the title and close icon occupy its header.
Reset all and the icon-only Play/Pause control share the footer. Milky Way
brightness spans 0–200%, centered at its accepted 100% baseline. Camera direction,
camera tilt, color separation and lens flares use explicit labels without groups.

The Moon's phase and limb orientation always follow the scene's date; the same
light drives the disk, water reflection and lens flare flux. Settings used to
offer a manual phase that overrode the illumination (kept in the URL as
`moon`); it went on 2026-10-16, and old links drop the parameter. Reset all
restores the current calendar, starting route time, 10× speed, playback,
default camera and 100% image controls, removing their URL overrides.

In page composition, popover headers support pointer-captured mouse/touch dragging, excluding buttons; the explorer's drawers do not move.
Positions persist while the component is mounted, including close/reopen, and
are clamped on drag and viewport resize. Moving a panel does not resize or redraw
the WebGL render targets.

Telemetry and its actions always use opaque white. No background sampling or
GPU readback is needed to choose their color. Link hover/focus adds the same
underline without changing ink; the settings button adds a 12% white background.

Slider fills show deviation from the default: effects are centered at 100%,
time scale at 10x, and camera tilt at zero. Time scale maps the lower half to
0.25x–10x and the upper half to 10x–120x. Orbit position and camera direction
have no fill. Centered controls mark their neutral midpoint.
Semibold values reveal an individual reset button on hover or keyboard focus,
with a 120 ms slide; touch devices always show it. Orbit reset restores the
initial position and does not change pause state.
Both browser range-track implementations share the same fill gradient.

Slider input updates control state immediately but only invalidates the renderer.
Playing scenes consume the latest values on the next 24 FPS frame; paused
and loading scenes coalesce invalidations into a single capped RAF callback. URL
writes are likewise coalesced per animation frame. Seeking preserves playback
state and does not implicitly pause. Asset/focus/exposure callbacks share the same
paused invalidation path, rather than competing with slider draws.

The GPU terrain regression isolates a real ETOPO Himalayan patch from the
photographic albedo, clouds and haze. Opposing low solar angles must change
slope brightness and cast ridge shadows. Orbiting the camera does not rotate
the Sun around a fixed ground feature on the orbital timescale; solar shading
changes more slowly than the passing view. No vertical exaggeration is applied.

Nearby land streams Copernicus GLO-90 (3 arcseconds, nominal 90 m), with
ETOPO 60-arcsecond patches and the global 4K/8K DEM as fallbacks. Height,
normal and shadow queries share the same numeric height field. A half-degree
patch contains 600 × 600 samples plus 16-pixel gutters and four packed mip
levels. Variable-longitude source rows are resampled without exaggerating
heights. Mips average metres before 8 m RG packing. Neighbouring half-degree
patches share source samples; gutters outside a one-degree source tile
extrapolate its last local slope, an approximation at those boundaries.

Both levels share sampler 15. The bounded atlas holds 15 patches (54.9 MiB)
on desktop and 6 (24.4 MiB) on narrow/coarse-pointer devices. Fine patches get
10 / 4 slots when visible, prioritizing useful footprint and screen centre.
Two parent COGs are cached decoded (about 24.4 MiB); at most two patch jobs
run concurrently. GeoTIFF decompression and mip construction run in a worker;
GPU uploads use the shared queue in 64-row strips. Requests cancel when the
view moves away. Failed jobs back off, and offscreen atlas memory is released.

The public source bucket has no browser CORS headers. `/media/orbit/dem90/`
accepts only bounded GLO-90 source coordinates through a fixed-origin proxy.
`bun run dev` and `bun run preview` provide this route locally. A hosted
deployment needs the same route; `server/terrain-source.mjs` exports a
fetch-style handler that also runs in edge runtimes. Rebuild availability using
`bun scripts/build-terrain-availability.mjs`.

Shadow rays start on the sampled surface and filter subpixel blockers using
the projected pixel footprint and solar angular size. Normals keep a common
angular sampling footprint when crossing DEM resolutions. Sparse marching
still approximates very thin or distant blockers; this is not an offline
path tracer.

Terrain inspection is opt-in via `terrainView=clay`, `terrainView=color`, or
`terrainView=albedo`. Clay and color share the production intersection, slope
normals and mountain-shadow code, with fixed response and a small 0.03 diagnostic
fill. Albedo shows the source color without lighting. All three bypass clouds,
atmosphere, lens effects and camera exposure, including the split-volume path.
They are debugging views, not new defaults. Day tiles load on the visible ground
even when the real Sun is below its horizon.

`terrainSun=90,8` places a diagnostic Sun east at 8 degrees elevation relative to
the camera's ground position; `270,8` reverses it. Omitting this parameter uses
the real scene Sun. It affects only the inspection shading, not scene time or
astronomy. Keep camera and `motion=0` fixed when comparing directions.

An inspection of the Southern Alps at 375 km confirmed opposing slope lighting
and ridge shadows at low Sun. The native 21600-wide DEM retains narrower ridges
than the 8192-wide overview, but remains coarser than the 500 m color composite.
At 49-degree solar elevation the clay relief has much less contrast than at
8 degrees. Unlit BMNG retains a strong mountain pattern; this comparison alone
cannot separate residual photographic shadows from snow, vegetation and rock
reflectance. No global de-lighting or replacement albedo has been applied.

Summit audit (2026-10-10): the 60-arcsecond source is not summit-accurate.
At Everest (86.925 E, 27.9881 N), bilinear ETOPO height is 8054.85 m,
packed detail 8057.28 m, GPU sample/intersection 8057 m, versus the surveyed
8848.86 m. At K2 (76.5133 E, 35.8808 N), the same chain is
7416.71 / 7414.33 / 7415 m, versus 8611 m. The 8192 overview yields
6747.06 m and 6262.33 m respectively. Even the largest source sample within
5 km is only 8157.36 m at Everest and 7595.98 m at K2. These are spatial
resolution losses, not a unit/vertical-scale error. Quantization error across
18 by 18 source windows is below 4 m; the GPU fixture allows 8 m for packed
height filtering and float ray-intersection precision. The fixture tests the
production atlas lookup and intersection shader, not a replacement height formula.

`terrain-height-browser-fixture.mjs` is part of `verify:scene`. Its audited
source samples prevent a GPU round-trip test from silently accepting different
heights. Summit references: [Nepal mountaineering statistics](https://giwmscdnone.gov.np/media/pdf_upload/Facts%202025%20Final_jktttlf.pdf)
and [DLR K2 elevation model](https://www.dlr.de/en/images/2011/3/elevation-model-of-k2_2047).
The [NOAA ETOPO guide](https://www.ngdc.noaa.gov/mgg/global/relief/ETOPO2022/docs/1.2%20ETOPO%202022%20User%20Guide.pdf)
describes 30/60-arcsecond products as downsampled 15-arcsecond data. Preserving
surveyed summits requires a finer source, not a global height multiplier or
isolated peak spikes. Current geometry has deliberately not been exaggerated.


`terrainDetail=coarse` selects the previous ETOPO-only streamer;
`terrainDetail=0` keeps only the global DEM for controlled comparisons. The shader needs
16 fragment texture units; smaller devices retain the global terrain.
Direct sunlight is multiplied by actual cloud/mountain visibility, with no
26% minimum. The existing atmospheric diffuse light remains a separate term.

### Distant Earth and auroral shape

Free flight uses the same frame histogram as the orbital view. There is no
separate Earth-disk meter or geometry-dependent gain. A small bright planet
contributes according to its pixel brightness and coverage, like any other
bright subject; a fixed manual exposure is available for comparisons.
Terrain and clouds have no unconditional night fill. They share a weak lunar
source in linear light, with phase, local direction/parallax and Earth/air
extinction. Ground illumination also follows surface slope and cloud shadows;
ocean glints use the same source strength. City emission and its scattering
inside clouds remain separate. There is no observer-daylight boost to moonlight.
The scale remains illustrative, not an absolute photometric calibration.

Solar photosphere samples are occluded before lens convolution. The surviving
samples share the analytic visible-disk flux, and finite PSF support fades to
zero. Optical spread is composited after world-space occlusion, so a visible
sliver can bloom over the silhouette but a fully hidden Sun cannot produce a
halo. The source-transmission prepass also attenuates the direct solar response
on hardware with at least 13 fragment texture units. Atmospheric limb scattering
and airglow are separate from this optical effect. GPU regressions cover total
and partial eclipse, the PSF support edge, lunar phase and Moon below horizon.

Auroral precipitation uses one irregular primary curtain, with secondary folds
that separate and rejoin in local sectors. There is no permanent third outer
ring. The oval shifts toward the night side, while hemisphere-specific patterns
retain quiet arcs, active folds and breaks. A narrower green base carries more
of the emission; red remains diffuse above active sectors. The same bounded 280k-pixel emission target now retains detail in near and
distant views; occupied intervals receive finer integration. Continuous multiscale
shears produce unequal returning folds without repeated vortex templates.

Reference context: [Artemis II's moonlit Earth](https://science.nasa.gov/earth/earth-observatory/a-moonlit-earth-as-seen-from-artemis-ii/)
is a visible-light photograph with very high ISO, not a daylight exposure;
[Suomi NPP's view from above](https://science.nasa.gov/earth/earth-observatory/sun-sends-an-early-earth-day-greeting-92046/)
uses the VIIRS day-night band and informs shape rather than visible color.
The procedural aurora remains an illustrative activity pattern, not live data.

### Shared night illumination

The airglow layer now supplies both camera-visible emission and downward
irradiance. Both paths use the same Gaussian layers, regional activity, local
solar suppression and strength. Downwelling light integrates the thin spherical
shell over the upper hemisphere, with approximate mean clear-air extinction.
The previous view-only contrast curve is removed. Airglow strength is reduced
to avoid a luminous foreground veil after removing that nonlinear curve.

Clouds scatter this light according to their optical thickness; diffuse terrain
reflects it according to albedo, slope and cloud cover. Water retains its direct
specular sources. These terms depend on the receiving point, not camera altitude.
The diffuse Galactic sky also illuminates clouds and ground: eight cosine-weighted
samples of a coarse mip use the same map, radiance scale and brightness control
as the visible Milky Way. Resolved catalog stars are not included in this diffuse
integral. The diffuse-map radiance gain is now 0.006 (previously 0.012).

This is a bounded lighting approximation with a photographic camera grade, not
an absolute photometric simulation. It does not add a constant ambient floor or
use altitude to conceal a change in lighting. GPU checks cover source-off zero,
linear source scaling, cloud/ground heights and uniform-sky orientation invariance.

Night radiance stays linear through the scene target and exposure meter. The
previous gamma-2.2 encode followed by an sRGB decode lifted a 0.00001 signal
about 41 times before exposure, flattening nightglow's limb-to-ground contrast
and making the diffuse Milky Way too prominent. Output gamut conversion now
only changes primaries; the display transfer is applied once, after exposure.
The single automatic ceiling is +5.1 EV for every view (ISO about 6150): an
empty sky shows one stop more stars and grain than at the former +4.1. The
automatic floor is -3.0 EV (f/9, ISO 178), raised 2.5 stops from -5.5 EV so
Earth beside the Sun stays visible; at the former -1.5 EV the Sun was a broad
clipped halo. There is no exposure
bonus for Earth coverage. Diffuse Galactic light and point sources also no
longer receive observer-daylight dimming factors: source radiance remains
independent of the camera, while occultation and extinction still apply.
GPU checks cover radiance/exposure reciprocity, uniform dark and bright frames,
coloured highlights, sparse stars, the Sun, flash rejection, manual exposure
and adaptation at 30 and 120 Hz.

Your view offers Auto and Manual exposure. Auto starts with zero compensation;
its -3 to +4 EV compensation slider applies before the sensor and highlight
curve, outside the meter feedback loop. Manual sets a fixed camera gain from
-5.5 to +5.1 EV and bypasses automatic adaptation and compensation. These are
relative scene gain stops, not calibrated photographic EV100. Auto compensation
is preserved as `look-exposure`, manual mode as `exposure-mode=manual` and its
setting as `exposure-fixed`. Reset all returns to Auto with zero compensation.
The model is still not absolutely radiometrically calibrated: a single camera
cannot repair incorrect relative source strengths, or reveal a zero-light
surface. Compare sources at fixed exposure before changing their radiance.

City uplight also scatters in a local 0–8 km air layer with a 1.2 km density
scale height. A stable geographic aerosol field varies its ground coefficient
from 0.0042 to 0.012 per kilometre. A latitude-corrected source footprint grows
from 2 km by 1.8 km per kilometre of altitude and samples the existing night map.
A deterministic quadrature integrates the scattered
light and view attenuation, clipping against ground and effective cloud depth.
Unlit regions and daytime receive no added glow. This is an illustrative haze
profile, not observed aerosol/weather data. Clouds share the same uplight source
with their own scattering efficiency. The city-light fixture checks localization,
source-off zero, aerosol variation and occlusion by an opaque cloud deck.

The 2026-10 city-glow comparison uses NASA's *City Lights of North and South
America* (8–18 seconds, linked in `orbital-video-references.md`). It separates
compact ground lights from broader, uneven illumination of clouds. Disabling
both city haze and cloud uplight in the India view showed that much of our
outline already belonged to the ground signal. The source is a display-graded
Black Marble image, not a calibrated linear emission field. Its illustrative
contrast exponent is now 1.3, with no cutoff for faint roads. The intermediate
1.8 curve made dim connecting lights disappear at the automatic exposure
ceiling; 1.3 restores their relative energy while keeping the calibrated peak. The previous bright
detail peak is retained, while the 0.55 detail-only adjustment moves into the
shared source calibration. Overview and detail now blend before that calibration;
four India tiles resampled to overview scale agreed in mean signal within 5%.
The overview remains a lower-resolution approximation for scattering.

The radiance fixture feeds raw atlas values from 0 to 1 into that shared
calibration. Applying the old 0.55 detail multiplier in the fixture would apply
it twice. It checks source contrast independently of gain: a 10% source retains
about 5% of peak energy and a half-strength source about 41%, while the absolute
peak stays between 0.30 and 0.35 scene units. Black, monotonicity and bright-core
gradation remain separate checks.

Uplight averages calibrated sample energy rather than applying the source curve
after averaging its seven samples. Lamp colors vary over smaller districts,
mostly warm to neutral white with occasional cooler sources. The broad green
regional tint is removed, and scattered light uses a quieter mixture. This is
an illustrative palette, not measured lamp spectra. GPU fixtures also check
matching direct/uplight energy in a uniform field and a wider, lower peak for
an isolated light source viewed at increasing cloud altitude. The optical color-separation control is unchanged. Source contrast and the
common automatic exposure ceiling are tested separately.

### Storm flashes and city twilight

`storm-light.ts` supplies a deterministic illustrative storm timeline. The
preset contains 64 separated complexes selected inside dense areas of the actual
cloud atlas, with 3–5 nearby cells per complex. `prepare-storm-regions.mjs`
regenerates the material-space coordinates in `storm-regions.ts`; the latter
records the source pixel digest. Sampling uses the same north/south orientation
as the flipped GPU texture. No runtime readback, request or texture is added.

Coverage is only an admission requirement: most dense cloud is not selected.
Selected complexes remain active for minutes, then quiet for minutes. An episode
visits 1–3 nearby cells separately; repeated strokes remain anchored to one cell.
Cloud coordinates carry the entire complex with the same slow drift as the
visible cloud map. This is an illustrative activity preset, not real weather,
and optical coverage does not establish convection. Selection is not triggered
by camera motion, nightfall, frame rate or seeking.

Eight visible active sources are uploaded at most; each cloud ray selects two
nearby contributors. Both a dense surrounding body and a resolved dense center
are required. A high-resolution hole overrides coarse-map cloud coverage.
Connected asymmetric pockets approximate scattering from an embedded channel,
with a weaker 12 by 8 km surround. Density suppresses illumination in wisps;
view extinction and cloud occlusion still apply. This is not a multiple-scattering
solution, and individual discharge channels are not resolved at orbital distance.

Each discharge has 1–4 unequal strokes with varying dark gaps. The event schedule
is cached per complex/cycle after visibility culling. Analytic integration covers
a full nominal frame in simulation time (24 Hz, or the selected profile cadence),
with a minimum interval of 1/48 s. This retains short-flash energy at 10x/120x
without stretching each flash into seconds of persistent glow. Pause, reverse
seeking and camera turns reproduce the same events. Severe dropped frames can
still omit events; missed flashes are not replayed on resume.
`lightning=0` disables sources for comparisons. A repeatable close view is
`/?epoch=2026-10-08T04:00:00Z&t=305.83&flight=free&position=.159,-.835,.666&heading=0,0,1&pitch=-90&motion=0`.

City source energy now preserves the scalar map's intensity differences without
an early compression shoulder or forced whitening. The camera owns clipping.
Stable geographic noise fields vary district activation through local twilight;
this illustrative schedule is independent of camera position and has no random
nighttime flicker. Ground emission, cloud uplight and local haze share the same
activation function. Roads and dim settlements retain a nonzero source signal.

Tests cover pulse energy at 0.25x, 1x, 10x and 120x, seek repeatability, bounded
sources, monotonic district activation, localized cloud flashes, and zero flash
contribution without a source, cloud, or visible cloud segment.

## Local DEM detail experiment

`scripts/terrain-detail-experiment.mjs <Copernicus N41 W114 COG> <output>`
builds a standalone browser experiment using the production renderer. Its
build-time shader substitutions are confined to the experiment bundle; neither
the default scene nor its assets import the experiment. Serve the output with
`/media/orbit/` proxied to a built Earthlight preview. The output worker must remain next to
`experiment.js`. Use `?dem=base`, `?dem=90`, or `?dem=30`; add
`&terrainView=clay` to isolate relief and terrain shadows.

The fixed user camera is at 44.0519 N, 113.6267 W, 195.75 km altitude, on
2026-05-03 at 02:06 UTC. Copernicus GLO-30 tile N41/W114 supplies a 1-degree
patch. The 90 m case averages that same source in metres before packing, rather
than comparing different DEM products. Both use numeric mip levels and the
existing 8 m quantization. Heights are not exaggerated. The comparison uses
manual 0 EV, fixed 1920 x 1292 output, no grain/chromatic separation/ghosts,
and identical scene time. The baseline retains the existing streamed ETOPO map.
Outside the regional patch the candidates use the global fallback: compare only
the inner crop at x=580, y=790, width=290, height=160, not the patch edges or the
rest of the frame. This is not a production regional streaming implementation.

This view shows a large increase in resolved ridge structure from ETOPO to
90 m, but little additional visible benefit at 30 m. Clouds and atmosphere
substantially reduce the difference in the final image. Ground sampling near
the crop centre is about 204 x 360 m per image pixel. Existing sparse shadow
steps and intersection precision produce small artifacts; they must not be
counted as improved detail or assumed accurate because the DEM is finer.

One experimental patch needs 0.64/3.25 MiB compressed transfer and
10.67/42.67 MiB of uploaded LUMINANCE_ALPHA mip data for 90/30 m respectively.
These are data sizes, not a measurement of driver allocation. On Apple M2 Max
through ANGLE Metal, 20-frame GPU timer-query medians for the full scene were
154.9/159.0/152.6 ms for baseline/90/30. This single small-patch result does not
establish global or mobile performance. All six full/clay frames completed with
zero WebGL errors and no base-asset failures.

Source: https://copernicus-dem-30m.s3.amazonaws.com/readme.html

Produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and
© Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the
European Union and ESA; all rights reserved.
