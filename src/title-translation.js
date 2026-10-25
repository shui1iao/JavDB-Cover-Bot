import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, rename, readdir, stat, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import * as OpenCC from 'opencc-js';

const exec = promisify(execFile);
const zh = OpenCC.Converter({ from: 'tw', to: 'cn' });
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const MAX_TEXT = 6000;
const hasKana = text => /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text.normalize('NFKC'));
const isChinese = text => /\p{Script=Han}/u.test(text) && !hasKana(text);
const isRefusal = text => /(?:无法|不能|不便|不予)(?:为你|为您)?(?:协助|帮助|提供|翻译|处理|生成)|(?:无法|不能).{0,30}(?:内容|请求)|\b(?:I cannot|I can't|I'm sorry)\b/i.test(text);
const validNames = names => [...new Set((Array.isArray(names) ? names : []).filter(name => typeof name === 'string' && name.length >= 2 && name.length <= 40 && /^[\p{L}\p{M} ・·.]+$/u.test(name)).flatMap(name => [name, zh(name)]))].sort();
const withoutNames = (text, names) => names.reduce((body, name) => body.split(name).join(''), text);
const usable = (text, names = []) => typeof text === 'string' && text.trim().length > 0 && text.length <= MAX_TEXT && isChinese(withoutNames(text, names)) && !isRefusal(text);

export async function requestGoogleTranslation(text, language = 'ja', { exec: run = exec } = {}) {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${language}&tl=zh-CN&dt=t&q=${encodeURIComponent(text)}`;
  try {
    const { stdout } = await run('curl', ['-fsSL', '--compressed', '--connect-timeout', '4', '--max-time', '12', '-A', UA, '-H', 'Accept: application/json,text/plain,*/*', url], { maxBuffer: 1024 * 1024 });
    const data = JSON.parse(stdout);
    return (data?.[0] || []).map(part => part?.[0] || '').join('').trim();
  } catch (error) {
    const status = Number(String(error.stderr || '').match(/error: (\d+)/)?.[1]) || undefined;
    throw Object.assign(new Error(status ? `Google HTTP ${status}` : 'Google translation unavailable'), { status });
  }
}

// Public Bing web translation: only page-issued short-lived tokens are sent.
// Endpoints are fixed; no user API key or configurable provider is supported.
export async function requestFallbackTranslation(text, { language = hasKana(text) ? 'ja' : 'auto', names = [], fetchImpl = fetch, timeoutMs = 12000 } = {}) {
  const pageUrl = 'https://www.bing.com/translator';
  const headers = { 'User-Agent': UA };
  const page = await fetchImpl(pageUrl, {
    headers, redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
  });
  if (!page.ok) throw Error(`Bing page HTTP ${page.status}`);
  const html = await page.text();
  const ig = html.match(/IG:"([^"]+)"/)?.[1];
  const iid = html.match(/data-iid="([^"]+)"/)?.[1];
  const params = html.match(/params_AbusePreventionHelper\s*=\s*(\[[^\]]+\])/);
  if (!ig || !iid || !params) throw Error('Bing translation metadata unavailable');
  const [key, token] = JSON.parse(params[1]);
  if (!Number.isSafeInteger(key) || key <= 0 || typeof token !== 'string' || !token || token.length > 4096) {
    throw Error('Invalid Bing translation metadata');
  }
  const endpoint = new URL('https://www.bing.com/ttranslatev3');
  endpoint.search = new URLSearchParams({ isVertical: '1', IG: ig, IID: iid }).toString();
  const response = await fetchImpl(endpoint.href, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
    headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded', Referer: pageUrl },
    body: new URLSearchParams({ fromLang: language === 'auto' ? 'auto-detect' : language, to: 'zh-Hans', text, key: String(key), token }).toString(),
  });
  if (!response.ok) throw Error(`Bing translation HTTP ${response.status}`);
  const data = await response.json();
  const result = data?.[0]?.translations?.find(item => item.to === 'zh-Hans')?.text;
  if (!usable(result, validNames(names))) throw Error('Bing returned no usable Chinese title');
  return zh(result.trim());
}

export function createTitleTranslator({ cacheRoot, primary = requestGoogleTranslation, fallback, now = Date.now, cooldownMs = 300000, maxEntries = 2000, maxCacheBytes = 8 * 1024 * 1024, warn = console.warn } = {}) {
  const memory = new Map();
  const inFlight = new Map();
  let googleBlockedUntil = 0;

  function remember(key, translation) {
    memory.delete(key);
    memory.set(key, translation);
    while (memory.size > maxEntries) memory.delete(memory.keys().next().value);
  }

  async function cached(key, names) {
    if (memory.has(key)) {
      const value = memory.get(key);
      remember(key, value);
      return value;
    }
    if (!cacheRoot) return null;
    try {
      const file = join(cacheRoot, `${key}.json`);
      if ((await stat(file)).size > 32768) return null;
      const data = JSON.parse(await readFile(file, 'utf8'));
      if (data.version !== 1 || data.key !== key || !usable(data.translation, names)) return null;
      remember(key, data.translation);
      return data.translation;
    } catch { return null; }
  }

  async function save(key, translation) {
    remember(key, translation);
    if (!cacheRoot) return;
    try {
      await mkdir(cacheRoot, { recursive: true, mode: 0o700 });
      const dir = await mkdtemp(join(cacheRoot, '.write-'));
      try {
        const file = join(dir, 'entry.json');
        await writeFile(file, JSON.stringify({ version: 1, key, translation }), { mode: 0o600 });
        await rename(file, join(cacheRoot, `${key}.json`));
      } finally { await rm(dir, { recursive: true, force: true }); }
      const entries = [];
      for (const name of await readdir(cacheRoot)) {
        if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
        const path = join(cacheRoot, name);
        try { const info = await stat(path); entries.push({ path, size: info.size, time: info.mtimeMs }); } catch {}
      }
      entries.sort((a, b) => a.time - b.time);
      let total = entries.reduce((sum, item) => sum + item.size, 0);
      while (entries.length > maxEntries || total > maxCacheBytes) {
        const item = entries.shift();
        if (!item) break;
        await rm(item.path, { force: true });
        total -= item.size;
      }
    } catch { warn('[title-translation] cache write unavailable'); }
  }

  async function resolve(raw, key, names) {
    const previous = await cached(key, names);
    if (previous) return previous;
    const language = hasKana(raw) ? 'ja' : 'auto';
    if (now() >= googleBlockedUntil) {
      try {
        const result = await primary(raw, language);
        if (usable(result, names)) { const value = zh(result.trim()); await save(key, value); return value; }
      } catch (error) {
        if (error.status === 429) googleBlockedUntil = now() + cooldownMs;
        warn(`[title-translation] primary unavailable${error.status ? ` HTTP ${error.status}` : ''}`);
      }
    }
    if (fallback) {
      try {
        const result = await fallback(raw, language, names);
        if (usable(result, names)) { const value = zh(result.trim()); await save(key, value); return value; }
      } catch { warn('[title-translation] fallback unavailable'); }
    }
    // Failed/refused/non-Chinese output must never become a successful cache entry.
    return raw;
  }

  return async function translate(text, { names: suppliedNames = [] } = {}) {
    const raw = String(text || '').trim();
    if (!raw || raw.length > MAX_TEXT) return raw;
    const names = validNames(suppliedNames);
    if (isChinese(withoutNames(raw, names))) return zh(raw);
    const key = createHash('sha256').update(`title:zh-CN:v1\0${JSON.stringify(names)}\0${raw}`).digest('hex');
    if (inFlight.has(key)) return inFlight.get(key);
    const pending = resolve(raw, key, names);
    inFlight.set(key, pending);
    try { return await pending; }
    finally { inFlight.delete(key); }
  };
}

let defaultTranslator;
export function translateTitleToZh(text, options) {
  if (!defaultTranslator) {
    defaultTranslator = createTitleTranslator({
      cacheRoot: process.env.TITLE_TRANSLATION_CACHE_DIR || join(dirname(process.env.TMP_DIR || './data/tmp'), 'translations'),
      fallback: (raw, language, names) => requestFallbackTranslation(raw, { language, names }),
    });
  }
  return defaultTranslator(text, options);
}
