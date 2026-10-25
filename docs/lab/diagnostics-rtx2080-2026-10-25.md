# RTX 2080 diagnostic follow-up, 2026-10-25

The supplied `earthlight-2026-10-25T18-30-32-212Z-report.json` measures clean
build `12d39e96abc27d0f560646fec89a8ff0659cc2a0` on Windows Chrome, RTX 2080
through ANGLE D3D11. Viewport 1536 × 738, DPR 1.25; short RAF intervals are
about 6.9 ms. This is not proof of a cold-cache visit.

First submitted frame: 1701.6 ms. Shader compilation: 1233.9 ms. Initial assets
settled: 4452.9 ms. Sharp focus: 7197.2 ms. The first guided day segment was
incorrectly labelled `guided` in window summaries; phase events retain its
boundaries (about 2.97–22.98 s).

After startup, the day view delivers roughly 35–38 FPS with sampled GPU times
around 25–28 ms. The surface view holds about 24 FPS with GPU samples generally
11–21 ms at a smaller buffer. The night turn starts as low as 15 FPS, with
GPU samples reaching 56 ms. CPU render-submission medians are usually below
1 ms; they do not cover all main-thread work. Free exploration has occasional
110–140 ms submission gaps and buffer-size changes. Correlation is not proof
that reallocation alone caused these gaps.

## Reproduced clock error

After acquiring 144 Hz, feed repeating refresh gaps `[1, 2, 3, 4]`. The old
30-sample median estimator reports a 20.83 ms period (48 Hz), despite recurring
6.94 ms callbacks. With `[1, 3, 4, 4]`, the estimate can drift further. Using the
faster fifth preserves the available short-refresh evidence. A sustained real
rate change still replaces the sample window; regression tests cover 144 → 60
Hz as well as existing 60/90/120/144 Hz and gesture behavior.

This fixes an estimator failure; it does not prove higher Windows FPS. The
24 FPS passive target is unchanged. Do not reduce shader fidelity or increase
the default target based on this single whole-frame report.

## Next comparison

The v2 report records grouped GPU queries, refresh-period estimates, separate
quality/view factors and buffer-resize events. Replay the same guided protocol
on the same machine and compare matched phases/buffer sizes. Use the grouped
night samples to choose the expensive rendering stage before modifying it.
The renderer's visual algorithms and the guided camera protocol are unchanged.

The first profiling prototype placed six adjacent queries inside a sampled
frame. Local browser evidence showed substantially higher sums than surrounding
whole-frame samples (for example about 92 ms versus 47 ms in the night phase).
Those are not comparable stage costs and were rejected. The implemented probe
uses only one query per frame, alternating whole-render samples with one
rotating group. Different groups must not be summed as if measured together.

## Local validation

`bun run verify` passed 397 tests, type checking and the build. The full scene
browser check passed. Two browser diagnostic runs passed downloads, recovery,
all guided phases, mobile layout and ordinary-visit isolation. The second ran
without the scene test competing for the GPU and retained 72 grouped samples.

The local night camera-finish median was about 51 ms, while late whole-frame
samples were about 47–53 ms. This avoids interpreting the rejected six-query
sum as stage cost, but does not establish zero instrumentation overhead. In
particular, a group nearly as long as the entire render may include deferred
earlier work or boundary effects. Treat group timings as leads for controlled
experiments, not exact shader attribution. These local results are not Windows
performance evidence; the next comparison needs a new RTX 2080 report.
