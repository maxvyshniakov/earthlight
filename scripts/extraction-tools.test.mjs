import { test, afterEach } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { safeArchivePath, validateArchive, extractArchive, sha256File, isDownloadedAsset } from './fetch-assets.mjs';
import { isSelectedPath, sanitizeImportedText, copySnapshot, binaryAssetTree } from './extraction-manifest.mjs';

const scratchDirectories = [];
afterEach(async () => {
  await Promise.all(scratchDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

async function scratch() {
  const directory = await mkdtemp(join(tmpdir(), 'earthlight-tools-test-'));
  scratchDirectories.push(directory);
  return directory;
}

function tar(entries) {
  const blocks = [];
  for (const { name, type = '0', content = '' } of entries) {
    const body = Buffer.from(content);
    const header = Buffer.alloc(512);
    header.write(name, 0, 100);
    header.write('0000644\0', 100);
    header.write(`${body.length.toString(8).padStart(11, '0')}\0`, 124);
    header.fill(32, 148, 156);
    header.write(type, 156);
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148);
    blocks.push(header, body, Buffer.alloc((512 - body.length % 512) % 512));
  }
  return Buffer.concat([...blocks, Buffer.alloc(1024)]);
}

test('manifest includes scene dependencies and rejects site and generated files', () => {
  for (const path of ['src/scripts/runtime.ts', 'src/components/OrbitHud.astro', 'public/media/orbit/terrain/12.bin', 'scripts/scene-runtime.test.mjs']) assert.equal(isSelectedPath(path), true, path);
  for (const path of ['src/pages/index.astro', 'src/layouts/Base.astro', '.nvmrc', '.bun-version', 'bunfig.toml', 'bun.lock', 'bun.lockb', 'package.json', 'package-lock.json', 'docs/deployment.md', 'docs/orbital-sky.md', 'docs/evidence/example.json', 'scripts/fetch-assets.mjs', 'scripts/deploy-future.mjs', 'public/media/orbit/earth-clouds-8k.avif']) assert.equal(isSelectedPath(path), false, path);
});

test('old source commands become Bun commands without changing built-in imports or evidence data', () => {
  const source = "import fs from 'node:fs';\n// npm run verify:scene -- http://localhost:4321\n// npm ci && node --test scripts/a.test.mjs\n// npm install && node scripts/build.mjs\nconst node = tree.node;";
  const clean = sanitizeImportedText('scripts/example.mjs', source);
  assert.ok(clean.includes("import fs from 'node:fs'"));
  assert.ok(clean.includes('bun run verify:scene http://localhost:4321'));
  assert.ok(clean.includes('bun install --frozen-lockfile && bun test scripts/a.test.mjs'));
  assert.ok(clean.includes('bun install && bun scripts/build.mjs'));
  assert.ok(clean.includes('const node = tree.node;'));
  assert.equal(sanitizeImportedText('scripts/example.mjs', clean), clean);
  const evidence = '{"command":"npm run verify", "runtime":"Node 24.19.0"}';
  assert.equal(sanitizeImportedText('src/data/result.json', evidence), evidence);
  assert.equal(sanitizeImportedText('public/media/orbit/README.md', 'Requires Node 24'), 'Requires Bun');
  const benchmark = "import {stripTypeScriptTypes} from 'node:module';\nconst js=stripTypeScriptTypes(source);";
  assert.equal(sanitizeImportedText('scripts/benchmark-storm-light.mjs', benchmark), "const js=new Bun.Transpiler({loader:'ts'}).transformSync(source);");
});

test('sync retains Bun test mocks and timeout behavior when importing older Node tests', () => {
  const source = "import test from 'node:test';\nimport {SceneAssets} from '../src/scripts/scene-assets.ts';\ntest('timeout',async t=>{t.mock.method(globalThis,'fetch',async()=>{});t.mock.timers.enable({apis:['setTimeout']});t.mock.timers.tick(20);});";
  const clean = sanitizeImportedText('scripts/scene-assets-startup.test.mjs', source);
  assert.ok(clean.includes("from 'bun:test'"));
  assert.ok(clean.includes('afterEach(()=>{mock.restore();jest.useRealTimers();})'));
  assert.ok(clean.includes("spyOn(globalThis,'fetch').mockImplementation(async()=>{})"));
  assert.ok(clean.includes("jest.useFakeTimers({doNotFake:['setImmediate','nextTick','performance']});jest.advanceTimersByTime(20)"));
  assert.doesNotMatch(clean, /fakeTimeouts|FAKE_TIMEOUT_HELPER/);
  assert.doesNotMatch(clean, /node:test|t\.mock/);
  assert.equal(sanitizeImportedText('scripts/scene-assets-startup.test.mjs', clean), clean);
  const fixture = "import test from 'node:test';\nfunction fixture(t,{parallel=true}={}){t.after(()=>cleanup());}\ntest('shader',async t=>{fixture(t);});";
  const fixtureClean = sanitizeImportedText('scripts/shader-programs.test.mjs', fixture);
  assert.ok(fixtureClean.includes('cleanups.push(()=>cleanup())'));
  assert.ok(fixtureClean.includes('fixture()'));
  assert.equal(sanitizeImportedText('scripts/shader-programs.test.mjs', fixtureClean), fixtureClean);
});

test('privacy cleanup keeps media URLs and normalizes scene navigation', () => {
  assert.equal(sanitizeImportedText('scripts/verify-cloud-edges.mjs', '// See docs/orbital-cloud-edges-2026-10-10.md and docs/evidence/a.json; docs/orbital-sky.md'), '// See docs/lab/orbital-cloud-edges-2026-10-10.md and docs/lab/evidence/a.json; docs/orbital-sky.md');
  const script = "new URL('/orbit/?a=1',base); `${base}/orbit/?b=2`; '/media/orbit/a'; location.pathname==='/orbit/'";
  assert.equal(sanitizeImportedText('scripts/verify-scene.mjs', script), "new URL('/?a=1',base); `${base}/?b=2`; '/media/orbit/a'; location.pathname==='/'");
  const fixture = "const {targetInfos}=await send('Target.getTargets'); const page=targetInfos.find(target=>target.type==='page'&&target.url.includes('/orbit/'));";
  const fixtureClean = sanitizeImportedText('scripts/touch-browser-fixture.mjs', fixture);
  assert.ok(fixtureClean.includes("const sceneURL=(await run('get','url')).trim()"));
  assert.ok(fixtureClean.includes('target.url===sceneURL'));
  assert.equal(sanitizeImportedText('public/media/orbit/README.md', 'Copernicus WorldDEM-30'), 'Copernicus WorldDEM-90');
  assert.equal(sanitizeImportedText('public/media/orbit/README.md', 'The wallpaper renderer uses maps for the\ncomparison lab but no longer loaded by the site.'), 'The renderer uses maps for the\ncomparison lab in the original repository; Earthlight does not include them.');
});

test('archive paths reject absolute and parent traversal forms', () => {
  for (const name of ['/etc/passwd', '../outside', 'safe/../../outside', 'C:/outside', 'a\\..\\outside']) assert.throws(() => safeArchivePath(name), /Unsafe/);
  assert.equal(safeArchivePath('./cloud-tiles/1.avif'), 'cloud-tiles/1.avif');
});

test('archive validation rejects links and traversal before writing valid earlier entries', async () => {
  const directory = await scratch();
  const archive = join(directory, 'bad.tar');
  const output = join(directory, 'output');
  for (const bad of [{ name: '../outside' }, { name: 'link', type: '2' }, { name: 'hardlink', type: '1' }]) {
    await writeFile(archive, tar([{ name: 'first', content: 'safe' }, bad]));
    await assert.rejects(extractArchive(archive, output), /Unsafe|Unsupported/);
    await assert.rejects(readFile(join(output, 'first')), { code: 'ENOENT' });
  }
});

test('archive extraction verifies checksums and rejects existing destination symlinks', async () => {
  const directory = await scratch();
  const archive = join(directory, 'assets.tar');
  await writeFile(archive, tar([{ name: 'tiles/a.avif', content: 'example' }]));
  const output = join(directory, 'output');
  await extractArchive(archive, output);
  assert.equal(await readFile(join(output, 'tiles/a.avif'), 'utf8'), 'example');
  assert.match(await sha256File(archive), /^[a-f0-9]{64}$/);
  await rm(join(output, 'tiles'), { recursive: true });
  await mkdir(join(directory, 'outside'));
  await symlink(join(directory, 'outside'), join(output, 'tiles'));
  await assert.rejects(extractArchive(archive, output), /symlink/);
  const corrupt = tar([{ name: 'file', content: 'a' }]);
  corrupt[0] ^= 1;
  await writeFile(archive, corrupt);
  await assert.rejects(validateArchive(archive), /checksum/);
});

test('asset download preserves versioned notices while installing binary assets', async () => {
  const directory = await scratch();
  const archive = join(directory, 'assets.tar');
  const output = join(directory, 'output');
  await mkdir(output);
  await writeFile(join(output, 'README.md'), 'Current Bun instructions');
  await writeFile(join(output, 'LICENSE.txt'), 'Current data notice');
  await writeFile(archive, tar([
    { name: 'README.md', content: 'Old runtime instructions' },
    { name: 'LICENSE.txt', content: 'Old data notice' },
    { name: 'tiles/a.avif', content: 'image data' },
    { name: 'metadata.json', content: '{}' },
  ]));
  await extractArchive(archive, output, { select: isDownloadedAsset });
  assert.equal(await readFile(join(output, 'README.md'), 'utf8'), 'Current Bun instructions');
  assert.equal(await readFile(join(output, 'LICENSE.txt'), 'utf8'), 'Current data notice');
  assert.equal(await readFile(join(output, 'tiles/a.avif'), 'utf8'), 'image data');
  assert.equal(await readFile(join(output, 'metadata.json'), 'utf8'), '{}');
  assert.equal(isDownloadedAsset('nested/README.MD'), false);
});

test('snapshot import uses committed source and preserves owned wrapper files', async () => {
  const directory = await scratch();
  const source = join(directory, 'source');
  const target = join(directory, 'target');
  await mkdir(join(source, 'src/scripts'), { recursive: true });
  await mkdir(target);
  const git = args => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8' }).trim();
  git(['init', '-q']);
  await writeFile(join(source, 'src/scripts/scene.ts'), 'committed');
  await writeFile(join(source, 'package.json'), 'source package');
  await writeFile(join(source, '.bun-version'), 'source version');
  await writeFile(join(source, 'bunfig.toml'), 'source config');
  await writeFile(join(source, 'bun.lock'), 'source lock');
  git(['add', '.']);
  git(['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'fixture']);
  const commit = git(['rev-parse', 'HEAD']);
  await writeFile(join(source, 'src/scripts/scene.ts'), 'uncommitted');
  await writeFile(join(target, 'package.json'), 'owned package');
  await writeFile(join(target, '.bun-version'), 'owned version');
  await writeFile(join(target, 'bunfig.toml'), 'owned config');
  await writeFile(join(target, 'bun.lock'), 'owned lock');
  await copySnapshot(source, commit, target);
  assert.equal(await readFile(join(target, 'src/scripts/scene.ts'), 'utf8'), 'committed');
  assert.equal(await readFile(join(source, 'src/scripts/scene.ts'), 'utf8'), 'uncommitted');
  assert.equal(await readFile(join(target, 'package.json'), 'utf8'), 'owned package');
  assert.equal(await readFile(join(target, '.bun-version'), 'utf8'), 'owned version');
  assert.equal(await readFile(join(target, 'bunfig.toml'), 'utf8'), 'owned config');
  assert.equal(await readFile(join(target, 'bun.lock'), 'utf8'), 'owned lock');
});

test('asset fingerprint ignores versioned README changes and detects binary changes', async () => {
  const directory = await scratch();
  await mkdir(join(directory, 'public/media/orbit'), { recursive: true });
  const git = args => execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8' }).trim();
  const commit = () => {
    git(['add', '-A']);
    git(['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'asset fixture']);
    return git(['rev-parse', 'HEAD']);
  };
  git(['init', '-q']);
  await writeFile(join(directory, 'public/media/orbit/README.md'), 'Original commands');
  await writeFile(join(directory, 'public/media/orbit/image.avif'), 'image one');
  const original = binaryAssetTree(directory, commit());
  await writeFile(join(directory, 'public/media/orbit/README.md'), 'Bun commands');
  assert.equal(binaryAssetTree(directory, commit()), original);
  await writeFile(join(directory, 'public/media/orbit/image.avif'), 'image two');
  assert.notEqual(binaryAssetTree(directory, commit()), original);
});

test('retired sync cannot overwrite Earthlight from a consumer', () => {
  assert.throws(() => execFileSync(process.execPath, [new URL('./sync-from-site.mjs', import.meta.url).pathname, '/unused'], {stdio:'pipe'}), /Earthlight is now the scene source/);
});
