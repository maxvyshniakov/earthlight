import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, mkdir, mkdtemp, readFile, rm, lstat, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname, join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function safeArchivePath(name) {
  if (name.includes('\\') || name.includes('\0') || isAbsolute(name) || /^[a-z]:/i.test(name)) throw new Error(`Unsafe archive path: ${name}`);
  const parts = name.split('/').filter(part => part && part !== '.');
  if (parts.includes('..')) throw new Error(`Unsafe archive path: ${name}`);
  return parts.join('/');
}

function field(block, offset, size) {
  return block.subarray(offset, offset + size).toString('utf8').replace(/\0.*$/s, '');
}

function number(block, offset, size) {
  const value = field(block, offset, size).trim();
  if (value && !/^[0-7]+$/.test(value)) throw new Error('Unsupported tar number');
  const result = parseInt(value || '0', 8);
  if (!Number.isSafeInteger(result)) throw new Error('Tar entry is too large');
  return result;
}

function paxFields(buffer) {
  const fields = {};
  for (let position = 0; position < buffer.length;) {
    const space = buffer.indexOf(32, position);
    if (space === -1) throw new Error('Invalid PAX record');
    const size = Number(buffer.subarray(position, space).toString());
    if (!Number.isSafeInteger(size) || size <= space - position + 1 || position + size > buffer.length) throw new Error('Invalid PAX size');
    const record = buffer.subarray(space + 1, position + size - 1).toString('utf8');
    const equal = record.indexOf('=');
    if (equal === -1 || buffer[position + size - 1] !== 10) throw new Error('Invalid PAX record');
    fields[record.slice(0, equal)] = record.slice(equal + 1);
    position += size;
  }
  return fields;
}

// Validate every entry before writing anything. Links and special files are never accepted.
export async function validateArchive(archive, { select = () => true } = {}) {
  const handle = await open(archive, 'r');
  const entries = [];
  const seen = new Set();
  let extended = {};
  try {
    const total = (await handle.stat()).size;
    let offset = 0;
    let terminated = false;
    while (offset + 512 <= total) {
      const block = Buffer.alloc(512);
      await handle.read(block, 0, 512, offset);
      if (block.every(byte => byte === 0)) { terminated = true; break; }
      const checksum = number(block, 148, 8);
      const actual = block.reduce((sum, byte, i) => sum + (i >= 148 && i < 156 ? 32 : byte), 0);
      if (checksum !== actual) throw new Error('Invalid tar header checksum');
      const size = number(block, 124, 12);
      const type = field(block, 156, 1) || '0';
      const prefix = field(block, 345, 155);
      const rawName = field(block, 0, 100);
      const headerName = prefix ? `${prefix}/${rawName}` : rawName;
      const contentOffset = offset + 512;
      offset = contentOffset + Math.ceil(size / 512) * 512;
      if (offset > total) throw new Error('Truncated tar entry');
      if (type === 'x' || type === 'g') {
        if (size > 1024 * 1024) throw new Error('PAX record is too large');
        const buffer = Buffer.alloc(size);
        await handle.read(buffer, 0, size, contentOffset);
        const metadata = paxFields(buffer);
        if ('linkpath' in metadata || 'size' in metadata || Object.keys(metadata).some(key => /sparse/i.test(key))) throw new Error('Unsupported PAX entry');
        if (type === 'g' && 'path' in metadata) throw new Error('Global PAX path is unsupported');
        if (type === 'x') extended = metadata;
        continue;
      }
      const name = safeArchivePath(extended.path ?? headerName);
      extended = {};
      if (!['0', '5'].includes(type)) throw new Error(`Unsupported archive entry type ${type}: ${name}`);
      if (type === '5' && size) throw new Error('Tar directory has content');
      if (!name) { if (type !== '5') throw new Error('Empty archive file path'); continue; }
      if (seen.has(name)) throw new Error(`Duplicate archive entry: ${name}`);
      seen.add(name);
      if (select(name)) entries.push({ name, size, type, offset: contentOffset, mode: number(block, 100, 8) });
    }
    if (!terminated) throw new Error('Tar archive has no end marker');
    const files = new Set(entries.filter(entry => entry.type === '0').map(entry => entry.name));
    for (const entry of entries) {
      const parts = entry.name.split('/');
      parts.pop();
      while (parts.length) {
        if (files.has(parts.join('/'))) throw new Error(`File is an archive parent: ${entry.name}`);
        parts.pop();
      }
    }
    return entries;
  } finally { await handle.close(); }
}

async function ensureSafeDestination(destination, name, directory) {
  await mkdir(destination, { recursive: true });
  const parts = name.split('/');
  let current = destination;
  for (let i = 0; i < parts.length; i++) {
    current = join(current, parts[i]);
    let stat;
    try { stat = await lstat(current); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (stat?.isSymbolicLink()) throw new Error(`Refusing existing symlink: ${current}`);
    const needsDirectory = i < parts.length - 1 || directory;
    if (stat && (needsDirectory ? !stat.isDirectory() : !stat.isFile())) throw new Error(`Unexpected destination type: ${current}`);
    if (!stat && needsDirectory) await mkdir(current);
  }
}

export async function extractArchive(archive, destination, options = {}) {
  const entries = await validateArchive(archive, options);
  await mkdir(destination, { recursive: true });
  if ((await lstat(destination)).isSymbolicLink()) throw new Error('Refusing a symlink as extraction destination');
  // Canonicalize the trusted root (macOS /var itself is a system symlink).
  destination = await realpath(destination);
  for (const entry of entries) await ensureSafeDestination(destination, entry.name, entry.type === '5');
  const input = await open(archive, 'r');
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    for (const entry of entries) {
      if (entry.type === '5') continue;
      const output = await open(join(destination, entry.name), 'w', entry.mode & 0o111 ? 0o755 : 0o644);
      try {
        let copied = 0;
        while (copied < entry.size) {
          const { bytesRead } = await input.read(buffer, 0, Math.min(buffer.length, entry.size - copied), entry.offset + copied);
          if (!bytesRead) throw new Error('Truncated archive content');
          await output.writeFile(buffer.subarray(0, bytesRead));
          copied += bytesRead;
        }
      } finally { await output.close(); }
    }
  } finally { await input.close(); }
  return entries;
}

export async function sha256File(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export async function fetchAssets() {
  const { assets } = JSON.parse(await readFile(join(root, 'source-snapshot.json'), 'utf8'));
  if (assets?.needsRefresh) throw new Error('Source assets changed. Publish a matching archive and update source-snapshot.json first.');
  if (!assets || !/^[a-f0-9]{64}$/.test(assets.sha256) || !/^assets-[a-f0-9]{12,40}$/.test(assets.tag) || !/^earthlight-assets-[a-f0-9]{12,40}\.tar$/.test(assets.file)) throw new Error('Missing or invalid pinned asset release metadata');
  const scratch = await mkdtemp(join(tmpdir(), 'earthlight-assets-'));
  try {
    execFileSync('gh', ['release', 'download', assets.tag, '--repo', 'maxvyshniakov/earthlight', '--pattern', assets.file, '--dir', scratch], { stdio: 'inherit' });
    const archive = join(scratch, assets.file);
    if (await sha256File(archive) !== assets.sha256) throw new Error('Asset archive SHA-256 does not match source-snapshot.json');
    const entries = await extractArchive(archive, join(root, 'public/media/orbit'));
    console.log(`Installed ${entries.filter(entry => entry.type === '0').length} asset files from ${assets.tag}.`);
  } finally { await rm(scratch, { recursive: true, force: true }); }
}

if (process.argv[1] && await realpath(resolve(process.argv[1])).catch(() => null) === fileURLToPath(import.meta.url)) {
  fetchAssets().catch(error => { console.error(error.message); process.exitCode = 1; });
}
