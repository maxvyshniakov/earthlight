// Lab, nightDetail=vnp46: regional night tiles from NASA Black Marble VNP46A4 /
// VJ146A4 Collection 2 (see docs/lab/night-vnp46-2026-10-17.md).
// uv run scripts/vnp46-composite.py <h5-dir> <work> <hXXvYY>...  writes <work>/<tile>-code.u8
// bun scripts/build-night-vnp46.mjs <work> <hXXvYY>...
// bun scripts/build-night-vnp46.mjs --black-marble <work> <hXXvYY>...  cuts the
// shipped Black Marble 2016 tiles to the same windows for vnp46-measure.py.
// Only tiles whose 572 px cell, gutters included, lies inside a source tile are
// written; elsewhere the renderer keeps the global overview.
import sharp from 'sharp';
import { mkdir, readFile, writeFile, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';

const blackMarble = process.argv[2] === '--black-marble';
const [work, ...regions] = process.argv.slice(blackMarble ? 3 : 2);
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
const manifest = {
  version: 1, width: 86400, height: 43200, interior, gutter, columns: 160, rows: 80, quality: 80,
  // code = 255 ln(1 + L/0.25) / ln(1 + 5000/0.25), L in nW cm^-2 sr^-1.
  encoding: { kind: 'log', scale: .25, top: 5000, units: 'nW/(cm^2 sr)' },
  tiles: [], bytes: 0, sources: [],
};
for (const region of regions) {
  const [X0, Y0] = origin(region);
  const code = await readFile(join(work, `${region}-code.u8`));
  manifest.sources.push(JSON.parse(await readFile(join(work, `${region}.json`), 'utf8')));
  for (let ty = Math.ceil((Y0 + gutter) / interior); (ty + 1) * interior + gutter <= Y0 + N; ty++)
    for (let tx = Math.ceil((X0 + gutter) / interior); (tx + 1) * interior + gutter <= X0 + N; tx++) {
      const pixels = Buffer.alloc(cell * cell);
      for (let y = 0; y < cell; y++) {
        const row = ty * interior + y - gutter - Y0, left = tx * interior - gutter - X0;
        code.copy(pixels, y * cell, row * N + left, row * N + left + cell);
      }
      if (!pixels.some(value => value !== 0)) continue;
      const id = ty * 160 + tx;
      const encoded = await sharp(pixels, { raw: { width: cell, height: cell, channels: 1 } }).toColourspace('b-w')
        .avif({ quality: 80, effort: 4, chromaSubsampling: '4:4:4', bitdepth: 8 }).toBuffer();
      await writeFile(join(output, `${id}.avif`), encoded);
      manifest.tiles.push(id); manifest.bytes += encoded.length;
    }
}
manifest.tiles.sort((a, b) => a - b);
const emitted = new Set(manifest.tiles.map(id => `${id}.avif`));
for (const file of await readdir(output)) if (/^\d+\.avif$/.test(file) && !emitted.has(file)) await unlink(join(output, file));
await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest));
console.log(`${manifest.tiles.length} tiles, ${manifest.bytes} bytes: ${manifest.tiles.join(' ')}`);
