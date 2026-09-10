import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mirror = 'https://www.jav321.com/images/prestige/abw/257/pf_o1_abw-257.jpg';
const official = 'https://www.prestige-av.com/api/media/goods/prestige/abw/257/pf_abw-257.jpg?w=482&f=jpg';
const state = { calls: [], failures: new Set() };
globalThis.__prestigeCoverTest = state;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'node:child_process' && context.parentURL === new URL('../src/javdb.js', import.meta.url).href) {
      const source = `import { writeFile } from 'node:fs/promises';
        export function execFile(command, args, options, callback) {
          const state = globalThis.__prestigeCoverTest;
          state.calls.push({ command, args });
          const url = args.at(-1);
          if (state.failures.has(url)) { queueMicrotask(() => callback(new Error('curl: timeout'))); return; }
          writeFile(args[args.indexOf('-o') + 1], 'image-fixture').then(() => callback(null, '', ''), callback);
        }`;
      return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
const { downloadCover } = await import('../src/javdb.js');
hooks.deregister();
after(() => { delete globalThis.__prestigeCoverTest; });
async function setup(t) {
  state.calls = []; state.failures = new Set();
  const root = await mkdtemp(join(tmpdir(), 'prestige-cover-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('original landscape mirror is attempted before the official fallback with official referer', async t => {
  const root = await setup(t);
  state.failures.add(mirror);
  const cover = await downloadCover(mirror, root);
  assert.deepEqual(state.calls.map(c => c.args.at(-1)), [mirror, official]);
  assert.ok(state.calls[1].args.includes('Referer: https://www.prestige-av.com/'));
  assert.equal(state.calls.length, 2);
  assert.equal(await readFile(cover.file, 'utf8'), 'image-fixture');
  await cover.cleanup();
  assert.deepEqual(await readdir(root), []);
});

test('healthy original landscape does not consult the official fallback', async t => {
  const root = await setup(t);
  const cover = await downloadCover(mirror, root);
  assert.deepEqual(state.calls.map(c => c.args.at(-1)), [mirror]);
  assert.ok(state.calls[0].args.includes('Referer: https://www.jav321.com/'));
  assert.ok(state.calls[0].args.includes('Accept: image/jpeg,image/png;q=0.9,*/*;q=0.8'));
  assert.equal(state.calls[0].args.includes('Accept: image/avif,image/webp,image/apng,image/*,*/*;q=0.8'), false);
  await cover.cleanup();
  assert.deepEqual(await readdir(root), []);
});

test('all source failures remove the temporary directory', async t => {
  const root = await setup(t);
  state.failures = new Set([official, mirror]);
  await assert.rejects(downloadCover(mirror, root), /curl/);
  assert.deepEqual(state.calls.map(c => c.args.at(-1)), [mirror, official]);
  assert.deepEqual(await readdir(root), []);
});

test('does not rewrite unrelated hosts, path/code collisions or sample images', async t => {
  const root = await setup(t);
  for (const url of [
    mirror.replace('www.jav321.com', 'www.jav321.com.evil.invalid'),
    mirror.replace('pf_o1_abw-257', 'pf_o1_abw-2570'),
    mirror.replace('/257/', '/258/'),
    mirror.replace('pf_o1_', 'cap_e_0_'),
    'https://pics.dmm.co.jp/digital/video/abc001/abc001pl.jpg',
  ]) {
    state.calls = [];
    const cover = await downloadCover(url, root);
    assert.deepEqual(state.calls.map(c => c.args.at(-1)), [url]);
    await cover.cleanup();
  }
});

test('Missav image CDN retains its required referer', async t => {
  const root = await setup(t);
  const cover = await downloadCover('https://fourhoi.com/test/cover.jpg', root);
  assert.ok(state.calls[0].args.includes('Referer: https://missav.ai/'));
  await cover.cleanup();
});
