import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTitleTranslator, requestFallbackTranslation, requestGoogleTranslation } from '../src/title-translation.js';

async function setup(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'title-translation-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const state = { primary: 0, fallback: 0 };
  const translate = createTitleTranslator({
    cacheRoot: join(root, 'cache'),
    primary: async () => { state.primary++; throw Object.assign(Error('rate limited'), { status: 429 }); },
    fallback: async () => { state.fallback++; return '放学后的约定'; },
    warn: () => {},
    ...options,
  });
  return { root, state, translate };
}

test('Google 429 falls back to a usable Chinese translation', async t => {
  const { state, translate } = await setup(t);
  assert.equal(await translate('放課後の約束'), '放学后的约定');
  assert.deepEqual(state, { primary: 1, fallback: 1 });
});

test('successful translations survive a new translator and a complete upstream outage', async t => {
  const { root, state, translate } = await setup(t);
  await translate('放課後の約束');
  const offline = createTitleTranslator({ cacheRoot: join(root, 'cache'), primary: async () => { throw Error('must not call'); }, fallback: async () => { throw Error('must not call'); }, warn: () => {} });
  assert.equal(await offline('放課後の約束'), '放学后的约定');
  assert.deepEqual(state, { primary: 1, fallback: 1 });
});

test('429 pauses Google for subsequent titles and resumes after cooldown', async t => {
  let now = 0;
  const { state, translate } = await setup(t, { now: () => now, cooldownMs: 1000 });
  await translate('放課後の約束');
  await translate('私の休日');
  assert.equal(state.primary, 1);
  now = 1001;
  await translate('新しい一日');
  assert.equal(state.primary, 2);
  assert.equal(state.fallback, 3);
});

test('simultaneous identical titles share one upstream request', async t => {
  const { state, translate } = await setup(t);
  assert.deepEqual(await Promise.all(Array.from({ length: 6 }, () => translate('放課後の約束'))), Array(6).fill('放学后的约定'));
  assert.deepEqual(state, { primary: 1, fallback: 1 });
});

test('primary success avoids fallback and converts Traditional Chinese before caching', async t => {
  const { state, translate } = await setup(t, { primary: async () => '放學後的約定' });
  assert.equal(await translate('放課後の約束'), '放学后的约定');
  assert.equal(state.fallback, 0);
});

test('untranslated primary output is not accepted or cached as success', async t => {
  const { translate } = await setup(t, { primary: async text => text });
  assert.equal(await translate('放課後の約束'), '放学后的约定');
});

test('empty, Japanese and refusal fallback responses preserve the original without caching', async t => {
  for (const output of ['', '放課後の約束', '抱歉，我无法翻译这段内容。']) {
    const { root, translate } = await setup(t, { fallback: async () => output });
    assert.equal(await translate('放課後の約束'), '放課後の約束');
    assert.deepEqual(await readdir(join(root, 'cache')).catch(() => []), []);
  }
});

test('both providers failing preserves the original and allows a later retry', async t => {
  let fail = true;
  const { translate } = await setup(t, { fallback: async () => { if (fail) throw Error('offline'); return '放学后的约定'; } });
  assert.equal(await translate('放課後の約束'), '放課後の約束');
  fail = false;
  assert.equal(await translate('放課後の約束'), '放学后的约定');
});

test('corrupt or mismatched caches cannot supply another title', async t => {
  const { root, translate } = await setup(t);
  await translate('放課後の約束');
  const files = await readdir(join(root, 'cache'));
  assert.equal(files.length, 1);
  await writeFile(join(root, 'cache', files[0]), JSON.stringify({ key: 'wrong-title-key', translation: '错误的标题' }));
  const next = createTitleTranslator({ cacheRoot: join(root, 'cache'), primary: async () => '正确的标题', warn: () => {} });
  assert.equal(await next('放課後の約束'), '正确的标题');
  await writeFile(join(root, 'cache', files[0]), '{broken');
  const again = createTitleTranslator({ cacheRoot: join(root, 'cache'), primary: async () => '重新取得的标题', warn: () => {} });
  assert.equal(await again('放課後の約束'), '重新取得的标题');
});

test('cache write failure cannot suppress a successful translation', async t => {
  const { root } = await setup(t);
  const path = join(root, 'not-a-directory');
  await writeFile(path, 'occupied');
  const translate = createTitleTranslator({ cacheRoot: path, primary: async () => '放学后的约定', warn: () => {} });
  assert.equal(await translate('放課後の約束'), '放学后的约定');
});

test('cache has an entry limit and stores neither credentials nor request prompts', async t => {
  const { root, translate } = await setup(t, { maxEntries: 2 });
  for (const title of ['放課後の約束', '私の休日', '新しい一日']) await translate(title);
  const files = await readdir(join(root, 'cache'));
  assert.ok(files.length <= 2);
  for (const file of files) {
    assert.match(file, /^[a-f0-9]{64}\.json$/);
    const data = JSON.parse(await readFile(join(root, 'cache', file), 'utf8'));
    assert.deepEqual(Object.keys(data).sort(), ['key', 'translation', 'version']);
    assert.equal(data.key, file.slice(0, -5));
  }
});

test('English title uses automatic source language and Chinese titles do not need translation', async t => {
  const seen = [];
  const { translate } = await setup(t, { primary: async (text, language) => { seen.push(language); return '放学以后'; } });
  assert.equal(await translate('After School'), '放学以后');
  assert.deepEqual(seen, ['auto']);
  assert.equal(await translate('放學後的約定'), '放学后的约定');
  assert.equal(seen.length, 1);
});

const bingPage = 'IG:"test-ig" data-iid="translator.1" params_AbusePreventionHelper = [123456,"page-token",3600000];';

test('fallback uses only Bing page-issued tokens, never configured API credentials', async () => {
  const calls = [];
  const result = await requestFallbackTranslation('放課後の約束', {
    baseUrl: 'https://must-not-call.example/v1', apiKey: 'must-not-send', model: 'unused',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return calls.length === 1
        ? { ok: true, text: async () => bingPage }
        : { ok: true, json: async () => [{ translations: [{ text: '放學後的約定', to: 'zh-Hans' }] }] };
    },
  });
  assert.equal(result, '放学后的约定');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://www.bing.com/translator');
  const endpoint = new URL(calls[1].url);
  assert.equal(endpoint.origin, 'https://www.bing.com');
  assert.equal(endpoint.pathname, '/ttranslatev3');
  const body = new URLSearchParams(calls[1].options.body);
  assert.equal(body.get('text'), '放課後の約束');
  assert.equal(body.get('token'), 'page-token');
  assert.equal(body.get('fromLang'), 'ja');
  assert.equal(body.get('to'), 'zh-Hans');
  for (const { options } of calls) {
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal);
    assert.equal(options.headers.Authorization, undefined);
    assert.ok(!JSON.stringify(options).includes('must-not-send'));
  }
});

test('Bing supports automatic source detection and verified names', async () => {
  let body;
  const result = await requestFallbackTranslation('After School 山田はな', {
    language: 'auto', names: ['山田はな'],
    fetchImpl: async (url, options) => {
      if (!options.body) return { ok: true, text: async () => bingPage };
      body = new URLSearchParams(options.body);
      return { ok: true, json: async () => [{ translations: [{ text: '放学以后 山田はな', to: 'zh-Hans' }] }] };
    },
  });
  assert.equal(result, '放学以后 山田はな');
  assert.equal(body.get('fromLang'), 'auto-detect');
});

test('missing Bing page tokens stop before any translation request', async () => {
  let calls = 0;
  await assert.rejects(requestFallbackTranslation('放課後の約束', {
    fetchImpl: async () => { calls++; return { ok: true, text: async () => '<html>unavailable</html>' }; },
  }));
  assert.equal(calls, 1);
});

test('Bing HTTP failures, captcha, malformed and untranslated output are rejected', async () => {
  for (const response of [
    { ok: false, status: 429 },
    { ok: true, json: async () => ({ ShowCaptcha: true }) },
    { ok: true, json: async () => [] },
    { ok: true, json: async () => [{ translations: [{ text: '放課後の約束', to: 'zh-Hans' }] }] },
    { ok: true, json: async () => [{ translations: [{ text: '放学后的约定', to: 'en' }] }] },
  ]) {
    await assert.rejects(requestFallbackTranslation('放課後の約束', {
      fetchImpl: async (url, options) => options.body ? response : { ok: true, text: async () => bingPage },
    }));
  }
});

test('verified Japanese proper names may remain while the title body must be Chinese', async t => {
  const { translate } = await setup(t, { primary: async () => '放学后的约定 山田はな' });
  assert.equal(await translate('放課後の約束 山田はな', { names: ['山田はな'] }), '放学后的约定 山田はな');
});

test('unknown kana is rejected and proper-name context cannot reuse an incompatible cache entry', async t => {
  const { state, translate } = await setup(t, { fallback: async () => { state.fallback++; return '放学后的约定 山田はな'; } });
  const raw = '放課後の約束 山田はな';
  assert.equal(await translate(raw, { names: ['山田はな'] }), '放学后的约定 山田はな');
  assert.equal(await translate(raw), raw);
  assert.equal(state.fallback, 2);
});

test('non-Chinese title body is rejected even when all proper names are known', async t => {
  const { translate } = await setup(t, { fallback: async () => '放课后の约束 山田はな' });
  const raw = '放課後の約束 山田はな';
  assert.equal(await translate(raw, { names: ['山田はな'] }), raw);
});

test('cached proper names remain valid after Traditional-to-Simplified conversion', async t => {
  const { root, translate } = await setup(t, { primary: async () => '放學後的約定 澤田はな' });
  const raw = '放課後の約束 澤田はな';
  assert.equal(await translate(raw, { names: ['澤田はな'] }), '放学后的约定 泽田はな');
  const offline = createTitleTranslator({ cacheRoot: join(root, 'cache'), primary: async () => { throw Error('offline'); }, warn: () => {} });
  assert.equal(await offline(raw, { names: ['澤田はな'] }), '放学后的约定 泽田はな');
});

test('Google transport preserves HTTP 429 for the circuit breaker', async () => {
  await assert.rejects(requestGoogleTranslation('放課後の約束', 'ja', { exec: async () => { throw Object.assign(Error('curl failed'), { stderr: 'curl: (22) The requested URL returned error: 429\n' }); } }), e => e.status === 429 && !e.message.includes('放課後'));
});
