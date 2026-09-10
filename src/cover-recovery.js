import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, rename, readdir, stat, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import probe from 'probe-image-size';
import { downloadCover, prestigeCoverFallback } from './javdb.js';
import { findCoverAlternatives, isJavdbCover, normalizeCode } from './jav321.js';

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
  cacheRoot = join(tmpRoot, 'cover-cache'),
  maxCacheBytes = 64 * 1024 * 1024,
  download = downloadCover,
  alternatives = findCoverAlternatives,
} = {}) {
  const code = normalizeCode(result.code || result.detail?.code || '');
  if (!/^(?:FC2-PPV-\d+|[A-Z]+-?\d+)$/.test(code)) throw Error('Invalid cover product code');
  const cacheFile = join(cacheRoot, `${createHash('sha256').update(code).digest('hex')}.image`);
  const seen = new Set();
  const failures = [];
  const held = [];
  async function select(cover) {
    try { await saveCache(cacheFile, cover.bytes, maxCacheBytes); }
    catch (e) { console.warn('[cover-cache]', code, e.code || e.message); }
    const { bytes, ...selected } = cover;
    return selected;
  }
  async function attempt(url) {
    if (!url || seen.has(url) || isJavdbCover(url)) return null;
    seen.add(url);
    let cover;
    try {
      const parsed = new URL(url);
      if (!['https:', 'http:'].includes(parsed.protocol)) return null;
      cover = await download(url, tmpRoot, { timeoutSeconds: 8, officialFallback: false });
      const image = await readImage(cover.file);
      return { ...cover, ...image, source: cover.source || url };
    } catch (e) {
      failures.push(e);
      await cover?.cleanup?.();
      return null;
    }
  }

  // Keep the original selection first, regardless of cached fallback shape.
  const original = await attempt(result.cover);
  if (original) return select(original);

  try {
    try {
      const image = await readImage(cacheFile);
      const dir = await mkdtemp(join(tmpRoot, 'cached-cover-'));
      const file = join(dir, 'cover.jpg');
      try { await writeFile(file, image.bytes); }
      catch (e) { await rm(dir, { recursive: true, force: true }); throw e; }
      const cached = { file, ...image, source: 'cache', cleanup: () => rm(dir, { recursive: true, force: true }) };
      if (cached.width > cached.height) return select(cached);
      held.push(cached);
    } catch {}

    // Hold portrait/square art, but continue looking for a real landscape.
    try {
      for await (const url of alternatives(code)) {
        const cover = await attempt(url);
        if (!cover) continue;
        if (cover.width > cover.height) return select(cover);
        held.push(cover);
      }
    } catch (e) { failures.push(e); }

    // Only now use an existing portrait, or fetch official portrait art.
    if (held.length) return select(held.shift());
    const official = await attempt(prestigeCoverFallback(result.cover));
    if (official) return select(official);
    throw new AggregateError(failures, `No usable cover for ${code}`);
  } finally {
    await Promise.all(held.map(cover => cover.cleanup()));
  }
}
