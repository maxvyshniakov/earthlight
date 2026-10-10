import { execFileSync } from 'node:child_process';
import { realpath, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listSnapshotFiles, copySnapshot, binaryAssetTree } from './extraction-manifest.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function main() {
  const [sourceArgument, ref = 'HEAD', ...extra] = process.argv.slice(2);
  if (!sourceArgument || extra.length) throw new Error('Usage: bun run sync:site <site-dir> [ref]');
  const source = await realpath(sourceArgument);
  const target = await realpath(root);
  const sourceRoot = await realpath(execFileSync('git', ['-C', source, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim());
  if (sourceRoot === target) throw new Error('Refusing to sync a repository into itself');
  const dirty = execFileSync('git', ['-C', target, 'status', '--porcelain', '--untracked-files=all'], { encoding: 'utf8' });
  if (dirty.trim()) throw new Error('Earthlight must have a clean worktree before syncing (ignored assets are allowed).');
  const fullSHA = execFileSync('git', ['-C', sourceRoot, 'rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`], { encoding: 'utf8' }).trim();
  const snapshotPath = join(target, 'source-snapshot.json');
  const previous = JSON.parse(await readFile(snapshotPath, 'utf8'));
  if (previous.repository !== 'maxvyshniakov/personal-site') throw new Error('Unexpected source repository in source-snapshot.json');
  const oldFiles = listSnapshotFiles(sourceRoot, previous.commit);
  const nextFiles = listSnapshotFiles(sourceRoot, fullSHA);
  const nextPaths = new Set(nextFiles.map(file => file.path));
  const assetsChanged = binaryAssetTree(sourceRoot, previous.commit) !== binaryAssetTree(sourceRoot, fullSHA);
  await copySnapshot(sourceRoot, fullSHA, target);
  for (const { path } of oldFiles) if (!nextPaths.has(path)) await rm(join(target, path), { force: true });
  const next = { ...previous, commit: fullSHA, assets: { ...previous.assets, ...(assetsChanged ? { needsRefresh: true, sourceCommit: fullSHA } : {}) } };
  await writeFile(snapshotPath, `${JSON.stringify(next, null, 2)}\n`);
  const readmePath = join(target, 'README.md');
  const readme = await readFile(readmePath, 'utf8');
  await writeFile(readmePath, readme.replace(/personal-site@[a-f0-9]{7,40}\b/g, `personal-site@${fullSHA}`));
  console.log(`Synced committed source ${fullSHA}. Source worktree was not modified.`);
  if (assetsChanged) console.log('Assets changed: publish a new release archive and update its tag, file and SHA-256; remove assets.needsRefresh after publication.');
  execFileSync('git', ['-C', target, 'diff', '--stat'], { stdio: 'inherit' });
  execFileSync('git', ['-C', target, 'status', '--short'], { stdio: 'inherit' });
}

if (process.argv[1] && await realpath(resolve(process.argv[1])).catch(() => null) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
