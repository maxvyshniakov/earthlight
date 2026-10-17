# /// script
# dependencies = ["numpy", "scipy"]
# ///
"""Lab, nightDetail=vnp46: effective resolution and the Black Marble 2016 transfer.

Usage: uv run scripts/vnp46-measure.py <work-dir> h09v04 [h25v06 ...]
Needs vnp46-composite.py's output and <tile>-bm.u8, the shipped Black Marble
2016 tiles cut to the same 2400 x 2400 window (bun scripts/build-night-vnp46.mjs
--black-marble <work-dir> <tile>). Prints JSON; see docs/lab/night-vnp46-2026-10-17.md.
"""
import json
import sys

import numpy as np
from scipy.optimize import curve_fit

N = 2400
work, *tiles = sys.argv[1:]


def load(tile, name, dtype='<f4'):
    return np.fromfile(f'{work}/{tile}-{name}', dtype=dtype).reshape(N, N).astype(np.float64)


def corr(a, b):
    a, b = a - a.mean(), b - b.mean()
    return float((a * b).sum() / np.sqrt((a * a).sum() * (b * b).sum()))


def parity(a):
    """Share of neighbour |gradient| between texels (2k, 2k+1). Tile cells start
    on even global columns and rows, so this is also the cell-coordinate phase."""
    gx, gy = np.abs(np.diff(a, axis=1)), np.abs(np.diff(a, axis=0))
    return round(float(gx[:, 0::2].sum() / gx.sum()), 3), round(float(gy[0::2].sum() / gy.sum()), 3)


def blocks(a, phase):
    a = a[phase:N - 2 + phase, phase:N - 2 + phase]
    return a.reshape(N // 2 - 1, 2, N // 2 - 1, 2).mean(axis=(1, 3))


def sub_block(a):
    m = a.reshape(N // 2, 2, N // 2, 2).mean(axis=(1, 3))
    return a - np.repeat(np.repeat(m, 2, 0), 2, 1)


report, samples = {}, ([], [])
for tile in tiles:
    r, snpp, noaa20 = load(tile, 'median.f32'), load(tile, 'snpp.f32'), load(tile, 'noaa20.f32')
    bm = load(tile, 'bm.u8', np.uint8) / 255
    lr = np.log1p(r)
    lit = r > 2
    shifts = {(dy, dx): corr(lr[64:-64, 64:-64], np.roll(bm, (dy, dx), (0, 1))[64:-64, 64:-64])
              for dy in range(-2, 3) for dx in range(-2, 3)}
    hp = lr - (np.roll(lr, 2, 0) + np.roll(lr, -2, 0) + np.roll(lr, 2, 1) + np.roll(lr, -2, 1)) / 4
    lag = lambda k, axis: round(corr(hp[lit], np.roll(hp, k, axis)[lit]), 3)
    a, b = np.log1p(snpp), np.log1p(noaa20)
    report[tile] = dict(
        best_shift_px=max(shifts, key=shifts.get), shift_corr=round(max(shifts.values()), 3),
        parity_vnp=parity(lr), parity_bm=parity(bm),
        sub30_corr_snpp_noaa20=round(corr(sub_block(a)[lit], sub_block(b)[lit]), 3),
        sub30_rms=round(float(np.sqrt((sub_block(lr)[lit] ** 2).mean())), 3),
        satellite_difference_rms=round(float(np.sqrt(((a - b)[lit] ** 2).mean())), 3),
        highpass_lag=dict(x1=lag(1, 1), x2=lag(2, 1), y1=lag(1, 0), y2=lag(2, 0)),
        ephemeral_px=int(((load(tile, 'maxratio.f32') > 10)).sum()))
    # Black Marble blocks are texel pairs (2k+1, 2k+2): phase 1.
    samples[0].append(blocks(r, 1).ravel())
    samples[1].append(blocks(bm, 1).ravel())

radiance, encoded = np.concatenate(samples[0]), np.concatenate(samples[1])
edges = np.geomspace(.2, 80, 36)
x, y = [], []
for lo, hi in zip(edges[:-1], edges[1:]):
    k = (radiance >= lo) & (radiance < hi)
    if k.sum() > 50:
        x.append(np.median(radiance[k]))
        y.append(np.median(encoded[k]))
x, y = np.array(x), np.array(y)
keep = y < .98
transfer = lambda L, a, r0, p: a * np.log1p((L / r0) ** p) / p
coef, _ = curve_fit(transfer, x[keep], y[keep], p0=(.35, 1., 2.), maxfev=20000)
report['transfer'] = dict(form='e = a ln(1 + (L/r0)^p) / p', a=round(coef[0], 4), r0=round(coef[1], 4), p=round(coef[2], 3),
                          rms=round(float(np.sqrt(np.mean((transfer(x[keep], *coef) - y[keep]) ** 2))), 4),
                          bins=[[round(float(u), 2), round(float(v), 3)] for u, v in zip(x, y)])
print(json.dumps(report, indent=1, default=str))
