# Page-load baseline, 2026-10-15

Lighthouse 12.6.1 performance runs before any loading change. Per-run numbers
and the largest requests are in the [evidence file](evidence/load-baseline-2026-10-15.json).

## Method

- **Personal site:** the static `dev` build that consumes Earthlight `7563f27`,
  served locally with gzip. Assets come from the published origin, as they
  would in production.
- **Explorer:** a build of `7563f27` with the published asset base URL,
  served the same way. Both deployed `dev` sites sit behind Cloudflare Access,
  so Lighthouse cannot reach them directly.
- **Production personal site:** measured directly. It still shows a static
  wallpaper and serves as a reference.
- **Lighthouse settings:** default simulated throttling (mobile: 4× CPU,
  slow 4G). Chrome ran headless with SwiftShader, as PageSpeed Insights does,
  so WebGL ran on the CPU.

## Results

| Page | Profile | Score | FCP | LCP | TBT | Bytes |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Production site (wallpaper) | mobile | 99 | 1.7 s | 1.9 s | 0 ms | 0.14 MB |
| Site `dev` + background | mobile | 60 | 2.3 s | 3.4 s | 2890 ms | 3.4 MB |
| Site `dev` + background | desktop | 100 | 0.5 s | 0.6 s | 0 ms | 3.4 MB |
| Explorer | mobile | 44 | 1.8 s | 8.1 s | 2170 ms | 6.7 MB |
| Explorer | desktop | 70 | 0.4 s | 1.6 s | 540 ms | 14.7 MB |

## What costs the score

**Personal site, mobile: main-thread time, not bytes.** Lighthouse attributes
4.5 s of throttled script evaluation to the background bundle.

An unthrottled CPU profile of the same page shows only about 0.4 s of real
JavaScript. Most of it is the per-frame render path (`render`, the ISS and
solar frame, a 128-sample CPU sky integral) plus shader startup at 4× CPU.

Lighthouse simulates a 4× slower CPU, so a frame costing 15–20 ms becomes a
60–80 ms long task. With a continuous 24 FPS loop, every such frame counts
toward TBT. The LCP element is the page heading (`h1`): text, not the canvas.
LCP rises only because the main thread is busy when the heading should paint.

**Background bytes** (3.4 MB, all at startup):

| Asset | Size | Priority |
| --- | ---: | --- |
| `earth-clouds-nasa-4096.avif` | 793 KB | low |
| `optical-psf.bin` | 590 KB | high (preview) |
| `stars-hyg.bin` | 500 KB | high (preview) |
| `mobile/galaxy-2048.avif` | 308 KB | low |
| `mobile/day-2048.avif` | 123 KB | low |
| `earth-night.avif` | 108 KB | low |

The rest is the site's own images and scripts.

The two binary files are served without `Content-Encoding`. Brotli shrinks
`optical-psf.bin` from 590 KB to 65 KB. `stars-hyg.bin` stores 32 bytes per
star for about 15,600 stars brighter than magnitude 7. Brotli barely helps it
(500 → 414 KB). Quantizing the format would.

**Explorer:**

- Desktop downloads `earth-terrain-8192-v2.dem` (8.4 MB), which is 57% of
  everything it loads, although regional terrain streaming supplies the
  close-up detail. Mobile downloads the 4096 DEM (2.5 MB).
- When cloud tiles are available, the cloud overview is already the 4096 one.

**Caching:**

- Published assets: `public, max-age=31536000, immutable` (R2, Cloudflare HIT).
  Correct.
- The personal site has no `_headers`. Hashed `/_astro/*` files and wallpapers
  get `max-age=0, must-revalidate`, which Lighthouse flags as
  `uses-long-cache-ttl`.
- DEM files are served without a `Content-Type`.

## Measurement limits

- SwiftShader makes WebGL calls CPU-bound, so lab TBT overstates the cost on
  phones with a GPU. Lighthouse lab scores are still what PageSpeed shows.
  The site has no Chrome UX Report field data to replace them.
- Local serving changes HTML and script latency. It does not change asset
  latency, because assets came from the published origin.
- Each figure is from one run. Treat differences smaller than about 10 points
  or 20% as noise.
