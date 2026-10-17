# /// script
# dependencies = ["numpy", "scipy"]
# ///
"""The Black Marble 2016 transfer, refitted on every granule of the global build.

Usage: uv run scripts/vnp46-transfer.py <work-dir>
Needs scripts/vnp46-global.py's <tile>-median.f16 and <tile>-bm.u8, the
shipped 2016 tiles cut to the granule (bun scripts/build-night-vnp46.mjs
--black-marble <work-dir> <tile>...). Compares co-located 30" blocks with the
regional fit the shader uses (docs/lab/night-vnp46-2026-10-17.md), globally
and by region. Prints JSON.
"""
import glob
import json
import os
import sys

import numpy as np
from scipy.optimize import curve_fit

N = 2400
work = sys.argv[1]
transfer = lambda L, a, r0, p: a * np.log1p((L / r0) ** p) / p
LAB = (.328, 1.089, 6.84)
REGIONS = dict(americas=(-180, -30), europe_africa=(-30, 60), asia_oceania=(60, 180))
edges = np.geomspace(.2, 80, 36)


def blocks(a):
    # Black Marble's 2 x 2 blocks are texel pairs (2k+1, 2k+2): phase 1.
    return a[1:N - 1, 1:N - 1].reshape(N // 2 - 1, 2, N // 2 - 1, 2).mean(axis=(1, 3)).ravel()


def binned(radiance, encoded):
    x, y = [], []
    for lo, hi in zip(edges[:-1], edges[1:]):
        k = (radiance >= lo) & (radiance < hi)
        if k.sum() > 200:
            x.append(np.median(radiance[k]))
            y.append(np.median(encoded[k]))
    return np.array(x), np.array(y)


samples = {name: ([], []) for name in REGIONS}
for path in sorted(glob.glob(os.path.join(work, 'h*v*-bm.u8'))):
    tile = os.path.basename(path)[:6]
    west = int(tile[1:3]) * 10 - 180
    r = np.fromfile(os.path.join(work, f'{tile}-median.f16'), '<f2').reshape(N, N).astype(np.float64)
    bm = np.fromfile(path, np.uint8).reshape(N, N) / 255
    radiance, encoded = blocks(r), blocks(bm)
    lit = (radiance > .2) | (encoded > 0)
    region = next(name for name, (lo, hi) in REGIONS.items() if lo <= west < hi)
    samples[region][0].append(radiance[lit])
    samples[region][1].append(encoded[lit])

report = {}
for name, (radiance, encoded) in [*samples.items(), ('global', tuple(sum((list(s[i]) for s in samples.values()), []) for i in (0, 1)))]:
    if not radiance:
        continue
    radiance, encoded = np.concatenate(radiance), np.concatenate(encoded)
    x, y = binned(radiance, encoded)
    keep = y < .98
    coef, _ = curve_fit(transfer, x[keep], y[keep], p0=LAB, maxfev=20000)
    lab = transfer(x[keep], *LAB) - y[keep]
    report[name] = dict(blocks=int(radiance.size), fit=[round(float(c), 4) for c in coef],
                        lab_rms=round(float(np.sqrt(np.mean(lab ** 2))), 4), lab_bias=round(float(np.mean(lab)), 4),
                        fit_rms=round(float(np.sqrt(np.mean((transfer(x[keep], *coef) - y[keep]) ** 2))), 4),
                        half_at=round(float(x[np.argmin(np.abs(y - .5))]), 2),
                        bins=[[round(float(u), 2), round(float(v), 3)] for u, v in zip(x, y)])
print(json.dumps(report, indent=1))
