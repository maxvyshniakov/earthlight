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
- **Sky**: the celestial sky only: stars, the Milky Way, Sun, Moon and planets
  (`celestial-sky.ts`). It never names the page or its controls.
- **Observer**: the camera's state at one scene time: position, basis, Sun
  direction, date, latitude, longitude and altitude (`ObserverFrame`).

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

## Assets

- **Media**: prepared scene data under `public/media/earthlight`, served at
  `/media/earthlight/` locally and published as an immutable release. The
  release manifest lists paths relative to that directory.
- **DEM proxy**: `/media/earthlight/dem90/`, the explorer's same-origin route
  for Copernicus GLO-90 tiles.
- **Day pyramid**: lab levels below the 500 m day tiles (`day-pyramid.ts`,
  `dayDetail=sentinel`), level *L* splitting each day tile into 2^L × 2^L
  tiles. Local only; see `docs/lab/day-pyramid-2026-10-17.md`.

## Words to avoid

| Avoid | Use |
| --- | --- |
| Orbit, orbital sky (for the project or page) | Earthlight, explorer |
| route (for a trajectory) | orbit |
| orbit (for the camera circling a point) | circle |
| `sky-` (for UI) | `explorer-` |
| orbit renderer, orbital shader | scene renderer, scene shader |
