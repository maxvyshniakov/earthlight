# Software GL probe in a worker, 2026-10-20

Follows [smaller startup](startup-diet-2026-10-16.md), which left the
background paying for one probe context under explicitly selected SwiftShader.

## Problem

PageSpeed Insights renders with SwiftShader and does not flag it as a
performance caveat. The background therefore created a WebGL1 probe context
on the main thread, read the renderer name and only then kept the poster.
Creating the first context waits for the GPU process to start the renderer.
Under SwiftShader that wait was one long task. Lighthouse multiplies it by
its CPU slowdown. On the personal site this gave 49–53 points and 4.5–9.2 s
TBT, while hardware runs scored 97–99.

## Change

The background asks `softwareRenderer` before creating its context. The
probe runs on an `OffscreenCanvas` in `software-probe.worker.ts`, with the
same attributes as before. When a browser has no WebGL in workers, or the
worker cannot load, the page runs the old probe itself. The scene starts one
task later; the explorer and the poster lab are unchanged.

## Measurements

Headless Chrome on Apple M2 Max, no CPU slowdown, the background element
built alone. Main-thread long tasks during the first 4 s.

| Renderer | Before | After |
| --- | --- | --- |
| SwiftShader (`--use-angle=swiftshader`) | 560, 586 ms; one run none | none |
| Metal | 51–60 ms, scene on WebGL2 | 54–79 ms, scene on WebGL2 |

The bare probe, outside the background, blocked the main thread for 170–260
ms under SwiftShader and 70 ms on Metal. In a worker it caused no main-thread
long task in either case. On Metal the first-context cost moves to the scene
context itself, so hardware startup stays about the same.

WebGPU adapter info was considered as a cheaper signal. Under SwiftShader
headless Chrome returned no adapter and still spent a 160–228 ms long task,
so it answers nothing the worker does not.

## Limits

- Lighthouse itself was not rerun here. The released package needs a
  PageSpeed run on the personal site.
- Hardware rows vary by tens of milliseconds between runs.
