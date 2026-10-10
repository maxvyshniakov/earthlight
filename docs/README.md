# Documentation

## The scene

- [Orbital sky](orbital-sky.md): the full model. Covers the orbit and reference
  frames, sunlight, atmosphere, airglow, aurora, stars, Milky Way, Moon and
  planets, camera response, controls and URL parameters.
- [Earth surface, clouds and twilight](earth-surface-rendering.md): surface and
  cloud sources, compression, light transport, terrain and ocean reflection.
- [Streaming night lights](night-lights-streaming.md): how 500 m Black Marble
  imagery reaches the GPU through a bounded tile atlas.
- [Video references](orbital-video-references.md): the NASA crew videos used as
  visual reference, and what the renderer takes from them.

## Engineering

- [Scene optimization](scene-optimization.md): loading order, texture budgets,
  codec choices and measured costs.
- [Shader startup](orbital-shader-startup.md): compilation, context loss and
  restoration.
- [WebGL2](orbital-webgl2.md): the WebGL1 and WebGL2 paths.

## Lab notes

[`lab/`](lab/) holds dated experiments, device measurements and raw
evidence in JSON: architecture candidates, codec comparisons, cloud
prototypes and phone checks. Each note records the build, device and browser
it measured, so its numbers describe that setup rather than the current
renderer.

## Media

- [`media/`](media/): README images captured from the demo.
