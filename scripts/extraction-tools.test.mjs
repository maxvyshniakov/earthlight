import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, mkdir, symlink, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { safeArchivePath, validateArchive, extractArchive, sha256File } from './fetch-assets.mjs';
import { isSelectedPath, sanitizeImportedText, copySnapshot } from './extraction-manifest.mjs';

async function scratch(t) {
  const directory = await mkdtemp(join(tmpdir(), 'earthlight-tools-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
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
  for (const path of ['src/scripts/runtime.ts', 'src/components/OrbitHud.astro', 'docs/evidence/example.json', 'public/media/orbit/terrain/12.bin', 'scripts/scene-runtime.test.mjs']) assert.equal(isSelectedPath(path), true, path);
  for (const path of ['src/pages/index.astro', 'src/layouts/Base.astro', 'package.json', 'package-lock.json', 'docs/deployment.md', 'scripts/fetch-assets.mjs', 'scripts/deploy-future.mjs', 'public/media/orbit/earth-clouds-8k.avif']) assert.equal(isSelectedPath(path), false, path);
});

test('privacy cleanup keeps media URLs and normalizes scene navigation', () => {
  const documentation = 'https://dev.maxvyshniakov.com/orbit/?motion=0 Cloudflare Access /media/orbit/dem90/a /Users/alice/private/evidence';
  const clean = sanitizeImportedText('docs/orbital-performance.md', documentation);
  assert.ok(clean.includes('http://localhost:4321/?motion=0'));
  assert.ok(clean.includes('/media/orbit/dem90/a'));
  assert.doesNotMatch(clean, /maxvyshniakov\.com|Cloudflare|\/Users\//);
  const script = "new URL('/orbit/?a=1',base); `${base}/orbit/?b=2`; '/media/orbit/a'; location.pathname==='/orbit/'";
  assert.equal(sanitizeImportedText('scripts/verify-scene.mjs', script), "new URL('/?a=1',base); `${base}/?b=2`; '/media/orbit/a'; location.pathname==='/'");
  const fixture = "const {targetInfos}=await send('Target.getTargets'); const page=targetInfos.find(target=>target.type==='page'&&target.url.includes('/orbit/'));";
  const fixtureClean = sanitizeImportedText('scripts/touch-browser-fixture.mjs', fixture);
  assert.ok(fixtureClean.includes("const sceneURL=(await run('get','url')).trim()"));
  assert.ok(fixtureClean.includes('target.url===sceneURL'));
  assert.equal(sanitizeImportedText('public/media/orbit/README.md', 'Copernicus WorldDEM-30'), 'Copernicus WorldDEM-90');
  assert.equal(sanitizeImportedText('docs/orbital-sky.md', 'Copernicus WorldDEM-30'), 'Copernicus WorldDEM-30');
});

test('archive paths reject absolute and parent traversal forms', () => {
  for (const name of ['/etc/passwd', '../outside', 'safe/../../outside', 'C:/outside', 'a\\..\\outside']) assert.throws(() => safeArchivePath(name), /Unsafe/);
  assert.equal(safeArchivePath('./cloud-tiles/1.avif'), 'cloud-tiles/1.avif');
});

test('archive validation rejects links and traversal before writing valid earlier entries', async t => {
  const directory = await scratch(t);
  const archive = join(directory, 'bad.tar');
  const output = join(directory, 'output');
  for (const bad of [{ name: '../outside' }, { name: 'link', type: '2' }, { name: 'hardlink', type: '1' }]) {
    await writeFile(archive, tar([{ name: 'first', content: 'safe' }, bad]));
    await assert.rejects(extractArchive(archive, output), /Unsafe|Unsupported/);
    await assert.rejects(readFile(join(output, 'first')), { code: 'ENOENT' });
  }
});

test('archive extraction verifies checksums and rejects existing destination symlinks', async t => {
  const directory = await scratch(t);
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

test('snapshot import uses committed source and preserves owned wrapper files', async t => {
  const directory = await scratch(t);
  const source = join(directory, 'source');
  const target = join(directory, 'target');
  await mkdir(join(source, 'src/scripts'), { recursive: true });
  await mkdir(target);
  const git = args => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8' }).trim();
  git(['init', '-q']);
  await writeFile(join(source, 'src/scripts/scene.ts'), 'committed');
  await writeFile(join(source, 'package.json'), 'source package');
  git(['add', '.']);
  git(['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'fixture']);
  const commit = git(['rev-parse', 'HEAD']);
  await writeFile(join(source, 'src/scripts/scene.ts'), 'uncommitted');
  await writeFile(join(target, 'package.json'), 'owned package');
  await copySnapshot(source, commit, target);
  assert.equal(await readFile(join(target, 'src/scripts/scene.ts'), 'utf8'), 'committed');
  assert.equal(await readFile(join(source, 'src/scripts/scene.ts'), 'utf8'), 'uncommitted');
  assert.equal(await readFile(join(target, 'package.json'), 'utf8'), 'owned package');
});

test('sync rejects dirty targets, records a fixed commit, removes old files and flags changed assets', async t => {
  const directory = await scratch(t);
  const source = join(directory, 'source');
  const target = join(directory, 'target');
  const git = (cwd, args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
  const commit = (cwd, message) => {
    git(cwd, ['add', '-A']);
    git(cwd, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', message]);
    return git(cwd, ['rev-parse', 'HEAD']);
  };
  await mkdir(join(source, 'src/scripts'), { recursive: true });
  await mkdir(join(source, 'public/media/orbit'), { recursive: true });
  await mkdir(join(target, 'scripts'), { recursive: true });
  git(source, ['init', '-q']);
  git(target, ['init', '-q']);
  await writeFile(join(source, 'src/scripts/old.ts'), 'old');
  await writeFile(join(source, 'public/media/orbit/example.bin'), 'old asset');
  const original = commit(source, 'original');
  await copySnapshot(source, original, target);
  for (const name of ['fetch-assets.mjs', 'sync-from-site.mjs', 'extraction-manifest.mjs']) await copyFile(new URL(name, import.meta.url), join(target, 'scripts', name));
  await writeFile(join(target, '.gitignore'), 'public/media/orbit/**\n');
  await writeFile(join(target, 'README.md'), `Source: \`personal-site@${original}\`\n`);
  await writeFile(join(target, 'source-snapshot.json'), JSON.stringify({ repository: 'maxvyshniakov/personal-site', commit: original, assets: { tag: 'assets-aaaaaaaaaaaa', file: 'earthlight-assets-aaaaaaaaaaaa.tar', sha256: 'a'.repeat(64) } }));
  commit(target, 'extracted');
  await rm(join(source, 'src/scripts/old.ts'));
  await writeFile(join(source, 'src/scripts/new.ts'), 'new committed');
  await writeFile(join(source, 'public/media/orbit/example.bin'), 'new asset');
  const next = commit(source, 'next');
  await writeFile(join(source, 'src/scripts/new.ts'), 'uncommitted source work');
  await writeFile(join(target, 'dirty.txt'), 'keep me');
  const sync = () => execFileSync(process.execPath, [join(target, 'scripts/sync-from-site.mjs'), source], { encoding: 'utf8', stdio: 'pipe' });
  assert.throws(sync, /clean worktree/);
  assert.equal(await readFile(join(target, 'src/scripts/old.ts'), 'utf8'), 'old');
  await rm(join(target, 'dirty.txt'));
  sync();
  const snapshot = JSON.parse(await readFile(join(target, 'source-snapshot.json'), 'utf8'));
  assert.equal(snapshot.commit, next);
  assert.equal(snapshot.assets.needsRefresh, true);
  assert.equal(snapshot.assets.tag, 'assets-aaaaaaaaaaaa');
  assert.equal(snapshot.assets.sourceCommit, next);
  assert.equal(await readFile(join(target, 'README.md'), 'utf8'), `Source: \`personal-site@${next}\`\n`);
  assert.equal(await readFile(join(target, 'src/scripts/new.ts'), 'utf8'), 'new committed');
  await assert.rejects(readFile(join(target, 'src/scripts/old.ts')), { code: 'ENOENT' });
  assert.equal(await readFile(join(source, 'src/scripts/new.ts'), 'utf8'), 'uncommitted source work');
});
