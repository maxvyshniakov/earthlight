import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { extractArchive } from './fetch-assets.mjs';

const excludedScripts = new Set([
  'check-cloudflare-access.mjs', 'with-cloudflare.mjs', 'configure-storybook-access.mjs',
  'deploy-storybook.mjs', 'prepare-storybook.mjs', 'github-package-urls.mjs', 'github-package-urls.test.mjs',
  'extraction-manifest.mjs', 'sync-from-site.mjs', 'fetch-assets.mjs', 'extraction-tools.test.mjs',
]);
const singleFiles = new Set([
  'src/data/iss-orbit.json', 'src/data/optical-psf.json',
  'src/components/OrbitalSky.astro', 'src/components/OrbitHud.astro', 'src/components/SkyCredits.astro',
  'server/terrain-source.mjs', 'server/terrain-middleware.mjs', '.nvmrc', 'tsconfig.json',
]);
const legacyTextures = new Set(['earth-day.avif', 'earth-day-8k.avif', 'earth-clouds.avif', 'earth-clouds-8k.avif']);

export function isSelectedPath(path) {
  if (singleFiles.has(path) || path.startsWith('src/scripts/')) return true;
  if (path.startsWith('scripts/')) return !excludedScripts.has(path.slice(8)) && !/(?:cloudflare|storybook|github-package|^deploy[-.])/i.test(path.slice(8));
  if (path.startsWith('public/media/orbit/')) return !legacyTextures.has(path.slice('public/media/orbit/'.length));
  return path.startsWith('docs/evidence/') || /^docs\/(?:earth-surface-rendering|night-lights-[^/]+|orbital-[^/]+|scene-optimization)\.md$/.test(path);
}

export function sanitizeImportedText(path, text) {
  if (path === 'public/media/orbit/README.md') text = text.replaceAll('Copernicus WorldDEM-30', 'Copernicus WorldDEM-90');
  if (path.startsWith('docs/')) {
    text = text.replace(/https?:\/\/(?:dev\.)?maxvyshniakov\.com/g, 'http://localhost:4321')
      .replace(/(?<!\/media)\/orbit\//g, '/')
      .replace(/Cloudflare Access/g, 'the deployment access gate')
      .replace(/Cloudflare\s+Workers?/g, 'production proxy')
      .replace(/Cloudflare/g, 'the production platform')
      .replace(/\/Users\/[^/\s"'`]+\/[^\s"'`]+/g, '[local artifact directory]');
  }
  if (path.startsWith('scripts/')) {
    if (path === 'scripts/flight-browser-fixture.mjs') {
      // Earthlight's root is the standalone scene, so its route control exists.
      // Keep checking that a wheel event outside the scene is not intercepted.
      text = text.replace('const home=await evaluate(', 'const outsideScene=await evaluate(')
        .replace('assert.deepEqual(home,{route:false,prevented:false});', 'assert.deepEqual(outsideScene,{route:true,prevented:false});');
    }
    if (text.includes("target.url.includes('/orbit/')")) {
      text = text.replace("const {targetInfos}=await send('Target.getTargets');", "const sceneURL=(await run('get','url')).trim();\n const {targetInfos}=await send('Target.getTargets');")
        .replaceAll("target.url.includes('/orbit/')", 'target.url===sceneURL');
    }
    text = text.replaceAll('${base}/orbit/', '${base}/')
      .replace(/(["'`])\/orbit\//g, '$1/');
  }
  return text;
}

export function listSnapshotFiles(sourceDir, fullSHA) {
  if (!/^[a-f0-9]{40}$/.test(fullSHA)) throw new Error('A full source commit SHA is required');
  const output = execFileSync('git', ['-C', sourceDir, 'ls-tree', '-r', '-z', fullSHA], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  return output.split('\0').filter(Boolean).map(line => {
    const [metadata, path] = line.split('\t');
    const [mode, type, oid] = metadata.split(' ');
    return { path, mode, type, oid };
  }).filter(entry => isSelectedPath(entry.path));
}

export function binaryAssetTree(sourceDir, fullSHA) {
  const entries = listSnapshotFiles(sourceDir, fullSHA).filter(entry => entry.path.startsWith('public/media/orbit/'));
  return createHash('sha256').update(entries.map(entry => `${entry.path}\0${entry.oid}\n`).join('')).digest('hex');
}

export async function copySnapshot(sourceDir, fullSHA, targetDir) {
  const files = listSnapshotFiles(sourceDir, fullSHA);
  if (files.some(file => file.type !== 'blob' || !['100644', '100755'].includes(file.mode))) throw new Error('Source snapshot contains an unsupported link or special file');
  const selected = new Set(files.map(file => file.path));
  const scratch = await mkdtemp(join(tmpdir(), 'earthlight-snapshot-'));
  try {
    const archive = join(scratch, 'source.tar');
    const roots = [...new Set(files.map(file => file.path.split('/')[0]))];
    execFileSync('git', ['-C', sourceDir, 'archive', '--format=tar', `--output=${archive}`, fullSHA, '--', ...roots], { stdio: 'pipe' });
    await extractArchive(archive, targetDir, { select: path => selected.has(path) });
    for (const { path } of files) {
      if (!path.startsWith('docs/') && !path.startsWith('scripts/') && path !== 'public/media/orbit/README.md') continue;
      if (!/\.(?:md|json|mjs|js|ts|py|txt)$/.test(path)) continue;
      const destination = join(targetDir, path);
      const original = await readFile(destination, 'utf8');
      const clean = sanitizeImportedText(path, original);
      if (clean !== original) await writeFile(destination, clean);
    }
    return files;
  } finally { await rm(scratch, { recursive: true, force: true }); }
}
