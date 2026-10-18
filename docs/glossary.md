# Glossary

Earthlight code, markup and documentation use these words. Name new modules,
types, CSS classes and URL parameters after them. The project used to be
called Orbit, and older lab notes still use that name.

## Surfaces

- **Explorer**: the interactive page at the subdomain root. It is the
  `<earthlight-explorer>` element (`Explorer.astro`, `explorer.ts`) with flight
  controls, the flight HUD and settings. Its UI classes and ids use the
  `explorer-` prefix.
- **Background**: `<earthlight-background>` (`Background.astro`,
  `background.ts`), the same scene without controls, embedded by consumers.
- **Lab**: experiments under `/lab/` and dated notes under `docs/lab`. A lab
  note keeps the names that were current when it was written.

## Scene

- **Scene**: everything rendered for one moment: Earth, atmosphere, clouds,
  lights and the sky. The **scene renderer** (`scene-renderer.ts`) and **scene
  shader** (`scene-shader.ts`) are shared by explorer and background. Settings
  that affect the whole picture live in `scene-*` modules.
- **Scene time**: simulation seconds along the replay (`t` in the URL).
  `SceneClock` advances it at the time scale; `SceneCalendar` maps it to a UTC
  date through `epoch`.
- **Time scale**: scene seconds per real second. At 10×, one real second advances
  the scene by ten seconds. It is distinct from the camera's flight speed and
  the renderer's frame rate.
- **Calendar time**: the UTC date used for celestial lighting. Changing it
  changes the Sun, Moon and sky without moving the camera along its orbit.
- **Frame cadence**: when the renderer submits frames, measured in frames per
  second or display refreshes. Slower cadence does not slow scene time.
- **Sky**: the celestial sky only: stars, the Milky Way, Sun, Moon and planets
  (`celestial-sky.ts`). It never names the page or its controls.
- **Measured clouds**: the lab study `cloudStudy=global`, clouds drawn from one
  day's measured cloud properties instead of the photographic plates
  (`cloud-properties.ts`, `CLOUD_PROPERTIES` in shaders).
- **Swath edge**: in a measured day, the straight line where GIBS drew a later
  NOAA-20 pass over an earlier one (`cloudPropertiesSwathEdge`). The date
  line, where the composite joins two local days, is a seam, not a swath edge.
- **Observer**: the camera's state at one scene time: position, basis, Sun
  direction, date, latitude, longitude and altitude (`ObserverFrame`).
- **Pose**: camera position and orientation. An observer also includes the date
  and lighting context; a pose alone does not.
- **Render profile**: a named choice of rendering passes and buffer policy.
  `compact` is the default; `reference` retains the original rendering path.
- **Texture profile**: a choice of the galaxy overview image's resolution.
  It leaves the star catalogue and streamed galaxy tiles unchanged and is
  independent of the render profile.

## Flight

- **Orbit**: a trajectory the camera can follow. `iss` replays the saved
  CelesTrak elements with SGP4; `polar` and `high` are illustrative circular
  orbits. The type is `Orbit`, the URL parameter `orbit` (links with the former
  `route` still work). The ISS period is `ISS_PERIOD_SECONDS`.
- **Free flight**: the camera detached from any orbit. `FlightNavigation` owns
  following and free flight; `flight-controls.ts` maps keys and wheels;
  `FlightHud` draws the instruments.
- **Camera controller**: turns gestures into camera motion: fly, look,
  approach, lens, roll and **circle** (the right button circles the pinned
  point under the pointer). See `camera-controller.ts`, `camera-drag.ts` and
  `camera-touch.ts`.
- **Camera model**: the photographic camera: exposure, lens point-spread,
  reflections, defocus, grain (`camera-model.ts` and the other `camera-*`
  optics modules). It is separate from the camera controller.
- **Lens preset**: how strongly the camera's lens reflects into ghosts.
  `iss` (default) is the coated ISS zoom; `flare` is a flare-prone lens with
  30 times the reflections. The type is `LensPreset`, the URL parameter
  `lens-preset`; `lens` remains the zoom.
- **Zoom**: lens magnification relative to the 1× projection. It changes the
  field of view, not the camera position. The range is 0.5×–50× (about 15–1500 mm
  on the camera model's 24 mm frame height).
- **Exposure compensation**: a bias applied to automatic metering, in EV.
  **Manual exposure** fixes the camera's exposure-program value instead of
  adding a bias to metering. This value is distinct from the physical EV100
  derived from shutter, aperture and sensitivity.
- **Physical night**: the lab that renders night emitters at their physical
  radiance and lets the camera program reach ISS night exposures. The type is
  `NightMode`, the URL parameter `night` (`video` or `still`;
  `physical-night.ts`). Its **night lens** opens to max(f/1.4, focal / 143 mm)
  (`NIGHT_LENS`, `exposureCeiling`), and its grain bins the **photosites** of
  a 12 MP sensor into each CSS pixel (`photositesPerPixel`, `sensor-noise.ts`).
- **Frame EV**: in physical night, the exposure the frame's mean scene
  luminance asks for before subjects pull, kept by the meter in its own
  state (`CameraExposure.frameTexture`). Night subjects are classified
  against it, never against the camera's own EV. See
  `docs/lab/night-meter-2026-10-18.md`.
- **Night switch**: changing the night mode of a running renderer in place
  (`switchNight`, the N key): the next mode's programs compile while the
  current one draws, the **hand-over** frame is the last of the old mode,
  and the explorer holds it in its **crossfade** (`.explorer-crossfade`)
  until the new camera has metered. See `docs/lab/night-switch-2026-10-17.md`.
- **Pre-exposure**: scene radiance stored multiplied by 2^ev of the exposure
  its frame is rendered with, so physical night fits half-float and RGBE
  targets; the meter, the glare pyramid and the camera finish divide it back
  out. On with physical night only (`PRE_EXPOSURE`, `sceneExposure()`;
  `pre-exposure.ts`).
- **City emission signal**: a calibrated scalar on the scene's radiance scale,
  derived from the night map before lamp colour and atmospheric transport.
  It is not energy integrated over time or a measured lamp spectrum.

## Assets

- **Preview**: a small initial asset that can produce the first visible scene.
  **Overview**: a map covering a whole layer, retained beneath streamed detail.
  A preview is a loading stage; an overview is spatial coverage.
- **Tile**: one addressed region of a map layer. Image layers include Earth,
  clouds and the spherical galaxy map; terrain tiles carry height data.
- **Atlas**: a GPU texture containing multiple tiles. An **atlas reservation**
  owns space while an upload is pending; a **resident tile** has completed its
  upload and can be sampled. Cancellation alone does not finish an upload.
- **Media**: prepared scene data under `public/media/earthlight`, served at
  `/media/earthlight/` locally and published as an immutable release. The
  release manifest lists paths relative to that directory.
- **DEM proxy**: `/media/earthlight/dem90/`, the explorer's same-origin route
  for Copernicus GLO-90 tiles.
- **Day pyramid**: three levels below the 500 m day tiles (250, 125 and
  62.5 m; `day-pyramid.ts`, `dayDetail=sentinel`), level *L* splitting each
  day tile into 2^L × 2^L tiles, from the WorldCover Sentinel-2 composite.
  See `docs/lab/day-pyramid-global-2026-10-17.md`.
- **Pack**: one file of day-pyramid tiles, an aligned block of 2^k × 2^k
  tiles of one level (`day-pyramid/<level>/<x>-<y>.pack`), fetched whole
  because the media host ignores HTTP ranges and kept in the renderer's
  byte-bounded **pack cache**. The **pack index** (`day-pyramid/index.bin`)
  lists which tiles exist and each level's block size per day tile
  (`day-pyramid-pack.ts`). A **day tile pack** is the builder's intermediate:
  all three levels of one day tile, repacked into packs for the release
  (`build-day-pyramid-packs.mjs`).

## Implementation vocabulary

These names describe software responsibilities, not additional objects in the
scene. Keep their scope explicit rather than giving every helper a new domain
name.

| Name | Responsibility |
| --- | --- |
| `ExplorerSession` | Current settings, playback, calendar and navigation for one explorer. |
| `SceneHostLifecycle` | Frame scheduling and browser lifecycle bindings for an explorer or background. |
| `NightCrossfade` | The held hand-over image and its fade completion; not the night-mode switch itself. |
| `SceneRenderOptions` | Normalized requested settings, including a separate set of experiments. |
| `SceneRenderCapabilities` | Facts probed from the current WebGL context. |
| `SceneRenderPlan` | Eligible rendering paths derived from settings, capabilities and host policy; allocation may still fail. |
| Render diagnostics | Observations exposed to the HUD and tests, never configuration read back into the renderer. |
| `AssetRequest` | One asset URL, asset key and loading stage; a list of requests forms an asset plan. |
| `SceneWork` | Shared admission and scheduling budgets for resource jobs. |
| `AtlasResidency` | Atlas reservations, completed entries and eviction. |
| `TileRequests` | Request identity, cancellation and retry deadlines. |
| `DayPyramidSelection` | Selection against the decoded availability index, without fetching or GPU work. |
| GLSL block | Reusable shader source declarations, functions or statements. |
| Fragment shader | A complete fragment-stage shader, distinct from a reusable GLSL block. |

An owner and its operation may share a word (`selection.select`); that is not
reason enough to invent a synonym. Rename when the old word denotes the wrong
concept, conceals a unit, or conflates responsibilities.

## Words to avoid

| Avoid | Use |
| --- | --- |
| Orbit, orbital sky (for the project or page) | Earthlight, explorer |
| route (for a trajectory) | orbit |
| orbit (for the camera circling a point) | circle |
| `sky-` (for UI) | `explorer-` |
| orbit renderer, orbital shader | scene renderer, scene shader |
| speed for simulation playback | time scale; keep speed for physical camera motion |
| rate for a 0–1000 slider coordinate | time-slider position; URL `rate` is retained for compatibility |
| asset plan for one URL request | asset request; a plan contains requests |
| fragment for both a reusable source block and a shader stage | GLSL block or fragment shader, according to meaning |
