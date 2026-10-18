# /// script
# dependencies = ["h5py", "numpy", "scipy"]
# ///
"""Global night lights from Black Marble VNP46A4 / VJ146A4 Collection 2, 2022-2024 median.

  uv run scripts/vnp46-global.py median <listing-dir> <download-dir> <work-dir> [--workers 4] [tile ...]
      Per 10-degree tile: download its six granules from LAADS (collection 5200,
      day 001) with the Earthdata token in ~/.config/earthdata/token, take the
      median radiance, write <tile>-median.f16, <tile>-water.u8 and <tile>.json,
      then delete the HDF5. Resumes: a tile with a JSON is done.
      <listing-dir> holds LAADS content listings, <product>-<year>.json, from
      https://ladsweb.modaps.eosdis.nasa.gov/api/v2/content/details/allData/5200/<product>/<year>/001?limit=1000
  uv run scripts/vnp46-global.py code <work-dir> [tile ...]
      Floor, open-water halo and log code with real neighbours across granule
      edges: writes <tile>-code.u8.
  uv run scripts/vnp46-global.py overview <work-dir>
      The overview maps' pixels, overview-<width>.u8 for widths 8192, 4096 and
      1024: the area mean of the displayed value, nightVnp46Encoded of each
      texel on Black Marble 2016's scale, as the tiles' packed mips average it.
  bun scripts/build-night-vnp46.mjs --global <work-dir>
      Cuts the tiles and encodes the overview maps.

The filters are those of the regional lab (scripts/vnp46-composite.py,
docs/lab/night-vnp46-2026-10-17.md), with the dark floor raised to 1 nW. The
code is no longer the lab's log radiance: it is linear in the displayed value. Granules
missing from LAADS (the 108 ocean-only tiles) count as dark open sea.
"""
import concurrent.futures
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.request

import numpy as np

FIELDS = 'HDFEOS/GRIDS/VIIRS_Grid_DNB_2d/Data Fields/'
HOST = 'https://ladsweb.modaps.eosdis.nasa.gov'
PRODUCTS, YEARS = ('VNP46A4', 'VJ146A4'), (2022, 2023, 2024)
FLOOR = 1.      # nW cm^-2 sr^-1; below it the composite is residual background (the lab's 0.5
                # left 0.5-1 nW over polar ice and snow; the 2016 plates are zero below ~0.9)
# Black Marble 2016's display scale, fitted to co-located 30" blocks of all 540
# granules (scripts/vnp46-transfer.py): e = A ln(1 + (L/R0)^P) / P, L in nW cm^-2 sr^-1.
A, R0, P = .3572, 1.564, 4.567
TOP = 2.88      # e at ~5000 nW; code = 255 e / TOP, so 1 (the 2016 ceiling, ~26 nW) is code 88.5
N = 2400
PAD = 256       # neighbour margin for the water halo: 0.10 * 256^-0.6 = 0.4% of the shore


class NoRedirect(urllib.request.HTTPRedirectHandler):
    # The token goes to LAADS only: never follow a redirect with it.
    def redirect_request(self, *args):
        return None


def listing(directory):
    files = {}
    for product in PRODUCTS:
        for year in YEARS:
            with open(os.path.join(directory, f'{product}-{year}.json')) as handle:
                for entry in json.load(handle)['content']:
                    tile = entry['name'].split('.')[2]
                    files.setdefault(tile, []).append((product, year, entry['name'], entry['size']))
    return files


def download(opener, token, product, year, name, size, target):
    url = f'{HOST}/archive/allData/5200/{product}/{year}/001/{name}'
    if os.path.exists(target) and os.path.getsize(target) == size:
        with open(target, 'rb') as handle:
            return hashlib.file_digest(handle, 'sha256').hexdigest()
    for attempt in range(6):
        digest, written = hashlib.sha256(), 0
        try:
            request = urllib.request.Request(url, headers={'Authorization': f'Bearer {token}'})
            with opener.open(request, timeout=120) as response, open(target + '.part', 'wb') as out:
                if response.status != 200:
                    raise OSError(f'HTTP {response.status}')
                while chunk := response.read(1 << 20):
                    out.write(chunk)
                    digest.update(chunk)
                    written += len(chunk)
            if written != size:
                raise OSError(f'{written} of {size} bytes')
            os.replace(target + '.part', target)
            return digest.hexdigest()
        except (OSError, urllib.error.URLError) as error:
            # The error never contains the token: the request headers are not part of it.
            print(f'{name}: attempt {attempt + 1}: {error}', file=sys.stderr, flush=True)
            time.sleep(10 * 2 ** attempt)
    raise RuntimeError(f'{name}: download failed')


def median_tile(tile, entries, opener, token, downloads, work):
    import h5py
    if os.path.exists(os.path.join(work, f'{tile}.json')):
        return tile, 'done'
    if len(entries) != 6:
        raise RuntimeError(f'{tile}: {len(entries)} granules listed')
    os.makedirs(os.path.join(downloads, tile), exist_ok=True)
    layers, granules, water, corner = [], [], None, None
    for product, year, name, size in sorted(entries):
        path = os.path.join(downloads, tile, name)
        digest = download(opener, token, product, year, name, size, path)
        with h5py.File(path, 'r') as f:
            free = f[FIELDS + 'AllAngle_Composite_Snow_Free'][:]
            snow = f[FIELDS + 'AllAngle_Composite_Snow_Covered'][:]
            quality = np.where(free > -900, f[FIELDS + 'AllAngle_Composite_Snow_Free_Quality'][:],
                               f[FIELDS + 'AllAngle_Composite_Snow_Covered_Quality'][:])
            if water is None:
                water = f[FIELDS + 'Land_Water_Mask'][:]
                corner = float(f[FIELDS + 'lat'][0]), float(f[FIELDS + 'lon'][0])
            attrs = {k: (v.decode() if isinstance(v, bytes) else v) for k, v in f.attrs.items()}
        os.remove(path)
        # The snow-free composite, and the snow-covered one only where it is missing.
        layers.append(np.where(free > -900, free, np.where(snow > -900, snow, np.nan)).astype(np.float32))
        granules.append(dict(file=name, sha256=digest, bytes=size, doi=attrs['identifier_product_doi'],
                             platform=attrs['PlatformShortName'], production=attrs['ProductionTime'],
                             inputs=int(attrs['NumberofInputGranules']),
                             snow_filled=int(((free <= -900) & (snow > -900)).sum()),
                             poor_quality=int((quality == 1).sum())))
    os.rmdir(os.path.join(downloads, tile))
    stack = np.stack(layers)
    median = np.nanmedian(stack, axis=0)
    # Light present in one or two of six composites: what the median removed.
    transient = np.nanmax(stack, axis=0) > 10 * np.maximum(median, FLOOR)
    np.nan_to_num(median, nan=0).astype('<f2').tofile(os.path.join(work, f'{tile}-median.f16'))
    water.astype(np.uint8).tofile(os.path.join(work, f'{tile}-water.u8'))
    meta = dict(tile=tile, north=corner[0], west=corner[1], missing=int(np.isnan(median).sum()),
                flux=float(np.nansum(median)), max=float(np.nanmax(median)),
                transient=int(transient.sum()), granules=granules)
    with open(os.path.join(work, f'{tile}.json'), 'w') as handle:
        json.dump(meta, handle, indent=1)
    return tile, f'{meta["flux"]:.0f} nW sum, max {meta["max"]:.0f}'


def read(work, h, v, name, dtype, fill):
    path = os.path.join(work, f'h{h % 36:02d}v{v:02d}-{name}')
    if 0 <= v < 18 and os.path.exists(path):
        return np.fromfile(path, dtype).reshape(N, N).astype(np.float32 if dtype == '<f2' else dtype)
    return np.full((N, N), fill, np.float32 if dtype == '<f2' else dtype)


def code_tile(work, tile):
    from scipy import ndimage
    h, v = int(tile[1:3]), int(tile[4:6])
    # This tile with PAD pixels from its eight neighbours; the poles have none (sea).
    window = lambda name, dtype, fill: np.block([[read(work, h + dx, v + dy, name, dtype, fill)
                                                 for dx in (-1, 0, 1)] for dy in (-1, 0, 1)])[N - PAD:2 * N + PAD, N - PAD:2 * N + PAD]
    r = window('median.f16', '<f2', 0).astype(np.float64)
    water = window('water.u8', np.uint8, 3)
    inner = (slice(PAD, PAD + N),) * 2
    ledger = dict(flux=float(r[inner].sum()))
    # 1. Dark floor.
    r[r < FLOOR] = 0
    ledger['flux_after_floor'] = float(r[inner].sum())
    # 2. Open water (inland 2, sea 3; the coastal class 5 is untouched): subtract the
    #    nearest shore's stray-light halo, 0.10 d^-0.6 of its radiance, faded in by
    #    the local water fraction.
    open_water = (water == 2) | (water == 3)
    if open_water[inner].any() and not open_water.all():
        distance, (iy, ix) = ndimage.distance_transform_edt(open_water, return_indices=True)
        shore = ndimage.maximum_filter(np.where(open_water, 0, r), 7)[iy, ix]
        halo = .10 * np.maximum(distance, 1) ** -.6 * shore
        blend = ndimage.gaussian_filter(open_water.astype(np.float64), 1.)
        r = np.where(open_water, r - (r - np.maximum(0, r - halo)) * blend, r)
    ledger['flux_after_water'] = float(r[inner].sum())
    # 3. Code, linear in the displayed value, so the shader's interpolation and the
    #    browser's mips average what is shown; nightRange=extended reads it above 1.
    code = np.rint(255 * np.minimum(TOP, displayed(r[inner])) / TOP).astype(np.uint8)
    code.tofile(os.path.join(work, f'{tile}-code.u8'))
    with open(os.path.join(work, f'{tile}.json')) as handle:
        meta = json.load(handle)
    meta['ledger'] = ledger
    with open(os.path.join(work, f'{tile}.json'), 'w') as handle:
        json.dump(meta, handle, indent=1)
    return tile, json.dumps(ledger)


def displayed(radiance):
    # Black Marble 2016's display scale, unclamped: a soft toe near 1 nW, then A ln(L/R0).
    t = P * (np.log(np.maximum(radiance, 1e-6)) - np.log(R0))
    return A / P * np.where(t > 15, t, np.log1p(np.exp(np.minimum(t, 15))))


def encoded(code):
    # nightVnp46Encoded in src/scripts/surface-tile-shader.ts, with the shared 2016 ceiling.
    return np.minimum(1, code * TOP)


def area(image, width, height):
    # Exact area mean of a piecewise-constant image, through its integral.
    for axis, size in ((0, height), (1, width)):
        n = image.shape[axis]
        integral = np.concatenate([np.zeros_like(image.take([0], axis)), np.cumsum(image, axis, np.float64)], axis)
        edges = np.linspace(0, n, size + 1)
        i = np.minimum(edges.astype(int), n - 1)
        f = (edges - i).reshape((-1, 1) if axis == 0 else (1, -1))
        at = integral.take(i, axis) + f * (integral.take(i + 1, axis) - integral.take(i, axis))
        image = np.diff(at, axis=axis) * (size / n)
    return image


def overview(work):
    # Mean displayed value in 8 x 8 blocks (300 per granule side), then exact area means.
    block = 8
    m = N // block
    mean = np.zeros((18 * m, 36 * m), np.float32)
    for v in range(18):
        for h in range(36):
            path = os.path.join(work, f'h{h:02d}v{v:02d}-code.u8')
            if os.path.exists(path):
                shown = encoded(np.fromfile(path, np.uint8) / 255).reshape(m, block, m, block)
                mean[v * m:(v + 1) * m, h * m:(h + 1) * m] = shown.mean((1, 3))
    for width in (8192, 4096, 1024):
        pixels = np.rint(255 * area(mean, width, width // 2)).astype(np.uint8)
        pixels.tofile(os.path.join(work, f'overview-{width}.u8'))
        print(f'overview {width}: mean {pixels.mean():.3f}, lit {(pixels > 0).mean():.4f}', flush=True)


def main():
    command, *args = sys.argv[1:]
    workers = 4
    if '--workers' in args:
        index = args.index('--workers')
        workers = int(args[index + 1])
        del args[index:index + 2]
    if command == 'median':
        listings, downloads, work, *tiles = args
        os.makedirs(work, exist_ok=True)
        files = listing(listings)
        tiles = tiles or sorted(files)
        with open(os.path.expanduser('~/.config/earthdata/token')) as handle:
            token = handle.read().strip()
        opener = urllib.request.build_opener(NoRedirect)
        with concurrent.futures.ThreadPoolExecutor(workers) as pool:
            jobs = [pool.submit(median_tile, t, files.get(t, []), opener, token, downloads, work) for t in tiles]
            failed = []
            for done, job in enumerate(concurrent.futures.as_completed(jobs), 1):
                try:
                    tile, note = job.result()
                except Exception as error:
                    tile, note = '-', f'FAILED {error}'
                    failed.append(str(error))
                print(f'{done}/{len(jobs)} {tile} {note}', flush=True)
            if failed:
                sys.exit(f'{len(failed)} tiles failed; run again to resume')
    elif command == 'code':
        work, *tiles = args
        tiles = tiles or sorted(f[:-5] for f in os.listdir(work) if f.endswith('.json') and f.startswith('h'))
        with concurrent.futures.ProcessPoolExecutor(workers) as pool:
            for done, (tile, note) in enumerate(pool.map(code_tile, [work] * len(tiles), tiles), 1):
                print(f'{done}/{len(tiles)} {tile} {note}', flush=True)
    elif command == 'overview':
        overview(*args)
    else:
        sys.exit(__doc__)


if __name__ == '__main__':
    main()
