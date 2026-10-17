# /// script
# dependencies = ["numpy", "openpyxl"]
# ///
"""Gas flares in the global VNP46A4 composite, against the VIIRS Nightfire catalogue.

Usage: uv run scripts/vnp46-flares.py <work-dir> <flare-dir> [<black-marble.json>]

<work-dir> is scripts/vnp46-global.py's (median, water and code rasters).
<flare-dir> holds EOG's annual flare site lists, 2022-2024
(VIIRS_Global_flaring_d.7_slope_0.029353_<year>_*.xlsx from
https://eogdata.mines.edu/products/vnf/global_gas_flare.html). Writes
<work-dir>/flares.json: each site's 15" pixel, then the summary. A third
argument adds the Black Marble 2016 value at each site, as sampled by
bun scripts/build-night-vnp46.mjs --sample-black-marble <work-dir>/flares.json.
"""
import glob
import json
import os
import sys

import numpy as np
import openpyxl

N, FLOOR = 2400, 1.
A, R0, P, TOP = .3572, 1.564, 4.567, 2.88   # scripts/vnp46-global.py's code
CEILING = 26.   # nW: the 2016 display scale reaches 1 here (global fit)
work, flares = sys.argv[1:3]
black_marble = json.load(open(sys.argv[3])) if len(sys.argv) > 3 else None

sites = []
for path in sorted(glob.glob(os.path.join(flares, 'VIIRS_Global_flaring_*.xlsx'))):
    year = int(os.path.basename(path).split('_')[6])
    for sheet in openpyxl.load_workbook(path, read_only=True).worksheets:
        rows = sheet.iter_rows(values_only=True)
        header = next(rows)
        col = {name: i for i, name in enumerate(header)}
        if 'Latitude' not in col:
            continue
        bcm = next(i for name, i in col.items() if name and name.startswith('BCM'))
        for row in rows:
            if row[col['Latitude']] is None:
                continue
            lat, lon = float(row[col['Latitude']]), float(row[col['Longitude']])
            sites.append(dict(year=year, country=row[col['Country']], type=row[col['Type']], bcm=float(row[bcm] or 0),
                              x=int((lon + 180) * 240) % 86400, y=min(43199, int((90 - lat) * 240))))

# Sites from the three years at the same 15" pixel are one location.
locations = {}
for s in sites:
    key = (s['x'], s['y'])
    entry = locations.setdefault(key, dict(x=s['x'], y=s['y'], country=s['country'], type=s['type'], years=[], bcm=0.))
    entry['years'].append(s['year'])
    entry['bcm'] += s['bcm'] / 3
locations = list(locations.values())

def decode(code):
    # Radiance from the code, the inverse of vnp46-global.py's displayed() (0 stays 0).
    y = np.maximum(code / 255 * TOP * P / A, 1e-12)
    return np.where(code > 0, R0 * np.exp(np.where(y > 15, y, np.log(np.expm1(y))) / P), 0)
granules = {}
for loc in locations:
    granules.setdefault((loc['x'] // N, loc['y'] // N), []).append(loc)
total = dict(flux=0., flare=0., isolated=0.)
missing = 0
for (h, v), group in sorted(granules.items()):
    stem = os.path.join(work, f'h{h:02d}v{v:02d}')
    if not os.path.exists(stem + '-code.u8'):
        missing += len(group)
        for loc in group:
            loc['granule'] = None
        continue
    median = np.fromfile(stem + '-median.f16', '<f2').reshape(N, N).astype(np.float64)
    water = np.fromfile(stem + '-water.u8', np.uint8).reshape(N, N)
    light = decode(np.fromfile(stem + '-code.u8', np.uint8).reshape(N, N).astype(np.float64))
    near = np.zeros((N, N), bool)
    for loc in group:
        x, y = loc['x'] - h * N, loc['y'] - v * N
        window = (slice(max(0, y - 1), y + 2), slice(max(0, x - 1), x + 2))
        loc['granule'] = f'h{h:02d}v{v:02d}'
        loc['median'] = float(median[window].max())
        loc['light'] = float(light[window].max())
        loc['water'] = int(water[y, x])
        # Flux within 2 px (about 1 km), and light 10-20 px away: a flare alone in the dark?
        loc['flux'] = float(light[max(0, y - 2):y + 3, max(0, x - 2):x + 3].sum())
        ring = light[max(0, y - 20):y + 21, max(0, x - 20):x + 21]
        loc['surroundings'] = float(np.median(ring))
        near[max(0, y - 2):y + 3, max(0, x - 2):x + 3] = True
    total['flare'] += float(light[near].sum())
    total['isolated'] += sum(loc['flux'] for loc in group if loc['surroundings'] < FLOOR)
for path in glob.glob(os.path.join(work, 'h*v*-code.u8')):
    total['flux'] += float(decode(np.fromfile(path, np.uint8).astype(np.float64)).sum())

seen = [loc for loc in locations if loc.get('granule')]
if black_marble:
    for loc, value in zip(locations, black_marble):
        loc['black_marble'] = value
lit = [loc for loc in seen if loc['light'] >= FLOOR]
summary = dict(
    sites=len(sites), locations=len(locations), in_ocean_only_granules=missing,
    lit=len(lit), above_2016_ceiling=sum(loc['median'] >= CEILING for loc in seen),
    offshore=sum(loc['water'] in (2, 3) for loc in seen),
    offshore_lit=sum(loc['water'] in (2, 3) and loc['light'] >= FLOOR for loc in seen),
    offshore_kept=float(np.median([loc['light'] / loc['median'] for loc in seen if loc['water'] in (2, 3) and loc['median'] >= 5] or [0])),
    isolated_lit=sum(loc['surroundings'] < FLOOR for loc in lit),
    flux_share=total['flare'] / total['flux'], isolated_share=total['isolated'] / total['flux'],
    median_peak=float(np.median([loc['median'] for loc in lit])),
    by_country=sorted(((c, round(sum(loc['flux'] for loc in seen if loc['country'] == c) / total['flux'] * 100, 3))
                       for c in {loc['country'] for loc in seen}), key=lambda item: -item[1])[:12],
)
if black_marble:
    summary['black_marble_lit'] = sum(loc.get('black_marble', 0) > 0 for loc in lit)
    summary['black_marble_saturated'] = sum(loc.get('black_marble', 0) >= 250 for loc in lit)
with open(os.path.join(work, 'flares.json'), 'w') as handle:
    json.dump(dict(pixels=[[loc['x'], loc['y']] for loc in locations], summary=summary), handle)
print(json.dumps(summary, indent=1))
