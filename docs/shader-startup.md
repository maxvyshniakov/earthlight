# Shader startup

The renderer submits the scene, cloud/volume, source-transmission, catalog,
camera, exposure, defocus and aurora programs through one `ShaderProgramBatch`.
It submits all shader compilations before linking the programs. Identical shader
sources within a batch share a shader object.

With `KHR_parallel_shader_compile`, the batch yields to animation frames and
polls `COMPLETION_STATUS_KHR` for every program. It reads link status only after
all programs finish. Shader status and logs are read only to diagnose a failed
link. Uniform locations, attributes, `useProgram` and asset uploads follow that
completion barrier. The poster remains visible while the first batch is pending.

Without the extension, the same submission batch validates synchronously. This
preserves compatibility but does not offer nonblocking compilation. The extension
does not promise shorter total compilation or higher steady-state frame rate;
see the [Khronos extension specification](https://registry.khronos.org/webgl/extensions/KHR_parallel_shader_compile/).

## Ownership and restoration

The batch owns unclaimed programs and shader objects. A renderer helper takes
ownership only after successful validation. Cancellation stops polling and
releases unclaimed resources. Existing isolated GPU fixtures may still construct
a helper synchronously; production startup passes prepared programs to helpers.

Each startup belongs to a context generation. Context loss and disposal cancel
the pending generation; its eventual completion cannot install programs or start
downloads. Restoration creates a new batch. If the first context was lost before
assets started, restoration starts the original asset plan once; otherwise it
restores cached inputs. An experimental cloud failure retries Compact, and an
unrecoverable program failure leaves the static poster.

The scene reports `data-shader-startup` (`compiling`, `preparing`, `ready`,
`failed`), `data-shader-mode` and `data-shader-compile-ms`. The elapsed time includes
submission, linking and completion waits, including a half-cloud retry. It is
not the time to the first presented frame or to settled texture detail.

## Verification

`scripts/shader-programs.test.mjs` checks submission/query order, the path without
the extension, errors, cancellation, context loss and ownership cleanup.
`scripts/verify-shader-startup.mjs` forces a pending compilation window on real
WebGL and checks poster visibility, blocked resource setup, restoration during
first compilation, disposal, missing-extension behavior and actual shader errors.

```sh
bun scripts/verify-shader-startup.mjs http://127.0.0.1:4347 /tmp/earthlight-startup webgl1
bun scripts/verify-shader-startup.mjs http://127.0.0.1:4347 /tmp/earthlight-startup-webgl2 webgl2
```

Run browser checks against a stable build, sequentially with other GPU work.
Cold network startup limits and physical iPhone/Windows evidence remain separate
items in [the acceptance plan](lab/orbital-performance-targets.md).

On 2026-10-10 the seven CPU tests and both real WebGL browser suites passed
on an M2 Max in Chromium, including loss before the first asset request and
failed restoration. This does not establish cold-network or target-device timing.
