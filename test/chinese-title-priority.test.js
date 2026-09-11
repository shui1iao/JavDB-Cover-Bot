import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// Exercise the real query/parsing/caption pipeline; replace upstream I/O only.
// These are synthetic fixtures, not claims about live website responses.
const key = '__chineseTitlePriorityTest';
const state = {};
let queryJav321;
before(async () => {
  globalThis[key] = state;
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (context.parentURL === new URL('../src/jav321.js', import.meta.url).href) {
        const modules = {
          './javdb.js': `export const queryJavdb = async () => globalThis.${key}.javdb;`,
          './title-translation.js': `export async function translateTitleToZh(text) {
            const state = globalThis.${key};
            state.titleHelperCalls++;
            state.translations.push(text);
            return state.translationFails ? (state.titleFallback || text) : '机器翻译标题';
          }`,
          'node:child_process': `import { promisify } from 'node:util';
          export function execFile(command, args, options, callback) {
            try { callback(null, globalThis.${key}.request(args), ''); }
            catch (error) { callback(error); }
          }
          execFile[promisify.custom] = async (command, args) => ({ stdout: globalThis.${key}.request(args), stderr: '' });`,
        };
        if (specifier in modules) return { url: `data:text/javascript,${encodeURIComponent(modules[specifier])}`, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
  });
  try { ({ queryJav321 } = await import('../src/jav321.js')); }
  finally { hooks.deregister(); }
});
after(() => { delete globalThis[key]; });
beforeEach(() => {
  state.title = '放課後の約束';
  state.translations = [];
  state.titleHelperCalls = 0;
  state.titleFallback = '';
  state.translationFails = false;
  state.javdb = {
    item: { code: 'TEST-123', title: 'TEST-123 放課後の約束' },
    detail: { rawTitle: '放課後の約束', maker: 'Example', actors: [{ name: 'Alice', gender: 'female' }], tags: ['剧情'] },
  };
  state.request = (args) => {
    const url = args.at(-1);
    if (url === 'https://www.jav321.com/search') return `<div class="panel panel-info">
      <div class="panel-heading"><h3>TEST-123 ${state.title}</h3></div>
      <b>メーカー</b>: Example<br><b>配信開始日</b>: 2026-01-01<br><b>品番</b>: TEST-123<br>
      <b>出演者</b>: <a href="/star/alice">Alice</a><br><a href="/genre/1">剧情</a>
      <img class="img-responsive" src="https://pics.dmm.co.jp/digital/video/test00123/test00123pl.jpg"></div>`;
    if (url.startsWith('https://translate.googleapis.com/')) {
      state.translations.push(new URL(url).searchParams.get('q'));
      if (state.translationFails) throw Error('translation unavailable');
      return JSON.stringify([[['机器翻译标题', state.translations.at(-1)]]]);
    }
    throw Error(`Unexpected upstream request: ${url}`);
  };
});
const titleOf = (result) => result.caption.split('\n').find(line => line.startsWith('<b>标题：</b>'));

test('existing Chinese detail title wins over Japanese JavDB title without translation or cover changes', async () => {
  state.title = '放学后的约定';
  const result = await queryJav321('TEST-123');
  assert.equal(titleOf(result), '<b>标题：</b>放学后的约定');
  assert.deepEqual(state.translations, []);
  assert.equal(result.cover, 'https://pics.dmm.co.jp/digital/video/test00123/test00123pl.jpg');
  assert.match(result.caption, /<b>演员：<\/b>#Alice/);
  assert.match(result.caption, /<b>标签：<\/b>#剧情/);
});

test('Chinese JavDB search title is retained even when its detail title is Japanese', async () => {
  state.javdb.item.title = 'TEST-123 放學後的約定';
  const result = await queryJav321('TEST-123');
  assert.equal(titleOf(result), '<b>标题：</b>放学后的约定');
  assert.deepEqual(state.translations, []);
});

test('Chinese JavDB detail wins over another Chinese source and converts traditional characters', async () => {
  state.title = '另一个中文标题';
  state.javdb.detail.rawTitle = '放學後的約定';
  assert.equal(titleOf(await queryJav321('TEST-123')), '<b>标题：</b>放学后的约定');
  assert.deepEqual(state.translations, []);
});

test('without a Chinese candidate, the existing Japanese title priority and translation remain', async () => {
  state.title = '私の休日';
  const result = await queryJav321('TEST-123');
  assert.equal(titleOf(result), '<b>标题：</b>机器翻译标题');
  assert.deepEqual(state.translations, ['放課後の約束']);
});

test('a different product Chinese title is not accepted from a near-match JavDB result', async () => {
  state.javdb.item.code = 'TEST-1234';
  state.javdb.item.title = 'TEST-1234 错误的中文标题';
  state.javdb.detail.rawTitle = '错误的中文标题';
  assert.equal(titleOf(await queryJav321('TEST-123')), '<b>标题：</b>机器翻译标题');
  assert.deepEqual(state.translations, ['放課後の約束']);
});

test('English and empty titles do not displace a Chinese candidate', async () => {
  state.title = '放学后的约定';
  state.javdb.detail.rawTitle = 'After School';
  state.javdb.item.title = 'TEST-123';
  assert.equal(titleOf(await queryJav321('TEST-123')), '<b>标题：</b>放学后的约定');
});

test('halfwidth Japanese kana is not mistaken for a Chinese candidate', async () => {
  state.title = '放学后的约定';
  state.javdb.detail.rawTitle = '私の休日';
  state.javdb.item.title = 'TEST-123 放課後ﾉ約束';
  assert.equal(titleOf(await queryJav321('TEST-123')), '<b>标题：</b>放学后的约定');
});

test('selected Chinese title is HTML escaped', async () => {
  state.title = '放学后的约定 &amp; 重逢';
  assert.equal(titleOf(await queryJav321('TEST-123')), '<b>标题：</b>放学后的约定 &amp; 重逢');
});

test('Chinese punctuation does not make a Chinese title look Japanese', async () => {
  state.title = '放学后的约定。再次重逢';
  assert.equal(titleOf(await queryJav321('TEST-123')), '<b>标题：</b>放学后的约定。再次重逢');
  assert.deepEqual(state.translations, []);
});

test('already fetched 3xplanet Chinese title can win without replacing the primary cover', async () => {
  state.javdb.detail.maker = '';
  const request = state.request;
  state.request = args => {
    if (args.at(-1) === 'https://3xplanet.com/test-123/') return `<h1>TEST-123 放学后的约定</h1>
      <link rel="canonical" href="https://3xplanet.com/test-123/">
      <meta property="og:image" content="https://example.invalid/alternative-cover.jpg">`;
    return request(args).replaceAll('Example', '');
  };
  const result = await queryJav321('TEST-123');
  assert.equal(titleOf(result), '<b>标题：</b>放学后的约定');
  assert.equal(result.cover, 'https://pics.dmm.co.jp/digital/video/test00123/test00123pl.jpg');
  assert.deepEqual(state.translations, []);
});

test('near-match 3xplanet Chinese title cannot enter title candidates', async () => {
  state.javdb.detail.maker = '';
  const request = state.request;
  state.request = args => {
    if (args.at(-1) === 'https://3xplanet.com/test-123/') return `<h1>TEST-1234 错误的中文标题</h1>
      <link rel="canonical" href="https://3xplanet.com/test-1234/">
      <meta property="og:image" content="https://example.invalid/alternative-cover.jpg">`;
    return request(args).replaceAll('Example', '');
  };
  assert.equal(titleOf(await queryJav321('TEST-123')), '<b>标题：</b>机器翻译标题');
});

test('non-Chinese title goes through the cached fallback-capable title translator', async () => {
  await queryJav321('TEST-123');
  assert.equal(state.titleHelperCalls, 1);
});

test('Google failure can return the secondary Chinese title without changing the cover', async () => {
  state.translationFails = true;
  state.titleFallback = '备用翻译标题';
  const result = await queryJav321('TEST-123');
  assert.equal(titleOf(result), '<b>标题：</b>备用翻译标题');
  assert.equal(result.cover, 'https://pics.dmm.co.jp/digital/video/test00123/test00123pl.jpg');
});

test('translation failure still preserves original text rather than hiding the title', async () => {
  state.translationFails = true;
  assert.equal(titleOf(await queryJav321('TEST-123')), '<b>标题：</b>放课后の约束');
});
