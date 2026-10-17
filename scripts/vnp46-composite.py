# /// script
# dependencies = ["h5py", "numpy", "scipy"]
# ///
"""Lab, nightDetail=vnp46: median VNP46A4/VJ146A4 Collection 2 radiance, 2022-2024.

Usage: uv run scripts/vnp46-composite.py <h5-dir> <work-dir> h09v04 [h25v06 ...]
Then:  bun scripts/build-night-vnp46.mjs <work-dir> h09v04 [h25v06 ...]

Each 10-degree tile needs six granules (two satellites x three years) from
LAADS DAAC, collection 5200, day 001. Keep them outside the repository.
Writes <tile>-median.f32 (and snpp, noaa20, maxratio for vnp46-measure.py),
<tile>-water.u8, <tile>-code.u8 (the 8-bit log code the tiles carry) and
<tile>.json with checksums and filter totals. Every filter is documented in
docs/lab/night-vnp46-2026-10-17.md.
"""
import glob
import hashlib
import json
import os
import sys

import h5py
import numpy as np
from scipy import ndimage

FIELDS = 'HDFEOS/GRIDS/VIIRS_Grid_DNB_2d/Data Fields/'
FLOOR = .5      # nW cm^-2 sr^-1; below it the composite is residual background
SCALE = .25     # code = 255 ln(1 + L/SCALE) / ln(1 + TOP/SCALE)
TOP = 5000.
N = 2400

source, work, *tiles = sys.argv[1:]
os.makedirs(work, exist_ok=True)


def save(tile, name, array):
    array.tofile(os.path.join(work, f'{tile}-{name}'))


for tile in tiles:
    files = sorted(glob.glob(os.path.join(source, f'V*46A4.A202[234]001.{tile}.*.h5')))
    if len(files) != 6:
        sys.exit(f'{tile}: expected 6 granules, found {len(files)}')
    layers, granules = {}, []
    for path in files:
        with h5py.File(path, 'r') as f:
            free = f[FIELDS + 'AllAngle_Composite_Snow_Free'][:]
            snow = f[FIELDS + 'AllAngle_Composite_Snow_Covered'][:]
            quality = np.where(free > -900, f[FIELDS + 'AllAngle_Composite_Snow_Free_Quality'][:],
                               f[FIELDS + 'AllAngle_Composite_Snow_Covered_Quality'][:])
            water = f[FIELDS + 'Land_Water_Mask'][:]
            lat, lon = f[FIELDS + 'lat'][:], f[FIELDS + 'lon'][:]
            attrs = {k: (v.decode() if isinstance(v, bytes) else v) for k, v in f.attrs.items()}
        # The snow-free composite, and the snow-covered one only where it is missing.
        radiance = np.where(free > -900, free, np.where(snow > -900, snow, np.nan)).astype(np.float32)
        name = os.path.basename(path)
        layers[name] = radiance
        with open(path, 'rb') as handle:
            digest = hashlib.sha256(handle.read()).hexdigest()
        granules.append(dict(file=name, sha256=digest, doi=attrs['identifier_product_doi'],
                             platform=attrs['PlatformShortName'], production=attrs['ProductionTime'],
                             inputs=int(attrs['NumberofInputGranules']),
                             snow_filled=int(((free <= -900) & (snow > -900)).sum()),
                             poor_quality=int((quality == 1).sum())))
    stack = np.stack(list(layers.values()))
    median = np.nanmedian(stack, axis=0).astype(np.float32)
    by = lambda prefix: np.nanmedian(np.stack([v for k, v in layers.items() if k.startswith(prefix)]), axis=0)
    save(tile, 'median.f32', median.astype('<f4'))
    save(tile, 'snpp.f32', by('VNP').astype('<f4'))
    save(tile, 'noaa20.f32', by('VJ1').astype('<f4'))
    save(tile, 'maxratio.f32', (np.nanmax(stack, axis=0) / np.maximum(median, .5)).astype('<f4'))
    save(tile, 'water.u8', water)

    r = np.nan_to_num(median.astype(np.float64))
    ledger = dict(flux=float(r.sum()))
    # 1. Dark floor.
    r[r < FLOOR] = 0
    ledger['flux_after_floor'] = float(r.sum())
    # 2. Open water (inland 2, sea 3; the coastal class 5 is untouched): subtract the
    #    nearest shore's stray-light halo, 0.10 d^-0.6 of its radiance (the p90
    #    envelope measured in Cleveland and Delhi), faded in by the local water
    #    fraction so the removal does not draw the 15" mask's staircase.
    open_water = (water == 2) | (water == 3)
    distance, (iy, ix) = ndimage.distance_transform_edt(open_water, return_indices=True)
    shore = ndimage.maximum_filter(np.where(open_water, 0, r), 7)[iy, ix]
    halo = .10 * np.maximum(distance, 1) ** -.6 * shore
    blend = ndimage.gaussian_filter(open_water.astype(np.float64), 1.)
    r = np.where(open_water, r - (r - np.maximum(0, r - halo)) * blend, r)
    ledger['flux_after_water'] = float(r.sum())
    # 3. Log code.
    code = np.rint(255 * np.log1p(np.minimum(r, TOP) / SCALE) / np.log1p(TOP / SCALE)).astype(np.uint8)
    save(tile, 'code.u8', code)
    meta = dict(tile=tile, north=float(lat[0]), west=float(lon[0]), missing=int(np.isnan(median).sum()),
                max=float(r.max()), ledger=ledger, granules=granules)
    with open(os.path.join(work, f'{tile}.json'), 'w') as handle:
        json.dump(meta, handle, indent=1)
    print(tile, json.dumps(ledger))
