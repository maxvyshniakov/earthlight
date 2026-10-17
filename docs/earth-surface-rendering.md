# Earth surface, clouds and twilight

The former surface and cloud maps were 8192 × 4096 Solar System Scope images.
Cloud coverage was mixed into ground color; it had no height or internal shadow.
Night airglow used wide Gaussian bands in tangent height, independently faded by
solar elevation. The separate daytime scattering calculation made the two
painted limbs especially apparent near the terminator.

## Sources and compression

Daytime color now uses NASA Blue Marble Next Generation, October 2004, 500 m.
Eight 21600-square plates produce an 86400 × 43200 source. The base map has no
added shaded-relief layer. The renderer now also uses ETOPO elevations (see the terrain section below).

A 2K or 4K AVIF overview is always available. With detail tiles enabled, capped
render targets up to 1280 px on the longer edge use 2K; larger ones use 4K.
Expanding an already loaded 2K scene past 1408 px upgrades it once. The smaller
map saves 32 MiB of nominal GPU memory; night/cloud maps retain 4K after phone
comparisons. See `scene-optimization.md` for measurements. Visible sunlit detail streams through
the same bounded cache implementation as night lights, using a separate RGBA
atlas. It has 31 tiles on desktop or 7 on mobile, 3 simultaneous requests,
16-pixel geographic gutters, explicit isolated mip levels, fades and fallback.
Sampler 6 is reused between the scene and camera-finish passes; camera-finish
rebinds its own texture after the scene draw. This stays within WebGL 1's eight
required fragment samplers without sampling the active framebuffer.

The day atlas uses 79.9 MiB desktop / 20.0 MiB mobile, offset in part by reducing
the global daytime overview from 8K to 4K. Uniform ocean/polar fill is omitted:
6615 of 12800 tiles remain, totaling 70.68 MiB on disk. Only visible tiles load.
All native plates remain outside the repository; the manifest records SHA-256.

Below the day tiles, `dayDetail=sentinel` adds the day pyramid: three levels
(250, 125 and 62.5 m) from the ESA WorldCover 2021 Sentinel-2 composite over
land from 60° S to 83° N, 4,266 packs and 2.90 GiB, read with HTTP ranges and
listed by `day-pyramid/index.bin`. Low frequencies and colour stay BMNG's;
BMNG stays under snow and ice, open water and composite failures. It shares
the day atlas and is off by default. See
`lab/day-pyramid-global-2026-10-17.md`.

Day/night tile selection and mip filtering include the reciprocal cosine of
latitude: longitude texels converge at the poles. Unresolved polar detail fades
to the overview instead of forming sharp wedges against it. The CPU applies the
same footprint before requesting tiles; close views can still resolve them.

Three native 572-square crops (India coast, Himalaya, desert) compared AVIF Q50
(effort 2, 4:4:4), AVIF Q65 (effort 4, 4:4:4), and WebP Q85. The measured results
are in `evidence/earth-surface-codecs.json`. Q50 costs 18–36 KB in these examples, versus
29–61 KB for Q65 and 33–91 KB for WebP. Q65 preserves more fine rock/snow contrast,
but Q50 retains the mapped ridges and coastline at a smaller transfer cost; the
rendered footprint is normally wider than one native pixel. No palette reduction
or sharpening is applied. Horizontal gradient error supplements PSNR because
edge retention matters more here than smooth gradients.

Cloud input: NASA Blue Marble, `cloud.{W,E}.2001210.21600x21600.png`, 43200 × 21600
combined. Runtime uses a 4K single-channel overview and visible tiles from a
16,384 × 8192 coverage map (AVIF Q65, 512-pixel interiors, 16-pixel neighbor
gutters). Desktop caches up to 31 tiles, mobile seven. Without sufficient sampler
support, a global 8K desktop / 4K mobile map remains available. The former full
16K asset is retained for comparison, not requested by the default renderer.
The large maps have missing polar coverage; this is not fabricated. These are
historical illustrative cloud patterns, not weather at the replay timestamp.

The `clouds=balanced` preset (Clouds → Balanced) retains the original
photographic coverage and illustrative height profile. It scales weak-column
optical thickness by .72, smoothly returning to 1 for dense cores. Faint sheets
and soft edges remain visible at full-disc scale. This is an artistic density
adjustment, not retrieved optical thickness or weather matching the UI date.
`clouds=original` restores the previous density, and `clouds=off` removes clouds
and their shadows. Old `clouds=broken` links use the default: the earlier .32
coverage cutoff was rejected because it left only sparse bright cores.
The MODIS study keeps its own input by default. See the
[full-disc revision](lab/2026-10-11-cloud-balanced.md).
The default `clouds=calibrated` (Clouds → Calibrated, since 2026-10-17) sets each column's optical
depth to `−ln(1 − 0.998·coverage^0.7)`. That reproduces the opacity of NASA's
own Blue Marble composite of these plates over dark ocean; Balanced is two to
three times more transparent for thin cloud. The 43,200-pixel plates add
almost no structure beyond the 16K tiles. See
[cloud calibration](lab/cloud-calibration-2026-10-17.md).
`cloudStudy=global` (lab) replaces the plates with measured cloud properties
for the UTC day of the scene's epoch when that day is built, otherwise for
22 September 2026, the only day built so far: NOAA-20 VIIRS optical thickness and top height, MODIS
phase. Opacity is the plane-parallel albedo of the optical thickness, by phase;
partly cloudy pixels take the albedo of their own reflectance. Bases and
profiles are inferred per type, unobserved places stay clear, and each column
is lit without re-shadowing its own albedo. The clouds do not drift, so the
cloud lighting atlas runs in its no-drift mode. See
[measured cloud properties](lab/cloud-properties-2026-10-17.md) and
[its second iteration](lab/cloud-properties-iteration-2026-10-17.md); the
[third](lab/cloud-properties-seams-2026-10-17.md) reviews the date-line and
swath seams and thin cirrus, and a
[rebuild](lab/cloud-properties-artefacts-2026-10-17.md) removes glint taken for
cloud, the dark column at 180° and stepped polar veils. The study also lays
that day's sea ice (GHRSST MUR concentration) on the sea under its clouds,
which the day map lacks; see
[sea ice under measured clouds](lab/cloud-properties-sea-ice-2026-10-17.md).
Its columns' sunlight falls as cos θ₀^1.19, like a plane-parallel cloud's,
instead of the shared 0.48 + 0.38 cos θ₀, which let clouds outshine ice and
snow two to three times at low Sun; see
[surfaces against clouds at low Sun](lab/cloud-properties-sun-zenith-2026-10-17.md).
Each view-ray step reads its column where the ray crosses the layer, not at
the step's centre, magnified opacity tiles are a cubic B-spline, opacity is
averaged with its mirror image within 6 km of a swath edge, and the study
loads clear rather than as sea ice; see
[ripples, swath edges and loading](lab/cloud-properties-ripples-2026-10-17.md).


Build scripts and official source URLs are in `public/media/earthlight/README.md`.

## Light transport and limits

- Clouds occupy a synthetic 0.6–12 km shell. Coverage drives a vertical density
  profile, with small 3D erosion. Ninety-six view samples integrate attenuation and
  scattered light; four sunward density samples provide internal/ground shadows.
  Solar visibility includes Earth occlusion. Low sunlight warms illuminated tops.
- The atmospheric pass stops at the cloud-weighted emitting distance rather than
  treating every cloud as if it emitted from sea level. This is an approximation
  to coupled cloud/air multiple scattering, not a complete weather renderer.
- Airglow uses visible path lengths through nested shells around 90 km, clipped
  by Earth. It is added in linear light. At deep-night exposure, the accepted
  reference-photo soft amber halo and green edge take precedence over the thin
  shell. This explicitly artistic treatment fades with the scene daylight
  exposure before sunrise, preserving the new daytime/terminator appearance.
  Absolute emission strengths remain artistic.
- The daytime atmosphere still uses single Rayleigh scattering. Aerosols, ozone,
  multiple scattering and calibrated camera exposure are not included.
  Clear-air scattering and Lambertian ground illumination now share normalized
  solar irradiance 2.2. The previous independent scattering gain of 9 lifted
  dark terrain and oceans into a blue veil. Ground diffuse illumination uses
  E / pi, preserving approximately the former .85 encoded ground gain.
  Extinction coefficients, 8 km density scale height and ray path lengths are
  unchanged, so long horizon paths still lose contrast. Cloud lighting, twilight
  fill and night exposure remain photographic approximations.
- Night data is grayscale. A highlight shoulder makes bright city centers approach
  warm white while dim roads and halos remain amber; this does not recover measured
  lamp spectra. Cloud extinction is applied once by the cloud integration.
- Terrain uses resampled ETOPO height intersections and normals, described below.

Reference photographs:

- [ISS024-E-14504](https://eol.jsc.nasa.gov/SearchPhotos/photo.pl?frame=14504&mission=ISS024&roll=E): oblique ocean view with visible water between clouds and haze toward the horizon.
- [Sunrise shadows over the Philippine Sea](https://www.nasa.gov/image-article/sunrise-shadows-over-philippine-sea/): illuminated cloud tops, shaded sides and long shadows.
- [Paris at night](https://www.nasa.gov/image-article/paris-night/): warm road networks and brighter white centers.
- [Waves in airglow](https://science.nasa.gov/earth/earth-observatory/waves-in-airglow-79817/): the mesospheric emission layer at approximately 85–95 km.

The shared irradiance convention follows the
[Lambertian BRDF](https://www.pbr-book.org/3ed-2018/Reflection_Models/Lambertian_Reflection)
and the solar-irradiance term in
[Bruneton's single-scattering integral](https://ebruneton.github.io/precomputed_atmospheric_scattering/atmosphere/functions.glsl.html).
This aligns two existing light terms; it does not make the scene a calibrated
atmospheric radiance simulation.

## Browser checks

Clear-air balance comparison: captured the old and shared-irradiance shaders
at 1440 × 966, t=0, 1950, 2488.1, 3000 and 4594.06, with motion/grain disabled.
Land at t=3000 retains more brown/green contrast, and water between clouds at
t=2488.1 is darker. The blue limb remains visible. The deep-night comparison
changes by 0.0046 mean 8-bit channel values over the full frame; the separate
amber/green airglow treatment is unchanged. These captures verify the visual
adjustment, not an absolute match to the NASA photograph.

Checked localhost at 1440 × 966, times 0, 3000, 3235.65, 3882.78 and 4594.06:
night cores, clear land, thick clouds, daylight and twilight. WebGL error 0.
Daylight t=3882.78 fetched 9 detail tiles / 26,100 bytes; mobile t=3235.65 fetched
7 / 122,450 bytes. During playback the resident cache stayed at 31; a 4-second
local daytime sample rendered 93 frames (23.25 FPS against the 24 FPS cap).
This is local browser timing, not a promise for other GPUs.

Also checked 390 × 844: 4K cloud asset selected, 7-tile cache, WebGL error 0.
Forced WebGL context loss/restoration returned to a ready scene, resident day
textures and error 0. Unit tests cover both scalar and RGBA cache allocations,
concurrent fetches, eviction, bitmap closure, disposal and day/night selection.

## Cloud motion filtering

At t=2602.46, the original twelve-step cloud march visibly aliased during
10× playback. Coverage relied on implicit texture derivatives inside divergent
volume/shadow branches, and both procedural noise octaves stayed fully detailed
even below pixel/sample resolution.

Coverage now selects mip levels explicitly with EXT_shader_texture_lod using
the larger of the projected pixel footprint and half the ray integration step.
Seen obliquely, an opaque cloud top is a surface: the view integral filters
the pixel's ellipse on it, whose major axis grows as 1/cos of the incidence.
Beyond 3:1 two taps along the ray's horizontal direction each average half of
it ([limb flicker](lab/limb-flicker-2026-10-17.md)).
Drivers without the extension use a conservative mip-bias fallback. Noise
octaves fade continuously to their mean as they become unresolved, and erosion
rotates with the same coordinates as the coverage map. The march uses 24 steps
and exits opaque rays early; sun-shadow samples are filtered over their support.
No temporal history, random sample jitter or full-scene blur is introduced.

Reference for the optional WebGL extension:
https://registry.khronos.org/webgl/extensions/EXT_shader_texture_lod/

Motion check: 12 paused renders starting at t=2602.46, spaced by 10/24 orbital
seconds, 1440 × 966 viewport. Grain and color fringing disabled for the comparison.
In the cloud-only crop (100,790,1200,160), mean absolute interframe difference
with local 24-pixel-block ±2-pixel translation matching fell from 3.624 to 2.278
on an 8-bit luminance scale. Mean horizontal gradient fell from 3.513 to 3.067:
the reduction in temporal instability is larger than the loss of fine contrast.
This is a local regression indicator, not a perceptual flicker score.

Final local playback sample: 94 frames in 4.002 seconds (~23.5 FPS), WebGL error 0.
Forced context restoration with the explicit-LOD extension hidden also compiled
and returned to a ready scene with error 0. `bun run verify`: 22 tests passed,
Astro check and build clean. Diagnostic image settings were reset afterward.


### Residual moving bands (screen recording, 2026-10-07)

The first filtering pass left fine traveling contours on approaching cloud tops.
A controlled shader comparison isolated the view integration: increasing shadow
samples from 4 to 16 did not remove the contours; increasing view samples did.
The production march now uses 96 midpoint samples, retaining filtered coverage,
erosion and the early exit for opaque rays. There is no added image blur or
frame-to-frame jitter. This costs more cloud integration work, although opaque
rays still exit before completing the march.

Compared 12 identical frames at t=2753.09 + i × 10/24 seconds, with grain and
fringing disabled, against a 192-view-sample reference. In crop
(300,780,900,180) of a 1440 × 966 viewport, mean absolute RGB error fell from
0.601 (24 samples) to 0.027 (96 samples), measured in 8-bit channel values.
Mean absolute change in that reference error between adjacent frames fell from
0.866 to 0.052. This measures convergence to a denser version of the same model,
not photographic accuracy or a general perceptual quality score.

The rebuilt page rendered 91 frames in 4.001 seconds (~22.7 FPS) in a local
warmed desktop run, with WebGL error 0. An initial run including asset uploads
was slower; this is not a device-independent performance guarantee.
Mobile-size browser check (390 × 844) rendered 95 frames in 4.001 seconds,
with WebGL error 0 and a ready scene. This uses the desktop GPU at a mobile
viewport, not a physical phone. All 22 tests, Astro check and build passed.


## Terrain, ocean reflection and cloud shape

NOAA ETOPO 2022 ice-surface elevations now drive actual ray/height-field
intersections, not just a bump effect on the old sphere. A 9 km bounding shell
uses 48 search intervals and seven crossing refinements; the nearest crossing
selects day and city-light coordinates. This permits ridges to hide distant
emission without wrongly applying Lambertian sunlight shading to city lights.
Normals use footprint-filtered height derivatives; twelve sunward samples
approximate nearby mountain shadows. Height is not artistically exaggerated.

The 8K/4K numeric map uses lossless compression, 8 m quantization, and physically
averaged mip levels. Ocean fraction comes from independent Natural Earth land
polygons. Asset sizes, hashes, byte layout and rebuild instructions are in the
media README. Sampler 8 is optional: GPUs with only eight fragment samplers or
maximum texture size below 4096 retain the spherical fallback. Loading failure
also falls back, and context restoration decodes and reuploads the compressed numeric data.

Limits: 8K is approximately 4.9 km per texel at the equator, so these are regional
mountain forms, not individual cliffs or street-scale relief. The bounded march
can miss features thinner than a search interval. Negative elevations are
clamped to sea level; inland lake reflections and changing sea ice are absent
(only the measured-cloud study draws its day's sea ice).
Only the GPU retains the decoded mip chain. Restoration decodes a retained
compressed DEM2 blob; horizontal prediction and byte planes preserve every
height/mask/mip byte while reducing transfer size.

Ocean highlights use a directional Cox–Munk Gaussian slope distribution,
approximate Beckmann/Smith masking and water Fresnel (F0 0.02037). A synthetic,
Earth-fixed wind field varies speed from 1.5 to 13 m/s and rotates the elongated
highlight. Regional and smaller patches vary roughness; unresolved variations
fade to their mean using the ray footprint to avoid sparkling during movement. Sun and Moon share the same reflection law;
Moon direction includes the camera-to-surface parallax and reflected energy
follows today's displayed phase, independent of whether the Moon is visible
above the camera's horizon. Cloud shadows attenuate incident light, and the
existing volume/atmosphere attenuates its path to the camera. Incident sunlight
on ground and water now uses a spherical clear-air optical-depth integral rather
than a yellow/orange mix based only on solar height. The 8 km density scale and
RGB Rayleigh coefficients match the view atmosphere. Twelve quadratically spaced
samples per nonempty half-ray resolve dense air near the surface or tangent;
the source attenuation prepass uses the same helper. Vacuum leaves sunlight
neutral, while grazing paths preferentially attenuate blue. The outgoing path is
applied once by the existing atmosphere. Cloud illumination still uses its cheaper
height-based color approximation; aerosols, ozone and spectral sensor calibration
are not included. Lunar night
exposure is deliberately boosted, consistent with the scene's readable stars;
this is not a calibrated Sun/Moon radiance ratio. There is no animated water
noise or live weather input. This is statistical sea roughness, not individually
resolved waves or a wave-height simulation. References:
https://opg.optica.org/josa/abstract.cfm?uri=josa-44-11-838
https://www.pbr-book.org/4ed/Reflection_Models/Roughness_Using_Microfacet_Theory
https://science.nasa.gov/earth/earth-observatory/the-science-of-sunglint-84333/

Small cloud patches no longer become 12 km spikes just because they are bright
in the coverage image. Coverage averaged over roughly 16 km chooses a shallow
2.5 km depth for isolated patches and up to 9 km for broad systems. A square-root
cap profile rounds their tops. Saturated coverage previously gave broad bright
regions exactly the same top altitude, making them look flattened. A separate
continuous material-space field now varies the upper boundary on an approximately
10 km scale, by at most 42% of local depth. It only lowers the existing ceiling,
so small patches remain shallow. Unresolved lobes converge to their mean using
the same pixel/ray footprint as density, without animated noise or sample jitter.
The underside no longer starts at one global 1.5 km sphere. A filtered regional
field sets condensation altitude between 0.85 and 1.9 km; thin edges lift into
the body by up to 1.15 km and fade over 0.35–0.85 km. The lower flank has mild
material-space 3D erosion. Upper lobes retain their previous shape. The ray and
source-transmission shells both extend down to 0.6 km to include the new bases;
view integration stays at 96 samples, with the same footprint filtering. Local
bases may still be relatively flat, as with cumulus; they no longer form one
worldwide shelf. The shader adds one low-frequency noise evaluation per density
sample and no texture fetches.
This is illustrative shape reconstruction, not measured cloud altitude.
Four nonuniform sunward intervals put more
samples inside shallow clouds, retaining the original 25.5 km shadow support.
These remain illustrative volumes reconstructed from optical coverage.

Telemetry uses one inherited color for all four rows, switching to dark text
on daylight Earth with hysteresis (0.48 on / 0.32 off in scene daylight). No text
shadow is applied, including on buttons, per the final visual correction.

Validation: 25 tests passed, Astro check and build clean. Tests check real ETOPO
landmarks, ocean vs below-sea-level land, mip height preservation and malformed
numeric data. Day, night, cumulus and reflection views were checked in-browser.
A warmed 1440 × 966 daytime run with terrain active rendered 92 frames in 4.001 s
(~23 FPS). Clouds were temporarily disabled only in a separate diagnostic browser
to inspect the ground and lunar reflection, then the normal renderer was restored.
Mobile viewport (390 × 844) selected the 4K DEM; forced WebGL context loss and
restoration returned terrain and scene readiness with error 0. A simulated
8-fragment-sampler device compiled with no terrain sampler and terrainReady=0,
retaining a working scene. Computed styles confirmed text-shadow:none for all
four telemetry rows and the shared daytime color.
