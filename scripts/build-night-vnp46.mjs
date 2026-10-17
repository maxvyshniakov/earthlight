// Lab, nightDetail=vnp46: global night tiles from NASA Black Marble VNP46A4 /
// VJ146A4 Collection 2 (see docs/lab/night-vnp46-2026-10-17.md).
// bun scripts/build-night-vnp46.mjs --global <work>  after scripts/vnp46-global.py:
// every non-empty tile, gutters from the neighbouring granules (columns wrap,
// the poles clamp), and the overview maps from the same composite.
// bun scripts/build-night-vnp46.mjs --black-marble <work> <hXXvYY>...  cuts the
// shipped Black Marble 2016 tiles to granule windows for vnp46-measure.py and
// vnp46-transfer.py.
// bun scripts/build-night-vnp46.mjs --sample-black-marble <work>/flares.json
// samples them at vnp46-flares.py's flare sites.
import sharp from 'sharp';
import { mkdir, readFile, writeFile, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

if (process.argv[2] === '--sample-black-marble') {
  // The shipped 2016 value (max of 3 x 3 texels) at each pixel of vnp46-flares.py's flares.json.
  const source = 'public/media/earthlight/night-tiles', file = process.argv[3];
  const shipped = new Set(JSON.parse(await readFile(join(source, 'manifest.json'), 'utf8')).tiles), cache = new Map();
  const values = [];
  for (const [x, y] of JSON.parse(await readFile(file, 'utf8')).pixels) {
    const id = Math.floor(y / 540) * 160 + Math.floor(x / 540);
    if (!shipped.has(id)) { values.push(0); continue; }
    if (!cache.has(id)) cache.set(id, (await sharp(join(source, `${id}.avif`)).extractChannel(0).raw().toBuffer()));
    const data = cache.get(id), lx = x % 540 + 16, ly = y % 540 + 16;
    let value = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) value = Math.max(value, data[(ly + dy) * 572 + lx + dx]);
    values.push(value);
  }
  await writeFile(file.replace(/\.json$/, '-black-marble.json'), JSON.stringify(values));
  process.exit(0);
}
const blackMarble = process.argv[2] === '--black-marble';
if (!blackMarble && process.argv[2] !== '--global') throw new Error('Usage: see the header of scripts/build-night-vnp46.mjs');
const [work, ...regions] = process.argv.slice(3);
const output = 'public/media/earthlight/night-vnp46-tiles';
const N = 2400, interior = 540, gutter = 16, cell = 572;
const origin = region => [+region.slice(1, 3) * N, +region.slice(4, 6) * N];
if (blackMarble) {
  const source = 'public/media/earthlight/night-tiles';
  const shipped = new Set(JSON.parse(await readFile(join(source, 'manifest.json'), 'utf8')).tiles);
  for (const region of regions) {
    const [X0, Y0] = origin(region), raster = new Uint8Array(N * N);
    for (let ty = Math.floor(Y0 / interior); ty <= Math.floor((Y0 + N - 1) / interior); ty++)
      for (let tx = Math.floor(X0 / interior); tx <= Math.floor((X0 + N - 1) / interior); tx++) {
        if (!shipped.has(ty * 160 + tx)) continue;
        const { data, info } = await sharp(join(source, `${ty * 160 + tx}.avif`)).extractChannel(0).raw().toBuffer({ resolveWithObject: true });
        for (let y = 0; y < interior; y++) for (let x = 0; x < interior; x++) {
          const gx = tx * interior + x - X0, gy = ty * interior + y - Y0;
          if (gx >= 0 && gx < N && gy >= 0 && gy < N) raster[gy * N + gx] = data[(y + gutter) * info.width + x + gutter];
        }
      }
    await writeFile(join(work, `${region}-bm.u8`), raster);
  }
  process.exit(0);
}
await mkdir(output, { recursive: true });
// The shader's nightVnp46Encoded (src/scripts/night-tiles.ts) for every code,
// with the 2016 ceiling: what a texel contributes on the display scale.
const TOP = 2.88;
const displayed = Float64Array.from({ length: 256 }, (_, code) => Math.min(1, code / 255 * TOP));
const nearest = value => {
  let low = 0, high = 255;
  while (low < high) { const mid = (low + high) >> 1; if (displayed[mid] < value) low = mid + 1; else high = mid; }
  return low > 0 && value - displayed[low - 1] < displayed[low] - value ? low - 1 : low;
};
// Exact area mean along one axis of a size x size image, to n samples.
const shrink = (image, width, height, n, horizontal) => {
  const length = horizontal ? width : height, out = new Float64Array(horizontal ? n * height : width * n);
  const integral = new Float64Array(length + 1);
  for (let line = 0; line < (horizontal ? height : width); line++) {
    for (let i = 0; i < length; i++) integral[i + 1] = integral[i] + image[horizontal ? line * width + i : i * width + line];
    const at = edge => { const i = Math.min(length - 1, Math.floor(edge)); return integral[i] + (edge - i) * (integral[i + 1] - integral[i]); };
    for (let k = 0; k < n; k++) {
      const value = (at((k + 1) * length / n) - at(k * length / n)) * n / length;
      out[horizontal ? line * n + k : k * width + line] = value;
    }
  }
  return out;
};
// Level 0 on the left; the right cell holds the 286, 143, 72 and 36 pixel
// levels side by side at its top, as the atlas stores them. Mips are area
// means of the displayed value with the 2016 ceiling, so a distant saturated
// core weighs what the overview gives it; nightRange=extended reads level 0 only.
const encode = pixels => {
  const image = Buffer.alloc(2 * cell * cell), level = Float64Array.from(pixels, code => displayed[code]);
  for (let y = 0; y < cell; y++) pixels.copy(image, y * 2 * cell, y * cell, (y + 1) * cell);
  let offset = cell;
  for (const size of [cell / 2, cell / 4, Math.ceil(cell / 8), Math.ceil(cell / 16)]) {
    const mip = shrink(shrink(level, cell, cell, size, true), size, cell, size, false);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) image[y * 2 * cell + offset + x] = nearest(mip[y * size + x]);
    offset += size;
  }
  return sharp(image, { raw: { width: 2 * cell, height: cell, channels: 1 } }).toColourspace('b-w')
    .avif({ quality: 80, effort: 4, chromaSubsampling: '4:4:4', bitdepth: 8 }).toBuffer();
};
const manifest = {
  version: 2, mipmaps: 'packed', width: 86400, height: 43200, interior, gutter, columns: 160, rows: 80, quality: 80,
  // code = 255 e / 2.88, e = 0.3572 ln(1 + (L/1.564)^4.567) / 4.567, L in nW cm^-2 sr^-1:
  // Black Marble 2016's display scale (1 at ~26 nW), unclamped up to ~5000 nW.
  encoding: { kind: 'displayed', top: TOP, transfer: { a: .3572, r0: 1.564, p: 4.567 }, units: 'nW/(cm^2 sr)' },
  tiles: [], bytes: 0, sources: [],
};
{
  sharp.concurrency(2);
  // Granule code rasters by row; a missing granule (open ocean) is dark.
  const rows = new Map();
  const load = async v => {
    if (!rows.has(v)) rows.set(v, await Promise.all(Array.from({ length: 36 }, (_, h) =>
      readFile(join(work, `h${String(h).padStart(2, '0')}v${String(v).padStart(2, '0')}-code.u8`)).catch(() => null))));
    return rows.get(v);
  };
  for (const file of (await readdir(work)).filter(f => /^h\d\dv\d\d\.json$/.test(f)).sort())
    manifest.sources.push(JSON.parse(await readFile(join(work, file), 'utf8')));
  const pending = [];
  for (let ty = 0; ty < 80; ty++) {
    const top = Math.max(0, ty * interior - gutter), bottom = Math.min(43199, ty * interior + interior + gutter - 1);
    for (const key of rows.keys()) if (key < Math.floor(top / N)) rows.delete(key);
    const band = [await load(Math.floor(top / N)), await load(Math.floor(bottom / N))];
    for (let tx = 0; tx < 160; tx++) {
      const pixels = Buffer.alloc(cell * cell);
      for (let y = 0; y < cell; y++) {
        const gy = Math.min(43199, Math.max(0, ty * interior + y - gutter)), v = Math.floor(gy / N);
        const granules = band[v === Math.floor(top / N) ? 0 : 1];
        for (let x = 0; x < cell; x++) {
          const gx = (tx * interior + x - gutter + 86400) % 86400, h = Math.floor(gx / N);
          const raster = granules[h];
          if (raster) pixels[y * cell + x] = raster[(gy - v * N) * N + gx - h * N];
        }
      }
      if (!pixels.some(value => value !== 0)) continue;
      const id = ty * 160 + tx;
      pending.push(encode(pixels).then(async encoded => {
        await writeFile(join(output, `${id}.avif`), encoded);
        manifest.tiles.push(id); manifest.bytes += encoded.length;
      }));
      if (pending.length >= 8) await Promise.all(pending.splice(0));
    }
    await Promise.all(pending.splice(0));
    console.log(`row ${ty}: ${manifest.tiles.length} tiles, ${(manifest.bytes / 1e6).toFixed(2)} MB`);
  }
  // The overview maps, encoded as scripts/build-earth-maps.mjs and build-scene-previews.mjs do.
  for (const [width, file] of [[8192, 'earth-night-8k.avif'], [4096, 'earth-night.avif'], [1024, 'preview-night.webp']]) {
    const image = sharp(await readFile(join(work, `overview-${width}.u8`)), { raw: { width, height: width / 2, channels: 1 } });
    await (file.endsWith('.webp') ? image.webp({ quality: 75, effort: 5 }) : image.avif({ quality: 65, effort: 4, chromaSubsampling: '4:4:4', bitdepth: 8 }))
      .toFile(join(output, file));
  }
}
manifest.tiles.sort((a, b) => a - b);
const emitted = new Set(manifest.tiles.map(id => `${id}.avif`));
for (const file of await readdir(output)) if (/^\d+\.avif$/.test(file) && !emitted.has(file)) await unlink(join(output, file));
{
  // 540 granule records are provenance, not something the renderer should fetch.
  const sources = JSON.stringify(manifest.sources, null, 1);
  await writeFile(join(output, 'sources.json'), sources);
  manifest.sources = { file: 'sources.json', tiles: manifest.sources.length,
    granules: manifest.sources.reduce((n, s) => n + s.granules.length, 0),
    sha256: createHash('sha256').update(sources).digest('hex') };
}
await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest));
console.log(`${manifest.tiles.length} tiles, ${manifest.bytes} bytes`);
