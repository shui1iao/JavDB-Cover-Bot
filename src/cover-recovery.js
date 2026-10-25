import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, rename, readdir, stat, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import probe from 'probe-image-size';
import { isJavdbCover, normalizeCode } from './jav321.js';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

async function readImage(file) {
  const info = await stat(file);
  if (!info.isFile() || info.size < 32 || info.size > MAX_IMAGE_BYTES) throw Error('Invalid cover size');
  const bytes = await readFile(file);
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const webp = bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!jpeg && !png && !webp) throw Error('Invalid cover image (possibly an HTML challenge)');
  const { width, height } = probe.sync(bytes) || {};
  if (!(width > 0 && height > 0)) throw Error('Invalid cover dimensions');
  return { bytes, width, height };
}

async function saveCache(file, bytes, maxBytes) {
  const root = dirname(file);
  await mkdir(root, { recursive: true });
  const dir = await mkdtemp(join(root, '.write-'));
  try {
    const staging = join(dir, 'image');
    await writeFile(staging, bytes, { mode: 0o600 });
    await rename(staging, file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  // Bound this dedicated cache, never touch metadata or unrelated files.
  const entries = [];
  for (const name of await readdir(root)) {
    if (!/^[a-f0-9]{64}\.image$/.test(name)) continue;
    const path = join(root, name);
    try { const info = await stat(path); entries.push({ path, size: info.size, time: info.mtimeMs }); } catch {}
  }
  entries.sort((a, b) => a.time - b.time);
  let total = entries.reduce((sum, e) => sum + e.size, 0);
  for (const entry of entries) {
    if (total <= maxBytes) break;
    await rm(entry.path, { force: true });
    total -= entry.size;
  }
}

export async function recoverCover(result, tmpRoot = tmpdir(), {
  cacheRoot = join(tmpRoot, 'cover-cache'), maxCacheBytes = 64 * 1024 * 1024,
} = {}) {
  const code = normalizeCode(result.code || result.detail?.code || '');
  if (!/^(?:FC2-PPV-\d+|\d*[A-Z]+-?\d+)$/.test(code)) throw Error('Invalid cover product code');
  const cacheFile = join(cacheRoot, `${createHash('sha256').update(code).digest('hex')}.image`);
  const cover = result.publicMetadata?.cover;
  await mkdir(tmpRoot, { recursive: true });
  const dir = await mkdtemp(join(tmpRoot, 'shared-cover-'));
  const file = join(dir, 'cover.image');
  try {
    if (cover && !isJavdbCover(cover.url)) {
      const bytes = Buffer.from(cover.data, 'base64');
      if (createHash('sha256').update(bytes).digest('hex') !== cover.sha256) throw Error('Cover digest mismatch');
      await writeFile(file, bytes, { mode: 0o600 });
      const image = await readImage(file);
      if (image.width !== cover.size[0] || image.height !== cover.size[1]) throw Error('Cover dimensions mismatch');
      try { await saveCache(cacheFile, bytes, maxCacheBytes); }
      catch (error) { console.warn('[cover-cache]', code, error.code || error.message); }
    } else {
      const image = await readImage(cacheFile);
      await writeFile(file, image.bytes, { mode: 0o600 });
    }
    return { file, source: cover?.url || 'cache', cleanup: () => rm(dir, { recursive: true, force: true }) };
  } catch (error) { await rm(dir, { recursive: true, force: true }); throw error; }
}
